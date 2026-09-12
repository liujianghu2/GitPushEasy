'use strict';
/**
 * github.js —— GitHub REST API 与 OAuth Device Flow 客户端。
 * 只用 Node 内置的 fetch,不引入任何第三方网络库。
 */

const API = 'https://api.github.com';
const OAUTH = 'https://github.com/login';

/**
 * Device Flow 的 Client ID。
 *
 * OAuth App 的 Device Flow 不需要 client_secret(这是 GitHub 官方为
 * 原生/桌面客户端设计的流程),所以内置一个公开的 Client ID 在原理上是安全的,
 * 前提是那个 OAuth App 勾选了 "Enable Device Flow"。
 *
 * 但现实中没有一个"公共通用"的 Client ID 可以借用 —— 每个 OAuth App 都属于
 * 某个具体账号。所以这里的策略是:
 *   · 如果构建/运行时通过环境变量 GPE_CLIENT_ID 提供了自己的 Client ID,就用它
 *   · 否则用一个占位值,并让界面明确提示用户去填自己的(设置 → 登录与安全)
 *   · 界面上"访问令牌"这条路始终可用,不受影响
 *
 * 自己申请一个只要 1 分钟,而且是免费的:
 *   GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
 *   勾选 Enable Device Flow,把生成的 Client ID 填进设置里即可。
 */
const DEFAULT_CLIENT_ID = process.env.GPE_CLIENT_ID || 'Ov23li00000000000000';
const DEFAULT_SCOPES = 'repo read:user user:email workflow';

function userAgent(version) {
  return `GitPushEasy/${version || '1.0.0'}`;
}

/* ---------------------------------------------------------------- HTTP 基础 */

class GhError extends Error {
  constructor(message, status, body, kind) {
    super(message);
    this.name = 'GhError';
    this.status = status;
    this.body = body;
    this.kind = kind || 'api';
  }
}

/** 把普通对象包成带 .get() 的形状,和 fetch 的 Headers 接口保持一致 */
function wrapHeaders(obj) {
  const lower = {};
  for (const [k, v] of Object.entries(obj || {})) lower[String(k).toLowerCase()] = v;
  return { get: (name) => (name ? lower[String(name).toLowerCase()] : undefined), raw: lower };
}

async function request(pathOrUrl, opts) {
  opts = opts || {};
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : API + pathOrUrl;
  const headers = Object.assign(
    {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': userAgent(opts.version),
    },
    opts.headers || {}
  );
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers.Accept = 'application/json';
    body = new URLSearchParams(opts.form).toString();
  }

  /**
   * 先尝试走系统代理。
   *
   * Node 的 fetch 不读系统代理,而 undici 在 Electron 里不一定可用,
   * 所以我们用 net.js 里手写的 CONNECT 隧道发请求。失败(代理没开、
   * 不支持 CONNECT 等)时静默回退到直连 —— 不能因为代理不可用就让
   * 整个登录流程挂掉。
   *
   * 注意:代理成功返回后要**立刻离开**这段 try —— 否则下面 catch 里的
   * "网络错误"分支会把 HTTP 错误(比如 401)重新包装成网络错误,
   * 调用方就拿不到正确的状态码了。
   */
  let proxied = null;
  try {
    const net = require('./net');
    if (net.resolve().proxy) {
      proxied = await net.httpsViaProxy(url, {
        method: opts.method || (body ? 'POST' : 'GET'),
        headers, body, timeout: opts.timeout || 25000,
      });
    }
  } catch (_) { proxied = null; }

  if (proxied) {
    let pdata = null;
    try { pdata = proxied.text ? JSON.parse(proxied.text) : null; } catch (_) { pdata = { raw: proxied.text }; }
    if (proxied.status >= 200 && proxied.status < 300) {
      return { data: pdata, headers: wrapHeaders(proxied.headers), status: proxied.status };
    }
    // HTTP 层的失败要如实抛出,保留状态码(调用方依赖它判断 401 / 404)
    throw new GhError(friendlyHttpError(proxied.status, pdata, url), proxied.status, pdata, 'http');
  }

  let res;
  try {
    // 直连
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 25000);
    try {
      res = await fetch(url, {
        method: opts.method || (body ? 'POST' : 'GET'),
        headers, body, signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new GhError('请求 GitHub 超时,请检查网络后重试。', 0, null, 'network');
    }
    const code = (e && e.cause && e.cause.code) || '';
    // 国内网络常见现象:api.github.com 能通,但 github.com(登录/授权页)连不上。
    // 这不属于"工具坏了",必须明确告诉用户原因和替代方案。
    if (/github\.com/i.test(url) && !/api\.github\.com/i.test(url) &&
        /TIMEOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED|EPROTO|EAI_AGAIN/i.test(code + ' ' + (e.message || ''))) {
      throw new GhError(
        '连不上 github.com(浏览器授权用的就是这个域名)。' +
        '常见原因:当前网络访问 github.com 受限或超时 —— 这在国内比较常见,' +
        'api.github.com 往往能通,但 github.com 不行。\n' +
        '解决办法:改用「访问令牌」登录(它只访问 api.github.com),' +
        '或在「设置 → 疑难排解 → 网络」里配好代理后重试。',
        0, null, 'network'
      );
    }
    throw new GhError('无法连接 GitHub: ' + (e && e.message ? e.message : e), 0, null, 'network');
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new GhError(friendlyHttpError(res.status, data, url), res.status, data, 'http');
  }
  return { data, headers: res.headers, status: res.status };
}

