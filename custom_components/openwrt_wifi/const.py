"""Stale integracji OpenWrt Wi-Fi Dashboard."""

DOMAIN = "openwrt_wifi"
VERSION = "1.1.0"

CONF_SSL = "ssl"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_SHOW_PANEL = "show_panel"
CONF_PANEL_TITLE = "panel_title"
CONF_CLIENT_SENSORS = "client_sensors"
CONF_WATCH_LABEL = "watch_label"
CONF_MT_HOST = "mikrotik_host"
CONF_MT_USERNAME = "mikrotik_username"
CONF_MT_PASSWORD = "mikrotik_password"
CONF_MT_SSL = "mikrotik_ssl"

DEFAULT_PORT = 80
DEFAULT_USERNAME = "root"
DEFAULT_SCAN_INTERVAL = 30
DEFAULT_WATCH_LABEL = "wifi-krytyczne"

CARD_URL = f"/{DOMAIN}/openwrt-wifi-card.js"
EVENT_NEW_CLIENT = f"{DOMAIN}_new_client"

NEW_WINDOW = 86400  # "nowy" klient = pierwszy raz widziany w ciagu doby
WATCH_GRACE = 300  # s bez polaczenia, zanim urzadzenie z etykieta uznamy za brakujace

QUALITY = (("Bardzo dobry", -55), ("Dobry", -67), ("Słaby", -75))
QUALITY_KEYS = ("Bardzo dobry", "Dobry", "Słaby", "Zły")

# integracje-trackery tylko powielaja hostname, nie sa "prawdziwa" nazwa urzadzenia
TRACKER_DOMAINS = {
    DOMAIN, "unifi", "unifi_network_plus", "openwrt_ubus", "luci", "asusrouter",
    "mikrotik", "mikrotik_router", "nmap_tracker", "ping",
}

# ikona typu urzadzenia: pierwsza regula pasujaca do nazwy/hostname (male litery)
ICON_RULES = [
    (r"klima|tcl|gaoshengda|rotenso|air ?con", "mdi:air-conditioner"),
    (r"proxmox|server|serwer|nas\b", "mdi:server"),
    (r"nspanel|cyd|dashboard", "mdi:tablet-dashboard"),
    (r"zigbee|slzb|zbbridge", "mdi:zigbee"),
    (r"nest|echo|głośnik|glosnik|speaker|sonos", "mdi:speaker"),
    (r"webos|android ?tv|fire ?tv|\btv\b|chromecast|bravia", "mdi:television"),
    (r"thingino|kamera|camera|cam\b|c310|chuangmi|ipc|hikvision|dahua|tapo_c", "mdi:cctv"),
    (r"roborock|robot|vacuum|odkurz|dreame|xiaomi_v", "mdi:robot-vacuum"),
    (r"iphone|pixel|galaxy|phone|telefon|sm-|nokia|redmi|oneplus", "mdi:cellphone"),
    (r"ipad|tablet", "mdi:tablet"),
    (r"laptop|dell|lenovo|thinkpad|macbook|desktop-|\bpc\b", "mdi:laptop"),
    (r"wled|led", "mdi:led-strip-variant"),
    (r"światło|swiatlo|lamp|bulb|żarów", "mdi:lightbulb"),
    (r"tapo|plug|gniazd|listwa|shelly", "mdi:power-socket-eu"),
    (r"openwrt|mikrotik|router|\bap\b", "mdi:router-wireless"),
    (r"espressif|esp_|esp32|esp8266|lwip|wlan0", "mdi:chip"),
]
# stonowane kolory ikon (czytelne w jasnym i ciemnym motywie)
ICON_COLORS = {
    "mdi:air-conditioner": "#4fa3d9", "mdi:server": "#8a8fd6", "mdi:laptop": "#8a8fd6",
    "mdi:speaker": "#c77dba", "mdi:television": "#c77dba",
    "mdi:tablet-dashboard": "#3fb8a8", "mdi:tablet": "#3fb8a8",
    "mdi:zigbee": "#e0a33a", "mdi:cctv": "#d9705f",
    "mdi:led-strip-variant": "#e6b422", "mdi:lightbulb": "#e6b422",
    "mdi:power-socket-eu": "#6cb86a", "mdi:cellphone": "#5c9bd6",
    "mdi:robot-vacuum": "#a08566", "mdi:router-wireless": "#3fb8a8", "mdi:chip": "#9aa0a6",
}
