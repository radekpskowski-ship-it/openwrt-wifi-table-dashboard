"""OpenWrt Wi-Fi Dashboard: klienci Wi-Fi, radia i obciazenie routera OpenWrt (ubus) + karta/panel."""
from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import CARD_URL, CONF_PANEL_TITLE, CONF_SHOW_PANEL, DOMAIN, VERSION
from .coordinator import OpenWrtWifiConfigEntry, OpenWrtWifiCoordinator

PLATFORMS = [Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
MODULE_URL = f"{CARD_URL}?v={VERSION}"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Udostepnia karte Lovelace `custom:openwrt-wifi-card` (raz, niezaleznie od liczby routerow)."""
    await hass.http.async_register_static_paths([
        StaticPathConfig(CARD_URL, str(Path(__file__).parent / "frontend" / "openwrt-wifi-card.js"), False)
    ])
    frontend.add_extra_js_url(hass, MODULE_URL)
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
