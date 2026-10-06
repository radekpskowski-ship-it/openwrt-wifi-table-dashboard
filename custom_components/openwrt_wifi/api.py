"""Klienci HTTP: ubus (OpenWrt, JSON-RPC przez uhttpd) i REST MikroTika (dzierzawy DHCP).

Bez zaleznosci od Home Assistanta - mozna testowac samodzielnie z aiohttp.
"""
from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

NULL_SESSION = "0" * 32
UBUS_ACCESS_DENIED = -32002  # wygasla / niewazna sesja
TIMEOUT = aiohttp.ClientTimeout(total=15)


class UbusError(Exception):
    """Blad komunikacji z routerem."""


class UbusAuthError(UbusError):
    """Router odrzucil login."""


class UbusClient:
    """Minimalny klient ubus: login + call, z ponownym logowaniem po wygasnieciu sesji."""

    def __init__(self, session: aiohttp.ClientSession, host: str, port: int, username: str,
                 password: str, use_ssl: bool = False, verify_ssl: bool = False) -> None:
        self._http = session
        self._url = f"{'https' if use_ssl else 'http'}://{host}:{port}/ubus"
        self._username = username
        self._password = password or ""
        self._ssl = None if (use_ssl and verify_ssl) else False
        self._sid: str | None = None
        self._lock = asyncio.Lock()
        self._id = 0

    async def _rpc(self, sid: str, obj: str, method: str, args: dict | None) -> dict:
        self._id += 1
        body = {"jsonrpc": "2.0", "id": self._id, "method": "call", "params": [sid, obj, method, args or {}]}
        try:
            async with self._http.post(self._url, json=body, ssl=self._ssl, timeout=TIMEOUT) as resp:
                if resp.status in (401, 403):
                    raise UbusAuthError(f"HTTP {resp.status}")
                resp.raise_for_status()
                return await resp.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise UbusError(f"{self._url}: {err!r}") from err

    async def login(self) -> None:
        data = await self._rpc(NULL_SESSION, "session", "login",
                               {"username": self._username, "password": self._password})
        result = data.get("result") or []
        if "error" in data or not result or result[0] != 0:
            raise UbusAuthError(f"login odrzucony: {data.get('error') or result}")
        self._sid = result[1]["ubus_rpc_session"]

    async def call(self, obj: str, method: str, args: dict | None = None, *, optional: bool = False) -> Any:
        """Wywolanie ubus. optional=True: blad metody (brak/brak uprawnien) -> None zamiast wyjatku."""
        for attempt in (0, 1):
            async with self._lock:
                if self._sid is None:
                    await self.login()
                sid = self._sid
            data = await self._rpc(sid, obj, method, args)
            err = data.get("error")
            if err and err.get("code") == UBUS_ACCESS_DENIED and attempt == 0:
                # sesja wygasla (np. restart rpcd) - zaloguj sie ponownie
                async with self._lock:
                    if self._sid == sid:
                        self._sid = None
                continue
            if err:
                if optional:
                    return None
                raise UbusError(f"{obj}.{method}: {err}")
            result = data.get("result") or [None]
            if result[0] != 0:
                if optional:
                    return None
                raise UbusError(f"{obj}.{method}: kod {result[0]}")
            return result[1] if len(result) > 1 else {}
        raise UbusAuthError(f"{obj}.{method}: brak dostepu po ponownym logowaniu")


class MikroTikLeases:
    """Dzierzawy DHCP z RouterOS 7 REST: MAC -> {ip, host, comment}."""

    def __init__(self, session: aiohttp.ClientSession, host: str, username: str, password: str,
                 use_ssl: bool = False) -> None:
        self._http = session
        self._base = f"{'https' if use_ssl else 'http'}://{host}/rest"
        self._auth = aiohttp.BasicAuth(username, password or "")

    async def _get(self, path: str) -> list[dict]:
        try:
            async with self._http.get(self._base + path, auth=self._auth, ssl=False, timeout=TIMEOUT) as resp:
                if resp.status in (401, 403):
                    raise UbusAuthError(f"MikroTik HTTP {resp.status}")
                resp.raise_for_status()
                return await resp.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise UbusError(f"MikroTik {self._base}: {err!r}") from err

    async def leases(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for lease in await self._get("/ip/dhcp-server/lease"):
            mac = (lease.get("mac-address") or "").lower()
            if mac:
                out[mac] = {"ip": lease.get("active-address") or lease.get("address"),
                            "host": lease.get("host-name"), "comment": lease.get("comment")}
        try:
            for arp in await self._get("/ip/arp"):
                mac = (arp.get("mac-address") or "").lower()
                if mac and arp.get("address"):
                    out.setdefault(mac, {"ip": None, "host": None, "comment": arp.get("comment")})
                    out[mac]["ip"] = out[mac]["ip"] or arp["address"]
        except UbusError:
            pass
        return out
