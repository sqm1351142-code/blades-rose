/* 界面：把状态渲染成 HTML 字符串。事件由 app.js 通过 data-act 统一处理。 */
(function (root) {
  'use strict';
  const E = root.Engine;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SUB = { rose: '大花', bishop: '小花', believer: '小花', giant: '血刃', twin: '血刃', shadow: '血刃', ghost: '中立' };
  const SIDE = { white: '白蔷薇阵营', blood: '血刃阵营' };
  const cname = t => E.CARD[t].name;
  const kindCls = t => { const k = E.CARD[t].kind; return k === 'flower' ? 'flower' + (t === 'rose' ? ' rose' : '') : k; };

  function card(t, o) {
    o = o || {};
    const cls = `card ${t ? kindCls(t) : 'back'}${o.mini ? ' mini' : ''}${o.sel ? ' sel' : ''}`;
    const inner = t ? `${cname(t)}${o.mini ? '' : `<small>${SUB[t]}</small>`}` : '';
    const by = o.by != null ? `<span class="by">${esc(o.by)}</span>` : '';
    if (o.act) return `<button class="${cls}" data-act="${o.act}" data-id="${o.id}" ${o.disabled ? 'disabled' : ''} aria-pressed="${!!o.sel}">${inner}${by}</button>`;
    return `<div class="${cls}" style="${o.delay != null ? `animation-delay:${o.delay}ms` : ''}">${inner}${by}</div>`;
  }

  /* ---------- 首页 ---------- */
  function home(S) {
    return `<div class="home">
      <div class="title"><h1>血与刃的<span>白蔷薇</span></h1><p>5–10 人阵营推理 · 好友联机</p></div>
      <div class="box">
        <label>你的昵称<input class="field" id="name" maxlength="10" autocomplete="nickname" value="${esc(S.name)}"></label>
        <button class="btn p" data-act="create">创建房间</button>
        <div class="sep">或者加入好友的房间</div>
        <div class="row"><input class="field code" id="code" maxlength="4" placeholder="房间码" value="${esc(S.joinCode)}" style="flex:1;min-width:0"><button class="btn" data-act="join">加入</button></div>
        ${S.status ? `<p class="note">${esc(S.status)}</p>` : ''}
      </div>
      <p class="note" style="text-align:center">发言请用你们自己的语音（微信 / 飞书 / Discord），网页只负责排顺序和计时。</p>
    </div>`;
  }

  /* ---------- 等待房间 ---------- */
  function lobby(S) {
    const R = S.room, n = R.members.length;
    const t = E.targetsFor(n, R.settings.targets);
    const ok = n >= 5 && n <= 10 && t && R.members.every(m => m.online);
    const why = n < 5 ? `还差 ${5 - n} 人才能开始` : n > 10 ? '最多 10 人' : !t ? `先在下面填 ${n} 人局的献祭和击杀目标` : !ok ? '有人离线，等 TA 回来或者踢出' : '';
    const cur = (R.settings.targets[n]) || E.DEFAULT_TARGETS[n] || {};
    const comp = E.COMPOSITION[n];
    return `<div class="lobby">
      <div class="box">
        <div class="row" style="justify-content:space-between">
          <div><div class="note">房间码</div><div class="roomcode">${esc(R.code)}</div></div>
          <div class="row"><button class="btn" data-act="copy">复制邀请链接</button><button class="btn s" data-act="leave">离开</button></div>
        </div>
        <p class="note">把房间码或邀请链接发给朋友。座位顺序就是顺时针出牌顺序${S.host ? '，可以用 ↑ ↓ 调整' : '，由房主调整'}。</p>
        ${!S.host ? '' : S.link === 'ready' ? '<p class="note w">联机服务已连接，朋友现在可以进来。</p>'
          : S.link === 'nosignal' ? '<p class="note r">连不上联机服务，朋友现在进不来。换个网络（关掉 VPN 或改用手机热点）后刷新页面。正在重试…</p>'
          : '<p class="note g">正在连接联机服务，连上之前朋友进不来…</p>'}
      </div>
      <div class="box">
        <h2>玩家 ${n} / 10</h2>
        <div class="members">${R.members.map((m, i) => `
          <div class="member"><span class="seatno">${i + 1}</span><span class="n">${esc(m.name)}</span>
            ${m.pid === R.hostPid ? '<span class="tag gold">房主</span>' : ''}${m.pid === S.pid ? '<span class="tag">你</span>' : ''}${m.online ? '' : '<span class="tag off">离线</span>'}
            ${S.host ? `<button class="btn s" data-act="move" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="上移">↑</button><button class="btn s" data-act="move" data-i="${i}" data-d="1" ${i < n - 1 ? '' : 'disabled'} aria-label="下移">↓</button>${m.pid !== R.hostPid ? `<button class="btn s" data-act="kick" data-i="${i}">踢出</button>` : ''}` : ''}
          </div>`).join('')}
        </div>
        ${comp ? `<p class="note">${n} 人局身份牌：白蔷薇 1 · 司教 1 · 信者 ${comp.believer} · 巨刃 ${comp.giant} · 双刃 1 · 暗刃 1</p>` : ''}
      </div>
      <div class="box">
        <h2>规则设置</h2>
        ${n >= 5 && n <= 10 ? `<div class="settings">
          <label>献祭目标（白蔷薇之外的花苞数）<input class="field" type="number" min="1" max="12" data-set="sac" value="${cur.sac || ''}" ${S.host ? '' : 'disabled'}></label>
          <label>击杀目标（死亡区花苞数）<input class="field" type="number" min="1" max="12" data-set="kill" value="${cur.kill || ''}" ${S.host ? '' : 'disabled'}></label>
          <label>发言计时（秒，0 为不计时）<input class="field" type="number" min="0" max="600" data-set="speech" value="${R.settings.speechSec}" ${S.host ? '' : 'disabled'}></label>
        </div>
        <p class="note">${E.DEFAULT_TARGETS[n] ? '这是规则书确认过的数字。' : `规则书里 ${n} 人局的目标还没确认，请房主按版图填写。`}</p>`
        : '<p class="note">满 5 人后显示对应人数的设置。</p>'}
      </div>
      ${S.host ? `<div class="row" style="justify-content:center"><button class="btn p" data-act="start" ${ok ? '' : 'disabled'}>开始游戏</button>${why ? `<span class="note">${why}</span>` : ''}</div>`
               : `<p class="note" style="text-align:center">等房主开始游戏…</p>`}
    </div>`;
  }

  /* ---------- 牌桌 ---------- */
  function seatStatus(v, i) {
    if (v.phase === 'end') return { text: cname(v.players[i].role), cls: v.players[i].side === 'white' ? 'play' : 'cur' };
    if (v.phase === 'speech' && v.speech) {
      if (v.speech.order[v.speech.pos] === i) return { text: '发言中', cls: 'cur' };
      return { text: '', cls: '' };
    }
    if (v.play) {
      const s = v.play.status[i];
      if (s === 'played') return { text: v.play.auto.includes(i) ? '被随机出牌' : '已出牌', cls: 'play' };
      if (s === 'pass') return { text: '不出', cls: 'pass' };
      if (s === 'cur' && v.phase === 'play') return { text: '决定中', cls: 'cur' };
    }
    return { text: '', cls: '' };
  }

  function pickable(S) {
    const v = S.view;
    if (v.phase === 'speech' && v.holder === v.me) return v.canReceive.map((x, i) => x ? i : -1).filter(i => i >= 0);
    if (v.phase === 'magic' && v.magic.by === v.me) return v.magic.options;
    if (v.phase === 'swap' && v.swap.stage === 'pick' && v.swap.by === v.me) return v.swap.options;
    return [];
  }

  function table(S) {
    const v = S.view, n = v.n, me = Math.max(0, v.me);
    const can = pickable(S), picks = S.ui.picks;
    const turn = v.phase === 'play' ? v.play.cur : v.phase === 'magic' ? v.magic.by : v.phase === 'swap' ? (v.swap.stage === 'pick' ? v.swap.by : v.swap.target) : -1;
    const seats = v.players.map((p, i) => {
      const off = (i - me + n) % n;
      const a = (90 + off * 360 / n) * Math.PI / 180;
      const x = 50 + 43 * Math.cos(a), y = 50 + 40 * Math.sin(a);
      const st = seatStatus(v, i);
      const cls = ['seat', i === v.me && 'me', i === v.holder && 'coin', i === turn && 'turn', !S.online[i] && 'off',
        can.includes(i) && 'pickable', picks.includes(i) && 'picked'].filter(Boolean).join(' ');
      const tag = can.includes(i) ? `button type="button" data-act="pick" data-i="${i}" aria-pressed="${picks.includes(i)}"` : 'div';
      return `<${tag} class="${cls}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;background:none;border:0;padding:0">
        <div class="av">${esc([...p.name][0] || '?')}${i === v.holder ? '<span class="coinmark" title="金币">🪙</span>' : ''}<span class="cnt" title="手牌数">${p.cards}</span></div>
        <span class="nm">${esc(p.name)}${i === v.me ? '（你）' : ''}</span>
        <span class="st ${st.cls}">${st.text}</span>
        ${p.used ? '<span class="usedmark">水晶已用</span>' : ''}
      </${tag.split(' ')[0]}>`;
    }).join('');
    const sacSmall = v.sacrifice.filter(t => t !== 'rose').length;
    const roseIn = v.sacrifice.includes('rose');
    const dead = v.death.filter(t => t !== 'rose').length;
    return `<div class="table">${seats}
      <div class="center">
        <div class="zone sac"><span class="k">献祭区</span><span class="v">${sacSmall} / ${v.sac}</span><span class="rose-state ${roseIn ? 'w' : 'dim'}">白蔷薇${roseIn ? '已献祭' : '未献祭'}</span></div>
        <div class="zone dead"><span class="k">死亡区</span><span class="v">${dead} / ${v.kill}</span><span class="rose-state dim">杀够即血刃胜</span></div>
      </div>
    </div>`;
  }

  /* ---------- 行动面板 ---------- */
  const nameOf = (v, i) => esc(v.players[i].name);
  function pills(v, list, picks) {
    return `<div class="pills">${list.map(i => `<button class="pill ${picks.includes(i) ? 'on' : ''}" data-act="pick" data-i="${i}" aria-pressed="${picks.includes(i)}">${nameOf(v, i)}</button>`).join('')}</div>`;
  }

  function actionPanel(S) {
    const v = S.view, me = v.me, picks = S.ui.picks;
    if (v.phase === 'night') return `<div class="panel"><h3>夜晚</h3><p class="note">等所有人看完身份（${v.night.acked} / ${v.n}）。</p></div>`;

    if (v.phase === 'speech') {
      const sp = v.speech, spk = sp.order[sp.pos];
      const order = sp.order.map((i, k) => `<span class="pill ${k === sp.pos ? 'on' : ''}" style="cursor:default;${k < sp.pos ? 'opacity:.45' : ''}">${nameOf(v, i)}${k === sp.pos && v.speechSec ? ` · <span class="timer" data-timer>${fmt(S.speechLeft())}</span>` : ''}</span>`).join('');
      let out = `<div class="panel ${spk === me || v.holder === me ? 'act' : ''}"><h3>第 ${v.round} 轮 · 发言阶段 · 队长 ${nameOf(v, v.holder)}</h3>
        <p class="note">可以争取或推辞金币，但不能明说自己的水晶数字和效果。</p>
        <div class="pills">${order}</div>`;
      if (spk === me) out += `<div class="row"><button class="btn" data-act="speechDone">我说完了</button></div>`;
      else if (sp.pos >= sp.order.length) out += `<p class="note">所有人都说完了。</p>`;
      if (v.holder === me) {
        const list = v.canReceive.map((x, i) => x ? i : -1).filter(i => i >= 0);
        out += `<h3>你是队长：把金币交给一位还有白水晶的人</h3>
          <p class="note">可以随时交出，不用等所有人说完。拿到金币的人会立刻发动白水晶，然后从 TA 开始顺时针出牌。</p>
          ${pills(v, list, picks)}
          <div class="row"><button class="btn p" data-act="giveCoin" ${picks.length === 1 ? '' : 'disabled'}>交出金币${picks.length ? '给 ' + nameOf(v, picks[0]) : ''}</button></div>`;
      } else out += `<p class="note">等队长 ${nameOf(v, v.holder)} 交出金币。</p>`;
      return out + '</div>';
    }

    if (v.phase === 'magic') {
      const m = v.magic, M = E.MAGIC[m.n];
      if (m.by !== me) return `<div class="panel"><h3>${nameOf(v, m.by)} 发动白水晶 #${m.n}</h3><p>${M.text}</p><p class="note">等 TA 选择目标…</p></div>`;
      const need = M.pick === 'two' ? 2 : 1;
      return `<div class="panel act"><h3>你发动白水晶 #${m.n}</h3><p>${M.text}</p>
        <p class="note">${need === 2 ? '选两名玩家' : '选一名玩家'}（也可以直接点牌桌上的头像）</p>
        ${pills(v, m.options, picks)}
        <div class="row"><button class="btn p" data-act="magic" ${picks.length === need ? '' : 'disabled'}>确认发动</button></div></div>`;
    }

    if (v.phase === 'play' || v.phase === 'swap') {
      const P = v.play, rules = [];
      rules.push(`白水晶 #${v.magic.n}（${nameOf(v, v.magic.by)}）：${E.MAGIC[v.magic.n].text}`);
      if (P.forced.length) rules.push(`必须出牌：${P.forced.map(i => nameOf(v, i)).join('、')}`);
      if (P.bind) rules.push(`同进同退：${nameOf(v, P.bind[0])} 和 ${nameOf(v, P.bind[1])}`);
      if (P.open) rules.push('本轮翻牌时公开出牌人');
      let out = `<div class="panel ${(v.phase === 'play' && P.cur === me) || (v.phase === 'swap' && (v.swap.stage === 'pick' ? v.swap.by : v.swap.target) === me) ? 'act' : ''}">
        <h3>第 ${v.round} 轮 · 出牌</h3>${rules.map(r => `<p class="note">${r}</p>`).join('')}`;
      if (P.mine) out += `<p>你盖出了：<b>${cname(P.mine.t)}</b>${P.auto.includes(me) ? '（被随机抽出）' : ''}</p>`;
      if (v.phase === 'play') {
        if (P.cur === me) {
          const sel = v.hand.find(c => c.id === S.ui.card);
          out += `<p><b class="r">轮到你：</b>选一张牌盖出，或者不出。每人每轮只有一次机会。</p>
            ${P.mustPlay ? '<p class="g">你本轮必须出牌。</p>' : ''}
            <div class="row"><button class="btn p" data-act="play" ${sel ? '' : 'disabled'}>${sel ? '盖出 ' + cname(sel.t) : '先选一张牌'}</button>
            <button class="btn" data-act="pass" ${P.mustPlay ? 'disabled' : ''}>不出</button></div>`;
        } else out += `<p class="note">等 ${nameOf(v, P.cur)} 决定…</p>`;
      } else {
        const W = v.swap;
        if (W.stage === 'pick' && W.by === me) {
          out += `<p><b class="r">白水晶 #10：</b>可以选一位出了牌的人，让 TA 把盖出的牌换成手里另一张。</p>
            ${pills(v, W.options, picks)}
            <div class="row"><button class="btn p" data-act="swapPick" ${picks.length === 1 ? '' : 'disabled'}>让 TA 替换</button><button class="btn" data-act="swapSkip">不替换</button></div>`;
        } else if (W.stage === 'card' && W.target === me) {
          const sel = v.hand.find(c => c.id === S.ui.card);
          out += `<p><b class="r">${nameOf(v, W.by)} 要你替换出牌：</b>从手里选一张，换掉你盖出的那张。</p>
            <div class="row"><button class="btn p" data-act="swapCard" ${sel ? '' : 'disabled'}>${sel ? '换成 ' + cname(sel.t) : '先选一张牌'}</button></div>`;
        } else out += `<p class="note">${W.stage === 'pick' ? `等 ${nameOf(v, W.by)} 决定要不要让人替换出牌…` : `等 ${nameOf(v, W.target)} 换牌…`}</p>`;
      }
      return out + '</div>';
    }
    return '';
  }

  function handArea(S) {
    const v = S.view;
    const choosing = (v.phase === 'play' && v.play.cur === v.me) || (v.phase === 'swap' && v.swap.stage === 'card' && v.swap.target === v.me);
    if (!v.hand.length) return `<div class="panel"><p class="note" style="text-align:center">你手里已经没有牌了。</p></div>`;
    return `<div class="panel"><h3>你的手牌</h3><div class="hand">${v.hand.map(c => card(c.t, choosing ? { act: 'card', id: c.id, sel: S.ui.card === c.id } : {})).join('')}</div></div>`;
  }

  function sidePanels(S) {
    const v = S.view, me = v.players[v.me];
    const id = me ? `<div class="panel"><div class="idcard">${card(me.role, { mini: true })}
        <div class="who"><b class="${me.side === 'white' ? 'w' : 'r'}">${cname(me.role)}</b><span class="note">${SIDE[me.side]}</span></div></div>
        <p class="note">白水晶 <b class="g">#${me.crystal}</b>：${E.MAGIC[me.crystal].text}${me.used ? '（已使用）' : ''}</p></div>` : '';
    const sec = v.secrets.length ? `<div class="panel"><h3>只有你知道</h3>${v.secrets.map(s => `<div class="secret"><span class="dim">第 ${s.r} 轮</span> ${esc(s.text)}</div>`).join('')}</div>` : '';
    const log = `<div class="panel"><h3>战报</h3><div class="log">${v.log.slice().reverse().map(l => `<div class="ln ${l.cls}">${l.r ? `<span class="rd">R${l.r}</span>` : ''}${esc(l.text)}</div>`).join('')}</div></div>`;
    return id + sec + log;
  }

  function endPanel(S) {
    const v = S.view;
    const rows = v.history.map(h => `<tr><td>${h.round}</td><td>${nameOf(v, h.holder)} · #${h.magic}</td><td>${h.plays.length ? h.plays.map(p => `${nameOf(v, p.by)}：<span class="${E.CARD[p.t].kind === 'blade' ? 'r' : E.CARD[p.t].kind === 'flower' ? 'w' : 'dim'}">${cname(p.t)}</span>${p.auto ? '（随机）' : ''}`).join('<br>') : '<span class="dim">无人出牌</span>'}</td></tr>`).join('');
    return `<div class="panel act">
      <h2 class="verdict ${v.winner === 'white' ? 'w' : 'r'}">${v.winner === 'white' ? '白蔷薇阵营胜利' : '血刃阵营胜利'}</h2>
      <p>${esc(v.reason)}</p>
      <div class="result">${v.players.map(p => `<div class="rp ${p.side}">${esc(p.name)}<span>${cname(p.role)} · #${p.crystal}</span></div>`).join('')}</div>
      <h3>逐轮回放</h3>
      <div class="tblwrap"><table class="hist"><thead><tr><th>轮</th><th>持币者 · 水晶</th><th>谁出了什么</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${S.host ? `<div class="row"><button class="btn p" data-act="rematch">再来一局（座位不变）</button><button class="btn" data-act="toLobby">回到房间</button></div>`
               : '<p class="note">等房主开始下一局…</p>'}
    </div>`;
  }

  function game(S) {
    const v = S.view;
    const now = (v.phase === 'magic' || v.phase === 'play' || v.phase === 'swap') ? v.slots.length - 1 : -1;
    const slots = Array.from({ length: v.n }, (_, k) => {
      const s = v.slots[k];
      return `<span class="slot ${s ? 'on' : ''} ${k === now ? 'now' : ''}" title="${s ? `#${s.n} ${E.MAGIC[s.n].text}（${esc(v.players[s.by].name)}）` : '空水晶槽'}">${s ? s.n : ''}</span>`;
    }).join('');
    return `<div class="game">
      <div class="topbar"><h1>血与刃的<span>白蔷薇</span> <span class="note" style="color:var(--muted);font-size:13px">房间 ${esc(S.room.code)}</span></h1>
        <div class="row"><span class="note">水晶槽 ${v.slots.length} / ${v.n}</span><div class="slots">${slots}</div></div></div>
      <div class="main">${table(S)}${v.phase === 'end' ? endPanel(S) : actionPanel(S) + handArea(S)}</div>
      <div class="side">${sidePanels(S)}</div>
    </div>`;
  }

  /* ---------- 浮层 ---------- */
  function overlay(S) {
    const v = S.view;
    if (!v) return '';
    if (S.ui.flash) {
      const me = v.players[v.me];
      const last = v.secrets[v.secrets.length - 1];
      return `<div class="modal dark"><h2>入夜</h2><p class="muted">白水晶 #9 发动，所有人闭眼。</p>
        ${me && me.role === 'shadow' && last ? `<div class="secret">${esc(last.text)}</div>` : ''}</div>`;
    }
    if (v.phase === 'night') {
      const me = v.players[v.me], N = v.night;
      const eyes = N.eyes ? `<p class="note">和你一起睁眼的人（看不到他们的身份）</p><div class="pills" style="justify-content:center">${N.eyes.map(i => `<span class="pill on" style="cursor:default">${nameOf(v, i)}</span>`).join('')}</div>`
        : me.role === 'shadow' ? '<p class="note">暗刃不睁眼：你不知道同伴是谁，他们也不知道你。</p>'
        : '<p class="note">你闭着眼，什么也没看到。</p>';
      return `<div class="modal"><h2>夜晚</h2>
        <p>你的身份是 <b class="${me.side === 'white' ? 'w' : 'r'}">${cname(me.role)}</b> · ${SIDE[me.side]}</p>
        <div class="hand">${v.hand.map(c => card(c.t)).join('')}</div>
        ${eyes}
        <p class="note">你的白水晶 <b class="g">#${me.crystal}</b>：${E.MAGIC[me.crystal].text}。不能告诉别人数字和效果。</p>
        ${N.mine ? `<p class="note">等其他人看完（${N.acked} / ${v.n}）</p>` : `<div class="row" style="justify-content:center"><button class="btn p" data-act="ack">我看完了（${N.acked} / ${v.n}）</button></div>`}
      </div>`;
    }
    if (S.ui.reveal && v.reveal) {
      const R = v.reveal;
      const verdict = { none: '本轮没有人出牌', sacrifice: '没有血刃：花牌进入献祭区', death: '出现血刃：花牌进入死亡区', roseKilled: '血刃与白蔷薇同轮出现！' }[R.result];
      return `<div class="modal"><h2>第 ${R.round} 轮翻牌</h2>
        <div class="reveal">${R.cards.map((c, k) => card(c.t, { by: R.open ? v.players[c.by].name : null, delay: k * 180 })).join('') || '<p class="note">—</p>'}</div>
        <p class="verdict ${R.result === 'sacrifice' ? 'w' : R.result === 'none' ? '' : 'r'}">${verdict}</p>
        <p class="note">${R.open ? '白水晶 #2：本轮公开出牌人。' : '牌已洗混，看不出是谁出的。'}幽魂直接移除。</p>
        <div class="row" style="justify-content:center"><button class="btn p" data-act="closeReveal">继续</button></div></div>`;
    }
    return '';
  }

  function fmt(ms) { const s = Math.ceil(ms / 1000); return s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '超时'; }

  root.UI = { home, lobby, game, overlay, fmt, esc };
})(self);
