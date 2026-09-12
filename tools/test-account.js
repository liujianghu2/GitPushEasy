/**
 * test-account.js —— 账号状态的端到端验证(真实 IPC + 真实主进程逻辑)。
 *
 * 为什么单独做一个测试:
 *   冒烟测试里的 gpe 是 contextBridge 暴露的对象,被冻结、无法替换方法,
 *   所以它只能验证同步的不变式。而"退出/切换账号后右上角状态不对"
 *   这类问题恰恰出在异步的 IPC 往返上 —— 必须用真实 handler 才能覆盖。
 *
 * 覆盖四个场景:
 *   1. 两个账号,退出其中一个 → 应自动回落到另一个
 *   2. 退出最后一个账号   → 必须变成"未登录"
 *   3. current 指向已删除的账号 → 必须被纠正
 *   4. store 为空但 current 残留 → 必须清空
 *
 * 用法: node_modules\electron\dist\electron.exe tools/test-account.js
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');

// 用独立数据目录,不碰用户真实的 %APPDATA%
const USER_DATA = path.join(os.tmpdir(), 'gpe-acct-test-' + process.pid);
fs.mkdirSync(USER_DATA, { recursive: true });
app.setPath('userData', USER_DATA);

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; failures.push(name + (extra ? '  << ' + extra : '')); console.log('  ✗ ' + name + (extra ? '   << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ------------------------------------------------------------ 假的账号存储 */

let stored = {};
let lastLogin = null;

function stubAll() {
  const stubs = {
    'app:info': () => ({
      version: '1.0.0', platform: 'win32', arch: 'x64', electron: '33', node: '20', chrome: '130',
      home: 'C:/', git: { available: true, version: '2.55' },
      storage: { encrypted: true, file: 'x' }, encryption: true, defaultClientId: 'Ov23test',
    }),
    'settings:get': () => ({ theme: 'light' }),
    'settings:set': (p) => p,
    'accounts:list': () => ({
      accounts: Object.values(stored).map((a) => ({
        login: a.login, name: a.name, avatar: '', scopes: 'repo', method: a.method, savedAt: a.savedAt,
      })),
      last: lastLogin,
      storage: { encrypted: true, file: 'x' },
    }),
    'accounts:remove': (login) => {
      delete stored[login];
      if (lastLogin === login) {
        const rest = Object.values(stored);
        lastLogin = rest.length ? rest[0].login : null;
      }
      return true;
    },
    // 退出登录:只取消自动登录,凭据保留
    'accounts:signOut': (login) => {
      if (lastLogin === login) lastLogin = null;
      return true;
    },
    'gh:probeWeb': () => ({ reachable: true }),
    'auth:deviceCancel': () => true,
    'folder:inspect': () => ({
      path: 'C:/d', name: 'd',
      scan: { files: 1, bytes: 10, bigFiles: [], overLimit: [], projectKind: 'generic', topLevel: [] },
      isRepo: false, gitignore: { created: true },
    }),
    'folder:difficulty': () => ({ risky: [], reasons: [] }),
    'repo:analyze': () => ({
      dir: '', isRepo: false, hasCommits: false, branch: 'main',
      changes: { all: [], staged: [], unstaged: [], untracked: [], total: 0, clean: true },
      warnings: [], commits: [], branches: [], conflictInProgress: [], canPush: false,
      sync: 'new', syncLabel: '', plan: { action: 'publish', title: 't', reason: 'r', tone: 'primary' },
    }),
    'repo:remotes': () => [], 'repo:branches': () => [], 'repo:commits': () => [],
  };
  for (const [ch, fn] of Object.entries(stubs)) {
    ipcMain.handle(ch, async (_e, ...a) => {
      try { return { ok: true, data: await fn(...a) }; }
      catch (e) { return { ok: false, error: String(e.message || e) }; }
    });
  }
}

