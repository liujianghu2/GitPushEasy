/**
 * fix-wincodesign-cache.js —— 修补 electron-builder 的 winCodeSign 缓存。
 *
 * 背景(Windows 上的一个真实坑):
 *   electron-builder 会下载 winCodeSign-2.6.0.7z 并解压,但压缩包里
 *   darwin/10.12/lib/libcrypto.dylib 和 libssl.dylib 是**符号链接**。
 *   在 Windows 上创建符号链接需要管理员权限或开发者模式,普通用户会失败,
 *   于是 7za 返回退出码 2,整个打包流程中断,报错信息是
 *   "Cannot create symbolic link ... 客户端没有所需的特权"。
 *
 * 解决办法:
 *   1. 用 `-snl-` 让 7za 跳过符号链接(这样解压能成功返回 0)
 *   2. 用 `mklink /H` 创建**硬链接**补齐那两个文件
 *      —— 硬链接不需要任何特权,而这两个是 macOS 的动态库,
 *         在 Windows 打包时根本不会被读取,补齐只是为了目录完整。
 *
 * 这个脚本是幂等的:已经修好就什么都不做。
 *
 * 用法: node tools/fix-wincodesign-cache.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const CACHE_ROOT = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
const SEVEN_ZIP = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

/** 需要补齐的符号链接:目标文件 -> 被指向的真实文件 */
const SYMLINKS = [
  { link: 'darwin/10.12/lib/libcrypto.dylib', target: 'libcrypto.1.0.0.dylib' },
  { link: 'darwin/10.12/lib/libssl.dylib', target: 'libssl.1.0.0.dylib' },
];

/** 打包时真正会用到的文件。存在这些就说明这个缓存目录是可用的。 */
const REQUIRED = [
  'windows-10/x64/signtool.exe',
  'windows-10/x64/makepri.exe',
  'rcedit-x64.exe',
  'rcedit-ia32.exe',
];

function log(...a) { console.log(...a); }

function dirComplete(dir) {
  const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(dir, f)));
  const brokenLinks = SYMLINKS.filter((s) => !fs.existsSync(path.join(dir, s.link)));
  return { ok: missing.length === 0 && brokenLinks.length === 0, missing, brokenLinks };
}

function makeHardlink(linkPath, targetPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try { fs.unlinkSync(linkPath); } catch (_) {}
  const r = spawnSync('cmd', ['/c', 'mklink', '/H', linkPath, targetPath], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

function main() {
  if (process.platform !== 'win32') {
    log('非 Windows 平台,无需修补。');
    return;
  }
  if (!fs.existsSync(CACHE_ROOT)) {
    log('还没有 electron-builder 缓存,无需修补。首次打包时会自动下载。');
    return;
  }

  const entries = fs.readdirSync(CACHE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(CACHE_ROOT, e.name));

  if (!entries.length) {
    log('缓存目录为空,无需修补。');
    return;
  }

  let fixedCount = 0;

  for (const dir of entries) {
    const state = dirComplete(dir);
    if (state.ok) {
      log('✓ 已完好: ' + path.basename(dir));
      continue;
    }

    // 缺少真正的可执行文件 -> 这个目录是半成品,直接补全一份
    if (state.missing.length) {
      const archive = dir + '.7z';
      if (!fs.existsSync(archive)) {
        log('· 跳过(没有对应压缩包,让它自己重新下载): ' + path.basename(dir));
        continue;
      }
      log('→ 重新解压(跳过符号链接): ' + path.basename(dir));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const r = spawnSync(SEVEN_ZIP, ['x', archive, '-o' + dir, '-snl-', '-bd', '-y'],
        { encoding: 'utf8', windowsHide: true });
      if (r.status !== 0) {
        log('  解压失败(退出码 ' + r.status + '):' + (r.stdout || '').slice(-300));
        continue;
      }
    }

    // 补齐符号链接(用硬链接代替)
    let allOk = true;
    for (const s of SYMLINKS) {
      const linkPath = path.join(dir, s.link);
      const targetPath = path.join(path.dirname(linkPath), s.target);
      if (fs.existsSync(linkPath)) continue;
      if (!fs.existsSync(targetPath)) {
        log('  ! 找不到目标文件,跳过: ' + s.target);
        allOk = false;
        continue;
      }
      const ok = makeHardlink(linkPath, targetPath);
      log('  ' + (ok ? '✓ 已补齐 ' : '✗ 补齐失败 ') + s.link);
      if (!ok) allOk = false;
    }

    if (allOk) fixedCount += 1;
  }

  const finalEntries = fs.readdirSync(CACHE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(CACHE_ROOT, e.name));
  const ready = finalEntries.filter((d) => dirComplete(d).ok);

  log('');
  if (ready.length) {
    log('cache 可用目录数: ' + ready.length + ' / ' + finalEntries.length);
    log('现在可以重新执行 npm run build 了。');
    process.exit(0);
  }
  log('仍然没有可用的 cache 目录。请检查上面的输出。');
  process.exit(1);
}

main();
