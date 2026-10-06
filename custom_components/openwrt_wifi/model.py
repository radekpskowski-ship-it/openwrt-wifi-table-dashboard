"""Pobranie surowych danych z routera i zbudowanie modelu dashboardu (bez zaleznosci od HA)."""
from __future__ import annotations

import asyncio
import re
from typing import Any

from .api import MikroTikLeases, UbusClient, UbusError
from .const import ICON_COLORS, ICON_RULES, NEW_WINDOW, QUALITY, QUALITY_KEYS, WATCH_GRACE

MAC_RE = re.compile(r"^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$", re.I)


async def collect(client: UbusClient, mikrotik: MikroTikLeases | None, cache: dict) -> dict:
    """Jeden przebieg odpytywania. Metody opcjonalne (brak ACL/pakietu) daja None.

    cache - dane statyczne (system.board, board.json), pobierane raz na wpis.
    """
    if "board" not in cache:
        cache["board"] = await client.call("system", "board")
        cache["boardjson"] = await client.call("luci-rpc", "getBoardJSON", optional=True) or {}
    board = cache["board"]
    info, stat, devices, ifaces, netdevs, leases, hints, arp, wstatus, ndevs = await asyncio.gather(
        client.call("system", "info"),
        client.call("file", "read", {"path": "/proc/stat"}, optional=True),
        client.call("iwinfo", "devices"),
        client.call("network.interface", "dump", optional=True),
        client.call("network.device", "status", optional=True),
        client.call("luci-rpc", "getDHCPLeases", optional=True),
        client.call("luci-rpc", "getHostHints", optional=True),
        client.call("file", "read", {"path": "/proc/net/arp"}, optional=True),
        client.call("network.wireless", "status", optional=True),
        client.call("luci-rpc", "getNetworkDevices", optional=True),
    )
    radios = []
    for dev in devices.get("devices", []):
        rinfo, assoc, survey, freqs = await asyncio.gather(
            client.call("iwinfo", "info", {"device": dev}, optional=True),
            client.call("iwinfo", "assoclist", {"device": dev}, optional=True),
            client.call("iwinfo", "survey", {"device": dev}, optional=True),
            client.call("iwinfo", "freqlist", {"device": dev}, optional=True),
        )
        if rinfo is None or rinfo.get("mode") not in ("Master", "Mesh Point", None):
            continue  # pomijamy interfejsy klienckie/monitor
        radios.append({"dev": dev, "info": rinfo, "assoc": (assoc or {}).get("results", []),
                       "survey": (survey or {}).get("results", []), "freqs": (freqs or {}).get("results", [])})
    switches = {}
    for name in ((cache.get("boardjson") or {}).get("switch") or {}):
        state = await client.call("luci", "getSwconfigPortState", {"switch": name}, optional=True)
        switches[name] = (state or {}).get("result") or []
    mt, mt_error = None, None
    if mikrotik is not None:
        try:
            mt = await mikrotik.leases()
        except UbusError as err:
            mt_error = str(err)
    return {"board": board, "boardjson": cache.get("boardjson") or {}, "wireless": _radio_cfg(wstatus),
            "switches": switches, "ndevs": ndevs or {}, "info": info, "stat": (stat or {}).get("data"), "radios": radios,
            "ifaces": (ifaces or {}).get("interface", []), "netdevs": netdevs or {},
            "leases": (leases or {}).get("dhcp_leases", []), "hints": hints or {},
            "arp": (arp or {}).get("data"), "mikrotik": mt, "mikrotik_error": mt_error}


def _radio_cfg(status: dict | None) -> dict[str, dict]:
    """ifname -> {radio, channel, htmode, band, country} z network.wireless status.

    Celowo kopiujemy tylko te pola: status zawiera tez haslo Wi-Fi (config.key) jawnym tekstem.
    """
    out = {}
    for radio, r in (status or {}).items():
        cfg = r.get("config") or {}
        for iface in r.get("interfaces") or []:
            if iface.get("ifname"):
                out[iface["ifname"]] = {"radio": radio, "channel": str(cfg.get("channel", "auto")),
                                        "htmode": cfg.get("htmode"), "band": cfg.get("band"),
                                        "country": cfg.get("country")}
    return out


