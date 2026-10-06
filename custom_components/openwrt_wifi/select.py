"""Kanal radia (zapis trwaly w /etc/config/wireless)."""
from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import OpenWrtWifiConfigEntry, OpenWrtWifiCoordinator
from .sensor import OpenWrtWifiEntity

PARALLEL_UPDATES = 1


async def async_setup_entry(hass: HomeAssistant, entry: OpenWrtWifiConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coord = entry.runtime_data
    async_add_entities(ChannelSelect(coord, r["radio"]) for r in coord.data["radios"] if r.get("uci_radio"))


class ChannelSelect(OpenWrtWifiEntity, SelectEntity):
    _attr_translation_key = "channel"
    _attr_icon = "mdi:access-point-network"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coord: OpenWrtWifiCoordinator, radio: str) -> None:
        super().__init__(coord, f"{radio}_channel")
        self._radio = radio
        r = self._r() or {}
        self._attr_translation_placeholders = {"radio": f"{r.get('band', '')} {r.get('ssid') or radio}".strip()}

    def _r(self) -> dict | None:
        return next((r for r in self.coordinator.data["radios"] if r["radio"] == self._radio), None)

    @property
    def available(self) -> bool:
        return super().available and self._r() is not None

    @property
    def options(self) -> list[str]:
        r = self._r() or {}
        return ["auto", *(str(c) for c in r.get("channels", []))]

    @property
    def current_option(self) -> str | None:
        r = self._r()
        return r.get("channel_cfg") if r else None

    async def async_select_option(self, option: str) -> None:
        await self.coordinator.async_set_channel(self._radio, option)
