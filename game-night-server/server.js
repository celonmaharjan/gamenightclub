#!/usr/bin/env node
/* =====================================================================
   GAME NIGHT — online relay server (zero dependencies, Node 14+)

   What it does
     • Serves game-night.html at "/" (plus the PWA files: manifest, service worker, icons)
       so friends just open  http://<your-ip>:8787
     • Runs a tiny WebSocket relay on the same port. Players create/join a room with a
       4-letter code; every game message is echoed to everyone in the room in one global
       order, so all clients replay identical inputs.
     • RECONNECT: if a player drops mid-game their seat is held for GN_GRACE_MS (default 120 s).
       They come back with their secret token and the server replays the room's message log,
       so their game fast-forwards to exactly where everyone else is.
     • If a player leaves for good mid-game, a computer player takes over their seat (a logged 'bot' message,
       so every client switches at the same point). The host can remove players. Spectators can watch a game.
     • Abuse limits: per-IP connection + room-creation limits, same-origin check, memory caps, idle rooms expire.
     • It knows nothing about the games — no game logic lives here.

   Run:    node server.js            (PORT=9000 node server.js to change the port)
   ===================================================================== */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 8787;
const GRACE = +process.env.GN_GRACE_MS || 120000;                          // how long a dropped player's seat is held
const MAX_PLAYERS = 4, MAX_MSG = 64 * 1024, MAX_ROOMS = 500, MAX_LOG = 30000, MAX_LOG_BYTES = 8 * 1024 * 1024, GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HTML_CANDIDATES = [path.join(__dirname, 'game-night.html'), path.join(__dirname, '..', 'game-night.html')];
const ASSETS = path.join(__dirname, 'assets');
const TEST_PAGE = process.env.GN_TEST_PAGE || '';
const MAX_WATCHERS = 10, MAX_CONN_PER_IP = +process.env.GN_MAX_CONN_PER_IP || 40, ROOMS_PER_IP = +process.env.GN_ROOMS_PER_IP || 12, ROOMS_WINDOW = 10 * 60000;
const MAX_TOTAL_LOG = 256 * 1024 * 1024, IDLE_ROOM_MS = 6 * 3600000;
const TRUST_PROXY = !!(process.env.RENDER || process.env.TRUST_PROXY);      // behind Render/a reverse proxy the real IP is in x-forwarded-for
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);                          // test hook: serve one extra page at /test

/* ---------------------------------------------------------------- PWA files */
const MANIFEST = JSON.stringify({
  name: 'Game Night', short_name: 'Game Night', description: 'Ludo, Snakes & Ladders, Checkers, Connect Four, Tic-Tac-Toe and Crazy Eights',
  start_url: './', scope: './', display: 'standalone', orientation: 'any', background_color: '#1b1340', theme_color: '#1b1340',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
});
/** Service worker: network-first for the app (so updates arrive), cached copy when offline. Never touches the WebSocket or /health. */
const SW = `const V='gn-v1',SHELL=['./','icon-192.png','icon-512.png','manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin||u.pathname.endsWith('/health'))return;
e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(V).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('./'))))});`;
const STATIC = {
  '/manifest.webmanifest': () => ['application/manifest+json', MANIFEST],
  '/sw.js': () => ['text/javascript; charset=utf-8', SW],
  '/icon-192.png': () => ['image/png', fs.readFileSync(path.join(ASSETS, 'icon-192.png'))],
  '/icon-512.png': () => ['image/png', fs.readFileSync(path.join(ASSETS, 'icon-512.png'))]
};

/* ---------------------------------------------------------------- HTTP */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    const f = HTML_CANDIDATES.find(p => fs.existsSync(p));
    if (!f) { res.writeHead(500); return res.end('game-night.html not found next to server.js'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(f));
  }
  if (STATIC[url]) {
    try { const [type, body] = STATIC[url](); res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); return res.end(body); }
    catch (e) { res.writeHead(404); return res.end('missing asset'); }
  }
  if (url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok rooms=' + rooms.size); }
  if (TEST_PAGE && url === '/test') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(TEST_PAGE)); }
  if (TEST_PAGE && url === '/report' && req.method === 'POST') {
    let b = ''; req.on('data', d => b += d); req.on('end', () => { console.log('REPORT\n' + b); res.writeHead(200); res.end('ok'); if (process.env.GN_EXIT_ON_REPORT) setTimeout(() => process.exit(0), 200); }); return;
  }
  res.writeHead(404); res.end('not found');
});

