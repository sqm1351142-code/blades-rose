/* 联机层：PeerJS（WebRTC）。房主浏览器开一个固定 ID 的 peer，其他人连过去。
 * 只负责收发 JSON，不懂游戏规则。 */
(function (root) {
  'use strict';
  const PREFIX = 'blood-blade-white-rose-';
  // 国内连不上 Google STUN，先放国内可用的
  const OPTS = { config: { iceServers: [
    { urls: 'stun:stun.miwifi.com:3478' },
    { urls: 'stun:stun.chat.bilibili.com:3478' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ] } };

  // 房主：同一个房间码重开时，旧连接可能还占着 ID，稍等重试
  function openHost(code, h) {
    let tries = 0, peer;
    const conns = new Map();
    function start() {
      peer = new Peer(PREFIX + code, OPTS);
      peer.on('open', () => h.onOpen && h.onOpen());
      peer.on('connection', conn => {
        conn.on('open', () => conns.set(conn.connectionId, conn));
        conn.on('data', msg => h.onData(conn, msg));
        conn.on('close', () => { conns.delete(conn.connectionId); h.onClose(conn); });
        conn.on('error', () => {});
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
      peer.on('error', err => {
        if (err.type === 'unavailable-id' && tries++ < 8) { peer.destroy(); setTimeout(start, 2500); return; }
        h.onError && h.onError(err);
      });
    }
    start();
    return {
      send(conn, msg) { if (conn.open) conn.send(msg); },
      conns: () => [...conns.values()],
      close() { peer && peer.destroy(); },
    };
  }

  // 玩家：断线后自动重连
  function openClient(code, h) {
    let peer, conn, closed = false, timer;
    function connect() {
      if (closed) return;
      conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on('open', () => h.onOpen(api));
      conn.on('data', msg => h.onData(msg));
      conn.on('close', () => { h.onClose && h.onClose(); retry(); });
      conn.on('error', () => retry());
    }
    function retry() { clearTimeout(timer); if (!closed) timer = setTimeout(connect, 2000); }
    peer = new Peer(OPTS);
    peer.on('open', connect);
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') { h.onError && h.onError('找不到这个房间，确认房间码，或者等房主打开页面'); retry(); return; }
      if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') { retry(); }
      h.onError && h.onError(String(err.type || err));
    });
    const api = {
      send(msg) { if (conn && conn.open) conn.send(msg); },
      close() { closed = true; clearTimeout(timer); peer && peer.destroy(); },
    };
    return api;
  }

  root.Net = { openHost, openClient };
})(self);
