/* OpenWrt Wi-Fi Dashboard: karta Lovelace `custom:openwrt-wifi-card` + panel `openwrt-wifi-panel`.
 * Wszystko rysowane z atrybutow sensora "Klienci Wi-Fi" integracji openwrt_wifi - nowi klienci
 * i radia pojawiaja sie sami, bez edycji dashboardu. */
const VERSION = "1.4.2";
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
  .sw { --tw: minmax(34px, 64px); background: #1c1f23; color: #c9cdd2; border-radius: 14px; padding: 14px 18px 10px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.05); }
  .sw-groups { display: flex; flex-wrap: wrap; gap: 18px 26px; align-items: flex-end; justify-content: safe center; overflow-x: auto; padding: 4px 2px 2px; }
  .sw-g { flex: 0 1 auto; min-width: 0; }
  .sw-g.wan { flex: 0 0 auto; }
  .sw-gt { text-align: center; font-size: .72em; letter-spacing: .1em; color: #9aa0a6; margin-bottom: 4px; }
  .sw-grid { display: grid; gap: 6px 6px; justify-content: safe center; overflow-x: auto; padding-top: 4px; }
  .sp { display: flex; flex-direction: column; align-items: center; min-width: 0; }
  .sp-n { font-size: .68em; color: #9aa0a6; margin-bottom: 3px; }
  .sp-t { position: relative; width: 100%; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: .8em; color: #fff; letter-spacing: .02em; gap: 2px; }
  .sp-t small { font-size: .6em; font-weight: 600; opacity: .9; }
  .sp-t.down { background: #3a3d42; }
  .sp-t.gig { background: #4caf50; }
  .sp-t.slow { background: #ff6b35; }
  .sp-t.fast { background: #1e88e5; }
  .sp-err { position: absolute; top: -3px; right: -3px; width: 9px; height: 9px; border-radius: 50%; background: #f44336; box-shadow: 0 0 0 2px #1c1f23; }
  .sw-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 12px; font-size: .72em; color: #9aa0a6; }
  .sw-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .sw-legend i.slow { background: #ff6b35; } .sw-legend i.gig { background: #4caf50; } .sw-legend i.fast { background: #1e88e5; } .sw-legend i.down { background: #5a5e64; }
  .sw-foot { display: flex; flex-wrap: wrap; gap: 4px 0; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.08); font-size: .74em; color: #9aa0a6; }
  .sw-foot span { padding: 0 14px; border-left: 1px solid rgba(255,255,255,.12); }
  .sw-foot span:first-child { padding-left: 0; border-left: none; }
  .sw-foot b { color: #e3e6e9; font-weight: 500; margin-left: 4px; }
  @media (max-width: 640px) {
    .sw { --tw: minmax(28px, 48px); padding: 12px 10px 8px; }
    .sp-t { height: 30px; font-size: .62em; border-radius: 7px; }
    .sw-grid { gap: 5px 4px; }
    .sw-groups { gap: 12px 14px; }
    .sw-foot { flex-direction: column; }
    .sw-foot span { padding: 0; border-left: none; }
  }
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
    const isWan = (p) => p.label.startsWith("WAN");
    const wan = ports.filter(isWan), lan = ports.filter((p) => !isWan(p));
    const num = (p) => (p.label.match(/(\d+)$/) || [])[1] || p.label;
    const kind = (p) => (!p.link ? "down" : p.duplex === "half" || !p.speed || p.speed <= 100 ? "slow" : p.speed >= 2500 ? "fast" : "gig");
    const spd = (p) => (!p.link ? "" : !p.speed ? "UP" : p.speed >= 1000 ? `${+(p.speed / 1000).toFixed(1)}G` : `${p.speed}M`);
    const tile = (p, label, pos = "") => {
      const tip = `${p.label}: ${p.link ? `link ${p.speed ? p.speed + " Mb/s" : ""}${p.duplex ? ", " + p.duplex + " duplex" : ""}` : "brak linku"}${p.errors ? `, błędy: ${p.errors}` : ""}`;
      return `<div class="sp" style="${pos}" title="${esc(tip)}"><div class="sp-n">${esc(label)}</div>
        <div class="sp-t ${kind(p)}">${spd(p)}${p.link && p.duplex === "half" ? "<small>DM</small>" : ""}${p.errors ? '<i class="sp-err"></i>' : ""}</div></div>`;
    };
    // > 8 portow: dwa rzedy jak w switchu (parzyste u gory, nieparzyste na dole)
    const two = lan.length > 8;
    const lanTiles = lan.map((p, i) => {
      if (!two) return tile(p, num(p));
      const n = i + 1;
      return tile(p, num(p), `grid-column:${Math.ceil(n / 2)};grid-row:${n % 2 ? 2 : 1}`);
    }).join("");
    const cols = two ? Math.ceil(lan.length / 2) : lan.length;
    const up = ports.filter((p) => p.link).length;
    return `<h3><ha-icon icon="mdi:ethernet"></ha-icon>Porty <span class="muted">(${up}/${ports.length} podłączone)</span></h3>
      <div class="sw">
        <div class="sw-groups">
          <div class="sw-g"><div class="sw-gt">LAN</div>
            <div class="sw-grid" style="grid-template-columns:repeat(${cols}, var(--tw))">${lanTiles}</div></div>
          ${wan.length ? `<div class="sw-g wan"><div class="sw-gt">WAN</div>
            <div class="sw-grid" style="grid-template-columns:repeat(${wan.length}, var(--tw))">${wan.map((p) => tile(p, wan.length > 1 ? num(p) : "\u00a0")).join("")}</div></div>` : ""}
        </div>
        <div class="sw-legend"><span><i class="slow"></i>10/100/DM</span><span><i class="gig"></i>1G</span><span><i class="fast"></i>2,5G+</span><span><i class="down"></i>brak linku</span></div>
        <div class="sw-foot"><span>Nazwa: <b>${esc(r.model || r.hostname || "–")}</b></span>
          <span>FW: <b>${esc((r.firmware || "–").replace(/^OpenWrt /, ""))}</b></span>
          <span>Uptime: <b>${dur(r.uptime)}</b></span></div>
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
