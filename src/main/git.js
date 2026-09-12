'use strict';
/**
 * git.js —— 对 git 命令行的薄封装。
 *
 * 设计要点:
 *  1. 只用系统已安装的 git(Windows 用户装 Git for Windows 即可),不内置 git 二进制,
 *     保证安装包体积小。缺失时给出友好提示。
 *  2. 输出通过临时文件回传。这样既不依赖管道,也能正确处理几十万行的 status 输出,
 *     同时避免 Node 默认 pipe 在某些受限环境里 EPERM 的问题。
 *  3. 每次调用都强制禁用交互式提示(GIT_TERMINAL_PROMPT=0 / GIT_ASKPASS),
 *     否则凭据缺失时 git 会挂在那里等输入,界面就会"假死"。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';

/** 常见 git 安装位置,保证即使用户没把 git 加进 PATH 也能找到 */
const WIN_CANDIDATES = [
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'cmd', 'git.exe'),
  path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'bin', 'git.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'GitHubDesktop', 'app-*', 'resources', 'app', 'git', 'cmd', 'git.exe'),
];

let gitPathCache = null;
let gitVersionCache = null;

/** 定位 git.exe */
function findGit() {
  if (gitPathCache) return gitPathCache;
  for (const p of WIN_CANDIDATES) {
    if (p.includes('*')) continue;
    try {
      if (fs.existsSync(p)) {
        gitPathCache = p;
        return p;
      }
    } catch (_) { /* ignore */ }
  }
  // 回退到 PATH
  gitPathCache = IS_WIN ? 'git.exe' : 'git';
  return gitPathCache;
}

/** 非交互环境变量。注意: 不整体替换 process.env,只覆盖/删除必要的几项。 */
function gitEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  // 绝不弹出凭据输入框,也不允许 git 读终端
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_ASKPASS = IS_WIN ? 'echo' : 'true';
  env.GIT_PAGER = 'cat';
  env.GIT_EDITOR = 'true';
  env.GIT_CONFIG_NOSYSTEM = '0';
  // 关闭任何可能出现的 GPG 签名交互
  env.GIT_COMMITTER_NAME = env.GIT_COMMITTER_NAME || '';
  delete env.GIT_COMMITTER_NAME;
  delete env.GIT_COMMITTER_EMAIL;
  // 强制用 Windows 证书存储做校验。有些机器 ~/.gitconfig 里指向了
  // 已卸载软件留下的 ca-bundle 路径,会导致所有 HTTPS 操作 SSL 报错。
  env.GIT_SSL_BACKEND = env.GIT_SSL_BACKEND || (IS_WIN ? 'schannel' : '');
  // 中文输出,便于直接展示给用户
  env.LC_ALL = 'zh_CN.UTF-8';
  return env;
}

let tmpSeq = 0;
function tmpOutFile() {
  tmpSeq += 1;
  return path.join(os.tmpdir(), `gpe-${process.pid}-${Date.now()}-${tmpSeq}.log`);
}

/**
 * 每次 git 调用都会带的"网络健壮性"参数。这是解决国内网络连不上 GitHub 的
 * 关键一步:
 *
 *   1. 代理 —— 自动探测到的代理注入进来。很多用户其实已经开着代理工具
 *      (Clash / V2Ray 等),只是 git 不会自动使用它,于是出现
 *      "浏览器能上 GitHub,git push 就是连不上"。
 *   2. http.version=HTTP/1.1 —— HTTP/2 在部分代理/网络下会握手失败或被重置,
 *      退回 1.1 能明显提升成功率(大仓库推送尤其明显)。
 *   3. postBuffer 加大 —— 默认 1MB,推大文件容易中途断掉。
 */
let netArgsCache = null;
let netArgsTime = 0;

function networkArgs(opts) {
  opts = opts || {};
  const now = Date.now();
  if (!opts.force && netArgsCache && now - netArgsTime < 30000) return netArgsCache;

  const out = ['-c', 'http.version=HTTP/1.1', '-c', 'http.postBuffer=524288000'];
  try {
    const net = require('./net');
    const p = net.resolve({ gitPath: findGit() });
    if (p && p.proxy) {
      out.push('-c', `http.proxy=${p.proxy}`, '-c', `https.proxy=${p.proxy}`);
    }
  } catch (_) { /* net.js 不可用时退化为直连 */ }
  netArgsCache = out;
  netArgsTime = now;
  return out;
}

/** 让网络参数缓存失效(用户改了代理设置时调用) */
function invalidateNetworkArgs() {
  netArgsCache = null;
  netArgsTime = 0;
  try { require('./net').invalidate(); } catch (_) {}
}