/* ----------------------------------------------------- minimal WebSocket */
function frame(opcode, payload) {
  const len = payload.length; let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
class Client {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frags = []; this.room = null; this.seat = -1; this.alive = true; this.rate = 0;
    socket.on('data', d => this.onData(d)); socket.on('close', () => this.onClose()); socket.on('error', () => this.onClose());
    this.ping = setInterval(() => this.raw(9, Buffer.alloc(0)), 25000);                     // keep proxies from idling us out
    this.rl = setInterval(() => { this.rate = 0; }, 1000);
  }
  raw(op, buf) { if (this.alive && !this.socket.destroyed) try { this.socket.write(frame(op, buf)); } catch (e) { /* ignore */ } }
  send(obj) { this.raw(1, Buffer.from(JSON.stringify(obj))); }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80); let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) return this.kill(); len = Number(big); off = 10; }
      if (len > MAX_MSG || !masked) return this.kill();                                       // clients must mask (RFC 6455)
      if (b.length < off + 4 + len) return;
      const mask = b.slice(off, off + 4), data = Buffer.from(b.slice(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.slice(off + 4 + len);
      if (op === 8) return this.kill();
      if (op === 9) { this.raw(10, data); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        this.frags.push(data); if (this.frags.reduce((s, x) => s + x.length, 0) > MAX_MSG) return this.kill();
        if (fin) { const text = Buffer.concat(this.frags).toString('utf8'); this.frags = []; this.onText(text); }
      }
    }
  }
  kill() { this.alive && this.socket.destroy(); this.onClose(); }
  onText(text) {
    if (++this.rate > 60) return this.kill();
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    handle(this, m);
  }
  onClose() {
    if (!this.alive) return; this.alive = false; clearInterval(this.ping); clearInterval(this.rl); leave(this, false);
  }
}
const conns = new Map(), created = new Map();                              // ip -> open sockets, ip -> [room creation times]
/** Browsers send Origin: only allow pages served by this server (or listed in ALLOWED_ORIGINS, or a file:// page talking to localhost). */
function originOk(origin, host) {
  if (!origin) return true;                                                 // not a browser (tests, tools)
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin === 'null') return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  try { return new URL(origin).host === host; } catch (e) { return false; }
}
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') return socket.destroy();
  const origin = req.headers.origin, host = req.headers.host || '';
  if (!originOk(origin, host)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const ip = (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || socket.remoteAddress || '?';
  if ((conns.get(ip) || 0) >= MAX_CONN_PER_IP) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
  conns.set(ip, (conns.get(ip) || 0) + 1); let counted = true;
  socket.on('close', () => { if (counted) { counted = false; const n = (conns.get(ip) || 1) - 1; if (n > 0) conns.set(ip, n); else conns.delete(ip); } });
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true); new Client(socket).ip = ip;
});

/* --------------------------------------------------------------- rooms
   room = { code, seats:[{name, token, client|null, timer, gone}], started, log:[{from,d}], logBytes, logFull }
   Before the game starts a leaving player's seat is removed. After it starts the seat is held (see GRACE). */
