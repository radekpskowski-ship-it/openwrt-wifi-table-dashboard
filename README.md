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
- **Nazwy klientów** (w tej kolejności): urządzenie z HA dopasowane po MAC (z obszarem) →
  komentarz/hostname z DHCP (OpenWrt lub **MikroTik REST**) → MAC.
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
# sections: [router, alerts, radios, clients]
```

Najlepiej wygląda w widoku typu **Panel (pojedyncza karta)**.

## Encje

- `Klienci Wi-Fi` — liczba klientów; komplet danych dla karty w atrybutach (wyłączonych z recordera).
- Router: CPU, Load 1m, Pamięć, LAN RX/TX, WAN RX/TX (jeśli jest WAN), Ostatni start, Firmware.
- Per radio: klienci, zajętość kanału, szum, TX retries.
- Opcjonalnie: `Sygnał <klient>` dla każdego klienta (dodawane dynamicznie).

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
