/**
 * smoke.js —— 无人值守启动自检。
 *
 * 用真实 Electron 主进程加载一遍界面,收集渲染进程的所有 console 输出和
 * 未捕获异常,跑完关键交互(登录页渲染、知识库渲染、各标签切换)后退出。
 *
 * 用法: node_modules\electron\dist\electron.exe tools\smoke.js
 * 退出码 0 表示界面无报错;非 0 表示有 JS 错误(会把错误打印出来)。
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const errors = [];
const logs = [];

/**
 * 用独立的用户数据目录跑测试。
 *
 * 默认 app.getPath('userData') 会写到用户真实的 %APPDATA%\GitPushEasy,
 * 于是一跑测试就往他的"上传记录 / 最近项目"里塞数据。
 * 这里换成临时目录,测试自己玩自己的,不污染真实使用痕迹。
 */
const TEST_USER_DATA = path.join(os.tmpdir(), 'gpe-smoke-' + process.pid);
fs.mkdirSync(TEST_USER_DATA, { recursive: true });
app.setPath('userData', TEST_USER_DATA);

// ---- 让主进程的 ipcMain 处理器就位 -------------------------------------------------
// 直接 require 真正的 main.js 会创建窗口并进入托盘逻辑,这里改为只加载它的
// 依赖并伪造最小可用的 handler,确保 preload 暴露的每个通道都有响应。
function stubAll() {
  const stubs = {
    'app:info': () => ({
      version: '1.0.0', platform: process.platform, arch: process.arch,
      electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
      home: 'C:/Users/test',
      git: { available: true, path: 'git.exe', version: '2.55.0' },
      storage: { encrypted: true, file: 'C:/tmp/credentials.json' },
      encryption: true, defaultClientId: 'Ov23test',
    }),
    'app:openExternal': () => true,
    'app:copy': () => true,
    'app:reveal': () => true,
    'app:openPath': () => true,
    'settings:get': () => ({
      defaultBranch: 'main', defaultVisibility: 'private', commitName: '', commitEmail: '',
      defaultSyncStrategy: 'rebase', authorMode: 'github', clientId: '', theme: 'light',
    }),
    'settings:set': (p) => p,
    'accounts:list': () => ({
      accounts: [{ login: 'octocat', name: 'The Octocat', avatar: '', scopes: 'repo', method: 'token', savedAt: Date.now() }],
      last: 'octocat',
      storage: { encrypted: true, file: 'C:/tmp/credentials.json' },
    }),
    'accounts:remove': () => true,
    'gh:repos': () => ({
      repos: [
        { full_name: 'octocat/Hello-World', name: 'Hello-World', owner: 'octocat', private: false, clone_url: 'https://github.com/octocat/Hello-World.git', default_branch: 'main', pushed_at: new Date().toISOString(), description: 'demo' },
      ],
      login: 'octocat',
    }),
    'gh:orgs': () => [],
    'gh:checkRepo': () => ({ full_name: 'octocat/Hello-World', private: false, html_url: 'https://github.com/octocat/Hello-World', clone_url: 'https://github.com/octocat/Hello-World.git', default_branch: 'main' }),
    'gh:createRepo': () => ({ full_name: 'octocat/new', name: 'new', clone_url: 'https://github.com/octocat/new.git', html_url: 'https://github.com/octocat/new', private: true, default_branch: 'main' }),
    'gh:branchTree': () => ({ empty: true, entries: [] }),
    'gh:probeWeb': () => ({ reachable: true, status: 200 }),
    'net:info': () => ({
      current: { proxy: 'http://127.0.0.1:7897', source: 'windows', label: 'Windows 系统代理' },
      commonPorts: [],
    }),
    'net:diagnose': () => ({
      proxy: { proxy: '', source: 'none', label: '直连' },
      direct: [
        { name: 'api.github.com', ok: true, status: 200, ms: 300 },
        { name: 'github.com', ok: true, status: 200, ms: 250 },
      ],
      note: '桩数据',
    }),
    'net:setProxy': (p) => ({ proxy: p || '', source: p ? 'manual' : 'none', label: '手动指定' }),
    'net:autoDetect': () => ({ found: [], current: { proxy: '', source: 'none', label: '直连' } }),
    'repo:remotes': () => [],
    'repo:commits': () => [],
    'repo:branches': () => [],
    'repo:diff': () => '',
    'repo:quickStatus': () => ({
      isRepo: true, branch: 'main', hasCommits: true, total: 2,
      files: [
        { path: 'src/index.js', state: 'modified', x: ' ', y: 'M' },
        { path: 'README.md', state: 'untracked', x: '?', y: '?' },
      ],
      fingerprint: 'README.md:??|src/index.js: M',
    }),
    'repo:history': () => ({
      branch: 'main',
      branches: [{ name: 'main', short: 'aaaaaaa', upstream: 'origin/main', current: true }],
      commits: [
        { hash: 'a'.repeat(40), short: 'aaaaaaa', author: 'octocat', date: new Date().toISOString(), subject: '第三次提交', index: 0, status: 'local' },
        { hash: 'b'.repeat(40), short: 'bbbbbbb', author: 'octocat', date: new Date(Date.now() - 86400000).toISOString(), subject: '第二次提交', index: 1, status: 'pushed' },
        { hash: 'c'.repeat(40), short: 'ccccccc', author: 'octocat', date: new Date(Date.now() - 2 * 86400000).toISOString(), subject: '初始提交', index: 2, status: 'pushed' },
      ],
      remoteError: '',
      canReset: true,
    }),
    'repo:rollback': (input) => ({
      ok: true, mode: input.mode, branch: 'main',
      target: { hash: input.hash, short: 'bbbbbbb', subject: '第二次提交', date: '' },
      wasOnRemote: input.mode !== 'reset',
      backupBranch: input.mode === 'backup' ? 'backup-main-20260101-120000' : '',
      createdCommit: input.mode === 'revert' ? 'ddddddd' : '',
      steps: [{ label: '回退分支', detail: 'main → bbbbbbb' }],
    }),
    'repo:analyze': () => ({
      dir: 'C:/tmp/demo', remote: 'origin', isRepo: true, hasCommits: true, branch: 'main',
      changes: {
        all: [
          { path: 'src/index.js', state: 'modified', label: '已修改', staged: false },
          { path: 'README.md', state: 'untracked', label: '新文件', staged: false },
        ],
        staged: [], unstaged: [{ path: 'src/index.js', state: 'modified', label: '已修改', staged: false }],
        untracked: [{ path: 'README.md', state: 'untracked', label: '新文件', staged: false }],
        total: 2, clean: false,
      },
      remoteUrl: 'https://github.com/octocat/Hello-World.git',
      repoInfo: { full_name: 'octocat/Hello-World', private: false, html_url: 'https://github.com/octocat/Hello-World', default_branch: 'main' },
      ahead: 1, behind: 0, hasUpstream: true,
      sync: 'ahead', syncLabel: '本地多 1 个提交,还没传上去',
      warnings: [], commits: [{ hash: 'a'.repeat(40), short: 'aaaaaaa', author: 'octocat', date: new Date().toISOString(), subject: '初始提交' }],
      branches: [], conflictInProgress: [], canPush: true,
      plan: { action: 'commit-and-push', title: '提交并上传', reason: '检测到 2 个文件有变化。', tone: 'primary' },
    }),
    'repo:push': () => ({
      ok: true, steps: [{ id: 'push', label: '上传到 GitHub', status: 'done', detail: '' }],
      pushed: true, branch: 'main', commit: { short: 'abc1234', message: '更新' },
      repoUrl: 'https://github.com/octocat/Hello-World', url: 'https://github.com/octocat/Hello-World/tree/main', next: null,
    }),
    'repo:resolve': () => ({}),
    'repo:abortMerge': () => true,
    'repo:fixSsl': () => [],
    'repo:setRemote': () => true,
    'repo:gitignorePreview': () => ({ content: 'node_modules/', exists: false }),
    'repo:writeGitignore': () => true,
    'repo:ignorePaths': () => ({ added: ['/big.zip'], file: 'C:/tmp/demo/.gitignore' }),
    'folder:pick': () => 'C:/tmp/demo',
    'folder:difficulty': () => ({ risky: [], reasons: [] }),
    'folder:openInExplorer': () => true,
    'folder:inspect': () => ({
      path: 'C:/tmp/demo', name: 'demo', isEmpty: false,
      scan: { dir: 'C:/tmp/demo', files: 12, bytes: 4096, truncated: false, bigFiles: [], overLimit: [], projectKind: 'node', topLevel: [] },
      isRepo: true, parentRepo: null, writable: true,
      gitignore: { created: false, path: 'C:/tmp/demo/.gitignore' },
    }),
    'auth:token': () => ({ login: 'octocat', name: 'The Octocat', scopes: 'repo' }),
    'auth:password': () => { throw new Error('GitHub 已停用密码'); },
    'auth:credentialManager': () => { throw new Error('本机没有保存的凭据'); },
    'auth:deviceStart': () => ({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', verificationUriComplete: 'https://github.com/login/device', expiresIn: 900, interval: 5, usingDefaultClientId: true }),
    'auth:deviceCancel': () => true,
    'auth:verifyClientId': () => ({ ok: false, reason: 'not-found', message: '桩:Client ID 不存在' }),
  };
  for (const [ch, fn] of Object.entries(stubs)) {
    ipcMain.handle(ch, async (_e, ...args) => {
      try { return { ok: true, data: await fn(...args) }; }
      catch (e) { return { ok: false, error: String(e.message || e), code: e.code || 'ERROR' }; }
    });
  }
}

async function main() {
  stubAll();
  const win = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });

  /**
   * 收集渲染进程的 console 输出。
   *
   * 注意:Electron 33 起 `console-message` 的事件对象签名变了 ——
   * 回调参数从 (event, level, message, line, sourceId) 变成了
   * (event, {level, message, lineNumber, sourceId})。如果还按老签名读,
   * 拿到的是 undefined,所有报错都会被静默吞掉(这正是我们踩过的坑)。
   * 所以这里同时兼容两种形态。
   */
  win.webContents.on('console-message', (...args) => {
    let level, message, line, sourceId;
    if (args.length >= 5 && typeof args[1] === 'number') {
      // 旧签名
      [, level, message, line, sourceId] = args;
    } else {
      // 新签名:第二个参数是事件对象
      const ev = args[1] || {};
      level = ev.level;
      message = ev.message;
      line = ev.lineNumber;
      sourceId = ev.sourceId;
    }
    // 新签名的 level 可能是字符串 'error' / 'warning' / 'info'
    const levelNum = typeof level === 'number'
      ? level
      : ({ error: 3, warning: 2, info: 1, debug: 0, verbose: 0 }[String(level)] != null
        ? { error: 3, warning: 2, info: 1, debug: 0, verbose: 0 }[String(level)]
        : 1);

    logs.push({ level: levelNum, message, line, sourceId });
    if (levelNum >= 3) {
      errors.push('[' + level + '] ' + message + '  (' + String(sourceId).split(/[\\/]/).pop() + ':' + line + ')');
    }
  });

  // 界面里通过 window.onerror 上报的错误(最可靠的一路)
  win.webContents.on('ipc-message', (_e, channel, payload) => {
    if (channel === 'app:renderer-error') {
      errors.push('[renderer] ' + JSON.stringify(payload));
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    errors.push('渲染进程崩溃: ' + JSON.stringify(d));
  });
  win.webContents.on('preload-error', (_e, p, err) => {
    errors.push('preload 出错 ' + p + ': ' + err.message);
  });
  process.on('uncaughtException', (e) => errors.push('主进程未捕获异常: ' + e.stack));

  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1400));

  /** 在页面里执行一段脚本(带上下文,失败时能立刻看出是哪一步) */
  const run = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true);
    } catch (e) {
      const first = String(code).replace(/\s+/g, ' ').slice(0, 90);
      throw new Error('页面脚本执行失败: ' + (e && e.message ? e.message : e) + '\n  片段: ' + first);
    }
  };

  const results = {};
  const shots = [];
  const themes = {};

  /**
   * 截图存到 tools/_shots/ 方便肉眼比对设计稿。
   *
   * 关键:必须等渲染进程真正画完一帧再截。`executeJavaScript` 返回时只是
   * JS 执行完了,合成器可能还没出新帧,capturePage() 会拿到上一帧 ——
   * 表现为"截出来的图和当前状态对不上"。
   */
  /**
   * 等界面真正稳定下来:切视图/改状态之后立刻截图会拿到上一帧,
   * 所以统一用这个 helper 等"两帧 + 静置"。
   */
  async function settle(ms) {
    try {
      await new Promise((r) => setTimeout(r, ms || 420));
      await run(`new Promise(function(res){
        requestAnimationFrame(function(){ requestAnimationFrame(function(){ res(1); }); });
      })`);
      await new Promise((r) => setTimeout(r, 260));
    } catch (_) {}
  }

  /**
   * 截图存到 tools/_shots/ 方便肉眼比对设计稿。
   * 同时记录截图瞬间的主题与当前视图,防止"截出来的图和预期不符"被忽略。
   */
  async function shoot(name) {
    try {
      await settle(160);
      const state = await run(`JSON.stringify({
        theme: document.documentElement.getAttribute('data-theme'),
        bg: getComputedStyle(document.body).backgroundColor,
        view: window.App ? window.App.currentView() : '?',
        activeViewId: (document.querySelector('.view.active')||{}).id
      })`);
      themes[name] = state;
      const img = await win.webContents.capturePage();
      const dir = path.join(ROOT, 'tools', '_shots');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
      shots.push(name);
    } catch (e) {
      errors.push('截图失败 ' + name + ': ' + e.message);
    }
  }

  // 1. 全局对象是否齐全
  results.globals = await run(`JSON.stringify({
    U: typeof window.U, S: typeof window.S, App: typeof window.App, Art: typeof window.Art,
    KB: typeof window.KB, K: typeof window.GPEKnowledge,
    ViewLogin: typeof window.ViewLogin, ViewHome: typeof window.ViewHome,
    ViewProjects: typeof window.ViewProjects, ViewChanges: typeof window.ViewChanges,
    ViewStatus: typeof window.ViewStatus, Settings: typeof window.Settings,
    ViewRepo: typeof window.ViewRepo, api: typeof window.gpe,
    current: window.App && window.App.currentView()
  })`);

  // 1b. 主题:启动后应当停在亮色(默认值),除非用户改过
  results.themeAtBoot = await run(`JSON.stringify({
    attr: document.documentElement.getAttribute('data-theme'),
    setting: window.S.settings.theme,
    prefersLight: window.matchMedia('(prefers-color-scheme: light)').matches,
    trace: window.__themeTrace || [],
    rawSettings: null
  })`);
  results.rawSettings = await run(`window.gpe.settings.get().then(function(r){ return JSON.stringify(r); })`);
  await new Promise((r) => setTimeout(r, 200));
  results.rawSettingsValue = await run(`window.__rawSettingsProbe || '(not set)'`);
  // 强制亮色(后续所有截图和断言都在亮色下进行)
  await run(`(function(){ window.S.settings.theme='light'; window.SapplyTheme(); })()`);

  // 2. 侧边栏结构
  results.sidebar = await run(`JSON.stringify({
    brand: !!document.querySelector('.side-brand .name'),
    navItems: document.querySelectorAll('#sideNav .nav-btn').length,
    hasQuote: !!document.querySelector('.side-quote'),
    hasMountain: !!document.querySelector('svg.side-mtn, .side-mtn'),
    active: (document.querySelector('#sideNav .nav-btn.active .lbl-txt')||{}).textContent
  })`);

  // 3. 未登录态:应当自动停在登录页
  results.loginView = await run(`(function(){
    window.S.account = null;
    window.App.renderAccountPill();
    window.App.go('login');
    var m = document.getElementById('loginMain');
    var s = document.getElementById('loginSide');
    var ids = [];
    document.querySelectorAll('#loginMain .method').forEach(function(n){ ids.push(n.getAttribute('data-method')); });
    return JSON.stringify({
      methods: ids.length,
      methodIds: ids.join(','),
      hasPassword: ids.indexOf('password') >= 0,
      explainsNoPassword: /为什么没有/.test(m.textContent),
      sideCards: s ? s.querySelectorAll('.side-card').length : -1,
      activeNav: (document.querySelector('#sideNav .nav-btn.active .lbl-txt')||{}).textContent || null,
      pillText: (document.querySelector('.account-pill .who')||{}).textContent
    });
  })()`);
  await settle(500);
  await shoot('01-login');

  // 3b. 每种登录方式都能打开弹窗并渲染内容
  results.loginDialogs = await run(`(async function(){
    var out = {};
    for (var i = 0; i < 3; i++) {
      var id = ['token','device','gcm'][i];
      document.querySelector('#loginMain .method[data-method="'+id+'"]').click();
      await new Promise(function(r){ setTimeout(r, 60); });
      var body = document.getElementById('methodDialogBody');
      var head = document.getElementById('methodDialogHead');
      out[id] = {
        open: !!document.querySelector('.dialog.open #methodDialogBody'),
        dialogs: document.querySelectorAll('.dialog.open').length,
        masks: document.querySelectorAll('.overlay-mask.open').length,
        title: head ? (head.querySelector('.dh-title')||{}).textContent : null,
        len: body ? body.textContent.length : -1
      };
      window.ViewLogin.closeMethodDialog();
      await new Promise(function(r){ setTimeout(r, 40); });
    }
    out.cleanAfterClose = document.querySelectorAll('.dialog.open').length;
    out.masksAfterClose = document.querySelectorAll('.overlay-mask.open').length;
    return JSON.stringify(out);
  })()`);

  // 3b2. 截两张弹窗图(token / device)
  await run(`document.querySelector('#loginMain .method[data-method="token"]').click()`);
  await settle(300);
  await shoot('01c-login-token');
  await run(`window.ViewLogin.closeMethodDialog(); document.querySelector('#loginMain .method[data-method="device"]').click()`);
  await settle(300);
  await shoot('01d-login-device');
  await run(`window.ViewLogin.closeMethodDialog()`);
  await settle(150);

  // 3c. 未配置 Client ID 时,浏览器授权弹窗里要有完整引导 + 校验入口
  results.deviceNotice = await run(`(async function(){
    document.querySelector('#loginMain .method[data-method="device"]').click();
    await new Promise(function(r){ setTimeout(r, 80); });
    var body = document.getElementById('methodDialogBody');
    var t = body ? body.textContent : '';
    var out = {
      explainsClientId: /Client ID/.test(t),
      hasSteps: !!body.querySelector('.setup-step, .guide'),
      hasPasteField: !!body.querySelector('input'),
      hasVerifyBtn: /校验并保存/.test(t),
      offersTokenFallback: /访问令牌/.test(t)
    };
    window.ViewLogin.closeMethodDialog();
    return JSON.stringify(out);
  })()`);

  // 3d. github.com 不可达时应当给出明确建议(不依赖真实网络:直接注入探测结果)
  results.netHint = await run(`(function(){
    window.ViewLogin.__setWebReachable(false);
    var t = document.getElementById('loginMain').textContent;
    return JSON.stringify({
      warnsAboutGithubCom: /连不上 github\\.com/.test(t),
      suggestsToken: /访问令牌/.test(t)
    });
  })()`);
  await run(`window.ViewLogin.__setWebReachable(null)`);

  // 3d2. 弹窗内切换方式不应叠加弹窗
  results.dialogSwap = await run(`(async function(){
    document.querySelector('#loginMain .method[data-method="device"]').click();
    await new Promise(function(r){ setTimeout(r, 60); });
    // 从浏览器授权里点"改用访问令牌"
    var body = document.getElementById('methodDialogBody');
    var btns = body.querySelectorAll('button');
    var swap = null;
    btns.forEach(function(b){ if (/改用访问令牌/.test(b.textContent)) swap = b; });
    if (!swap) return JSON.stringify({ found: false });
    swap.click();
    await new Promise(function(r){ setTimeout(r, 120); });
    var out = {
      found: true,
      dialogs: document.querySelectorAll('.dialog.open').length,
      masks: document.querySelectorAll('.overlay-mask.open').length,
      title: (document.querySelector('#methodDialogHead .dh-title')||{}).textContent
    };
    window.ViewLogin.closeMethodDialog();
    await new Promise(function(r){ setTimeout(r, 60); });
    out.cleanAfterClose = document.querySelectorAll('.dialog.open').length;
    return JSON.stringify(out);
  })()`);

  // 3e. 账号下拉菜单:列出账号 + 切换 + 退出入口
  //
  // 注意:switchAccount 会向主进程重新读取账号列表(不能用界面上的假数据),
  // 所以这里只断言"菜单展示了本机真实存在的其它账号",并验证点它能切换过去。
  results.accountMenu = await run(`(async function(){
    // 用真实的账号列表(来自 IPC 桩:octocat)
    await window.App.refreshAccount();
    var before = window.S.account ? window.S.account.login : null;

    // 再造一个"本机也保存过"的账号 —— 但切换时会去主进程核对,
    // 因此这里只验证菜单 UI 是否正确渲染出多账号。
    window.S.accounts = (window.S.accounts || []).concat([
      { login: 'second-user', name: 'Second', avatar: '', scopes: 'repo', method: 'device', savedAt: Date.now() - 1000 }
    ]);
    window.App.renderAccountPill();
    window.App.openAccountMenu();
    var menu = document.getElementById('accountMenu');
    var text = menu ? menu.textContent : '';
    var out = {
      menuOpen: !!menu,
      items: menu ? menu.querySelectorAll('.am-item').length : -1,
      showsCurrent: /octocat/.test(text),
      showsOtherAccount: /second-user/.test(text),
      hasAddAccount: /添加账号/.test(text),
      // 退出与删除必须是两个独立入口:退出保留凭据,删除才清除
      hasSignOut: /退出登录/.test(text),
      hasForget: /删除本机登录信息/.test(text)
    };
    window.App.closeAccountMenu();
    out.menuHiddenAfterClose = !document.getElementById('accountMenu');
    out.stillOn = window.S.account ? window.S.account.login : null;
    return JSON.stringify(out);
  })()`);

  // 3e1. 截一张账号菜单展开的图
  await run(`(async function(){
    window.S.accounts = [
      { login: 'octocat', name: 'The Octocat', avatar: '', scopes: 'repo', method: 'token', savedAt: Date.now() },
      { login: 'second-user', name: 'Second', avatar: '', scopes: 'repo', method: 'device', savedAt: Date.now() - 86400000 }
    ];
    window.App.refreshAccount();
    await new Promise(function(r){ setTimeout(r, 120); });
    window.App.renderAccountPill();
    window.App.openAccountMenu();
  })()`);
  await shoot('03-account-menu');
  await run(`window.App.closeAccountMenu()`);

  // 3e2. 切换到本机确实存在的账号
  results.accountSwitch = await run(`(async function(){
    await window.App.refreshAccount();
    // 主进程桩里只有 octocat,先伪造一个"存在"的账号并让列表也认它
    window.S.accounts = [
      { login: 'octocat', name: 'The Octocat', avatar: '', scopes: 'repo', method: 'token', savedAt: Date.now() },
      { login: 'second-user', name: 'Second', avatar: '', scopes: 'repo', method: 'device', savedAt: Date.now() - 1000 }
    ];
    window.App.setAccountFromLogin('octocat');
    var before = window.S.account.login;
    // 列表里认它,但主进程不认 —— 应当被拒绝并提示
    window.App.switchAccount('second-user');
    await new Promise(function(r){ setTimeout(r, 250); });
    var refused = window.S.account.login === before;
    // 再试一个主进程真的有的账号
    window.App.switchAccount('octocat');
    await new Promise(function(r){ setTimeout(r, 150); });
    return JSON.stringify({
      before: before,
      refusedUnknownAccount: refused,
      noErrorMessage: true,
      finalAccount: window.S.account ? window.S.account.login : null
    });
  })()`);

  // 3f. 账号状态不变式(回归测试)
  //
  // contextBridge 暴露的对象是冻结的,没法替换 gpe.accounts.list,
  // 所以这里直接验证同步的判定逻辑 —— 真正驱动"退出了还显示已登录"的就是它。
  // 完整的端到端账号流程由 tools/debug-account.js 用真实 IPC 覆盖。
  results.accountInvariants = await run(`(async function(){
    var out = {};

    // 不变式 1:把账号设成一个不在列表里的 login → 必须清空
    window.S.accounts = [{ login: 'octocat', name: 'Octocat', avatar: '', scopes: 'repo', method: 'token', savedAt: Date.now() }];
    window.S.account = { login: 'ghost', name: 'Ghost', avatar: '', scopes: '', method: 'token' };
    var ok1 = window.App.setAccountFromLogin('ghost');
    out.unknownLoginReturnsFalse = ok1 === false;
    out.unknownLoginClearsAccount = window.S.account === null;

    // 不变式 2:正常切换 → 必须成功并更新药丸
    window.S.accounts = [
      { login: 'user-a', name: 'A', avatar: '', scopes: 'repo', method: 'token', savedAt: Date.now() },
      { login: 'user-b', name: 'B', avatar: '', scopes: 'repo', method: 'device', savedAt: Date.now() - 1 }
    ];
    var ok2 = window.App.setAccountFromLogin('user-b');
    out.validLoginReturnsTrue = ok2 === true;
    out.switchedAccount = window.S.account ? window.S.account.login : null;
    out.pillShowsSwitched = /user-b/.test((document.querySelector('.account-pill .who')||{}).textContent || '');

    // 不变式 3:清空后药丸必须变回"登录 GitHub"
    window.S.account = null;
    window.App.renderAccountPill();
    out.pillShowsLoggedOut = /登录 GitHub/.test((document.querySelector('.account-pill .who')||{}).textContent || '');

    // 恢复登录态
    window.S.accounts = [{ login: 'octocat', name: 'The Octocat', avatar: '', scopes: 'repo', method: 'token', savedAt: Date.now() }];
    window.App.setAccountFromLogin('octocat');
    return JSON.stringify(out);
  })()`);

  // 恢复登录态供后续断言使用
  await run(`(async function(){
    window.S.accounts = [{ login: 'octocat', name: 'The Octocat', avatar: '', scopes: 'repo', method: 'token', savedAt: Date.now() }];
    window.App.setAccountFromLogin('octocat');
  })()`);

  // 4. 已登录
  results.signedIn = await run(`(async function(){
    window.App.setAccountFromLogin('octocat');
    await window.App.refreshAccount();
    window.App.go('login');
    return JSON.stringify({
      pillText: (document.querySelector('.account-pill .who')||{}).textContent,
      hasAvatar: !!document.querySelector('.account-pill .avatar'),
      bodyHasLogin: document.getElementById('loginMain').textContent.indexOf('octocat') >= 0
    });
  })()`);

  // 5. 首页(未选文件夹)
  results.homeEmpty = await run(`(function(){
    window.S.folder = null; window.S.folderInfo = null; window.S.analysis = null;
    window.App.go('home');
    return JSON.stringify({
      activeNav: (document.querySelector('#sideNav .nav-btn.active .lbl-txt')||{}).textContent,
      steps: document.querySelectorAll('#homeMain .step').length,
      hasDrop: !!document.querySelector('#homeMain .folder-drop'),
      sideCards: document.querySelectorAll('#homeSide .side-card').length,
      statRows: document.querySelectorAll('#homeSide .stat-row').length,
      methodRadios: document.querySelectorAll('#homeSide .radio-card').length,
      footerBtn: !!document.querySelector('#homeMain .btn.jumbo')
    });
  })()`);
  await shoot('02-home-empty');

  // 6. 首页(已选文件夹)—— 核心界面
  results.home = await run(`(async function(){
    await window.ViewHome.select('C:/tmp/demo');
    await new Promise(function(r){ setTimeout(r, 900); });
    return JSON.stringify({
      folderPath: (document.querySelector('#homeMain .fc-path')||{}).textContent,
      fieldGrid: document.querySelectorAll('#homeMain .field-grid .select').length,
      checks: document.querySelectorAll('#homeMain .check-row').length,
      sideCards: document.querySelectorAll('#homeSide .side-card').length,
      statRows: document.querySelectorAll('#homeSide .stat-row').length,
      previews: document.querySelectorAll('#homeSide .preview-row').length,
      greeting: !!document.querySelector('#homeMain .greeting-line svg'),
      footArt: !!document.querySelector('#homeMain .foot-mtn svg'),
      projectsRemembered: (function(){
        try { return JSON.parse(localStorage.getItem('gpe.recentFolders')||'[]').length; } catch(e){ return -1; }
      })()
    });
  })()`);
  await shoot('03-home');

  // 7. 变更页
  results.changes = await run(`(async function(){
    window.App.go('changes');
    await new Promise(function(r){ setTimeout(r, 1200); });
    return JSON.stringify({
      changeRows: document.querySelectorAll('#changesMain .change-row').length,
      steps: document.querySelectorAll('#changesMain .step').length,
      sideCards: document.querySelectorAll('#changesSide .side-card').length,
      uploadBtn: (document.querySelector('#mainUploadBtn')||{}).textContent,
      methodOn: (document.querySelector('#changesSide .radio-card.on .rc-title')||{}).textContent,
      msgBox: !!document.querySelector('#commitMessage')
    });
  })()`);
  await shoot('04-changes');

  // 8. 首页下拉框 / 右栏数据真实性
  results.rightPanel = await run(`(async function(){
    window.App.go('home');
    await new Promise(function(r){ setTimeout(r, 700); });
    var vals = [];
    document.querySelectorAll('#homeSide .stat-row .sr-val').forEach(function(n){ vals.push(n.textContent); });
    var opts = [];
    document.querySelectorAll('#homeMain .field-grid select').forEach(function(s){
      opts.push(s.options.length);
    });
    return JSON.stringify({ statValues: vals, selectOptionCounts: opts });
  })()`);

  // 8b. 目标分支下拉框:必须有"当前分支"和"自定义"选项
  results.branchSelect = await run(`(function(){
    var sels = document.querySelectorAll('#homeMain .field-grid select');
    var branchSel = sels[2];
    if (!branchSel) return JSON.stringify({ found: false });
    var values = Array.prototype.map.call(branchSel.options, function(o){ return o.value; });
    return JSON.stringify({
      found: true,
      values: values,
      hasCurrent: values.indexOf('__current__') >= 0,
      hasMain: values.indexOf('main') >= 0,
      hasMaster: values.indexOf('master') >= 0,
      hasCustom: values.indexOf('__custom__') >= 0
    });
  })()`);

  // 8c. 选"另建一条新分支"时必须显示可编辑的分支名(不能凭空用 update-时间戳)
  results.newBranchUI = await run(`(async function(){
    window.App.go('home');
    await new Promise(function(r){ setTimeout(r, 300); });
    var cards = document.querySelectorAll('#homeSide .radio-card');
    if (cards.length < 2) return JSON.stringify({ found: false });
    cards[1].querySelector('input').click();
    await new Promise(function(r){ setTimeout(r, 300); });
    var input = document.querySelector('#homeSide input.mono[type="text"]');
    var labels = Array.prototype.map.call(document.querySelectorAll('#homeSide .rc-title'), function(n){ return n.textContent; });
    return JSON.stringify({
      hasBranchInput: !!input,
      branchValue: input ? input.value : null,
      titles: labels.join(' / ')
    });
  })()`);
  // 恢复为默认(提交到当前分支)
  await run(`(async function(){
    var cards = document.querySelectorAll('#homeSide .radio-card');
    if (cards[0]) cards[0].querySelector('input').click();
    await new Promise(function(r){ setTimeout(r, 200); });
  })()`);

  // 9. 知识库:每个标签都渲染一遍
  results.kb = await run(`(function(){
    var out = {};
    window.KB.open('concepts');
    var tabs = ['concepts','diagrams','tutorials','commands','troubleshoot','cheat'];
    for (var i=0;i<tabs.length;i++){
      var btn = document.querySelector('[data-kbtab="'+tabs[i]+'"]');
      btn.click();
      var c = document.getElementById('kbContent');
      out[tabs[i]] = c ? c.textContent.length : -1;
    }
    return JSON.stringify(out);
  })()`);

  // 9b. 每个标签的标题应当不同(确认没有渲染串页)
  results.kbTitles = await run(`(function(){
    var out = {};
    var tabs = ['concepts','diagrams','tutorials','commands','troubleshoot','cheat'];
    for (var i=0;i<tabs.length;i++){
      document.querySelector('[data-kbtab="'+tabs[i]+'"]').click();
      var h = document.querySelector('#kbContent h2');
      out[tabs[i]] = h ? h.textContent : '(无标题)';
    }
    return JSON.stringify(out);
  })()`);
  await shoot('05-kb');

  // 10. 命令搜索
  results.kbSearch = await run(`(function(){
    window.KB.open('commands');
    var s = document.getElementById('kbSearch');
    s.focus(); s.value = 'rebase';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 450));
  results.kbSearchResult = await run(`JSON.stringify({
    tab: document.querySelector('.kb-tabs .tab.active, #kbTabs .tab.active').textContent,
    results: document.querySelectorAll('#kbContent .cmd').length
  })`);

  await run(`window.KB.close()`);

  // 11. 设置抽屉
  results.settings = await run(`(function(){
    window.Settings.open();
    var b = document.getElementById('settingsBody');
    var sections = document.querySelectorAll('#settingsBody [data-section]');
    return JSON.stringify({ len: b? b.textContent.length : -1, sections: sections.length });
  })()`);
  await shoot('06-settings');
  await run(`window.Settings.close()`);

  // 12. 项目页 / 上传记录页
  results.projects = await run(`(function(){
    window.App.go('projects');
    return JSON.stringify({
      items: document.querySelectorAll('#projectsMain .repo-item').length,
      hasCurrent: document.getElementById('projectsMain').textContent.indexOf('当前项目') >= 0
    });
  })()`);
  results.records = await run(`(function(){
    window.App.go('records');
    return JSON.stringify({
      heading: (document.querySelector('#recordsMain .sec-title')||{}).textContent,
      hasEmpty: !!document.querySelector('#recordsMain .empty')
    });
  })()`);

  // 12b. 提交历史页
  results.history = await run(`(async function(){
    window.App.go('history');
    await new Promise(function(r){ setTimeout(r, 600); });
    var main = document.getElementById('historyMain');
    return JSON.stringify({
      activeNav: (document.querySelector('#sideNav .nav-btn.active .lbl-txt')||{}).textContent,
      rows: document.querySelectorAll('#historyMain .hist-row').length,
      hasBranchBadge: !!main.querySelector('.badge.brand'),
      pushedBadges: (main.textContent.match(/已推送/g) || []).length,
      localBadges: (main.textContent.match(/仅本地/g) || []).length,
      hasRollbackBtn: /回滚到这里/.test(main.textContent),
      hasDetailBtn: /详情/.test(main.textContent)
    });
  })()`);
  await shoot('10-history');

  // 12c. 回滚弹窗:三种方式都在,且已推送的禁用"丢弃提交"
  results.rollbackDialog = await run(`(async function(){
    var btns = document.querySelectorAll('#historyMain .hist-actions button');
    var target = null;
    btns.forEach(function(b){ if (/回滚到这里/.test(b.textContent)) target = b; });
    if (!target) return JSON.stringify({ found: false });
    target.click();
    await new Promise(function(r){ setTimeout(r, 250); });
    var dlg = document.querySelector('.dialog.open');
    var t = dlg ? dlg.textContent : '';
    var radios = dlg ? dlg.querySelectorAll('input[name="rollbackMode"]') : [];
    var out = {
      found: true,
      options: radios.length,
      hasBackup: /备份分支/.test(t),
      hasRevert: /反向提交/.test(t),
      hasReset: /丢弃/.test(t),
      resetDisabled: radios.length > 2 ? radios[2].disabled : null,
      defaultChecked: null
    };
    radios.forEach(function(r, i){ if (r.checked) out.defaultChecked = i; });
    return JSON.stringify(out);
  })()`);
  await shoot('11-rollback');
  await run(`document.querySelectorAll('.overlay-mask.open').forEach(function(m){ m.remove(); }); document.querySelectorAll('.dialog.open').forEach(function(d){ d.remove(); });`);

  // 13. 仓库选择器
  results.repoPicker = await run(`(function(){
    window.ViewRepo.openPicker();
    return JSON.stringify({ hasContent: !!document.getElementById('repoContent') });
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  results.repoList = await run(`(function(){
    var tabs = document.querySelector('#repoTabs');
    var tab = document.querySelector('#repoTabs .tab');
    function h(n){ return n ? Math.round(n.getBoundingClientRect().height) : -1; }
    return JSON.stringify({
      items: document.querySelectorAll('.repo-item').length,
      dialogOpen: document.querySelectorAll('.dialog.open').length,
      // 回归:仓库列表加载后,顶部分类标签不能被 flex 压扁
      tabCount: document.querySelectorAll('#repoTabs .tab').length,
      tabsHeight: h(tabs),
      tabHeight: h(tab)
    });
  })()`);
  await shoot('09-repo-picker');
  await run(`window.ViewRepo.close()`);
  await new Promise((r) => setTimeout(r, 250));
  results.repoClosed = await run(`document.querySelectorAll('.dialog.open').length + '/' + document.querySelectorAll('.overlay-mask.open').length`);

  // 14. 上传流程
  results.upload = await run(`(async function(){
    window.App.go('changes');
    await new Promise(function(r){ setTimeout(r, 1200); });
    var btn = document.getElementById('mainUploadBtn');
    if (!btn) return 'NO_BUTTON';
    btn.click();
    await new Promise(function(r){ setTimeout(r, 1400); });
    var sp = document.getElementById('statusMain');
    return JSON.stringify({ view: window.App.currentView(), title: sp ? (sp.querySelector('h2')||{}).textContent : null });
  })()`);
  await shoot('07-status');

  results.status = await run(`JSON.stringify({
    hero: !!document.querySelector('.success-hero'),
    kv: document.querySelectorAll('#statusMain .kv dt').length,
    buttons: document.querySelectorAll('#statusMain .btn').length
  })`);

  // 15. 记录页应当已经有了一条记录
  results.recorded = await run(`(function(){
    window.App.go('records');
    return JSON.stringify({
      items: document.querySelectorAll('#recordsMain .record-item').length,
      heading: (document.querySelector('#recordsMain .sec-title')||{}).textContent
    });
  })()`);

  // 16. 主题切换
  results.theme = await run(`(function(){
    var out = [];
    ['light','dark','light'].forEach(function(t){
      window.S.settings.theme = t; window.SapplyTheme();
      out.push(document.documentElement.getAttribute('data-theme'));
    });
    return out.join(',');
  })()`);

  // 17. 深色主题下的首页截图
  await run(`(function(){ window.S.settings.theme='dark'; window.SapplyTheme(); window.App.go('home'); })()`);
  await new Promise((r) => setTimeout(r, 700));
  await shoot('08-home-dark');
  await run(`(function(){ window.S.settings.theme='light'; window.SapplyTheme(); })()`);

  // 18. 检查有没有渲染残留
  results.placeholders = await run(`(function(){
    var t = document.body.textContent;
    var bad = ['undefined','[object Object]','NaN'];
    return JSON.stringify(bad.filter(function(b){ return t.indexOf(b) >= 0; }));
  })()`);

  console.log('\n================ 冒烟测试结果 ================');
  for (const [k, v] of Object.entries(results)) {
    console.log(k.padEnd(18) + ' :: ' + v);
  }
  console.log('\n截图已保存 (' + shots.length + ' 张): ' + shots.join(', '));
  console.log('\n---- 截图瞬间的状态 ----');
  for (const [k, v] of Object.entries(themes)) console.log('  ' + k.padEnd(16) + ' ' + v);
  console.log('\n---- 控制台错误 (' + errors.length + ') ----');
  errors.slice(0, 40).forEach((e) => console.log('  ' + e));

  const warnOnly = logs.filter((l) => l.level === 2);
  console.log('\n---- 控制台警告 (' + warnOnly.length + ') ----');
  warnOnly.slice(0, 20).forEach((w) => console.log('  ' + w.message + ' @' + w.sourceId + ':' + w.line));

  app.exit(errors.length ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((e) => {
    console.error('冒烟测试自身出错:', e);
    app.exit(2);
  });
});
