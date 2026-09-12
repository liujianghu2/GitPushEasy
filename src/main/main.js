'use strict';
/**
 * main.js —— Electron 主进程。
 * 负责: 窗口与托盘、所有 IPC 处理器(登录/文件夹/仓库/上传/设置)。
 *
 * 安全基线(对一个小工具来说该有的都有):
 *   · 渲染进程关闭 nodeIntegration、开启 contextIsolation,只能通过 preload 暴露的白名单方法访问系统
 *   · 设 Content-Security-Policy,页面不允许加载任何外部脚本
 *   · 所有外链用系统浏览器打开,绝不在应用内打开网页
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, clipboard, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const git = require('./git');
const gh = require('./github');
const repo = require('./repo');
const auth = require('./auth');
const net = require('./net');

const APP_VERSION = require('../../package.json').version;
const IS_DEV = process.argv.includes('--dev');

let mainWindow = null;
let tray = null;
let quitting = false;

/* ------------------------------------------------------------ 单实例 */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/* ------------------------------------------------------------ 窗口 */

function iconPath() {
  const candidates = [
    // 打包后:build/icon.png 会被一起收进 resources/app.asar
    path.join(__dirname, '..', '..', 'build', 'icon.png'),
    // 开发时
    path.join(__dirname, '..', 'renderer', 'assets', 'logo.png'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'build', 'icon.png'),
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

function createWindow() {
  const icon = iconPath();
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#0d1117',
    title: '小白推送',
    icon: icon || undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: IS_DEV,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // 关窗口时最小化到托盘,而不是直接退出(小白常常误点关闭,回来发现"程序没了")
  mainWindow.on('close', (e) => {
    if (!quitting && tray) {
      e.preventDefault();
      mainWindow.hide();
      notifyTrayOnce();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 所有新窗口/外链都交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      openExternal(url);
    }
  });

  // 禁止任何页面请求外部资源(只允许 GitHub 接口)
  try {
    session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
      const u = details.url;
      if (u.startsWith('file://') || u.startsWith('devtools://') || u.startsWith('data:') ||
          u.startsWith('blob:') || u.startsWith('chrome-extension://') ||
          u.startsWith('https://api.github.com') || u.startsWith('https://github.com') ||
          u.startsWith('https://avatars.githubusercontent.com') ||
          u.startsWith('https://objects.githubusercontent.com') ||
          u.startsWith('https://raw.githubusercontent.com')) {
        return cb({});
      }
      cb({ cancel: true });
    });
  } catch (_) { /* 某些环境不支持,忽略 */ }
}

function openExternal(url) {
  try {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  } catch (_) { /* ignore */ }
}

/* ------------------------------------------------------------ 托盘 */

let trayHintShown = false;
function createTray() {
  if (tray) return;
  const icon = iconPath();
  let image = icon ? nativeImage.createFromPath(icon) : nativeImage.createEmpty();
  if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('小白推送 GitPushEasy');
  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

function notifyTrayOnce() {
  if (trayHintShown || !tray) return;
  trayHintShown = true;
  try {
    tray.displayBalloon({
      title: '小白推送还在后台运行',
      content: '窗口已最小化到右下角托盘图标,双击图标可以重新打开。',
    });
  } catch (_) { /* 部分系统不支持气泡 */ }
}

/* ------------------------------------------------------------ IPC 辅助 */

/** 包装处理器:统一异常为 { ok:false, error, code } ,界面永远拿得到可读信息 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_evt, ...args) => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (e) {
      const friendly = e && (e.friendly || e.message) ? (e.friendly || e.message) : String(e);
      return {
        ok: false,
        error: auth.redact(friendly),
        code: (e && e.code) || 'ERROR',
        steps: e && e.steps ? e.steps : undefined,
        warnings: e && e.warnings ? e.warnings : undefined,
      };
    }
  });
}

/** 进度事件回传 */
function emit(channel, payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch (_) { /* ignore */ }
}

/* ------------------------------------------------------------ 应用信息 */

handle('app:info', async () => ({
  version: APP_VERSION,
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  home: os.homedir(),
  git: git.detect(),
  storage: auth.storageInfo(),
  encryption: (() => { try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; } })(),
  defaultClientId: gh.DEFAULT_CLIENT_ID,
}));

handle('app:openExternal', async (url) => {
  openExternal(url);
  return true;
});

handle('app:copy', async (text) => {
  clipboard.writeText(String(text == null ? '' : text));
  return true;
});

