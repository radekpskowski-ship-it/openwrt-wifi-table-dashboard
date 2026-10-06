"""Koordynator: odpytuje router co scan_interval i buduje model dashboardu."""
from __future__ import annotations

from datetime import timedelta
import logging
import time

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME, CONF_VERIFY_SSL
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers import area_registry as ar, device_registry as dr, label_registry as lr
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import MikroTikLeases, UbusAuthError, UbusClient, UbusError
from .const import (
    CONF_MT_HOST, CONF_MT_PASSWORD, CONF_MT_SSL, CONF_MT_USERNAME, CONF_SCAN_INTERVAL, CONF_SSL,
    CONF_WATCH_LABEL, DEFAULT_SCAN_INTERVAL, DEFAULT_WATCH_LABEL, DOMAIN, EVENT_NEW_CLIENT, TRACKER_DOMAINS,
)
from .model import MAC_RE, build, collect

_LOGGER = logging.getLogger(__name__)

type OpenWrtWifiConfigEntry = ConfigEntry[OpenWrtWifiCoordinator]


class OpenWrtWifiCoordinator(DataUpdateCoordinator[dict]):
    """Dane jednego routera OpenWrt."""

    config_entry: OpenWrtWifiConfigEntry

    def __init__(self, hass: HomeAssistant, entry: OpenWrtWifiConfigEntry) -> None:
        opts = entry.options
        super().__init__(
            hass, _LOGGER, config_entry=entry, name=f"{DOMAIN} {entry.data[CONF_HOST]}",
            update_interval=timedelta(seconds=opts.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)),
        )
        http = async_get_clientsession(hass, verify_ssl=False)
        d = entry.data
        self.client = UbusClient(http, d[CONF_HOST], d[CONF_PORT], d[CONF_USERNAME], d.get(CONF_PASSWORD, ""),
                                 d.get(CONF_SSL, False), d.get(CONF_VERIFY_SSL, False))
        self.mikrotik = None
        if opts.get(CONF_MT_HOST):
            self.mikrotik = MikroTikLeases(http, opts[CONF_MT_HOST], opts.get(CONF_MT_USERNAME, ""),
                                           opts.get(CONF_MT_PASSWORD, ""), opts.get(CONF_MT_SSL, False))
        self._store: Store[dict] = Store(hass, 1, f"{DOMAIN}.{entry.entry_id}")
        self._seen: dict = {}
        self._prev: dict = {}
        self._board: dict | None = None

    async def _async_setup(self) -> None:
        self._seen = await self._store.async_load() or {}

    async def _async_update_data(self) -> dict:
        try:
            raw = await collect(self.client, self.mikrotik, self._board)
        except UbusAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except UbusError as err:
            raise UpdateFailed(str(err)) from err
        self._board = raw["board"]
        if raw.get("mikrotik_error"):
            _LOGGER.debug("Dzierzawy MikroTika niedostepne: %s", raw["mikrotik_error"])
        data, self._prev, new_macs = build(raw, self._prev, self._seen, self._ha_names(), self._watched(), time.time())
        self._store.async_delay_save(lambda: self._seen, 60)
        for mac in new_macs:
            c = next(c for c in data["clients"] if c["mac"] == mac)
            self.hass.bus.async_fire(EVENT_NEW_CLIENT, {
                "entry_id": self.config_entry.entry_id, "router": self.config_entry.title,
                "mac": mac, "name": c["name"], "ip": c["ip"], "signal": c["signal"], "ssid": c["ssid"],
            })
        return data

    def _ha_names(self) -> dict[str, tuple[str, str | None]]:
        """MAC -> (nazwa, obszar) z rejestru urzadzen HA; pomija trackery i nazwy-MAC."""
        dev_reg, area_reg = dr.async_get(self.hass), ar.async_get(self.hass)
        best: dict[str, tuple[int, str, str | None]] = {}
        for d in dev_reg.devices:
            if d.disabled_by:
                continue
            ids = set(getattr(d, "config_entries", None) or ()) | {
                getattr(d, "config_entry_id", None), getattr(d, "primary_config_entry", None)}
            domains = {e.domain for i in ids if i and (e := self.hass.config_entries.async_get_entry(i))}
            if domains and domains <= TRACKER_DOMAINS:
                continue
            name = d.name_by_user or d.name
            if not name or MAC_RE.match(name) or (not d.name_by_user and name.lower().startswith("openwrt-")):
                continue
            score = (2 if d.name_by_user else 0) + (1 if d.area_id else 0)
            area = (a.name if d.area_id and (a := area_reg.async_get_area(d.area_id)) else None)
            for kind, mac in d.connections:
                if kind == dr.CONNECTION_NETWORK_MAC:
                    mac = mac.lower()
                    if mac not in best or score > best[mac][0]:
                        best[mac] = (score, name, area)
        return {m: (n, a) for m, (_, n, a) in best.items()}

    def _watched(self) -> list[tuple[str, str, str | None]]:
        label_name = self.config_entry.options.get(CONF_WATCH_LABEL, DEFAULT_WATCH_LABEL)
        if not label_name:
            return []
        label = lr.async_get(self.hass).async_get_label_by_name(label_name)
        if label is None:
            return []
        area_reg = ar.async_get(self.hass)
        out = {}
        for d in dr.async_entries_for_label(dr.async_get(self.hass), label.label_id):
            area = (a.name if d.area_id and (a := area_reg.async_get_area(d.area_id)) else None)
            for kind, mac in d.connections:
                if kind == dr.CONNECTION_NETWORK_MAC:
                    out[mac.lower()] = (d.name_by_user or d.name, area)
        return [(m, n, a) for m, (n, a) in out.items()]
