/* Members: the owner gives roles and bans; moderators can see the list. */
(async function () {
  const { $, esc } = App;
  await App.init(); App.mountTop('users');
  const root = $('root');
  if (App.mode !== 'server') { root.innerHTML = '<div class="notice">Участники появляются, когда подключён сервер с входом через Telegram. Как его развернуть — в README.md.</div>'; return; }
  if (!App.can('seeUsers')) { root.innerHTML = '<div class="ph"><div><h1>Участники</h1></div></div><div class="notice">Эта страница доступна модераторам и владельцу.</div>'; return; }
  const owner = App.can('owner');
  let users = [], q = '', roleF = '';
  root.innerHTML = `
    <div class="ph"><div><h1>Участники</h1><p>${owner ? 'Здесь ты выдаёшь роли. Новые люди после входа через Telegram становятся гостями.' : 'Роли выдаёт владелец.'}</p></div></div>
    <div class="card pad"><div class="row" style="gap:18px;align-items:flex-start">
      <p class="note grow" style="min-width:220px"><b>Гость</b> — читает всё, пишет на форуме.<br><b>Участник</b> — плюс свои метки на карте и горячий чат; может двигать свои задачи.</p>
      <p class="note grow" style="min-width:220px"><b>Модератор</b> — плюс план базы, списки задач, правка любых меток, порядок на форуме и в чате.<br><b>Владелец</b> — всё, плюс роли и бан. Это ты.</p>
      <a class="btn" href="forum.html">Открыть заявления на форуме</a></div></div>
    <div class="row"><input type="search" id="uq" class="grow" placeholder="Поиск по имени или нику" aria-label="Поиск участников" style="max-width:360px">
      <div class="seg-tabs" id="rf"><button data-r="">Все</button><button data-r="guest">Гости</button><button data-r="member">Участники</button><button data-r="moderator">Модераторы</button><button data-r="banned">Заблокированы</button></div></div>
    <div class="card tw"><table class="utable"><thead><tr><th>Человек</th><th>Роль</th><th>Блок</th><th>Был на сайте</th><th>Впервые</th></tr></thead><tbody id="ub"></tbody></table></div>`;
  async function load() { const r = await App.api('GET', '/api/users'); users = r.users; render(); }
  function render() {
    const s = q.toLowerCase();
    const list = users.filter(u => (!s || (u.name + ' ' + u.username).toLowerCase().includes(s)) && (!roleF || (roleF === 'banned' ? u.banned : (u.role === roleF && !u.banned))));
    $('rf').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.r === roleF)));
    $('ub').innerHTML = list.length ? list.map(u => {
      const isOwner = u.role === 'owner';
      const roleCell = owner && !isOwner ? `<select data-role="${u.id}" aria-label="Роль ${esc(u.name)}">${['guest', 'member', 'moderator'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${App.ROLE_RU[r]}</option>`).join('')}</select>` : (App.roleBadge(u.role) || '<span class="role">Гость</span>');
      const banCell = owner && !isOwner ? `<button class="btn sm ${u.banned ? '' : 'danger'}" data-ban="${u.id}">${u.banned ? 'Разблокировать' : 'Заблокировать'}</button>` : (u.banned ? '<span class="role role-banned">Заблокирован</span>' : '');
      return `<tr><td class="u">${App.avatar(u, 30)}<span><b>${esc(u.name)}</b>${u.username ? `<br><a class="note" href="https://t.me/${esc(u.username)}" target="_blank" rel="noopener">@${esc(u.username)}</a>` : ''}</span></td>
        <td>${roleCell}</td><td>${banCell}</td><td class="mono note">${App.ago(u.last_seen)}</td><td class="mono note">${u.created ? new Date(u.created).toLocaleDateString('ru-RU') : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">Никого не найдено.</td></tr>';
  }
  $('uq').oninput = e => { q = e.target.value; render(); };
  $('rf').onclick = e => { const b = e.target.closest('button'); if (b) { roleF = b.dataset.r; render(); } };
  $('ub').addEventListener('change', async e => {
    const s = e.target.closest('[data-role]'); if (!s) return;
    try { const r = await App.api('PATCH', '/api/users/' + s.dataset.role, { role: s.value }); const i = users.findIndex(u => u.id === r.user.id); users[i] = Object.assign(users[i], r.user); App.toast(`${r.user.name}: ${App.ROLE_RU[r.user.role]}`); render(); }
    catch (er) { App.toast(er.message, 4000); load(); }
  });
  $('ub').addEventListener('click', async e => {
    const b = e.target.closest('[data-ban]'); if (!b) return;
    const u = users.find(x => x.id === +b.dataset.ban);
    if (!u.banned && b.dataset.arm !== '1') { b.dataset.arm = '1'; b.textContent = 'Точно?'; setTimeout(() => { if (b.isConnected) { b.dataset.arm = ''; b.textContent = 'Заблокировать'; } }, 3000); return; }
    try { const r = await App.api('PATCH', '/api/users/' + u.id, { banned: !u.banned }); Object.assign(u, r.user); render(); App.toast(u.banned ? 'Заблокирован' : 'Разблокирован'); } catch (er) { App.toast(er.message, 4000); }
  });
  try { await load(); } catch (e) { $('ub').innerHTML = `<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`; }
})();