handle('app:reveal', async (p) => {
  if (p && fs.existsSync(p)) shell.showItemInFolder(p);
  return true;
});

handle('app:openPath', async (p) => {
  if (p && fs.existsSync(p)) await shell.openPath(p);
  return true;
});

/* ------------------------------------------------------------ 设置与账户 */

handle('settings:get', async () => auth.getSettings());
handle('settings:set', async (patch) => auth.setSettings(patch || {}));
handle('accounts:list', async () => ({
  accounts: auth.listAccounts(),
  last: auth.lastLogin(),
  storage: auth.storageInfo(),
}));

/**
 * 退出登录 —— 只取消自动登录,【不删除】本机保存的凭据。
 * 下次想用时在账号列表里点一下就能回来,不用重新去 GitHub 生成令牌。
 */
handle('accounts:signOut', async (login) => {
  auth.signOut(login);
  return true;
});

/** 永久删除本机登录信息(需用户明确确认后才走这里) */
handle('accounts:remove', async (login) => {
  auth.removeAccount(login);
  return true;
});

/** 用令牌验证并登录 */
handle('auth:token', async ({ token, remember }) => {
  const t = String(token || '').trim();
  if (!t) throw new Error('请输入访问令牌。');
  if (t.length < 20) throw new Error('这个令牌看起来太短了,请确认复制完整。');
  const profile = await gh.checkToken(t, APP_VERSION);
  if (remember !== false) auth.saveAccount(profile, t, 'token');
  return {
    login: profile.login,
    name: profile.name,
    avatar: profile.avatar_url,
    scopes: profile.scopes,
    canCreateRepo: profile.canCreateRepo,
    isClassic: profile.isClassic,
  };
});

/**
 * 账号密码登录 —— 刻意不提供。
 *
 * GitHub 自 2021-08-13 起彻底停用密码推送,任何用它做认证的路径都必然失败。
 * 保留一个注定报错的入口只会让用户以为"工具坏了",所以这里直接返回明确说明,
 * 界面上也不再展示这个选项(这是一道防御性兜底,防止旧版本界面或脚本调用)。
 */
handle('auth:password', async () => {
  throw new Error(
    'GitHub 从 2021 年 8 月 13 日起已彻底停用账号密码推送,请改用「浏览器授权」或「访问令牌」。' +
    '两种方式都是一分钟就能搞定,而且比密码更安全。'
  );
});

/** 读取本机 Git Credential Manager 里已经保存过的 GitHub 凭据 */
handle('auth:credentialManager', async () => {
  const info = git.detect();
  if (!info.available) throw new Error('本机没有安装 Git,无法读取已保存的凭据。');

  const attempts = [
    'protocol=https\nhost=github.com',
    'protocol=https\nhost=api.github.com',
    `protocol=https\nhost=github.com\nusername=${await guessGitUserName()}`,
  ];
  let lastReason = '';
  for (const input of attempts) {
    const r = await git.credentialFill(input);
    if (r.ok && r.password) {
      // 拿到凭据后仍然要验证它是否有效
      try {
        const profile = await gh.checkToken(r.password, APP_VERSION);
        auth.saveAccount(profile, r.password, 'gcm');
        return {
          login: profile.login,
          name: profile.name,
          avatar: profile.avatar_url,
          scopes: profile.scopes,
          username: r.username,
          source: 'Git Credential Manager',
        };
      } catch (e) {
        lastReason = '本机保存的凭据已经失效了(' + e.message + '),请用令牌重新登录。';
      }
    } else if (r.reason) {
      lastReason = r.reason;
    }
  }
  throw new Error(
    (lastReason ? lastReason + ' ' : '') +
    '没有从本机凭据管理器读到可用的 GitHub 账号。如果你以前在命令行或 GitHub Desktop 里登录过,可以再试一次;' +
    '否则请改用"访问令牌"方式登录。'
  );
});

async function guessGitUserName() {
  const r = git.gitSync(['config', '--global', 'user.name'], { timeout: 8000 });
  return r.code === 0 ? r.stdout.trim() : '';
}

/**
 * 校验 Client ID 是否可用于浏览器授权。
 * 界面在用户粘贴后立刻调用,给出"可用 / 不可用 + 原因",避免走到最后才失败。
 */
