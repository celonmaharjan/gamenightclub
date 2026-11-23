const out = document.getElementById('out'), log = m => out.textContent += m + '\n', sleep = ms => new Promise(r => setTimeout(r, ms));
window.addEventListener('error', e => log('ERROR ' + e.message)); window.addEventListener('unhandledrejection', e => log('REJECT ' + String(e.reason && e.reason.stack || String(e.reason))));
const $$ = s => [...document.querySelectorAll(s)], pick = a => a[Math.floor(Math.random() * a.length)], click = e => e && e.click();
const P = (n, humans) => Array.from({ length: n }, (_, i) => ({ name: 'P' + (i + 1), cpu: i >= humans }));
/** One "human" action, using only the DOM like a real player. */
const bots = {
  ttt: () => click(pick($$('.ttt-cell:not(:disabled)'))),
  c4: () => click(pick($$('.c4-col'))),
  checkers: () => { const t = $$('.ck-sq.tg'); if (t.length) return click(pick(t)); click(pick($$('.ck-sq.mv'))); },
  ludo: () => { const d = $$('.dice.ready'); if (d.length) return click(d[0]); click(pick($$('.tk.can'))); },
  snakes: () => click($$('.dice.ready')[0]),
  dots: () => click(pick($$('.db-ln:not(.on)'))),
  cards: () => {
    const cv = $$('.cover button'); if (cv.length) return click(cv[0]);
    const sp = $$('.suitpick button'); if (sp.length) return click(pick(sp));
    const lc = $$('.last:not(:disabled):not(.on)'); if (lc.length && Math.random() < .85) return click(lc[0]);   // call LAST CARD before playing
    const ok = $$('.hand .pc.ok'); if (ok.length) return click(pick(ok));
    click($$('.pile.glow')[0]);
  }
};
async function play(id, humans, n, extra = {}, maxSec = 7000) {
  const G = hub.constructor === Hub && GAMES.find(g => g.meta.id === id);
  hub.launch(G, Object.assign({ mode: humans < n ? 'cpu' : 'pass', level: 'medium', opts: {}, players: P(n, humans), carry: {} }, extra));
  const g = hub.game; let t = 0; while (!g.over && t < maxSec) { await sleep(400); t++; if (humans) { try { bots[id](); } catch (e) { log('FAIL bot ' + id + ' ' + e); } } }
  const ok = g.over; log((ok ? 'ok   ' : 'FAIL ') + `${id} humans=${humans}/${n} over=${ok} turns≈${t}`); return g;
}
(async () => {
  await sleep(400);
  // 1) human paths in every game (human vs computer, and hot-seat where it applies)
  await play('ttt', 1, 2); await play('ttt', 2, 2);
  await play('c4', 1, 2); await play('c4', 2, 2);
  await play('checkers', 1, 2); await play('checkers', 2, 2);
  await play('ludo', 1, 4); await play('ludo', 2, 3, { opts: { blocks: false, bonus: true } });
  await play('snakes', 1, 4); await play('snakes', 2, 2);
  await play('dots', 1, 2); await play('dots', 2, 3, { opts: { big: true } });
  await play('cards', 1, 3); await play('cards', 2, 2); await play('cards', 3, 3, { opts: { actions: false } });
  // 2) difficulty levels run
  for (const lv of ['easy', 'hard']) { await play('ttt', 0, 2, { level: lv }); await play('c4', 0, 2, { level: lv }); await play('checkers', 0, 2, { level: lv }); await play('ludo', 0, 2, { level: lv }); await play('cards', 0, 2, { level: lv }); await play('dots', 0, 3, { level: lv }); }
  // 3) undo
  let g; hub.launch(GAMES.find(x => x.meta.id === 'ttt'), { mode: 'cpu', level: 'hard', opts: {}, players: P(2, 1), carry: { round: 0 } }); g = hub.game; await sleep(600);
  click($$('.ttt-cell')[4]); await sleep(1500); const before = g.moves.length; $$('.tools button')[0].click(); await sleep(300);
  log((before === 2 && g.moves.length === 0 ? 'ok   ' : 'FAIL ') + `ttt undo (moves ${before} -> ${g.moves.length})`);
  hub.launch(GAMES.find(x => x.meta.id === 'c4'), { mode: 'cpu', level: 'easy', opts: {}, players: P(2, 1), carry: { round: 0 } }); g = hub.game; await sleep(600);
  click($$('.c4-col')[3]); await sleep(2500); const cb = g.moves.length; $$('.tools button')[0].click(); await sleep(300);
  log((cb === 2 && g.moves.length === 0 && !document.querySelector('.disc') ? 'ok   ' : 'FAIL ') + `c4 undo (moves ${cb} -> ${g.moves.length})`);
  hub.launch(GAMES.find(x => x.meta.id === 'checkers'), { mode: 'cpu', level: 'easy', opts: {}, players: P(2, 1), carry: {} }); g = hub.game; await sleep(500);
  click($$('.ck-sq.mv')[0]); await sleep(200); click($$('.ck-sq.tg')[0]); await sleep(3000);
  const pieces = () => $$('.ck-pc').length, mid = JSON.stringify(g.board.map(p => p && p.p)); $$('.tools button')[0].click(); await sleep(300);
  const init = g.board.filter(Boolean).length === 24 && g.board.slice(40).filter(Boolean).length === 12 && g.cur === 0 && g.hist.length === 1;
  log((init && pieces() === 24 ? 'ok   ' : 'FAIL ') + `checkers undo restores start (pieces ${pieces()}, hist ${g.hist.length})`);
  // 4) save + resume for every game
  for (const G of GAMES) {
    const id = G.meta.id, cnt = id === 'ludo' || id === 'snakes' || id === 'cards' ? 3 : 2;
    Store.set('save', null); hub.launch(G, { mode: 'cpu', level: 'medium', opts: {}, players: P(cnt, 1), carry: {} }); await sleep(3000); for (let i = 0; i < (id === 'ttt' || id === 'c4' ? 1 : 6); i++) { try { bots[id](); } catch (e) { } await sleep(500); }
    const sv = Store.get('save', null); hub.toMenu(); const shown = !!document.querySelector('.resume');
    if (!sv || !shown) { log(`FAIL resume ${id}: save=${!!sv} banner=${shown}`); continue; }
    hub.resume(); await sleep(2500); const g2 = hub.game; log((g2 && g2.constructor === G && !g2.dead ? 'ok   ' : 'FAIL ') + `save/resume ${id}`);
  }
  // 4b) stats recorded + stats sheet; first player alternates on Play Again
  { const st = Store.get('stats', {}); const okS = st.ttt && st.ttt.played >= 3 && st.dots && st.dots.played >= 2 && st.ttt.won + st.ttt.lost + st.ttt.drawn >= 1;
    hub.toMenu(); [...$$('.resume button')].find(b => b.textContent.includes('Stats')).click(); await sleep(100);
    log((okS && $$('table.stats tr').length >= 3 ? 'ok   ' : 'FAIL ') + `stats recorded and shown (${JSON.stringify(st.ttt)})`); UI.closeAll(); }
  { const firsts = []; const carry = {}; for (let k = 0; k < 3; k++) { hub.launch(GAMES.find(x => x.meta.id === 'ludo'), { mode: 'pass', level: 'easy', opts: {}, players: P(3, 3), carry }); firsts.push(hub.game.cur); }
    log((firsts.join() === '0,1,2' ? 'ok   ' : 'FAIL ') + `first player rotates each new game (${firsts})`); }
  // 5) rules sheet + setup sheet render, theme switch, win tally
  hub.toMenu(); $$('.gcard')[0].click(); await sleep(100); log(($$('.seg').length >= 2 && $$('.tog').length >= 1 ? 'ok   ' : 'FAIL ') + 'setup sheet (modes, skill, options)'); UI.closeAll();
  hub.launch(GAMES[2], { mode: 'cpu', level: 'easy', opts: {}, players: P(2, 1), carry: { wins: [2, 1] } }); await sleep(300); [...$$('.tools button')].pop().click(); await sleep(100);
  log(($$('.rules li').length >= 3 && /P1 2/.test(document.querySelector('.scoreline').textContent) ? 'ok   ' : 'FAIL ') + 'rules sheet + win tally'); UI.closeAll();
  log('ALL DONE');
})();
