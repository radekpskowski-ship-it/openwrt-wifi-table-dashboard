"""Sensory: zbiorczy (dane dashboardu w atrybutach), router, radia i opcjonalnie sygnal per klient."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass, SensorEntity, SensorEntityDescription, SensorStateClass,
)
from homeassistant.const import (
    PERCENTAGE, SIGNAL_STRENGTH_DECIBELS_MILLIWATT, EntityCategory, UnitOfDataRate,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import CONF_CLIENT_SENSORS, DOMAIN, VERSION
from .coordinator import OpenWrtWifiConfigEntry, OpenWrtWifiCoordinator

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class RouterSensorDescription(SensorEntityDescription):
    value_fn: Callable[[dict], Any]


def _boot_time(r: dict) -> datetime | None:
    if r.get("uptime") is None:
        return None
    # zaokraglenie do minuty, zeby stan nie zmienial sie przy kazdym odczycie
    boot = dt_util.utcnow() - timedelta(seconds=r["uptime"])
    return boot.replace(second=0, microsecond=0)


ROUTER_SENSORS: tuple[RouterSensorDescription, ...] = (
    RouterSensorDescription(key="cpu", translation_key="cpu", native_unit_of_measurement=PERCENTAGE,
                            state_class=SensorStateClass.MEASUREMENT, suggested_display_precision=0,
                            value_fn=lambda r: r["cpu"]),
    RouterSensorDescription(key="load1", translation_key="load1", state_class=SensorStateClass.MEASUREMENT,
                            suggested_display_precision=2, value_fn=lambda r: (r["load"] or [None])[0]),
    RouterSensorDescription(key="memory", translation_key="memory", native_unit_of_measurement=PERCENTAGE,
                            state_class=SensorStateClass.MEASUREMENT, suggested_display_precision=0,
                            value_fn=lambda r: r["mem_pct"]),
    RouterSensorDescription(key="lan_rx", translation_key="lan_rx", device_class=SensorDeviceClass.DATA_RATE,
                            native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
                            state_class=SensorStateClass.MEASUREMENT, suggested_display_precision=2,
                            value_fn=lambda r: r["lan_rx"]),
    RouterSensorDescription(key="lan_tx", translation_key="lan_tx", device_class=SensorDeviceClass.DATA_RATE,
                            native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
                            state_class=SensorStateClass.MEASUREMENT, suggested_display_precision=2,
                            value_fn=lambda r: r["lan_tx"]),
    RouterSensorDescription(key="boot", translation_key="boot", device_class=SensorDeviceClass.TIMESTAMP,
                            entity_category=EntityCategory.DIAGNOSTIC, value_fn=_boot_time),
    RouterSensorDescription(key="firmware", translation_key="firmware", entity_category=EntityCategory.DIAGNOSTIC,
                            value_fn=lambda r: r["firmware"]),
)
WAN_SENSORS: tuple[RouterSensorDescription, ...] = (
    RouterSensorDescription(key="wan_rx", translation_key="wan_rx", device_class=SensorDeviceClass.DATA_RATE,
                            native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
                            state_class=SensorStateClass.MEASUREMENT, suggested_display_precision=2,
                            value_fn=lambda r: r["wan_rx"]),
    RouterSensorDescription(key="wan_tx", translation_key="wan_tx", device_class=SensorDeviceClass.DATA_RATE,
                            native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
                            state_class=SensorStateClass.MEASUREMENT, suggested_display_precision=2,
                            value_fn=lambda r: r["wan_tx"]),
)


async def async_setup_entry(hass: HomeAssistant, entry: OpenWrtWifiConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coord = entry.runtime_data
    data = coord.data
    entities: list[SensorEntity] = [ClientsSensor(coord)]
    entities += [RouterSensor(coord, d) for d in ROUTER_SENSORS]
    if data["router"]["has_wan"]:
        entities += [RouterSensor(coord, d) for d in WAN_SENSORS]
    for r in data["radios"]:
        entities += [RadioSensor(coord, r["radio"], kind) for kind in ("clients", "util", "noise", "retry")]
    async_add_entities(entities)

    if not entry.options.get(CONF_CLIENT_SENSORS, False):
        return
    known: set[str] = set()

    @callback
    def _add_new_clients() -> None:
        new = [c["mac"] for c in coord.data["clients"] if c["mac"] not in known]
        if new:
            known.update(new)
            async_add_entities(ClientSignalSensor(coord, mac) for mac in new)

    _add_new_clients()
    entry.async_on_unload(coord.async_add_listener(_add_new_clients))


class OpenWrtWifiEntity(CoordinatorEntity[OpenWrtWifiCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coord: OpenWrtWifiCoordinator, key: str) -> None:
        super().__init__(coord)
        entry = coord.config_entry
        router = coord.data["router"]
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="OpenWrt",
            model=router.get("model"),
            sw_version=router.get("firmware"),
            configuration_url=f"http://{entry.data['host']}/",
        )


class ClientsSensor(OpenWrtWifiEntity, SensorEntity):
    """Liczba klientow; atrybuty = komplet danych dla karty/panelu."""

    _attr_translation_key = "clients"
    _attr_icon = "mdi:wifi"
    _attr_native_unit_of_measurement = "klientów"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _unrecorded_attributes = frozenset({
        "router", "radios", "clients", "counts", "new", "new_macs", "watch", "missing_macs",
        "updated", "entry_id", "integration", "title", "version", "mikrotik_error",
    })

    def __init__(self, coord: OpenWrtWifiCoordinator) -> None:
        super().__init__(coord, "clients")

    @property
    def native_value(self) -> int:
        return self.coordinator.data["count"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        d = self.coordinator.data
        return {
            "integration": DOMAIN, "version": VERSION, "entry_id": self.coordinator.config_entry.entry_id,
            "title": self.coordinator.config_entry.title,
            **{k: d[k] for k in ("router", "radios", "clients", "counts", "new", "new_macs", "watch",
                                 "missing_macs", "mikrotik_error", "updated")},
        }


class RouterSensor(OpenWrtWifiEntity, SensorEntity):
    entity_description: RouterSensorDescription

    def __init__(self, coord: OpenWrtWifiCoordinator, desc: RouterSensorDescription) -> None:
        super().__init__(coord, desc.key)
        self.entity_description = desc

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator.data["router"])


RADIO_KINDS = {
    "clients": dict(unit="klientów", icon="mdi:account-multiple", cls=None),
    "util": dict(unit=PERCENTAGE, icon="mdi:chart-donut", cls=None),
    "noise": dict(unit=SIGNAL_STRENGTH_DECIBELS_MILLIWATT, icon="mdi:waveform", cls=SensorDeviceClass.SIGNAL_STRENGTH),
    "retry": dict(unit=PERCENTAGE, icon="mdi:repeat", cls=None),
}


class RadioSensor(OpenWrtWifiEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coord: OpenWrtWifiCoordinator, radio: str, kind: str) -> None:
        super().__init__(coord, f"{radio}_{kind}")
        self._radio, self._kind = radio, kind
        spec = RADIO_KINDS[kind]
        r = self._r() or {}
        self._attr_translation_key = f"radio_{kind}"
        self._attr_translation_placeholders = {"radio": f"{r.get('band', '')} {r.get('ssid') or radio}".strip()}
        self._attr_native_unit_of_measurement = spec["unit"]
        self._attr_icon = spec["icon"]
        self._attr_device_class = spec["cls"]

    def _r(self) -> dict | None:
        return next((r for r in self.coordinator.data["radios"] if r["radio"] == self._radio), None)

    @property
    def available(self) -> bool:
        return super().available and self._r() is not None

    @property
    def native_value(self) -> Any:
        r = self._r()
        return r.get(self._kind) if r else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        r = self._r()
        if not r or self._kind != "clients":
            return None
        return {k: r[k] for k in ("ssid", "bssid", "band", "ch", "htmode", "power", "hw", "encryption")}


class ClientSignalSensor(OpenWrtWifiEntity, SensorEntity):
    """Sygnal jednego klienta (historia na wykresie); niedostepny, gdy klient rozlaczony."""

    _attr_device_class = SensorDeviceClass.SIGNAL_STRENGTH
    _attr_native_unit_of_measurement = SIGNAL_STRENGTH_DECIBELS_MILLIWATT
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_entity_registry_enabled_default = True

    def __init__(self, coord: OpenWrtWifiCoordinator, mac: str) -> None:
        super().__init__(coord, f"client_{mac.replace(':', '')}")
        self._mac = mac
        c = self._c() or {}
        self._attr_name = f"Sygnał {c.get('name') or mac}"

    def _c(self) -> dict | None:
        return next((c for c in self.coordinator.data["clients"] if c["mac"] == self._mac), None)

    @property
    def available(self) -> bool:
        return super().available and self._c() is not None

    @property
    def native_value(self) -> int | None:
        c = self._c()
        return c["signal"] if c else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        c = self._c()
        if not c:
            return {"mac": self._mac}
        return {k: c[k] for k in ("mac", "ip", "host", "ssid", "signal_avg", "retry", "tx", "rx")}
