/**
 * rcedit-app.js —— 给打包好的 exe 补上图标和版本信息。
 *
 * 为什么需要这一步:
 *   本项目在 package.json 里设了 `win.signAndEditExecutable: false`,
 *   因为 electron-builder 25 为了"签名 + 改 exe 资源"会强制解压 winCodeSign
 *   工具包,而那个包里有两个 macOS 符号链接 —— 在 Windows 上创建符号链接
 *   需要管理员权限或开发者模式,普通用户会直接打包失败,报错还是一串乱码。
 *
 *   关掉它之后打包不再依赖提权工具,但代价是 exe 的"文件图标"和"右键属性
 *   里的版本信息"不会被写入 —— 任务栏/资源管理器里显示的就是 Electron 的
 *   默认图标。这个脚本负责把这块补回来。
 *
 * 做法:
 *   electron-builder 其实已经把 winCodeSign 解压到了缓存目录里(Windows 部分
 *   完全可用),只是因为它内部还要求 macOS 的符号链接,才把整个解压判为失败。
 *   我们直接拿缓存里现成的 `rcedit-x64.exe` 来改 exe,绕开这个限制。
 *
 *   · 不需要管理员权限
 *   · 不需要额外下载或安装任何东西
 *   · 幂等:重复执行只是把同样的信息再写一遍
 *
 * 用法:
 *   node tools/rcedit-app.js                  # 处理 dist/win-unpacked 下的 exe
 *   node tools/rcedit-app.js <exe路径...>      # 处理指定文件
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.ico');
const PKG = require(path.join(ROOT, 'package.json'));

/* ------------------------------------------------------------ 找 rcedit */

/**
 * 在 electron-builder 的 winCodeSign 缓存里找一个可用的 rcedit-x64.exe。
 * 优先用正式目录名,找不到就遍历所有已解压的目录。
 */
function findRcedit() {
  const bases = [
    path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign'),
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign'),
  ].filter(Boolean);

  for (const base of bases) {
    if (!fs.existsSync(base)) continue;

    // 先看正式目录
    const official = path.join(base, 'winCodeSign-2.6.0', 'rcedit-x64.exe');
    if (fs.existsSync(official)) return official;

    // 再遍历随机命名的解压目录
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(base, e.name));
    } catch (_) { continue; }

    for (const dir of entries) {
      const exe = path.join(dir, 'rcedit-x64.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

/** 缓存里可能还没有 winCodeSign;此时顺手触发一次 electron-builder 的解压 */
function tryPopulateCache() {
  const ab = path.join(ROOT, 'node_modules', 'app-builder-bin', 'win', 'x64', 'app-builder.exe');
  const sevenZip = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64');
  if (!fs.existsSync(ab)) return false;

  process.stdout.write('  缓存里还没有 rcedit,尝试让 electron-builder 准备一次缓存… ');
  const env = Object.assign({}, process.env);
  if (fs.existsSync(sevenZip)) env.PATH = sevenZip + path.delimiter + (env.PATH || '');

  // app-builder 会因为 macOS 符号链接而返回非 0,但 Windows 部分其实已经解压出来了,
  // 所以这里不关心退出码,只关心之后能不能找到 rcedit。
  spawnSync(ab, ['rcedit', '--args', '[]'], {
    env, stdio: 'ignore', windowsHide: true, timeout: 120000,
  });
  console.log('完成');
  return !!findRcedit();
}

/* ------------------------------------------------------------ 目标文件 */

function findTargets() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length) return args;

  const out = [];
  const unpacked = path.join(ROOT, 'dist', 'win-unpacked');
  if (fs.existsSync(unpacked)) {
    for (const f of fs.readdirSync(unpacked)) {
      if (f.toLowerCase().endsWith('.exe')) out.push(path.join(unpacked, f));
    }
  }
  return out;
}

/* ------------------------------------------------------------ 执行 */

