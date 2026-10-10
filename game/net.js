/* 联机层：PeerJS（WebRTC）。房主浏览器开一个固定 ID 的 peer，其他人连过去。
 * 只负责收发 JSON，不懂游戏规则。 */
(function (root) {
  'use strict';
  const PREFIX = 'blood-blade-white-rose-';
  // 只有 STUN：国内连得上的几个。免费的公共中转（TURN）实测都不可用，
  // 所以两边网络直连不通时会连接失败，由 onStatus('blocked') 告诉界面。
  const OPTS = { config: { iceServers: [
    { urls: 'stun:stun.miwifi.com:3478' },
    { urls: 'stun:stun.chat.bilibili.com:3478' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ] } };

  // 房主。onStatus：signal 连接中 / ready 可以进人 / nosignal 连不上联机服务
  function openHost(code, h) {
    let peer, closed = false, tries = 0;
    const conns = new Map();
    const st = s => h.onStatus && h.onStatus(s);
    function start() {
      if (closed) return;
      st('signal');
      peer = new Peer(PREFIX + code, OPTS);
      peer.on('open', () => { tries = 0; st('ready'); });
      peer.on('connection', conn => {
        conn.on('open', () => conns.set(conn.connectionId, conn));
        conn.on('data', msg => h.onData(conn, msg));
        conn.on('close', () => { conns.delete(conn.connectionId); h.onClose(conn); });
        conn.on('error', () => {});
      });
      peer.on('disconnected', () => st('nosignal'));
      peer.on('error', err => {
        // 同一个房间码重开时，旧连接可能还占着 ID，稍等重试
        if (err.type === 'unavailable-id' && tries++ < 8) { peer.destroy(); setTimeout(start, 2500); return; }
        if (err.type === 'peer-unavailable') return;
        st('nosignal');
        h.onError && h.onError(err);
      });
    }
    start();
    // 联机服务掉线后自动接回；已经连上的玩家不受影响
    const keep = setInterval(() => {
      if (closed || !peer) return;
      if (peer.destroyed) start();
      else if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
    }, 5000);
    return {
      send(conn, msg) { if (conn.open) conn.send(msg); },
      conns: () => [...conns.values()],
      close() { closed = true; clearInterval(keep); peer && peer.destroy(); },
    };
  }

  // 玩家。onStatus：signal → find → （open）；失败时 nosignal / noroom / blocked
  function openClient(code, h) {
    let peer, conn = null, closed = false, timer, dog;
    const st = (s, d) => h.onStatus && h.onStatus(s, d);
    function boot() {
      if (closed) return;
      st('signal');
      peer = new Peer(OPTS);
      peer.on('open', connect);
      peer.on('disconnected', () => retry());
      peer.on('error', err => {
        if (err.type === 'peer-unavailable') { clearTimeout(dog); st('noroom'); }
        else if (err.type === 'browser-incompatible') { st('unsupported'); closed = true; return; }
        else st('nosignal', err.type);
        retry();
      });
    }
    function connect() {
      if (closed) return;
      clearTimeout(dog);
      st('find');
      const c = conn = peer.connect(PREFIX + code, { reliable: true });
      let wasOpen = false;
      // 找到房主但通道一直打不开：两边网络直连不通
      dog = setTimeout(() => {
        if (c !== conn || c.open) return;
        st('blocked', c.peerConnection && c.peerConnection.iceConnectionState);
        conn = null;
        try { c.close(); } catch (e) {}
        retry();
      }, 15000);
      c.on('open', () => { wasOpen = true; clearTimeout(dog); st('open'); h.onOpen(api); });
      c.on('data', msg => h.onData(msg));
      c.on('close', () => { if (c !== conn) return; conn = null; if (wasOpen) h.onClose && h.onClose(); retry(); });
      c.on('error', () => { if (c === conn) retry(); });
    }
    function retry() {
      clearTimeout(timer);
      if (closed) return;
      timer = setTimeout(() => {
        if (closed || (conn && conn.open)) return;
        if (peer.destroyed) boot();
        else if (peer.disconnected) { try { peer.reconnect(); } catch (e) { boot(); } }
        else connect();
      }, 3000);
    }
    const api = {
      send(msg) { if (conn && conn.open) conn.send(msg); },
      close() { closed = true; clearTimeout(timer); clearTimeout(dog); peer && peer.destroy(); },
    };
    boot();
    return api;
  }

  root.Net = { openHost, openClient };
})(self);
