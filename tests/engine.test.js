// 运行：node tests/engine.test.js
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '..', 'game', 'engine.js'));

function seeded(s) { return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }
const names = n => Array.from({ length: n }, (_, i) => 'P' + i);
const targets = { 6: { sac: 3, kill: 5 }, 7: { sac: 4, kill: 5 }, 9: { sac: 5, kill: 7 }, 10: { sac: 6, kill: 7 } };

// 随机合法动作一直打到终局
function randomGame(n, seed) {
  const rng = seeded(seed);
  const g = E.createGame(names(n), { rng, targets });
  let steps = 0;
  while (g.phase !== 'end') {
    assert(++steps < 2000, '游戏没有结束');
    let p, a;
    switch (g.phase) {
      case 'night': p = g.night.ack.findIndex(x => !x); a = { type: 'ack' }; break;
      case 'speech': {
        p = g.holder;
        if (rng() < 0.3 && g.speech.pos < n) { p = g.speech.order[g.speech.pos]; a = { type: 'speechDone' }; break; }
        const opts = g.players.map((_, i) => i).filter(i => i !== g.holder && !g.players[i].used);
        a = { type: 'giveCoin', to: opts[Math.floor(rng() * opts.length)] };
        break;
      }
      case 'magic': {
        p = g.magic.by;
        const o = E.viewFor(g, p).magic.options;
        const k = E.MAGIC[g.magic.n].pick === 'two' ? 2 : 1;
        a = { type: 'magic', picks: o.slice().sort(() => rng() - 0.5).slice(0, k) };
        break;
      }
      case 'play': {
        p = g.play.cur;
        const v = E.viewFor(g, p);
        a = (!v.play.mustPlay && rng() < 0.4) ? { type: 'pass' } : { type: 'play', cardId: v.hand[Math.floor(rng() * v.hand.length)].id };
        break;
      }
      case 'swap':
        if (g.swap.stage === 'pick') { p = g.swap.by; const o = g.swap && E.viewFor(g, p).swap.options; a = { type: 'swapPick', target: rng() < 0.3 ? -1 : o[0] }; }
        else { p = g.swap.target; a = { type: 'swapCard', cardId: g.players[p].hand[0].id }; }
        break;
    }
    const err = E.act(g, p, a, rng);
    assert.strictEqual(err, null, `${g.phase} ${JSON.stringify(a)} -> ${err}`);
    JSON.parse(JSON.stringify(g)); // 状态必须能序列化
  }
  assert(g.round <= n, '轮数不应超过人数');
  return g;
}

let wins = { white: 0, blood: 0 };
for (let n = 5; n <= 10; n++) for (let s = 1; s <= 300; s++) wins[randomGame(n, s * 7919 + n).winner]++;
console.log('随机对局 1800 局通过，胜负分布', wins);

// 发牌
{
  const g = E.createGame(names(8), { rng: seeded(3) });
  const roles = g.players.map(p => p.role).sort().join();
  assert.strictEqual(roles, 'believer,believer,believer,bishop,giant,rose,shadow,twin');
  const twin = g.players.find(p => p.role === 'twin');
  assert.deepStrictEqual(twin.hand.map(c => c.t).sort(), ['believer', 'twin', 'twin']);
  assert.strictEqual(new Set(g.players.map(p => p.crystal)).size, 8, '水晶不重复');
  assert.deepStrictEqual(g.night.eyes.map(i => g.players[i].role).sort(), ['bishop', 'giant', 'rose', 'twin']);
  // 睁眼者只看到名字，看不到身份
  const v = E.viewFor(g, g.night.eyes[0]);
  assert.strictEqual(v.night.eyes.length, 3);
  assert(v.players.every((pl, i) => i === g.night.eyes[0] || pl.role === null));
  assert.throws(() => E.createGame(names(6)), /献祭/);
}

// 构造一个固定局面：直接改状态进入出牌阶段
function setup(n, magicNo) {
  const g = E.createGame(names(n), { rng: seeded(11), targets });
  g.night.ack.fill(true);
  E.act(g, 0, { type: 'ack' }); // 触发开局（ack 已全部为 true）
  g.holder = 0;
  g.players.forEach(p => { p.used = false; });
  g.players[1].crystal = magicNo;
  g.phase = 'speech';
  g.speech = { order: [0], pos: 0, at: 0 };
  return g;
}

// #5 同进同退
{
  const g = setup(6, 5);
  assert.strictEqual(E.act(g, 0, { type: 'giveCoin', to: 1 }), null);
  assert.strictEqual(E.act(g, 1, { type: 'magic', picks: [2, 4] }), null);
  E.act(g, 1, { type: 'pass' });
  E.act(g, 2, { type: 'play', cardId: g.players[2].hand[0].id });
  E.act(g, 3, { type: 'pass' });
  assert.strictEqual(g.play.cur, 4);
  assert.match(E.act(g, 4, { type: 'pass' }), /必须出牌/);
  E.act(g, 4, { type: 'play', cardId: g.players[4].hand[0].id });
  // 反过来：先决定的人不出，后一人自动不出
  const h = setup(6, 5);
  E.act(h, 0, { type: 'giveCoin', to: 1 });
  E.act(h, 1, { type: 'magic', picks: [2, 4] });
  E.act(h, 1, { type: 'pass' }); E.act(h, 2, { type: 'pass' }); E.act(h, 3, { type: 'pass' });
  assert.strictEqual(h.play.dec[4], 'pass');
  assert.strictEqual(h.play.cur, 5);
}

// #6 发动者最后；#3 右手边自动出牌
{
  const g = setup(6, 6);
  E.act(g, 0, { type: 'giveCoin', to: 1 });
  assert.deepStrictEqual(g.play.order, [2, 3, 4, 5, 0, 1]);
  const h = setup(6, 3);
  E.act(h, 0, { type: 'giveCoin', to: 1 });
  assert.notStrictEqual(h.play.dec[0], null);
  assert.strictEqual(h.players[0].hand.length, 2);
}

// 结算：血刃 + 白蔷薇同轮 → 血刃胜
{
  const g = setup(6, 2);
  const rose = g.players.findIndex(p => p.role === 'rose');
  const blade = g.players.findIndex(p => p.side === 'blood');
  E.act(g, 0, { type: 'giveCoin', to: 1 });
  while (g.phase === 'play') {
    const i = g.play.cur, h = g.players[i].hand;
    const want = i === rose ? 'rose' : i === blade ? (h.find(c => E.CARD[c.t].kind === 'blade') || {}).t : null;
    const c = want && h.find(c => c.t === want);
    E.act(g, i, c ? { type: 'play', cardId: c.id } : { type: 'pass' });
  }
  assert.strictEqual(g.winner, 'blood');
  assert(g.reveal.open && g.reveal.cards.every(c => c.by >= 0), '#2 公开出牌人');
}

console.log('全部测试通过');