handle('auth:verifyClientId', async (clientId) => {
  const id = String(clientId || '').trim();
  const res = await gh.verifyClientId(id, APP_VERSION);
  if (res.ok) {
    // 校验通过就顺手保存,省得用户再点一次"保存设置"
    auth.setSettings({ clientId: id });
  }
  return res;
});

/* ---------------------------------------------------- Device Flow 一键登录 */

let deviceFlow = null;      // { deviceCode, clientId, interval, expiresAt, timer, login }
let deviceFlowWaiter = null;

handle('auth:deviceStart', async () => {
  const settings = auth.getSettings();
  const clientId = (settings.clientId || gh.DEFAULT_CLIENT_ID).trim();
  const flow = await gh.startDeviceFlow(clientId, gh.DEFAULT_SCOPES, APP_VERSION);
  stopDeviceFlow();
  deviceFlow = {
    deviceCode: flow.deviceCode,
    clientId: flow.clientId,
    interval: flow.interval,
    expiresAt: Date.now() + flow.expiresIn * 1000,
    state: 'pending',
    message: '',
  };
  startPolling();
  return {
    userCode: flow.userCode,
    verificationUri: flow.verificationUri,
    verificationUriComplete: flow.verificationUriComplete,
    expiresIn: flow.expiresIn,
    interval: flow.interval,
    usingDefaultClientId: !settings.clientId,
  };
});

function startPolling() {
  if (!deviceFlow) return;
  const tick = async () => {
    if (!deviceFlow || deviceFlow.state !== 'pending') return;
    if (Date.now() > deviceFlow.expiresAt) {
      deviceFlow.state = 'expired';
      deviceFlow.message = '验证码已过期,请重新点击登录获取新的验证码。';
      emit('auth:device', { state: 'expired', message: deviceFlow.message });
      return;
    }
    const r = await gh.pollDeviceFlow(deviceFlow.deviceCode, deviceFlow.clientId, APP_VERSION);
    if (r.status === 'ok') {
      try {
        const profile = await gh.checkToken(r.token, APP_VERSION);
        auth.saveAccount(profile, r.token, 'device');
        deviceFlow.state = 'ok';
        emit('auth:device', {
          state: 'ok',
          account: {
            login: profile.login,
            name: profile.name,
            avatar: profile.avatar_url,
            scopes: profile.scopes,
          },
        });
      } catch (e) {
        deviceFlow.state = 'error';
        deviceFlow.message = '授权成功,但读取账号信息失败:' + e.message;
        emit('auth:device', { state: 'error', message: deviceFlow.message });
      }
      return;
    }
    if (r.status === 'denied') {
      deviceFlow.state = 'denied';
      deviceFlow.message = r.message;
      emit('auth:device', { state: 'denied', message: r.message });
      return;
    }
    if (r.status === 'error') {
      deviceFlow.state = 'error';
      deviceFlow.message = r.message;
      emit('auth:device', { state: 'error', message: r.message, needsClientId: !!r.needsClientId });
      return;
    }
    if (r.status === 'slow_down') {
      deviceFlow.interval = Math.min(deviceFlow.interval + 5, 30);
    }
    emit('auth:device', { state: 'pending', message: '等待你在浏览器里完成授权…' });
    setTimeout(tick, deviceFlow.interval * 1000);
  };
  setTimeout(tick, deviceFlow ? deviceFlow.interval * 1000 : 5000);
}

function stopDeviceFlow() {
  if (deviceFlow && deviceFlow.timer) clearTimeout(deviceFlow.timer);
  deviceFlow = null;
}

handle('auth:deviceCancel', async () => {
  stopDeviceFlow();
  return true;
});

/* ------------------------------------------------------------ 文件夹与仓库 */

