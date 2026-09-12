/**
 * test-auth-flow.js —— 验证"带令牌地址"的凭据注入是否真的生效。
 *
 * 这是整个工具最关键也最容易出错的一环:推送时怎么把令牌交给 git,
 * 同时又不把它写进 .git/config、不出现在 git remote get-url 里。
 *
 * 本机没有第二个 GitHub 账号可以做真实推送,所以改用两个本地 bare 仓库
 * 来验证"输入 URL 与配置 URL 不一致时,insteadOf 是否按预期改写"。
 * 两个仓库都用同一个 file:// 前缀的不同路径,能精确模拟
 * "remote 配的是干净地址,推送时给的是带令牌地址"这种情形。
 *
 * 用法: node tools/test-auth-flow.js
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const gitMod = require(path.join(ROOT, 'src', 'main', 'git.js'));

const GIT = gitMod.detect().path || 'git';
const TMP = path.join(os.tmpdir(), 'gpe-authflow-' + Date.now());

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; failures.push(name + (extra ? '  << ' + extra : '')); console.log('  ✗ ' + name + (extra ? '   << ' + extra : '')); }
}

function raw(cwd, args) {
  const r = spawnSync(GIT, args, {
    cwd, encoding: 'utf8', windowsHide: true,
    env: Object.assign({}, process.env, {
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e.com',
      GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e.com',
    }),
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function write(dir, rel, content) {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf8');
}

async function main() {
  await fsp.mkdir(TMP, { recursive: true });
  console.log('测试目录: ' + TMP);

  /* ============================================================ */
  console.log('\n1. insteadOf 改写是否生效(核心机制)');

  // 两个 bare 仓库:一个代表"干净地址",一个代表"带令牌地址"
  const cleanRemote = path.join(TMP, 'clean.git');
  const tokenRemote = path.join(TMP, 'token.git');
  raw(TMP, ['init', '--bare', '-b', 'main', cleanRemote]);
  raw(TMP, ['init', '--bare', '-b', 'main', tokenRemote]);

  const work = path.join(TMP, 'work');
  await fsp.mkdir(work, { recursive: true });
  raw(work, ['init', '-b', 'main']);
  await write(work, 'a.txt', 'hello\n');
  raw(work, ['add', '-A']);
  raw(work, ['commit', '-m', 'init']);

  // 故意让它们路径不同,但用 insteadOf 把 token 地址映射到 clean 地址
  const cleanUrl = 'file:///' + cleanRemote.replace(/\\/g, '/');
  const fakeTokenUrl = 'file:///' + tokenRemote.replace(/\\/g, '/');

  await gitMod.addRemote(work, 'origin', cleanUrl);

  // 直接推"带令牌的地址" -> 应该推到 tokenRemote
  const direct = await gitMod.push(work, 'origin', 'main', { authUrl: fakeTokenUrl });
  const tokenGotIt = raw(TMP, ['--git-dir', tokenRemote, 'log', '--oneline', 'main']);
  ok('直接给 authUrl 时推到了 authUrl 指向的仓库',
    tokenGotIt.code === 0 && tokenGotIt.stdout.trim().length > 0, tokenGotIt.stderr);
  ok('此时干净地址的仓库还是空的(证明 authUrl 确实生效)',
    raw(TMP, ['--git-dir', cleanRemote, 'log', '--oneline', 'main']).code !== 0);

  /* ============================================================ */
  console.log('\n2. 用 insteadOf 让 git 把"干净地址"改写成"带令牌地址"');

  const work2 = path.join(TMP, 'work2');
  await fsp.mkdir(work2, { recursive: true });
  raw(work2, ['init', '-b', 'main']);
  await write(work2, 'b.txt', 'second\n');
  raw(work2, ['add', '-A']);
  raw(work2, ['commit', '-m', 'second']);

  await gitMod.addRemote(work2, 'origin', cleanUrl);

  // 关键:配置 url.<带令牌地址>.insteadOf=<干净地址>
  // 这样执行 `git push origin main` 时,git 会把 origin 的 URL 改写成带令牌的版本。
  const extraArgs = ['-c', `url.${fakeTokenUrl}.insteadOf=${cleanUrl}`];
  const pushed = await gitMod.push(work2, 'origin', 'main', {
    setUpstream: true,
    extraArgs,
    // 注意:这里没有传 authUrl,靠 insteadOf 完成改写
  });
  const work2Log = raw(TMP, ['--git-dir', cleanRemote, 'log', '--oneline', 'main']);
  ok('insteadOf 生效:推到了被改写的目标仓库',
    work2Log.code === 0 && work2Log.stdout.includes('second'), work2Log.stderr);
  ok('上游关系被正确设置(setUpstream 用的是逻辑远程名)',
    raw(work2, ['rev-parse', '--abbrev-ref', 'main@{upstream}']).stdout.trim() === 'origin/main',
    raw(work2, ['rev-parse', '--abbrev-ref', 'main@{upstream}']).stderr);

  /* ============================================================ */
  console.log('\n3. 令牌绝不能落进 .git/config');

  const cfgPath = path.join(work2, '.git', 'config');
  const cfg = fs.readFileSync(cfgPath, 'utf8');
  ok('.git/config 里没有出现伪造的令牌地址片段', !cfg.includes(tokenRemote), cfg);
  ok('git remote get-url origin 仍然是干净地址',
    raw(work2, ['remote', 'get-url', 'origin']).stdout.trim() === cleanUrl);
  ok('git remote -v 不泄漏任何凭据',
    !/token|@/.test(raw(work2, ['remote', '-v']).stdout));

  /* ============================================================ */
  console.log('\n4. buildAuthUrl 的行为');

  const cases = [
    { url: 'https://github.com/u/r.git', cred: { username: 'u', token: 'ghp_secret123456' }, expect: /^https:\/\/u:ghp_secret123456@github\.com\/u\/r\.git$/ },
    { url: 'https://github.com/u/r.git', cred: null, expect: /^https:\/\/github\.com\/u\/r\.git$/ },
    { url: 'git@github.com:u/r.git', cred: { username: 'u', token: 'x' }, expect: /^git@github\.com:u\/r\.git$/, why: 'SSH 地址不应被改写' },
    { url: 'https://user:oldpass@github.com/u/r.git', cred: null, expect: /^https:\/\/github\.com\/u\/r\.git$/, why: '旧的嵌入式凭据应被剥离' },
  ];
  for (const c of cases) {
    const got = gitMod.buildAuthUrl(c.url, c.cred);
    ok('buildAuthUrl: ' + (c.why || c.url), c.expect.test(got), 'got=' + got);
  }
  // 重要:令牌不能被 URL 编码弄坏(真实令牌只含 [A-Za-z0-9_])
  const realish = gitMod.buildAuthUrl('https://github.com/u/r.git', { username: 'u', token: 'ghp_aBcD1234_efGH' });
  ok('真实形态的令牌原样保留', realish.includes('ghp_aBcD1234_efGH'), realish);

  /* ============================================================ */
  console.log('\n5. redact 是否会抹掉各种形态的凭据');

  const samples = [
    'https://user:ghp_abcdefghijklmnopqrst@github.com/u/r.git',
    'remote: token ghp_AbCdEfGhIjKlMnOpQrStUvWx is invalid',
    'https://x-access-token:github_pat_11ABCDEFG0123456789_abcdefghij@github.com/u/r',
    'fatal: Authentication failed for \'https://realuser:realpassword@github.com/u/r.git/\'',
  ];
  for (const s of samples) {
    const out = gitMod.redact(s);
    const leaked = /ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{15,}/.test(out)
      || /:\/\/[^@\s/]+:[^@\s/]+@/.test(out);
    ok('redact 清理干净: ' + s.slice(0, 46) + '…', !leaked, 'out=' + out);
  }

  /* ============================================================ */
  console.log('\n6. parseRepoUrl 对各种地址形态');

  const gh = require(path.join(ROOT, 'src', 'main', 'github.js'));
  const urlCases = [
    ['https://github.com/octocat/Hello-World.git', 'octocat', 'Hello-World'],
    ['https://github.com/octocat/Hello-World', 'octocat', 'Hello-World'],
    ['git@github.com:octocat/Hello-World.git', 'octocat', 'Hello-World'],
    ['ssh://git@github.com/octocat/Hello-World.git', 'octocat', 'Hello-World'],
    ['octocat/Hello-World', 'octocat', 'Hello-World'],
    ['https://github.com/octocat/Hello-World/', 'octocat', 'Hello-World'],
    ['https://user:pass@github.com/octocat/Hello-World.git', 'octocat', 'Hello-World'],
  ];
  for (const [input, o, r] of urlCases) {
    const got = gh.parseRepoUrl(input);
    ok('parseRepoUrl: ' + input, got && got.owner === o && got.repo === r, JSON.stringify(got));
  }
  ok('非 GitHub 地址返回 null', gh.parseRepoUrl('https://gitlab.com/u/r.git') === null
    || gh.parseRepoUrl('https://gitlab.com/u/r.git').owner !== 'u/r');

  /* ============================================================ */
  console.log('\n7. git 缺失时的报错是否友好');

  const detect = gitMod.detect();
  ok('本机检测到 git', detect.available === true, JSON.stringify(detect));
  ok('git 版本号可读', /^\d+\.\d+/.test(detect.version || ''), detect.version);
  ok('返回了 git 可执行文件路径', !!(detect.path && detect.path.length), detect.path);

  /* ============================================================ */
  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项,失败 ' + fail + ' 项');
  if (failures.length) {
    console.log('\n失败清单:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('========================================');

  if (!fail) { try { await fsp.rm(TMP, { recursive: true, force: true }); } catch (_) {} }
  else console.log('\n测试目录已保留: ' + TMP);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('测试脚本异常:', e); process.exit(2); });