/**
 * 把 GitHub 的 HTTP 错误翻译成用户能看懂的中文。
 *
 * 注意要区分"哪个接口报的错" —— 同样是 404:
 *   · /repos/... 报 404 = 仓库不存在
 *   · /login/device/code 报 404 = OAuth App 不存在(Client ID 无效)
 * 如果一律说成"仓库不存在",用户会完全找不到北。
 */
function friendlyHttpError(status, data, url) {
  const msg = data && data.message ? data.message : '';
  const path = String(url || '');
  const isOAuthEndpoint = /\/login\/(device\/code|oauth\/access_token)/.test(path);
  const isRepoEndpoint = /\/repos\//.test(path);

  if (isOAuthEndpoint) {
    if (status === 404 || /Not Found/i.test(msg)) {
      return '这个 Client ID 在 GitHub 上不存在(404)。它通常是占位值或者已被删除 —— ' +
        '浏览器授权需要你自己申请一个 OAuth App 并勾选 Enable Device Flow,把 Client ID 填到「设置 → 登录与安全」。' +
        '在此之前,请改用「访问令牌」登录,那条路不受影响。';
    }
    if (status === 401 || /incorrect_client_credentials|bad_verification_code/i.test(msg)) {
      return '这个 Client ID 未启用 Device Flow,或验证码无效。' +
        '请到 GitHub 的 OAuth App 设置里勾选 Enable Device Flow,或改用「访问令牌」登录。';
    }
    if (status === 403 && /rate limit/i.test(msg)) {
      return 'GitHub 接口访问次数已达上限,请稍后再试。也可以先改用「访问令牌」登录。';
    }
    if (status === 422 || /unsupported|invalid_request/i.test(msg)) {
      return '这个 OAuth App 不支持 Device Flow。请到 GitHub 上勾选 Enable Device Flow,或改用「访问令牌」登录。';
    }
  }

  if (status === 401) {
    return '登录已失效或令牌无效,请重新登录。' + (msg ? `(${msg})` : '');
  }
  if (status === 403) {
    if (/rate limit/i.test(msg)) {
      return 'GitHub 接口访问次数已达上限,请稍后再试(通常 1 小时后恢复)。';
    }
    return '权限不足:当前令牌缺少所需权限。' + (msg ? `(${msg})` : '');
  }
  if (status === 404) {
    if (isRepoEndpoint) {
      return 'GitHub 上找不到这个仓库(可能不存在,或当前账号无权访问)。';
    }
    return 'GitHub 上找不到这个资源' + (msg ? `:${msg}` : '。');
  }
  if (status === 422) {
    return 'GitHub 拒绝了这次请求:' + (msg || '参数不合法,可能是仓库名重复或格式不对。');
  }
  if (status >= 500) {
    return 'GitHub 服务器暂时出问题(' + status + '),请稍后再试。';
  }
  return `GitHub 接口返回 ${status}${msg ? ': ' + msg : ''}`;
}

/* ---------------------------------------------------------------- 账户 */

async function getUser(token, version) {
  const { data, headers } = await request('/user', { token, version });
  const scopes = headers.get('x-oauth-scopes') || '';
  return {
    login: data.login,
    name: data.name,
    avatar_url: data.avatar_url,
    html_url: data.html_url,
    public_repos: data.public_repos,
    total_private_repos: data.total_private_repos,
    scopes,
  };
}