handle('folder:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择要上传的文件夹',
    buttonLabel: '选择这个文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

handle('folder:inspect', async (dir) => {
  if (!dir) throw new Error('没有选择文件夹。');
  return repo.inspectFolder(dir);
});

handle('folder:openInExplorer', async (dir) => {
  if (dir && fs.existsSync(dir)) await shell.openPath(dir);
  return true;
});

handle('folder:difficulty', async (dir) => {
  // 危险目录提示: 整个磁盘根目录、用户目录、系统目录
  const d = path.resolve(dir).toLowerCase();
  const risky = [];
  const driveRoot = /^[a-z]:[\\/]?$/;
  if (driveRoot.test(d)) risky.push('这是一个磁盘的根目录');
  if (d === os.homedir().toLowerCase()) risky.push('这是你的用户主目录');
  for (const sys of ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata']) {
    if (d === sys) risky.push('这是系统目录');
  }
  return { risky, reasons: risky };
});

/* ------------------------------------------------------------ 分析 / 上传 */

async function withToken(login, fn) {
  const account = login || auth.lastLogin();
  if (!account) throw new Error('还没有登录 GitHub,请先在上方登录。');
  const token = auth.getToken(account);
  if (!token) throw new Error('本地保存的登录信息无法解密,请重新登录。');
  return fn(token, account);
}

handle('repo:analyze', async (input) => withToken(input.login, async (token, login) => {
  const res = await repo.analyze({
    dir: input.dir,
    syncStrategy: input.strategy || auth.getSettings().defaultSyncStrategy,
    token,
    login,
    remoteName: input.remote,
    scan: input.scan,
  });
  return res;
}));

handle('repo:push', async (input) => withToken(input.login, async (token, login) => {
  const settings = auth.getSettings();
  const author = resolveAuthor(settings, login);
  const result = await repo.push({
    dir: input.dir,
    action: input.action || 'auto',
    commit: input.commit,
    sync: input.sync,
    branch: input.branch,
    baseBranch: input.baseBranch || settings.defaultBranch,
    remote: input.remote || 'origin',
    strategy: input.strategy || settings.defaultSyncStrategy,
    token: input.ssh ? null : token,
    login,
    ssh: !!input.ssh,
    author,
    message: input.message || '',
    paths: input.paths,
    newBranch: input.newBranch || '',
    targetBranch: input.targetBranch || '',
    scan: input.scan,
  }, (event, payload) => emit('push:progress', { event, payload }));
  return result;
}));

handle('repo:resolve', async (input) => {
  const next = await repo.analyze({
    dir: input.dir,
    syncStrategy: input.strategy || auth.getSettings().defaultSyncStrategy,
    token: input.login ? auth.getToken(input.login) : null,
    login: input.login,
    remoteName: input.remote,
  });
  return next;
});

function resolveAuthor(settings, login) {
  if (settings.authorMode === 'global') return null; // 交给 git 全局配置
  const name = settings.commitName || login || '';
  const email = settings.commitEmail || (login ? `${login}@users.noreply.github.com` : '');
  if (!name && !email) return null;
  return { name: name || login, email };
}

handle('repo:abortMerge', async (dir) => repo.abortMerge(dir));

/** 轻量状态轮询:只读本地,不联网 —— 供界面监控文件改动 */
handle('repo:quickStatus', async (dir) => {
  if (!dir) throw new Error('没有指定文件夹。');
  return repo.quickStatus(dir);
});

/* ------------------------------------------------------------ 历史与回滚 */

handle('repo:history', async (input) => {
  if (!input || !input.dir) throw new Error('没有指定文件夹。');
  if (!git.isRepo(input.dir)) return { branch: '', branches: [], commits: [], remoteError: '这个文件夹还不是 Git 仓库' };
  return repo.history(input);
});

handle('repo:rollback', async (input) => {
  if (!input || !input.dir) throw new Error('没有指定文件夹。');
  if (!input.confirm) {
    const err = new Error('回滚操作需要明确确认。');
    err.code = 'NEED_CONFIRM';
    throw err;
  }
  return repo.rollback(input);
});
handle('repo:fixSsl', async () => repo.fixSslConfig());

/* ------------------------------------------------------------ 网络与代理 */

handle('net:info', async () => {
  const info = net.resolve({ force: true, gitPath: git.findGit && git.findGit() });
  return { current: info, commonPorts: net.COMMON_PORTS };
});

handle('net:diagnose', async () => net.diagnose({ gitPath: git.findGit && git.findGit() }));

handle('net:setProxy', async (proxy) => {
  const p = String(proxy || '').trim();
  if (p && !/^(https?|socks[45]?):\/\/[^\s]+$/i.test(p)) {
    throw new Error('代理地址格式不对,应当形如 http://127.0.0.1:7890');
  }
  const info = net.setProxy(p, git.findGit && git.findGit());
  git.invalidateNetworkArgs();
  return info;
});

/** 一键探测本机正在运行的代理(扫描常见端口) */
handle('net:autoDetect', async () => {
  net.invalidate();
  // 只扫本地端口,避免误用系统里过期的代理配置
  const found = [];
  for (const p of net.COMMON_PORTS) {
    if (net.probeLocalPort ? net.probeLocalPort(p.port) : false) {
      found.push({ port: p.port, name: p.name, proxy: `http://127.0.0.1:${p.port}` });
    }
  }
  return { found, current: net.resolve({ force: true, gitPath: git.findGit && git.findGit() }) };
});

/* ------------------------------------------------------------ GitHub 仓库 */

handle('gh:repos', async (input) => withToken(input.login, async (token, login) => {
  const repos = await gh.listRepos(token, { page: input.page || 1, perPage: 100, version: APP_VERSION });
  return { repos, login };
}));

handle('gh:orgs', async (input) => withToken(input.login, async (token) => gh.listOrgs(token, APP_VERSION)));

handle('gh:checkRepo', async (input) => withToken(input.login, async (token) => {
  const parsed = gh.parseRepoUrl(input.fullName);
  if (!parsed) throw new Error('仓库名格式不对,应该是 用户名/仓库名。');
  const info = await gh.getRepo(token, parsed.owner, parsed.repo, APP_VERSION);
  return info;
}));

handle('gh:createRepo', async (input) => withToken(input.login, async (token) => {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('请填写仓库名称。');
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('仓库名只能用字母、数字、点、下划线和短横线。');
  }
  const info = await gh.createRepo(token, {
    name,
    description: input.description || '',
    private: input.private !== false,
    org: input.org || '',
    autoInit: !!input.autoInit,
    version: APP_VERSION,
  });
  return info;
}));

