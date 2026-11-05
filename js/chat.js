/* Hot chat: short updates about what is happening on the base. Polls the server every few seconds. */
(async function () {
  const { $, esc } = App;
  await App.init(); App.mountTop('chat');
  const root = $('root'), box = $('feedBox'), comp = $('composer');
  if (App.mode !== 'server') { root.innerHTML = '<div class="ph" style="padding-top:8px"><div><h1>Горячий чат</h1></div></div><div class="notice">Чат работает, когда подключён сервер с входом через Telegram. Как его развернуть — в README.md.</div>'; return; }
  root.innerHTML = `<div class="ph" style="padding:4px 0 12px"><div><h1>Горячий чат</h1><p>Что сейчас делается на базе: кто что строит, что нужно принести, где сбор. Читать может любой.</p></div></div><div id="feed" class="feed" style="padding:0"><div class="empty">Загружаю…</div></div>`;
  const feed = $('feed');
  const mod = App.can('moderate'), me = App.user ? App.user.id : null;
  let msgs = [], lastId = 0;

  comp.hidden = false;
  if (App.can('chat')) {
    comp.innerHTML = `<textarea id="msg" maxlength="1000" placeholder="Например: строю склад у портала, нужен кварц" aria-label="Сообщение"></textarea><button class="btn primary" id="send">Отправить</button>`;
    const send = async () => {
      const t = $('msg').value.trim(); if (!t) return; $('send').disabled = true;
      try { await App.api('POST', '/api/chat', { body: t }); $('msg').value = ''; await poll(true); } catch (e) { App.toast(e.message, 4000); } finally { $('send').disabled = false; $('msg').focus(); }
    };
    $('send').onclick = send;
    $('msg').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  } else if (!App.user) {
    comp.innerHTML = `<p class="note grow" style="margin:0">Писать в чат могут участники.</p><button class="btn primary" id="loginChat">Войти через Telegram</button>`; $('loginChat').onclick = App.openLogin;
  } else {
    comp.innerHTML = `<p class="note grow" style="margin:0">${App.user.banned ? 'Аккаунт заблокирован.' : 'Писать в чат могут участники. Подай заявление на форуме, владелец выдаст роль.'}</p>${App.user.banned ? '' : '<a class="btn" href="forum.html">Открыть форум</a>'}`;
  }

  const day = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  function render() {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (!msgs.length) { feed.innerHTML = '<div class="empty">Сообщений пока нет.</div>'; return; }
    let out = '', prev = null;
    for (const m of msgs) {
      if (!prev || day(prev.created) !== day(m.created)) out += `<div class="day">${day(m.created)}</div>`;
      const cont = prev && prev.author === m.author && m.created - prev.created < 5 * 60000 && day(prev.created) === day(m.created);
      const u = App.users[m.author];
      out += `<div class="msg${cont ? ' cont' : ''}" data-id="${m.id}">${App.avatar(u, 32)}
        ${cont ? '' : `<div class="mh"><b>${esc(App.userName(m.author))}</b>${u ? App.roleBadge(u.role) : ''}<time title="${App.when(m.created)}">${new Date(m.created).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time></div>`}
        <div class="mh" style="align-items:flex-start"><div class="mb">${App.text(m.body)}</div>${(mod || me === m.author) ? `<button class="btn sm del" data-del="${m.id}" aria-label="Удалить сообщение">Удалить</button>` : ''}</div></div>`;
      prev = m;
    }
    feed.innerHTML = out;
    if (atBottom || !render.done) box.scrollTop = box.scrollHeight;
    render.done = true;
  }
  feed.addEventListener('click', async e => {
    const d = e.target.closest('[data-del]'); if (!d) return;
    if (d.dataset.arm !== '1') { d.dataset.arm = '1'; d.textContent = 'Точно?'; setTimeout(() => { d.dataset.arm = ''; d.textContent = 'Удалить'; }, 3000); return; }
    try { await App.api('DELETE', '/api/chat/' + d.dataset.del); msgs = msgs.filter(m => m.id !== +d.dataset.del); render(); } catch (er) { App.toast(er.message, 4000); }
  });
  async function full() { const r = await App.api('GET', '/api/chat'); App.addUsers(r.users); msgs = r.messages; lastId = msgs.length ? msgs[msgs.length - 1].id : 0; render(); }
  async function poll() {
    const r = await App.api('GET', '/api/chat?after=' + lastId); App.addUsers(r.users);
    if (r.messages.length) { msgs = msgs.concat(r.messages).slice(-400); lastId = msgs[msgs.length - 1].id; render(); }
  }
  try { await full(); } catch (e) { feed.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  App.every(poll, 4000);
  App.every(full, 90000);    // picks up deleted messages
})();
