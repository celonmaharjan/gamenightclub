// Relay server tests (no browser). Run: node server.test.js
const { spawn } = require('child_process'), assert = require('assert'), path = require('path');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn('node', [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, GN_GRACE_MS: '900' }, stdio: ['ignore', 'pipe', 'inherit'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const client = () => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:' + PORT), c = { ws, got: [], send: o => ws.send(JSON.stringify(o)), last: t => [...c.got].reverse().find(m => m.t === t), all: t => c.got.filter(m => m.t === t) };
  ws.onmessage = e => c.got.push(JSON.parse(e.data)); ws.onopen = () => res(c); ws.onerror = () => rej(new Error('connect failed'));
});
let n = 0; const ok = m => { n++; console.log('ok -', m); };
(async () => {
  await sleep(600);
  const r = await fetch(`http://localhost:${PORT}/`); const html = await r.text(); assert(r.ok && html.includes('Game Night')); ok('serves game-night.html');
  // ---- PWA files
  const man = await (await fetch(`http://localhost:${PORT}/manifest.webmanifest`)).json();
  assert(man.name === 'Game Night' && man.display === 'standalone' && man.icons.length >= 2); ok('web app manifest');
  const sw = await fetch(`http://localhost:${PORT}/sw.js`); assert(/javascript/.test(sw.headers.get('content-type')) && (await sw.text()).includes('addEventListener')); ok('service worker served as JavaScript');
  for (const f of ['icon-192.png', 'icon-512.png']) { const b = Buffer.from(await (await fetch(`http://localhost:${PORT}/${f}`)).arrayBuffer()); assert(b.slice(1, 4).toString() === 'PNG', f); } ok('icons are real PNGs');
  // ---- lobby
  const A = await client(); A.send({ t: 'create', name: 'Ann' }); await sleep(150);
  const room = A.last('room'); assert(room && /^[A-Z]{4}$/.test(room.code) && room.seat === 0 && room.token.length >= 16); ok('create room -> 4-letter code, host seat 0, secret token');
  const B = await client(); B.send({ t: 'join', code: room.code.toLowerCase(), name: 'Bob' }); await sleep(150);
  assert.strictEqual(B.last('room').seat, 1); assert.deepStrictEqual(A.last('roster').players, ['Ann', 'Bob']); assert.strictEqual(B.last('roster').you, 1); ok('join (case-insensitive) + roster');
  const X = await client(); X.send({ t: 'join', code: 'ZZZZ', name: 'X' }); await sleep(100); assert(X.last('error')); ok('unknown code rejected');
  X.send({ t: 'rejoin', code: room.code, token: 'nope' }); await sleep(100); assert(X.last('error').rejoin); ok('cannot rejoin a room that has not started');
  B.send({ t: 'msg', d: { k: 'start', id: 'ttt' } }); await sleep(100); assert(!A.last('msg')); ok('non-host cannot start');
  A.send({ t: 'msg', d: { k: 'start', id: 'ttt', seed: 7, players: ['Ann', 'Bob'] } }); await sleep(150);
  assert.strictEqual(A.last('msg').d.id, 'ttt'); assert.strictEqual(B.last('msg').from, 0); ok('host start echoed to everyone (sender included)');
  A.send({ t: 'msg', d: { k: 'start', id: 'c4', seed: 9 } }); await sleep(100); assert.strictEqual(A.all('msg').length, 1); ok('second start ignored');
  const C = await client(); C.send({ t: 'join', code: room.code, name: 'Cy' }); await sleep(100); assert(C.last('error')); ok('cannot join after start');
  for (let i = 0; i < 5; i++) { (i % 2 ? B : A).send({ t: 'msg', d: { k: 'in', n: i, a: ['p', i] } }); await sleep(20); }
  await sleep(150); const order = c => c.got.filter(m => m.t === 'msg' && m.d.k === 'in').map(m => m.d.n).join(',');
  assert.strictEqual(order(A), '0,1,2,3,4'); assert.strictEqual(order(A), order(B)); ok('identical message order for all clients');
  // ---- drop + rejoin
  const tokB = B.last('room').token; B.ws.close(); await sleep(200);
  const away = A.last('away'); assert(away && away.seat === 1 && away.name === 'Bob'); ok('a dropped player is reported as "away" (seat held), not gone');
  A.send({ t: 'msg', d: { k: 'in', n: 5, a: ['p', 5] } }); await sleep(80);
  const B2 = await client(); B2.send({ t: 'rejoin', code: room.code, token: 'wrong' }); await sleep(100); assert(B2.last('error').rejoin); ok('rejoin with a wrong token is refused');
  B2.send({ t: 'rejoin', code: room.code, token: tokB }); await sleep(150);
  const rj = B2.last('rejoined'); assert(rj && rj.seat === 1 && rj.log[0].d.k === 'start' && rj.log.filter(e => e.d.k === 'in').length === 6); ok('rejoin returns seat + the full replay log (start + all 6 inputs, incl. one sent while away)');
  assert(A.last('back') && A.last('back').seat === 1); ok('others are told the player is back');
  A.send({ t: 'msg', d: { k: 'in', n: 6, a: ['p', 6] } }); await sleep(100); assert.strictEqual(B2.last('msg').d.n, 6); ok('rejoined player receives live messages again');
  // ---- hijack / takeover of a half-dead connection
  const tokB2 = tokB; const B3 = await client(); B3.send({ t: 'rejoin', code: room.code, token: tokB2 }); await sleep(150);
  assert(B3.last('rejoined')); A.send({ t: 'msg', d: { k: 'in', n: 7, a: ['p', 7] } }); await sleep(100); assert.strictEqual(B3.last('msg').d.n, 7); ok('a new connection can take over a seat still attached to a dead one');
  // ---- chat: reactions + voice clips (relayed, validated, rate-limited, never replayed)
  const nChat = c => c.got.filter(m => m.t === 'chat').length, clip = Buffer.from('fake-audio-bytes').toString('base64');
  A.send({ t: 'chat', k: 'e', i: 2 }); await sleep(100); const ce = B3.last('chat'); assert(ce && ce.k === 'e' && ce.i === 2 && ce.from === 0); assert.strictEqual(nChat(A), 0); ok('emoji reaction reaches the others (not echoed to the sender)');
  A.send({ t: 'chat', k: 'e', i: 3 }); await sleep(60); assert.strictEqual(nChat(B3), 1); ok('reactions are rate-limited');
  await sleep(350); A.send({ t: 'chat', k: 'e', i: 99 }); A.send({ t: 'chat', k: 'e', i: '1' }); await sleep(100); assert.strictEqual(nChat(B3), 1); ok('invalid reaction indexes are ignored');
  A.send({ t: 'chat', k: 'v', mt: 'audio/webm;codecs=opus', a: clip }); await sleep(100); const cv = B3.last('chat'); assert(cv.k === 'v' && cv.a === clip && cv.mt === 'audio/webm;codecs=opus' && cv.from === 0); ok('voice clip is relayed to the others');
  await sleep(1550); A.send({ t: 'chat', k: 'v', mt: 'text/html', a: clip }); A.send({ t: 'chat', k: 'v', mt: 'audio/webm', a: '<script>' }); A.send({ t: 'chat', k: 'v', mt: 'audio/webm', a: 'A'.repeat(50000) }); await sleep(120); assert.strictEqual(nChat(B3), 2); ok('voice clips with a bad type, bad data or too large are dropped');
  const lobby = await client(); lobby.send({ t: 'create', name: 'L' }); await sleep(80); lobby.send({ t: 'chat', k: 'e', i: 1 }); await sleep(80); ok('chat before the game starts is ignored without error');
  const B5 = await client(); B5.send({ t: 'rejoin', code: room.code, token: tokB }); await sleep(150); const rj5 = B5.last('rejoined');
  assert(rj5 && rj5.log.every(e => ['start', 'again', 'in'].includes(e.d.k))); ok('chat is never part of the replay log');
  // ---- grace expiry
  B5.ws.close(); await sleep(1300); const left = A.last('left'); assert(left && left.seat === 1 && left.name === 'Bob'); ok('seat given up after the grace period -> "left"');
  const B4 = await client(); B4.send({ t: 'rejoin', code: room.code, token: tokB }); await sleep(100); assert(/given up/.test(B4.last('error').msg)); ok('cannot rejoin after the seat was given up');
  // ---- voluntary leave is immediate
  const E = await client(); E.send({ t: 'create', name: 'E' }); await sleep(100); const codeE = E.last('room').code;
  const F = await client(); F.send({ t: 'join', code: codeE, name: 'F' }); await sleep(100); E.send({ t: 'msg', d: { k: 'start', id: 'ttt', seed: 1 } }); await sleep(100);
  F.send({ t: 'bye' }); await sleep(150); assert(E.last('left') && E.last('left').name === 'F'); ok('pressing Leave ends the game for others immediately (no grace)');
  // ---- misc
  const P = await client(); P.send({ t: 'ping' }); await sleep(80); assert(P.last('pong')); ok('ping/pong heartbeat');
  const D = await client(); D.ws.send('not json'); D.send({ t: 'msg', d: 5 }); D.send({ t: 'join' }); D.send({ t: 'rejoin' }); await sleep(100); ok('garbage input does not crash the server');
  const E2 = await client(); E2.send({ t: 'create', name: 'E2' }); await sleep(100); const codeE2 = E2.last('room').code;
  const F2 = await client(); F2.send({ t: 'join', code: codeE2, name: 'F2' }); const G = await client(); G.send({ t: 'join', code: codeE2, name: 'G' }); await sleep(100);
  F2.ws.close(); await sleep(150); assert.deepStrictEqual(E2.last('roster').players, ['E2', 'G']); assert.strictEqual(G.last('roster').you, 1); ok('lobby leave re-seats players');
  const h = await (await fetch(`http://localhost:${PORT}/health`)).text(); assert(/^ok rooms=\d+$/.test(h)); ok('health endpoint');
  console.log(`\n${n} server tests passed`); process.exitCode = 0;
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; }).finally(() => { srv.kill(); setTimeout(() => process.exit(process.exitCode), 100); });