/**
 * 检查令牌是否有创建仓库的权限。
 * 细粒度令牌(fine-grained)不在 x-oauth-scopes 里体现,所以这里
 * 以"能不能列出自己的仓库 + 账号类型"作为粗略判断,失败也不阻塞。
 */
async function checkToken(token, version) {
  const user = await getUser(token, version);
  const classic = /(^|,)\s*(repo|public_repo)\s*(,|$)/.test(user.scopes || '');
  return {
    ...user,
    canCreateRepo: classic || !user.scopes, // 细粒度令牌 scopes 为空,交给实际创建时报错
    isClassic: !!user.scopes,
  };
}

/* ---------------------------------------------------------------- Device Flow */

/**
 * 校验一个 Client ID 是否真的可用于 Device Flow。
 *
 * 做法:直接向 GitHub 申请一次设备码。
 *   · 能拿到 user_code → 这个 Client ID 可用(顺带把结果丢弃,不消耗任何东西)
 *   · 404             → 这个 Client ID 在 GitHub 上不存在
 *   · 其它            → 按返回信息如实报告
 *
 * 这样用户粘贴完 Client ID 就能立刻知道对不对,不用等真正登录时才发现。
 */
async function verifyClientId(clientId, version) {
  const id = String(clientId || '').trim();
  if (!id) return { ok: false, reason: 'empty', message: '请先填写 Client ID。' };
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) {
    return { ok: false, reason: 'format', message: 'Client ID 通常是一串 20 位左右的字母数字,请确认复制完整。' };
  }
  try {
    const flow = await startDeviceFlow(id, 'read:user', version);
    return { ok: true, userCode: flow.userCode, verificationUri: flow.verificationUri };
  } catch (e) {
    let reason = 'unknown';
    if (e.status === 404) {
      reason = 'not-found';
    } else if (e.status === 401 || e.status === 422) {
      reason = 'device-flow-disabled';
    } else if (e.status === 403) {
      reason = 'rate-limit';
    } else if (e.kind === 'network') {
      reason = 'network';
    }
    return { ok: false, reason, status: e.status || 0, message: friendlyHttpError(e.status, e.body, OAUTH + '/device/code') };
  }
}

async function startDeviceFlow(clientId, scopes, version) {
  const id = (clientId || DEFAULT_CLIENT_ID).trim();
  const { data } = await request(`${OAUTH}/device/code`, {
    method: 'POST',
    form: { client_id: id, scope: scopes || DEFAULT_SCOPES },
    version,
  });
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval || 5,
    clientId: id,
  };
}