/** 这些子命令要联网,需要带上代理等网络参数 */
const NET_SUBCOMMANDS = new Set(['fetch', 'pull', 'push', 'clone', 'ls-remote', 'remote']);

/**
 * 给联网命令自动补上网络参数。
 * 保留原有参数顺序,并避免重复注入代理(调用方可能已经显式指定)。
 */
function withNetworkArgs(args) {
  const first = args.find((a) => !a.startsWith('-') && !a.includes('='));
  if (!first || !NET_SUBCOMMANDS.has(first)) return args;
  if (args.some((a) => /^(https?\.proxy)=/.test(a))) return args;
  return networkArgs().concat(args);
}

/**
 * 同步执行 git,返回 { code, stdout, stderr }。
 * 输出经临时文件回传,因此不受管道限制,也不会有缓冲区上限问题。
 */
function gitSync(args, opts) {
  opts = opts || {};
  const outFile = tmpOutFile();
  const errFile = tmpOutFile();
  let outFd = null;
  let errFd = null;
  try {
    outFd = fs.openSync(outFile, 'w');
    errFd = fs.openSync(errFile, 'w');
    const { spawnSync } = require('child_process');
    const r = spawnSync(findGit(), withNetworkArgs(args), {
      cwd: opts.cwd || undefined,
      env: gitEnv(opts.env),
      input: opts.input,
      stdio: [opts.input != null ? 'pipe' : 'ignore', outFd, errFd],
      windowsHide: true,
      timeout: opts.timeout || 120000,
      maxBuffer: 1024 * 1024 * 64,
    });
    const stdout = safeRead(outFile);
    const stderr = safeRead(errFile);
    if (r.error) {
      return { code: -1, stdout, stderr: stderr || String(r.error.message || r.error) };
    }
    return { code: r.status == null ? -1 : r.status, stdout, stderr };
  } finally {
    if (outFd != null) try { fs.closeSync(outFd); } catch (_) {}
    if (errFd != null) try { fs.closeSync(errFd); } catch (_) {}
    try { fs.unlinkSync(outFile); } catch (_) {}
    try { fs.unlinkSync(errFile); } catch (_) {}
  }
}

/** 异步执行 git(长任务用),返回 { code, stdout, stderr } */
function gitAsync(args, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const outFile = tmpOutFile();
    const errFile = tmpOutFile();
    let outFd, errFd;
    try {
      outFd = fs.openSync(outFile, 'w');
      errFd = fs.openSync(errFile, 'w');
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: '无法创建临时文件: ' + e.message });
    }
    let child;
    try {
      child = spawn(findGit(), withNetworkArgs(args), {
        cwd: opts.cwd || undefined,
        env: gitEnv(opts.env),
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
      });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: '无法启动 git: ' + e.message });
    }

    let settled = false;
    const finish = (code, extraErr) => {
      if (settled) return;
      settled = true;
      try { fs.closeSync(outFd); } catch (_) {}
      try { fs.closeSync(errFd); } catch (_) {}
      const stdout = safeRead(outFile);
      const stderr = safeRead(errFile) || extraErr || '';
      try { fs.unlinkSync(outFile); } catch (_) {}
      try { fs.unlinkSync(errFile); } catch (_) {}
      resolve({ code, stdout, stderr });
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish(-1, '操作超时(超过 ' + Math.round((opts.timeout || 600000) / 1000) + ' 秒),已中止。');
    }, opts.timeout || 600000);

    child.on('error', (e) => {
      clearTimeout(timer);
      finish(-1, e.code === 'ENOENT'
        ? '找不到 git 命令,请先安装 Git for Windows。'
        : String(e.message || e));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code == null ? -1 : code);
    });
  });
}

function safeRead(file) {
  try {
    const buf = fs.readFileSync(file);
    if (!buf.length) return '';
    let s = buf.toString('utf8');
    // git 在 Windows 上偶尔输出 GBK,严格解码失败时退回 GBK 转换
    if (s.includes('\uFFFD')) {
      try {
        s = new TextDecoder('gbk', { fatal: false }).decode(buf);
      } catch (_) { /* 保留 utf8 结果 */ }
    }
    return s;
  } catch (_) {
    return '';
  }
}

