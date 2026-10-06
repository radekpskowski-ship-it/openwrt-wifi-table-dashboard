# OpenWrt Wi-Fi Dashboard

Integracja Home Assistant, która z routera/AP **OpenWrt** (przez `ubus`) buduje dashboard Wi-Fi:
klienci z siłą sygnału, radia, obciążenie routera — bez ręcznej edycji dashboardu.

*English: Home Assistant integration that turns an OpenWrt router/AP (via `ubus`) into a live Wi-Fi dashboard —
clients with signal quality, radios and router load. A sidebar panel and a Lovelace card are created automatically.*

## Co daje

- **Panel w pasku bocznym** tworzony automatycznie dla każdego routera (można wyłączyć w opcjach).
- **Karta Lovelace** `custom:openwrt-wifi-card` do wstawienia w dowolny dashboard.
- **Router:** CPU %, load, RAM, ruch LAN/WAN, uptime, firmware.
- **Radia:** SSID, pasmo, kanał/HT, moc, szum, zajętość kanału, TX retries, liczba klientów.
- **Klienci:** sygnał (bieżący i średni), SNR, jakość, retry %, prędkość TX/RX, MCS, bieżący transfer,
  czas bezczynności i połączenia. Ikona typu urządzenia, sortowanie po kliknięciu nagłówka.
- **Nazwy klientów** (w tej kolejności): **nazwa wpisana ręcznie w dashboardzie** → urządzenie z HA
  dopasowane po MAC (z obszarem) → komentarz/hostname z DHCP (OpenWrt lub **MikroTik REST**) → MAC.
- **Edycja nazw w dashboardzie:** ołówek przy nazwie → wpisz → Enter (✓). ↺ przywraca nazwę automatyczną,
  Esc anuluje. Nazwy zapisywane trwale w HA (przetrwają restart).
- **Porty:** LAN/WAN z etykietami z `board.json` — link, prędkość, duplex (swconfig i DSA); encje `Port LANx`.
- **Sterowanie** (tylko administratorzy, z potwierdzeniem w karcie): wybór kanału radia (zapis trwały w
  `/etc/config/wireless`), restart Wi-Fi, restart routera, rozłączenie klienta. Ostrzeżenie, gdy radio działa
  w innym trybie niż ustawiony (np. HT40 → HT20).
- **Alerty:** nowe urządzenie (24 h) i zdarzenie `openwrt_wifi_new_client`; brak w sieci urządzeń HA
  z etykietą `wifi-krytyczne`.
- Wszystko **dynamiczne** — nowi klienci i zmiany nazw pojawiają się przy następnym odczycie.

## Instalacja (HACS)

1. HACS → menu ⋮ → **Niestandardowe repozytoria** → URL tego repo, typ **Integracja**.
2. Wyszukaj **OpenWrt Wi-Fi Dashboard** → Pobierz → zrestartuj Home Assistant.
3. Ustawienia → Urządzenia i usługi → **Dodaj integrację** → *OpenWrt Wi-Fi Dashboard*.

Ręcznie: skopiuj `custom_components/openwrt_wifi` do `/config/custom_components/` i zrestartuj HA.

## Wymagania po stronie OpenWrt

- `uhttpd` z `uhttpd-mod-ubus` oraz `rpcd` (standardowo instalowane z LuCI), endpoint `http://<router>/ubus`.
- Konto `root` ma pełny dostęp. Dla konta z ograniczonymi uprawnieniami potrzebne ACL rpcd do:
  `system.board/info`, `iwinfo.devices/info/assoclist/survey`, `network.interface.dump`,
  `network.device.status`, `luci-rpc.getDHCPLeases/getHostHints`, `file.read` (`/proc/stat`, `/proc/net/arp`).
- Działa z dumb AP (bez DHCP) — wtedy nazwy/IP warto brać z routera DHCP (opcja MikroTik).

## Konfiguracja

