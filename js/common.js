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
    out.plan = { platform: Object.assign(defaults().plan.platform, p.platform || {}), base: Object.assign(defaults().plan.base, p.base || {}), tasks: Array.isArray(p.tasks) ? p.tasks.filter(t => t && Array.isArray(t.chunks)) : [] };
    if (!Array.isArray(out.plan.base.edits)) out.plan.base.edits = [];
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
      try { const me = await this.api('GET', '/api/me'); this.user = me.user; if (me.meta) this.meta = me.meta; if (me.user) this.users[me.user.id] = me.user; }
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
      if (['plan', 'tasks', 'base', 'platform'].includes(why)) {
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

  /* ---------- top bar ---------- */
  function setStatus(text, warn) { const st = $('saveStatus'); if (!st) return; st.classList.toggle('dirty', !!warn); st.innerHTML = `<i></i>${esc(text)}`; }
  function renderStatus() { if (App.mode === 'local') setStatus(App.dirty ? 'есть изменения не на GitHub' : 'всё сохранено', App.dirty); }
  App.mountTop = function (active) {
    const top = document.createElement('header'); top.className = 'top';
    const tabs = [['map', 'index.html', 'Карта'], ['plan', 'plan.html', 'План'], ['tasks', 'tasks.html', 'Задачи'], ['forum', 'forum.html', 'Форум'], ['chat', 'chat.html', 'Горячий чат']];
    if (App.mode === 'server' && App.can('seeUsers')) tabs.push(['users', 'users.html', 'Участники']);
    const shown = App.mode === 'server' ? tabs : tabs.slice(0, 2);
    top.innerHTML = `
      <div class="brand" id="brandName"></div>
      <nav class="tabs" aria-label="Разделы">${shown.map(([k, h, n]) => `<a href="${h}" ${active === k ? 'aria-current="page"' : ''}>${n}</a>`).join('')}</nav>
      <div class="spacer"></div>
      <div class="status" id="saveStatus" aria-live="polite"></div>
      <div class="row" id="topRight"></div>`;
    document.body.prepend(top);
    const nm = () => { const n = (App.world && App.world.name) || App.meta.name || 'Мир'; const i = n.lastIndexOf(' '); $('brandName').innerHTML = i > 0 ? esc(n.slice(0, i)) + ' <span>' + esc(n.slice(i + 1)) + '</span>' : '<span>' + esc(n) + '</span>'; document.title = (shown.find(t => t[0] === active) || [, , ''])[2] + ' · ' + n; };
    nm(); App.onChange(nm);
    const right = $('topRight');
    if (App.mode === 'local') {
      right.innerHTML = `<button class="btn primary" id="ghPush">Сохранить на GitHub</button><button class="btn" id="openSettings">Настройки</button>`;
      renderStatus();
      $('ghPush').onclick = async () => {
        if (!App.gh.ready()) { App.toast('Сначала настрой синхронизацию с GitHub'); openSettings('gh'); return; }
        const b = $('ghPush'); b.disabled = true; b.textContent = 'Сохраняю…';
        try { await App.gh.push(App.world); App.markClean(); App.toast('Сохранено на GitHub. Сайт обновится примерно через минуту.', 4200); }
        catch (e) { App.toast(e.message, 6000); } finally { b.disabled = false; b.textContent = 'Сохранить на GitHub'; }
      };
    } else if (App.user) {
      const u = App.user;
      right.innerHTML = `<span class="me">${App.avatar(u, 26)}<span class="me-n">${esc(u.name)}</span>${u.banned ? '<span class="role role-banned">Заблокирован</span>' : App.roleBadge(u.role) || '<span class="role">Гость</span>'}</span>
        ${App.can('owner') ? '<button class="btn" id="openSettings">Настройки</button>' : ''}<button class="btn" id="logoutBtn">Выйти</button>`;
      $('logoutBtn').onclick = async () => { try { await App.api('POST', '/api/logout'); } catch (e) { } write(TOKEN_KEY, ''); location.reload(); };
    } else {
      right.innerHTML = `<button class="btn primary" id="loginBtn">Войти через Telegram</button>`;
      $('loginBtn').onclick = openLogin;
    }
    if ($('openSettings')) { $('openSettings').onclick = () => openSettings(); buildSettings(); }
    buildLogin();
  };

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

  /* shared constants */
  App.chunkOf = v => Math.floor(v / 16);
  App.BASE_N = { '0.55': 40, '0.75': 54, '1': 73 };
  App.SCALES = [[0.55, 'Компакт'], [0.75, 'Поменьше'], [1, 'Как на фото']];
  window.App = App;
})();