/** git 是否可用 */
function detect() {
  if (gitVersionCache) return gitVersionCache;
  const r = gitSync(['--version'], { timeout: 8000 });
  if (r.code === 0 && /git version/i.test(r.stdout)) {
    gitVersionCache = {
      available: true,
      path: findGit(),
      version: r.stdout.trim().replace(/^git version\s*/i, ''),
    };
    return gitVersionCache;
  }
  // PATH 里没有,再暴力试一次常见位置
  for (const p of WIN_CANDIDATES) {
    try {
      if (!p.includes('*') && fs.existsSync(p)) {
        gitPathCache = p;
        const r2 = gitSync(['--version'], { timeout: 8000 });
        if (r2.code === 0) {
          gitVersionCache = {
            available: true,
            path: p,
            version: r2.stdout.trim().replace(/^git version\s*/i, ''),
          };
          return gitVersionCache;
        }
      }
    } catch (_) { /* ignore */ }
  }
  gitVersionCache = {
    available: false,
    path: null,
    version: null,
    error: (r.stderr || r.stdout || '').trim() || '未检测到 git',
  };
  return gitVersionCache;
}

function requireGit() {
  const d = detect();
  if (!d.available) {
    const err = new Error(
      '没有找到 Git。请先安装 "Git for Windows"(https://git-scm.com/download/win),装好后重启本程序即可。'
    );
    err.code = 'GIT_MISSING';
    throw err;
  }
  return d;
}

/** 统一的失败抛出,把 git 的英文报错留在 message 里方便排查 */
function pick(a, b) {
  return (a && a.trim()) || (b && b.trim()) || '';
}
function fail(action, r) {
  const msg = pick(r.stderr, r.stdout) || `退出码 ${r.code}`;
  const err = new Error(`${action}失败: ${msg}`);
  err.raw = { stderr: r.stderr, stdout: r.stdout, code: r.code };
  throw err;
}

/* ------------------------------------------------------------------ 仓库操作 */

function isRepo(dir) {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch (_) {
    return false;
  }
}

/** 列出所有父目录里是否存在 .git(用于提示"你选的是子目录,真仓库在上面") */
function findParentRepo(dir) {
  let cur = path.resolve(dir);
  const parent = path.dirname(cur);
  for (let i = 0; i < 6 && parent && parent !== cur; i++) {
    if (isRepo(cur)) return cur;
    cur = parent;
    if (path.dirname(cur) === cur) break;
    if (isRepo(cur)) return cur;
  }
  return null;
}

async function init(dir) {
  requireGit();
  const r = await gitAsync(['init'], { cwd: dir, timeout: 30000 });
  if (r.code !== 0) fail('初始化仓库', r);
  return true;
}

/**
 * 确保 .gitignore 存在。projectKind 用于挑选模板:
 * node / python / java / unity / generic
 */
async function ensureGitignore(dir, projectKind) {
  const file = path.join(dir, '.gitignore');
  if (fs.existsSync(file)) return { created: false, path: file };
  const tpl = GITIGNORE_TEMPLATES[projectKind] || GITIGNORE_TEMPLATES.generic;
  await fsp.writeFile(file, tpl, 'utf8');
  return { created: true, path: file };
}

const GITIGNORE_TEMPLATES = {
  node: `# 依赖与构建产物(不要上传,体积大且能重新生成)
node_modules/
dist/
build/
out/
.next/
.cache/
*.tsbuildinfo

# 日志
*.log
npm-debug.log*
yarn-error.log*

# 环境变量/密钥(绝对不要上传)
.env
.env.*
!.env.example

# 编辑器与系统文件
.vscode/*
!.vscode/extensions.json
.idea/
.DS_Store
Thumbs.db
desktop.ini
`,
  python: `__pycache__/
*.py[cod]
*.egg-info/
.eggs/
build/
dist/
.venv/
venv/
env/
.pytest_cache/
.mypy_cache/
.ipynb_checkpoints/

.env
.env.*
!.env.example

.DS_Store
Thumbs.db
.idea/
.vscode/
`,
  java: `target/
build/
out/
*.class
*.jar
!.mvn/wrapper/maven-wrapper.jar
.gradle/
.idea/
*.iml
.DS_Store
Thumbs.db
`,
  unity: `[Ll]ibrary/
[Tt]emp/
[Oo]bj/
[Bb]uild/
[Bb]uilds/
[Ll]ogs/
[Uu]ser[Ss]ettings/
*.csproj
*.sln
*.user
.DS_Store
Thumbs.db
`,
  generic: `# 依赖与构建产物
node_modules/
dist/
build/
out/
target/
__pycache__/
.venv/
venv/

# 日志
*.log

# 环境变量/密钥
.env
.env.*
!.env.example

# 编辑器与系统文件
.idea/
.vscode/
.DS_Store
Thumbs.db
desktop.ini
`,
};

/** 当前分支名;空仓库(无提交)时返回 init.defaultBranch 或 main */
async function currentBranch(dir) {
  let r = await gitAsync(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: dir });
  if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  r = await gitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  const name = r.stdout.trim();
  if (name && name !== 'HEAD') return name;
  return 'main';
}