| Pole | Opis |
|---|---|
| Host / port | adres routera OpenWrt (domyślnie port 80) |
| Użytkownik / hasło | login ubus (`root`; puste hasło, jeśli root go nie ma) |
| HTTPS / weryfikacja certyfikatu | dla uhttpd z TLS |

Opcje (*Konfiguruj*): interwał odświeżania, panel w pasku bocznym i jego tytuł, sensor sygnału per klient,
etykieta ważnych urządzeń, **MikroTik z DHCP** (adres, użytkownik, hasło, HTTPS — RouterOS 7 REST,
odczyt `/ip/dhcp-server/lease` i `/ip/arp`).

## Karta Lovelace

```yaml
type: custom:openwrt-wifi-card
entity: sensor.<nazwa>_klienci_wi_fi   # opcjonalnie; bez tego karta znajdzie sensor sama
# entry_id: <id wpisu>                  # alternatywnie wybór routera po wpisie
# title: Wi-Fi                          # własny tytuł
# sections: [router, alerts, ports, radios, controls, clients]
# editable: false                      # ukryj ołówek edycji nazw
# controls: false                      # ukryj sterowanie (kanał, restarty, rozłączanie)
```

Najlepiej wygląda w widoku typu **Panel (pojedyncza karta)**.

## Encje

- `Klienci Wi-Fi` — liczba klientów; komplet danych dla karty w atrybutach (wyłączonych z recordera).
- Router: CPU, Load 1m, Pamięć, LAN RX/TX, WAN RX/TX (jeśli jest WAN), Ostatni start, Firmware.
- Per radio: klienci, zajętość kanału, szum, TX retries.
- Opcjonalnie: `Sygnał <klient>` dla każdego klienta (dodawane dynamicznie).

## Usługa `openwrt_wifi.set_client_name`

Ustawia ręczną nazwę klienta (to samo, co ołówek w dashboardzie). Pusta nazwa = powrót do automatycznej.

```yaml
action: openwrt_wifi.set_client_name
data:
  mac: "24:9e:7d:d6:c5:be"
  name: Odkurzacz
  # entry_id: <id wpisu>   # opcjonalnie; bez tego dla wszystkich routerów
```

W karcie edycję można wyłączyć opcją `editable: false`.

## Usługi sterujące

| Usługa | Dane |
|---|---|
| `openwrt_wifi.kick_client` | `mac`, opcjonalnie `ban_seconds` (blokada ponownego połączenia) |
| `openwrt_wifi.restart_wifi` | — |
| `openwrt_wifi.reboot` | — |
| `openwrt_wifi.set_channel` | `radio` (`wlan0` / `radio0`), `channel` (numer albo `auto`) |

Przy kilku routerach podaj `entry_id`. Te same akcje są dostępne jako encje: przyciski *Restart Wi-Fi*,
*Restart routera* i lista wyboru *kanał* (kategoria Konfiguracja). Sekcję sterowania w karcie ukrywa `controls: false`.

Wymagane uprawnienia ubus (konto inne niż root): `hostapd.*.del_client`, `network.wireless.down/up`,
`network.reload`, `uci.set/commit` (config `wireless`), `system.reboot`, `luci.getSwconfigPortState`,
`luci-rpc.getBoardJSON/getNetworkDevices`, `network.wireless.status`. Integracja nie zapisuje w HA haseł Wi-Fi,
które OpenWrt zwraca w `network.wireless status`.

## Automatyzacja: powiadomienie o nowym urządzeniu

```yaml
triggers:
  - trigger: event
    event_type: openwrt_wifi_new_client
actions:
  - action: notify.notify
    data:
      title: "Nowe urządzenie Wi-Fi ({{ trigger.event.data.router }})"
      message: >-
        {{ trigger.event.data.name }} – {{ trigger.event.data.ip or trigger.event.data.mac }},
        {{ trigger.event.data.signal }} dBm
```

Pierwszy odczyt po dodaniu routera jest bazowy — obecni klienci nie są zgłaszani jako nowi.
