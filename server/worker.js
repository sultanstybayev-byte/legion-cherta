/* Сервер сайта «Карта мира». Cloudflare Worker + база D1.
   Настройки (Settings → Variables): BOT_TOKEN (секрет), OWNER_ID (твой Telegram ID), ALLOWED_ORIGIN (адрес сайта).
   Привязка базы данных: D1 с именем переменной DB. Таблицы создаются сами при первом запросе. */

const ROLE_LEVEL = { guest: 0, member: 1, moderator: 2, owner: 3 };
const FORUM_CATS = ['idea', 'apply', 'talk', 'news'];
const STATUSES = ['todo', 'doing', 'done'];
const MARKER_CATS = ['base', 'home', 'village', 'portal', 'ore', 'struct', 'danger', 'other'];
const DIMS = ['overworld', 'nether', 'end'];
const SESSION_DAYS = 30;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, photo_url TEXT, role TEXT NOT NULL DEFAULT 'guest', banned INTEGER NOT NULL DEFAULT 0, created INTEGER, last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS markers (id TEXT PRIMARY KEY, data TEXT NOT NULL, owner INTEGER, created INTEGER, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS threads (id INTEGER PRIMARY KEY AUTOINCREMENT, cat TEXT NOT NULL, title TEXT NOT NULL, author INTEGER NOT NULL, created INTEGER, updated INTEGER, pinned INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, posts INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, thread INTEGER NOT NULL, author INTEGER NOT NULL, body TEXT NOT NULL, created INTEGER, edited INTEGER)`,
  `CREATE INDEX IF NOT EXISTS posts_thread ON posts(thread, id)`,
  `CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, author INTEGER NOT NULL, body TEXT NOT NULL, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS lists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT, pos INTEGER NOT NULL DEFAULT 0, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, author INTEGER NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, size INTEGER, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, list INTEGER NOT NULL, title TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'todo', assignee INTEGER, pos INTEGER NOT NULL DEFAULT 0, author INTEGER, created INTEGER, updated INTEGER)`
];
// columns added after the first release; ALTER fails harmlessly when the column already exists
const MIGRATIONS = [`ALTER TABLE users ADD COLUMN prefs TEXT`, `ALTER TABLE posts ADD COLUMN images TEXT`, `ALTER TABLE chat ADD COLUMN images TEXT`, `ALTER TABLE chat ADD COLUMN channel TEXT NOT NULL DEFAULT 'hot'`];
const CHANNELS = ['talk', 'hot'];
const IMG_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46], 'image/gif': [0x47, 0x49, 0x46] };
const IMG_MAX = 1600000;
let schemaReady = false;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new HttpError(s, m); };
const now = () => Date.now();
const enc = s => new TextEncoder().encode(s);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc(s)));
const str = (v, max, name) => { v = String(v ?? '').trim(); if (v.length > max) fail(400, `${name}: не длиннее ${max} символов`); return v; };
const int = (v, name, lo = -30000000, hi = 30000000) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) fail(400, `${name}: нужно число`); return Math.trunc(n); };
const color = v => /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : '#e07b2a';

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (!env.DB) fail(500, 'Сервер не настроен: не привязана база данных D1 с именем DB.');
      if (!schemaReady) {
        await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
        for (const m of MIGRATIONS) { try { await env.DB.prepare(m).run(); } catch (e) { /* already there */ } }
        schemaReady = true;
      }
      const out = await route(req, env);
      if (out instanceof Response) { const h = new Headers(out.headers); for (const [k, v] of Object.entries(cors)) h.set(k, v); return new Response(out.body, { status: out.status, headers: h }); }
      return new Response(JSON.stringify(out ?? { ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e && e.stack || e);
      return new Response(JSON.stringify({ error: e instanceof HttpError ? e.message : 'Ошибка сервера' }), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    }
  }
};

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

async function body(req, limit) {
  const t = await req.text();
  if (t.length > limit) fail(413, 'Слишком большой запрос');
  if (!t) return {};
  try { return JSON.parse(t); } catch (e) { fail(400, 'Неверный JSON'); }
}

/* ---------- users & sessions ---------- */
function roleOf(u, env) { if (!u) return 'anon'; if (String(u.id) === String(env.OWNER_ID || '')) return 'owner'; return ROLE_LEVEL[u.role] != null ? u.role : 'guest'; }
function level(u, env) { if (!u) return -1; return ROLE_LEVEL[roleOf(u, env)]; }
function publicUser(u, env) {
  if (!u) return null;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? '@' + u.username : 'id' + u.id);
  return { id: u.id, name, username: u.username || '', photo: u.photo_url || '', role: roleOf(u, env), banned: !!u.banned };
}
async function currentUser(req, env) {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+([0-9a-f]{64})$/i); if (!m) return null;
  const tk = await sha256(m[1]);
  const u = await env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?').bind(tk, now()).first();
  if (u && now() - (u.last_seen || 0) > 300000) await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now(), u.id).run();
  return u || null;
}
const need = {
  login(u) { if (!u) fail(401, 'Нужно войти через Telegram'); if (u.banned) fail(403, 'Ваш аккаунт заблокирован'); },
  level(u, env, lv, what) { need.login(u); if (level(u, env) < ROLE_LEVEL[lv]) fail(403, what); }
};
async function usersById(env, ids) {
  ids = [...new Set(ids.filter(v => v != null))]; const out = {};
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const r = await env.DB.prepare(`SELECT * FROM users WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const u of r.results) out[u.id] = publicUser(u, env);
  }
  return out;
}
async function verifyTelegram(data, botToken) {
  if (!data || typeof data !== 'object' || !data.hash || !data.id || !data.auth_date) return false;
  const fields = Object.keys(data).filter(k => k !== 'hash' && data[k] !== undefined && data[k] !== null && typeof data[k] !== 'object').sort();
  const check = fields.map(k => `${k}=${data[k]}`).join('\n');
  const secret = await crypto.subtle.digest('SHA-256', enc(botToken));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, enc(check)));
  const h = String(data.hash).toLowerCase();
  if (sig.length !== h.length) return false;
  let diff = 0; for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ h.charCodeAt(i);
  if (diff !== 0) return false;
  return now() / 1000 - Number(data.auth_date) < 86400;
}
async function flood(env, table, u, ms, msg) {
  if (!table) return;
  const r = await env.DB.prepare(`SELECT MAX(created) AS t FROM ${table} WHERE author = ?`).bind(u.id).first();
  if (r && r.t && now() - r.t < ms) fail(429, msg);
}