async function hasCommits(dir) {
  const r = await gitAsync(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: dir });
  return r.code === 0;
}

async function remotes(dir) {
  const r = await gitAsync(['remote', '-v'], { cwd: dir });
  if (r.code !== 0) return [];
  const map = new Map();
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!m) continue;
    const [, name, url, kind] = m;
    if (!map.has(name)) map.set(name, { name, fetch: '', push: '' });
    map.get(name)[kind] = url;
  }
  return Array.from(map.values());
}

function normalizeUrl(url) {
  if (!url) return '';
  let u = url.trim();
  // 去掉可能内嵌的凭据,避免泄漏到界面
  u = u.replace(/^(https?:\/\/)[^@/]*@/i, '$1');
  return u;
}

async function remoteUrl(dir, name) {
  const r = await gitAsync(['remote', 'get-url', name || 'origin'], { cwd: dir });
  return r.code === 0 ? r.stdout.trim() : '';
}

async function addRemote(dir, name, url) {
  const existing = await remotes(dir);
  if (existing.some((x) => x.name === name)) {
    const r = await gitAsync(['remote', 'set-url', name, url], { cwd: dir });
    if (r.code !== 0) fail('设置远程地址', r);
  } else {
    const r = await gitAsync(['remote', 'add', name, url], { cwd: dir });
    if (r.code !== 0) fail('添加远程地址', r);
  }
  return true;
}

async function removeRemote(dir, name) {
  await gitAsync(['remote', 'remove', name], { cwd: dir });
  return true;
}

async function configGet(dir, key) {
  const r = await gitAsync(['config', '--get', key], { cwd: dir });
  return r.code === 0 ? r.stdout.trim() : '';
}

async function configSet(dir, key, value) {
  const scope = isRepo(dir) ? ['--local'] : ['--global'];
  const r = await gitAsync(['config', ...scope, key, value], { cwd: dir });
  if (r.code !== 0) fail('写入配置 ' + key, r);
  return true;
}

/**
 * git status 的机器可读解析。用 -z 结尾的 NUL 分隔,避免文件名里的
 * 空格/中文/换行造成解析错乱(这是很多简易工具出 bug 的地方)。
 */
async function status(dir) {
  requireGit();
  const r = await gitAsync(
    ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z',
     '--untracked-files=all', '--ignored=no'],
    { cwd: dir, timeout: 180000 }
  );
  if (r.code !== 0) fail('读取文件状态', r);

  const raw = r.stdout;
  const files = [];
  let i = 0;
  while (i < raw.length) {
    // 每条记录: XY<space>path\0   (重命名/复制时后面再跟一个 \0 分隔的 origPath)
    const xy = raw.slice(i, i + 2);
    if (xy.length < 2) break;
    i += 3; // 跳过 "XY "
    let end = raw.indexOf('\0', i);
    if (end === -1) end = raw.length;
    const file = raw.slice(i, end);
    i = end + 1;
    const x = xy[0];
    const y = xy[1];
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      // 紧跟一个 origPath
      const e2 = raw.indexOf('\0', i);
      i = (e2 === -1 ? raw.length : e2 + 1);
    }
    if (!file) continue;
    files.push({ path: file, x, y, state: describeState(x, y) });
  }
  return files;
}

function describeState(x, y) {
  if (x === '?' && y === '?') return 'untracked';
  if (x === '!' && y === '!') return 'ignored';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (x === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'R') return 'renamed';
  if (x === 'M' || y === 'M') return 'modified';
  return 'changed';
}

/** 让指定文件进入暂存区(内部用 `git add -A -- <paths>`) */
async function stage(dir, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  if (list.length === 0) return true;
  // 分批,避免命令行过长(Windows 上限约 32k 字符)
  const BATCH = 200;
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    const r = await gitAsync(['add', '-A', '--', ...chunk], { cwd: dir, timeout: 180000 });
    if (r.code !== 0) fail('暂存文件', r);
  }
  return true;
}

async function unstage(dir, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  if (list.length === 0) return true;
  const hasHead = await hasCommits(dir);
  const args = hasHead
    ? ['reset', '-q', 'HEAD', '--', ...list.slice(0, 200)]
    : ['rm', '--cached', '-r', '-q', '--', ...list.slice(0, 200)];
  const r = await gitAsync(args, { cwd: dir, timeout: 60000 });
  if (r.code !== 0) fail('取消暂存', r);
  return true;
}

