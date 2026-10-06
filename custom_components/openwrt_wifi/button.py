"""Przyciski: restart Wi-Fi i restart routera."""
from __future__ import annotations

from homeassistant.components.button import ButtonDeviceClass, ButtonEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import OpenWrtWifiConfigEntry, OpenWrtWifiCoordinator
from .sensor import OpenWrtWifiEntity

PARALLEL_UPDATES = 1


async def async_setup_entry(hass: HomeAssistant, entry: OpenWrtWifiConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coord = entry.runtime_data
    async_add_entities([RestartWifiButton(coord), RebootButton(coord)])


class RestartWifiButton(OpenWrtWifiEntity, ButtonEntity):
    _attr_translation_key = "restart_wifi"
    _attr_icon = "mdi:wifi-refresh"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coord: OpenWrtWifiCoordinator) -> None:
        super().__init__(coord, "restart_wifi")

    async def async_press(self) -> None:
        await self.coordinator.async_restart_wifi()


class RebootButton(OpenWrtWifiEntity, ButtonEntity):
    _attr_device_class = ButtonDeviceClass.RESTART
    _attr_translation_key = "reboot"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coord: OpenWrtWifiCoordinator) -> None:
        super().__init__(coord, "reboot")

    async def async_press(self) -> None:
        await self.coordinator.async_reboot()
