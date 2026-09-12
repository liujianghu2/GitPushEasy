/**
 * test-repo-link.js —— 回归测试:"全新文件夹 + 新建仓库后关联远程"必须成功。
 *
 * 用户报的 bug:
 *   在一个还没 git init 的文件夹里点"创建并关联这个文件夹",
 *   报错 fatal: not a git repository (or any of the parent directories): .git
 *   原因是直接执行了 `git remote add`,而 remote 只能存在于 Git 仓库里。
 *
 * 用法: node tools/test-repo-link.js
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
const TMP = path.join(os.tmpdir(), 'gpe-repolink-' + Date.now());

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

  const bare = path.join(TMP, 'remote.git');
  raw(TMP, ['init', '--bare', '-b', 'main', bare]);
  const remoteUrl = 'file:///' + bare.replace(/\\/g, '/');

  /* ============================================================ */
  section('1. 复现用户场景:全新文件夹 → 新建仓库 → 关联远程');
  const dir1 = path.join(TMP, 'fresh-project');
  await fsp.mkdir(dir1, { recursive: true });
  await write(dir1, 'index.js', 'console.log(1);\n');
  await write(dir1, 'node_modules/x/index.js', 'dep\n');
  await write(dir1, '.env', 'SECRET=x\n');

  // 关联之前:确认它确实还不是 Git 仓库(否则这个测试就没有意义了)
  ok('关联前不是 Git 仓库', gitMod.isRepo(dir1) === false);

  let linkErr = null;
  let linkRes = null;
  try {
    linkRes = await repo.setRemote(dir1, remoteUrl, 'origin');
  } catch (e) {
    linkErr = e;
  }
  ok('关联远程不再报错', !linkErr, linkErr ? linkErr.message : '');
  ok('返回结果里说明做了初始化', !!(linkRes && linkRes.initialized === true),
    JSON.stringify(linkRes));
  ok('文件夹现在已经是 Git 仓库', gitMod.isRepo(dir1) === true);

  const remotes = await gitMod.remotes(dir1);
  ok('origin 已写入', remotes.some((r) => r.name === 'origin'),
    JSON.stringify(remotes));
  ok('远程地址正确', (await gitMod.remoteUrl(dir1, 'origin')) === remoteUrl,
    await gitMod.remoteUrl(dir1, 'origin'));

  /* ============================================================ */
  section('2. 关联时顺手生成的 .gitignore 生效');
  const giPath = path.join(dir1, '.gitignore');
  ok('.gitignore 已生成', fs.existsSync(giPath));
  const giText = fs.readFileSync(giPath, 'utf8');
  ok('.gitignore 排除了 node_modules', giText.includes('node_modules/'));
  ok('.gitignore 排除了 .env', giText.includes('.env'));

  const st = await gitMod.status(dir1);
  const paths = st.map((f) => f.path);
  ok('status 里不出现 node_modules', !paths.some((p) => p.startsWith('node_modules')), JSON.stringify(paths));
  ok('status 里不出现 .env', !paths.includes('.env'), JSON.stringify(paths));
  ok('status 里能看到真实源码', paths.includes('index.js'), JSON.stringify(paths));

  /* ============================================================ */
  section('3. 关联之后能正常完成首次上传');
  const res = await repo.push({
    dir: dir1,
    action: 'commit-and-push',
    commit: true,
    message: '首次上传',
    author: { name: 'T', email: 't@e.com' },
    remote: 'origin',
    scan: null,
  }, () => {});
  ok('首次上传成功', res.ok === true && res.pushed === true, res.friendly || '');
  // 用实际推送的分支名:本机 init.defaultBranch 可能是 master,不能硬编码 main
  const pushedBranch = res.branch;
  const files = raw(TMP, ['--git-dir', bare, 'ls-tree', '-r', '--name-only', pushedBranch]).stdout;
  ok('远程真的有提交了',
    raw(TMP, ['--git-dir', bare, 'rev-parse', '--verify', pushedBranch]).code === 0,
    'branch=' + pushedBranch);
  ok('远程拿到了源码', files.includes('index.js'), 'branch=' + pushedBranch + ' files=' + files);
  ok('远程没有 node_modules', !files.includes('node_modules'), files);
  ok('远程没有 .env', !files.includes('.env'), files);

  /* ============================================================ */
  section('4. 已经是 Git 仓库时不会再 init,也不覆盖已有 .gitignore');
  const dir2 = path.join(TMP, 'existing-repo');
  await fsp.mkdir(dir2, { recursive: true });
  raw(dir2, ['init', '-b', 'main']);
  await write(dir2, '.gitignore', '# 我自己写的规则\nsecret.txt\n');
  await write(dir2, 'a.txt', 'a\n');

  const link2 = await repo.setRemote(dir2, remoteUrl, 'origin');
  ok('已存在的仓库不会被重复 init', link2.initialized === false, JSON.stringify(link2));
  const gi2 = fs.readFileSync(path.join(dir2, '.gitignore'), 'utf8');
  ok('用户自己的 .gitignore 未被覆盖', gi2.includes('# 我自己写的规则'), gi2);

  /* ============================================================ */
  section('5. 重复关联同一个仓库不会产生重复 remote');
  const link3 = await repo.setRemote(dir2, remoteUrl, 'origin');
  ok('第二次关联也成功', link3.ok === true);
  const remotes2 = await gitMod.remotes(dir2);
  ok('origin 只有一条', remotes2.filter((r) => r.name === 'origin').length === 1,
    JSON.stringify(remotes2));

  /* ============================================================ */
  section('6. 换一个远程地址会正确覆盖');
  const bare2 = path.join(TMP, 'remote2.git');
  raw(TMP, ['init', '--bare', '-b', 'main', bare2]);
  const url2 = 'file:///' + bare2.replace(/\\/g, '/');
  await repo.setRemote(dir2, url2, 'origin');
  ok('远程地址已更新为新地址', (await gitMod.remoteUrl(dir2, 'origin')) === url2,
    await gitMod.remoteUrl(dir2, 'origin'));

  /* ============================================================ */
  section('7. 不存在的文件夹应当给出清晰错误(而不是 git 的原始报错)');
  let badErr = null;
  try {
    await repo.setRemote(path.join(TMP, 'no-such-dir-xyz'), remoteUrl, 'origin');
  } catch (e) { badErr = e; }
  ok('不存在的目录会抛错', !!badErr);
  ok('错误信息可读(不是 "fatal: not a git repository")',
    !!badErr && !/fatal: not a git repository/i.test(badErr.message),
    badErr ? badErr.message : '');

  /* ============================================================ */
  section('8. 目标分支必须被真正采用(而不是凭空建一个 update-时间戳 分支)');

  const dir8 = path.join(TMP, 'branch-target');
  await fsp.mkdir(dir8, { recursive: true });
  await write(dir8, 'a.txt', 'a\n');
  raw(dir8, ['init', '-b', 'main']);
  await gitMod.addRemote(dir8, 'origin', bare);

  // 8a. 明确指定 targetBranch = feature-x(本地不存在)→ 应当创建并使用它
  const r8a = await repo.push({
    dir: dir8, action: 'commit-and-push', commit: true,
    message: '传到指定分支', targetBranch: 'feature-x',
    author: { name: 'T', email: 't@e.com' }, remote: 'origin', scan: null,
  }, () => {});
  ok('指定目标分支上传成功', r8a.ok === true && r8a.pushed === true, r8a.friendly || '');
  ok('推送的分支就是 feature-x', r8a.branch === 'feature-x', 'branch=' + r8a.branch);
  ok('远程上出现了 feature-x',
    raw(TMP, ['--git-dir', bare, 'rev-parse', '--verify', 'feature-x']).code === 0);
  ok('没有凭空创建 update-* 分支',
    raw(TMP, ['--git-dir', bare, 'branch', '--list', 'update-*']).stdout.trim() === '',
    raw(TMP, ['--git-dir', bare, 'branch', '--list']).stdout);

  // 8b. 不指定 targetBranch → 跟随当前分支(main)
  const dir8b = path.join(TMP, 'branch-default');
  await fsp.mkdir(dir8b, { recursive: true });
  await write(dir8b, 'b.txt', 'b\n');
  raw(dir8b, ['init', '-b', 'main']);
  await gitMod.addRemote(dir8b, 'origin', bare);
  const r8b = await repo.push({
    dir: dir8b, action: 'commit-and-push', commit: true,
    message: '默认分支', author: { name: 'T', email: 't@e.com' },
    remote: 'origin', scan: null,
  }, () => {});
  ok('未指定目标分支时上传成功', r8b.ok === true && r8b.pushed === true, r8b.friendly || '');
  ok('用的是当前分支 main', r8b.branch === 'main', 'branch=' + r8b.branch);
  ok('这次也没有创建任何 update-* 分支',
    raw(TMP, ['--git-dir', bare, 'branch', '--list', 'update-*']).stdout.trim() === '');

  // 8c. 明确要求新建分支(newBranch)→ 用它给的名字
  const dir8c = path.join(TMP, 'branch-new');
  await fsp.mkdir(dir8c, { recursive: true });
  await write(dir8c, 'c.txt', 'c\n');
  raw(dir8c, ['init', '-b', 'main']);
  await gitMod.addRemote(dir8c, 'origin', bare);
  const r8c = await repo.push({
    dir: dir8c, action: 'push-new-branch', commit: true,
    message: '新分支', newBranch: 'my-feature',
    author: { name: 'T', email: 't@e.com' }, remote: 'origin', scan: null,
  }, () => {});
  ok('新建分支上传成功', r8c.ok === true && r8c.pushed === true, r8c.friendly || '');
  ok('分支名就是用户给的名字', r8c.branch === 'my-feature', 'branch=' + r8c.branch);
  ok('主干 main 没有被这次上传影响',
    raw(TMP, ['--git-dir', bare, 'log', '-1', '--pretty=%s', 'main']).stdout.includes('默认分支'),
    raw(TMP, ['--git-dir', bare, 'log', '-1', '--pretty=%s', 'main']).stdout);

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
