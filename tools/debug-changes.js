/**
 * debug-changes.js —— 复现:"我改了本地文件,工具却说本地和远程一模一样"。
 * 用真实的 git 操作走一遍 status → 解析 → 判断的完整链路。
 */
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const gitMod = require(path.join(ROOT, 'src', 'main', 'git.js'));
const repo = require(path.join(ROOT, 'src', 'main', 'repo.js'));

const GIT = gitMod.detect().path || 'git';
const TMP = path.join(os.tmpdir(), 'gpe-chg-' + Date.now());

function raw(cwd, args) {
  const r = spawnSync(GIT, args, {
    cwd, encoding: 'utf8', windowsHide: true,
    env: Object.assign({}, process.env, {
      GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e.com',
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
  const bare = path.join(TMP, 'remote.git');
  raw(TMP, ['init', '--bare', '-b', 'main', bare]);

  const dir = path.join(TMP, 'proj');
  await fsp.mkdir(dir, { recursive: true });
  await write(dir, 'README.md', '# hello\n');
  await write(dir, 'src/app.js', 'console.log(1);\n');
  raw(dir, ['init', '-b', 'main']);
  await gitMod.addRemote(dir, 'origin', bare);
  raw(dir, ['add', '-A']);
  raw(dir, ['commit', '-m', 'init']);
  raw(dir, ['push', '-u', 'origin', 'main']);

  console.log('=== 步骤 1:刚提交完,应当"没有改动" ===');
  let st = await gitMod.status(dir);
  console.log('  原始 status 条数:', st.length);

  // ---- 模拟用户修改文件 ----
  console.log('\n=== 步骤 2:修改一个已跟踪文件 + 新增一个文件 ===');
  await write(dir, 'src/app.js', 'console.log(1);\nconsole.log(2); // 用户新加的一行\n');
  await write(dir, 'notes.txt', '我的笔记\n');

  // 先看 git 原生输出,确认改动确实存在
  const native = raw(dir, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  console.log('  原生 git status 字节数:', native.stdout.length);
  console.log('  原生输出(\\0 换成 |):', JSON.stringify(native.stdout.replace(/\0/g, '|')));

  st = await gitMod.status(dir);
  console.log('  解析结果:', JSON.stringify(st));

  console.log('\n=== 步骤 3:走完整 analyze() ===');
  const a = await repo.analyze({
    dir, branch: 'main', remoteName: 'origin', token: null, login: null,
    syncStrategy: 'rebase', scan: null,
  });
  console.log('  changes.total     :', a.changes.total);
  console.log('  changes.clean     :', a.changes.clean);
  console.log('  sync / syncLabel  :', a.sync, '/', a.syncLabel);
  console.log('  plan.action       :', a.plan.action);
  console.log('  plan.title        :', a.plan.title);
  console.log('  ahead / behind    :', a.ahead, '/', a.behind);

  console.log('\n=== 步骤 4:只改文件内容、不改大小(容易被漏掉的情况) ===');
  await write(dir, 'src/app.js', 'console.log(1);\nconsole.log(3); // 改成 3\n');
  st = await gitMod.status(dir);
  console.log('  status:', JSON.stringify(st.map((f) => f.path + ':' + f.x + f.y)));

  console.log('\n=== 步骤 5:提交之后(应当变成"本地领先") ===');
  raw(dir, ['add', '-A']);
  raw(dir, ['commit', '-m', 'user change']);
  const a2 = await repo.analyze({
    dir, branch: 'main', remoteName: 'origin', token: null, login: null,
    syncStrategy: 'rebase', scan: null,
  });
  console.log('  changes.total :', a2.changes.total);
  console.log('  sync          :', a2.sync, '/', a2.syncLabel);
  console.log('  plan.action   :', a2.plan.action);
  console.log('  plan.title    :', a2.plan.title);

  console.log('\n=== 步骤 6:改动尚未提交时的连续两次 analyze(检查是否被缓存) ===');
  await write(dir, 'src/app.js', 'console.log(1);\nconsole.log(4);\n');
  const c1 = await repo.analyze({ dir, branch: 'main', remoteName: 'origin', token: null, login: null, scan: null });
  const c2 = await repo.analyze({ dir, branch: 'main', remoteName: 'origin', token: null, login: null, scan: null });
  console.log('  第一次 total:', c1.changes.total, ' 第二次 total:', c2.changes.total);

  console.log('\n=== 步骤 7:空文件内容变化(0 字节 → 有内容) ===');
  await write(dir, 'empty.txt', '');
  raw(dir, ['add', 'empty.txt']);
  raw(dir, ['commit', '-m', 'empty file']);
  await write(dir, 'empty.txt', 'now has content\n');
  st = await gitMod.status(dir);
  console.log('  status:', JSON.stringify(st.map((f) => f.path + ':' + f.x + f.y)));

  try { await fsp.rm(TMP, { recursive: true, force: true }); } catch (_) {}
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(2); });
