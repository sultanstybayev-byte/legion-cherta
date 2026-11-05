/* Task lists as a three-column board. Moderators edit; an assignee can move their own card. */
(async function () {
  const { $, esc } = App;
  await App.init(); App.mountTop('tasks');
  const root = $('root');
  if (App.mode !== 'server') { root.innerHTML = '<div class="ph"><div><h1>Задачи</h1></div></div><div class="notice">Списки задач работают, когда подключён сервер с входом через Telegram. Как его развернуть — в README.md.</div>'; return; }
  const ST = [['todo', 'Нужно сделать'], ['doing', 'В работе'], ['done', 'Готово']];
  const SW = ['#e07b2a', '#c0392b', '#d4ac0d', '#27ae60', '#16a085', '#2e86c1', '#7d3c98', '#d35490', '#6e2c00', '#5d6d7e'];
  const mod = App.can('tasks'), me = App.user ? App.user.id : null;
  let data = { lists: [], items: [] }, filter = '', people = [];

  root.innerHTML = `
    <div class="ph"><div><h1>Задачи</h1><p>Что нужно сделать на базе и кто этим занят. Списки ведут модераторы. Карточку можно зажать мышью и перетащить в другую колонку: модераторы двигают любые, участники — свои.</p></div>
      <div class="row">${mod ? '<button class="btn" id="addList">+ Список</button><button class="btn primary" id="addItem">+ Задача</button>' : ''}</div></div>
    <div class="lists" id="lists"></div>
    <div class="board" id="board"></div>
    <dialog id="itemDlg"><div class="dh"><h2 id="itemHead">Задача</h2><button class="btn sm" data-close>Закрыть</button></div>
      <div class="db">
        <label class="f">Что сделать<input type="text" id="iTitle" maxlength="160"></label>
        <div class="row"><label class="f grow">Список<select id="iList"></select></label><label class="f grow">Статус<select id="iStatus">${ST.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
        <label class="f">Исполнитель<select id="iWho"></select></label>
        <label class="f">Подробности<textarea id="iNote" maxlength="2000" placeholder="сколько, где взять, куда отнести"></textarea></label>
      </div>
      <div class="df"><button class="btn danger" id="iDel" hidden>Удалить</button><span class="spacer"></span><button class="btn primary" id="iSave">Сохранить</button></div></dialog>
    <dialog id="listDlg"><div class="dh"><h2 id="listHead">Список</h2><button class="btn sm" data-close>Закрыть</button></div>
      <div class="db"><label class="f">Название<input type="text" id="lName" maxlength="60" placeholder="например, Склады"></label>
        <div class="row"><div class="swatches" id="lSw"></div><input type="color" id="lColor" value="#e07b2a" aria-label="Свой цвет"></div>
        <p class="note" id="lNote"></p></div>
      <div class="df"><button class="btn danger" id="lDel" hidden>Удалить список с задачами</button><span class="spacer"></span><button class="btn primary" id="lSave">Сохранить</button></div></dialog>`;
  document.querySelectorAll('dialog [data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());

  async function load() { const r = await App.api('GET', '/api/tasks'); App.addUsers(r.users); data = r; render(); }
  async function loadPeople() { if (!mod || people.length) return; try { const r = await App.api('GET', '/api/users'); people = r.users.filter(u => u.role !== 'guest' && !u.banned); App.addUsers(Object.fromEntries(r.users.map(u => [u.id, u]))); } catch (e) { } }
  const listOf = id => data.lists.find(l => l.id === id);
  function render() {
    $('lists').innerHTML = `<button class="lchip" data-l="" aria-pressed="${filter === ''}">Все списки</button>` + data.lists.map(l => `<button class="lchip" data-l="${l.id}" aria-pressed="${filter === String(l.id)}"><i style="background:${esc(l.color)}"></i>${esc(l.name)} <span class="note">${data.items.filter(i => i.list === l.id && i.status !== 'done').length}</span></button>${mod ? `<button class="btn sm" data-editlist="${l.id}" aria-label="Изменить список ${esc(l.name)}">✎</button>` : ''}`).join('')
      + (data.lists.length ? '' : `<span class="note">${mod ? 'Списков пока нет. Создай первый: «+ Список».' : 'Списков пока нет.'}</span>`);
    const items = data.items.filter(i => !filter || String(i.list) === filter);
    $('board').innerHTML = ST.map(([k, v], si) => {
      const cs = items.filter(i => i.status === k);
      return `<section class="col" data-st="${k}"><h2>${v}<span>${cs.length}</span></h2><div class="cards">${cs.map(i => card(i)).join('') || '<p class="note" style="padding:4px">Пусто</p>'}</div></section>`;
    }).join('');
  }
  function card(i) {
    const l = listOf(i.list), mine = me && i.assignee === me, canMove = mod || mine, u = i.assignee ? App.users[i.assignee] : null;
    return `<article class="tcard${canMove ? ' drag' : ''}" data-id="${i.id}" style="--lc:${esc(l ? l.color : '#999')}"${canMove ? ' title="Зажми и перетащи в другую колонку"' : ''}>
      <div class="tt">${esc(i.title)}</div>${i.note ? `<div class="tn">${App.text(i.note)}</div>` : ''}
      <div class="tf">${l ? `<span>${esc(l.name)}</span>` : ''}<span class="grow"></span>${u ? `${App.avatar(u, 20)}<span>${esc(u.name)}</span>` : i.assignee ? `<span>${esc(App.userName(i.assignee))}</span>` : '<span>без исполнителя</span>'}</div>
      ${mod ? `<div class="tf"><span class="grow"></span><button class="btn sm" data-edit="${i.id}">Изменить</button></div>` : ''}
    </article>`;
  }
  $('lists').onclick = e => {
    const el = e.target.closest('[data-editlist]'); if (el) { openList(listOf(+el.dataset.editlist)); return; }
    const b = e.target.closest('[data-l]'); if (!b) return; filter = b.dataset.l; render();
  };
  $('board').onclick = e => {
    if (Date.now() - dropped < 300) return;
    const ed = e.target.closest('[data-edit]'); if (ed) openItem(data.items.find(i => i.id === +ed.dataset.edit));
  };

  /* drag a card into another column: press, hold and move */
  let dnd = null, dropped = 0, busy = false;
  $('board').addEventListener('pointerdown', e => {
    const c = e.target.closest('.tcard.drag'); if (!c || e.button !== 0 || e.target.closest('button, a')) return;
    dnd = { c, id: +c.dataset.id, x: e.clientX, y: e.clientY, on: false, pid: e.pointerId };
  });
  const colAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('.col[data-st]'); };
  window.addEventListener('pointermove', e => {
    if (!dnd || e.pointerId !== dnd.pid) return;
    if (!dnd.on) {
      if (Math.abs(e.clientX - dnd.x) + Math.abs(e.clientY - dnd.y) < 6) return;
      const r = dnd.c.getBoundingClientRect(); dnd.on = true; dnd.dx = e.clientX - r.left; dnd.dy = e.clientY - r.top;
      dnd.ghost = dnd.c.cloneNode(true); dnd.ghost.classList.add('ghost'); dnd.ghost.style.width = r.width + 'px'; document.body.appendChild(dnd.ghost);
      dnd.c.classList.add('lifted'); document.body.classList.add('dragging');
    }
    e.preventDefault();
    dnd.ghost.style.transform = `translate(${e.clientX - dnd.dx}px, ${e.clientY - dnd.dy}px) rotate(1.5deg)`;
    const col = colAt(e.clientX, e.clientY);
    document.querySelectorAll('.col.over').forEach(x => x !== col && x.classList.remove('over')); if (col) col.classList.add('over');
  });
  const endDrag = async e => {
    if (!dnd || e.pointerId !== dnd.pid) return; const d = dnd; dnd = null;
    if (!d.on) return;
    d.ghost.remove(); d.c.classList.remove('lifted'); document.body.classList.remove('dragging'); dropped = Date.now();
    document.querySelectorAll('.col.over').forEach(x => x.classList.remove('over'));
    const col = e.type === 'pointerup' && colAt(e.clientX, e.clientY), it = data.items.find(i => i.id === d.id);
    if (!col || !it || col.dataset.st === it.status || busy) return;
    const was = it.status; it.status = col.dataset.st; render(); busy = true;     // move right away, roll back if the server says no
    try { await App.api('PATCH', '/api/items/' + it.id, { status: it.status }); } catch (er) { it.status = was; render(); App.toast(er.message, 4000); }
    busy = false;
  };
  window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag);

  /* item dialog */
  let editingItem = null;
  async function openItem(it) {
    if (!data.lists.length) { App.toast('Сначала создай список'); openList(null); return; }
    await loadPeople(); editingItem = it || null;
    $('itemHead').textContent = it ? 'Изменить задачу' : 'Новая задача';
    $('iList').innerHTML = data.lists.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    $('iWho').innerHTML = '<option value="">Без исполнителя</option>' + people.map(u => `<option value="${u.id}">${esc(u.name)}${u.username ? ' (@' + esc(u.username) + ')' : ''}</option>`).join('');
    $('iTitle').value = it ? it.title : ''; $('iNote').value = it ? (it.note || '') : '';
    $('iList').value = String(it ? it.list : (filter || data.lists[0].id)); $('iStatus').value = it ? it.status : 'todo';
    if (it && it.assignee && !people.some(p => p.id === it.assignee)) $('iWho').insertAdjacentHTML('beforeend', `<option value="${it.assignee}">${esc(App.userName(it.assignee))}</option>`);
    $('iWho').value = it && it.assignee ? String(it.assignee) : '';
    $('iDel').hidden = !it; $('iDel').textContent = 'Удалить'; $('iDel').dataset.arm = '';
    $('itemDlg').showModal(); $('iTitle').focus();
  }
  $('iSave').onclick = async () => {
    const b = { title: $('iTitle').value, note: $('iNote').value, list: +$('iList').value, status: $('iStatus').value, assignee: $('iWho').value ? +$('iWho').value : null };
    try { if (editingItem) await App.api('PATCH', '/api/items/' + editingItem.id, b); else await App.api('POST', '/api/items', b); $('itemDlg').close(); await load(); } catch (e) { App.toast(e.message, 4000); }
  };
  $('iDel').onclick = async () => {
    if ($('iDel').dataset.arm !== '1') { $('iDel').dataset.arm = '1'; $('iDel').textContent = 'Точно удалить?'; return; }
    try { await App.api('DELETE', '/api/items/' + editingItem.id); $('itemDlg').close(); await load(); } catch (e) { App.toast(e.message, 4000); }
  };

  /* list dialog */
  let editingList = null, lColor = SW[0];
  $('lSw').innerHTML = SW.map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="Цвет ${c}"></button>`).join('');
  const syncSw = () => $('lSw').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c.toLowerCase() === lColor.toLowerCase())));
  $('lSw').onclick = e => { if (e.target.dataset.c) { lColor = e.target.dataset.c; $('lColor').value = lColor; syncSw(); } };
  $('lColor').oninput = e => { lColor = e.target.value; syncSw(); };
  function openList(l) {
    editingList = l || null; $('listHead').textContent = l ? 'Изменить список' : 'Новый список';
    $('lName').value = l ? l.name : ''; lColor = l ? l.color : SW[data.lists.length % SW.length]; $('lColor').value = lColor; syncSw();
    $('lDel').hidden = !l; $('lDel').dataset.arm = ''; $('lDel').textContent = 'Удалить список с задачами';
    $('lNote').textContent = l ? `В списке задач: ${data.items.filter(i => i.list === l.id).length}.` : '';
    $('listDlg').showModal(); $('lName').focus();
  }
  $('lSave').onclick = async () => {
    try { if (editingList) await App.api('PATCH', '/api/lists/' + editingList.id, { name: $('lName').value, color: lColor }); else await App.api('POST', '/api/lists', { name: $('lName').value, color: lColor, pos: data.lists.length }); $('listDlg').close(); await load(); } catch (e) { App.toast(e.message, 4000); }
  };
  $('lDel').onclick = async () => {
    if ($('lDel').dataset.arm !== '1') { $('lDel').dataset.arm = '1'; $('lDel').textContent = 'Точно? Задачи тоже удалятся'; return; }
    try { await App.api('DELETE', '/api/lists/' + editingList.id); $('listDlg').close(); if (filter === String(editingList.id)) filter = ''; await load(); } catch (e) { App.toast(e.message, 4000); }
  };
  if (mod) { $('addList').onclick = () => openList(null); $('addItem').onclick = () => openItem(null); }

  try { await load(); } catch (e) { $('board').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  App.every(async () => { if (!document.querySelector('dialog[open]') && !dnd) await load(); }, 30000);
})();