handle('gh:branchTree', async (input) => withToken(input.login, async (token) => {
  const parsed = gh.parseRepoUrl(input.fullName);
  if (!parsed) throw new Error('仓库名格式不对。');
  return gh.branchTree(token, parsed.owner, parsed.repo, input.branch || 'main', APP_VERSION);
}));

/**
 * 探测 github.com 是否可达。
 *
 * 只对 github.com 发一个轻量 HEAD 请求 —— 浏览器授权要用这个域名,
 * 而国内网络经常能通 api.github.com、通不了 github.com。
 * 提前知道这一点,就能在界面上给出正确建议,而不是等用户点了才失败。
 */
handle('gh:probeWeb', async () => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://github.com/favicon.ico', {
      method: 'HEAD',
      signal: ctrl.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'GitPushEasy/' + APP_VERSION },
    });
    clearTimeout(timer);
    return { reachable: res.status > 0, status: res.status };
  } catch (e) {
    clearTimeout(timer);
    return { reachable: false, error: auth.redact(String((e && e.message) || e)) };
  }
});

/** 把本地文件夹与一个已有仓库关联起来 */
handle('repo:setRemote', async (input) => {
  const url = input.url || (input.fullName ? `https://github.com/${input.fullName}.git` : '');
  if (!url) throw new Error('没有提供仓库地址。');
  return repo.setRemote(input.dir, url, input.remote || 'origin');
});

handle('repo:remotes', async (dir) => git.remotes(dir).then((list) => list.map((r) => ({
  name: r.name,
  fetch: git.normalizeUrl(r.fetch),
  push: git.normalizeUrl(r.push),
}))));

handle('repo:commits', async (input) => {
  if (!git.isRepo(input.dir)) return [];
  return git.log(input.dir, input.limit || 20);
});

handle('repo:diff', async (input) => {
  if (!git.isRepo(input.dir)) return '';
  // 指定了提交 → 看这条提交改了什么;否则看工作区的改动
  if (input.ref) {
    const args = ['show', '--no-color', '--no-ext-diff', '--unified=3',
      '--format=%h %an %ad%n%s%n', '--date=iso', input.ref];
    if (input.file) args.push('--', input.file);
    const r = await git.gitAsync(args, { cwd: input.dir, timeout: 60000 });
    return r.code === 0 ? r.stdout : '';
  }
  return git.diff(input.dir, input.file, !!input.staged);
});

handle('repo:branches', async (dir) => (git.isRepo(dir) ? git.branches(dir) : []));

handle('repo:gitignorePreview', async (input) => {
  const kind = input.projectKind || 'generic';
  return { content: git.GITIGNORE_TEMPLATES[kind] || git.GITIGNORE_TEMPLATES.generic, exists: fs.existsSync(path.join(input.dir, '.gitignore')) };
});

