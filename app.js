/* 应用状态与联机逻辑。房主：持有 room + game，执行规则引擎并把每人的视图推送过去。
 * 玩家：只发动作、收视图。房主自己也走同一套视图渲染。 */
(function () {
  'use strict';
  const E = Engine, $ = s => document.querySelector(s);
  const mk = area => ({
    get(k, d) { try { const v = area().getItem('br.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { area().setItem('br.' + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { area().removeItem('br.' + k); } catch (e) {} },
  });
  const store = mk(() => localStorage);
  // 玩家 ID 和所在房间按标签页记：刷新还在，同一浏览器开多个标签页就是多个玩家
  const tab = mk(() => sessionStorage);
  const rid = n => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

  const params = new URLSearchParams(location.search);
  const S = {
    pid: tab.get('pid') || (() => { const p = rid(12); tab.set('pid', p); return p; })(),
    name: store.get('name', ''),
    joinCode: (params.get('room') || '').toUpperCase(),
    status: '',
    host: false, room: null, view: null, net: null, link: '',
    online: [], recvAt: 0,
    ui: { picks: [], card: null, reveal: false, flash: false },
    seenReveal: -1, seen9: -1,
    speechLeft() { return S.view && S.view.speech ? S.view.speech.left - (Date.now() - S.recvAt) : 0; },
  };
  // 房主专用
  let room = null, game = null;
  const connPid = new Map(); // connectionId -> pid

  /* ---------- 渲染 ---------- */
  function render() {
    const app = $('#app');
    const focus = document.activeElement && document.activeElement.id;
    if (!S.room) app.innerHTML = UI.home(S);
    else if (!S.view) app.innerHTML = UI.lobby(S);
    else app.innerHTML = UI.game(S);
    $('#overlay').innerHTML = UI.overlay(S);
    if (focus && document.getElementById(focus)) document.getElementById(focus).focus();
  }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800); }

  // 收到新视图：处理翻牌 / 入夜浮层，清掉过期的选择
  function applyView(roomPub, view) {
    const prev = S.view;
    S.room = roomPub; S.view = view; S.recvAt = Date.now();
    S.online = view ? view.players.map((_, i) => { const pid = roomPub.seats && roomPub.seats[i]; const m = roomPub.members.find(x => x.pid === pid); return !!(m && m.online); }) : [];
    if (view) {
      const rs = view.reveal ? view.reveal.seq : 0;
      if (S.seenReveal < 0) S.seenReveal = rs;
      if (rs > S.seenReveal) { S.seenReveal = rs; S.ui.reveal = true; }
      if (S.seen9 < 0) S.seen9 = view.flash9;
      if (view.flash9 > S.seen9) { S.seen9 = view.flash9; S.ui.flash = true; setTimeout(() => { S.ui.flash = false; render(); }, 3500); }
      const key = v => v && [v.phase, v.round, v.holder, v.play && v.play.cur, v.swap && v.swap.stage].join('|');
      if (key(prev) !== key(view)) { S.ui.picks = []; S.ui.card = null; }
    } else { S.seenReveal = -1; S.seen9 = -1; S.ui.reveal = false; }
    render();
  }

  /* ---------- 房主 ---------- */
  function pubRoom() {
    return {
      code: room.code, hostPid: room.hostPid, settings: room.settings, seats: room.seats,
      members: room.members.map(m => ({ pid: m.pid, name: m.name, online: m.pid === room.hostPid || [...connPid.values()].includes(m.pid) })),
    };
  }
  const seatOf = pid => room.seats ? room.seats.indexOf(pid) : -1;
  function viewOf(pid) { return game ? E.viewFor(game, seatOf(pid)) : null; }
  function save() { store.set('host.' + room.code, { room, game }); }
  // 公共中转服务器偶尔会丢消息，所以：状态带版本号，玩家定时核对；动作带编号，没收到回执就重发
  let ver = 0, flushT = 0;
  const lastAct = new Map(); // pid -> 最近处理过的动作编号
  function sendState(conn, pub) {
    const pid = connPid.get(conn.connectionId);
    if (pid) S.net.send(conn, { t: 'state', v: ver, ack: lastAct.get(pid) || '', room: pub || pubRoom(), view: viewOf(pid) });
  }
  function broadcast() {
    ver++;
    save();
    const pub = pubRoom();
    applyView(pub, viewOf(S.pid));
    // 连续几次变化合并成一次发送
    if (!flushT) flushT = setTimeout(() => { flushT = 0; if (!S.net || !room) return; const p = pubRoom(); for (const c of S.net.conns()) sendState(c, p); }, 40);
  }

  function hostAct(pid, a) {
    if (!game) return '游戏还没开始';
    const seat = seatOf(pid);
    if (seat < 0) return '你不在这局游戏里';
    const err = E.act(game, seat, a);
    if (!err) broadcast();
    return err;
  }

  function onHostData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const name = String(msg.name || '').trim().slice(0, 10) || '玩家';
      let pid = String(msg.pid || '');
      let m = room.members.find(x => x.pid === pid);
      if (!m && game) {
        // 换了设备：同名且离线的座位可以接回
        const online = new Set(connPid.values());
        m = room.members.find(x => x.name === name && x.pid !== room.hostPid && !online.has(x.pid));
        if (m) pid = m.pid;
      }
      if (!m) {
        if (game) return S.net.send(conn, { t: 'reject', msg: '这局已经开始了，等下一局再进' });
        if (room.members.length >= 10) return S.net.send(conn, { t: 'reject', msg: '房间已满（10 人）' });
        m = { pid, name };
        room.members.push(m);
      } else if (!game) m.name = name;
      for (const [cid, p] of connPid) if (p === pid && cid !== conn.connectionId) connPid.delete(cid);
      connPid.set(conn.connectionId, pid);
      S.net.send(conn, { t: 'welcome', pid });
      broadcast();
      return;
    }
    const pid = connPid.get(conn.connectionId);
    if (!pid) return;
    if (msg.t === 'act') {
      if (msg.id && lastAct.get(pid) === msg.id) return sendState(conn); // 重发的动作：只补发状态
      const err = hostAct(pid, msg.a);
      lastAct.set(pid, msg.id);
      if (err) S.net.send(conn, { t: 'err', msg: err, ack: msg.id });
    }
    if (msg.t === 'sync' && msg.v !== ver) sendState(conn);
    if (msg.t === 'leave' && !game) { room.members = room.members.filter(x => x.pid !== pid); connPid.delete(conn.connectionId); broadcast(); }
  }

  function startHost(code, restored) {
    S.host = true;
    room = restored ? restored.room : { code, hostPid: S.pid, members: [{ pid: S.pid, name: S.name }], settings: { targets: {}, speechSec: 60 }, seats: null };
    game = restored ? restored.game : null;
    room.members.find(m => m.pid === S.pid).name = S.name;
    tab.set('session', { code, host: true });
    if (S.net) S.net.close();
    S.link = 'signal';
    history.replaceState(null, '', '?room=' + code);
    S.net = Net.openHost(code, {
      onStatus(s) { S.link = s; render(); },
      onData: onHostData,
      onClose(conn) { connPid.delete(conn.connectionId); broadcast(); },
      onError(err) { toast('联机服务出错：' + (err.type || err)); },
    });
    broadcast();
  }

  /* ---------- 玩家 ---------- */
  function startClient(code) {
    S.host = false;
    tab.set('session', { code, host: false });
    const say = {
      signal: '第 1 步：正在连接联机服务…',
      find: `第 2 步：正在找房间 ${code}…`,
      open: '已找到房主，正在进入房间…',
      nosignal: '连不上联机服务。检查一下网络，或者换个网络（比如手机热点）再试。正在重试…',
      noroom: `找不到房间 ${code}。确认房间码没错，并且房主的页面还开着、显示“联机服务已连接”。正在重试…`,
      unsupported: '这个浏览器不支持联机，请换 Chrome、Edge 或 Safari 打开。',
    };
    let failMsg = '';
    if (S.net) S.net.close();
    S.status = say.signal;
    render();
    S.net = Net.openClient(code, {
      onStatus(s) {
        S.link = s;
        const bad = !['signal', 'find', 'open'].includes(s);
        if (S.room) { if (bad) toast(say[s]); return; }
        if (bad) failMsg = say[s]; else if (s === 'open') failMsg = '';
        // 重试期间把失败原因留在屏幕上
        S.status = failMsg || say[s];
        render();
      },
      onOpen(api) { pending = null; api.send({ t: 'hello', pid: S.pid, name: S.name }); },
      onData(msg) {
        if (pending && msg.ack === pending.id) pending = null;
        if (msg.t === 'state') { S.status = ''; S.ver = msg.v; applyView(msg.room, msg.view); }
        else if (msg.t === 'welcome') { if (msg.pid !== S.pid) { S.pid = msg.pid; tab.set('pid', msg.pid); } }
        else if (msg.t === 'err') toast(msg.msg);
        else if (msg.t === 'reject' || msg.t === 'kicked') { toast(msg.msg || '你被房主移出了房间'); leave(); }
      },
      onClose() { toast('和房主断开了，正在重连…'); },
    });
  }

  let pending = null; // 玩家端：还没收到回执的动作
  function send(a) {
    if (S.host) { const err = hostAct(S.pid, a); if (err) toast(err); return; }
    if (!S.net) return;
    pending = { id: rid(8), a, tries: 0 };
    S.net.send({ t: 'act', id: pending.id, a });
  }
  setInterval(() => {
    if (S.host || !S.net) return;
    // 进房间的那条消息丢了：再打一次招呼
    if (!S.room) { if (S.link === 'open') S.net.send({ t: 'hello', pid: S.pid, name: S.name }); return; }
    if (pending && ++pending.tries <= 6) S.net.send({ t: 'act', id: pending.id, a: pending.a });
    else { pending = null; S.net.send({ t: 'sync', v: S.ver }); }
  }, 2500);

  function leave() {
    const net = S.net;
    if (net) { if (!S.host) net.send({ t: 'leave' }); setTimeout(() => net.close(), 200); }
    if (S.host && room) store.del('host.' + room.code);
    tab.del('session');
    Object.assign(S, { host: false, room: null, view: null, net: null, status: '' });
    room = game = null; connPid.clear();
    history.replaceState(null, '', location.pathname);
    render();
  }

  /* ---------- 事件 ---------- */
  function readName() {
    const v = ($('#name') && $('#name').value.trim()) || '';
    if (!v) { toast('先填一个昵称'); return false; }
    S.name = v.slice(0, 10); store.set('name', S.name); return true;
  }

  const handlers = {
    create() { if (readName()) startHost(rid(4)); },
    join() {
      if (!readName()) return;
      const code = ($('#code').value || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) return toast('房间码是 4 位');
      S.joinCode = code; startClient(code);
    },
    copy() {
      const url = location.origin + location.pathname + '?room=' + S.room.code;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('邀请链接已复制'), () => prompt('复制这个链接发给朋友', url));
    },
    leave() { if (confirm('确定离开房间？')) leave(); },
    move(el) {
      const i = +el.dataset.i, j = i + +el.dataset.d, M = room.members;
      if (j < 0 || j >= M.length) return;
      [M[i], M[j]] = [M[j], M[i]]; broadcast();
    },
    kick(el) {
      const m = room.members[+el.dataset.i];
      if (!m || !confirm(`把 ${m.name} 移出房间？`)) return;
      room.members.splice(+el.dataset.i, 1);
      for (const c of S.net.conns()) if (connPid.get(c.connectionId) === m.pid) { S.net.send(c, { t: 'kicked' }); connPid.delete(c.connectionId); }
      broadcast();
    },
    start() {
      const names = room.members.map(m => m.name);
      try {
        game = E.createGame(names, { targets: room.settings.targets, speechSec: room.settings.speechSec });
        room.seats = room.members.map(m => m.pid);
        broadcast();
      } catch (e) { toast(e.message); }
    },
    rematch() { handlers.start(); },
    toLobby() { game = null; room.seats = null; broadcast(); },
    ack() { send({ type: 'ack' }); },
    speechDone() { send({ type: 'speechDone' }); },
    pick(el) {
      const i = +el.dataset.i, v = S.view;
      const two = v.phase === 'magic' && E.MAGIC[v.magic.n].pick === 'two';
      const p = S.ui.picks;
      if (p.includes(i)) S.ui.picks = p.filter(x => x !== i);
      else S.ui.picks = two ? p.concat(i).slice(-2) : [i];
      render();
    },
    giveCoin() { send({ type: 'giveCoin', to: S.ui.picks[0] }); },
    magic() { send({ type: 'magic', picks: S.ui.picks }); },
    card(el) { S.ui.card = S.ui.card === el.dataset.id ? null : el.dataset.id; render(); },
    play() { send({ type: 'play', cardId: S.ui.card }); },
    pass() { send({ type: 'pass' }); },
    swapPick() { send({ type: 'swapPick', target: S.ui.picks[0] }); },
    swapSkip() { send({ type: 'swapPick', target: -1 }); },
    swapCard() { send({ type: 'swapCard', cardId: S.ui.card }); },
    closeReveal() { S.ui.reveal = false; render(); },
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const h = handlers[el.dataset.act];
    if (h) h(el);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'code') handlers.join();
    else if (e.target.id === 'name' && !S.room) (($('#code') && $('#code').value) ? handlers.join : handlers.create)();
  });
  document.addEventListener('change', e => {
    const k = e.target.dataset.set;
    if (!k || !S.host) return;
    const val = Math.max(0, parseInt(e.target.value, 10) || 0);
    if (k === 'speech') room.settings.speechSec = val;
    else {
      const n = room.members.length;
      const t = room.settings.targets[n] || Object.assign({}, E.DEFAULT_TARGETS[n] || {});
      t[k] = val; room.settings.targets[n] = t;
    }
    broadcast();
  });
  // 发言倒计时只刷新数字
  setInterval(() => {
    const t = document.querySelector('[data-timer]');
    if (!t) return;
    const left = S.speechLeft();
    t.textContent = UI.fmt(left);
    t.classList.toggle('over', left <= 0);
  }, 500);

  /* ---------- 启动：恢复上次的房间 ---------- */
  if (!Net.supported) { S.status = '这个浏览器不支持联机，请用 Chrome、Edge 或 Safari 打开 https 开头的网址。'; render(); return; }
  const sess = tab.get('session');
  const code = S.joinCode || (sess && sess.code);
  if (sess && sess.code === code && S.name) {
    const saved = sess.host && store.get('host.' + code);
    if (saved) startHost(code, saved); else if (!sess.host) startClient(code); else render();
  } else render();
})();
