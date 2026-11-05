/* Shared data, login and saving for all pages.
   Two modes:
   - server: js/config.js names the API (Cloudflare Worker). People sign in with Telegram, data lives on the server, rights depend on roles.
   - local: no API configured. Data lives in this browser and can be committed to GitHub with a personal token (owner only). */
(function () {
  const CONFIG = Object.assign({ api: '', bot: '' }, window.SITE_CONFIG || {});
  const STORE_KEY = 'mcmap.world.v1', BACKUP_KEY = 'mcmap.world.backup', GH_KEY = 'mcmap.github.v1', BASE_KEY = 'mcmap.remoteSavedAt', TOKEN_KEY = 'mcmap.session';
  const $ = id => document.getElementById(id);
  const sgn = n => n > 0 ? '+' + n : n < 0 ? '−' + (-n) : '0';
  const fmt = n => Number(n).toLocaleString('ru-RU');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const ROLE_RU = { owner: 'Владелец', moderator: 'Модератор', member: 'Участник', guest: 'Гость' };
  /* per-person settings: kept in this browser and, after sign-in, on the server so they follow the person */
  let prefs = read('mcmap.prefs', {}); if (!prefs || typeof prefs !== 'object') prefs = {};
  const applyTheme = t => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; try { localStorage.setItem('mcmap.theme', document.documentElement.dataset.theme); } catch (e) { } };
  try { applyTheme(prefs.theme || localStorage.getItem('mcmap.theme') || 'dark'); } catch (e) { applyTheme('dark'); }
  const LV = { anon: -1, guest: 0, member: 1, moderator: 2, owner: 3 };

  function defaults() {
    return {
      version: 1, name: 'Мир легиона', seed: '', savedAt: 0,
      maps: { overworld: { image: '', x: 0, z: 0, bpp: 1 }, nether: { image: '', x: 0, z: 0, bpp: 1 }, end: { image: '', x: 0, z: 0, bpp: 1 } },
      markers: [],
      plan: { platform: { size: 16, cx0: -8, cz0: -8 }, base: { placed: true, scale: 1, cx: 0, cz: 0, edits: [] }, tasks: [] }
    };
  }
  function normalize(w) {
    const d = defaults(); w = (w && typeof w === 'object') ? w : {};
    const out = Object.assign(d, w);
    out.maps = Object.assign(defaults().maps, w.maps || {});
    for (const k of ['overworld', 'nether', 'end']) out.maps[k] = Object.assign({ image: '', x: 0, z: 0, bpp: 1 }, out.maps[k] || {});
    out.markers = Array.isArray(w.markers) ? w.markers.filter(m => m && isFinite(m.x) && isFinite(m.z)) : [];
    const p = w.plan || {};
    out.plan = { platform: Object.assign(defaults().plan.platform, p.platform || {}), base: Object.assign(defaults().plan.base, p.base || {}), tasks: Array.isArray(p.tasks) ? p.tasks.filter(t => t && Array.isArray(t.chunks)) : [],
      structures: Array.isArray(p.structures) ? p.structures.filter(s => s && s.def) : [] };
    if (!Array.isArray(out.plan.base.edits)) out.plan.base.edits = [];
    // the main building is the Lotus Temple model; an old "Лотос Легиона" entry (kind lotus) turns into it, keeping its placements
    const temple = id => ({ id, name: 'Храм Лотоса', kind: 'temple', edits: [], w: 11, d: 11, h: App.TEMPLE_H, color: '#e07b2a', note: 'Главное здание легиона по образцу Храма Лотоса в Дели: 27 лепестков, 9 входов. Внутри пока пусто, только пол.' });
    out.structdefs = Array.isArray(w.structdefs) && w.structdefs.length ? w.structdefs.map(d => d && d.kind === 'lotus' ? temple(d.id) : d) : [temple('lotus')];
    delete out.users;
    return out;
  }

  const listeners = [];
  const App = {
    config: CONFIG, mode: CONFIG.api ? 'server' : 'local',
    world: null, dirty: false, user: null, meta: { name: 'Мир легиона', seed: '' }, users: {},
    $, sgn, fmt, uid, esc, ROLE_RU,
    onChange(fn) { listeners.push(fn); },
    emit(why) { for (const fn of listeners) try { fn(why); } catch (e) { console.error(e); } },

    /* ---------- server API ---------- */
    async api(method, path, body) {
      const h = {}; const tk = read(TOKEN_KEY, ''); if (tk) h.Authorization = 'Bearer ' + tk; if (body !== undefined) h['Content-Type'] = 'application/json';
      let r;
      try { r = await fetch(CONFIG.api.replace(/\/+$/, '') + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); }
      catch (e) { throw new Error('Нет связи с сервером. Проверь интернет или адрес сервера в js/config.js.'); }
      let j = {}; try { j = await r.json(); } catch (e) { }
      if (r.status === 401 && tk && path !== '/api/auth/telegram') { write(TOKEN_KEY, ''); }
      if (!r.ok) throw new Error(j.error || ('Сервер ответил ошибкой ' + r.status));
      return j;
    },
    addUsers(u) { if (u) Object.assign(this.users, u); },
    userName(id) { const u = this.users[id]; return u ? u.name : (id ? 'id' + id : '—'); },
    level() { return this.mode === 'local' ? LV.owner : (this.user ? (this.user.banned ? LV.guest - 0.5 : LV[this.user.role] ?? 0) : LV.anon); },
    can(what) {
      if (this.mode === 'local') return what !== 'server';
      const l = this.level();
      switch (what) {
        case 'login': return !!this.user;
        case 'post': return !!this.user && !this.user.banned;
        case 'marker': case 'chat': return l >= LV.member;
        case 'editAny': case 'plan': case 'tasks': case 'mapImage': case 'moderate': case 'seeUsers': return l >= LV.moderator;
        case 'owner': return l >= LV.owner;
        case 'server': return true;
      }
      return false;
    },
    canEditMarker(m) { if (this.mode === 'local') return true; return this.can('editAny') || (this.can('marker') && this.user && m.owner === this.user.id); },

    async init() {
      if (this.mode !== 'server') return;
      try {
        const me = await this.api('GET', '/api/me'); this.user = me.user; if (me.meta) this.meta = me.meta; if (me.user) this.users[me.user.id] = me.user;
        if (me.user && me.prefs && typeof me.prefs === 'object' && Object.keys(me.prefs).length) { prefs = Object.assign(prefs, me.prefs); write('mcmap.prefs', prefs); if (prefs.theme) { applyTheme(prefs.theme); window.dispatchEvent(new Event('themechange')); } }
        else if (me.user && Object.keys(prefs).length) this.api('PUT', '/api/prefs', prefs).catch(() => { });
      }
      catch (e) { this.toast(e.message, 6000); }
    },
    async load() {
      if (this.mode === 'server') {
        try { const w = await this.api('GET', '/api/world'); this.addUsers(w.users); this.world = normalize(w); this.meta = { name: this.world.name, seed: this.world.seed }; }
        catch (e) { this.toast(e.message, 6000); this.world = normalize(null); }
        this.dirty = false; return this.world;
      }
      let remote = null;
      try { const r = await fetch('data/world.json?ts=' + Date.now(), { cache: 'no-store' }); if (r.ok) remote = await r.json(); } catch (e) { }
      const local = read(STORE_KEY, null);
      const rs = remote ? (remote.savedAt || 0) : 0, ls = local ? (local.savedAt || 0) : 0;
      if (local && ls > rs) { this.world = normalize(local); this.dirty = ls > read(BASE_KEY, 0); }
      else {
        if (local && ls && ls < rs) write(BACKUP_KEY, local);
        this.world = normalize(remote || local || null); this.dirty = false; write(BASE_KEY, rs); write(STORE_KEY, this.world);
      }
      this.meta = { name: this.world.name, seed: this.world.seed };
      return this.world;
    },

    /* saving: local writes the whole object, server sends just the part that changed */
    _planTimer: 0,
    save(why) {
      if (this.mode === 'local') {
        this.world.savedAt = Date.now(); write(STORE_KEY, this.world); this.dirty = true; renderStatus(); this.emit(why); return;
      }
      this.emit(why);
      if (why === 'structdefs') { setStatus('сохраняю…', true); this.api('PUT', '/api/structdefs', this.world.structdefs).then(() => setStatus('сохранено')).catch(e => { setStatus('не сохранено', true); this.toast(e.message, 6000); }); return; }
      if (['plan', 'tasks', 'base', 'platform', 'structures'].includes(why)) {
        clearTimeout(this._planTimer); setStatus('сохраняю…', true);
        this._planTimer = setTimeout(() => this.api('PUT', '/api/plan', this.world.plan).then(() => setStatus('сохранено')).catch(e => { setStatus('не сохранено', true); this.toast(e.message, 6000); }), 700);
      } else if (why === 'map') this.api('PUT', '/api/maps', this.world.maps).then(() => setStatus('сохранено')).catch(e => this.toast(e.message, 6000));
      else if (why === 'settings') this.api('PUT', '/api/meta', { name: this.world.name, seed: this.world.seed }).then(() => setStatus('сохранено')).catch(e => this.toast(e.message, 6000));
    },
    async replace(w, why) {
      if (this.mode === 'local') { this.world = normalize(w); this.save(why || 'replace'); return; }
      const r = await this.api('POST', '/api/import', w); await this.load(); this.emit('import'); this.toast(`Загружено на сервер, меток: ${r.markers}`);
    },
    async saveMarker(rec, id) {
      if (this.mode === 'local') {
        if (id) Object.assign(this.world.markers.find(m => m.id === id), rec); else this.world.markers.push(Object.assign({ id: uid(), created: Date.now() }, rec));
        this.save('markers'); return;
      }
      const r = await this.api('PUT', '/api/markers/' + (id || uid()), rec);
      this.addUsers(r.users);
      const i = this.world.markers.findIndex(m => m.id === r.marker.id);
      if (i >= 0) this.world.markers[i] = r.marker; else this.world.markers.push(r.marker);
    },
    async deleteMarker(id) {
      if (this.mode === 'local') { this.world.markers = this.world.markers.filter(m => m.id !== id); this.save('markers'); return; }
      await this.api('DELETE', '/api/markers/' + id); this.world.markers = this.world.markers.filter(m => m.id !== id);
    },
    markClean() { this.dirty = false; write(BASE_KEY, this.world.savedAt || 0); renderStatus(); },

    /* small helpers */
    toast(msg, ms) {
      let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
      t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, ms || 2600);
    },
    async copy(text) {
      try { await navigator.clipboard.writeText(text); this.toast('Скопировано: ' + (text.length > 60 ? text.slice(0, 60) + '…' : text)); return true; }
      catch (e) { window.prompt('Скопируй вручную:', text); return false; }
    },
    download(name, text) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    json() { return JSON.stringify(this.world, null, 1); },
    ago(t) {
      if (!t) return ''; const s = (Date.now() - t) / 1000;
      if (s < 60) return 'только что'; if (s < 3600) return Math.floor(s / 60) + ' мин назад'; if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
      if (s < 86400 * 7) return Math.floor(s / 86400) + ' дн назад';
      return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: s > 86400 * 300 ? 'numeric' : undefined });
    },
    when(t) { return t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; },
    avatar(u, size) {
      size = size || 28; const n = u ? u.name : '?';
      if (u && u.photo) return `<img class="ava" src="${esc(u.photo)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer">`;
      return `<span class="ava" style="width:${size}px;height:${size}px">${esc((n || '?').replace('@', '').slice(0, 1).toUpperCase())}</span>`;
    },
    roleBadge(r) { return r && r !== 'guest' ? `<span class="role role-${r}">${ROLE_RU[r]}</span>` : ''; },
    text(s) { return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow">$1</a>').replace(/\n/g, '<br>'); },
    every(fn, ms) { let h = 0; const tick = async () => { if (!document.hidden) { try { await fn(); } catch (e) { } } h = setTimeout(tick, ms); }; h = setTimeout(tick, ms); document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(h); tick(); } }); },

    gh: {
      get() {
        const c = Object.assign({ owner: '', repo: '', branch: 'main', path: 'data/world.json', token: '' }, read(GH_KEY, {}));
        if (!c.owner && /\.github\.io$/i.test(location.hostname)) {
          c.owner = location.hostname.split('.')[0];
          const seg = location.pathname.split('/').filter(Boolean)[0];
          c.repo = c.repo || (seg && !/\.html?$/i.test(seg) ? seg : location.hostname);
        }
        return c;
      },
      set(c) { write(GH_KEY, c); },
      ready() { const c = this.get(); return !!(c.owner && c.repo && c.token); },
      async request(method, body) {
        const c = this.get();
        if (!c.owner || !c.repo || !c.token) throw new Error('Синхронизация не настроена: укажи владельца, репозиторий и токен в настройках.');
        const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;
        const h = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' };
        return method === 'GET'
          ? fetch(url + '?ref=' + encodeURIComponent(c.branch), { headers: h, cache: 'no-store' })
          : fetch(url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify(body) });
      },
      async pull() { const r = await this.request('GET'); if (!r.ok) throw new Error(ghError(r.status)); const j = await r.json(); return JSON.parse(fromB64(j.content)); },
      async push(world) {
        let sha; const g = await this.request('GET');
        if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw new Error(ghError(g.status));
        const p = await this.request('PUT', { message: 'Карта и план: ' + new Date().toLocaleString('ru-RU'), content: toB64(JSON.stringify(world, null, 1)), branch: this.get().branch, sha });
        if (!p.ok) throw new Error(ghError(p.status));
      }
    }
  };
  function ghError(s) {
    if (s === 401) return 'GitHub отклонил токен (401). Проверь, что он не истёк и скопирован целиком.';
    if (s === 403) return 'Нет прав на запись (403). Токену нужен доступ Contents: Read and write к этому репозиторию.';
    if (s === 404) return 'Репозиторий или ветка не найдены (404). Проверь владельца, имя репозитория и ветку.';
    if (s === 409) return 'Файл изменился на GitHub (409). Нажми «Загрузить с GitHub», потом сохрани снова.';
    if (s === 422) return 'GitHub не принял файл (422). Проверь ветку и путь к файлу.';
    return 'GitHub вернул ошибку ' + s + '.';
  }
  function toB64(s) { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); }
  function fromB64(s) { const bin = atob(String(s).replace(/\s/g, '')); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new TextDecoder().decode(b); }

  /* ---------- app shell: left menu + chat ---------- */
  function setStatus(text, warn) { const st = $('saveStatus'); if (!st) return; st.hidden = false; st.classList.toggle('dirty', !!warn); st.innerHTML = `<i></i>${esc(text)}`; }
  function renderStatus() { if (App.mode === 'local') setStatus(App.dirty ? 'есть изменения не на GitHub' : 'всё сохранено', App.dirty); }
  const ICON = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
    map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
    plan: '<path d="M3 8.5 12 4l9 4.5-9 4.5z"/><path d="M3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5"/>',
    structs: '<path d="M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    tasks: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="m8 9 1.6 1.6L12.5 7.7M8 15l1.6 1.6 2.9-2.9M14.5 9.5H17M14.5 15.5H17"/>',
    forum: '<path d="M4 5h16v10.5H9.5L5.5 19v-3.5H4z"/><path d="M8 9h8M8 12h5"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="16.8" cy="9.5" r="2.4"/><path d="M15.5 14.2c2.6.1 4.3 1.6 4.9 4.6"/>',
    clip: '<path d="M20 11.5 12.2 19.3a5 5 0 0 1-7-7l8.1-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>',
    send: '<path d="M4 12 20 4l-4 16-4.5-6.5z"/><path d="M11.5 13.5 20 4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'
  };
  const svg = (n, s) => `<svg viewBox="0 0 24 24" width="${s || 20}" height="${s || 20}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
  App.icon = svg;
  App.theme = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  App.setTheme = t => { applyTheme(t); App.setPref('theme', App.theme()); window.dispatchEvent(new Event('themechange')); };
  App.mountShell = function (active) {
    const main = document.createElement('div'); main.className = 'main';
    [...document.body.children].forEach(el => { if (el.tagName !== 'SCRIPT' && el.tagName !== 'DIALOG') main.appendChild(el); });
    const nav = document.createElement('aside'); nav.className = 'nav'; nav.setAttribute('aria-label', 'Меню и чат');
    const links = [['home', 'index.html', 'Главная'], ['map', 'map.html', 'Карта мира'], ['plan', 'plan.html', 'План базы'], ['structs', 'structures.html', 'Структуры'], ['tasks', 'tasks.html', 'Задачи'], ['forum', 'forum.html', 'Форум']];
    if (App.mode === 'server' && App.can('seeUsers')) links.push(['users', 'users.html', 'Участники']);
    const shown = App.mode === 'server' ? links : links.slice(0, 4);
    nav.innerHTML = `
      <div class="nav-top"><a class="brand" href="index.html" id="brandName"></a><button class="btn sm theme-btn" id="themeBtn"></button></div>
      <div class="nav-user" id="navUser"></div>
      <nav class="nav-links">${shown.map(([k, h, n]) => `<a href="${h}" ${active === k ? 'aria-current="page"' : ''}>${svg(k)}<span>${n}</span></a>`).join('')}</nav>
      <div class="status" id="saveStatus" hidden aria-live="polite"></div>
      <section class="nav-chat" id="navChat" aria-label="Чат"></section>`;
    document.body.prepend(nav); nav.after(main);
    document.body.classList.add('shell');
    const nm = () => { const n = (App.world && App.world.name) || App.meta.name || 'Мир'; const i = n.lastIndexOf(' '); $('brandName').innerHTML = i > 0 ? esc(n.slice(0, i)) + ' <span>' + esc(n.slice(i + 1)) + '</span>' : '<span>' + esc(n) + '</span>'; document.title = ((links.find(t => t[0] === active) || [, , ''])[2] || 'Главная') + ' · ' + n; };
    nm(); App.onChange(nm);
    const syncTheme = () => { const dark = App.theme() === 'dark'; $('themeBtn').innerHTML = dark ? `${svg('sun', 17)}<span>Светлая</span>` : `${svg('moon', 17)}<span>Тёмная</span>`; $('themeBtn').title = dark ? 'Включить светлую тему' : 'Включить тёмную тему'; };
    $('themeBtn').onclick = () => { App.setTheme(App.theme() === 'dark' ? 'light' : 'dark'); syncTheme(); };
    syncTheme();
    const box = $('navUser');
    if (App.mode === 'local') {
      box.innerHTML = `<div class="row"><button class="btn primary grow" id="ghPush">Сохранить на GitHub</button><button class="btn" id="openSettings">Настройки</button></div>`;
      renderStatus();
      $('ghPush').onclick = async () => {
        if (!App.gh.ready()) { App.toast('Сначала настрой синхронизацию с GitHub'); openSettings('gh'); return; }
        const b = $('ghPush'); b.disabled = true; b.textContent = 'Сохраняю…';
        try { await App.gh.push(App.world); App.markClean(); App.toast('Сохранено на GitHub. Сайт обновится примерно через минуту.', 4200); }
        catch (e) { App.toast(e.message, 6000); } finally { b.disabled = false; b.textContent = 'Сохранить на GitHub'; }
      };
    } else if (App.user) {
      const u = App.user;
      box.innerHTML = `<div class="me">${App.avatar(u, 36)}<div class="me-t"><b>${esc(u.name)}</b>${u.banned ? '<span class="role role-banned">Заблокирован</span>' : App.roleBadge(u.role) || '<span class="role">Гость</span>'}</div></div>
        <div class="row">${App.can('owner') ? '<button class="btn sm" id="openSettings">Настройки</button>' : ''}<button class="btn sm" id="logoutBtn">Выйти</button></div>`;
      $('logoutBtn').onclick = async () => { try { await App.api('POST', '/api/logout'); } catch (e) { } write(TOKEN_KEY, ''); location.reload(); };
    } else {
      box.innerHTML = `<button class="btn primary tg" id="loginBtn">Войти через Telegram</button><p class="note">Смотреть можно без входа. Писать — после входа.</p>`;
      $('loginBtn').onclick = openLogin;
    }
    if ($('openSettings')) { $('openSettings').onclick = () => openSettings(); buildSettings(); }
    buildLogin(); buildLightbox();
    mountChat($('navChat'));
  };
  App.mountTop = App.mountShell;
  /* tabs in a side panel: buttons [data-tab] switch sibling [data-pane] blocks */
  App.tabs = function (root, onSwitch) {
    const btns = [...root.querySelectorAll('[data-tab]')], panes = [...root.querySelectorAll('[data-pane]')];
    const show = name => { btns.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name))); panes.forEach(p => p.hidden = p.dataset.pane !== name); onSwitch && onSwitch(name); };
    btns.forEach(b => b.onclick = () => show(b.dataset.tab));
    return show;
  };

  /* ---------- images ---------- */
  App.imgUrl = id => CONFIG.api.replace(/\/+$/, '') + '/api/img/' + id;
  App.uploadImage = async function (file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('Это не картинка');
    let blob = file;
    if (!(file.type === 'image/gif' && file.size <= 1.4e6)) {
      const img = await new Promise((res, rej) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Не удалось открыть картинку')); }; im.src = u; });
      for (const [side, q] of [[1920, .86], [1600, .8], [1280, .72], [1000, .65]]) {
        const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        let b = await new Promise(r => c.toBlob(r, 'image/webp', q)); if (!b || b.type !== 'image/webp') b = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
        blob = b; if (b && b.size <= 1.45e6) break;
      }
    }
    if (!blob || blob.size > 1.6e6) throw new Error('Картинка слишком большая');
    const tk = read(TOKEN_KEY, '');
    const r = await fetch(CONFIG.api.replace(/\/+$/, '') + '/api/images', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': blob.type }, body: blob });
    let j = {}; try { j = await r.json(); } catch (e) { }
    if (!r.ok) throw new Error(j.error || 'Не удалось загрузить картинку');
    return j.id;
  };
  /* attachment picker: button + paste + drop, up to 4 pictures; returns {ids(), clear(), count()} */
  App.attach = function (holder, textarea, opts) {
    opts = opts || {}; const max = opts.max || 4, items = [];
    holder.classList.add('attach');
    holder.innerHTML = `<input type="file" accept="image/*" multiple hidden><div class="thumbs"></div>`;
    const input = holder.querySelector('input'), thumbs = holder.querySelector('.thumbs');
    const render = () => { thumbs.innerHTML = items.map((it, i) => `<span class="thumb"><img src="${it.url}" alt=""><button type="button" data-rm="${i}" aria-label="Убрать картинку">×</button></span>`).join(''); holder.classList.toggle('has', items.length > 0); if (opts.onChange) opts.onChange(items.length); };
    const add = files => { for (const f of files) { if (!/^image\//.test(f.type)) continue; if (items.length >= max) { App.toast(`Не больше ${max} картинок`); break; } items.push({ file: f, url: URL.createObjectURL(f) }); } render(); };
    input.onchange = () => { add(input.files); input.value = ''; };
    thumbs.onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { const [it] = items.splice(+b.dataset.rm, 1); URL.revokeObjectURL(it.url); render(); } };
    if (textarea) {
      textarea.addEventListener('paste', e => { const fs = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); add(fs); } });
      const zone = opts.zone || textarea;
      zone.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); zone.classList.add('drop'); } });
      zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
      zone.addEventListener('drop', e => { zone.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); add(e.dataTransfer.files); } });
    }
    return {
      pick() { input.click(); }, count: () => items.length,
      async ids() { const out = []; for (const it of items) { if (!it.id) it.id = await App.uploadImage(it.file); out.push(it.id); } return out; },
      clear() { items.splice(0).forEach(it => URL.revokeObjectURL(it.url)); render(); }
    };
  };
  App.gallery = (ids, cls) => ids && ids.length ? `<div class="gallery ${cls || ''}">${ids.map(i => `<a href="${App.imgUrl(i)}" data-lightbox><img src="${App.imgUrl(i)}" alt="Картинка" loading="lazy"></a>`).join('')}</div>` : '';
  function buildLightbox() {
    if ($('lightbox')) return;
    const d = document.createElement('dialog'); d.id = 'lightbox'; d.className = 'lightbox';
    d.innerHTML = '<button class="btn sm" data-close>Закрыть</button><img alt="">'; document.body.appendChild(d);
    d.onclick = e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); };
    document.addEventListener('click', e => { const a = e.target.closest('a[data-lightbox]'); if (!a) return; e.preventDefault(); d.querySelector('img').src = a.href; d.showModal(); });
  }

  /* ---------- chat in the menu column ---------- */
  function mountChat(el) {
    if (App.mode !== 'server') { el.innerHTML = '<p class="note pad-s">Чат заработает, когда подключён сервер.</p>'; return; }
    let msgs = [], lastId = 0, loaded = false;
    const mod = App.can('moderate'), me = App.user ? App.user.id : null;
    el.innerHTML = `<h2 class="chat-h">Чат легиона</h2>
      <div class="chat-feed" id="chatFeed" aria-live="polite"><p class="note pad-s">Загружаю…</p></div>
      <div class="chat-input" id="chatInput"></div>`;
    const feed = $('chatFeed'), input = $('chatInput');
    if (App.can('chat')) {
      input.innerHTML = `<div class="attach-h"></div><div class="row nowrap"><textarea id="chatMsg" rows="1" maxlength="1000" placeholder="Сообщение…" aria-label="Сообщение"></textarea>
        <button class="btn icon" id="chatClip" title="Прикрепить картинку" aria-label="Прикрепить картинку">${svg('clip', 18)}</button><button class="btn primary icon" id="chatSend" title="Отправить" aria-label="Отправить">${svg('send', 18)}</button></div>`;
      const ta = $('chatMsg'), att = App.attach(input.querySelector('.attach-h'), ta, { zone: el });
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; ta.style.overflowY = ta.scrollHeight > 140 ? 'auto' : 'hidden'; };
      ta.addEventListener('input', grow);
      $('chatClip').onclick = () => att.pick();
      const send = async () => {
        const t = ta.value.trim(); if (!t && !att.count()) return; $('chatSend').disabled = true;
        try { const images = await att.ids(); await App.api('POST', '/api/chat', { body: t, channel: 'talk', images }); ta.value = ''; grow(); att.clear(); await poll(); feed.scrollTop = feed.scrollHeight; }
        catch (e) { App.toast(e.message, 4000); } finally { $('chatSend').disabled = false; ta.focus(); }
      };
      $('chatSend').onclick = send;
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    } else if (!App.user) input.innerHTML = '<p class="note">Писать в чат могут участники легиона. <a href="#" id="chatLogin">Войти</a></p>';
    else input.innerHTML = `<p class="note">${App.user.banned ? 'Аккаунт заблокирован.' : 'Писать в чат могут участники. <a href="forum.html#new-apply">Подать заявление</a>'}</p>`;
    if ($('chatLogin')) $('chatLogin').onclick = e => { e.preventDefault(); openLogin(); };
    const day = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    function render(jump) {
      const list = msgs;
      const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
      if (!list.length) feed.innerHTML = `<p class="note pad-s">${loaded ? 'Сообщений пока нет.' : 'Загружаю…'}</p>`;
      else {
        let out = '', prev = null;
        for (const m of list) {
          if (!prev || day(prev.created) !== day(m.created)) out += `<div class="day">${day(m.created)}</div>`;
          const cont = prev && prev.author === m.author && m.created - prev.created < 5 * 60000 && day(prev.created) === day(m.created);
          const u = App.users[m.author];
          out += `<div class="cmsg${cont ? ' cont' : ''}">${cont ? '' : `<div class="cmh">${App.avatar(u, 22)}<b>${esc(App.userName(m.author))}</b><time title="${App.when(m.created)}">${new Date(m.created).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time></div>`}
            ${m.body ? `<div class="cmb">${App.text(m.body)}</div>` : ''}${App.gallery(m.images, 'sm')}
            ${(mod || me === m.author) ? `<button class="cdel" data-del="${m.id}" title="Удалить" aria-label="Удалить сообщение">×</button>` : ''}</div>`;
          prev = m;
        }
        feed.innerHTML = out;
      }
      if (jump || atBottom) feed.scrollTop = feed.scrollHeight;
    }
    feed.addEventListener('click', async e => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      if (d.dataset.arm !== '1') { d.dataset.arm = '1'; d.textContent = 'удалить?'; setTimeout(() => { if (d.isConnected) { d.dataset.arm = ''; d.textContent = '×'; } }, 3000); return; }
      try { await App.api('DELETE', '/api/chat/' + d.dataset.del); msgs = msgs.filter(m => m.id !== +d.dataset.del); render(); } catch (er) { App.toast(er.message, 4000); }
    });
    async function full() { const r = await App.api('GET', '/api/chat'); App.addUsers(r.users); msgs = r.messages; lastId = msgs.length ? msgs[msgs.length - 1].id : 0; loaded = true; render(!full.done); full.done = true; }
    async function poll() { const r = await App.api('GET', '/api/chat?after=' + lastId); App.addUsers(r.users); if (r.messages.length) { msgs = msgs.concat(r.messages).slice(-600); lastId = msgs[msgs.length - 1].id; render(); } }
    full().catch(e => { feed.innerHTML = `<p class="note pad-s">${esc(e.message)}</p>`; });
    App.every(poll, 5000); App.every(full, 120000);
  }

  /* ---------- login ---------- */
  function buildLogin() {
    if (App.mode !== 'server' || $('loginDlg')) return;
    const d = document.createElement('dialog'); d.id = 'loginDlg';
    d.innerHTML = `<div class="dh"><h2>Вход через Telegram</h2><button class="btn sm" data-close>Закрыть</button></div>
      <div class="db"><p class="note">Нажми кнопку и подтверди вход в Telegram. Сайт получит только твоё имя, ник и аватарку: телефон и переписка ему не видны.</p>
      <div id="tgBox" style="min-height:48px;display:flex;align-items:center"></div>
      <p class="note">После входа ты — гость: можешь писать на форуме. Ставить метки и писать в горячий чат можно после того, как владелец выдаст роль участника. Для этого напиши в разделе форума «Заявления».</p>
      <p class="note" id="loginMsg"></p></div>`;
    document.body.appendChild(d);
    d.querySelector('[data-close]').onclick = () => d.close();
  }
  function openLogin() {
    const d = $('loginDlg'); d.showModal();
    const box = $('tgBox');
    if (!CONFIG.bot) { box.innerHTML = '<p class="note">Не указано имя бота в js/config.js.</p>'; return; }
    if (box.childElementCount) return;
    window.onTelegramAuth = async user => {
      $('loginMsg').textContent = 'Проверяю…';
      try { const r = await App.api('POST', '/api/auth/telegram', user); write(TOKEN_KEY, r.token); location.reload(); }
      catch (e) { $('loginMsg').textContent = e.message; }
    };
    const s = document.createElement('script'); s.async = true; s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', CONFIG.bot.replace(/^@/, '')); s.setAttribute('data-size', 'large'); s.setAttribute('data-radius', '8');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)'); s.setAttribute('data-request-access', 'write'); s.setAttribute('data-lang', 'ru');
    s.onerror = () => { box.innerHTML = '<p class="note">Не загрузилась кнопка Telegram. Проверь интернет.</p>'; };
    box.appendChild(s);
    setTimeout(() => { if (!box.querySelector('iframe')) $('loginMsg').textContent = 'Если кнопка не появилась: проверь, что боту указан адрес сайта через /setdomain в @BotFather.'; }, 5000);
  }
  App.openLogin = openLogin;

  /* ---------- settings dialog ---------- */
  function buildSettings() {
    if ($('settingsDlg')) return;
    const d = document.createElement('dialog'); d.id = 'settingsDlg';
    const local = App.mode === 'local';
    d.innerHTML = `
      <div class="dh"><h2>Настройки</h2><button class="btn sm" data-close>Закрыть</button></div>
      <div class="db">
        <label class="f">Название мира<input type="text" id="setName" maxlength="60"></label>
        <label class="f">Сид мира<input type="text" id="setSeed" placeholder="например, -4172144997902289642"></label>
        <p class="note">Сид нужен для ссылки на Chunkbase. Он показывает только ванильный мир, моды из сборки там не видны.</p>
        ${local ? `<h3 id="ghHead">Синхронизация с GitHub</h3>
        <p class="note">Без неё всё хранится только в этом браузере. С ней кнопка «Сохранить на GitHub» записывает файл <b class="mono">data/world.json</b> прямо в репозиторий.</p>
        <div class="row"><label class="f grow">Владелец<input type="text" id="ghOwner" placeholder="твой логин"></label><label class="f grow">Репозиторий<input type="text" id="ghRepo" placeholder="legion-map"></label></div>
        <div class="row"><label class="f grow">Ветка<input type="text" id="ghBranch"></label><label class="f grow">Файл<input type="text" id="ghPath"></label></div>
        <label class="f">Токен доступа<input type="password" id="ghToken" autocomplete="off" placeholder="github_pat_…"></label>
        <p class="note">Создай на GitHub: Settings → Developer settings → Fine-grained tokens, только этот репозиторий, права <b>Contents: Read and write</b>. Токен хранится только в этом браузере.</p>
        <div class="row"><button class="btn" id="ghPull">Загрузить с GitHub</button><span class="note" id="ghMsg"></span></div>` : `<h3>Сервер</h3><p class="note">Данные хранятся на сервере. Здесь можно скачать резервную копию всего: метки, план, форум, чат, задачи, участники.</p>`}
        <h3>Файл данных</h3>
        <div class="row"><button class="btn" id="dlJson">${local ? 'Скачать world.json' : 'Скачать резервную копию'}</button>
          <label class="btn" for="upJson">${local ? 'Открыть world.json…' : 'Загрузить world.json на сервер…'}</label><input type="file" id="upJson" accept="application/json,.json" hidden></div>
        <p class="note">${local ? 'Без токена: скачай файл и загрузи его в папку <b class="mono">data/</b> репозитория через сайт GitHub.' : 'Загрузка world.json переносит на сервер метки, план и картинки карты из прежней версии сайта. Метки с теми же id обновятся.'}</p>
      </div>
      <div class="df"><button class="btn primary" id="setSave">Сохранить настройки</button></div>`;
    document.body.appendChild(d);
    d.querySelector('[data-close]').onclick = () => d.close();
    const ghRead = () => ({ owner: $('ghOwner').value.trim(), repo: $('ghRepo').value.trim(), branch: $('ghBranch').value.trim() || 'main', path: $('ghPath').value.trim() || 'data/world.json', token: $('ghToken').value.trim() });
    $('setSave').onclick = () => {
      if (!App.world) App.world = normalize(null);
      App.world.name = $('setName').value.trim() || 'Мир'; App.world.seed = $('setSeed').value.trim(); App.meta = { name: App.world.name, seed: App.world.seed };
      if (local) App.gh.set(ghRead());
      App.save('settings'); d.close(); App.toast('Настройки сохранены');
    };
    $('dlJson').onclick = async () => {
      if (local) return App.download('world.json', App.json());
      try { const j = await App.api('GET', '/api/export'); App.download('legion-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(j, null, 1)); } catch (e) { App.toast(e.message, 5000); }
    };
    $('upJson').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { await App.replace(JSON.parse(await f.text()), 'import'); App.toast('Файл загружен'); d.close(); }
      catch (err) { App.toast('Не получилось: ' + err.message, 5000); }
      e.target.value = '';
    };
    if (local) $('ghPull').onclick = async () => {
      App.gh.set(ghRead()); $('ghMsg').textContent = 'Загружаю…';
      try { const w = await App.gh.pull(); App.world = normalize(w); write(STORE_KEY, App.world); App.markClean(); App.emit('import'); $('ghMsg').textContent = 'Загружено с GitHub'; }
      catch (e) { $('ghMsg').textContent = e.message; }
    };
  }
  function openSettings(section) {
    buildSettings();
    $('setName').value = (App.world && App.world.name) || App.meta.name || ''; $('setSeed').value = (App.world && App.world.seed) || App.meta.seed || '';
    if (App.mode === 'local') { const c = App.gh.get(); $('ghOwner').value = c.owner; $('ghRepo').value = c.repo; $('ghBranch').value = c.branch; $('ghPath').value = c.path; $('ghToken').value = c.token; $('ghMsg').textContent = ''; }
    $('settingsDlg').showModal();
    if (section === 'gh' && $('ghHead')) setTimeout(() => $('ghHead').scrollIntoView({ block: 'start' }), 30);
  }
  App.openSettings = openSettings;
  window.addEventListener('beforeunload', e => { if (App.mode === 'local' && App.dirty && App.gh.ready()) { e.preventDefault(); e.returnValue = ''; } });

  App.pref = (k, d) => (Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : d);
  let prefTimer = 0;
  App.setPref = (k, v) => {
    prefs[k] = v; write('mcmap.prefs', prefs);
    if (App.mode === 'server' && App.user) { clearTimeout(prefTimer); prefTimer = setTimeout(() => App.api('PUT', '/api/prefs', prefs).catch(() => { }), 700); }
  };
  /* where a placed structure sits, in blocks: [x0, x1) × [z0, z1) */
  App.footprint = (def, s) => {
    if (!def) return null;
    if (def.kind === 'temple' || def.kind === 'lotus') { const N = App.TEMPLE_N, ox = s.cx * 16 + 8, oz = s.cz * 16 + 8; return { x0: ox - N, x1: ox + N + 1, z0: oz - N, z1: oz + N + 1, ox, oz }; }
    const odd = (s.rot || 0) % 2 === 1, W = odd ? def.d : def.w, D = odd ? def.w : def.d, x0 = s.cx * 16, z0 = s.cz * 16;
    return { x0, x1: x0 + W * 16, z0, z1: z0 + D * 16, ox: x0 + W * 8, oz: z0 + D * 8 };
  };

  /* shared constants */
  App.chunkOf = v => Math.floor(v / 16);
  App.TEMPLE_N = 89; App.TEMPLE_H = 84;     // Храм Лотоса: centre block ± 89, 84 high (see js/temple.js)
  window.App = App;
})();