def _ports(raw: dict) -> list[dict]:
    """Porty fizyczne: swconfig (starsze targety) albo DSA/netdev (nowsze) + WAN jako netdev."""
    bj, ndevs = raw.get("boardjson") or {}, raw.get("ndevs") or {}
    ports = []
    for sw, cfg in (bj.get("switch") or {}).items():
        state = {p.get("port"): p for p in raw.get("switches", {}).get(sw, [])}
        for p in cfg.get("ports") or []:
            if p.get("device"):  # port CPU
                continue
            st = state.get(p.get("num"), {})
            role = (p.get("role") or "port").upper()
            ports.append({"id": f"{sw}_{p.get('num')}", "label": f"{role}{p.get('index', p.get('num'))}",
                          "link": bool(st.get("link")), "speed": st.get("speed") or None,
                          "duplex": ("full" if st.get("duplex") else "half") if st.get("link") else None,
                          "errors": None})
    netdev_ports = []
    for role, cfg in (bj.get("network") or {}).items():
        if cfg.get("ports"):
            netdev_ports += [(dev, dev.upper()) for dev in cfg["ports"]]
        elif role == "wan" and cfg.get("device") and "." not in cfg["device"]:
            netdev_ports.append((cfg["device"], "WAN"))
    for dev, label in netdev_ports:
        nd = ndevs.get(dev)
        if nd is None:
            continue
        link, stats = nd.get("link") or {}, nd.get("stats") or {}
        speed = link.get("speed")
        ports.append({"id": dev, "label": label, "link": bool(link.get("carrier")),
                      "speed": speed if speed and speed > 0 else None,
                      "duplex": link.get("duplex") if link.get("carrier") and link.get("duplex") != "unknown" else None,
                      "errors": (stats.get("rx_errors") or 0) + (stats.get("tx_errors") or 0)})
    order = {"WAN": 0}
    ports.sort(key=lambda p: (order.get(p["label"][:3], 1), p["label"]))
    return ports


def quality(sig: int | None) -> str:
    if sig is None:
        return "?"
    return next((name for name, limit in QUALITY if sig >= limit), "Zły")


def icon_for(text: str) -> str:
    t = text.lower()
    return next((ico for rx, ico in ICON_RULES if re.search(rx, t)), "mdi:help-network-outline")


def band_of(mhz: int | None) -> str:
    if not mhz:
        return "?"
    return "2,4 GHz" if mhz < 3000 else ("5 GHz" if mhz < 5950 else "6 GHz")


def _delta(cur: float | None, prev: float | None) -> float | None:
    if cur is None or prev is None or cur < prev:
        return None
    return cur - prev


def _parse_arp(text: str | None) -> dict[str, str]:
    out = {}
    for line in (text or "").splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 4 and parts[3] != "00:00:00:00:00:00":
            out[parts[3].lower()] = parts[0]
    return out


def _cpu_ticks(stat: str | None) -> tuple[int, int] | None:
    """(busy, total) z pierwszej linii /proc/stat."""
    if not stat:
        return None
    fields = [int(x) for x in stat.splitlines()[0].split()[1:]]
    idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
    return sum(fields) - idle, sum(fields)


def _is_random_mac(mac: str) -> bool:
    return len(mac) > 1 and mac[1] in "26ae"