function buildArgs(exe) {
  const v = (PKG.version || '1.0.0') + '.0';
  const product = (PKG.build && PKG.build.productName) || PKG.productName || 'GitPushEasy';
  const args = [
    exe,
    '--set-version-string', 'FileDescription', product,
    '--set-version-string', 'ProductName', product,
    '--set-version-string', 'CompanyName', (PKG.author && PKG.author.name) || 'GitPushEasy',
    '--set-version-string', 'LegalCopyright', (PKG.build && PKG.build.copyright) || 'MIT Licensed',
    '--set-version-string', 'InternalName', 'GitPushEasy',
    '--set-version-string', 'OriginalFilename', path.basename(exe),
    '--set-file-version', v,
    '--set-product-version', v,
  ];
  if (fs.existsSync(ICON)) args.push('--set-icon', ICON);
  return args;
}

/**
 * 调用 rcedit。
 *
 * 直接用 spawnSync + 参数数组,【不要】经过 cmd/shell:
 * cmd 对参数里的引号和 `.exe` 结尾有自己的一套解析规则,会把
 * `"GitPushEasy.exe"` 拆成 `"Easy""` 这种畸形参数(踩过这个坑)。
 * 参数数组由 CreateProcess 直接组装命令行,没有 shell 词法解析,最稳。
 */
function runRcedit(rcedit, args) {
  const r = spawnSync(rcedit, args, {
    encoding: 'utf8', windowsHide: true, timeout: 90000,
  });
  if (r.error) return { code: -1, out: String(r.error.message || r.error) };
  return { code: r.status == null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function verify(exe) {
  try {
    const buf = fs.readFileSync(exe);
    const s = buf.toString('latin1');
    const product = (PKG.build && PKG.build.productName) || 'GitPushEasy';
    // 版本信息里的字符串是 UTF-16,所以用另一种方式确认:文件里应当出现
    // 我们自己写进去的 UTF-16LE 产品名
    const utf16 = Buffer.from(product, 'utf16le').toString('latin1');
    return s.includes(utf16) || s.includes(product);
  } catch (_) {
    return false;
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.log('非 Windows 平台,跳过(这一步只影响 Windows 的文件图标)。');
    return;
  }
  if (!fs.existsSync(ICON)) {
    console.log('没有找到 build/icon.ico,先执行 npm run icon。');
    return;
  }

  const targets = findTargets();
  if (!targets.length) {
    console.log('没有找到要处理的 exe。请先执行 npm run build。');
    return;
  }

  let rcedit = findRcedit();
  if (!rcedit) rcedit = tryPopulateCache() ? findRcedit() : null;

  if (!rcedit) {
    console.log('没有找到 rcedit,跳过。');
    console.log('(这不影响程序功能,只是 exe 文件本身不会带自定义图标。)');
    return;
  }
  console.log('使用 rcedit: ' + rcedit);

  let done = 0;
  for (const exe of targets) {
    if (!fs.existsSync(exe)) {
      console.log('· 跳过(不存在): ' + path.relative(ROOT, exe));
      continue;
    }
    process.stdout.write('→ 写入图标与版本信息: ' + path.relative(ROOT, exe) + ' … ');
    const r = runRcedit(rcedit, buildArgs(exe));
    if (r.code === 0) {
      console.log(verify(exe) ? '完成' : '完成(未校验到产品名,请手动确认)');
      done += 1;
    } else {
      console.log('失败');
      const detail = String(r.out || '').trim().split('\n')[0];
      if (detail) console.log('   原因: ' + detail.slice(0, 200));
    }
  }

  console.log('');
  if (done) {
    console.log('已处理 ' + done + ' 个文件 —— 任务栏、资源管理器与"属性"里都会显示本程序的图标和版本信息。');
  } else {
    console.log('没有任何文件被处理 —— 这完全不影响程序功能,');
    console.log('窗口图标、托盘图标、快捷方式图标和安装包图标本来就是正常的。');
  }
}

main();