const rooms = new Map();
const BAD = /\b(f+u+c+k+\w*|sh[i1]t\w*|b[i1]tch\w*|cunts?|assholes?|dick(head)?s?|bastards?|sluts?|whores?|n[i1]gg\w*|fag(got)?s?|retards?)\b/gi;
const clean = t => t.replace(BAD, w => w[0] + '*'.repeat(w.length - 1));   // light profanity mask for names and chat
const cleanName = n => clean(String(n || 'Player').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12)) || 'Player';
const newToken = () => crypto.randomBytes(12).toString('hex');
const LOGGED = new Set(['start', 'again', 'in', 'bot']);                          // message kinds a rejoining player must replay
function newCode() { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += L[crypto.randomInt(L.length)]; if (!rooms.has(c)) return c; } }
let totalLog = 0;
function everyone(room, obj, except) {
  for (const s of room.seats) if (s.client && s.client !== except) s.client.send(obj);
  for (const w of room.watchers) if (w !== except) w.send(obj);                       // spectators see everything except the lobby roster
}
function addLog(room, entry) {
  const size = JSON.stringify(entry).length; room.logBytes += size;
  if (room.logFull || room.log.length >= MAX_LOG || room.logBytes > MAX_LOG_BYTES || totalLog + size > MAX_TOTAL_LOG) { room.logFull = true; return; }
  room.log.push(entry); totalLog += size;
}
function roster(room) { const players = room.seats.map(s => s.name); room.seats.forEach((s, i) => s.client && s.client.send({ t: 'roster', players, you: i, started: room.started })); }
function removeRoom(room) {
  room.seats.forEach(s => clearTimeout(s.timer)); if (rooms.get(room.code) === room) { rooms.delete(room.code); totalLog -= room.log.reduce((n, e) => n + JSON.stringify(e).length, 0); }
  for (const w of room.watchers) { w.room = null; w.send({ t: 'left', seat: -1, name: 'Everyone' }); } room.watchers.clear();
}
function join(room, c, name) {
  const seat = { name: cleanName(name), token: newToken(), client: c, timer: null, gone: false };
  room.seats.push(seat); c.room = room; c.seat = room.seats.length - 1; return seat;
}
function handle(c, m) {
  if (m.t === 'ping') return c.send({ t: 'pong' });
  if (m.t === 'create') {
    if (c.room) return; if (rooms.size >= MAX_ROOMS) return c.send({ t: 'error', msg: 'Server is full, try later' });
    const now = Date.now(), mine = (created.get(c.ip) || []).filter(t => now - t < ROOMS_WINDOW);
    if (mine.length >= ROOMS_PER_IP) return c.send({ t: 'error', msg: 'Too many rooms created — wait a few minutes' }); mine.push(now); created.set(c.ip, mine);
    const room = { code: newCode(), seats: [], watchers: new Set(), started: false, log: [], logBytes: 0, logFull: false, last: now }; rooms.set(room.code, room);
    const s = join(room, c, m.name); c.send({ t: 'room', code: room.code, seat: 0, token: s.token }); roster(room);
  } else if (m.t === 'join') {
    if (c.room) return; const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return c.send({ t: 'error', msg: 'No room with that code' });
    if (room.started) return c.send({ t: 'error', msg: 'That game has already started — you can watch it instead', canWatch: true });
    if (room.seats.length >= MAX_PLAYERS) return c.send({ t: 'error', msg: 'Room is full (4 players max)' });
    const s = join(room, c, m.name); c.send({ t: 'room', code: room.code, seat: c.seat, token: s.token }); roster(room);
  } else if (m.t === 'rejoin') {
    if (c.room) return; const room = rooms.get(String(m.code || '').toUpperCase().trim()), fail = msg => c.send({ t: 'error', msg, rejoin: true });
    if (!room || !room.started) return fail('That room is gone');
    const seat = room.seats.findIndex(s => s.token && s.token === m.token); if (seat < 0) return fail('That room is gone');
    const s = room.seats[seat]; if (s.gone) return fail('Your seat was given up'); if (room.logFull) return fail('Game too long to rejoin');
    if (s.client && s.client !== c) { const old = s.client; old.room = null; old.socket.destroy(); }   // half-dead old connection: take over
    clearTimeout(s.timer); s.timer = null; s.client = c; c.room = room; c.seat = seat;
    c.send({ t: 'rejoined', code: room.code, seat, token: s.token, log: room.log });
    everyone(room, { t: 'back', seat, name: s.name }, c);
  } else if (m.t === 'watch') {
    if (c.room) return; const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room || !room.started) return c.send({ t: 'error', msg: room ? 'That game has not started yet — join it instead' : 'No room with that code', watch: true });
    if (room.logFull) return c.send({ t: 'error', msg: 'That game is too long to watch', watch: true });
    if (room.watchers.size >= MAX_WATCHERS) return c.send({ t: 'error', msg: 'Too many spectators', watch: true });
    room.watchers.add(c); c.room = room; c.seat = -1; c.watching = true;
    c.send({ t: 'watching', code: room.code, players: room.seats.map(s => s.name), log: room.log });
  } else if (m.t === 'kick' && c.room && !c.watching && c.seat === 0) {
    const room = c.room, seat = m.seat, s = Number.isInteger(seat) && seat > 0 ? room.seats[seat] : null; if (!s || s.gone) return;
    const target = s.client;
    if (!room.started) { if (target) { target.send({ t: 'error', msg: 'The host removed you from the room' }); leave(target, true); } return; }
    if (target) { target.send({ t: 'kicked' }); target.room = null; setTimeout(() => target.socket.destroy(), 100); }
    s.client = null; markGone(room, seat, 'removed');
  } else if (m.t === 'bye') {
    leave(c, true);
  } else if (m.t === 'chat' && c.room && !c.watching) {
    // Reactions and voice clips: relayed to the others as-is (validated, rate-limited), never logged or replayed.
    const now = Date.now(), room = c.room; let out = null;
    if (m.k === 'e' && Number.isInteger(m.i) && m.i >= 0 && m.i < 8) { if (now - (c.lastE || 0) < 300) return; c.lastE = now; out = { t: 'chat', from: c.seat, k: 'e', i: m.i }; }
    else if (m.k === 't' && typeof m.s === 'string') {
      const text = m.s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200); if (!text || now - (c.lastT || 0) < 400) return; c.lastT = now; out = { t: 'chat', from: c.seat, k: 't', s: clean(text) };
    }
    else if (m.k === 'v' && typeof m.a === 'string' && m.a.length <= 44000 && /^[A-Za-z0-9+/=]+$/.test(m.a) && /^audio\/[a-z0-9]+(;codecs=[a-z0-9]+)?$/.test(m.mt || '')) {
      if (now - (c.lastV || 0) < 700) return; c.lastV = now; out = { t: 'chat', from: c.seat, k: 'v', mt: m.mt, a: m.a };
    }
    if (out) for (const st of room.seats) if (st.client && st.client !== c) st.client.send(out);   // players only (not spectators)
  } else if (m.t === 'msg' && c.room && !c.watching && m.d && typeof m.d === 'object') {
    const room = c.room, k = m.d.k; room.last = Date.now(); if (k === 'bot') return;     // only the server creates 'bot' takeovers
    if (k === 'start') { if (c.seat !== 0 || room.started) return; room.started = true; }   // only the host starts, and only once
    else if (!room.started) return;
    const entry = { from: c.seat, d: m.d };
    if (LOGGED.has(k)) addLog(room, entry);
    everyone(room, { t: 'msg', from: c.seat, d: m.d });                                    // echo to everyone, sender included, in one global order
  }
}
/** Seat marked as permanently gone: tell everyone, and clean up the room when nobody is left. */
function markGone(room, seat, why) {
  const s = room.seats[seat]; if (!s || s.gone) return; s.gone = true; clearTimeout(s.timer); s.timer = null; s.client = null;
  if (room.started) {                                                                     // a computer player takes the seat, at one point in the global order
    const d = { k: 'bot', seat }; addLog(room, { from: -1, d }); everyone(room, { t: 'msg', from: -1, d });
  }
  everyone(room, { t: 'left', seat, name: s.name, why: why || '' });
  if (room.seats.every(x => !x.client)) removeRoom(room);
}
function leave(c, voluntary) {
  const room = c.room; if (!room) return; c.room = null;
  if (c.watching) { room.watchers.delete(c); return; }
  const s = room.seats[c.seat]; if (!s || s.client !== c) return;
  if (!room.started) {                                                                    // lobby: just remove the seat
    room.seats.splice(c.seat, 1); room.seats.forEach((x, i) => { if (x.client) x.client.seat = i; });
    if (!room.seats.length) removeRoom(room); else roster(room); return;
  }
  const seat = c.seat; s.client = null;
  if (voluntary) return markGone(room, seat);                                             // they pressed Leave: game ends for everyone
  everyone(room, { t: 'away', seat, name: s.name, grace: GRACE });                        // dropped: hold the seat
  s.timer = setTimeout(() => markGone(room, seat), GRACE);
  if (room.seats.every(x => !x.client && !x.timer)) removeRoom(room);
}

/* Rooms nobody has played in for 6 hours are closed (frees memory on long-running servers). */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) if (now - room.last > IDLE_ROOM_MS) {
    for (const st of room.seats) if (st.client) { st.client.send({ t: 'error', msg: 'Room closed after being idle' }); st.client.room = null; st.client.socket.destroy(); }
    removeRoom(room);
  }
  for (const [ip, ts] of created) { const keep = ts.filter(t => now - t < ROOMS_WINDOW); if (keep.length) created.set(ip, keep); else created.delete(ip); }
}, 10 * 60000).unref();

server.listen(PORT, () => {
  const nets = Object.values(require('os').networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`Game Night server running on port ${PORT}`);
  console.log(`  This computer:  http://localhost:${PORT}`);
  nets.forEach(a => console.log(`  Friends on your Wi-Fi: http://${a}:${PORT}`));
});