def build(raw: dict, prev: dict, seen: dict, ha_names: dict, watch: list, now: float,
          custom_names: dict | None = None) -> tuple[dict, dict, list]:
    """Zwraca (dane dla encji/karty, stan do nastepnego przebiegu, nowo wykryte MAC-i).

    prev  - liczniki z poprzedniego przebiegu (CPU, bajty, retries) do liczenia predkosci
    seen  - trwaly stan {"first": {mac: ts}, "last": {mac: ts}, "baseline": bool}
    ha_names - MAC -> (nazwa, obszar) z rejestru urzadzen HA
    custom_names - MAC -> nazwa wpisana recznie w dashboardzie (najwyzszy priorytet)
    watch - [(mac, nazwa, obszar)] urzadzen HA z etykieta "krytyczne"
    """
    dt = now - prev["ts"] if prev.get("ts") else None
    state: dict[str, Any] = {"ts": now, "clients": {}, "survey": {}, "netdev": {}}

    # --- router ---
    info = raw["info"] or {}
    mem = info.get("memory") or {}
    cpu = None
    ticks = _cpu_ticks(raw.get("stat"))
    if ticks:
        state["cpu"] = ticks
        if prev.get("cpu") and ticks[1] > prev["cpu"][1]:
            cpu = round(100 * (ticks[0] - prev["cpu"][0]) / (ticks[1] - prev["cpu"][1]), 1)
    total, avail = mem.get("total"), mem.get("available", mem.get("free"))
    load = [round(x / 65536, 2) for x in info.get("load", [])]

    def iface_dev(name: str) -> str | None:
        for i in raw["ifaces"]:
            if i.get("interface") == name and i.get("up"):
                return i.get("l3_device") or i.get("device")
        return None

    traffic = {}
    for role in ("lan", "wan"):
        dev = iface_dev(role)
        stats = (raw["netdevs"].get(dev) or {}).get("statistics") if dev else None
        if not stats:
            continue
        rx, tx = stats.get("rx_bytes"), stats.get("tx_bytes")
        state["netdev"][role] = (rx, tx)
        p = (prev.get("netdev") or {}).get(role)
        drx = _delta(rx, p[0]) if p else None
        dtx = _delta(tx, p[1]) if p else None
        traffic[role] = {
            "dev": dev,
            "rx": round(drx * 8 / dt / 1e6, 2) if drx is not None and dt else None,
            "tx": round(dtx * 8 / dt / 1e6, 2) if dtx is not None and dt else None,
        }

    board = raw["board"] or {}
    rel = board.get("release") or {}
    uptime = info.get("uptime")
    router = {
        "hostname": board.get("hostname"), "model": board.get("model"), "system": board.get("system"),
        "firmware": rel.get("description") or rel.get("version"), "kernel": board.get("kernel"),
        "uptime": uptime, "cpu": cpu, "load": load,
        "mem_pct": round(100 * (total - avail) / total, 1) if total and avail is not None else None,
        "mem_total_mb": round(total / 1048576) if total else None,
        "lan_rx": (traffic.get("lan") or {}).get("rx"), "lan_tx": (traffic.get("lan") or {}).get("tx"),
        "wan_rx": (traffic.get("wan") or {}).get("rx"), "wan_tx": (traffic.get("wan") or {}).get("tx"),
        "has_wan": "wan" in traffic,
    }

    # --- nazwy i IP ---
    arp = _parse_arp(raw.get("arp"))
    lease_by_mac = {}
    for lease in raw.get("leases") or []:
        mac = (lease.get("macaddr") or "").lower()
        if mac:
            lease_by_mac[mac] = {"ip": lease.get("ipaddr"), "host": lease.get("hostname"), "comment": None}
    for mac, h in (raw.get("hints") or {}).items():
        ips = h.get("ipaddrs") or []
        entry = lease_by_mac.setdefault(mac.lower(), {"ip": None, "host": None, "comment": None})
        entry["ip"] = entry["ip"] or (ips[0] if ips else None)
        entry["host"] = entry["host"] or h.get("name")
    for mac, m in (raw.get("mikrotik") or {}).items():
        entry = lease_by_mac.setdefault(mac, {"ip": None, "host": None, "comment": None})
        entry["ip"] = m.get("ip") or entry["ip"]
        entry["host"] = m.get("host") or entry["host"]
        entry["comment"] = m.get("comment") or entry["comment"]

    # --- radia i klienci ---
    radios, clients, new_macs = [], [], []
    first, last = seen.setdefault("first", {}), seen.setdefault("last", {})
    baseline = not seen.get("baseline")
    for r in raw["radios"]:
        ri = r["info"]
        freq = ri.get("frequency")
        util = None
        cur = next((s for s in r["survey"] if s.get("mhz") == freq), None)
        if cur:
            state["survey"][r["dev"]] = (cur.get("busy_time"), cur.get("active_time"))
            p = (prev.get("survey") or {}).get(r["dev"])
            if p:
                db, da = _delta(cur.get("busy_time"), p[0]), _delta(cur.get("active_time"), p[1])
                if db is not None and da:
                    util = round(min(100, 100 * db / da), 1)
        r_pk = r_rt = 0
        for a in r["assoc"]:
            mac = (a.get("mac") or "").lower()
            tx, rx = a.get("tx") or {}, a.get("rx") or {}
            counters = (tx.get("packets"), tx.get("retries"), tx.get("failed"), tx.get("bytes"), rx.get("bytes"))
            state["clients"][mac] = counters
            p = (prev.get("clients") or {}).get(mac)
            dpk = _delta(counters[0], p[0]) if p else None
            drt = _delta(counters[1], p[1]) if p else None
            if dpk is None or drt is None:  # pierwszy pomiar / reconnect -> wartosc narastajaca
                dpk, drt = counters[0] or 0, counters[1] or 0
            r_pk += dpk
            r_rt += drt
            retry = round(100 * drt / (dpk + drt), 1) if (dpk + drt) else 0.0
            dtxb = _delta(counters[3], p[3]) if p else None
            drxb = _delta(counters[4], p[4]) if p else None

            lease = lease_by_mac.get(mac, {})
            ha_name, area = ha_names.get(mac, (None, None))
            host = lease.get("host")
            manual = (custom_names or {}).get(mac)
            auto_name = ha_name or lease.get("comment") or host or mac
            sig = a.get("signal")
            ico = icon_for(" ".join(str(x) for x in (manual, ha_name, lease.get("comment"), host) if x))
            if mac not in first:
                first[mac] = 0 if baseline else now
                if not baseline:
                    new_macs.append(mac)
            last[mac] = now
            clients.append({
                "name": manual or auto_name, "auto_name": auto_name, "custom": manual is not None,
                "host": host, "in_ha": ha_name is not None, "area": area,
                "icon": ico, "color": ICON_COLORS.get(ico, "#9aa0a6"),
                "mac": mac, "random_mac": _is_random_mac(mac),
                "ip": lease.get("ip") or arp.get(mac),
                "radio": r["dev"], "ssid": ri.get("ssid"), "band": band_of(freq), "ch": ri.get("channel"),
                "signal": sig, "signal_avg": a.get("signal_avg"), "noise": a.get("noise"),
                "snr": sig - a["noise"] if sig is not None and a.get("noise") else None,
                "q": quality(sig), "retry": retry, "failed": tx.get("failed"),
                "tx": round((tx.get("rate") or 0) / 1000, 1), "rx": round((rx.get("rate") or 0) / 1000, 1),
                "mcs": tx.get("mcs"), "mhz": tx.get("mhz") or rx.get("mhz"),
                # z perspektywy klienta: AP tx = pobieranie klienta
                "down_kbps": round(dtxb * 8 / dt / 1000, 1) if dtxb is not None and dt else None,
                "up_kbps": round(drxb * 8 / dt / 1000, 1) if drxb is not None and dt else None,
                "inactive": round((a.get("inactive") or 0) / 1000),
                "up": a.get("connected_time"),
                "first_seen": first[mac] or None,
            })
        wcfg = (raw.get("wireless") or {}).get(r["dev"], {})
        radios.append({
            "radio": r["dev"], "uci_radio": wcfg.get("radio"), "channel_cfg": wcfg.get("channel"),
            "htmode_cfg": wcfg.get("htmode"), "country": wcfg.get("country") or ri.get("country"),
            "channels": [f["channel"] for f in r.get("freqs", []) if not f.get("restricted")],
            "ssid": ri.get("ssid"), "bssid": (ri.get("bssid") or "").lower(),
            "band": band_of(freq), "ch": ri.get("channel"), "htmode": ri.get("htmode"),
            "power": ri.get("txpower"), "noise": ri.get("noise"), "util": util,
            "retry": round(100 * r_rt / (r_pk + r_rt), 1) if (r_pk + r_rt) else 0.0,
            "clients": len(r["assoc"]), "hw": (ri.get("hardware") or {}).get("name"),
            "encryption": "/".join((ri.get("encryption") or {}).get("authentication") or []) or None,
        })
    seen["baseline"] = True
    clients.sort(key=lambda c: c["signal"] if c["signal"] is not None else -999, reverse=True)

    online = {c["mac"] for c in clients}
    new = [c for c in clients if c["first_seen"] and c["first_seen"] > now - NEW_WINDOW]
    # urzadzenia z etykieta: tylko te, ktore kiedykolwiek byly na tym routerze
    watch_out = []
    for mac, wname, warea in watch:
        if mac not in first:
            continue
        ok = mac in online or now - last.get(mac, 0) < WATCH_GRACE
        watch_out.append({"name": wname, "area": warea, "mac": mac, "online": ok, "last_seen": last.get(mac)})
    data = {
        "router": router, "radios": radios, "ports": _ports(raw), "clients": clients, "count": len(clients),
        "counts": {k: sum(1 for c in clients if c["q"] == k) for k in QUALITY_KEYS},
        "new": new, "new_macs": sorted(c["mac"] for c in new),
        "watch": watch_out, "missing_macs": sorted(w["mac"] for w in watch_out if not w["online"]),
        "mikrotik_error": raw.get("mikrotik_error"), "updated": int(now),
    }
    return data, state, new_macs