/* ---------- world data ---------- */
const DEFAULT_META = { name: 'Мир легиона', seed: '' };
const DEFAULT_MAPS = { overworld: { image: '', x: 0, z: 0, bpp: 1 }, nether: { image: '', x: 0, z: 0, bpp: 1 }, end: { image: '', x: 0, z: 0, bpp: 1 } };
const DEFAULT_PLAN = { platform: { size: 16, cx0: -8, cz0: -8 }, base: { placed: true, scale: 1, cx: 0, cz: 0, edits: [] }, tasks: [] };
async function kvGet(env, k, d) { const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); if (!r) return d; try { return JSON.parse(r.v); } catch (e) { return d; } }
async function kvSet(env, k, v) { await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, JSON.stringify(v)).run(); }
function cleanMarker(b) {
  const cat = MARKER_CATS.includes(b.cat) ? b.cat : 'other', dim = DIMS.includes(b.dim) ? b.dim : 'overworld';
  const y = b.y === null || b.y === '' || b.y === undefined ? null : int(b.y, 'Y', -2048, 4096);
  return { name: str(b.name, 80, 'Название') || 'Без названия', cat, x: int(b.x, 'X'), y, z: int(b.z, 'Z'), dim, note: str(b.note, 600, 'Заметка') };
}
function cleanMaps(m) {
  const out = {};
  for (const d of DIMS) { const s = (m && m[d]) || {}; const img = str(s.image, 300, 'Путь к картинке');
    out[d] = { image: img === 'local:' ? '' : img, x: int(s.x || 0, 'X карты'), z: int(s.z || 0, 'Z карты'), bpp: Math.min(64, Math.max(0.0625, Number(s.bpp) || 1)) }; }
  return out;
}
function cleanPlan(p) {
  if (!p || typeof p !== 'object') fail(400, 'Нет плана');
  const pl = p.platform || {}, b = p.base || {};
  const edits = Array.isArray(b.edits) ? b.edits.filter(e => Array.isArray(e) && e.length === 4 && e.every(Number.isFinite)).map(e => e.map(v => Math.trunc(v))) : [];
  if (edits.length > 200000) fail(413, 'Слишком много правок базы');
  const tasks = (Array.isArray(p.tasks) ? p.tasks : []).slice(0, 500).map(t => ({
    id: str(t.id, 40, 'id задачи') || String(now()), name: str(t.name, 60, 'Название задачи') || 'Задача', color: color(t.color), note: str(t.note, 600, 'Заметка задачи'),
    chunks: (Array.isArray(t.chunks) ? t.chunks : []).slice(0, 5000).filter(c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite)).map(c => [Math.trunc(c[0]), Math.trunc(c[1])])
  }));
  const structures = (Array.isArray(p.structures) ? p.structures : []).slice(0, 300).map(s => ({
    id: str(s.id, 40, 'id структуры') || String(now()), def: str(s.def, 40, 'тип структуры'), cx: int(s.cx || 0, 'Чанк X'), cz: int(s.cz || 0, 'Чанк Z'), rot: ((Math.trunc(Number(s.rot) || 0) % 4) + 4) % 4 }));
  return {
    structures,
    platform: { size: int(pl.size || 16, 'Размер платформы', 8, 48), cx0: int(pl.cx0 || 0, 'Чанк X угла'), cz0: int(pl.cz0 || 0, 'Чанк Z угла') },
    base: { placed: !!b.placed, scale: [0.55, 0.75, 1].includes(Number(b.scale)) ? Number(b.scale) : 1, cx: int(b.cx || 0, 'Чанк базы X'), cz: int(b.cz || 0, 'Чанк базы Z'), edits },
    tasks
  };
}
function cleanDefs(list) {
  if (!Array.isArray(list)) fail(400, 'Нужен список структур');
  let total = 0;
  return list.slice(0, 100).map(d => {
    const edits = Array.isArray(d.edits) ? d.edits.filter(e => Array.isArray(e) && e.length === 4 && e.every(Number.isFinite)).map(e => e.map(v => Math.trunc(v))) : [];
    total += edits.length; if (total > 200000) fail(413, 'Слишком много правок в структурах');
    return { id: str(d.id, 40, 'id') || String(now()), name: str(d.name, 60, 'Название') || 'Структура', kind: d.kind === 'lotus' ? 'lotus' : 'box',
      scale: [0.55, 0.75, 1].includes(Number(d.scale)) ? Number(d.scale) : 1, edits,
      w: int(d.w || 1, 'Ширина', 1, 32), d: int(d.d || 1, 'Глубина', 1, 32), h: int(d.h || 8, 'Высота', 1, 320), color: color(d.color), note: str(d.note, 600, 'Заметка') };
  });
}
async function world(env) {
  const [meta, maps, plan, rows, structdefs] = await Promise.all([kvGet(env, 'meta', DEFAULT_META), kvGet(env, 'maps', DEFAULT_MAPS), kvGet(env, 'plan', DEFAULT_PLAN),
    env.DB.prepare('SELECT * FROM markers ORDER BY created').all(), kvGet(env, 'structdefs', null)]);
  const markers = rows.results.map(r => Object.assign(JSON.parse(r.data), { id: r.id, owner: r.owner, created: r.created, updated: r.updated }));
  return { version: 1, name: meta.name, seed: meta.seed, savedAt: 0, maps, plan, structdefs, markers, users: await usersById(env, markers.map(m => m.owner)) };
}

