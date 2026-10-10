/* 联机层：消息中转。房主和玩家都只向公共 MQTT 服务器发起连接，所以不受各自网络限制。
 * 房主同时挂在几台服务器上，玩家用第一台能找到房主的。
 * 内容用 ECDH + AES-GCM 加密，中转服务器和旁听的人看不到牌。
 * 只负责收发 JSON，不懂游戏规则。 */
(function (root) {
  'use strict';
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker-cn.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  const TOPIC = 'brwr/v1/';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');

  /* ---------- 极简 MQTT 3.1.1 客户端（只用 QoS 0） ---------- */
  function mqtt(url, h) {
    let ws, up = false, dead = false, ping, buf = new Uint8Array(0);
    const str = s => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
    function packet(type, body) {
      const len = []; let n = body.length;
      do { const d = n % 128; n = Math.floor(n / 128); len.push(n ? d | 128 : d); } while (n);
      const p = new Uint8Array(1 + len.length + body.length);
      p[0] = type; p.set(len, 1); p.set(body, 1 + len.length);
      if (ws.readyState === 1) ws.send(p);
    }
    function read() {
      for (;;) {
        let n = 0, mul = 1, i = 1, d;
        do { if (i >= buf.length) return; d = buf[i++]; n += (d & 127) * mul; mul *= 128; } while (d & 128);
        if (buf.length < i + n) return;
        const type = buf[0] >> 4, body = buf.slice(i, i + n);
        buf = buf.slice(i + n);
        if (type === 2) { if (body[1] === 0) { up = true; h.onUp(); } else ws.close(); }
        else if (type === 3) { const tl = (body[0] << 8) | body[1]; h.onMessage(dec.decode(body.subarray(2, 2 + tl)), dec.decode(body.subarray(2 + tl))); }
      }
    }
    const down = () => { clearInterval(ping); up = false; if (!dead) { dead = true; h.onDown(); } };
    try { ws = new WebSocket(url, 'mqtt'); } catch (e) { setTimeout(down, 0); }
    if (ws) {
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        packet(0x10, new Uint8Array([...str('MQTT'), 4, 2, 0, 30, ...str('brwr' + rid(14))])); // clean session，keepalive 30s
        ping = setInterval(() => up && packet(0xC0, new Uint8Array(0)), 20000);
      };
      ws.onmessage = e => { const a = new Uint8Array(e.data), b = new Uint8Array(buf.length + a.length); b.set(buf); b.set(a, buf.length); buf = b; read(); };
      ws.onclose = down;
      ws.onerror = () => {};
    }
    return {
      get up() { return up; },
      sub(t) { packet(0x82, new Uint8Array([0, 1, ...str(t), 0])); },
      pub(t, s) { if (!up) return; const tb = str(t), pb = enc.encode(s), b = new Uint8Array(tb.length + pb.length); b.set(tb); b.set(pb, tb.length); packet(0x30, b); },
      close() { dead = true; clearInterval(ping); up = false; try { ws.close(); } catch (e) {} },
    };
  }

  /* ---------- 加密 ---------- */
  const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
  async function newKeys() { const kp = await crypto.subtle.generateKey(ECDH, false, ['deriveKey']); return { kp, pub: b64(await crypto.subtle.exportKey('raw', kp.publicKey)) }; }
  async function derive(kp, pub) {
    const k = await crypto.subtle.importKey('raw', unb64(pub), ECDH, false, []);
    return crypto.subtle.deriveKey({ name: 'ECDH', public: k }, kp.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)))) }; }
  async function unseal(key, m) { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, key, unb64(m.ct)))); }

  /* ---------- 房主 ----------
   * onStatus：signal 连接中 / ready 可以进人 / nosignal 连不上联机服务 */
  function openHost(code, h) {
    const tHost = TOPIC + code + '/h', tCli = cid => TOPIC + code + '/c/' + cid;
    const peers = new Map(); // cid -> { connectionId, pub, key, link, seen, rn, sn, open, q }
    const links = BROKERS.map(() => null);
    let closed = false, me = null, chain = Promise.resolve();
    const status = () => h.onStatus && h.onStatus(links.some(l => l && l.up) ? 'ready' : 'nosignal');

    function link(i) {
      if (closed) return;
      const l = links[i] = mqtt(BROKERS[i], {
        onUp() { l.sub(tHost); status(); },
        onDown() { links[i] = null; status(); setTimeout(() => link(i), 4000); },
        onMessage(topic, s) { chain = chain.then(() => recv(l, s)).catch(() => {}); },
      });
    }
    function drop(p) { if (!peers.delete(p.connectionId)) return; p.open = false; h.onClose(p); }
    function send(p, msg) {
      if (!p.open) return;
      p.q = p.q.then(async () => {
        const l = p.link && p.link.up ? p.link : null;
        if (l) l.pub(tCli(p.connectionId), JSON.stringify(await seal(p.key, { n: ++p.sn, m: msg })));
      }).catch(() => {});
    }
    async function recv(l, s) {
      let m; try { m = JSON.parse(s); } catch (e) { return; }
      if (!m || typeof m.cid !== 'string' || !/^[a-z0-9]{8,40}$/.test(m.cid)) return;
      let p = peers.get(m.cid);
      if (m.t === 'hi' && typeof m.pub === 'string') {
        if (!p || p.pub !== m.pub) {
          if (p) drop(p);
          if (peers.size >= 40) return;
          p = { connectionId: m.cid, pub: m.pub, key: await derive(me.kp, m.pub), rn: 0, sn: 0, open: true, q: Promise.resolve() };
          peers.set(m.cid, p);
        }
        p.link = l; p.seen = Date.now();
        l.pub(tCli(m.cid), JSON.stringify({ t: 'hi', pub: me.pub }));
        return;
      }
      // 不认识的人（比如房主刷新过页面）：让对方重新握手
      const reset = () => l.pub(tCli(m.cid), '{"t":"reset"}');
      if (!p) return reset();
      let d; try { d = await unseal(p.key, m); } catch (e) { return reset(); }
      if (!(d.n > p.rn)) return; // 重复的包
      p.rn = d.n; p.seen = Date.now(); p.link = l;
      if (d.m.t === 'ping') send(p, { t: 'pong' });
      else if (d.m.t === 'bye') drop(p);
      else h.onData(p, d.m);
    }

    h.onStatus && h.onStatus('signal');
    newKeys().then(k => { me = k; BROKERS.forEach((_, i) => link(i)); }, e => h.onError && h.onError(e));
    // 25 秒没有心跳就当作掉线
    const sweep = setInterval(() => { const t = Date.now() - 25000; for (const p of [...peers.values()]) if (p.seen < t) drop(p); }, 5000);
    return {
      send,
      conns: () => [...peers.values()],
      close() { closed = true; clearInterval(sweep); links.forEach(l => l && l.close()); },
    };
  }

  /* ---------- 玩家 ----------
   * onStatus：signal → find → open；失败时 nosignal（一台服务器都连不上）/ noroom（连上了但没有房主回应） */
  function openClient(code, h) {
    const cid = rid(20), tHost = TOPIC + code + '/h', tMe = TOPIC + code + '/c/' + cid;
    let closed = false, me = null, key = null, l = null, bi = 0, sn = 0, rn = 0, lastPong = 0, timer, reached = false;
    let chain = Promise.resolve(), q = Promise.resolve();
    const st = s => h.onStatus && h.onStatus(s);
    const hi = () => l && l.pub(tHost, JSON.stringify({ t: 'hi', cid, pub: me.pub }));

    function attempt() {
      if (closed) return;
      clearTimeout(timer);
      const wasOpen = !!key; key = null;
      if (l) l.close();
      if (wasOpen) h.onClose && h.onClose();
      st('signal');
      const mine = l = mqtt(BROKERS[bi % BROKERS.length], {
        onUp() { if (mine !== l) return; reached = true; mine.sub(tMe); st('find'); hi(); clearTimeout(timer); timer = setTimeout(next, 5000); },
        onDown() { if (mine === l) next(); },
        onMessage(topic, s) { if (mine === l) chain = chain.then(() => recv(s)).catch(() => {}); },
      });
      timer = setTimeout(next, 7000);
    }
    // 换下一台服务器；全部试过一轮还不行就报原因，稍等再来
    function next() {
      if (closed) return;
      clearTimeout(timer);
      bi++;
      if (bi % BROKERS.length) return attempt();
      st(reached ? 'noroom' : 'nosignal');
      reached = false;
      if (key) { key = null; h.onClose && h.onClose(); }
      if (l) { l.close(); l = null; }
      timer = setTimeout(attempt, 3000);
    }
    async function recv(s) {
      let m; try { m = JSON.parse(s); } catch (e) { return; }
      if (m.t === 'hi' && typeof m.pub === 'string') {
        const fresh = !key;
        key = await derive(me.kp, m.pub);
        rn = 0; lastPong = Date.now();
        clearTimeout(timer);
        if (fresh) { st('open'); h.onOpen(api); }
        return;
      }
      if (m.t === 'reset') {
        if (key) { key = null; h.onClose && h.onClose(); }
        hi(); clearTimeout(timer); timer = setTimeout(next, 5000);
        return;
      }
      if (!key) return;
      let d; try { d = await unseal(key, m); } catch (e) { return; }
      if (!(d.n > rn)) return;
      rn = d.n; lastPong = Date.now();
      if (d.m.t !== 'pong') h.onData(d.m);
    }
    function send(msg) {
      q = q.then(async () => {
        if (!key || !l || !l.up) return;
        const e = await seal(key, { n: ++sn, m: msg });
        e.cid = cid;
        l.pub(tHost, JSON.stringify(e));
      }).catch(() => {});
    }
    const beat = setInterval(() => {
      if (closed || !key) return;
      if (Date.now() - lastPong > 22000) return attempt(); // 房主没回应：从当前服务器重新找
      send({ t: 'ping' });
    }, 8000);
    const api = {
      send,
      close() { send({ t: 'bye' }); closed = true; clearTimeout(timer); clearInterval(beat); setTimeout(() => l && l.close(), 300); },
    };
    st('signal');
    newKeys().then(k => { me = k; attempt(); }, () => st('unsupported'));
    return api;
  }

  root.Net = { openHost, openClient, supported: !!(root.crypto && root.crypto.subtle && root.WebSocket) };
})(self);
