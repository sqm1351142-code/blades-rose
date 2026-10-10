// 真实浏览器联机测试：node tests/e2e.js [网址] [人数]
// 用本机 Chrome（无界面）开 N 个标签页，建房、加入、随机打完一局。
const { spawn } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');

const URL0 = process.argv[2] || 'http://127.0.0.1:8765/';
const N = +(process.argv[3] || 5);
const PORT = 9333;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newPage(url) {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === 'Log.entryAdded') logs.push('log.' + m.params.entry.level + ': ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  };
  const cmd = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await cmd('Runtime.enable'); await cmd('Log.enable');
  const ev = async expr => { const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error'); return r.result.result.value; };
  const waitFor = async (expr, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(250); } throw new Error('等待超时：' + what); };
  return { ev, waitFor, logs };
}

// 页面里的随机机器人：每次做一个合法操作，返回做了什么
const BOT = `(() => {
  const q = s => document.querySelector(s), on = el => el && !el.disabled;
  const click = (s, name) => { const el = q(s); if (on(el)) { el.click(); return name || s; } };
  if (q('#app .verdict') && q('.hist')) return 'END';
  return click('[data-act=closeReveal]') || click('[data-act=ack]') || click('[data-act=speechDone]')
    || (q('[data-act=giveCoin]') && (click('[data-act=giveCoin]') || click('.pill[data-act=pick]:not(.on)')))
    || (q('[data-act=magic]') && (click('[data-act=magic]') || click('.pill[data-act=pick]:not(.on)')))
    || (q('[data-act=play]') && ((Math.random() < .4 && click('[data-act=pass]')) || click('[data-act=play]') || click('button.card:not(.sel)')))
    || (q('[data-act=swapPick]') && (Math.random() < .5 ? click('[data-act=swapSkip]') : (click('[data-act=swapPick]') || click('.pill[data-act=pick]:not(.on)'))))
    || (q('[data-act=swapCard]') && (click('[data-act=swapCard]') || click('button.card:not(.sel)')))
    || '';
})()`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-e2e-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
  const pages = [];
  let ok = false;
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
    const t0 = Date.now();
    // 房间不存在时，页面要说清楚原因
    const lost = await newPage(URL0);
    await lost.waitFor(`!!document.querySelector('#name')`, 20000, '首页加载');
    await lost.ev(`document.querySelector('#name').value='迷路';document.querySelector('#code').value='ZZ99';document.querySelector('[data-act=join]').click()`);
    await lost.waitFor(`/找不到房间 ZZ99/.test((document.querySelector('.box .note')||{}).textContent||'')`, 30000, '“找不到房间”提示');
    console.log(`房间不存在时提示正常（${Date.now() - t0}ms）`);
    await lost.ev(`window.close()`);
    const host = await newPage(URL0); pages.push(host);
    await host.waitFor(`!!document.querySelector('#name')`, 20000, '首页加载');
    await host.ev(`document.querySelector('#name').value='房主';document.querySelector('[data-act=create]').click()`);
    await host.waitFor(`!!document.querySelector('.roomcode')`, 20000, '创建房间');
    const code = await host.ev(`document.querySelector('.roomcode').textContent`);
    console.log(`房间 ${code} 已创建（${Date.now() - t0}ms）`);
    for (let i = 1; i < N; i++) {
      const p = await newPage(URL0 + (URL0.includes('?') ? '&' : '?') + 'room=' + code); pages.push(p);
      await p.waitFor(`!!document.querySelector('#name')`, 20000, '玩家首页加载');
      const t1 = Date.now();
      await p.ev(`document.querySelector('#name').value='玩家${i}';document.querySelector('[data-act=join]').click()`);
      try { await p.waitFor(`!!document.querySelector('.roomcode')`, 30000, `玩家${i} 进房间`); }
      catch (e) { console.log('页面提示：', await p.ev(`(document.querySelector('.note')||{}).textContent||''`)); throw e; }
      console.log(`玩家${i} 进入房间（${Date.now() - t1}ms）`);
    }
    await host.waitFor(`document.querySelectorAll('.member').length===${N}`, 10000, '房主看到所有人');
    // 没有默认目标的人数，房主先填上
    for (const [k, val] of [['sac', 3], ['kill', 4]])
      await host.ev(`(()=>{const el=document.querySelector('[data-set=${k}]');if(el&&!el.value){el.value=${val};el.dispatchEvent(new Event('change',{bubbles:true}))}})()`);
    await host.waitFor(`(()=>{const b=document.querySelector('[data-act=start]');return b&&!b.disabled})()`, 5000, '开始按钮可用');
    await host.ev(`document.querySelector('[data-act=start]').click()`);
    const t2 = Date.now(); let ended = 0, steps = 0;
    while (ended < N) {
      if (Date.now() - t2 > 180000) throw new Error('一局 3 分钟没打完');
      ended = 0;
      for (const p of pages) { const r = await p.ev(BOT); if (r === 'END') ended++; else if (r) steps++; }
      await sleep(60);
    }
    console.log(`一局打完，共 ${steps} 次操作：`, await host.ev(`document.querySelector('#app .verdict').textContent+' — '+document.querySelector('#app .verdict').nextElementSibling.textContent`));
    ok = true;
  } catch (e) {
    console.log('失败：', e.message);
  } finally {
    pages.forEach((p, i) => { const bad = p.logs.filter(l => /EXCEPTION|error/i.test(l)); if (bad.length) console.log(`[页面${i}]`, bad.slice(0, 8).join('\n  ')); });
    chrome.kill();
    await sleep(500);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    process.exit(ok ? 0 : 1);
  }
})();
