'use strict';
/**
 * net.js —— 网络与代理自动适配。
 *
 * 为什么需要这个:
 *   国内网络直连 GitHub 经常失败(github.com 尤其容易被重置)。
 *   绝大多数用户其实**已经装了代理工具**(Clash / V2Ray / Shadowsocks 等),
 *   只是 git 默认不会用它 —— 于是"浏览器能上 GitHub,git push 就是连不上"。
 *   GitHub Desktop 之所以"不会这样",就是因为它会自动读取系统代理设置。
 *
 * 这个模块做同样的事,按下面的顺序确定该用哪个代理:
 *   1. 用户在 git 里自己配的 http.proxy          ← 用户明确设置,最高优先级
 *   2. 环境变量 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY
 *   3. Windows 系统代理(注册表 Internet Settings)
 *   4. 常见本地代理端口探测(Clash / V2Ray 默认端口)
 *
 * 探测结果会被缓存,并注入到每一次 git 调用里。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

/** 常见代理工具的默认端口(按流行度排序) */
const COMMON_PORTS = [
  { port: 7890, name: 'Clash / Clash for Windows' },
  { port: 7897, name: 'Clash Verge' },
  { port: 10809, name: 'V2Ray / V2RayN' },
  { port: 10808, name: 'V2Ray SOCKS' },
  { port: 1080, name: '通用 SOCKS' },
  { port: 8080, name: '通用 HTTP' },
  { port: 8888, name: '通用 HTTP' },
  { port: 2080, name: 'Nekoray' },
  { port: 33210, name: 'Shadowsocks' },
];

let cached = null;          // { proxy, source, label }
let cacheTime = 0;
const CACHE_MS = 60000;     // 一分钟内不重复探测

/* ------------------------------------------------------------ 各来源 */

/** 1. 用户在 git 里配的代理 */
function fromGitConfig(gitPath) {
  for (const key of ['http.proxy', 'https.proxy']) {
    const r = spawnSync(gitPath || 'git', ['config', '--global', '--get', key], {
      encoding: 'utf8', windowsHide: true, timeout: 8000,
      env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }),
    });
    const v = (r.stdout || '').trim();
    if (r.status === 0 && v) {
      return { proxy: v, source: 'git-config', label: `Git 配置里的 ${key}` };
    }
  }
  return null;
}

/** 2. 环境变量 */
function fromEnv() {
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const v = process.env[name];
    if (v && v.trim()) {
      return { proxy: v.trim(), source: 'env', label: `环境变量 ${name}` };
    }
  }
  return null;
}

/**
 * 3. Windows 系统代理。
 * 从注册表读 ProxyEnable / ProxyServer,并跳过常见的"被代理软件写坏的"
 * 环回地址(有些工具会写 127.0.0.1:port 但同时设置 ProxyOverride)。
 */
function fromWindowsSystem() {
  if (process.platform !== 'win32') return null;
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const r = spawnSync('reg', ['query', key], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    if (r.status !== 0) return null;
    const text = r.stdout || '';

    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(text);
    if (!enabled) return null;

    const m = text.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
    if (!m) return null;
    let server = m[1].trim();

    // 形如 "http=127.0.0.1:7890;https=127.0.0.1:7890" 时取 https 那段
    if (server.includes('=')) {
      const parts = {};
      for (const seg of server.split(';')) {
        const [k, v] = seg.split('=');
        if (k && v) parts[k.trim().toLowerCase()] = v.trim();
      }
      server = parts.https || parts.http || parts.socks || Object.values(parts)[0] || '';
    }
    if (!server) return null;
    if (!/^[a-z]+:\/\//i.test(server)) server = 'http://' + server;
    return { proxy: server, source: 'windows', label: 'Windows 系统代理' };
  } catch (_) {
    return null;
  }
}

/** 4. 探测本机常见代理端口是否真的在监听 */
function probeLocalPort(port, timeoutMs) {
  try {
    const net = require('net');
    // 同步方式做端口探测:用 child_process 跑一个极短的 netstat 查询
    const r = spawnSync('netstat', ['-ano', '-p', 'TCP'], {
      encoding: 'utf8', windowsHide: true, timeout: timeoutMs || 4000,
    });
    if (r.status !== 0) return false;
    const re = new RegExp('[:.]' + port + '\\s+\\S+\\s+LISTENING', 'i');
    return re.test(r.stdout || '');
  } catch (_) {
    return false;
  }
}

function fromLocalPorts() {
  if (process.platform !== 'win32') return null;
  for (const p of COMMON_PORTS) {
    if (probeLocalPort(p.port)) {
      return { proxy: `http://127.0.0.1:${p.port}`, source: 'local-port', label: `本机 ${p.name}(端口 ${p.port})`, port: p.port };
    }
  }
  return null;
}

/* ------------------------------------------------------------ 对外接口 */

/**
 * 解析当前应当使用的代理。
 * @param opts.gitPath  git 可执行文件路径(用于读 git config)
 * @param opts.force    忽略缓存,强制重新探测
 */
function resolve(opts) {
  opts = opts || {};
  const now = Date.now();
  if (!opts.force && cached && now - cacheTime < CACHE_MS) return cached;

  const found = fromGitConfig(opts.gitPath) || fromEnv() || fromWindowsSystem() || fromLocalPorts();
  cached = found || { proxy: '', source: 'none', label: '未检测到代理(直连)' };
  cacheTime = now;
  return cached;
}

/** 把代理转换成 git 能用的 -c 参数 */
function gitProxyArgs(opts) {
  const info = resolve(opts);
  if (!info.proxy) return { args: [], info };
  return {
    args: ['-c', `http.proxy=${info.proxy}`, '-c', `https.proxy=${info.proxy}`],
    info,
  };
}

/** 清掉缓存(用户改了设置后调用) */
function invalidate() {
  cached = null;
  cacheTime = 0;
}

/**
 * 网络自检:分别测 api.github.com 与 github.com,并报告在用的代理。
 * 用于设置页的"网络诊断",也用于登录页的提前提示。
 */
async function diagnose(opts) {
  opts = opts || {};
  const info = resolve(Object.assign({ force: true }, opts));
  const targets = [
    { name: 'api.github.com', url: 'https://api.github.com/zen', for: '上传 / 创建仓库 / 访问令牌登录' },
    { name: 'github.com', url: 'https://github.com/favicon.ico', for: '浏览器授权 / 打开网页' },
  ];

  const results = [];
  for (const t of targets) {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 10000);
    try {
      const res = await fetch(t.url, {
        method: 'HEAD',
        signal: ctrl.signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'GitPushEasy/1.0.0' },
      });
      clearTimeout(timer);
      results.push({ name: t.name, ok: res.status > 0, status: res.status, ms: Date.now() - started, for: t.for });
    } catch (e) {
      clearTimeout(timer);
      results.push({
        name: t.name, ok: false,
        error: String((e && e.cause && e.cause.code) || (e && e.message) || e),
        ms: Date.now() - started, for: t.for,
      });
    }
  }

  /**
   * 注意:这里的探测**不走代理** —— Node 的 fetch 默认不读 Windows 系统代理,
   * 所以即使显示失败,git 配好代理后仍然可能成功。报告里要说清这一点。
   */
  return {
    proxy: info,
    direct: results,
    note: info.proxy
      ? '已为 git 配置代理:' + info.proxy + '(' + info.label + ')'
      : '未检测到代理。如果直连失败,请开启你的代理工具,或在本页手动填写代理地址。',
  };
}

