/* Home: what this site is, how to join, what's happening now, quick ways into each section. */
(async function () {
  const { $, esc, fmt, icon } = App;
  await App.init();
  await App.load();
  App.mountShell('home');
  const root = $('root'), W = App.world, srv = App.mode === 'server';
  const u = App.user, role = u ? (u.banned ? 'banned' : u.role) : 'anon';

  let tasks = { lists: [], items: [] }, threads = [];
  if (srv) {
    const [t, f] = await Promise.allSettled([App.api('GET', '/api/tasks'), App.api('GET', '/api/forum')]);
    if (t.status === 'fulfilled') { tasks = t.value; App.addUsers(t.value.users); }
    if (f.status === 'fulfilled') { threads = f.value.threads; App.addUsers(f.value.users); }
  }
  const doing = tasks.items.filter(i => i.status === 'doing'), todo = tasks.items.filter(i => i.status === 'todo');
  const listOf = id => tasks.lists.find(l => l.id === id);
  const chunks = W.plan.tasks.reduce((s, t) => s + t.chunks.length, 0);
  const mine = u ? tasks.items.filter(i => i.assignee === u.id && i.status !== 'done') : [];

  /* joining steps, depending on who is looking */
  const step = (state, title, text) => `<li class="${state}"><span><b>${title}</b>${text ? `<span class="note">${text}</span>` : ''}</span></li>`;
  let join = '';
  if (srv && (role === 'anon' || role === 'guest')) {
    const s1 = role === 'anon' ? 'now' : 'done', s2 = role === 'guest' ? 'now' : '';
    join = `<div class="card join"><h2>Как вступить в легион</h2><ol>
      ${step(s1, 'Войди через Telegram', 'Сайт получит только имя, ник и аватарку.')}
      ${step(s2, 'Напиши заявление на форуме', 'Ник в игре и чем хочешь заниматься.')}
      ${step('', 'Получи роль участника', 'Тогда можно ставить метки и писать в чат.')}</ol>
      ${role === 'anon' ? '<button class="btn tg" id="joinLogin">Войти через Telegram</button>' : '<a class="btn primary" href="forum.html#new-apply">Написать заявление</a>'}</div>`;
  } else if (srv && u) {
    const can = role === 'owner' ? 'Ты владелец: выдаёшь роли, меняешь всё.' : role === 'moderator' ? 'Ты модератор: план, задачи, любые метки, порядок на форуме и в чате.' : role === 'member' ? 'Ты участник: свои метки, чат, свои задачи.' : 'Аккаунт заблокирован: можно только смотреть.';
    join = `<div class="card join"><h2>Привет, ${esc(u.name)}</h2><p class="note">${can}</p>
      ${mine.length ? `<p class="note"><b>На тебе ${mine.length} задач:</b></p>${mine.slice(0, 4).map(i => `<a class="rowlink" style="padding:6px 0;border:0" href="tasks.html"><span class="lc" style="background:${esc((listOf(i.list) || {}).color || '#999')}"></span><span class="t">${esc(i.title)}</span><span class="m">${i.status === 'doing' ? 'в работе' : 'нужно сделать'}</span></a>`).join('')}` : ''}
      ${App.can('owner') ? '<a class="btn" href="users.html">Выдать роли новичкам</a>' : ''}</div>`;
  } else if (!srv) {
    join = `<div class="card join"><h2>Простой режим</h2><p class="note">Сейчас всё хранится в этом браузере. Вход через Telegram, форум, чат и задачи включатся, когда подключён сервер (README → «Шаг 3»).</p></div>`;
  }

  const tile = (href, ic, title, num, unit, text) => `<a class="card tile" href="${href}"><span class="ti">${icon(ic, 22)}${title}</span><span class="tn">${num}<small>${unit}</small></span><p>${text}</p></a>`;
  root.innerHTML = `
    <section class="hero">
      <div class="card hero-main">
        <h1>${esc((W.name || 'Мир').replace(/\s+\S+$/, ''))} <span>${esc((W.name || 'Мир').split(/\s+/).pop())}</span></h1>
        <p>Штаб легиона в мире Ascension of Ages: карта мира с метками, 3D-план базы «Лотос Легиона», общие задачи, форум и чат. Чат всегда слева, на любой странице.</p>
        <div class="row" style="margin-top:6px"><a class="btn primary" href="map.html">Открыть карту</a><a class="btn" href="plan.html">План базы</a>${srv ? '<a class="btn" href="tasks.html">Что делать</a>' : ''}</div>
      </div>
      ${join}
    </section>

    <section class="tiles">
      ${tile('map.html', 'map', 'Карта мира', fmt(W.markers.length), 'меток', 'Деревни, порталы, ресурсы. Наведи — координаты, правый клик — метка.')}
      ${tile('plan.html', 'plan', 'План базы', fmt(W.plan.tasks.length), 'зон', `${chunks} чанков размечено. База стоит в чанке ${App.sgn(W.plan.base.cx)}, ${App.sgn(W.plan.base.cz)}.`)}
      ${srv ? tile('tasks.html', 'tasks', 'Задачи', doing.length, 'в работе', `${todo.length} ждут исполнителя. Возьми любую в «Задачах».`) : ''}
      ${srv ? tile('forum.html', 'forum', 'Форум', threads.length, 'тем', 'Предложения, заявления на вступление, новости.') : ''}
    </section>

    ${srv ? `<section class="cols2">
      <div class="card"><h2 class="ch">Сейчас в работе <a href="tasks.html">Все задачи →</a></h2>
        ${doing.length ? doing.slice(0, 8).map(i => `<a class="rowlink" href="tasks.html"><span class="lc" style="background:${esc((listOf(i.list) || {}).color || '#999')}"></span><span class="t">${esc(i.title)}</span><span class="m">${i.assignee ? esc(App.userName(i.assignee)) : 'без исполнителя'}</span></a>`).join('') : '<p class="empty">Сейчас ничего не в работе.</p>'}</div>
      <div class="card"><h2 class="ch">Новое на форуме <a href="forum.html">Весь форум →</a></h2>
        ${threads.length ? threads.slice(0, 8).map(t => `<a class="rowlink" href="forum.html#t-${t.id}"><span class="t">${t.pinned ? 'Закреплено · ' : ''}${esc(t.title)}</span><span class="m">${esc(App.userName(t.author))} · ${App.ago(t.updated)}</span></a>`).join('') : '<p class="empty">Тем пока нет.</p>'}</div>
    </section>` : ''}

    <section class="card pad">
      <h2 style="margin:0 0 10px;font:600 16px var(--display)">Подсказки</h2>
      <div class="cols2" style="gap:6px 28px">
        <p class="note"><b>Координаты.</b> На карте наведи курсор — внизу X, Z, номер чанка и пересчёт в Незер.</p>
        <p class="note"><b>Метка.</b> Кнопка «+ Поставить метку» сверху карты или правый клик по точке.</p>
        <p class="note"><b>План.</b> В 3D: W A S D — полёт, мышь — обзор, клик — чанк. «Выделить рамкой» — сразу много чанков.</p>
        <p class="note"><b>Картинки.</b> В чат и на форум можно вставить скриншот через Ctrl+V.</p>
      </div>
    </section>`;
  if ($('joinLogin')) $('joinLogin').onclick = App.openLogin;
})();
