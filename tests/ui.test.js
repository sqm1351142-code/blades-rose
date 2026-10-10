// 运行：node tests/ui.test.js —— 每一步给每位玩家渲染界面，确认不报错、不泄露别人的身份
const assert = require('assert');
const path = require('path');
global.self = global;
global.Engine = require(path.join(__dirname, '..', 'game', 'engine.js'));
require(path.join(__dirname, '..', 'game', 'ui.js'));
const E = Engine;

function seeded(s) { return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }

for (const n of [5, 8, 10]) for (let seed = 1; seed <= 40; seed++) {
  const rng = seeded(seed * 31 + n);
  const names = Array.from({ length: n }, (_, i) => '玩家' + i);
  const g = E.createGame(names, { rng, targets: { 10: { sac: 6, kill: 7 } } });
  const room = { code: 'TEST', hostPid: 'p0', settings: { targets: {}, speechSec: 60 }, members: names.map((x, i) => ({ pid: 'p' + i, name: x, online: true })) };
  let steps = 0;
  const renderAll = () => {
    for (let p = 0; p < n; p++) {
      const view = JSON.parse(JSON.stringify(E.viewFor(g, p)));
      const S = { room, view, host: p === 0, pid: 'p' + p, online: view.players.map(() => true), ui: { picks: [], card: null, reveal: true, flash: true }, speechLeft: () => 1000 };
      const html = UI.game(S) + UI.overlay(S);
      S.ui.flash = false; UI.overlay(S);
      const bad = html.match(/[^]{0,80}(undefined|NaN|\[object)[^]{0,80}/);
      assert(!bad, bad && `渲染出了 ${bad[1]}：phase=${g.phase}\n${bad[0]}`);
      if (g.phase !== 'end') {
        // 别人的身份不能出现在视图里
        view.players.forEach((pl, i) => { if (i !== p) assert.strictEqual(pl.role, null); });
      }
    }
  };
  while (g.phase !== 'end') {
    assert(++steps < 3000);
    renderAll();
    let p, a;
    switch (g.phase) {
      case 'night': p = g.night.ack.findIndex(x => !x); a = { type: 'ack' }; break;
      case 'speech': {
        if (rng() < 0.3 && g.speech.pos < n) { p = g.speech.order[g.speech.pos]; a = { type: 'speechDone' }; break; }
        p = g.holder;
        const o = g.players.map((_, i) => i).filter(i => i !== g.holder && !g.players[i].used);
        a = { type: 'giveCoin', to: o[Math.floor(rng() * o.length)] };
        break;
      }
      case 'magic': { p = g.magic.by; const o = E.viewFor(g, p).magic.options; a = { type: 'magic', picks: o.slice(0, E.MAGIC[g.magic.n].pick === 'two' ? 2 : 1) }; break; }
      case 'play': { p = g.play.cur; const v = E.viewFor(g, p); a = (!v.play.mustPlay && rng() < 0.4) ? { type: 'pass' } : { type: 'play', cardId: v.hand[0].id }; break; }
      case 'swap':
        if (g.swap.stage === 'pick') { p = g.swap.by; a = { type: 'swapPick', target: g.swap && E.viewFor(g, p).swap.options[0] }; }
        else { p = g.swap.target; a = { type: 'swapCard', cardId: g.players[p].hand[0].id }; }
        break;
    }
    assert.strictEqual(E.act(g, p, a, rng), null);
  }
  renderAll();
}

// 首页和等待房间
const S0 = { name: '阿卡', joinCode: '', status: '', room: null, host: true, pid: 'p0', ui: { picks: [] } };
assert(UI.home(S0).includes('创建房间'));
for (let n = 1; n <= 10; n++) {
  const room = { code: 'K7Q2', hostPid: 'p0', settings: { targets: {}, speechSec: 60 }, members: Array.from({ length: n }, (_, i) => ({ pid: 'p' + i, name: 'P' + i, online: true })) };
  const html = UI.lobby({ ...S0, room });
  assert(!/undefined|NaN/.test(html), 'lobby ' + n);
  assert.strictEqual(/data-act="start" *>/.test(html), n === 5 || n === 8, `${n} 人开始按钮状态`);
}
console.log('界面渲染测试通过');
