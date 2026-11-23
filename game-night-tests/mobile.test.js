// Phone-emulation test: real touch taps in a 360x640 mobile viewport via the Chrome DevTools Protocol (no libraries; Node 22+ for global WebSocket).
// Checks every game works by touch, nothing overflows the screen or hides under another element, tap targets are big enough,
// no console errors, and the PWA (service worker + offline) works.   Run: node mobile.test.js
const { spawn, execFileSync } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const home = path.join(__dirname, '..', 'tmp'); fs.mkdirSync(home, { recursive: true });
const PORT = 20000 + Math.floor(Math.random() * 900), DBG = 21000 + Math.floor(Math.random() * 900);
const prof = fs.mkdtempSync(path.join(home, 'mob-')), shots = process.env.SHOTS || '';          // SHOTS=/some/dir saves screenshots
const chrome = process.env.CHROME || ['chromium-browser', 'chromium', 'google-chrome'].find(c => { try { execFileSync('which', [c]); return true; } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('node', [path.join(__dirname, '..', 'game-night-server', 'server.js')], { env: { ...process.env, PORT }, stdio: 'ignore' });
const br = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + DBG, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
const results = []; let failed = false, cdp;
const ok = (cond, msg) => { results.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed = true; };
const finish = code => { try { br.kill(); srv.kill(); fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* ignore */ } console.log(results.join('\n')); process.exit(code); };

class CDP {
  constructor(url) { this.id = 0; this.p = new Map(); this.ev = []; this.ws = new WebSocket(url); this.ready = new Promise(r => { this.ws.onopen = r; });
    this.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && this.p.has(m.id)) { const { res, rej } = this.p.get(m.id); this.p.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) this.ev.push(m); }; }
  send(method, params = {}) { return new Promise((res, rej) => { const id = ++this.id; this.p.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
}
const ev = async expr => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r.result.value; };
const waitFor = async (expr, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
const J = JSON.stringify;
/** Find a visible element (optionally by text); scroll to it; report centre, size and whether the centre really hits it (nothing on top). */
const rect = (sel, text) => ev(`(()=>{const T=${J(text || '')};const els=[...document.querySelectorAll(${J(sel)})].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(!T||e.textContent.includes(T))});const e=els[0];if(!e)return null;
  e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,top=document.elementFromPoint(x,y);return {x,y,w:r.width,h:r.height,hit:!!top&&(e.contains(top)||top.contains(e)&&false)}})()`);
async function tap(sel, text) {
  const r = await rect(sel, text); if (!r) throw new Error('nothing to tap: ' + sel + ' ' + (text || ''));
  if (!r.hit) ok(false, `tap target "${sel}${text ? ' ' + text : ''}" is covered by another element`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(150); return r;
}
const type = async (sel, text) => { await tap(sel); await cdp.send('Input.insertText', { text }); await sleep(80); };
const audit = name => ev(`(()=>{const vw=innerWidth,sw=document.documentElement.scrollWidth;const small=[...document.querySelectorAll('button,[role=button],input,.ttt-cell')].filter(e=>{if(e.closest('.hidden')||e.closest('.bgfx')||e.classList.contains('tk'))return false;   /* Ludo tokens get an enlarged invisible hit area; tested separately */const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&(r.width<30||r.height<30)}).map(e=>(e.id||e.className||e.tagName).toString().slice(0,24)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height));return {vw,sw,small}})()`)
  .then(a => { ok(a.sw <= a.vw + 1, `${name}: no horizontal overflow (page ${a.sw}px in ${a.vw}px viewport)`); if (a.small.length) ok(false, `${name}: tap targets under 30px: ${a.small.slice(0, 6).join(', ')}`); });
const shot = async name => { if (!shots) return; const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(r.data, 'base64')); };
const setView = (w, h, mobile = true) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile, screenOrientation: w > h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
const goto = async url => { await cdp.send('Page.navigate', { url }); await waitFor("document.readyState==='complete' && !!window.hub", 8000); await sleep(300); };
const toMenu = async () => { await ev("hub.toMenu(), true"); await sleep(150); };
const startGame = async card => { await tap('.gcard', card); await waitFor("!!document.querySelector('.overlay .btn')"); await tap('.overlay .btn', 'Start'); await sleep(500); };

(async () => {
  let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://localhost:${DBG}/json/list`)).json(); if (targets.length) break; } catch (e) { /* not up yet */ } await sleep(200); }
  cdp = new CDP(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await cdp.ready;
  for (const d of ['Page', 'Runtime', 'Log', 'Network']) await cdp.send(d + '.enable');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' });
  await setView(360, 640); await goto(`http://localhost:${PORT}/`);

  // ---- menu + PWA
  ok(await ev("document.querySelectorAll('.gcard').length") === 7, 'menu shows all 7 game cards'); await audit('menu'); await shot('menu');
  ok(await ev("!!document.querySelector('link[rel=manifest]')"), 'manifest linked');
  ok(await waitFor("navigator.serviceWorker.ready.then(r=>!!r.active)", 8000), 'service worker installed and active');
  ok(await waitFor("caches.keys().then(k=>k.includes('gn-v1'))", 5000), 'app shell cached');
  const inst = await cdp.send('Page.getInstallabilityErrors').catch(() => null); ok(!inst || inst.installabilityErrors.length === 0, 'installable' + (inst && inst.installabilityErrors.length ? ': ' + J(inst.installabilityErrors) : ''));

  // ---- each game by touch
  await startGame('Tic-Tac-Toe'); await audit('tic-tac-toe'); await shot('ttt');
  await tap('.ttt-cell:not(:disabled)'); ok(await waitFor("document.querySelectorAll('.ttt-cell.X').length===1 && document.querySelectorAll('.ttt-cell.O').length===1", 4000), 'tic-tac-toe: tap places X, computer answers with O'); await toMenu();
  await startGame('Connect Four'); await audit('connect four'); await tap('.c4-col:nth-child(4)'); ok(await waitFor("document.querySelectorAll('.disc').length>=1", 3000), 'connect four: tap drops a disc'); await shot('c4'); await toMenu();
  await startGame('Checkers'); await audit('checkers'); await tap('.ck-sq.mv'); ok(await ev("!!document.querySelector('.ck-sq.tg')"), 'checkers: tapping a piece shows where it can go');
  await tap('.ck-sq.tg'); ok(await waitFor("document.querySelector('.turnbar').textContent.includes('Your move') && document.querySelectorAll('.ck-sq.mv').length>0", 6000), 'checkers: move made, computer replied, my turn again'); await shot('checkers'); await toMenu();
  await startGame('Ludo'); await audit('ludo'); await shot('ludo'); await tap('.dice.ready'); ok(await waitFor("document.querySelector('.dicebar .info').textContent.includes('rolled')", 5000), 'ludo: tapping the dice rolls it');
  const ludoHit = await ev(`(()=>{const g=hub.game; const t=g.tok[0][0]; g.pick=null; t.el.classList.add('can'); const r=t.el.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2; const near=[[0,0],[10,0],[-10,0],[0,10],[0,-10]].map(([dx,dy])=>{const e=document.elementFromPoint(cx+dx,cy+dy);return !!(e&&e.closest('.tk')===t.el)}); t.el.classList.remove('can'); return {w:r.width,near}})()`);
  ok(ludoHit.near.every(Boolean), `ludo: a token can be hit within 10px of its centre (token ${Math.round(ludoHit.w)}px wide)`); await toMenu();
  await startGame('Snakes'); await audit('snakes & ladders'); await shot('snakes'); await tap('.dice.ready'); ok(await waitFor("document.querySelector('.dicebar .info').textContent.includes('rolled')", 5000), 'snakes & ladders: tapping the dice rolls it'); await toMenu();
  await startGame('Crazy Eights'); await audit('crazy eights'); await shot('cards');
  const before = await ev("document.querySelector('.turnbar').textContent"); await tap(await ev("document.querySelector('.hand .pc.ok')?'.hand .pc.ok':'.pile'"));
  ok(await waitFor(`document.querySelector('.turnbar').textContent!==${J(before)}||document.querySelector('.cg-me .who').textContent.length>0`, 4000), 'crazy eights: tapping a card / the draw pile works'); await toMenu();
  await toMenu(); await startGame('Dots'); await audit('dots & boxes'); await shot('dots'); await sleep(800);
  { const before = await ev("document.querySelectorAll('.db-ln.on').length"); await tap('.db-ln:not(.on)'); ok(await waitFor(`document.querySelectorAll('.db-ln.on').length > ${before}`, 3000), 'dots & boxes: tapping a line draws it'); await toMenu(); }

  // ---- online sheet + lobby by touch (typing included)
  await tap('button', 'Play Online'); await audit('online sheet'); await shot('online');
  await type('.overlay input', 'Sam'); await tap('.overlay .btn', 'Create room'); ok(await waitFor("/^[A-Z]{4}$/.test((document.querySelector('.overlay h3 span')||{}).textContent||'')", 4000), 'online: create room by touch shows a 4-letter code');
  await audit('online lobby'); await shot('lobby'); ok(await ev("[...document.querySelectorAll('.overlay .btn')].some(b=>b.textContent.includes('Share invite'))"), 'online lobby: invite share button present');
  await ev("hub.leaveOnline(), UI.closeAll(), true");

  // ---- other screen sizes: no overflow (tiny phone, big phone, landscape)
  for (const [w, h, name] of [[320, 568, 'small phone 320x568'], [412, 915, 'big phone 412x915'], [640, 360, 'landscape 640x360']]) {
    await setView(w, h); await goto(`http://localhost:${PORT}/`); await audit(name + ' menu');
    for (const g of ['ludo', 'snakes', 'ttt', 'c4', 'checkers', 'cards', 'dots']) {
      await ev(`(()=>{const G=GAMES.find(x=>x.meta.id===${J(g)});hub.launch(G,{mode:'cpu',level:'easy',opts:{},players:[{name:'Sam',cpu:false},{name:'Robo',cpu:true},{name:'Chip',cpu:true}].slice(0,G.meta.max>2?3:2),carry:{}});return true})()`); await sleep(500);
      await audit(`${name} ${g}`); if (w === 640) await shot('land-' + g);
    }
  }

  // ---- offline: reload with the network off; the app must still load from the service worker cache
  await setView(360, 640); await goto(`http://localhost:${PORT}/`); await waitFor("navigator.serviceWorker.ready.then(r=>!!r.active)", 8000); await sleep(500);
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send('Page.reload'); await sleep(2000);
  ok(await waitFor("document.querySelectorAll('.gcard').length===7", 6000), 'offline: app loads from the cache with no network');
  await startGame('Tic-Tac-Toe'); await tap('.ttt-cell:not(:disabled)'); ok(await waitFor("document.querySelectorAll('.ttt-cell.O').length===1", 4000), 'offline: single-player game works');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // ---- console errors
  const errs = cdp.ev.filter(m => (m.method === 'Runtime.exceptionThrown') || (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/Failed to load resource|net::ERR|WebSocket/.test(m.params.entry.text + (m.params.entry.url || ''))));
  ok(errs.length === 0, 'no uncaught errors in the console' + (errs.length ? ': ' + J(errs.slice(0, 2).map(e => e.params.exceptionDetails ? e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception || {}).description : e.params.entry.text)) : ''));
  finish(failed ? 1 : 0);
})().catch(e => { ok(false, 'test crashed: ' + e.message); finish(1); });
setTimeout(() => { ok(false, 'TIMEOUT'); finish(1); }, 240000);
