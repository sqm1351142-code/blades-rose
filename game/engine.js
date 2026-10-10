/* 血与刃的白蔷薇 · 规则引擎
 * 和网络无关：房主浏览器用它当裁判，node 测试也直接加载它。
 * 状态 g 是纯 JSON，可以直接存进 localStorage。 */
(function (root) {
  'use strict';

  const CARD = {
    rose:     { name: '白蔷薇', kind: 'flower' },
    bishop:   { name: '司教',   kind: 'flower' },
    believer: { name: '信者',   kind: 'flower' },
    giant:    { name: '巨刃',   kind: 'blade' },
    twin:     { name: '双刃',   kind: 'blade' },
    shadow:   { name: '暗刃',   kind: 'blade' },
    ghost:    { name: '幽魂',   kind: 'ghost' },
  };

  // 规则书"游戏准备"表
  const COMPOSITION = {
    5:  { rose: 1, bishop: 1, believer: 1, giant: 0, twin: 1, shadow: 1 },
    6:  { rose: 1, bishop: 1, believer: 2, giant: 0, twin: 1, shadow: 1 },
    7:  { rose: 1, bishop: 1, believer: 2, giant: 1, twin: 1, shadow: 1 },
    8:  { rose: 1, bishop: 1, believer: 3, giant: 1, twin: 1, shadow: 1 },
    9:  { rose: 1, bishop: 1, believer: 3, giant: 2, twin: 1, shadow: 1 },
    10: { rose: 1, bishop: 1, believer: 4, giant: 2, twin: 1, shadow: 1 },
  };

  // sac：白蔷薇之外还要献祭几朵小花；kill：死亡区小花达到几朵血刃胜。
  // 5 人由用户确认；8 人来自评测文章（大花 + 5 小花 / 杀 6 小花）；其余人数由房主填。
  const DEFAULT_TARGETS = { 5: { sac: 3, kill: 4 }, 8: { sac: 5, kill: 6 } };

  const EYES = ['rose', 'bishop', 'twin', 'giant'];

  // pick：发动时需要选的目标。other=除自己外一人，any=任意一人，two=任意两人，peek=除自己外有手牌的一人
  const MAGIC = {
    1:  { text: '指定某人必须出牌', pick: 'other' },
    2:  { text: '这一回合出的牌不混洗就公开' },
    3:  { text: '右边随机出 1 张手牌' },
    4:  { text: '左边随机出 1 张手牌' },
    5:  { text: '绑定两人出牌（同进同退）', pick: 'two' },
    6:  { text: '我最后一个决定是否出牌' },
    7:  { text: '指定某人拿 1 张幽魂', pick: 'any' },
    8:  { text: '左右两家有牌必须出牌' },
    9:  { text: '入夜，暗刃看白蔷薇和司教' },
    10: { text: '最后决定是否让某人替换出牌' },
    11: { text: '抽某人一张牌偷看', pick: 'peek' },
    12: { text: '指定某人必须出牌', pick: 'other' },
  };

  const kind = c => CARD[c.t].kind;
  const isSmall = c => c.t === 'bishop' || c.t === 'believer';
  const cname = c => CARD[c.t].name;

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function targetsFor(n, custom) {
    const t = (custom && custom[n]) || DEFAULT_TARGETS[n];
    return t && t.sac > 0 && t.kill > 0 ? { sac: t.sac | 0, kill: t.kill | 0 } : null;
  }

  function log(g, text, cls) { g.log.push({ r: g.round, text, cls: cls || '' }); }
  function secret(g, p, text) { g.players[p].secrets.push({ r: g.round, text }); }
  const nm = (g, i) => g.players[i].name;
  const left = (g, i) => (i + 1) % g.n;           // 顺时针下一位 = 左手边
  const right = (g, i) => (i - 1 + g.n) % g.n;    // 持币者右手边最后决定

  function createGame(names, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const n = names.length;
    if (!COMPOSITION[n]) throw new Error('人数需要 5–10 人');
    const t = targetsFor(n, opts.targets);
    if (!t) throw new Error(n + ' 人局还没有设置献祭 / 击杀目标');

    const g = {
      n, uid: 0, sac: t.sac, kill: t.kill,
      speechSec: opts.speechSec == null ? 60 : opts.speechSec,
      phase: 'night', round: 0, holder: Math.floor(rng() * n),
      slots: [], sacrifice: [], death: [], log: [], history: [],
      night: null, speech: null, magic: null, play: null, swap: null, reveal: null,
      winner: null, reason: '', seq: 0, flash9: 0,
    };
    const card = type => ({ id: 'c' + (++g.uid), t: type });

    const roles = [];
    for (const [r, k] of Object.entries(COMPOSITION[n])) for (let i = 0; i < k; i++) roles.push(r);
    shuffle(roles, rng);
    const crystals = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], rng).slice(0, n);

    g.players = names.map((name, i) => {
      const role = roles[i];
      // 双刃在线上直接发好：双刃 × 2 + 信者
      const hand = role === 'twin'
        ? [card('twin'), card('twin'), card('believer')]
        : [card('ghost'), card('believer'), card(role)];
      return { name, role, side: kind({ t: role }) === 'blade' ? 'blood' : 'white', hand, crystal: crystals[i], used: false, secrets: [] };
    });
    g.night = { eyes: g.players.map((p, i) => EYES.includes(p.role) ? i : -1).filter(i => i >= 0), ack: g.players.map(() => false) };
    log(g, `${n} 人局开始：献祭白蔷薇 + ${t.sac} 朵花苞，或击杀 ${t.kill} 朵花苞`);
    log(g, `金币先交给 ${nm(g, g.holder)}`, 'g');
    return g;
  }

  /* ---------- 回合流程 ---------- */

  function startRound(g) {
    g.round++;
    g.phase = 'speech';
    const order = [];
    for (let k = 0, i = g.holder; k < g.n; k++, i = left(g, i)) order.push(i);
    g.speech = { order, pos: 0, at: Date.now() };
    g.magic = g.play = g.swap = null;
    log(g, `第 ${g.round} 轮开始，队长 ${nm(g, g.holder)}`, 'g');
  }

  function canReceive(g, i) { return i !== g.holder && !g.players[i].used; }

  function giveCoin(g, to, rng) {
    if (!(to >= 0 && to < g.n) || !canReceive(g, to)) throw new Error('只能交给另一位还有白水晶的玩家');
    const from = g.holder;
    g.holder = to;
    const pl = g.players[to];
    pl.used = true;
    g.slots.push({ n: pl.crystal, by: to });
    log(g, `${nm(g, from)} 把金币交给 ${pl.name}`);
    log(g, `${pl.name} 放入白水晶 #${pl.crystal}：${MAGIC[pl.crystal].text}`, 'g');

    const order = [];
    for (let k = 0, i = to; k < g.n; k++, i = left(g, i)) order.push(i);
    g.speech = null;
    g.play = { order, dec: g.players.map(() => null), auto: [], forced: [], bind: null, open: false, swapBy: -1, cur: -1 };
    g.magic = { n: pl.crystal, by: to };
    if (MAGIC[pl.crystal].pick && pickOptions(g).length) { g.phase = 'magic'; return; }
    applyMagic(g, [], rng);
  }

  // 当前魔法可选的目标
  function pickOptions(g) {
    const { n, by } = g.magic;
    const all = g.players.map((_, i) => i);
    switch (MAGIC[n].pick) {
      case 'other': return all.filter(i => i !== by);
      case 'any': case 'two': return all;
      case 'peek': return all.filter(i => i !== by && g.players[i].hand.length);
      default: return [];
    }
  }

  function autoPlay(g, i, rng) {
    const h = g.players[i].hand;
    if (!h.length) { log(g, `${nm(g, i)} 没有手牌，效果落空`); return; }
    const [c] = h.splice(Math.floor(rng() * h.length), 1);
    g.play.dec[i] = c;
    g.play.auto.push(i);
    log(g, `${nm(g, i)} 被随机盖出了一张牌`);
  }

  function applyMagic(g, picks, rng) {
    const { n, by } = g.magic;
    const P = g.play;
    const opts = pickOptions(g);
    const need = MAGIC[n].pick === 'two' ? 2 : MAGIC[n].pick ? 1 : 0;
    if (need && opts.length) {
      if (!Array.isArray(picks) || picks.length !== need || new Set(picks).size !== need || !picks.every(x => opts.includes(x)))
        throw new Error('目标选择不合法');
    }
    const t = picks[0];
    switch (n) {
      case 1: case 12:
        if (g.players[t].hand.length) P.forced.push(t);
        log(g, `${nm(g, by)} 指定 ${nm(g, t)} 本轮必须出牌`);
        break;
      case 2:
        P.open = true;
        log(g, '本轮出的牌不混洗，翻开时能看到是谁出的');
        break;
      case 3: autoPlay(g, right(g, by), rng); break;
      case 4: autoPlay(g, left(g, by), rng); break;
      case 5:
        P.bind = picks.slice();
        log(g, `${nm(g, picks[0])} 和 ${nm(g, picks[1])} 被绑定：本轮同进同退`);
        break;
      case 6:
        P.order = P.order.filter(i => i !== by).concat(by);
        log(g, `${nm(g, by)} 改为本轮最后一个决定`);
        break;
      case 7:
        g.players[t].hand.push({ id: 'c' + (++g.uid), t: 'ghost' });
        log(g, `${nm(g, by)} 让 ${nm(g, t)} 拿了 1 张幽魂`);
        break;
      case 8:
        for (const i of [left(g, by), right(g, by)]) if (g.players[i].hand.length) P.forced.push(i);
        log(g, `${nm(g, left(g, by))} 和 ${nm(g, right(g, by))} 有牌必须出牌`);
        break;
      case 9: {
        const seen = g.players.map((p, i) => (p.role === 'rose' || p.role === 'bishop') ? p.name : null).filter(Boolean);
        g.players.forEach((p, i) => { if (p.role === 'shadow') secret(g, i, `入夜：白蔷薇和司教是 ${seen.join('、')}（不分先后）`); });
        g.flash9 = ++g.seq;
        log(g, '入夜，暗刃睁眼看了白蔷薇和司教');
        break;
      }
      case 10:
        P.swapBy = by;
        log(g, `所有人出完牌后，${nm(g, by)} 可以让一位出了牌的人替换出牌`);
        break;
      case 11:
        if (t == null) { log(g, '没有人有手牌，偷看落空'); break; }
        {
          const h = g.players[t].hand;
          secret(g, by, `你偷看了 ${nm(g, t)} 的一张牌：${cname(h[Math.floor(rng() * h.length)])}`);
          log(g, `${nm(g, by)} 偷看了 ${nm(g, t)} 一张牌`);
        }
        break;
    }
    g.phase = 'play';
    advancePlay(g, rng);
  }

  // 绑定规则：后决定的人跟随先决定的人
  function bindRule(g, i) {
    const b = g.play.bind;
    if (!b || !b.includes(i)) return null;
    const other = b[0] === i ? b[1] : b[0];
    const d = g.play.dec[other];
    if (d === null) return null;
    return d === 'pass' ? 'pass' : 'play';
  }

  function mustPlay(g, i) { return g.play.forced.includes(i) || bindRule(g, i) === 'play'; }

  function advancePlay(g, rng) {
    const P = g.play;
    for (const i of P.order) {
      if (P.dec[i] !== null) continue;
      if (!g.players[i].hand.length) { P.dec[i] = 'pass'; log(g, `${nm(g, i)} 没有手牌，不出`); continue; }
      if (bindRule(g, i) === 'pass') { P.dec[i] = 'pass'; log(g, `${nm(g, i)} 被绑定，跟着不出`); continue; }
      P.cur = i;
      return;
    }
    P.cur = -1;
    if (P.swapBy >= 0 && swapOptions(g).length) {
      g.phase = 'swap';
      g.swap = { stage: 'pick', by: P.swapBy, target: -1 };
      return;
    }
    resolve(g, rng);
  }

  function swapOptions(g) {
    const P = g.play;
    return P.order.filter(i => P.dec[i] && P.dec[i] !== 'pass' && g.players[i].hand.length);
  }

  function resolve(g, rng) {
    const P = g.play;
    const played = P.order.filter(i => P.dec[i] && P.dec[i] !== 'pass').map(i => ({ by: i, t: P.dec[i].t, auto: P.auto.includes(i) }));
    g.history.push({ round: g.round, holder: g.holder, magic: g.magic.n, plays: played.map(x => ({ ...x })) });
    const cards = played.map(x => P.dec[x.by]);
    const hasBlade = cards.some(c => kind(c) === 'blade');
    const hasRose = cards.some(c => c.t === 'rose');
    const flowers = cards.filter(c => kind(c) === 'flower');
    let result;
    if (!cards.length) result = 'none';
    else if (hasBlade && hasRose) { result = 'roseKilled'; g.death.push(...flowers); }
    else if (hasBlade) { result = 'death'; g.death.push(...flowers); }
    else { result = 'sacrifice'; g.sacrifice.push(...flowers); }

    const shown = P.open ? played.map(x => ({ t: x.t, by: x.by })) : shuffle(played.map(x => ({ t: x.t })), rng);
    g.reveal = { round: g.round, cards: shown, open: P.open, result, seq: ++g.seq };
    const names = shown.map(x => CARD[x.t].name).join('、');
    if (result === 'none') log(g, '本轮没有人出牌');
    else if (result === 'sacrifice') log(g, `翻开 ${names} → 没有血刃，${flowers.length} 朵花献祭`, 'w');
    else log(g, `翻开 ${names} → 出现血刃，${flowers.length} 朵花进入死亡区`, 'r');

    const sacSmall = g.sacrifice.filter(isSmall).length;
    const deadSmall = g.death.filter(isSmall).length;
    if (result === 'roseKilled') return finish(g, 'blood', '白蔷薇与血刃同轮出现，白蔷薇被杀');
    if (g.sacrifice.some(c => c.t === 'rose') && sacSmall >= g.sac) return finish(g, 'white', `白蔷薇与 ${sacSmall} 朵花苞献祭成功`);
    if (deadSmall >= g.kill) return finish(g, 'blood', `血刃击杀了 ${deadSmall} 朵花苞`);
    if (g.players.every(p => p.used)) {
      const remain = g.players.some(p => p.side === 'white' && p.hand.some(c => kind(c) === 'flower'));
      return remain ? finish(g, 'blood', '水晶槽已满，白方手里还有花牌')
                  : finish(g, 'white', '水晶槽已满，白方手里已经没有花牌');
    }
    startRound(g);
  }

  function finish(g, side, reason) {
    g.phase = 'end';
    g.winner = side;
    g.reason = reason;
    g.speech = g.swap = null;
    log(g, (side === 'white' ? '白蔷薇阵营胜利：' : '血刃阵营胜利：') + reason, side === 'white' ? 'w' : 'r');
  }

  /* ---------- 玩家动作 ---------- */

  // 返回 null 表示成功，否则返回错误文字。
  function act(g, p, a, rng) {
    rng = rng || Math.random;
    try {
      if (!g.players[p]) throw new Error('你不在这局游戏里');
      const P = g.play;
      switch (a && a.type) {
        case 'ack':
          need(g.phase === 'night', '现在不是夜晚');
          g.night.ack[p] = true;
          if (g.night.ack.every(Boolean)) { log(g, '天亮了'); startRound(g); }
          break;
        case 'speechDone': {
          need(g.phase === 'speech', '现在不是发言阶段');
          const S = g.speech;
          need(S.order[S.pos] === p, '还没轮到你发言');
          S.pos++;
          S.at = Date.now();
          break;
        }
        case 'giveCoin':
          need(g.phase === 'speech', '现在不能交金币');
          need(g.holder === p, '只有队长能交金币');
          giveCoin(g, a.to, rng);
          break;
        case 'magic':
          need(g.phase === 'magic' && g.magic.by === p, '现在不该你发动魔法');
          applyMagic(g, a.picks || [], rng);
          break;
        case 'play': case 'pass': {
          need(g.phase === 'play' && P.cur === p, '还没轮到你出牌');
          if (a.type === 'pass') {
            need(!mustPlay(g, p), '你本轮必须出牌');
            P.dec[p] = 'pass';
            log(g, `${nm(g, p)} 不出`);
          } else {
            const h = g.players[p].hand;
            const k = h.findIndex(c => c.id === a.cardId);
            need(k >= 0, '手里没有这张牌');
            P.dec[p] = h.splice(k, 1)[0];
            log(g, `${nm(g, p)} 盖出一张牌`);
          }
          advancePlay(g, rng);
          break;
        }
        case 'swapPick':
          need(g.phase === 'swap' && g.swap.stage === 'pick' && g.swap.by === p, '现在不该你选择');
          if (a.target == null || a.target < 0) { log(g, `${nm(g, p)} 放弃替换`); g.swap = null; resolve(g, rng); break; }
          need(swapOptions(g).includes(a.target), '只能选出了牌且手里还有牌的人');
          g.swap.stage = 'card';
          g.swap.target = a.target;
          log(g, `${nm(g, p)} 要求 ${nm(g, a.target)} 替换出牌`);
          break;
        case 'swapCard': {
          need(g.phase === 'swap' && g.swap.stage === 'card' && g.swap.target === p, '现在不该你换牌');
          const h = g.players[p].hand;
          const k = h.findIndex(c => c.id === a.cardId);
          need(k >= 0, '手里没有这张牌');
          const old = P.dec[p];
          P.dec[p] = h.splice(k, 1, old)[0];
          P.auto = P.auto.filter(i => i !== p);
          log(g, `${nm(g, p)} 换了一张牌`);
          g.swap = null;
          resolve(g, rng);
          break;
        }
        default: throw new Error('未知动作');
      }
      return null;
    } catch (e) {
      return e.message;
    }
  }
  function need(ok, msg) { if (!ok) throw new Error(msg); }

  /* ---------- 每个玩家能看到的部分 ---------- */

  function viewFor(g, p) {
    const end = g.phase === 'end';
    const me = g.players[p];
    const v = {
      n: g.n, phase: g.phase, round: g.round, holder: g.holder, sac: g.sac, kill: g.kill, speechSec: g.speechSec,
      slots: g.slots, sacrifice: g.sacrifice.map(c => c.t), death: g.death.map(c => c.t),
      log: g.log.slice(-120), reveal: g.reveal, flash9: g.flash9, winner: g.winner, reason: g.reason,
      players: g.players.map((pl, i) => ({
        name: pl.name, cards: pl.hand.length, used: pl.used,
        role: end || i === p ? pl.role : null, side: end || i === p ? pl.side : null,
        hand: end ? pl.hand.map(c => c.t) : null, crystal: end || i === p ? pl.crystal : null,
      })),
      me: me ? p : -1,
      hand: me ? me.hand : [],
      secrets: me ? me.secrets : [],
      canReceive: g.phase === 'speech' ? g.players.map((_, i) => canReceive(g, i)) : null,
    };
    if (g.phase === 'night') {
      v.night = { acked: g.night.ack.filter(Boolean).length, mine: !!g.night.ack[p], eyes: g.night.eyes.includes(p) ? g.night.eyes.filter(i => i !== p) : null };
    }
    if (g.speech) {
      const S = g.speech;
      v.speech = { order: S.order, pos: S.pos, left: g.speechSec ? Math.max(0, g.speechSec * 1000 - (Date.now() - S.at)) : 0 };
    }
    if (g.magic) v.magic = { n: g.magic.n, by: g.magic.by, options: g.phase === 'magic' ? pickOptions(g) : null };
    if (g.play && g.phase !== 'end') {
      const P = g.play;
      v.play = {
        order: P.order, cur: P.cur, open: P.open, forced: P.forced, bind: P.bind, swapBy: P.swapBy, auto: P.auto,
        status: g.players.map((_, i) => P.dec[i] === null ? (i === P.cur ? 'cur' : 'wait') : P.dec[i] === 'pass' ? 'pass' : 'played'),
        mine: me && P.dec[p] && P.dec[p] !== 'pass' ? P.dec[p] : null,
        mustPlay: me && P.cur === p ? mustPlay(g, p) : false,
      };
    }
    if (g.swap) v.swap = { stage: g.swap.stage, by: g.swap.by, target: g.swap.target, options: swapOptions(g) };
    if (end) v.history = g.history;
    return v;
  }

  const api = { CARD, COMPOSITION, DEFAULT_TARGETS, MAGIC, EYES, createGame, act, viewFor, targetsFor };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);
