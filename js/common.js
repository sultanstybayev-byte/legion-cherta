/* Shared data, storage and GitHub sync for the map and the planner.
   All data lives in one object (data/world.json in the repository). Every change is kept in this browser right away;
   "Сохранить на GitHub" commits the file through the GitHub API, "Скачать" gives the file to upload by hand. */
(function () {
  const STORE_KEY = 'mcmap.world.v1', BACKUP_KEY = 'mcmap.world.backup', GH_KEY = 'mcmap.github.v1', BASE_KEY = 'mcmap.remoteSavedAt';
  const $ = id => document.getElementById(id);
  const sgn = n => n > 0 ? '+' + n : n < 0 ? '−' + (-n) : '0';
  const fmt = n => Number(n).toLocaleString('ru-RU');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  function defaults() {
    return {
      version: 1, name: 'Мир легиона', seed: '', savedAt: 0,
      maps: { overworld: { image: '', x: 0, z: 0, bpp: 1 }, nether: { image: '', x: 0, z: 0, bpp: 1 }, end: { image: '', x: 0, z: 0, bpp: 1 } },
      markers: [],
      plan: {
        platform: { size: 16, cx0: -8, cz0: -8 },
        base: { placed: true, scale: 1, cx: 0, cz: 0, edits: [] },
        tasks: []
      }
    };
  }
  function normalize(w) {
    const d = defaults(); w = (w && typeof w === 'object') ? w : {};
    const out = Object.assign(d, w);
    out.maps = Object.assign(defaults().maps, w.maps || {});
    for (const k of ['overworld', 'nether', 'end']) out.maps[k] = Object.assign({ image: '', x: 0, z: 0, bpp: 1 }, out.maps[k] || {});
    out.markers = Array.isArray(w.markers) ? w.markers.filter(m => m && isFinite(m.x) && isFinite(m.z)) : [];
    const p = w.plan || {};
    out.plan = {
      platform: Object.assign(defaults().plan.platform, p.platform || {}),
      base: Object.assign(defaults().plan.base, p.base || {}),
      tasks: Array.isArray(p.tasks) ? p.tasks.filter(t => t && Array.isArray(t.chunks)) : []
    };
    if (!Array.isArray(out.plan.base.edits)) out.plan.base.edits = [];
    return out;
  }

  const listeners = [];
  const App = {
    world: null, dirty: false, remoteSavedAt: 0, $, sgn, fmt, uid, esc,
    onChange(fn) { listeners.push(fn); },
    async load() {
      let remote = null;
      try { const r = await fetch('data/world.json?ts=' + Date.now(), { cache: 'no-store' }); if (r.ok) remote = await r.json(); } catch (e) { /* opened from disk or file missing */ }
      const local = read(STORE_KEY, null);
      const rs = remote ? (remote.savedAt || 0) : 0, ls = local ? (local.savedAt || 0) : 0;
      if (local && ls > rs) { this.world = normalize(local); this.dirty = ls > read(BASE_KEY, 0); }
      else {
        if (local && ls && ls < rs) write(BACKUP_KEY, local);
        this.world = normalize(remote || local || null); this.dirty = false; write(BASE_KEY, rs);
        write(STORE_KEY, this.world);
      }
      this.remoteSavedAt = rs;
      return this.world;
    },
    save(why) {
      this.world.savedAt = Date.now();
      write(STORE_KEY, this.world);
      this.dirty = true; renderStatus();
      for (const fn of listeners) try { fn(why); } catch (e) { console.error(e); }
    },
    replace(w, why) { this.world = normalize(w); this.save(why || 'replace'); },
    markClean() { this.dirty = false; write(BASE_KEY, this.world.savedAt || 0); renderStatus(); },
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
        const r = method === 'GET'
          ? await fetch(url + '?ref=' + encodeURIComponent(c.branch), { headers: h, cache: 'no-store' })
          : await fetch(url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify(body) });
        return r;
      },
      async pull() {
        const r = await this.request('GET'); if (!r.ok) throw new Error(ghError(r.status));
        const j = await r.json(); return JSON.parse(fromB64(j.content));
      },
      async push(world) {
        let sha;
        const g = await this.request('GET');
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
  function renderStatus() {
    const st = $('saveStatus'); if (!st) return;
    st.classList.toggle('dirty', App.dirty);
    st.innerHTML = `<i></i>${App.dirty ? 'есть изменения не на GitHub' : 'всё сохранено'}`;
    const b = $('ghPush'); if (b) b.disabled = false;
  }
  App.mountTop = function (active) {
    const top = document.createElement('header'); top.className = 'top';
    top.innerHTML = `
      <div class="brand" id="brandName"></div>
      <nav class="tabs" aria-label="Разделы">
        <a href="index.html" ${active === 'map' ? 'aria-current="page"' : ''}>Карта</a>
        <a href="plan.html" ${active === 'plan' ? 'aria-current="page"' : ''}>Планирование</a>
      </nav>
      <div class="spacer"></div>
      <div class="status" id="saveStatus" aria-live="polite"></div>
      <button class="btn primary" id="ghPush">Сохранить на GitHub</button>
      <button class="btn" id="openSettings">Настройки</button>`;
    document.body.prepend(top);
    const nm = () => { const n = App.world.name || 'Мир'; const i = n.lastIndexOf(' '); $('brandName').innerHTML = i > 0 ? esc(n.slice(0, i)) + ' <span>' + esc(n.slice(i + 1)) + '</span>' : '<span>' + esc(n) + '</span>'; document.title = (active === 'map' ? 'Карта' : 'Планирование') + ' · ' + n; };
    nm(); App.onChange(nm); renderStatus();
    $('ghPush').onclick = async () => {
      if (!App.gh.ready()) { App.toast('Сначала настрой синхронизацию с GitHub'); openSettings('gh'); return; }
      const b = $('ghPush'); b.disabled = true; b.textContent = 'Сохраняю…';
      try { await App.gh.push(App.world); App.markClean(); App.toast('Сохранено на GitHub. Сайт обновится примерно через минуту.', 4200); }
      catch (e) { App.toast(e.message, 6000); }
      finally { b.disabled = false; b.textContent = 'Сохранить на GitHub'; }
    };
    $('openSettings').onclick = () => openSettings();
    buildSettings();
  };

  /* ---------- settings dialog ---------- */
  function buildSettings() {
    const d = document.createElement('dialog'); d.id = 'settingsDlg';
    d.innerHTML = `
      <div class="dh"><h2>Настройки</h2><button class="btn sm" data-close>Закрыть</button></div>
      <div class="db">
        <label class="f">Название мира<input type="text" id="setName" maxlength="60"></label>
        <label class="f">Сид мира<input type="text" id="setSeed" placeholder="например, -4172144997902289642"></label>
        <p class="note">Сид нужен для ссылки на Chunkbase. Он показывает только ванильный мир, моды из сборки там не видны.</p>
        <h3 id="ghHead">Синхронизация с GitHub</h3>
        <p class="note">Без неё всё хранится только в этом браузере. С ней кнопка «Сохранить на GitHub» записывает файл <b class="mono">data/world.json</b> прямо в репозиторий, и метки видят все, кто открывает сайт.</p>
        <div class="row"><label class="f grow">Владелец<input type="text" id="ghOwner" placeholder="твой логин"></label><label class="f grow">Репозиторий<input type="text" id="ghRepo" placeholder="legion-map"></label></div>
        <div class="row"><label class="f grow">Ветка<input type="text" id="ghBranch"></label><label class="f grow">Файл<input type="text" id="ghPath"></label></div>
        <label class="f">Токен доступа<input type="password" id="ghToken" autocomplete="off" placeholder="github_pat_…"></label>
        <p class="note">Создай на GitHub: Settings → Developer settings → Fine-grained tokens. Выбери только этот репозиторий и права <b>Contents: Read and write</b>. Токен хранится только в этом браузере. Никому его не отправляй.</p>
        <div class="row"><button class="btn" id="ghPull">Загрузить с GitHub</button><span class="note" id="ghMsg"></span></div>
        <h3>Файл данных</h3>
        <div class="row"><button class="btn" id="dlJson">Скачать world.json</button>
          <label class="btn" for="upJson">Открыть world.json…</label><input type="file" id="upJson" accept="application/json,.json" hidden></div>
        <p class="note">Без токена: скачай файл и загрузи его в папку <b class="mono">data/</b> репозитория через сайт GitHub (Add file → Upload files).</p>
      </div>
      <div class="df"><button class="btn primary" id="setSave">Сохранить настройки</button></div>`;
    document.body.appendChild(d);
    d.querySelector('[data-close]').onclick = () => d.close();
    $('setSave').onclick = () => {
      App.world.name = $('setName').value.trim() || 'Мир'; App.world.seed = $('setSeed').value.trim();
      App.gh.set({ owner: $('ghOwner').value.trim(), repo: $('ghRepo').value.trim(), branch: $('ghBranch').value.trim() || 'main', path: $('ghPath').value.trim() || 'data/world.json', token: $('ghToken').value.trim() });
      App.save('settings'); d.close(); App.toast('Настройки сохранены');
    };
    $('dlJson').onclick = () => App.download('world.json', App.json());
    $('upJson').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { App.replace(JSON.parse(await f.text()), 'import'); App.toast('Файл загружен'); d.close(); }
      catch (err) { App.toast('Это не похоже на world.json: ' + err.message, 5000); }
      e.target.value = '';
    };
    $('ghPull').onclick = async () => {
      App.gh.set({ owner: $('ghOwner').value.trim(), repo: $('ghRepo').value.trim(), branch: $('ghBranch').value.trim() || 'main', path: $('ghPath').value.trim() || 'data/world.json', token: $('ghToken').value.trim() });
      $('ghMsg').textContent = 'Загружаю…';
      try { const w = await App.gh.pull(); App.world = normalize(w); write(STORE_KEY, App.world); App.markClean(); for (const fn of listeners) fn('import'); $('ghMsg').textContent = 'Загружено с GitHub'; }
      catch (e) { $('ghMsg').textContent = e.message; }
    };
  }
  function openSettings(section) {
    const c = App.gh.get();
    $('setName').value = App.world.name || ''; $('setSeed').value = App.world.seed || '';
    $('ghOwner').value = c.owner; $('ghRepo').value = c.repo; $('ghBranch').value = c.branch; $('ghPath').value = c.path; $('ghToken').value = c.token; $('ghMsg').textContent = '';
    $('settingsDlg').showModal();
    if (section === 'gh') setTimeout(() => $('ghHead').scrollIntoView({ block: 'start' }), 30);
  }
  App.openSettings = openSettings;
  window.addEventListener('beforeunload', e => { if (App.dirty && App.gh.ready()) { e.preventDefault(); e.returnValue = ''; } });

  /* shared constants */
  App.chunkOf = v => Math.floor(v / 16);
  App.BASE_N = { '0.55': 40, '0.75': 54, '1': 73 };   // half-size of the base plaza in blocks, per scale
  App.SCALES = [[0.55, 'Компакт'], [0.75, 'Поменьше'], [1, 'Как на фото']];
  window.App = App;
})();
