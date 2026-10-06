/* OpenWrt Wi-Fi Dashboard: karta Lovelace `custom:openwrt-wifi-card` + panel `openwrt-wifi-panel`.
 * Wszystko rysowane z atrybutow sensora "Klienci Wi-Fi" integracji openwrt_wifi - nowi klienci
 * i radia pojawiaja sie sami, bez edycji dashboardu. */
const VERSION = "1.0.0";
const QUALITY = { "Bardzo dobry": "#4caf50", "Dobry": "#ffc107", "Słaby": "#ff9800", "Zły": "#f44336" };

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 0) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "–" : Number(v).toFixed(d));
const dur = (s) => {
  s = Number(s) || 0;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const rate = (kbps) => (kbps === null || kbps === undefined ? "–" : kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mb/s` : `${Math.round(kbps)} kb/s`);
const sigLevel = (s) => (s >= -55 ? 4 : s >= -67 ? 3 : s >= -75 ? 2 : 1);
const tone = (v, warn, bad) => (v === null || v === undefined ? "" : v >= bad ? "bad" : v >= warn ? "warn" : "ok");
const fmtTs = (ts) => (ts ? new Date(ts * 1000).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");

function findEntity(hass, { entity, entry_id } = {}) {
  if (entity && hass.states[entity]) return entity;
  return Object.keys(hass.states).find((id) => {
    const a = hass.states[id].attributes;
    return id.startsWith("sensor.") && a.integration === "openwrt_wifi" && Array.isArray(a.clients) && (!entry_id || a.entry_id === entry_id);
  });
}

const STYLE = `
  :host { display: block; }
  ha-card { padding: 16px; }
  .head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .head ha-icon { --mdc-icon-size: 34px; color: var(--primary-color); }
  .title { font-size: 1.35em; font-weight: 500; }
  .sub { color: var(--secondary-text-color); font-size: .85em; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; margin-bottom: 12px; }
  .tile { background: var(--secondary-background-color); border-radius: 10px; padding: 8px 10px; }
  .tile .k { color: var(--secondary-text-color); font-size: .75em; text-transform: uppercase; letter-spacing: .04em; }
  .tile .v { font-size: 1.25em; font-weight: 500; margin-top: 2px; white-space: nowrap; }
  .tile .v small { font-size: .65em; color: var(--secondary-text-color); font-weight: 400; }
  .ok { color: var(--success-color, #4caf50); } .warn { color: var(--warning-color, #ff9800); } .bad { color: var(--error-color, #f44336); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 12px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: .85em;
          background: var(--secondary-background-color); }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
  h3 { font-size: 1em; font-weight: 500; margin: 16px 0 6px; display: flex; align-items: center; gap: 6px; }
  .alert { border-left: 4px solid var(--warning-color, #ff9800); background: var(--secondary-background-color);
           border-radius: 6px; padding: 8px 12px; margin: 6px 0; font-size: .9em; }
  .alert.bad { border-color: var(--error-color, #f44336); color: inherit; }
  .alert.info { border-color: var(--info-color, #039be5); }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .9em; }
  th { text-align: left; font-weight: 500; color: var(--secondary-text-color); font-size: .8em; padding: 6px;
       border-bottom: 1px solid var(--divider-color); white-space: nowrap; cursor: pointer; user-select: none; }
  th.c, td.c { text-align: center; }
  td { padding: 6px; border-bottom: 1px solid var(--divider-color); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  td small, .muted { color: var(--secondary-text-color); font-size: .8em; }
  .name { display: flex; align-items: center; gap: 8px; }
  .name ha-icon { --mdc-icon-size: 22px; flex: none; }
  .name b { font-weight: 500; }
  .sig { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .sig ha-icon { --mdc-icon-size: 18px; }
  .bar { height: 4px; border-radius: 2px; background: var(--divider-color); margin-top: 3px; min-width: 50px; }
  .bar i { display: block; height: 100%; border-radius: 2px; }
  .foot { margin-top: 10px; color: var(--secondary-text-color); font-size: .75em; }
  .empty { padding: 16px; text-align: center; color: var(--secondary-text-color); }
  @media (max-width: 640px) { .opt { display: none; } ha-card { padding: 12px; } }
`;

class OpenWrtWifiCard extends HTMLElement {
  static getStubConfig(hass) { return { entity: findEntity(hass) || "" }; }

  setConfig(config) {
    this._config = { sort: "signal", ...config };
    this._sort = this._config.sort;
    this._key = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const id = findEntity(hass, this._config || {});
    const st = id ? hass.states[id] : null;
    const key = st ? `${id}|${st.last_updated}|${st.attributes.updated}` : "none";
    if (key !== this._key) { this._key = key; this._render(); }
  }

  getCardSize() { return 10; }
  getGridOptions() { return { columns: "full", min_columns: 6 }; }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => {
        const th = ev.composedPath().find((el) => el.dataset && el.dataset.sort);
        if (th) { this._sort = th.dataset.sort === this._sort ? `-${this._sort}` : th.dataset.sort; this._key = null; this._render(); }
      });
    }
    const id = findEntity(this._hass, this._config);
    const st = id && this._hass.states[id];
    if (!st) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="empty">Nie znaleziono sensora integracji <b>OpenWrt Wi-Fi Dashboard</b>${this._config.entity ? ` (${esc(this._config.entity)})` : ""}.</div></ha-card>`;
      return;
    }
    if (st.state === "unavailable" || !Array.isArray(st.attributes.clients)) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="empty"><ha-icon icon="mdi:router-wireless-off"></ha-icon><br>Router niedostępny (${esc(st.attributes.friendly_name || id)}).</div></ha-card>`;
      return;
    }
    const a = st.attributes;
    const show = new Set(this._config.sections || ["router", "alerts", "radios", "clients"]);
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>
      ${show.has("router") ? this._router(a) : ""}
      ${show.has("alerts") ? this._alerts(a) : ""}
      ${show.has("radios") ? this._radios(a) : ""}
      ${show.has("clients") ? this._clients(a) : ""}
      <div class="foot">Sygnał: <span class="ok">≥ -55</span> · <span style="color:#ffc107">-56…-67</span> · <span class="warn">-68…-75</span> · <span class="bad">&lt; -75 dBm</span>
        · Retry = % retransmisji TX od ostatniego odczytu · ❔ = brak urządzenia w HA ·
        odświeżono ${Math.max(0, Math.round(Date.now() / 1000 - (a.updated || 0)))} s temu · v${VERSION}</div>
    </ha-card>`;
  }

  _router(a) {
    const r = a.router || {};
    const tiles = [
      ["Klienci", `${a.clients.length}`],
      ["CPU", `<span class="${tone(r.cpu, 60, 85)}">${num(r.cpu)}</span><small> %</small>`],
      ["Load", `${num((r.load || [])[0], 2)}<small> ${num((r.load || [])[1], 2)} ${num((r.load || [])[2], 2)}</small>`],
      ["RAM", `<span class="${tone(r.mem_pct, 75, 90)}">${num(r.mem_pct)}</span><small> % z ${num(r.mem_total_mb)} MB</small>`],
      ["LAN ↓ / ↑", `${num(r.lan_rx, 1)}<small> / ${num(r.lan_tx, 1)} Mb/s</small>`],
    ];
    if (r.has_wan) tiles.push(["WAN ↓ / ↑", `${num(r.wan_rx, 1)}<small> / ${num(r.wan_tx, 1)} Mb/s</small>`]);
    tiles.push(["Uptime", dur(r.uptime)]);
    const c = a.counts || {};
    return `<div class="head"><ha-icon icon="mdi:router-wireless"></ha-icon><div>
        <div class="title">${esc(this._config.title || a.title || r.hostname)}</div>
        <div class="sub">${esc(r.model || "")}${r.firmware ? " · " + esc(r.firmware) : ""}</div></div></div>
      <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
      <div class="chips">${Object.entries(QUALITY).map(([q, col]) => `<span class="chip"><span class="dot" style="background:${col}"></span>${q}: <b>${c[q] ?? 0}</b></span>`).join("")}</div>`;
  }

  _alerts(a) {
    const out = [];
    if (a.mikrotik_error) out.push(`<div class="alert bad">⚠️ Nazwy z MikroTika niedostępne: ${esc(a.mikrotik_error)}</div>`);
    for (const w of (a.watch || []).filter((w) => !w.online))
      out.push(`<div class="alert bad">🔴 <b>${esc(w.name)}</b>${w.area ? " · " + esc(w.area) : ""} – brak w sieci, ostatnio ${fmtTs(w.last_seen)}</div>`);
    for (const n of a.new || [])
      out.push(`<div class="alert info">🆕 <b>${esc(n.name)}</b> – ${esc(n.ip || n.mac)} · ${num(n.signal)} dBm · od ${fmtTs(n.first_seen)}</div>`);
    return out.length ? `<h3><ha-icon icon="mdi:bell-outline"></ha-icon>Alerty</h3>${out.join("")}` : "";
  }

  _radios(a) {
    const rows = (a.radios || []).map((r) => `<tr>
      <td><b>${esc(r.ssid || r.radio)}</b><br><small>${esc(r.radio)} · ${esc(r.hw || "")}</small></td>
      <td class="c">${esc(r.band)}</td>
      <td class="c">${esc(r.ch)}<br><small>${esc(r.htmode || "")}</small></td>
      <td class="c opt">${num(r.power)} dBm</td>
      <td class="c opt">${num(r.noise)} dBm</td>
      <td class="c"><span class="${tone(r.util, 50, 75)}">${num(r.util)} %</span><div class="bar"><i style="width:${Math.min(100, r.util || 0)}%;background:var(--primary-color)"></i></div></td>
      <td class="c"><span class="${tone(r.retry, 10, 20)}">${num(r.retry, 1)} %</span></td>
      <td class="c">${r.clients}</td></tr>`).join("");
    return `<h3><ha-icon icon="mdi:access-point"></ha-icon>Radia</h3><div class="scroll"><table>
      <tr><th>SSID / radio</th><th class="c">Pasmo</th><th class="c">Kanał</th><th class="c opt">Moc</th><th class="c opt">Szum</th>
      <th class="c">Zajętość</th><th class="c">TX retry</th><th class="c">Klienci</th></tr>${rows}</table></div>`;
  }

  _clients(a) {
    const key = this._sort.replace(/^-/, ""), dir = this._sort.startsWith("-") ? -1 : 1;
    const val = (c) => (key === "name" ? String(c.name).toLowerCase() : key === "ip" ? (c.ip || "").split(".").map((x) => x.padStart(3, "0")).join(".") : c[key] ?? -9999);
    const list = [...a.clients].sort((x, y) => {
      const vx = val(x), vy = val(y);
      const cmp = vx < vy ? -1 : vx > vy ? 1 : 0;
      return key === "name" || key === "ip" ? cmp * dir : -cmp * dir;
    });
    const arrow = (k) => (key === k ? (dir > 0 ? " ▾" : " ▴") : "");
    const rows = list.map((c) => {
      const lvl = sigLevel(c.signal ?? -100), col = QUALITY[c.q] || "#9aa0a6";
      const sub = [c.area, c.in_ha && c.host && c.host !== c.name ? c.host : null, c.ip, c.random_mac ? "prywatny MAC" : null].filter(Boolean).map(esc).join(" · ");
      return `<tr>
        <td><div class="name"><ha-icon icon="${esc(c.icon)}" style="color:${esc(c.color)}"></ha-icon><div>
          <b>${esc(c.name)}</b>${c.in_ha ? "" : " ❔"}<br><small>${sub || esc(c.mac)}</small></div></div></td>
        <td class="c opt">${esc(c.band)}<br><small>${esc(c.ssid || "")}</small></td>
        <td class="c"><span class="sig" style="color:${col}"><ha-icon icon="mdi:wifi-strength-${lvl}"></ha-icon>${num(c.signal)}</span><br><small>śr. ${num(c.signal_avg)} · SNR ${num(c.snr)}</small></td>
        <td class="c"><span class="${tone(c.retry, 10, 20)}">${num(c.retry, 1)} %</span></td>
        <td class="c">${num(c.tx)} / ${num(c.rx)}<br><small>Mb/s${c.mcs !== null && c.mcs !== undefined ? " · MCS " + c.mcs : ""}</small></td>
        <td class="c opt">↓ ${rate(c.down_kbps)}<br><small>↑ ${rate(c.up_kbps)}</small></td>
        <td class="c opt"><small>${c.inactive}s</small></td>
        <td class="c"><small>${dur(c.up)}</small></td></tr>`;
    }).join("");
    return `<h3><ha-icon icon="mdi:devices"></ha-icon>Urządzenia (${a.clients.length})</h3><div class="scroll"><table>
      <tr><th data-sort="name">Urządzenie${arrow("name")}</th><th class="c opt" data-sort="band">Pasmo${arrow("band")}</th>
      <th class="c" data-sort="signal">Sygnał dBm${arrow("signal")}</th><th class="c" data-sort="retry">Retry${arrow("retry")}</th>
      <th class="c" data-sort="tx">TX / RX${arrow("tx")}</th><th class="c opt" data-sort="down_kbps">Transfer${arrow("down_kbps")}</th>
      <th class="c opt" data-sort="inactive">Bezczynny${arrow("inactive")}</th><th class="c" data-sort="up">Połączony${arrow("up")}</th></tr>
      ${rows || `<tr><td colspan="8" class="empty">Brak podłączonych klientów</td></tr>`}</table></div>`;
  }
}

class OpenWrtWifiPanel extends HTMLElement {
  set hass(hass) { this._hass = hass; this._update(); }
  set narrow(v) { this._narrow = v; this._update(); }
  set panel(p) { this._panel = p; this._update(); }

  _update() {
    if (!this._hass || !this._panel) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>
        :host { display: block; min-height: 100vh; background: var(--primary-background-color); }
        .bar { display: flex; align-items: center; gap: 8px; height: var(--header-height, 56px); padding: 0 12px;
               background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff);
               font-size: 20px; position: sticky; top: 0; z-index: 2; }
        .wrap { max-width: 1280px; margin: 0 auto; padding: 16px; }
        @media (max-width: 640px) { .wrap { padding: 8px; } }
      </style><div class="bar"><ha-menu-button></ha-menu-button><span class="t"></span></div><div class="wrap"><openwrt-wifi-card></openwrt-wifi-card></div>`;
      this._card = this.shadowRoot.querySelector("openwrt-wifi-card");
      this._card.setConfig({ entry_id: this._panel.config.entry_id, title: this._panel.title });
    }
    const btn = this.shadowRoot.querySelector("ha-menu-button");
    btn.hass = this._hass;
    btn.narrow = this._narrow;
    this.shadowRoot.querySelector(".t").textContent = this._panel.title || "Wi-Fi";
    this._card.hass = this._hass;
  }
}

if (!customElements.get("openwrt-wifi-card")) customElements.define("openwrt-wifi-card", OpenWrtWifiCard);
if (!customElements.get("openwrt-wifi-panel")) customElements.define("openwrt-wifi-panel", OpenWrtWifiPanel);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "openwrt-wifi-card"))
  window.customCards.push({ type: "openwrt-wifi-card", name: "OpenWrt Wi-Fi", description: "Klienci Wi-Fi, radia i obciążenie routera OpenWrt", preview: false });