handle('repo:writeGitignore', async (input) => {
  const file = path.join(input.dir, '.gitignore');
  if (fs.existsSync(file) && !input.overwrite) {
    throw new Error('.gitignore 已经存在,为避免覆盖你已有的规则,程序不会自动改写。你可以手动编辑它。');
  }
  await fs.promises.writeFile(file, input.content || git.GITIGNORE_TEMPLATES.generic, 'utf8');
  return true;
});

/** 忽略某些文件/文件夹(追加到 .gitignore),用于"我不想上传这个" */
handle('repo:ignorePaths', async (input) => {
  const file = path.join(input.dir, '.gitignore');
  let cur = '';
  try { cur = await fs.promises.readFile(file, 'utf8'); } catch (_) {}
  const lines = cur.split(/\r?\n/);
  const added = [];
  for (const p of input.paths || []) {
    let line = '/' + String(p).replace(/\\/g, '/').replace(/^\//, '');
    if (input.isDir) line += '/';
    if (!lines.includes(line)) { lines.push(line); added.push(line); }
  }
  const text = lines.join('\n').replace(/\n+$/, '') + '\n';
  await fs.promises.writeFile(file, text, 'utf8');
  return { added, file };
});

/* ------------------------------------------------------------ diff 高亮辅助 */

handle('text:highlight', async ({ text, ext }) => {
  // 主进程只做纯文本处理,渲染层负责上色;这里预留扩展点
  return { text: String(text || ''), ext: ext || '' };
});

/* ------------------------------------------------------------ 生命周期 */

app.whenReady().then(() => {
  createWindow();
  try { createTray(); } catch (_) { tray = null; }

  /**
   * 打包自检模式(仅用于构建验证,不影响正常使用)。
   *
   * 设置 GPE_SMOKE_EXIT=1 启动时,等窗口加载完成、渲染进程报回"启动成功"
   * 之后延时退出,并把结果写到 stdout。这样打包产物可以用脚本验证,
   * 不必靠人盯着看一眼。
   */
  runSmokeExitIfRequested();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

function runSmokeExitIfRequested() {
  if (process.env.GPE_SMOKE_EXIT !== '1') return;
  const out = (line) => { try { process.stdout.write(line + '\n'); } catch (_) {} };
  const timeoutMs = Number(process.env.GPE_SMOKE_TIMEOUT || 20000);
  let done = false;

  const finish = (code, message) => {
    if (done) return;
    done = true;
    out((code === 0 ? 'SMOKE OK: ' : 'SMOKE FAIL: ') + message);
    setTimeout(() => { quitting = true; app.exit(code); }, 200);
  };

  const timer = setTimeout(() => {
    finish(3, '窗口在 ' + timeoutMs + 'ms 内没有完成加载');
  }, timeoutMs);

  mainWindow.webContents.once('did-finish-load', () => {
    // 再等一会儿,让界面把首屏数据(设置、账号、Git 检测)都拉完
    setTimeout(async () => {
      try {
        const probe = await mainWindow.webContents.executeJavaScript(
          'JSON.stringify({app: typeof window.App, view: window.App && window.App.currentView(),' +
          ' git: !!(window.S.info && window.S.info.git && window.S.info.git.available),' +
          ' err: (window.__gpeErrors || []).length})',
          true
        );
        clearTimeout(timer);
        const info = JSON.parse(probe);
        if (info.app !== 'object') return finish(4, '界面主控没有加载: ' + probe);
        finish(0, probe);
      } catch (e) {
        clearTimeout(timer);
        finish(5, '读取界面状态失败: ' + (e && e.message ? e.message : e));
      }
    }, 2200);
  });

  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    clearTimeout(timer);
    finish(6, '渲染进程崩溃: ' + JSON.stringify(d));
  });
}

/** 界面里出现 JS 错误时记一笔,方便排查(正常使用时界面上无感) */
ipcMain.on('app:renderer-error', (_e, payload) => {
  try {
    console.error('[renderer error] ' + auth.redact(JSON.stringify(payload)));
  } catch (_) { /* ignore */ }
});

app.on('window-all-closed', () => {
  // 有托盘时保持后台运行;没有托盘(创建失败)则正常退出,避免出现无法关闭的幽灵进程
  if (process.platform !== 'darwin' && !tray) app.quit();
});

app.on('before-quit', () => { quitting = true; });

process.on('uncaughtException', (e) => {
  // 绝不让未捕获异常静默带走整个程序
  try {
    dialog.showErrorBox('小白推送遇到问题', auth.redact(String(e && e.stack ? e.stack : e)));
  } catch (_) {}
});