/** 通过 stdin 传提交信息,避免中文/特殊字符在命令行上被转义坏掉 */
function commit(dir, message, author) {
  return new Promise((resolve, reject) => {
    const outFile = tmpOutFile();
    const errFile = tmpOutFile();
    const outFd = fs.openSync(outFile, 'w');
    const errFd = fs.openSync(errFile, 'w');
    const args = ['commit', '--file=-', '--cleanup=strip'];
    const env = gitEnv();
    if (author && author.name) {
      env.GIT_AUTHOR_NAME = author.name;
      env.GIT_COMMITTER_NAME = author.name;
    }
    if (author && author.email) {
      env.GIT_AUTHOR_EMAIL = author.email;
      env.GIT_COMMITTER_EMAIL = author.email;
    }
    const child = spawn(findGit(), withNetworkArgs(args), {
      cwd: dir,
      env,
      stdio: ['pipe', outFd, errFd],
      windowsHide: true,
    });
    child.on('error', (e) => {
      try { fs.closeSync(outFd); fs.closeSync(errFd); } catch (_) {}
      reject(new Error('无法启动 git: ' + e.message));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(message, 'utf8');
    child.on('close', (code) => {
      try { fs.closeSync(outFd); fs.closeSync(errFd); } catch (_) {}
      const stdout = safeRead(outFile);
      const stderr = safeRead(errFile);
      try { fs.unlinkSync(outFile); fs.unlinkSync(errFile); } catch (_) {}
      if (code === 0) return resolve({ stdout, stderr });
      const err = new Error('提交失败: ' + (pick(stderr, stdout) || `退出码 ${code}`));
      err.raw = { stdout, stderr, code };
      reject(err);
    });
  });
}

async function log(dir, limit) {
  const n = limit || 20;
  const fmt = '%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e';
  const r = await gitAsync(
    ['log', `-${n}`, `--pretty=format:${fmt}`],
    { cwd: dir, timeout: 30000 }
  );
  if (r.code !== 0) return [];
  return r.stdout
    .split('\x1e')
    .map((s) => s.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((rec) => {
      const [hash, short, author, date, subject] = rec.split('\x1f');
      return { hash, short, author, date, subject };
    });
}

async function branches(dir) {
  const r = await gitAsync(
    ['for-each-ref', '--format=%(refname:short)\x1f%(objectname:short)\x1f%(upstream:short)\x1f%(HEAD)', 'refs/heads'],
    { cwd: dir, timeout: 30000 }
  );
  if (r.code !== 0) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, short, upstream, head] = line.split('\x1f');
    return { name, short, upstream: upstream || '', current: head === '*' };
  });
}

/** 每次上传前刷新远程信息。authArgs 里可携带一次性的临时凭据注入。 */
async function fetch(dir, remote, opts) {
  requireGit();
  opts = opts || {};
  const args = [...(opts.extraArgs || []), 'fetch', '--prune', '--no-tags', remote || 'origin'];
  if (opts.refspec) args.push(opts.refspec);
  const r = await gitAsync(args, { cwd: dir, timeout: 300000 });
  if (r.code !== 0) fail('连接远程仓库', r);
  return true;
}

/** 本地分支与上游的领先/落后关系 */
async function aheadBehind(dir, branch, upstream) {
  const up = upstream || `${'origin'}/${branch}`;
  const verify = await gitAsync(['rev-parse', '--verify', '--quiet', up], { cwd: dir });
  if (verify.code !== 0) {
    return { hasUpstream: false, ahead: 0, behind: 0, upstream: up };
  }
  const r = await gitAsync(
    ['rev-list', '--left-right', '--count', `${up}...HEAD`],
    { cwd: dir, timeout: 60000 }
  );
  if (r.code !== 0) return { hasUpstream: false, ahead: 0, behind: 0, upstream: up };
  const [behind, ahead] = r.stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
  return { hasUpstream: true, ahead, behind, upstream: up };
}

async function fileAtRef(dir, ref, file) {
  const r = await gitAsync(['show', `${ref}:${file}`], { cwd: dir, timeout: 60000 });
  return r.code === 0 ? r.stdout : null;
}

async function readWorktreeFile(dir, file) {
  try {
    return await fsp.readFile(path.join(dir, file), 'utf8');
  } catch (_) {
    return null;
  }
}

/** 把本地分支快进到上游(仅在落后且没有本地改动时可安全使用) */
async function fastForward(dir, remote, branch, opts) {
  opts = opts || {};
  const r = await gitAsync(
    [...(opts.extraArgs || []), 'merge', '--ff-only', `${remote}/${branch}`],
    { cwd: dir, timeout: 180000 }
  );
  if (r.code !== 0) fail('同步远程更新', r);
  return true;
}

