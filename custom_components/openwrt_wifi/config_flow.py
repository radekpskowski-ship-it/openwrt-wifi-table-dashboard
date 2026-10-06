"""Konfiguracja z UI: router OpenWrt (ubus) + opcje (panel, MikroTik jako zrodlo nazw)."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlowWithReload
from homeassistant.const import CONF_HOST, CONF_NAME, CONF_PASSWORD, CONF_PORT, CONF_USERNAME, CONF_VERIFY_SSL
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    NumberSelector, NumberSelectorConfig, NumberSelectorMode, TextSelector, TextSelectorConfig, TextSelectorType,
)

from .api import MikroTikLeases, UbusAuthError, UbusClient, UbusError
from .const import (
    CONF_CLIENT_SENSORS, CONF_MT_HOST, CONF_MT_PASSWORD, CONF_MT_SSL, CONF_MT_USERNAME, CONF_PANEL_TITLE,
    CONF_SCAN_INTERVAL, CONF_SHOW_PANEL, CONF_SSL, CONF_WATCH_LABEL, DEFAULT_PORT, DEFAULT_SCAN_INTERVAL,
    DEFAULT_USERNAME, DEFAULT_WATCH_LABEL, DOMAIN,
)

PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))


async def _probe(hass, data: Mapping[str, Any]) -> dict:
    """Logowanie + iwinfo; zwraca system.board albo rzuca UbusError/UbusAuthError."""
    client = UbusClient(async_get_clientsession(hass, verify_ssl=False), data[CONF_HOST], data[CONF_PORT],
                        data[CONF_USERNAME], data.get(CONF_PASSWORD, ""), data.get(CONF_SSL, False),
                        data.get(CONF_VERIFY_SSL, False))
    await client.login()
    board = await client.call("system", "board")
    devices = await client.call("iwinfo", "devices")
    if not devices.get("devices"):
        raise NoWifi
    return board


class NoWifi(Exception):
    """Router nie ma interfejsow Wi-Fi widocznych w iwinfo."""


def _errors_for(err: Exception) -> str:
    if isinstance(err, UbusAuthError):
        return "invalid_auth"
    if isinstance(err, NoWifi):
        return "no_wifi"
    if isinstance(err, UbusError):
        return "cannot_connect"
    return "unknown"


class OpenWrtWifiConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            await self.async_set_unique_id(f"{user_input[CONF_HOST]}:{user_input[CONF_PORT]}")
            self._abort_if_unique_id_configured()
            try:
                board = await _probe(self.hass, user_input)
            except (UbusError, NoWifi) as err:
                errors["base"] = _errors_for(err)
            else:
                title = user_input.pop(CONF_NAME, None) or f"OpenWrt {board.get('hostname') or user_input[CONF_HOST]}"
                return self.async_create_entry(title=title, data=user_input,
                                               options={CONF_SHOW_PANEL: True, CONF_PANEL_TITLE: title})
        schema = vol.Schema({
            vol.Optional(CONF_NAME): str,
            vol.Required(CONF_HOST): str,
            vol.Required(CONF_PORT, default=DEFAULT_PORT): vol.All(vol.Coerce(int), vol.Range(1, 65535)),
            vol.Required(CONF_USERNAME, default=DEFAULT_USERNAME): str,
            vol.Optional(CONF_PASSWORD, default=""): PASSWORD,
            vol.Required(CONF_SSL, default=False): bool,
            vol.Required(CONF_VERIFY_SSL, default=False): bool,
        })
        return self.async_show_form(step_id="user", data_schema=self.add_suggested_values_to_schema(schema, user_input),
                                    errors=errors)

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {**entry.data, **user_input}
            try:
                await _probe(self.hass, data)
            except (UbusError, NoWifi) as err:
                errors["base"] = _errors_for(err)
            else:
                return self.async_update_reload_and_abort(entry, data=data)
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({
                vol.Required(CONF_USERNAME, default=entry.data[CONF_USERNAME]): str,
                vol.Optional(CONF_PASSWORD, default=""): PASSWORD,
            }),
            description_placeholders={"host": entry.data[CONF_HOST]},
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry) -> OpenWrtWifiOptionsFlow:
        return OpenWrtWifiOptionsFlow()


class OpenWrtWifiOptionsFlow(OptionsFlowWithReload):

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            user_input[CONF_SCAN_INTERVAL] = int(user_input[CONF_SCAN_INTERVAL])
            if user_input.get(CONF_MT_HOST):
                mt = MikroTikLeases(async_get_clientsession(self.hass, verify_ssl=False), user_input[CONF_MT_HOST],
                                    user_input.get(CONF_MT_USERNAME, ""), user_input.get(CONF_MT_PASSWORD, ""),
                                    user_input.get(CONF_MT_SSL, False))
                try:
                    await mt.leases()
                except UbusAuthError:
                    errors[CONF_MT_HOST] = "mikrotik_auth"
                except UbusError:
                    errors[CONF_MT_HOST] = "mikrotik_cannot_connect"
            if not errors:
                return self.async_create_entry(data=user_input)
        o = self.config_entry.options
        schema = vol.Schema({
            vol.Required(CONF_SCAN_INTERVAL, default=o.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)): NumberSelector(
                NumberSelectorConfig(min=10, max=600, step=5, unit_of_measurement="s", mode=NumberSelectorMode.BOX)),
            vol.Required(CONF_SHOW_PANEL, default=o.get(CONF_SHOW_PANEL, True)): bool,
            vol.Optional(CONF_PANEL_TITLE, default=o.get(CONF_PANEL_TITLE) or self.config_entry.title): str,
            vol.Required(CONF_CLIENT_SENSORS, default=o.get(CONF_CLIENT_SENSORS, False)): bool,
            vol.Optional(CONF_WATCH_LABEL, default=o.get(CONF_WATCH_LABEL, DEFAULT_WATCH_LABEL)): str,
            vol.Optional(CONF_MT_HOST, default=o.get(CONF_MT_HOST, "")): str,
            vol.Optional(CONF_MT_USERNAME, default=o.get(CONF_MT_USERNAME, "")): str,
            vol.Optional(CONF_MT_PASSWORD, default=o.get(CONF_MT_PASSWORD, "")): PASSWORD,
            vol.Required(CONF_MT_SSL, default=o.get(CONF_MT_SSL, False)): bool,
        })
        return self.async_show_form(step_id="init", data_schema=self.add_suggested_values_to_schema(schema, user_input),
                                    errors=errors)
