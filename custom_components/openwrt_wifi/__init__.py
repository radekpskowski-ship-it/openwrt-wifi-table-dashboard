"""OpenWrt Wi-Fi Dashboard: klienci Wi-Fi, radia i obciazenie routera OpenWrt (ubus) + karta/panel."""
from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .api import UbusError
from .const import CARD_URL, CONF_PANEL_TITLE, CONF_SHOW_PANEL, DOMAIN, VERSION
from .coordinator import OpenWrtWifiConfigEntry, OpenWrtWifiCoordinator

PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR, Platform.BUTTON, Platform.SELECT]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
MODULE_URL = f"{CARD_URL}?v={VERSION}"
MAC = vol.All(cv.string, vol.Match(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$", msg="niepoprawny MAC"))
ENTRY = {vol.Optional("entry_id"): cv.string}
SERVICES = {
    # nazwa: (schemat, wywolanie na koordynatorze)
    "set_client_name": (
        vol.Schema({**ENTRY, vol.Required("mac"): MAC, vol.Optional("name", default=""): cv.string}),
        lambda c, d: c.async_set_client_name(d["mac"], d["name"]),
    ),
    "kick_client": (
        vol.Schema({**ENTRY, vol.Required("mac"): MAC,
                    vol.Optional("ban_seconds", default=0): vol.All(vol.Coerce(int), vol.Range(0, 86400))}),
        lambda c, d: c.async_kick_client(d["mac"], d["ban_seconds"]),
    ),
    "restart_wifi": (vol.Schema(ENTRY), lambda c, d: c.async_restart_wifi()),
    "reboot": (vol.Schema(ENTRY), lambda c, d: c.async_reboot()),
    "set_channel": (
        vol.Schema({**ENTRY, vol.Required("radio"): cv.string, vol.Required("channel"): cv.string}),
        lambda c, d: c.async_set_channel(d["radio"], d["channel"]),
    ),
}
# akcje zmieniajace stan routera wymagaja wskazania wpisu, gdy routerow jest kilka
NEEDS_SINGLE = {"kick_client", "restart_wifi", "reboot", "set_channel"}


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Udostepnia karte Lovelace `custom:openwrt-wifi-card` (raz, niezaleznie od liczby routerow)."""
    await hass.http.async_register_static_paths([
        StaticPathConfig(CARD_URL, str(Path(__file__).parent / "frontend" / "openwrt-wifi-card.js"), False)
    ])
    frontend.add_extra_js_url(hass, MODULE_URL)

    async def _handle(call: ServiceCall) -> None:
        entry_id = call.data.get("entry_id")
        entries = [e for e in hass.config_entries.async_entries(DOMAIN)
                   if e.state is ConfigEntryState.LOADED and (not entry_id or e.entry_id == entry_id)]
        if not entries:
            raise ServiceValidationError(f"Brak aktywnego routera {entry_id or ''}".strip())
        if call.service in NEEDS_SINGLE and len(entries) > 1:
            raise ServiceValidationError("Podaj entry_id - skonfigurowano kilka routerów")
        for entry in entries:
            try:
                await SERVICES[call.service][1](entry.runtime_data, call.data)
            except ValueError as err:
                raise ServiceValidationError(str(err)) from err
            except UbusError as err:
                raise HomeAssistantError(f"Router odrzucił polecenie: {err}") from err

    for name, (schema, _) in SERVICES.items():
        hass.services.async_register(DOMAIN, name, _handle, schema=schema)
    return True


def panel_path(entry: OpenWrtWifiConfigEntry) -> str:
    return f"openwrt-wifi-{entry.entry_id[-8:].lower()}"


async def async_setup_entry(hass: HomeAssistant, entry: OpenWrtWifiConfigEntry) -> bool:
    coordinator = OpenWrtWifiCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    if entry.options.get(CONF_SHOW_PANEL, True):
        frontend.async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title=entry.options.get(CONF_PANEL_TITLE) or entry.title,
            sidebar_icon="mdi:wifi",
            frontend_url_path=panel_path(entry),
            config={
                "_panel_custom": {"name": "openwrt-wifi-panel", "module_url": MODULE_URL,
                                  "embed_iframe": False, "trust_external": False},
                "entry_id": entry.entry_id,
            },
            require_admin=False,
            update=True,
        )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: OpenWrtWifiConfigEntry) -> bool:
    frontend.async_remove_panel(hass, panel_path(entry), warn_if_unknown=False)
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
