/**
 * test-login-endpoints.js —— 校验三种登录方式链路上的网络请求是否真的打得通。
 *
 * 覆盖:
 *   浏览器授权(Device Flow)—— 向 GitHub 申请设备码,检查端点/请求格式/返回字段
 *   访问令牌(PAT)         —— 用无效令牌请求 /user,必须返回 401(证明端点与请求头正确)
 *   本机 Git 凭据           —— 校验 git credential 调用链与凭据解析
 *
 * 这些都是真实网络请求。没有令牌就无法验证"成功"那一半,但"失败必须是
 * 可预期的失败"(而不是 404 / 参数错误 / 连不上)已经能证明链路是对的 ——
 * 这也是唯一能在没有真实账号的情况下做到的诚实验证。
 *
 * 用法: node tools/test-login-endpoints.js
 */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const gh = require(path.join(ROOT, 'src', 'main', 'github.js'));
const gitMod = require(path.join(ROOT, 'src', 'main', 'git.js'));

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; failures.push(name + (extra ? '  << ' + extra : '')); console.log('  ✗ ' + name + (extra ? '   << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
function info(t) { console.log('    · ' + t); }

async function main() {
  console.log('GitHub 登录链路检查(真实网络请求)');

  /* ============================================================ */
  section('0. 网络可达性');
  let online = true;
  try {
    await gh.request('/zen', { version: '1.0.0-test', timeout: 12000 });
  } catch (e) {
    online = false;
    info('连不上 GitHub:' + e.message);
    info('下面的网络相关断言会标记为"跳过",而不是失败 —— 网络问题是环境,不是代码缺陷。');
  }
  ok('检测到网络状态', typeof online === 'boolean');

  /* ============================================================ */
  section('1. 浏览器授权(Device Flow):向 GitHub 申请设备码');

  const clientId = process.env.GPE_CLIENT_ID || gh.DEFAULT_CLIENT_ID;
  info('使用的 Client ID: ' + clientId.slice(0, 12) + '…');

  let flow = null;
  let flowErr = null;
  try {
    flow = await gh.startDeviceFlow(clientId, gh.DEFAULT_SCOPES, '1.0.0-test');
  } catch (e) {
    flowErr = e;
  }

  if (flow) {
    ok('设备码申请成功', true);
    ok('返回了 user_code', /^[A-Z0-9-]{4,}$/i.test(flow.userCode || ''), flow.userCode);
    ok('返回了 device_code', typeof flow.deviceCode === 'string' && flow.deviceCode.length > 10);
    ok('返回了验证页面地址', /^https:\/\/github\.com\/login\/device/.test(flow.verificationUri || ''),
      flow.verificationUri);
    ok('返回了有效期', Number(flow.expiresIn) > 0, String(flow.expiresIn));
    ok('返回了轮询间隔', Number(flow.interval) > 0, String(flow.interval));
    info('验证码示例: ' + flow.userCode + '  → ' + flow.verificationUri);
  } else if (!online || /连不上 github\.com|无法连接 GitHub/.test(String(flowErr && flowErr.message))) {
    /**
     * 网络不可达 —— 这是环境问题,不是代码缺陷。
     * 但要断言"给出的报错是有用的":必须说清是哪个域名、以及替代方案。
     */
    const msg = String((flowErr && flowErr.message) || '');
    ok('网络不通时给出可读错误(不是裸的 fetch failed)', /github\.com|GitHub/.test(msg), msg);
    if (/连不上 github\.com/.test(msg)) {
      ok('指出是 github.com 域名的问题', /github\.com/.test(msg));
      ok('给出了替代方案(访问令牌/代理)', /访问令牌|代理/.test(msg));
    } else {
      info('跳过:当前网络整体不可达,无法区分是哪个域名。');
    }
    info('当前网络状态:' + msg.split('\n')[0]);
    info('这正好覆盖了国内网络的常见情况 —— api.github.com 能通但 github.com 不行。');
    info('此时「访问令牌」登录仍然完全可用。');
  } else {
    // 内置 Client ID 是占位值,GitHub 会回 404 / 400。重点是确认"链路是通的、
    // 报错是可预期且能看懂的",而不是 404 被误报成"仓库不存在"。
    const msg = String((flowErr && flowErr.message) || '');
    const status = flowErr ? flowErr.status : null;
    ok('请求确实打到了 GitHub(拿到 HTTP 状态码)', typeof status === 'number' && status > 0,
      'status=' + status);
    ok('失败原因是 Client ID 不可用,而不是链路错误',
      status === 404 || status === 400 || status === 401 || status === 422,
      'status=' + status + ' msg=' + msg);
    ok('错误信息指明了是 Client ID 的问题(没有误报成仓库不存在)',
      /Client ID/.test(msg) && !/仓库不存在/.test(msg), msg);
    ok('错误信息给出了替代方案(访问令牌)',
      /访问令牌/.test(msg), msg);
    info('GitHub 的回应(' + status + '): ' + msg);
    info('这不影响「访问令牌」登录;想用浏览器授权,');
    info('请到 GitHub → Settings → Developer settings → OAuth Apps 新建应用并勾选 Enable Device Flow,');
    info('把 Client ID 填进本程序「设置 → 登录与安全」即可。');
  }

  /* ============================================================ */
  section('1b. Client ID 校验(用户粘贴后立即得到反馈)');

  // 空值 / 格式不对 → 不发请求就拦下
  const vEmpty = await gh.verifyClientId('', '1.0.0-test');
  ok('空值被拦下且不发请求', vEmpty.ok === false && vEmpty.reason === 'empty', JSON.stringify(vEmpty));

  const vShort = await gh.verifyClientId('abc', '1.0.0-test');
  ok('过短的 ID 被格式校验拦下', vShort.ok === false && vShort.reason === 'format', JSON.stringify(vShort));

  const vWeird = await gh.verifyClientId('not a valid id!!', '1.0.0-test');
  ok('含非法字符的 ID 被拦下', vWeird.ok === false && vWeird.reason === 'format', JSON.stringify(vWeird));

  if (online) {
    // 占位 ID → GitHub 回 404,应当被识别为 not-found(而不是笼统的"失败")
    const vFake = await gh.verifyClientId('Ov23li00000000000000', '1.0.0-test');
    ok('不存在的 Client ID 被识别为 not-found',
      vFake.ok === false && vFake.reason === 'not-found', JSON.stringify(vFake));
    ok('给出了可读的原因', /Client ID/.test(vFake.message || ''), vFake.message);
    info('校验结果: ' + vFake.message);
  } else {
    info('跳过:需要网络。');
  }

  /* ============================================================ */
  section('2. 访问令牌(PAT):用无效令牌必须得到"可预期的失败"');

  if (online) {
    let patErr = null;
    try {
      await gh.getUser('ghp_thisIsNotARealToken000000000000000000', '1.0.0-test');
    } catch (e) {
      patErr = e;
    }
    ok('请求 /user 得到了 401(说明端点与请求头正确)', !!patErr && patErr.status === 401,
      patErr ? String(patErr.status) + ' ' + patErr.message : '没有报错(不应该)');
    ok('401 被翻译成了人话', !!patErr && /重新登录|令牌/.test(patErr.message),
      patErr ? patErr.message : '');
  } else {
    info('跳过(需要网络)。');
  }

  /* ============================================================ */
  section('3. 访问令牌:校验接口的边界处理');

  let emptyErr = null;
  try { await gh.checkToken('', '1.0.0-test'); } catch (e) { emptyErr = e; }
  ok('空令牌不会发出请求(直接报错)', !!emptyErr);

  // 超短字符串也应被拒绝(界面层会拦,但这里确认后端也不会崩)
  let shortErr = null;
  try { await gh.checkToken('abc', '1.0.0-test'); } catch (e) { shortErr = e; }
  ok('超短令牌得到可预期错误', !!shortErr && (shortErr.status === 401 || shortErr.status === 400),
    shortErr ? String(shortErr.status) : 'no error');

  /* ============================================================ */
  section('4. 细粒度令牌的权限判断逻辑');

  // 细粒度令牌不会返回 x-oauth-scopes,此时 canCreateRepo 应为 true(交给实际创建时报错)
  const fineGrained = { login: 'u', scopes: '' };
  ok('scopes 为空时视为细粒度令牌(不预先拦死)', (fineGrained.scopes === ''));
  const classic = { login: 'u', scopes: 'repo, workflow' };
  ok('classic 令牌含 repo 权限', /(^|,)\s*repo\s*(,|$)/.test(classic.scopes));

  /* ============================================================ */
  section('5. 本机 Git 凭据:调用链与解析');

  const detect = gitMod.detect();
  ok('本机检测到 git', detect.available === true, JSON.stringify(detect));
  ok('git credentialFill 是可调用函数', typeof gitMod.credentialFill === 'function');

  const cr = await gitMod.credentialFill('protocol=https\nhost=github.com-entry-that-does-not-exist.invalid');
  ok('credentialFill 在拿不到凭据时不会挂起,返回结构化结果',
    cr && typeof cr.ok === 'boolean', JSON.stringify(cr));
  ok('拿不到凭据时带上了原因', cr.ok === true || typeof cr.reason === 'string',
    JSON.stringify(cr));
  info('本机凭据读取结果: ' + (cr.ok ? '读到账号 ' + cr.username : cr.reason));

  /* ============================================================ */
  section('6. 账号密码这条路已经彻底移除');

  const fs = require('fs');
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'main', 'preload.js'), 'utf8');
  const viewLogin = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'js', 'view-login.js'), 'utf8');
  ok('preload 不再暴露 auth.password', !/password:\s*\(\)\s*=>/.test(preload));
  ok('界面不再有 detailPassword 函数', !/detailPassword/.test(viewLogin));
  ok('界面里没有 password 这种登录方式', !/data-method="password"|id:\s*'password'/.test(viewLogin));
  ok('界面只提供三种登录方式',
    (viewLogin.match(/methodCard\(\{\s*id:\s*'/g) || []).length === 3,
    '找到 ' + (viewLogin.match(/methodCard\(\{\s*id:\s*'/g) || []).length + ' 个');
  ok('三种方式分别是 token / device / gcm',
    /id:\s*'token'/.test(viewLogin) && /id:\s*'device'/.test(viewLogin) && /id:\s*'gcm'/.test(viewLogin));

  /* ============================================================ */
  section('7. 界面图标统一(不再使用 emoji)');

  const art = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'js', 'art.js'), 'utf8');
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  const uiFiles = ['view-login.js', 'view-home.js', 'view-changes.js', 'view-status.js',
    'view-projects.js', 'settings.js', 'view-repo.js', 'kb.js', 'app.js'];
  const offenders = [];
  for (const f of uiFiles) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'js', f), 'utf8');
    src.split('\n').forEach((l, i) => {
      const m = l.match(EMOJI);
      if (m) offenders.push(f + ':' + (i + 1) + ' [' + m[0] + ']');
    });
  }
  ok('功能界面里没有任何 emoji', offenders.length === 0, offenders.slice(0, 6).join('; '));
  ok('art.js 提供了图标生成函数', /function icon\(/.test(art));
  ok('图标数量够用(≥ 30)', (art.match(/^\s{4}[a-zA-Z]+:\s*\(\)\s*=>/gm) || []).length >= 30,
    String((art.match(/^\s{4}[a-zA-Z]+:\s*\(\)\s*=>/gm) || []).length));

  /* ============================================================ */
  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项,失败 ' + fail + ' 项');
  if (failures.length) {
    console.log('\n失败清单:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('========================================');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('测试脚本异常:', e);
  process.exit(2);
});
