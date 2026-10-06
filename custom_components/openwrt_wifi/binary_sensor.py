"""Porty fizyczne routera: link (connectivity) + predkosc/duplex w atrybutach."""
from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import OpenWrtWifiConfigEntry, OpenWrtWifiCoordinator
from .sensor import OpenWrtWifiEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(hass: HomeAssistant, entry: OpenWrtWifiConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coord = entry.runtime_data
    async_add_entities(PortSensor(coord, p["id"], p["label"]) for p in coord.data.get("ports", []))


class PortSensor(OpenWrtWifiEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_translation_key = "port"

    def __init__(self, coord: OpenWrtWifiCoordinator, port_id: str, label: str) -> None:
        super().__init__(coord, f"port_{port_id}")
        self._port_id = port_id
        self._attr_translation_placeholders = {"port": label}

    def _p(self) -> dict | None:
        return next((p for p in self.coordinator.data.get("ports", []) if p["id"] == self._port_id), None)

    @property
    def available(self) -> bool:
        return super().available and self._p() is not None

    @property
    def is_on(self) -> bool | None:
        p = self._p()
        return p["link"] if p else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        p = self._p()
        return {k: p[k] for k in ("label", "speed", "duplex", "errors")} if p else None