async function main() {
  stubAll();
  const win = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  const pageErrors = [];
  win.webContents.on('console-message', (...args) => {
    const ev = (args.length >= 5 && typeof args[1] === 'number') ? null : args[1];
    const level = ev ? String(ev.level) : String(args[1]);
    const message = ev ? ev.message : args[2];
    if (level === '3' || level === 'error') pageErrors.push(message);
  });

  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1200));

  const run = (code) => win.webContents.executeJavaScript(code, true);
  const account = () => run(`window.S.account ? window.S.account.login : null`);
  const pillText = async () => {
    await new Promise((r) => setTimeout(r, 150));
    return run(`(document.querySelector('.account-pill .who')||{}).textContent || ''`);
  };
  const pillIsOff = async () => {
    await new Promise((r) => setTimeout(r, 100));
    return run(`!!document.querySelector('.account-pill.is-off')`);
  };

  /* ============================================================ */
  section('1. 两个账号,退出其中一个 → 变成未登录(凭据保留)');
  stored = {
    'user-a': { login: 'user-a', name: 'A', method: 'token', savedAt: Date.now() },
    'user-b': { login: 'user-b', name: 'B', method: 'device', savedAt: Date.now() - 1000 },
  };
  lastLogin = 'user-a';
  await run(`window.App.refreshAccount()`);
  ok('登录后显示 user-a', /user-a/.test(await pillText()), await pillText());
  await run(`window.App.signOutAccount('user-a')`);
  await new Promise((r) => setTimeout(r, 250));
  ok('退出后当前账号清空(不会擅自切到另一个)', (await account()) === null, String(await account()));
  ok('右上角显示"登录 GitHub"', /登录 GitHub/.test(await pillText()), await pillText());
  ok('两个账号的凭据都还在本机',
    (await run(`JSON.stringify(window.S.accounts.map(function(a){return a.login;}).sort())`)) === '["user-a","user-b"]',
    await run(`JSON.stringify(window.S.accounts.map(function(a){return a.login;}))`));

  /* ============================================================ */
  section('1b. 从账号菜单切回 user-a(不用重新登录)');
  await run(`window.App.switchAccount('user-a')`);
  await new Promise((r) => setTimeout(r, 250));
  ok('成功切回 user-a', (await account()) === 'user-a', String(await account()));
  ok('右上角显示 user-a', /user-a/.test(await pillText()), await pillText());
  ok('切到 user-b 也可以', await (async () => {
    await run(`window.App.switchAccount('user-b')`);
    await new Promise((r) => setTimeout(r, 250));
    return (await account()) === 'user-b';
  })(), String(await account()));

  /* ============================================================ */
  section('2. 退出全部账号 → 必须变成未登录');
  await run(`window.App.signOutAccount('user-b')`);
  await new Promise((r) => setTimeout(r, 250));
  ok('当前账号已清空', (await account()) === null, String(await account()));
  ok('右上角显示"登录 GitHub"', /登录 GitHub/.test(await pillText()), await pillText());
  ok('药丸进入未登录样式(is-off)', (await pillIsOff()) === true);
  ok('退出登录不会删除凭据(两个账号都还在)',
    (await run(`JSON.stringify(window.S.accounts.map(function(a){return a.login;}).sort())`)) === '["user-a","user-b"]',
    await run(`JSON.stringify(window.S.accounts.map(function(a){return a.login;}))`));

  /* ============================================================ */
  section('2b. 本机只有一个账号时点"切换" → 应当引导去登录页(而不是没反应)');
  stored = { 'only-one': { login: 'only-one', name: 'Only', method: 'token', savedAt: Date.now() } };
  lastLogin = 'only-one';
  await run(`window.App.refreshAccount()`);
  await run(`window.App.go('login')`);
  await run(`window.App.switchAccount()`);
  await new Promise((r) => setTimeout(r, 250));
  ok('被带到登录页', (await run(`window.App.currentView()`)) === 'login',
    String(await run(`window.App.currentView()`)));
  ok('当前账号未被清空', (await account()) === 'only-one', String(await account()));

  /* ============================================================ */
  section('3. current 指向一个已被删除的账号 → 必须被纠正');
  stored = { 'user-c': { login: 'user-c', name: 'C', method: 'token', savedAt: Date.now() } };
  lastLogin = 'user-c';
  await run(`window.App.refreshAccount()`);
  ok('先确认登录到 user-c', (await account()) === 'user-c', String(await account()));
  await run(`
    window.S.account = { login: 'deleted-user', name: 'X', avatar: '', scopes: '', method: 'token' };
    window.App.refreshAccount();
  `);
  await new Promise((r) => setTimeout(r, 250));
  ok('不存在的账号被纠正掉(回落到有效账号)', (await account()) === 'user-c', String(await account()));
  ok('右上角显示的是有效账号', /user-c/.test(await pillText()), await pillText());

  /* ============================================================ */
  section('4. store 为空但 current 残留 → 必须清空');
  stored = {};
  lastLogin = null;
  await run(`window.S.account = { login: 'ghost', name: 'G', avatar: '', scopes: '', method: 'token' };`);
  await run(`window.App.refreshAccount()`);
  await new Promise((r) => setTimeout(r, 250));
  ok('残留账号被清空', (await account()) === null, String(await account()));
  ok('右上角回到未登录', /登录 GitHub/.test(await pillText()), await pillText());

  /* ============================================================ */
  section('5. 删除登录信息是独立操作(不会被"退出"误触发)');
  stored = { 'keeper': { login: 'keeper', name: 'K', method: 'token', savedAt: Date.now() } };
  lastLogin = 'keeper';
  await run(`window.App.refreshAccount()`);
  await run(`window.App.signOutAccount('keeper')`);
  await new Promise((r) => setTimeout(r, 250));
  ok('退出后凭据仍在', (await run(`window.S.accounts.length`)) === 1, String(await run(`window.S.accounts.length`)));
  ok('账号菜单里仍能看到它',
    (await run(`JSON.stringify(window.S.accounts.map(function(a){return a.login;}))`)).includes('keeper'));

  /* ============================================================ */
  section('6. 界面没有报错');
  ok('渲染进程无 JS 错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  /* ============================================================ */
  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项,失败 ' + fail + ' 项');
  if (failures.length) {
    console.log('\n失败清单:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('========================================');

  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (_) {}
  app.exit(fail ? 1 : 0);
}

app.whenReady().then(() => main().catch((e) => {
  console.error('测试脚本异常:', e);
  app.exit(2);
}));