/** 手动指定 / 清除代理(写进 git 全局配置) */
function setProxy(proxy, gitPath) {
  const key = 'http.proxy';
  const key2 = 'https.proxy';
  const run = (args) => spawnSync(gitPath || 'git', args, {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }),
  });

  if (proxy) {
    run(['config', '--global', key, proxy]);
    run(['config', '--global', key2, proxy]);
  } else {
    run(['config', '--global', '--unset', key]);
    run(['config', '--global', '--unset', key2]);
  }
  invalidate();
  return resolve({ force: true, gitPath });
}

/* ------------------------------------------------------------ fetch 代理 */

/**
 * 走代理发 HTTPS 请求(CONNECT 隧道)。
 *
 * 为什么自己写:Node 内置的 fetch **不读系统代理**,而 undici 在 Electron 里
 * 不一定能被 require 到(实测本机就是 null)。如果只把代理配给 git,
 * 就会出现"能推送、但登录 / 建仓库一直失败"的割裂现象。
 *
 * 这里只用 Node 自带的 http/https 模块手写一次 CONNECT 隧道,
 * 零依赖、行为可预期。代理不可用时返回 null,调用方回退到直连。
 *
 * @returns {Promise<{status:number, headers:object, text:string}|null>}
 */
function httpsViaProxy(targetUrl, opts) {
  opts = opts || {};
  const info = resolve(opts);
  if (!info.proxy) return Promise.resolve(null);

  return new Promise((resolvePromise) => {
    let proxyUrl;
    let target;
    try {
      proxyUrl = new URL(info.proxy);
      target = new URL(targetUrl);
    } catch (_) {
      return resolvePromise(null);
    }
    if (target.protocol !== 'https:') return resolvePromise(null);

    const http = require('http');
    const https = require('https');
    const timeout = opts.timeout || 20000;
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolvePromise(v); } };

    const connectReq = http.request({
      host: proxyUrl.hostname,
      port: proxyUrl.port || 80,
      method: 'CONNECT',
      path: `${target.hostname}:${target.port || 443}`,
      timeout,
      headers: proxyUrl.username
        ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64') }
        : {},
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return done(null);
      }
      const req = https.request({
        socket,
        agent: false,
        servername: target.hostname,
        method: opts.method || 'GET',
        path: target.pathname + target.search,
        headers: Object.assign({ Host: target.hostname }, opts.headers || {}),
        timeout,
      }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => done({
          status: r.statusCode,
          headers: r.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      req.on('error', () => done(null));
      req.on('timeout', () => { req.destroy(); done(null); });
      if (opts.body) req.write(opts.body);
      req.end();
    });

    connectReq.on('error', () => done(null));
    connectReq.on('timeout', () => { connectReq.destroy(); done(null); });
    connectReq.end();
  });
}

module.exports = {
  resolve,
  probeLocalPort,
  gitProxyArgs,
  httpsViaProxy,
  diagnose,
  setProxy,
  invalidate,
  COMMON_PORTS,
};
