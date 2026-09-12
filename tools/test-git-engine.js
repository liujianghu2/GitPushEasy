/**
 * test-git-engine.js —— 对 repo.js / git.js 做真实仓库的端到端测试。
 *
 * 不碰网络:用一个本地 bare 仓库冒充 "GitHub 远程"。
 * 这样 authUrl 分支会被跳过(非 github.com 地址),其余全部真实执行:
 * 真实 git 进程、真实暂存/提交/推送/拉取、真实冲突。
 *
 * 用法: node tools/test-git-engine.js
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const gitMod = require(path.join(ROOT, 'src', 'main', 'git.js'));
const repo = require(path.join(ROOT, 'src', 'main', 'repo.js'));

const GIT = gitMod.detect().path || 'git';
const TMP = path.join(os.tmpdir(), 'gpe-engine-test-' + Date.now());

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log('  ✓ ' + name);
  } else {
    failed += 1;
    failures.push(name + (extra ? '  << ' + extra : ''));
    console.log('  ✗ ' + name + (extra ? '   << ' + extra : ''));
  }
}

function section(t) {
  console.log('\n' + t);
}

/** 直接调 git 做测试夹具(不走被测代码) */
function raw(cwd, args, opts) {
  const r = spawnSync(GIT, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: Object.assign({}, process.env, {
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Tester',
      GIT_AUTHOR_EMAIL: 'tester@example.com',
      GIT_COMMITTER_NAME: 'Tester',
      GIT_COMMITTER_EMAIL: 'tester@example.com',
    }),
    input: opts && opts.input,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function write(dir, rel, content) {
  const full = path.join(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf8');
}

function exists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

const TEST_BRANCH_INIT = 'main';
let TEST_BRANCH = TEST_BRANCH_INIT;

async function main() {
  await fsp.mkdir(TMP, { recursive: true });
  console.log('测试目录: ' + TMP);

  const bare = path.join(TMP, 'remote.git');
  raw(TMP, ['init', '--bare', '-b', TEST_BRANCH, bare]);

  /* ================================================================ 1 */
  section('1. 全新文件夹:从零到第一次上传');
  const dir1 = path.join(TMP, 'project1');
  await fsp.mkdir(dir1, { recursive: true });
  await write(dir1, 'README.md', '# 我的第一个项目\n\n中文内容测试。\n');
  await write(dir1, 'src/index.js', 'console.log("hello");\n');
  await write(dir1, 'src/工具 说明.txt', '带中文和空格的文件名\n');
  await write(dir1, 'node_modules/dep/index.js', 'module.exports = 1;\n');
  await write(dir1, 'debug.log', 'log line\n');
  await write(dir1, '.env', 'SECRET=hunter2\n');

  const inspect1 = await repo.inspectFolder(dir1);
  ok('体检:识别出这是新文件夹(不是 git 仓库)', inspect1.isRepo === false);
  ok('体检:统计到文件', inspect1.scan.files > 0, 'files=' + inspect1.scan.files);
  ok('体检:自动生成 .gitignore', inspect1.gitignore.created === true);
  ok('.gitignore 文件真的落盘了', exists(path.join(dir1, '.gitignore')));

  const gi = await fsp.readFile(path.join(dir1, '.gitignore'), 'utf8');
  ok('.gitignore 排除了 node_modules', gi.includes('node_modules/'));
  ok('.gitignore 排除了 .env(密钥)', gi.includes('.env'));
  ok('.gitignore 排除了 *.log', gi.includes('*.log'));

  // 先用固定分支名建好本地仓库,让后面的断言有确定的 ref 可比对
  // (注意:不是调 repo.push 里的 init,而是模拟"用户文件夹本来就已经 init 过")
  raw(dir1, ['init', '-b', TEST_BRANCH]);
  await gitMod.addRemote(dir1, 'origin', bare);
  const st1 = await gitMod.status(dir1);
  const paths1 = st1.map((f) => f.path);
  ok('status 不再列出 node_modules', !paths1.some((p) => p.startsWith('node_modules')));
  ok('status 不再列出 .env', !paths1.includes('.env'));
  ok('status 列出了中文带空格文件名', paths1.includes('src/工具 说明.txt'), JSON.stringify(paths1));

  const res1 = await repo.push({
    dir: dir1,
    action: 'commit-and-push',
    commit: true,
    message: '第一次提交:项目初始化',
    author: { name: 'Tester', email: 'tester@example.com' },
    branch: TEST_BRANCH,
    remote: 'origin',
    scan: inspect1.scan,
  }, () => {});
  ok('第一次上传返回成功', res1.ok === true, JSON.stringify(res1).slice(0, 200));
  ok('确实执行了推送', res1.pushed === true);
  ok('返回了提交号', !!(res1.commit && res1.commit.short), JSON.stringify(res1.commit));
  ok('步骤里包含 gitignore/stage/commit/check/push',
    ['gitignore', 'stage', 'commit', 'check', 'push'].every((id) => res1.steps.some((s) => s.id === id)),
    res1.steps.map((s) => s.id).join(','));
  ok('文件夹已经是仓库时不会重复 init',
    !res1.steps.some((s) => s.id === 'init'), res1.steps.map((s) => s.id).join(','));

  const lsRemote = raw(TMP, ['--git-dir', bare, 'log', '--oneline', TEST_BRANCH]);
  ok('远程 bare 仓库真的有提交了', lsRemote.code === 0 && lsRemote.stdout.trim().length > 0,
    lsRemote.stderr);
  ok('远程上有 ' + TEST_BRANCH + ' 分支',
    raw(TMP, ['--git-dir', bare, 'rev-parse', '--verify', TEST_BRANCH]).code === 0);

  // 确认程序推送的分支名与本机 git 的默认分支设置一致(而不是硬编码 main)
  const localBranch1 = raw(dir1, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  ok('推送的分支名等于本机默认分支名', res1.branch === localBranch1,
    'pushed=' + res1.branch + ' local=' + localBranch1);

  const remoteFiles = raw(TMP, ['--git-dir', bare, 'ls-tree', '-r', '--name-only', TEST_BRANCH]).stdout;
  ok('远程包含 README.md', remoteFiles.includes('README.md'));
  ok('远程包含中文文件名', remoteFiles.includes('src/工具 说明.txt'), remoteFiles);
  ok('远程不包含 node_modules', !remoteFiles.includes('node_modules'));
  ok('远程不包含 .env', !remoteFiles.includes('.env'), remoteFiles);

  const msgLog = raw(TMP, ['--git-dir', bare, 'log', '-1', '--pretty=%s', TEST_BRANCH]).stdout.trim();
  ok('中文提交信息没有乱码', msgLog === '第一次提交:项目初始化', 'got=' + JSON.stringify(msgLog));

  /* ================================================================ 1b */
  section('1b. 仓库默认分支是 master 时也要能推(回归测试)');
  // 很多老机器上 init.defaultBranch=master。如果程序硬编码 main,
  // git 会报 "src refspec main does not match any",小白完全看不懂。
  const bareMaster = path.join(TMP, 'remote-master.git');
  raw(TMP, ['init', '--bare', '-b', 'master', bareMaster]);
  const dirMaster = path.join(TMP, 'legacy-master');
  await fsp.mkdir(dirMaster, { recursive: true });
  await write(dirMaster, 'hello.txt', 'legacy\n');
  raw(dirMaster, ['init', '-b', 'master']);
  await gitMod.addRemote(dirMaster, 'origin', bareMaster);
  const outMaster = await repo.push({
    dir: dirMaster, action: 'commit-and-push', commit: true, message: '从 master 分支上传',
    author: { name: 'Tester', email: 'tester@example.com' },
    remote: 'origin', scan: null,
  }, () => {});
  ok('默认分支为 master 时上传成功', outMaster.ok === true && outMaster.pushed === true,
    outMaster.friendly || '');
  ok('推送的是 master 分支而不是 main', outMaster.branch === 'master', 'branch=' + outMaster.branch);
  ok('远程上出现了 master 分支',
    raw(TMP, ['--git-dir', bareMaster, 'rev-parse', '--verify', 'master']).code === 0);
  ok('远程上不会莫名出现 main 分支',
    raw(TMP, ['--git-dir', bareMaster, 'rev-parse', '--verify', 'main']).code !== 0);

  /* ================================================================ 2 */
  section('2. 增量上传:改文件 + 加文件,再传一次');
  await write(dir1, 'src/index.js', 'console.log("hello world");\nconsole.log("第二行");\n');
  await write(dir1, 'src/new-file.js', 'export default 42;\n');
  await fsp.unlink(path.join(dir1, 'README.md'));
  await write(dir1, 'README.md', '# 改了标题\n');

  const out1 = await repo.push({
    dir: dir1,
    action: 'commit-and-push',
    commit: true,
    message: '更新:改了一行,加了一个文件',
    author: { name: 'Tester', email: 'tester@example.com' },
    branch: TEST_BRANCH,
    remote: 'origin',
    scan: inspect1.scan,
  }, () => {});
  ok('第二次上传成功', out1.ok === true && out1.pushed === true, out1.friendly || '');

  const log2 = raw(TMP, ['--git-dir', bare, 'log', '--pretty=%s', TEST_BRANCH]).stdout.trim().split('\n');
  ok('远程现在有 2 条提交', log2.length === 2, JSON.stringify(log2));
  ok('最新提交信息正确', log2[0] === '更新:改了一行,加了一个文件', log2[0]);
  const files2 = raw(TMP, ['--git-dir', bare, 'ls-tree', '-r', '--name-only', TEST_BRANCH]).stdout;
  ok('新文件已上传', files2.includes('src/new-file.js'));

  /* ================================================================ 3 */
  section('3. 只勾选部分文件上传');
  await write(dir1, 'src/keep.js', 'keep me\n');
  await write(dir1, 'src/skip.js', 'skip me\n');
  const out2 = await repo.push({
    dir: dir1,
    action: 'commit-and-push',
    commit: true,
    message: '只提交 keep.js',
    paths: ['src/keep.js'],
    author: { name: 'Tester', email: 'tester@example.com' },
    branch: TEST_BRANCH,
    remote: 'origin',
    scan: inspect1.scan,
  }, () => {});
  ok('按勾选上传成功', out2.ok === true);
  const files3 = raw(TMP, ['--git-dir', bare, 'ls-tree', '-r', '--name-only', TEST_BRANCH]).stdout;
  ok('勾选的文件上传了', files3.includes('src/keep.js'));
  ok('没勾选的文件没有上传', !files3.includes('src/skip.js'));
  const st3 = await gitMod.status(dir1);
  ok('没勾选的文件仍是未提交状态', st3.some((f) => f.path === 'src/skip.js'));

  /* ================================================================ 4 */
  section('4. 远程有新内容:本地落后(behind)');
  const other = path.join(TMP, 'other-clone');
  raw(TMP, ['clone', bare, other]);
  await write(other, 'from-colleague.txt', '同事加的\n');
  raw(other, ['add', '-A']);
  raw(other, ['commit', '-m', '同事的提交']);
  raw(other, ['push', 'origin', TEST_BRANCH]);

  const ana4 = await repo.analyze({
    dir: dir1, branch: TEST_BRANCH, remote: 'origin', remoteName: 'origin',
    token: null, login: null, syncStrategy: 'rebase', scan: inspect1.scan,
  });
  ok('分析:检测到本地落后', ana4.behind === 1, 'behind=' + ana4.behind + ' ahead=' + ana4.ahead);
  ok('分析:sync 状态是 behind', ana4.sync === 'behind', ana4.sync);
  ok('分析:给出"先同步再上传"的建议', ana4.plan.action === 'sync-then-push', ana4.plan.action);

  const out4 = await repo.push({
    dir: dir1,
    action: 'sync-then-push',
    commit: true,
    sync: true,
    strategy: 'rebase',
    message: '同步后继续工作',
    author: { name: 'Tester', email: 'tester@example.com' },
    branch: TEST_BRANCH,
    remote: 'origin',
    scan: inspect1.scan,
  }, () => {});
  ok('先同步再上传成功', out4.ok === true && out4.pushed === true, out4.friendly || '');
  const files4 = raw(TMP, ['--git-dir', bare, 'ls-tree', '-r', '--name-only', TEST_BRANCH]).stdout;
  ok('同事的文件保住了', files4.includes('from-colleague.txt'));
  ok('自己未提交的文件也传上去了', files4.includes('src/skip.js'));
  ok('步骤里出现了同步环节', out4.steps.some((s) => s.id === 'sync'), out4.steps.map((s) => s.id).join(','));

  /* ================================================================ 5 */
  section('5. 两边都改了同一个文件(分叉 + 冲突)');
  // 让本地和远程各自修改同一行
  await write(dir1, 'conflict.txt', '本地的版本\n');
  raw(dir1, ['add', '-A']);
  raw(dir1, ['commit', '-m', '本地加了 conflict.txt']);
  raw(dir1, ['push', 'origin', TEST_BRANCH]);

  // 远程(模拟另一个人)也改这个文件且改同一行
  raw(other, ['pull', '--rebase', 'origin', TEST_BRANCH]);
  await write(other, 'conflict.txt', '远程的版本\n');
  raw(other, ['add', '-A']);
  raw(other, ['commit', '-m', '同事也改了 conflict.txt']);
  raw(other, ['push', 'origin', TEST_BRANCH]);

  // 本地再改一次同一行,造成真正的冲突
  await write(dir1, 'conflict.txt', '本地又改了一次\n');
  raw(dir1, ['add', '-A']);
  raw(dir1, ['commit', '-m', '本地又改了 conflict.txt']);

  const ana5 = await repo.analyze({
    dir: dir1, branch: TEST_BRANCH, remote: 'origin', remoteName: 'origin',
    token: null, login: null, syncStrategy: 'rebase', scan: inspect1.scan,
  });
  ok('分析:检测到分叉(diverged)', ana5.sync === 'diverged',
    'sync=' + ana5.sync + ' ahead=' + ana5.ahead + ' behind=' + ana5.behind);
  ok('分析:给出二选一的方案', ana5.plan.action === 'choose-diverged', ana5.plan.action);
  ok('分析:方案里包含"新建分支上传"', (ana5.plan.alternatives || []).some((x) => x.action === 'push-new-branch'));

  // 5a. 试合并 -> 应该检测到冲突、自动 abort、仓库保持干净
  let conflictErr = null;
  try {
    await repo.push({
      dir: dir1, action: 'sync-then-push', commit: true, sync: true, strategy: 'rebase',
      message: '尝试合并', author: { name: 'Tester', email: 'tester@example.com' },
      branch: TEST_BRANCH, remote: 'origin', scan: inspect1.scan,
    }, () => {});
  } catch (e) {
    conflictErr = e;
  }
  ok('冲突时抛出明确错误', !!conflictErr);
  ok('错误代码是 MERGE_CONFLICT', conflictErr && conflictErr.code === 'MERGE_CONFLICT',
    conflictErr && conflictErr.code);
  ok('错误提示引导用户改用新分支', conflictErr && /新建分支/.test(conflictErr.message || ''));

  const inProg = await gitMod.inProgress(dir1);
  ok('失败后仓库没有卡在合并中间状态', inProg.length === 0, JSON.stringify(inProg));
  const conflictContent = await fsp.readFile(path.join(dir1, 'conflict.txt'), 'utf8');
  ok('冲突文件被还原成本地版本(没有留下冲突标记)', !conflictContent.includes('<<<<<<<'),
    JSON.stringify(conflictContent));
  ok('冲突文件内容是本地版本', conflictContent.includes('本地又改了一次'), JSON.stringify(conflictContent));

  // 5b. 改用新分支上传 -> 必须成功
  const branchName = 'update-' + Date.now();
  const out5 = await repo.push({
    dir: dir1, action: 'push-new-branch', commit: true, sync: false,
    newBranch: branchName,
    message: '改到新分支上', author: { name: 'Tester', email: 'tester@example.com' },
    branch: TEST_BRANCH, remote: 'origin', scan: inspect1.scan,
  }, () => {});
  ok('新建分支上传成功', out5.ok === true && out5.pushed === true, out5.friendly || '');
  ok('返回值里带上新分支名', out5.branch === branchName, out5.branch);
  // 注意:PR 引导只在"远程是 github.com 地址"时才生成,本地 bare 仓库不会触发,
  // 所以这里只断言字段存在且类型正确。
  ok('next 字段类型正确(null 或 pr 对象)',
    out5.next === null || (out5.next && out5.next.type === 'pr'),
    JSON.stringify(out5.next));
  const branches = raw(TMP, ['--git-dir', bare, 'branch', '--list']).stdout;
  ok('远程真的多了这个分支', branches.includes(branchName), branches);
  const mainLog = raw(TMP, ['--git-dir', bare, 'log', '--pretty=%s', TEST_BRANCH]).stdout;
  ok('主干没有被这次上传污染', !mainLog.includes('改到新分支上'), mainLog);

  /* ================================================================ 6 */
  section('6. 没有改动时不应产生空提交');
  const out6 = await repo.push({
    dir: dir1, action: 'commit-and-push', commit: true,
    message: '不应该生成',
    author: { name: 'Tester', email: 'tester@example.com' },
    branch: branchName, remote: 'origin', scan: inspect1.scan,
  }, () => {});
  ok('无改动时仍然返回成功', out6.ok === true);
  ok('无改动时标记为已是最新', out6.upToDate === true || out6.pushed === false,
    JSON.stringify({ upToDate: out6.upToDate, pushed: out6.pushed }));

  /* ================================================================ 7 */
  section('7. 大文件检测');
  const dir7 = path.join(TMP, 'bigfiles');
  await fsp.mkdir(dir7, { recursive: true });
  await write(dir7, 'small.txt', 'ok\n');
  // 60MB 的假大文件(稀疏写入,不实际占满磁盘)
  const bigPath = path.join(dir7, 'big.bin');
  await fsp.writeFile(bigPath, Buffer.alloc(1024 * 1024 * 60, 7));
  const inspect7 = await repo.inspectFolder(dir7);
  ok('体检:发现 60MB 大文件', inspect7.scan.bigFiles.length >= 1,
    JSON.stringify(inspect7.scan.bigFiles.map((f) => f.path)));
  ok('体检:60MB 未超过 100MB 硬上限', inspect7.scan.overLimit.length === 0);

  const dir7b = path.join(TMP, 'hugefiles');
  await fsp.mkdir(dir7b, { recursive: true });
  await fsp.writeFile(path.join(dir7b, 'huge.bin'), Buffer.alloc(1024 * 1024 * 101, 3));
  const inspect7b = await repo.inspectFolder(dir7b);
  ok('体检:发现超过 100MB 的文件', inspect7b.scan.overLimit.length >= 1);

  const ana7b = await repo.analyze({
    dir: dir7b, branch: TEST_BRANCH, remote: 'origin', remoteName: 'origin',
    token: null, login: null, syncStrategy: 'rebase', scan: inspect7b.scan,
  });
  ok('分析:超大文件会阻断上传', ana7b.blocked === true);
  ok('分析:给出 fix-large 建议', ana7b.plan.action === 'fix-large', ana7b.plan.action);

  /* ================================================================ 8 */
  section('8. 危险文件夹识别');
  const riskyRoot = await repo.inspectFolder('C:\\');
  ok('C:\\ 能被读取(仅测试扫描不崩)', !!riskyRoot);

  /* ================================================================ 9 */
  section('9. 中文与特殊字符的鲁棒性');
  const dir9 = path.join(TMP, 'unicode');
  await fsp.mkdir(dir9, { recursive: true });
  await write(dir9, '文档/说明 文件.md', '内容\n');
  await write(dir9, "quote's.txt", "apostrophe\n");
  await write(dir9, 'unicode-🎉-emoji.txt', 'emoji\n');
  await write(dir9, '空格 与#井号.txt', 'hash\n');
  await write(dir9, '方括号[1].txt', 'bracket\n');
  await gitMod.init(dir9);
  await gitMod.addRemote(dir9, 'origin', bare);
  const st9 = await gitMod.status(dir9);
  const p9 = st9.map((f) => f.path).sort();
  ok('status 解析出 emoji 文件名', p9.includes('unicode-🎉-emoji.txt'), JSON.stringify(p9));
  ok('status 解析出含单引号的文件名', p9.includes("quote's.txt"), JSON.stringify(p9));
  ok('status 解析出中文路径', p9.some((p) => p.includes('说明 文件.md')), JSON.stringify(p9));
  ok('status 解析出含井号的文件名', p9.some((p) => p.includes('井号')), JSON.stringify(p9));
  ok('status 解析出含方括号的文件名', p9.some((p) => p.includes('方括号')), JSON.stringify(p9));

  const out9 = await repo.push({
    dir: dir9, action: 'commit-and-push', commit: true, message: '特殊字符测试',
    author: { name: '测试者', email: 'tester@example.com' },
    branch: 'unicode-branch', remote: 'origin', scan: null,
  }, () => {});
  ok('特殊文件名可以正常提交推送', out9.ok === true && out9.pushed === true, out9.friendly || '');
  const b9 = out9.branch;   // 用程序实际推送的分支名,而不是我们以为的名字
  const files9 = raw(TMP, ['--git-dir', bare, 'ls-tree', '-r', '--name-only', b9]).stdout;
  ok('emoji 文件在远程', files9.includes('unicode-🎉-emoji.txt'), 'branch=' + b9 + ' files=' + files9);
  ok('含井号的文件在远程', files9.includes('空格 与#井号.txt'), files9);
  ok('含方括号的文件在远程', files9.includes('方括号[1].txt'), files9);
  ok('中文提交者没有乱码',
    raw(TMP, ['--git-dir', bare, 'log', '-1', '--pretty=%an', b9]).stdout.includes('测试者'),
    raw(TMP, ['--git-dir', bare, 'log', '-1', '--pretty=%an', b9]).stdout);

  /* ================================================================ 10 */
  section('10. 忽略文件功能');
  await write(dir7, 'secret.key', 'topsecret\n');
  await gitMod.init(dir7);
  await gitMod.ensureGitignore(dir7, 'generic');
  const before = await gitMod.configGet(dir7, 'user.name');
  const igPath = path.join(dir7, '.gitignore');
  await fsp.writeFile(igPath, '/secret.key\n', 'utf8');
  const st10 = await gitMod.status(dir7);
  ok('被 .gitignore 排除的文件不出现在 status 里',
    !st10.some((f) => f.path === 'secret.key'),
    JSON.stringify(st10.map((f) => f.path)));

  /* ================================================================ 11 */
  section('11. 错误信息可读性');
  const dir11 = path.join(TMP, 'noremote');
  await fsp.mkdir(dir11, { recursive: true });
  await write(dir11, 'a.txt', 'a\n');
  let noRemoteErr = null;
  try {
    await repo.push({
      dir: dir11, action: 'commit-and-push', commit: true, message: 'x',
      author: { name: 'T', email: 't@e.com' }, branch: 'main', remote: 'origin', scan: null,
    }, () => {});
  } catch (e) { noRemoteErr = e; }
  ok('没有远程地址时报错清晰', !!noRemoteErr && /仓库/.test(noRemoteErr.message),
    noRemoteErr && noRemoteErr.message);

  /* ================================================================ 汇总 */
  console.log('\n========================================');
  console.log('通过 ' + passed + ' 项,失败 ' + failed + ' 项');
  if (failures.length) {
    console.log('\n失败清单:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('========================================');

  // 清理(失败时保留现场便于排查)
  if (!failed) {
    try { await fsp.rm(TMP, { recursive: true, force: true }); } catch (_) {}
  } else {
    console.log('\n因存在失败项,测试目录已保留: ' + TMP);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\n测试脚本自身异常:', e);
  process.exit(2);
});