async function pollDeviceFlow(deviceCode, clientId, version) {
  try {
    const { data } = await request(`${OAUTH}/oauth/access_token`, {
      method: 'POST',
      form: {
        client_id: (clientId || DEFAULT_CLIENT_ID).trim(),
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      version,
    });
    if (data.access_token) {
      return { status: 'ok', token: data.access_token, scope: data.scope || '' };
    }
    if (data.error === 'authorization_pending') return { status: 'pending' };
    if (data.error === 'slow_down') return { status: 'slow_down' };
    if (data.error === 'expired_token') {
      return { status: 'error', message: '验证码已过期,请重新获取。' };
    }
    if (data.error === 'access_denied') {
      return { status: 'denied', message: '你在浏览器里拒绝了授权。' };
    }
    if (data.error === 'device_flow_disabled' || /device flow/i.test(data.error_description || '')) {
      return {
        status: 'error',
        needsClientId: true,
        message:
          '这个 OAuth App 没有开启 Device Flow。请到 GitHub 上为它勾选 Enable Device Flow,' +
          '或在「设置 → 登录与安全」里填入另一个 Client ID;也可以直接改用「访问令牌」。',
      };
    }
    if (data.error === 'incorrect_client_credentials' || data.error === 'unsupported_grant_type') {
      return {
        status: 'error',
        needsClientId: true,
        message:
          '内置的 Client ID 不可用。浏览器授权需要你自己申请一个 OAuth App 并勾选 Enable Device Flow,' +
          '把 Client ID 填进「设置 → 登录与安全」;也可以直接改用「访问令牌」。',
      };
    }
    return { status: 'error', message: data.error_description || data.error || '授权失败。' };
  } catch (e) {
    if (e instanceof GhError && e.kind === 'network') return { status: 'network', message: e.message };
    /**
     * Client ID 无效时,GitHub 的 device/code 接口直接返回 404,
     * 轮询接口也可能返回 400/401。这里必须把它认成"Client ID 的问题",
     * 否则界面上会冒出一句和登录毫无关系的报错。
     */
    if (e instanceof GhError && e.kind === 'http' && [400, 401, 404, 422].includes(e.status)) {
      return { status: 'error', needsClientId: true, message: e.message };
    }
    throw e;
  }
}

/* ---------------------------------------------------------------- 仓库 */

async function listRepos(token, opts) {
  opts = opts || {};
  const per = Math.min(opts.perPage || 100, 100);
  const page = opts.page || 1;
  const { data } = await request(
    `/user/repos?per_page=${per}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    { token, version: opts.version }
  );
  return (data || []).map((r) => ({
    full_name: r.full_name,
    name: r.name,
    owner: r.owner ? r.owner.login : '',
    private: !!r.private,
    html_url: r.html_url,
    clone_url: r.clone_url,
    ssh_url: r.ssh_url,
    default_branch: r.default_branch,
    pushed_at: r.pushed_at,
    updated_at: r.updated_at,
    description: r.description,
    size: r.size,
  }));
}

async function getRepo(token, owner, repo, version) {
  const { data } = await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    token,
    version,
  });
  return {
    full_name: data.full_name,
    name: data.name,
    owner: data.owner ? data.owner.login : owner,
    private: !!data.private,
    html_url: data.html_url,
    clone_url: data.clone_url,
    ssh_url: data.ssh_url,
    default_branch: data.default_branch,
    size: data.size,
    permissions: data.permissions || {},
  };
}

async function createRepo(token, opts) {
  const body = {
    name: opts.name,
    description: opts.description || '',
    private: opts.private !== false,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    auto_init: !!opts.autoInit,
  };
  const path = opts.org ? `/orgs/${encodeURIComponent(opts.org)}/repos` : '/user/repos';
  const { data } = await request(path, { token, json: body, version: opts.version });
  return {
    full_name: data.full_name,
    name: data.name,
    owner: data.owner ? data.owner.login : '',
    private: !!data.private,
    html_url: data.html_url,
    clone_url: data.clone_url,
    ssh_url: data.ssh_url,
    default_branch: data.default_branch,
  };
}

async function listOrgs(token, version) {
  try {
    const { data } = await request('/user/orgs?per_page=100', { token, version });
    return (data || []).map((o) => ({ login: o.login, avatar: o.avatar_url }));
  } catch (_) {
    return [];
  }
}

/**
 * 列出某个分支上的仓库内容(只取顶层,用于判断"远程是不是空的")。
 * 空仓库会返回 404/409,这里统一转成 { empty: true }。
 */
async function branchTree(token, owner, repo, branch, version) {
  try {
    const { data } = await request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/?ref=${encodeURIComponent(branch)}`,
      { token, version }
    );
    return { empty: !Array.isArray(data) || data.length === 0, entries: Array.isArray(data) ? data : [] };
  } catch (e) {
    if (e.status === 404 || e.status === 409) return { empty: true, entries: [] };
    throw e;
  }
}

/** 从各种形态的 GitHub 地址里解析出 owner / repo */
function parseRepoUrl(url) {
  if (!url) return null;
  let u = String(url).trim();
  u = u.replace(/\.git$/, '').replace(/\/+$/, '');
  let m = u.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = u.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = u.match(/^(?:https?:\/\/)?(?:[^@/]*@)?(?:www\.)?github\.com\/([^/]+)\/(.+)$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = u.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

/** 构造带令牌的 HTTPS 推送地址(仅内存中使用,不写入 .git/config) */
function authUrl(cloneUrl, username, token) {
  try {
    const u = new URL(cloneUrl);
    u.username = encodeURIComponent(username || 'x-access-token');
    u.password = encodeURIComponent(token);
    return u.toString();
  } catch (_) {
    return cloneUrl;
  }
}

module.exports = {
  API,
  OAUTH,
  DEFAULT_CLIENT_ID,
  DEFAULT_SCOPES,
  GhError,
  request,
  getUser,
  checkToken,
  startDeviceFlow,
  verifyClientId,
  pollDeviceFlow,
  listRepos,
  getRepo,
  createRepo,
  listOrgs,
  branchTree,
  parseRepoUrl,
  authUrl,
  friendlyHttpError,
};
