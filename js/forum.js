/* Forum: suggestions, applications, general talk, news. Routes: #t-123 opens a thread. */
(async function () {
  const { $, esc } = App;
  await App.init(); App.mountTop('forum');
  const root = $('root');
  if (App.mode !== 'server') { root.innerHTML = needServer(); return; }
  const CATS = { idea: 'Предложения', apply: 'Заявления', talk: 'Общее', news: 'Новости' };
  const CAT_HINT = { idea: 'Идеи для базы, мира и сайта.', apply: 'Хочешь роль участника? Напиши ник в игре и чем хочешь заниматься.', talk: 'Обо всём остальном.', news: 'Объявления модераторов.' };
  let cat = ''; try { cat = sessionStorage.getItem('forum.cat') || ''; } catch (e) { }
  let timer = 0;
  window.addEventListener('hashchange', route); route();

  function route() { clearInterval(timer); const m = location.hash.match(/^#t-(\d+)$/); if (m) showThread(+m[1]); else showList(/^#new-(idea|apply|talk|news)$/.test(location.hash) ? location.hash.slice(5) : null); }
  const who = id => App.users[id];
  const catChip = c => `<span class="cat cat-${c}">${CATS[c] || c}</span>`;

  /* ---------- list ---------- */
  async function showList(openCat) {
    root.innerHTML = `
      <div class="ph"><div><h1>Форум</h1><p>Предложения, заявления на вступление и общие разговоры. Читать может любой, писать — после входа через Telegram.</p></div>
        <div class="row">${App.can('post') ? '<button class="btn primary" id="newBtn">Новая тема</button>' : App.user ? '' : '<button class="btn primary" id="loginHere">Войти, чтобы писать</button>'}</div></div>
      ${App.user && App.user.role === 'guest' && !App.user.banned ? '<div class="notice">Ты пока гость. Чтобы ставить метки на карте и писать в горячий чат, создай тему в разделе <b>«Заявления»</b>: ник в игре и чем хочешь заниматься. Владелец выдаст роль участника.</div>' : ''}
      <div class="card pad" id="newForm" hidden>
        <div class="row"><label class="f" style="min-width:180px">Раздел<select id="nCat">${Object.entries(CATS).filter(([k]) => k !== 'news' || App.can('moderate')).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="f grow">Заголовок<input type="text" id="nTitle" maxlength="120"></label></div>
        <p class="note" id="nHint" style="margin:6px 0"></p>
        <label class="f">Текст<textarea id="nBody" maxlength="8000" style="min-height:160px" placeholder="Картинку можно вставить сюда через Ctrl+V или перетащить"></textarea></label>
        <div id="nAtt" style="margin-top:8px"></div>
        <div class="composer-tools"><button class="btn primary" id="nSend">Опубликовать</button><button class="btn" id="nClip">${App.icon('clip', 18)}Прикрепить картинку</button><button class="btn" id="nCancel">Отмена</button></div>
      </div>
      <div class="seg-tabs" id="cats"><button data-c="">Все</button>${Object.entries(CATS).map(([k, v]) => `<button data-c="${k}">${v}</button>`).join('')}</div>
      <div class="card threads" id="list"><div class="empty">Загружаю…</div></div>`;
    if ($('loginHere')) $('loginHere').onclick = App.openLogin;
    const openNew = c => { if (!$('newForm')) return; $('newForm').hidden = false; c = c || cat; if (c && $('nCat').querySelector(`[value="${c}"]`)) $('nCat').value = c; hint(); $('nTitle').focus(); };
    if ($('newBtn')) $('newBtn').onclick = () => openNew();
    const nAtt = $('nBody') ? App.attach($('nAtt'), $('nBody')) : null;
    if ($('nClip')) $('nClip').onclick = () => nAtt.pick();
    const hint = () => { $('nHint').textContent = CAT_HINT[$('nCat').value] || ''; };
    if ($('nCat')) { $('nCat').onchange = hint; $('nCancel').onclick = () => { $('newForm').hidden = true; };
      $('nSend').onclick = async () => {
        const b = $('nSend'); b.disabled = true;
        try { const images = await nAtt.ids(); const r = await App.api('POST', '/api/forum', { cat: $('nCat').value, title: $('nTitle').value, body: $('nBody').value, images }); nAtt.clear(); location.hash = '#t-' + r.id; }
        catch (e) { App.toast(e.message, 5000); } finally { b.disabled = false; }
      }; }
    const sync = () => $('cats').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === cat)));
    $('cats').onclick = e => { const b = e.target.closest('button'); if (!b) return; cat = b.dataset.c; try { sessionStorage.setItem('forum.cat', cat); } catch (er) { } sync(); load(); };
    sync();
    if (openCat) { if (App.can('post')) setTimeout(() => openNew(openCat), 0); else if (!App.user) App.openLogin(); }
    async function load() {
      try {
        const r = await App.api('GET', '/api/forum' + (cat ? '?cat=' + cat : '')); App.addUsers(r.users);
        $('list').innerHTML = r.threads.length ? r.threads.map(t => `<a class="thread" href="#t-${t.id}">
            <span class="tt">${t.pinned ? '<span class="flag">Закреплено · </span>' : ''}${esc(t.title)}</span>
            <span class="tm">${catChip(t.cat)}<span>${esc(App.userName(t.author))}</span><span>· ${App.ago(t.updated)}</span>${t.closed ? '<span class="flag">· закрыта</span>' : ''}</span>
            <span class="tc">${t.posts - 1} отв.</span></a>`).join('')
          : `<div class="empty">${cat ? 'В этом разделе пока нет тем.' : 'Тем пока нет. Будь первым.'}</div>`;
      } catch (e) { $('list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    }
    load(); timer = setInterval(() => { if (!document.hidden && $('newForm') && $('newForm').hidden) load(); }, 30000);
  }

  /* ---------- thread ---------- */
  async function showThread(id) {
    root.innerHTML = '<div class="empty">Загружаю…</div>';
    let data;
    async function load() { data = await App.api('GET', '/api/forum/' + id); App.addUsers(data.users); }
    try { await load(); } catch (e) { root.innerHTML = `<p><a href="#">← К списку тем</a></p><div class="empty">${esc(e.message)}</div>`; return; }
    const mod = App.can('moderate'), me = App.user ? App.user.id : null;
    function render() {
      const t = data.thread;
      const canDelThread = mod || (me === t.author && t.posts <= 1);
      root.innerHTML = `
        <p style="margin:0"><a href="#">← К списку тем</a></p>
        <div class="ph"><div><h1>${esc(t.title)}</h1><p>${catChip(t.cat)} ${t.pinned ? '<span class="flag">закреплено</span>' : ''} ${t.closed ? '<span class="flag">закрыта</span>' : ''}</p></div>
          <div class="row">${mod ? `<button class="btn sm" id="pinBtn">${t.pinned ? 'Открепить' : 'Закрепить'}</button><button class="btn sm" id="closeBtn">${t.closed ? 'Открыть' : 'Закрыть'}</button>
            <select id="moveCat" aria-label="Перенести в раздел" style="width:auto">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === t.cat ? 'selected' : ''}>${v}</option>`).join('')}</select>` : ''}
            ${canDelThread ? '<button class="btn sm danger" id="delThread">Удалить тему</button>' : ''}</div></div>
        <div class="card" id="posts">${data.posts.map((p, i) => postHtml(p, i === 0)).join('')}</div>
        ${App.can('post') && (!t.closed || mod) ? `<div class="card pad"><label class="f">Ответ<textarea id="reply" maxlength="8000" style="min-height:110px" placeholder="Картинку можно вставить через Ctrl+V или перетащить"></textarea></label><div id="rAtt" style="margin-top:8px"></div><div class="composer-tools"><button class="btn primary" id="sendReply">Ответить</button><button class="btn" id="rClip">${App.icon('clip', 18)}Прикрепить картинку</button></div></div>`
          : t.closed ? '<p class="note">Тема закрыта для ответов.</p>' : App.user ? '' : '<p class="note"><a href="#" id="loginReply">Войди через Telegram</a>, чтобы ответить.</p>'}`;
      bind();
    }
    function postHtml(p, first) {
      const u = who(p.author), mine = me === p.author;
      return `<div class="post" data-id="${p.id}">${App.avatar(u, 40)}
        <div class="pm"><b>${esc(App.userName(p.author))}</b>${u ? App.roleBadge(u.role) : ''}<span class="note">${App.when(p.created)}${p.edited ? ' · изменено' : ''}</span></div>
        <div><div class="pb">${App.text(p.body)}</div>${App.gallery(p.images)}
          ${(mine || mod) ? `<div class="pa"><button class="btn sm" data-edit="${p.id}">Изменить</button>${!first ? `<button class="btn sm danger" data-del="${p.id}">Удалить</button>` : ''}</div>` : ''}</div></div>`;
    }
    function bind() {
      const t = data.thread;
      if ($('loginReply')) $('loginReply').onclick = e => { e.preventDefault(); App.openLogin(); };
      if ($('pinBtn')) $('pinBtn').onclick = () => patch({ pinned: !t.pinned });
      if ($('closeBtn')) $('closeBtn').onclick = () => patch({ closed: !t.closed });
      if ($('moveCat')) $('moveCat').onchange = e => patch({ cat: e.target.value });
      let arm = 0;
      if ($('delThread')) $('delThread').onclick = async () => {
        if (Date.now() - arm > 3000) { arm = Date.now(); $('delThread').textContent = 'Точно удалить?'; return; }
        try { await App.api('DELETE', '/api/forum/' + id); App.toast('Тема удалена'); location.hash = ''; } catch (e) { App.toast(e.message, 5000); }
      };
      const rAtt = $('reply') ? App.attach($('rAtt'), $('reply')) : null;
      if ($('rClip')) $('rClip').onclick = () => rAtt.pick();
      if ($('sendReply')) $('sendReply').onclick = async () => {
        const b = $('sendReply'); b.disabled = true;
        try { const images = await rAtt.ids(); await App.api('POST', '/api/forum/' + id, { body: $('reply').value, images }); await load(); render(); const pg = document.querySelector('.main>.page'); if (pg) pg.scrollTop = pg.scrollHeight; }
        catch (e) { App.toast(e.message, 5000); b.disabled = false; }
      };
      $('posts').onclick = async e => {
        const d = e.target.closest('[data-del]'), ed = e.target.closest('[data-edit]');
        if (d) {
          if (d.dataset.arm !== '1') { d.dataset.arm = '1'; d.textContent = 'Точно?'; setTimeout(() => { d.dataset.arm = ''; d.textContent = 'Удалить'; }, 3000); return; }
          try { await App.api('DELETE', '/api/posts/' + d.dataset.del); await load(); render(); } catch (er) { App.toast(er.message, 5000); }
        }
        if (ed) {
          const p = data.posts.find(q => q.id === +ed.dataset.edit), box = ed.closest('.post').querySelector('.pb');
          box.innerHTML = `<textarea maxlength="8000" style="min-height:100px">${esc(p.body)}</textarea><div class="row" style="margin-top:6px"><button class="btn sm primary" data-save>Сохранить</button><button class="btn sm" data-cancel>Отмена</button></div>`;
          ed.parentElement.hidden = true;
          box.querySelector('[data-cancel]').onclick = () => render();
          box.querySelector('[data-save]').onclick = async () => { try { await App.api('PATCH', '/api/posts/' + p.id, { body: box.querySelector('textarea').value }); await load(); render(); } catch (er) { App.toast(er.message, 5000); } };
        }
      };
    }
    async function patch(b) { try { await App.api('PATCH', '/api/forum/' + id, b); await load(); render(); } catch (e) { App.toast(e.message, 5000); } }
    render(); const pg0 = document.querySelector('.main>.page'); if (pg0) pg0.scrollTop = 0;
    timer = setInterval(async () => {
      if (document.hidden || (document.activeElement && document.activeElement.tagName === 'TEXTAREA') || root.querySelector('.pb textarea')) return;
      const n = data.posts.length; try { await load(); if (data.posts.length !== n) render(); } catch (e) { }
    }, 20000);
  }

  function needServer() {
    return `<div class="ph"><div><h1>Форум</h1></div></div><div class="notice">Форум, горячий чат и задачи работают, когда подключён сервер с входом через Telegram. Как его развернуть — в файле <b>README.md</b>, раздел «Сервер и вход через Telegram».</div>`;
  }
})();
