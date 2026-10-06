/* OpenWrt Wi-Fi Dashboard: karta Lovelace `custom:openwrt-wifi-card` + panel `openwrt-wifi-panel`.
 * Wszystko rysowane z atrybutow sensora "Klienci Wi-Fi" integracji openwrt_wifi - nowi klienci
 * i radia pojawiaja sie sami, bez edycji dashboardu. */
const VERSION = "1.3.0";
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
  .edit { --mdc-icon-size: 16px; opacity: .35; cursor: pointer; margin-left: 4px; vertical-align: middle; }
  .edit:hover, tr:hover .edit { opacity: .9; }
  .editor { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .editor input { flex: 1; min-width: 120px; font: inherit; padding: 4px 8px; border-radius: 6px;
                  border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
  .editor input:focus { outline: 2px solid var(--primary-color); border-color: transparent; }
  .btn { --mdc-icon-size: 20px; cursor: pointer; padding: 3px; border-radius: 50%; color: var(--secondary-text-color); }
  .btn:hover { background: var(--secondary-background-color); color: var(--primary-color); }
  .tag { font-size: .7em; padding: 0 5px; border-radius: 4px; background: var(--secondary-background-color); color: var(--secondary-text-color); margin-left: 4px; }
  .faceplate { display: flex; align-items: flex-start; gap: 14px; padding: 10px 16px 8px; border-radius: 12px; overflow-x: auto;
               background: linear-gradient(180deg, #3b4048 0%, #262a30 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 1px 3px rgba(0,0,0,.25); }
  .pgroup { display: flex; gap: 10px; }
  .psep { width: 1px; align-self: stretch; background: rgba(255,255,255,.14); }
  .model { margin-left: auto; align-self: center; color: rgba(255,255,255,.45); font-size: .72em; letter-spacing: .06em; text-align: right; max-width: 140px; }
  .pt { display: flex; flex-direction: column; align-items: center; width: 70px; flex: none; text-align: center; }
  .pt .extra { font-size: .62em; color: #ffb74d; line-height: 1.2; min-height: 1.2em; }
  .pt .lbl { font-size: .7em; font-weight: 600; letter-spacing: .06em; color: #d5d9de; margin-bottom: 3px; }
  .pt .lbl.wan { color: #64b5f6; }
  .pt .jack { width: 48px; height: 66px; display: block; }
  .pt .spd { font-size: .72em; margin-top: 2px; white-space: nowrap; font-weight: 500; }
  .jack .body { fill: #1b1e22; stroke: #4a5059; stroke-width: 1.2; }
  .jack .hole { fill: #07080a; stroke: #3a3f46; stroke-width: 1; }
  .jack .pin { fill: #5a5f66; }
  .jack .led, .jack .led2 { fill: #3a3f46; }
  .jack .plug { fill: #c9d1d9; fill-opacity: .9; }
  .jack .cable { fill: #9aa4ae; }
  .pt.up .led { fill: #4caf50; filter: drop-shadow(0 0 3px #4caf50); animation: owled 2.4s ease-in-out infinite; }
  .pt.up .led2 { fill: #ffb300; filter: drop-shadow(0 0 2px #ffb300); }
  .pt.up .pin, .pt.warn .pin { fill: #d4a017; }
  .pt.up .hole { stroke: #4caf50; }
  .pt.up .spd { color: #81c784; }
  .pt.up .cable { fill: #4caf50; }
  .pt.warn .led { fill: #ff9800; filter: drop-shadow(0 0 3px #ff9800); }
  .pt.warn .hole { stroke: #ff9800; }
  .pt.warn .spd { color: #ffb74d; }
  .pt.warn .cable { fill: #ff9800; }
  .pt.down .spd { color: #8a9099; }
  .pt.down .jack { opacity: .75; }
  @media (max-width: 640px) {
    .faceplate { gap: 8px; padding: 8px 10px 6px; }
    .pgroup { gap: 4px; }
    .pt { width: 54px; }
    .pt .jack { width: 38px; height: 52px; }
    .model { display: none; }
  }
  @keyframes owled { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
  @media (prefers-reduced-motion: reduce) { .pt.up .led { animation: none; } }
  .ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .ctl button, .confirm button { font: inherit; font-size: .85em; cursor: pointer; border-radius: 8px; padding: 6px 12px;
          border: 1px solid var(--divider-color); background: var(--secondary-background-color); color: var(--primary-text-color);
          display: inline-flex; align-items: center; gap: 6px; }
  .ctl button ha-icon, .confirm button ha-icon { --mdc-icon-size: 18px; }
  .ctl button:hover { border-color: var(--primary-color); }
  .ctl select { font: inherit; font-size: .85em; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--divider-color);
          background: var(--card-background-color); color: var(--primary-text-color); }
  .ctl label { font-size: .85em; color: var(--secondary-text-color); display: inline-flex; align-items: center; gap: 6px; }
  .confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 12px; border-radius: 8px;
          border-left: 4px solid var(--error-color, #f44336); background: var(--secondary-background-color); font-size: .9em; }
  .confirm button.yes { background: var(--error-color, #f44336); color: #fff; border-color: transparent; }
  .kick { --mdc-icon-size: 18px; opacity: .35; cursor: pointer; }
  .kick:hover, tr:hover .kick { opacity: .9; color: var(--error-color, #f44336); }
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
    if (key !== this._key) {
      this._key = key;
      if (this._editing) this._dirty = true; // nie zamazuj pola edycji w trakcie pisania
      else this._render();
    }
  }

  getCardSize() { return 10; }
  getGridOptions() { return { columns: "full", min_columns: 6 }; }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => {
        const el = ev.composedPath().find((x) => x.dataset && (x.dataset.sort || x.dataset.act));
        if (!el) return;
        if (el.dataset.sort) {
          if (this._editing) return;
          this._sort = el.dataset.sort === this._sort ? `-${this._sort}` : el.dataset.sort;
          this._render();
        } else this._action(el.dataset.act, el.dataset.mac);
      });
      this.shadowRoot.addEventListener("change", (ev) => {
        const sel = ev.target;
        if (sel.tagName === "SELECT" && sel.dataset.radio) {
          this._confirm = { act: "channel", radio: sel.dataset.radio, value: sel.value,
            text: `Zmienić kanał ${sel.dataset.label} na ${sel.value}? Wi-Fi zostanie przeładowane (klienci rozłączeni na kilka sekund).` };
          this._render();
        }
      });
      this.shadowRoot.addEventListener("keydown", (ev) => {
        if (!this._editing || ev.target.tagName !== "INPUT") return;
        if (ev.key === "Enter") { ev.preventDefault(); this._action("save", this._editing); }
        if (ev.key === "Escape") { ev.preventDefault(); this._action("cancel", this._editing); }
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
    const admin = !this._hass.user || this._hass.user.is_admin;
    const show = new Set(this._config.sections || ["router", "alerts", "ports", "radios", "controls", "clients"]);
    if (!admin || this._config.controls === false) show.delete("controls");
    this._kickable = admin && this._config.controls !== false;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>
      ${show.has("router") ? this._router(a) : ""}
      ${show.has("alerts") ? this._alerts(a) : ""}
      ${show.has("ports") ? this._ports(a) : ""}
      ${show.has("radios") ? this._radios(a) : ""}
      ${show.has("controls") ? this._controls(a) : ""}
      ${show.has("clients") ? this._clients(a) : ""}
      <div class="foot">Sygnał: <span class="ok">≥ -55</span> · <span style="color:#ffc107">-56…-67</span> · <span class="warn">-68…-75</span> · <span class="bad">&lt; -75 dBm</span>
        · Retry = % retransmisji TX od ostatniego odczytu · ❔ = brak urządzenia w HA · ✏️ = zmień nazwę ·
        odświeżono ${Math.max(0, Math.round(Date.now() / 1000 - (a.updated || 0)))} s temu · v${VERSION}</div>
    </ha-card>`;
  }

  _notify(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
  }

  _entryId() {
    const id = findEntity(this._hass, this._config);
    return id && this._hass.states[id].attributes.entry_id;
  }

  _run(service, data, okMsg) {
    this._hass.callService("openwrt_wifi", service, { entry_id: this._entryId(), ...data })
      .then(() => okMsg && this._notify(okMsg))
      .catch((err) => this._notify(`Błąd: ${err.message || err}`));
  }

  _action(act, mac) {
    if (act === "ask-wifi") { this._confirm = { act: "wifi", text: "Zrestartować Wi-Fi? Wszyscy klienci zostaną rozłączeni na kilka sekund." }; return this._render(); }
    if (act === "ask-reboot") { this._confirm = { act: "reboot", text: "Zrestartować router? Sieć Wi-Fi zniknie na około minutę." }; return this._render(); }
    if (act === "ask-kick") {
      const c = (this._attrs().clients || []).find((x) => x.mac === mac);
      this._confirm = { act: "kick", mac, text: `Rozłączyć ${c ? c.name : mac}? Urządzenie zwykle połączy się ponownie samo.` };
      return this._render();
    }
    if (act === "no") { this._confirm = null; return this._render(); }
    if (act === "yes") {
      const c = this._confirm; this._confirm = null;
      if (c.act === "wifi") this._run("restart_wifi", {}, "Restart Wi-Fi wysłany");
      if (c.act === "reboot") this._run("reboot", {}, "Router się restartuje");
      if (c.act === "kick") this._run("kick_client", { mac: c.mac }, "Klient rozłączony");
      if (c.act === "channel") this._run("set_channel", { radio: c.radio, channel: c.value }, `Kanał zmieniony na ${c.value}`);
      return this._render();
    }
    if (act === "edit") {
      this._editing = mac;
      this._render();
      const inp = this.shadowRoot.querySelector(".editor input");
      if (inp) { inp.focus(); inp.select(); }
      return;
    }
    if (act === "save" || act === "reset") {
      const inp = this.shadowRoot.querySelector(".editor input");
      const name = act === "reset" ? "" : (inp ? inp.value.trim() : "");
      const id = findEntity(this._hass, this._config);
      const entry_id = id && this._hass.states[id].attributes.entry_id;
      this._hass.callService("openwrt_wifi", "set_client_name", { entry_id, mac, name })
        .catch((err) => this._notify(`Nie udało się zapisać nazwy: ${err.message || err}`));
    }
    this._editing = null;
    this._dirty = false;
    this._render();
  }

  _attrs() {
    const id = findEntity(this._hass, this._config);
    return (id && this._hass.states[id].attributes) || {};
  }

  _confirmBar() {
    const c = this._confirm;
    if (!c) return "";
    return `<div class="confirm"><span style="flex:1">${esc(c.text)}</span>
      <button class="yes" data-act="yes"><ha-icon icon="mdi:check"></ha-icon>Tak</button>
      <button data-act="no"><ha-icon icon="mdi:close"></ha-icon>Anuluj</button></div>`;
  }

  _ports(a) {
    const ports = a.ports || [];
    if (!ports.length) return "";
    const r = a.router || {};
    const wan = ports.filter((p) => p.label.startsWith("WAN")), lan = ports.filter((p) => !p.label.startsWith("WAN"));
    const speedTxt = (p) => (!p.link ? "—" : !p.speed ? "link" : p.speed >= 1000 ? `${p.speed / 1000} Gb/s` : `${p.speed} Mb/s`);
    const jack = (p) => {
      const warn = p.link && (p.duplex === "half" || (p.speed && p.speed < 100));
      const state = !p.link ? "down" : warn ? "warn" : "up";
      const title = `${p.label}: ${p.link ? `połączony, ${speedTxt(p)}${p.duplex ? ", " + p.duplex + " duplex" : ""}` : "brak linku"}${p.errors ? `, błędy: ${p.errors}` : ""}`;
      const pins = Array.from({ length: 8 }, (_, i) => `<rect x="${12.5 + i * 3}" y="12" width="1.6" height="5" class="pin"/>`).join("");
      // gniazdo RJ45 + (gdy jest link) wtyczka z kablem
      return `<div class="pt ${state}" title="${esc(title)}">
        <div class="lbl ${p.label.startsWith("WAN") ? "wan" : ""}">${esc(p.label)}</div>
        <svg viewBox="0 0 48 66" class="jack" aria-hidden="true">
          <rect x="1" y="1" width="46" height="42" rx="4" class="body"/>
          <circle cx="7" cy="6" r="2.4" class="led"/><circle cx="41" cy="6" r="2.4" class="led2"/>
          <path d="M9 10 H39 V30 H33 V37 H15 V30 H9 Z" class="hole"/>${pins}
          ${p.link ? `<path d="M11 15 H37 V31 H32 V36 H16 V31 H11 Z" class="plug"/><rect x="21" y="36" width="6" height="30" rx="2" class="cable"/>` : ""}
        </svg>
        <div class="spd">${speedTxt(p)}</div>
        <div class="extra">${[p.link && p.duplex === "half" ? "half" : "", p.errors ? `⚠ ${p.errors}` : ""].filter(Boolean).join(" ") || "&nbsp;"}</div>
      </div>`;
    };
    const up = ports.filter((p) => p.link).length;
    return `<h3><ha-icon icon="mdi:ethernet"></ha-icon>Porty <span class="muted">(${up}/${ports.length} podłączone)</span></h3>
      <div class="faceplate">
        ${wan.length ? `<div class="pgroup">${wan.map(jack).join("")}</div><div class="psep"></div>` : ""}
        <div class="pgroup">${lan.map(jack).join("")}</div>
        <div class="model">${esc(r.model || "")}</div>
      </div>`;
  }

  _controls(a) {
    const radios = (a.radios || []).filter((r) => r.uci_radio && (r.channels || []).length);
    const sel = radios.map((r) => {
      const label = `${r.band} ${r.ssid || r.radio}`;
      const opts = ["auto", ...r.channels.map(String)].map((ch) => `<option value="${ch}" ${String(r.channel_cfg) === ch ? "selected" : ""}>${ch === "auto" ? "auto" : "kanał " + ch}</option>`).join("");
      return `<label><ha-icon icon="mdi:access-point-network"></ha-icon>${esc(label)}
        <select data-radio="${esc(r.radio)}" data-label="${esc(label)}">${opts}</select></label>`;
    }).join("");
    const warn = radios.filter((r) => r.htmode_cfg && r.htmode && r.htmode_cfg !== r.htmode)
      .map((r) => `<div class="alert">ℹ️ ${esc(r.ssid || r.radio)}: ustawione ${esc(r.htmode_cfg)}, działa ${esc(r.htmode)} (np. sąsiednia sieć wymusza węższy kanał)${r.country ? ` · kraj ${esc(r.country)}` : ""}</div>`).join("");
    return `<h3><ha-icon icon="mdi:tune-variant"></ha-icon>Sterowanie</h3><div class="ctl">
      ${sel}
      <button data-act="ask-wifi"><ha-icon icon="mdi:wifi-refresh"></ha-icon>Restart Wi-Fi</button>
      <button data-act="ask-reboot"><ha-icon icon="mdi:restart"></ha-icon>Restart routera</button></div>
      ${this._confirm && this._confirm.act !== "kick" ? this._confirmBar() : ""}${warn}`;
  }

  _nameCell(c) {
    const editable = this._config.editable !== false;
    if (editable && this._editing === c.mac) {
      return `<div class="editor"><input value="${esc(c.custom ? c.name : c.auto_name || c.name)}" maxlength="64" placeholder="${esc(c.auto_name)}">
        <ha-icon class="btn" icon="mdi:check" title="Zapisz (Enter)" data-act="save" data-mac="${esc(c.mac)}"></ha-icon>
        ${c.custom ? `<ha-icon class="btn" icon="mdi:backup-restore" title="Przywróć automatyczną: ${esc(c.auto_name)}" data-act="reset" data-mac="${esc(c.mac)}"></ha-icon>` : ""}
        <ha-icon class="btn" icon="mdi:close" title="Anuluj (Esc)" data-act="cancel" data-mac="${esc(c.mac)}"></ha-icon></div>
        <small>${esc(c.mac)}${c.custom ? " · automatycznie: " + esc(c.auto_name) : ""}</small>`;
    }
    const sub = [c.area, (c.in_ha || c.custom) && c.host && c.host !== c.name ? c.host : null, c.ip, c.random_mac ? "prywatny MAC" : null]
      .filter(Boolean).map(esc).join(" · ");
    const pencil = (editable ? `<ha-icon class="edit" icon="mdi:pencil" title="Zmień nazwę" data-act="edit" data-mac="${esc(c.mac)}"></ha-icon>` : "")
      + (this._kickable ? `<ha-icon class="kick" icon="mdi:link-variant-off" title="Rozłącz" data-act="ask-kick" data-mac="${esc(c.mac)}"></ha-icon>` : "");
    return `<b>${esc(c.name)}</b>${c.custom ? '<span class="tag" title="Nazwa ustawiona ręcznie">ręcznie</span>' : c.in_ha ? "" : " ❔"}${pencil}
      <br><small>${sub || esc(c.mac)}</small>`;
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
      return `<tr>
        <td><div class="name"><ha-icon icon="${esc(c.icon)}" style="color:${esc(c.color)}"></ha-icon><div style="flex:1">${this._nameCell(c)}</div></div></td>
        <td class="c opt">${esc(c.band)}<br><small>${esc(c.ssid || "")}</small></td>
        <td class="c"><span class="sig" style="color:${col}"><ha-icon icon="mdi:wifi-strength-${lvl}"></ha-icon>${num(c.signal)}</span><br><small>śr. ${num(c.signal_avg)} · SNR ${num(c.snr)}</small></td>
        <td class="c"><span class="${tone(c.retry, 10, 20)}">${num(c.retry, 1)} %</span></td>
        <td class="c">${num(c.tx)} / ${num(c.rx)}<br><small>Mb/s${c.mcs !== null && c.mcs !== undefined ? " · MCS " + c.mcs : ""}</small></td>
        <td class="c opt">↓ ${rate(c.down_kbps)}<br><small>↑ ${rate(c.up_kbps)}</small></td>
        <td class="c opt"><small>${c.inactive}s</small></td>
        <td class="c"><small>${dur(c.up)}</small></td></tr>`;
    }).join("");
    return `<h3><ha-icon icon="mdi:devices"></ha-icon>Urządzenia (${a.clients.length})</h3>
      ${this._confirm && this._confirm.act === "kick" ? this._confirmBar() : ""}<div class="scroll"><table>
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