/**
 * 拉取远程并合并。合并策略:
 *   merge   —— 生成一个合并提交(保真,但历史会有分叉)
 *   rebase  —— 把本地提交挪到远程之后(历史干净,推荐给小白)
 *
 * 实现上刻意拆成 fetch + merge 两步(而不是 `git pull`):
 * fetch 只更新 refs/remotes/<remote>/<branch>,即使之后合并失败,
 * 远程跟踪分支也已经是最新的,界面上的"落后 N 个提交"才是准的。
 * 任何失败都会 abort,保证仓库停在干净状态,再由上层引导改用新建分支。
 */
async function syncDown(dir, remote, branch, strategy, opts) {
  requireGit();
  opts = opts || {};
  const extra = opts.extraArgs || [];

  const fr = await gitAsync(
    [...extra, 'fetch', '--prune', '--no-tags', remote,
     `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
    { cwd: dir, timeout: 300000 }
  );
  if (fr.code !== 0) fail('拉取远程更新', fr);

  const mergeArgs = strategy === 'rebase'
    ? [...extra, 'rebase', `${remote}/${branch}`]
    : [...extra, 'merge', '--no-edit', `${remote}/${branch}`];
  const r = await gitAsync(mergeArgs, { cwd: dir, timeout: 300000 });

  if (r.code !== 0) {
    const msg = pick(r.stderr, r.stdout);
    await abortInProgress(dir);
    if (/conflict|冲突|could not apply|needs merge/i.test(msg)) {
      const err = new Error(
        '同步时发生冲突(同一个文件的同一处被两边都改了),已自动取消本次同步、仓库保持原样。' +
        '建议改用「新建分支上传」,这样不会动到主干。'
      );
      err.code = 'MERGE_CONFLICT';
      err.raw = { stdout: r.stdout, stderr: r.stderr, code: r.code };
      throw err;
    }
    fail('同步远程更新', r);
  }
  return true;
}

async function abortInProgress(dir) {
  await gitAsync(['rebase', '--abort'], { cwd: dir, timeout: 30000 });
  await gitAsync(['merge', '--abort'], { cwd: dir, timeout: 30000 });
  await gitAsync(['cherry-pick', '--abort'], { cwd: dir, timeout: 30000 });
  return true;
}

/** 当前是否处于合并/rebase 中途 */
async function inProgress(dir) {
  const gitDir = path.join(dir, '.git');
  const checks = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD'];
  const found = [];
  for (const c of checks) {
    try {
      if (fs.existsSync(path.join(gitDir, c))) found.push(c);
    } catch (_) {}
  }
  return found;
}

async function switchBranch(dir, name, create) {
  const args = create ? ['switch', '-c', name] : ['switch', name];
  let r = await gitAsync(args, { cwd: dir, timeout: 60000 });
  if (r.code !== 0 && create) {
    // 老版本 git 没有 switch
    r = await gitAsync(['checkout', '-b', name], { cwd: dir, timeout: 60000 });
  }
  if (r.code !== 0) fail(create ? '新建分支' : '切换分支', r);
  return true;
}

async function setUpstream(dir, branch, remote, remoteBranch) {
  const r = await gitAsync(
    ['branch', `--set-upstream-to=${remote}/${remoteBranch}`, branch],
    { cwd: dir, timeout: 30000 }
  );
  return r.code === 0;
}

/**
 * 推送。
 *
 * 凭据注入方式(这是本工具最需要小心的一处):
 *   把 https 地址改写为 https://<user>:<token>@github.com/... 再交给 git。
 *   令牌只存在于这一次进程的命令行参数里,不会被写进 .git/config,
 *   也不会被 `git remote get-url` 看到。为了双保险,命令结束后我们会
 *   把令牌从所有回传文本里抹掉(见 redact)。
 *
 * onProgress 会拿到 git 写入 stderr 的进度行(以 \r 刷新),
 * 因为输出重定向到了文件,所以改成按固定节奏读文件增量上报。
 */
function push(dir, remote, branch, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const outFile = tmpOutFile();
    const errFile = tmpOutFile();
    const outFd = fs.openSync(outFile, 'w');
    const errFd = fs.openSync(errFile, 'w');

    const pushUrl = opts.authUrl || remote;
    const args = ['push'];
    if (opts.setUpstream) args.push('--set-upstream');
    if (opts.force) args.push('--force-with-lease');
    args.push(pushUrl, branch);
    if (opts.remoteBranch && opts.remoteBranch !== branch) {
      args.push(`refs/heads/${branch}:refs/heads/${opts.remoteBranch}`);
    }
    if (opts.tags) args.push('--tags');

    let child;
    try {
      child = spawn(findGit(), withNetworkArgs(args), {
        cwd: dir,
        env: gitEnv(),
        // stdin 给 /dev/null,防止 git 试图弹出凭据对话框
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
      });
    } catch (e) {
      return reject(new Error('无法启动 git: ' + e.message));
    }

    let reported = '';
    const tick = setInterval(() => {
      if (typeof opts.onProgress !== 'function') return;
      const cur = safeRead(errFile);
      if (cur.length > reported.length) {
        const delta = cur.slice(reported.length);
        reported = cur;
        const lines = delta.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
        if (lines.length) opts.onProgress(lines[lines.length - 1]);
      }
    }, 350);

    const finish = (code, extra) => {
      clearInterval(tick);
      try { fs.closeSync(outFd); fs.closeSync(errFd); } catch (_) {}
      const stdout = redact(safeRead(outFile));
      const stderr = redact(safeRead(errFile) || extra || '');
      try { fs.unlinkSync(outFile); fs.unlinkSync(errFile); } catch (_) {}
      if (code === 0) {
        // 推送成功后顺手把上游设成"逻辑远程名",后续推送不用再带地址
        if (opts.setUpstream && opts.upstreamRemote) {
          setUpstream(dir, branch, opts.upstreamRemote, opts.remoteBranch || branch).catch(() => {});
        }
        return resolve({ stdout, stderr });
      }
      const msg = pick(stderr, stdout) || `退出码 ${code}`;
      const err = new Error(friendlyPushError(msg));
      err.raw = { stdout, stderr, code };
      err.friendly = friendlyPushError(msg);
      reject(err);
    };

    child.on('error', (e) => finish(-1, String(e.message || e)));
    child.on('close', (code) => finish(code == null ? -1 : code));
  });
}

/** 把任何文本里的密码/token 抹掉 */
function redact(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(/(https?:\/\/)[^@\s/]+@/gi, '$1***@');
  s = s.replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})/g, '***');
  s = s.replace(/\b(github_pat_[A-Za-z0-9_]{20,})/g, '***');
  return s;
}

/** 把 git 的英文报错翻译成小白能看懂的话 */
function friendlyPushError(msg) {
  const m = String(msg);
  if (/Authentication failed|could not read Username|terminal prompts disabled|Invalid username or password|403/i.test(m)) {
    return '推送被拒绝:GitHub 认为你的登录信息无效或已过期。请在右上角重新登录(建议改用 访问令牌 方式)。';
  }
  if (/non-fast-forward|fetch first|rejected.*behind|Updates were rejected/i.test(m)) {
    return '推送被拒绝:GitHub 上已经有人(或你自己在别的设备上)先提交了新内容,你的本地版本落后了。请点击"先同步再上传",或者选择"新建分支上传"。';
  }
  if (/protected branch|refusing to allow|GH006/i.test(m)) {
    return '推送被拒绝:目标分支是受保护分支(如 main),规则不允许直接推送。请改用"新建分支上传",然后到 GitHub 上发起 Pull Request。';
  }
  if (/remote: Repository not found|404/i.test(m)) {
    return '推送失败:远程仓库不存在,或你的账号没有它的写入权限。请确认仓库名和账号是否正确。';
  }
  if (/Could not resolve host|Failed to connect|unable to access|connection timed out|Network is unreachable|Connection reset|Recv failure|Empty reply|early EOF|RPC failed|TLS/i.test(m)) {
    /**
     * 网络类失败最常见,所以提示要能直接推动用户解决问题:
     * 告诉他程序已经试过代理、以及下一步该做什么。
     */
    let proxyHint = '';
    try {
      const p = require('./net').resolve({ gitPath: findGit() });
      proxyHint = p && p.proxy
        ? `当前已在使用代理 ${p.proxy}(${p.label})。如果仍然失败,请确认代理工具本身是通的,或在「设置 → 网络与代理」里换一个地址。`
        : '程序没有检测到可用代理。国内直连 GitHub 经常不稳定 —— 请开启你的代理工具(Clash / V2Ray 等),' +
          '再回到「设置 → 网络与代理」点一下「检测本机代理」,通常就能解决。';
    } catch (_) { /* ignore */ }
    return '网络连接失败:连不上 GitHub。' + proxyHint;
  }
  if (/exceeds GitHub's file size limit|this exceeds GitHub's file size limit|GH001|larger than 100/i.test(m)) {
    return '推送失败:有文件超过 GitHub 的 100MB 单文件上限。请把它加入 .gitignore,或用 Git LFS 管理大文件。';
  }
  if (/SSL|certificate/i.test(m) && /problem|verify|unable/i.test(m)) {
    return '推送失败:SSL 证书校验出错。常见原因是系统里残留了旧的 CA 证书配置,可在设置里点"修复 HTTPS 证书配置"。';
  }
  return '推送失败:' + m.split(/\r?\n/).filter(Boolean).slice(0, 3).join(' ');
}

/**
 * 构造带凭据的 HTTPS 地址。
 *
 * 走 https 时把令牌拼进 URL 是最稳的做法:不依赖 credential helper,
 * 也不受"用户之前配错了 helper"的影响。该地址只在内存里用于单次
 * fetch/push 命令,绝不被写进 .git/config,命令结束后就消失。
 * ssh 地址则原样返回(由用户自己的 SSH key 负责认证)。
 */
function buildAuthUrl(url, cred) {
  const clean = normalizeUrl(url);
  if (!cred || !cred.token) return clean;
  if (/^(git@|ssh:\/\/)/i.test(clean)) return clean;
  try {
    const u = new URL(clean);
    u.username = encodeURIComponent(cred.username || 'x-access-token');
    u.password = encodeURIComponent(cred.token);
    return u.toString();
  } catch (_) {
    return clean;
  }
}

/** 读取局部文件差异(用于"查看变更"的 diff 视图) */
async function diff(dir, file, staged) {
  const args = ['diff', '--no-color', '--no-ext-diff', '--unified=3'];
  if (staged) args.push('--cached');
  if (file) args.push('--', file);
  const r = await gitAsync(args, { cwd: dir, timeout: 60000 });
  if (r.code !== 0) return '';
  return r.stdout;
}

/**
 * 通过 git 的 credential 机制,向本机已配置的凭据助手(Git Credential
 * Manager 等)索取某个地址已经保存的账号密码。
 *
 * 用 `git credential fill` 而不是自己去翻 Windows 凭据管理器,好处是
 * 完全复用用户既有的配置(github.com 可能配了 GCM、store、cache 等多种后端)。
 * 输入走临时文件(stdin 重定向),输出走临时文件,全程不依赖管道。
 */
function credentialFill(input, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const inFile = tmpOutFile();
    const outFile = tmpOutFile();
    const errFile = tmpOutFile();
    try {
      fs.writeFileSync(inFile, input + '\n\n', 'utf8');
    } catch (_) {
      return resolve({ ok: false, reason: '无法创建临时文件' });
    }
    let inFd, outFd, errFd;
    try {
      inFd = fs.openSync(inFile, 'r');
      outFd = fs.openSync(outFile, 'w');
      errFd = fs.openSync(errFile, 'w');
    } catch (_) {
      try { fs.closeSync(inFd); } catch (_) {}
      return resolve({ ok: false, reason: '无法创建临时文件' });
    }

    const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
    let child;
    try {
      child = spawn(findGit(), ['credential', 'fill'], {
        env,
        stdio: [inFd, outFd, errFd],
        windowsHide: true,
      });
    } catch (e) {
      try { fs.closeSync(inFd); fs.closeSync(outFd); fs.closeSync(errFd); } catch (_) {}
      return resolve({ ok: false, reason: '无法启动 git: ' + e.message });
    }

    const done = () => {
      try { fs.closeSync(inFd); fs.closeSync(outFd); fs.closeSync(errFd); } catch (_) {}
      const out = safeRead(outFile);
      const err = safeRead(errFile);
      try { fs.unlinkSync(inFile); fs.unlinkSync(outFile); fs.unlinkSync(errFile); } catch (_) {}
      const cred = {};
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^([a-zA-Z0-9_]+)=(.*)$/);
        if (m) cred[m[1]] = m[2];
      }
      if (cred.password) {
        resolve({
          ok: true,
          protocol: cred.protocol || 'https',
          host: cred.host || 'github.com',
          username: cred.username || '',
          password: cred.password,
        });
      } else {
        resolve({ ok: false, reason: err.trim() || '本机凭据管理器里没有保存 GitHub 账号' });
      }
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      done();
    }, opts.timeout || 20000);

    child.on('error', () => { clearTimeout(timer); done(); });
    child.on('close', () => { clearTimeout(timer); done(); });
  });
}

module.exports = {
  detect,
  findGit,
  invalidateNetworkArgs,
  networkArgs,
  requireGit,
  isRepo,
  findParentRepo,
  init,
  ensureGitignore,
  GITIGNORE_TEMPLATES,
  currentBranch,
  hasCommits,
  remotes,
  remoteUrl,
  addRemote,
  removeRemote,
  configGet,
  configSet,
  status,
  stage,
  unstage,
  commit,
  log,
  branches,
  fetch,
  aheadBehind,
  fileAtRef,
  readWorktreeFile,
  fastForward,
  syncDown,
  abortInProgress,
  inProgress,
  switchBranch,
  setUpstream,
  push,
  diff,
  credentialFill,
  normalizeUrl,
  buildAuthUrl,
  redact,
  gitAsync,
  gitSync,
};
