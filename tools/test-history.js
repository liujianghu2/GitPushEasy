/**
 * test-history.js —— 提交历史与回滚的端到端测试。
 *
 * 回滚是有破坏性的操作,所以这里的断言重点是"安全边界":
 *   · 已推送的提交绝不能用 reset(否则本地与远程历史不一致)
 *   · 工作区有未提交改动时必须拒绝回滚(否则会连带丢掉它们)
 *   · 冲突时自动取消并保持仓库原样
 *   · "创建备份分支"方式必须真的留下可找回的备份
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
const TMP = path.join(os.tmpdir(), 'gpe-hist-' + Date.now());

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; failures.push(name + (extra ? '  << ' + extra : '')); console.log('  ✗ ' + name + (extra ? '   << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

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
/** Windows 上 checkout 会把 \n 变成 \r\n,比较内容前先统一 */
function norm(t) {
  return String(t == null ? '' : t).replace(/\r\n/g, '\n').trim();
}
function read(dir, rel) {
  try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch (_) { return null; }
}
const exists = (p) => { try { return fs.existsSync(p); } catch (_) { return false; } };

async function main() {
  await fsp.mkdir(TMP, { recursive: true });
  const bare = path.join(TMP, 'remote.git');
  raw(TMP, ['init', '--bare', '-b', 'main', bare]);

  const dir = path.join(TMP, 'proj');
  await fsp.mkdir(dir, { recursive: true });
  await write(dir, 'a.txt', 'v1\n');
  raw(dir, ['init', '-b', 'main']);
  await gitMod.addRemote(dir, 'origin', bare);
  raw(dir, ['add', '-A']); raw(dir, ['commit', '-m', 'first']);
  raw(dir, ['push', '-u', 'origin', 'main']);

  await write(dir, 'a.txt', 'v2\n');
  raw(dir, ['add', '-A']); raw(dir, ['commit', '-m', 'second']);
  raw(dir, ['push', 'origin', 'main']);

  await write(dir, 'a.txt', 'v3-local\n');
  raw(dir, ['add', '-A']); raw(dir, ['commit', '-m', 'third-local-only']);

  /* ============================================================ */
  section('1. 历史列表:标注每条提交是否已推送');
  const h = await repo.history({ dir, branch: 'main', limit: 20 });
  ok('读到 3 条提交', h.commits.length === 3, String(h.commits.length));
  ok('最新一条是 third-local-only', h.commits[0].subject === 'third-local-only', h.commits[0].subject);
  ok('最新一条标记为"仅本地"', h.commits[0].status === 'local', h.commits[0].status);
  ok('second 标记为"已推送"', h.commits[1].status === 'pushed', h.commits[1].status);
  ok('first 标记为"已推送"', h.commits[2].status === 'pushed', h.commits[2].status);
  ok('返回了分支列表', Array.isArray(h.branches) && h.branches.length > 0);

  /* ============================================================ */
  section('2. 工作区有未提交改动时必须拒绝回滚');
  await write(dir, 'dirty.txt', '未提交的内容\n');
  let dirtyErr = null;
  try {
    await repo.rollback({ dir, hash: h.commits[2].hash, mode: 'backup', branch: 'main' });
  } catch (e) { dirtyErr = e; }
  ok('拒绝回滚并抛错', !!dirtyErr);
  ok('错误码是 DIRTY_WORKTREE', dirtyErr && dirtyErr.code === 'DIRTY_WORKTREE', dirtyErr && dirtyErr.code);
  ok('提示说明会丢失改动', !!dirtyErr && /没提交|丢失/.test(dirtyErr.message), dirtyErr && dirtyErr.message);
  ok('未提交的文件仍在(没有被破坏)', exists(path.join(dir, 'dirty.txt')));
  await fsp.unlink(path.join(dir, 'dirty.txt'));

  /* ============================================================ */
  section('3. 已推送的提交不允许 reset(必须用 revert)');
  let resetErr = null;
  try {
    await repo.rollback({ dir, hash: h.commits[2].hash, mode: 'reset', branch: 'main' });
  } catch (e) { resetErr = e; }
  ok('拒绝 reset 已推送的提交', !!resetErr);
  ok('错误码是 PUSHED_CANNOT_RESET', resetErr && resetErr.code === 'PUSHED_CANNOT_RESET',
    resetErr && resetErr.code);
  ok('提示引导改用反向提交', !!resetErr && /revert|反向提交/.test(resetErr.message),
    resetErr && resetErr.message);

  /* ============================================================ */
  section('4. 回滚未推送的本地提交(reset)');
  const beforeReset = read(dir, 'a.txt');
  ok('回滚前文件内容是 v3-local', beforeReset === 'v3-local\n', JSON.stringify(beforeReset));

  /**
   * 要丢弃的是 third-local-only(仅本地那条),目标是它下面的 second。
   *
   * 注意:second 本身是**已推送**的提交,但"回退到已推送的提交"是完全安全的 ——
   * reset 的危险在于**丢弃已推送的提交**,而不是回退目标是否推送过。
   * (早期实现把这两个方向搞反了,导致这里被误拦。)
   */
  const r4 = await repo.rollback({
    dir, hash: h.commits[1].hash, mode: 'reset', branch: 'main',
  });
  ok('回滚成功(回退到已推送的 second,丢弃仅本地的 third)',
    r4.ok === true, JSON.stringify(r4.steps));
  ok('文件内容回到了 v2', norm(read(dir, 'a.txt')) === 'v2', JSON.stringify(read(dir, 'a.txt')));
  const h4 = await repo.history({ dir, branch: 'main' });
  ok('历史里不再有 third-local-only',
    !h4.commits.some((c) => c.subject === 'third-local-only'),
    h4.commits.map((c) => c.subject).join(','));
  ok('本地回到与远程一致(second 是 HEAD)',
    h4.commits[0].subject === 'second', h4.commits[0].subject);

  /* ============================================================ */
  section('5. 回滚已推送的提交(revert):历史保留 + 生成反向提交');
  const r5 = await repo.rollback({
    dir, hash: h.commits[2].hash, mode: 'revert', branch: 'main',
  });
  ok('回滚成功', r5.ok === true, JSON.stringify(r5.steps));
  ok('生成了反向提交', !!r5.createdCommit, String(r5.createdCommit));
  ok('文件内容回到了 v1', norm(read(dir, 'a.txt')) === 'v1', JSON.stringify(read(dir, 'a.txt')));
  const h5 = await repo.history({ dir, branch: 'main' });
  ok('历史没有被重写(second 仍在)',
    h5.commits.some((c) => c.subject === 'second'), h5.commits.map((c) => c.subject).join(','));
  ok('新增了一条回滚提交',
    h5.commits.some((c) => /回滚/.test(c.subject)), h5.commits.map((c) => c.subject).join(','));

  /* ============================================================ */
  section('6. 备份分支方式:必须真的能找回原状态');
  // 先制造一条新的本地提交
  await write(dir, 'a.txt', 'v9\n');
  raw(dir, ['add', '-A']); raw(dir, ['commit', '-m', 'ninth']);
  const beforeBackup = read(dir, 'a.txt');

  const r6 = await repo.rollback({
    dir, hash: h.commits[2].hash, mode: 'backup', branch: 'main',
  });
  ok('备份式回滚成功', r6.ok === true, JSON.stringify(r6.steps));
  ok('返回了备份分支名', !!r6.backupBranch, String(r6.backupBranch));
  ok('备份分支确实存在',
    raw(dir, ['rev-parse', '--verify', '--quiet', r6.backupBranch]).code === 0,
    r6.backupBranch);
  ok('备份分支里保留了回滚前的内容',
    raw(dir, ['show', `${r6.backupBranch}:a.txt`]).stdout === beforeBackup,
    JSON.stringify(raw(dir, ['show', `${r6.backupBranch}:a.txt`]).stdout));
  ok('当前工作区已回退到 v1', norm(read(dir, 'a.txt')) === 'v1', JSON.stringify(read(dir, 'a.txt')));

  /* ============================================================ */
  section('7. 不存在的提交要给出清晰错误');
  let badErr = null;
  try {
    await repo.rollback({ dir, hash: '0000000000000000000000000000000000000000', mode: 'revert', branch: 'main' });
  } catch (e) { badErr = e; }
  ok('找不到提交时报错', !!badErr);
  ok('错误信息可读', !!badErr && /找不到/.test(badErr.message), badErr && badErr.message);

  /* ============================================================ */
  section('8. 快速状态(轮询用)必须能反映工作区变化');
  const q1 = await repo.quickStatus(dir);
  await write(dir, 'new-file.txt', 'x\n');
  const q2 = await repo.quickStatus(dir);
  ok('两次指纹不同', q1.fingerprint !== q2.fingerprint, q1.fingerprint + ' vs ' + q2.fingerprint);
  ok('第二次能看到新文件', q2.total > q1.total, q1.total + ' -> ' + q2.total);
  const q3 = await repo.quickStatus(dir);
  ok('没有变化时指纹稳定', q2.fingerprint === q3.fingerprint);

  /* ============================================================ */
  section('9. 同步文案必须反映"有未提交改动"');
  const a = await repo.analyze({
    dir, branch: 'main', remoteName: 'origin', token: null, login: null, scan: null,
  });
  ok('检测到未提交改动', a.changes.total > 0, String(a.changes.total));
  ok('文案里不再出现"本地和远程一模一样"',
    !/一模一样/.test(a.syncLabel), a.syncLabel);
  ok('文案说明有文件改动还没提交',
    /改动还没提交/.test(a.syncLabel), a.syncLabel);

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