/* ---------- router ---------- */
async function route(req, env) {
  const url = new URL(req.url), p = url.pathname.replace(/\/+$/, ''), M = req.method;
  const seg = p.split('/').filter(Boolean);            // ['api', ...]
  if (seg[0] !== 'api') { if (p === '' || p === '/') return { ok: true, name: 'legion-map api' }; fail(404, 'Нет такого адреса'); }
  const me = await currentUser(req, env);
  const r = seg.slice(1), id = r[1];

  /* auth */
  if (r[0] === 'auth' && r[1] === 'telegram' && M === 'POST') {
    if (!env.BOT_TOKEN) fail(500, 'Сервер не настроен: нет BOT_TOKEN.');
    const d = await body(req, 4000);
    if (!(await verifyTelegram(d, env.BOT_TOKEN))) fail(401, 'Telegram не подтвердил вход. Попробуйте ещё раз.');
    const uid = int(d.id, 'id', 1, 1e16);
    await env.DB.prepare(`INSERT INTO users (id, username, first_name, last_name, photo_url, role, created, last_seen) VALUES (?, ?, ?, ?, ?, 'guest', ?, ?)
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, last_name = excluded.last_name, photo_url = excluded.photo_url, last_seen = excluded.last_seen`)
      .bind(uid, str(d.username, 64, 'username'), str(d.first_name, 128, 'имя'), str(d.last_name, 128, 'фамилия'), str(d.photo_url, 400, 'фото'), now(), now()).run();
    const raw = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').bind(await sha256(raw), uid, now() + SESSION_DAYS * 864e5).run();
    await env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()).run();
    const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first();
    return { token: raw, user: publicUser(u, env) };
  }
  if (r[0] === 'logout' && M === 'POST') {
    const m = (req.headers.get('Authorization') || '').match(/^Bearer\s+([0-9a-f]{64})$/i);
    if (m) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha256(m[1])).run();
    return { ok: true };
  }
  if (r[0] === 'me' && M === 'GET') { let prefs = {}; try { prefs = me && me.prefs ? JSON.parse(me.prefs) : {}; } catch (e) { } return { user: publicUser(me, env), prefs, meta: await kvGet(env, 'meta', DEFAULT_META) }; }
  if (r[0] === 'prefs' && M === 'PUT') {
    if (!me) fail(401, 'Нужно войти через Telegram');
    const b = await body(req, 4000); if (!b || typeof b !== 'object' || Array.isArray(b)) fail(400, 'Неверные настройки');
    const clean = {}; for (const [k, v] of Object.entries(b).slice(0, 40)) if (/^[a-zA-Z0-9_.-]{1,40}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) clean[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    await env.DB.prepare('UPDATE users SET prefs = ? WHERE id = ?').bind(JSON.stringify(clean), me.id).run(); return { prefs: clean };
  }

  /* world: markers, maps, plan, meta */
  if (r[0] === 'world' && M === 'GET') return world(env);
  if (r[0] === 'markers' && id && M === 'PUT') {
    need.level(me, env, 'member', 'Ставить метки могут только участники. Попросите владельца выдать роль.');
    const data = cleanMarker(await body(req, 8000));
    const mid = str(id, 40, 'id метки'); if (!/^[A-Za-z0-9_-]+$/.test(mid)) fail(400, 'Неверный id метки');
    const ex = await env.DB.prepare('SELECT owner FROM markers WHERE id = ?').bind(mid).first();
    if (ex) {
      if (ex.owner !== me.id && level(me, env) < ROLE_LEVEL.moderator) fail(403, 'Можно менять только свои метки');
      await env.DB.prepare('UPDATE markers SET data = ?, updated = ? WHERE id = ?').bind(JSON.stringify(data), now(), mid).run();
    } else {
      const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM markers WHERE owner = ?').bind(me.id).first();
      if (cnt.n >= 2000) fail(429, 'Слишком много меток');
      await env.DB.prepare('INSERT INTO markers (id, data, owner, created, updated) VALUES (?, ?, ?, ?, ?)').bind(mid, JSON.stringify(data), me.id, now(), now()).run();
    }
    const row = await env.DB.prepare('SELECT * FROM markers WHERE id = ?').bind(mid).first();
    return { marker: Object.assign(JSON.parse(row.data), { id: row.id, owner: row.owner, created: row.created, updated: row.updated }), users: await usersById(env, [row.owner]) };
  }
  if (r[0] === 'markers' && id && M === 'DELETE') {
    need.level(me, env, 'member', 'Удалять метки могут только участники');
    const ex = await env.DB.prepare('SELECT owner FROM markers WHERE id = ?').bind(id).first(); if (!ex) return { ok: true };
    if (ex.owner !== me.id && level(me, env) < ROLE_LEVEL.moderator) fail(403, 'Можно удалять только свои метки');
    await env.DB.prepare('DELETE FROM markers WHERE id = ?').bind(id).run(); return { ok: true };
  }
  if (r[0] === 'plan' && M === 'PUT') { need.level(me, env, 'moderator', 'План меняют только модераторы'); const plan = cleanPlan(await body(req, 3000000)); await kvSet(env, 'plan', plan); return { plan }; }
  if (r[0] === 'structdefs' && M === 'PUT') { need.level(me, env, 'moderator', 'Структуры меняют только модераторы'); const defs = cleanDefs(await body(req, 3000000)); await kvSet(env, 'structdefs', defs); return { structdefs: defs }; }
  if (r[0] === 'maps' && M === 'PUT') { need.level(me, env, 'moderator', 'Картинку карты меняют только модераторы'); const maps = cleanMaps(await body(req, 8000)); await kvSet(env, 'maps', maps); return { maps }; }
  if (r[0] === 'meta' && M === 'PUT') { need.level(me, env, 'owner', 'Только владелец'); const b = await body(req, 4000); const meta = { name: str(b.name, 60, 'Название') || 'Мир', seed: str(b.seed, 40, 'Сид') }; await kvSet(env, 'meta', meta); return { meta }; }
  if (r[0] === 'export' && M === 'GET') {
    need.level(me, env, 'owner', 'Только владелец');
    const w = await world(env); delete w.users;
    const [th, po, ch, li, it, us] = await Promise.all(['threads', 'posts', 'chat', 'lists', 'items', 'users'].map(t => env.DB.prepare(`SELECT * FROM ${t}`).all().then(x => x.results)));
    return { ...w, savedAt: now(), backup: { threads: th, posts: po, chat: ch, lists: li, items: it, users: us } };
  }
  if (r[0] === 'import' && M === 'POST') {
    need.level(me, env, 'owner', 'Только владелец');
    const w = await body(req, 3000000);
    if (w.name !== undefined) await kvSet(env, 'meta', { name: str(w.name, 60, 'Название') || 'Мир', seed: str(w.seed, 40, 'Сид') });
    if (w.maps) await kvSet(env, 'maps', cleanMaps(w.maps));
    if (w.plan) await kvSet(env, 'plan', cleanPlan(w.plan));
    if (Array.isArray(w.structdefs)) await kvSet(env, 'structdefs', cleanDefs(w.structdefs));
    let n = 0;
    if (Array.isArray(w.markers)) {
      const st = [];
      for (const m of w.markers.slice(0, 5000)) {
        let data; try { data = cleanMarker(m); } catch (e) { continue; }
        const mid = /^[A-Za-z0-9_-]{1,40}$/.test(String(m.id || '')) ? String(m.id) : (now().toString(36) + n);
        st.push(env.DB.prepare('INSERT INTO markers (id, data, owner, created, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated').bind(mid, JSON.stringify(data), m.owner || me.id, m.created || now(), now()));
        n++;
      }
      for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
    }
    return { ok: true, markers: n };
  }

  /* images */
  if (r[0] === 'images' && !id && M === 'POST') {
    need.login(me);
    const mime = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!IMG_TYPES[mime]) fail(415, 'Можно загрузить JPEG, PNG, WebP или GIF');
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) fail(400, 'Пустой файл'); if (buf.length > IMG_MAX) fail(413, 'Картинка больше 1,5 МБ');
    if (!IMG_TYPES[mime].every((b, i) => buf[i] === b)) fail(415, 'Файл не похож на картинку');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM images WHERE author = ? AND created > ?').bind(me.id, now() - 3600000).first();
    if (n.n >= 40) fail(429, 'Слишком много картинок за час');
    const iid = hex(crypto.getRandomValues(new Uint8Array(12)));
    await env.DB.prepare('INSERT INTO images (id, author, mime, data, size, created) VALUES (?, ?, ?, ?, ?, ?)').bind(iid, me.id, mime, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), buf.length, now()).run();
    return { id: iid };
  }
  if (r[0] === 'img' && id && M === 'GET') {
    const row = /^[0-9a-f]{24}$/.test(id) ? await env.DB.prepare('SELECT mime, data FROM images WHERE id = ?').bind(id).first() : null;
    if (!row) return new Response('not found', { status: 404 });
    const data = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Array.isArray(row.data) ? new Uint8Array(row.data) : row.data;
    return new Response(data, { status: 200, headers: { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
  }

  /* forum */
  if (r[0] === 'forum' && !id && M === 'GET') {
    const cat = url.searchParams.get('cat');
    const q = FORUM_CATS.includes(cat) ? env.DB.prepare('SELECT * FROM threads WHERE cat = ? ORDER BY pinned DESC, updated DESC LIMIT 300').bind(cat) : env.DB.prepare('SELECT * FROM threads ORDER BY pinned DESC, updated DESC LIMIT 300');
    const t = (await q.all()).results; return { threads: t, users: await usersById(env, t.map(x => x.author)) };
  }
  if (r[0] === 'forum' && !id && M === 'POST') {
    need.login(me); const b = await body(req, 20000);
    const cat = FORUM_CATS.includes(b.cat) ? b.cat : 'talk';
    if (cat === 'news' && level(me, env) < ROLE_LEVEL.moderator) fail(403, 'Новости пишут только модераторы');
    const title = str(b.title, 120, 'Заголовок'), text = str(b.body, 8000, 'Текст'), imgs = await ownImages(env, me, b.images);
    if (!title || (!text && !imgs.length)) fail(400, 'Нужны заголовок и текст');
    await flood(env, 'threads', me, 60000, 'Новую тему можно создать раз в минуту');
    const t = now();
    const res = await env.DB.prepare('INSERT INTO threads (cat, title, author, created, updated, posts) VALUES (?, ?, ?, ?, ?, 1)').bind(cat, title, me.id, t, t).run();
    const tid = res.meta.last_row_id;
    await env.DB.prepare('INSERT INTO posts (thread, author, body, created, images) VALUES (?, ?, ?, ?, ?)').bind(tid, me.id, text, t, JSON.stringify(imgs)).run();
    return { id: tid };
  }
  if (r[0] === 'forum' && id && M === 'GET') {
    const t = await env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first(); if (!t) fail(404, 'Тема не найдена');
    const p = (await env.DB.prepare('SELECT * FROM posts WHERE thread = ? ORDER BY id').bind(id).all()).results.map(withImages);
    return { thread: t, posts: p, users: await usersById(env, [t.author, ...p.map(x => x.author)]) };
  }
  if (r[0] === 'forum' && id && M === 'POST') {
    need.login(me); const t = await env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first(); if (!t) fail(404, 'Тема не найдена');
    if (t.closed && level(me, env) < ROLE_LEVEL.moderator) fail(403, 'Тема закрыта');
    const rb = await body(req, 20000), text = str(rb.body, 8000, 'Текст'), imgs = await ownImages(env, me, rb.images);
    if (!text && !imgs.length) fail(400, 'Пустой ответ');
    await flood(env, 'posts', me, 8000, 'Не так быстро: подождите несколько секунд');
    await env.DB.batch([env.DB.prepare('INSERT INTO posts (thread, author, body, created, images) VALUES (?, ?, ?, ?, ?)').bind(id, me.id, text, now(), JSON.stringify(imgs)),
      env.DB.prepare('UPDATE threads SET posts = posts + 1, updated = ? WHERE id = ?').bind(now(), id)]);
    return { ok: true };
  }
  if (r[0] === 'forum' && id && M === 'PATCH') {
    need.level(me, env, 'moderator', 'Только модераторы'); const b = await body(req, 2000);
    const t = await env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first(); if (!t) fail(404, 'Тема не найдена');
    await env.DB.prepare('UPDATE threads SET pinned = ?, closed = ?, cat = ?, title = ? WHERE id = ?').bind(b.pinned === undefined ? t.pinned : (b.pinned ? 1 : 0), b.closed === undefined ? t.closed : (b.closed ? 1 : 0), FORUM_CATS.includes(b.cat) ? b.cat : t.cat, b.title ? str(b.title, 120, 'Заголовок') : t.title, id).run();
    return { ok: true };
  }
  if (r[0] === 'forum' && id && M === 'DELETE') {
    need.login(me); const t = await env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first(); if (!t) return { ok: true };
    if (level(me, env) < ROLE_LEVEL.moderator && !(t.author === me.id && t.posts <= 1)) fail(403, 'Удалить тему может модератор, а автор — пока в ней нет ответов');
    const ps = (await env.DB.prepare('SELECT images FROM posts WHERE thread = ?').bind(id).all()).results;
    await dropImages(env, ps.flatMap(x => parseImgs(x.images)));
    await env.DB.batch([env.DB.prepare('DELETE FROM posts WHERE thread = ?').bind(id), env.DB.prepare('DELETE FROM threads WHERE id = ?').bind(id)]);
    return { ok: true };
  }
  if (r[0] === 'posts' && id && (M === 'DELETE' || M === 'PATCH')) {
    need.login(me); const p = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first(); if (!p) fail(404, 'Сообщение не найдено');
    const mod = level(me, env) >= ROLE_LEVEL.moderator;
    if (p.author !== me.id && !mod) fail(403, 'Можно менять только свои сообщения');
    if (M === 'PATCH') { const text = str((await body(req, 20000)).body, 8000, 'Текст'); if (!text) fail(400, 'Пустой текст'); await env.DB.prepare('UPDATE posts SET body = ?, edited = ? WHERE id = ?').bind(text, now(), id).run(); return { ok: true }; }
    const first = await env.DB.prepare('SELECT MIN(id) AS f FROM posts WHERE thread = ?').bind(p.thread).first();
    if (first.f === p.id) fail(400, 'Первое сообщение удаляется вместе с темой');
    await dropImages(env, parseImgs(p.images));
    await env.DB.batch([env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id), env.DB.prepare('UPDATE threads SET posts = posts - 1 WHERE id = ?').bind(p.thread)]);
    return { ok: true };
  }

  /* hot chat */
  if (r[0] === 'chat' && !id && M === 'GET') {
    const after = Number(url.searchParams.get('after') || 0);
    const rows = (after > 0
      ? (await env.DB.prepare('SELECT * FROM chat WHERE id > ? ORDER BY id LIMIT 300').bind(after).all()).results
      : (await env.DB.prepare('SELECT * FROM (SELECT * FROM chat ORDER BY id DESC LIMIT 300) ORDER BY id').all()).results).map(withImages);
    return { messages: rows, users: await usersById(env, rows.map(x => x.author)) };
  }
  if (r[0] === 'chat' && !id && M === 'POST') {
    need.level(me, env, 'member', 'Писать в горячий чат могут участники. Подайте заявление на форуме.');
    const cb = await body(req, 4000), text = str(cb.body, 1000, 'Сообщение'), imgs = await ownImages(env, me, cb.images);
    const channel = CHANNELS.includes(cb.channel) ? cb.channel : 'hot';
    if (!text && !imgs.length) fail(400, 'Пустое сообщение');
    await flood(env, 'chat', me, 1500, 'Не так быстро');
    const res = await env.DB.prepare('INSERT INTO chat (author, body, created, images, channel) VALUES (?, ?, ?, ?, ?)').bind(me.id, text, now(), JSON.stringify(imgs), channel).run();
    return { id: res.meta.last_row_id };
  }
  if (r[0] === 'chat' && id && M === 'DELETE') {
    need.login(me); const m = await env.DB.prepare('SELECT * FROM chat WHERE id = ?').bind(id).first(); if (!m) return { ok: true };
    if (m.author !== me.id && level(me, env) < ROLE_LEVEL.moderator) fail(403, 'Можно удалять только свои сообщения');
    await dropImages(env, parseImgs(m.images));
    await env.DB.prepare('DELETE FROM chat WHERE id = ?').bind(id).run(); return { ok: true };
  }

  /* task lists */
  if (r[0] === 'tasks' && M === 'GET') {
    const [l, i] = await Promise.all([env.DB.prepare('SELECT * FROM lists ORDER BY pos, id').all(), env.DB.prepare('SELECT * FROM items ORDER BY pos, id').all()]);
    return { lists: l.results, items: i.results, users: await usersById(env, i.results.flatMap(x => [x.assignee, x.author])) };
  }
  if (r[0] === 'lists') {
    need.level(me, env, 'moderator', 'Списки задач меняют только модераторы');
    if (M === 'POST' && !id) { const b = await body(req, 4000); const name = str(b.name, 60, 'Название'); if (!name) fail(400, 'Нужно название'); const res = await env.DB.prepare('INSERT INTO lists (name, color, pos, created) VALUES (?, ?, ?, ?)').bind(name, color(b.color), int(b.pos || 0, 'pos'), now()).run(); return { id: res.meta.last_row_id }; }
    if (M === 'PATCH' && id) { const b = await body(req, 4000); const l = await env.DB.prepare('SELECT * FROM lists WHERE id = ?').bind(id).first(); if (!l) fail(404, 'Список не найден'); await env.DB.prepare('UPDATE lists SET name = ?, color = ?, pos = ? WHERE id = ?').bind(b.name ? str(b.name, 60, 'Название') : l.name, b.color ? color(b.color) : l.color, b.pos !== undefined ? int(b.pos, 'pos') : l.pos, id).run(); return { ok: true }; }
    if (M === 'DELETE' && id) { await env.DB.batch([env.DB.prepare('DELETE FROM items WHERE list = ?').bind(id), env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(id)]); return { ok: true }; }
  }
  if (r[0] === 'items') {
    need.login(me);
    const mod = level(me, env) >= ROLE_LEVEL.moderator;
    if (M === 'POST' && !id) {
      if (!mod) fail(403, 'Задачи добавляют только модераторы');
      const b = await body(req, 8000); const title = str(b.title, 160, 'Задача'); if (!title) fail(400, 'Нужно название задачи');
      const l = await env.DB.prepare('SELECT id FROM lists WHERE id = ?').bind(b.list).first(); if (!l) fail(400, 'Список не найден');
      const res = await env.DB.prepare('INSERT INTO items (list, title, note, status, assignee, pos, author, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(l.id, title, str(b.note, 2000, 'Описание'), STATUSES.includes(b.status) ? b.status : 'todo', b.assignee ? int(b.assignee, 'Исполнитель', 1, 1e16) : null, int(b.pos || 0, 'pos'), me.id, now(), now()).run();
      return { id: res.meta.last_row_id };
    }
    const it = id ? await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first() : null;
    if (!it) fail(404, 'Задача не найдена');
    if (M === 'PATCH') {
      const b = await body(req, 8000);
      if (!mod) {   // the assignee may only move their own task between statuses
        if (it.assignee !== me.id) fail(403, 'Менять задачи могут модераторы, а исполнитель — только статус');
        if (!STATUSES.includes(b.status)) fail(400, 'Неверный статус');
        await env.DB.prepare('UPDATE items SET status = ?, updated = ? WHERE id = ?').bind(b.status, now(), id).run(); return { ok: true };
      }
      await env.DB.prepare('UPDATE items SET title = ?, note = ?, status = ?, assignee = ?, list = ?, pos = ?, updated = ? WHERE id = ?').bind(
        b.title !== undefined ? (str(b.title, 160, 'Задача') || it.title) : it.title, b.note !== undefined ? str(b.note, 2000, 'Описание') : it.note,
        STATUSES.includes(b.status) ? b.status : it.status, b.assignee !== undefined ? (b.assignee ? int(b.assignee, 'Исполнитель', 1, 1e16) : null) : it.assignee,
        b.list !== undefined ? int(b.list, 'Список', 1) : it.list, b.pos !== undefined ? int(b.pos, 'pos') : it.pos, now(), id).run();
      return { ok: true };
    }
    if (M === 'DELETE') { if (!mod) fail(403, 'Удалять задачи могут модераторы'); await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run(); return { ok: true }; }
  }

  /* members */
  if (r[0] === 'users' && !id && M === 'GET') {
    need.login(me);
    const rows = (await env.DB.prepare('SELECT * FROM users ORDER BY last_seen DESC LIMIT 1000').all()).results;
    const full = level(me, env) >= ROLE_LEVEL.moderator;
    return { users: rows.filter(u => full || roleOf(u, env) !== 'guest').map(u => Object.assign(publicUser(u, env), full ? { created: u.created, last_seen: u.last_seen } : {})) };
  }
  if (r[0] === 'users' && id && M === 'PATCH') {
    need.level(me, env, 'owner', 'Роли выдаёт только владелец');
    const b = await body(req, 1000); const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first(); if (!u) fail(404, 'Пользователь не найден');
    if (roleOf(u, env) === 'owner') fail(400, 'Роль владельца менять нельзя');
    const role = ['guest', 'member', 'moderator'].includes(b.role) ? b.role : u.role;
    await env.DB.prepare('UPDATE users SET role = ?, banned = ? WHERE id = ?').bind(role, b.banned === undefined ? u.banned : (b.banned ? 1 : 0), id).run();
    if (b.banned) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    return { user: publicUser(await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first(), env) };
  }

  fail(404, 'Нет такого адреса');
}

function parseImgs(v) { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.filter(x => /^[0-9a-f]{24}$/.test(x)) : []; } catch (e) { return []; } }
function withImages(row) { return Object.assign(row, { images: parseImgs(row.images) }); }
async function ownImages(env, me, list) {
  if (!Array.isArray(list) || !list.length) return [];
  const ids = [...new Set(list.map(String))].slice(0, 4);
  for (const i of ids) {
    if (!/^[0-9a-f]{24}$/.test(i)) fail(400, 'Неверная картинка');
    const row = await env.DB.prepare('SELECT author FROM images WHERE id = ?').bind(i).first();
    if (!row) fail(400, 'Картинка не найдена, загрузите её заново');
    if (row.author !== me.id) fail(403, 'Можно прикреплять только свои картинки');
  }
  return ids;
}
async function dropImages(env, ids) { for (const i of ids) await env.DB.prepare('DELETE FROM images WHERE id = ?').bind(i).run(); }

export { verifyTelegram };
