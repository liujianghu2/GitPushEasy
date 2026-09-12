'use strict';
/**
 * auth.js —— 凭据安全存储 + GitHub 登录流程。
 *
 * 存储策略(三档降级,保证在任何机器上都能用):
 *   1. Electron safeStorage(Windows 走 DPAPI,只有当前用户能解开) —— 首选
 *   2. 退化为 0600 权限的明文文件 —— 仅当系统不支持加密时
 * 无论哪一档,凭据都只落在用户自己的 %APPDATA% 下,绝不上传、绝不写进日志。
 */

const { app, safeStorage } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const FILE_NAME = 'credentials.json';

function storeFile() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function readStore() {
  try {
    const raw = fs.readFileSync(storeFile(), 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

function writeStore(obj) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function encryptionAvailable() {
  try {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch (_) {
    return false;
  }
}

function encrypt(plain) {
  if (encryptionAvailable()) {
    return { v: 2, data: safeStorage.encryptString(plain).toString('base64') };
  }
  // 兜底: 至少做一层可逆混淆,并明确标记为弱保护
  const key = crypto.createHash('sha256').update('gpe-local-' + (process.env.USERNAME || 'u')).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    v: 1,
    data: Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64'),
  };
}

function decrypt(rec) {
  if (!rec || !rec.data) return null;
  try {
    if (rec.v === 2) {
      if (!encryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(rec.data, 'base64'));
    }
    if (rec.v === 1) {
      const key = crypto.createHash('sha256').update('gpe-local-' + (process.env.USERNAME || 'u')).digest();
      const buf = Buffer.from(rec.data, 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const body = buf.subarray(28);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(body), d.final()]).toString('utf8');
    }
  } catch (_) {
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------ 账户读写 */

function listAccounts() {
  const st = readStore();
  const out = [];
  for (const [login, rec] of Object.entries(st.accounts || {})) {
    out.push({
      login,
      name: rec.name || login,
      avatar: rec.avatar || '',
      scopes: rec.scopes || '',
      method: rec.method || 'token',
      savedAt: rec.savedAt || 0,
    });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

function getToken(login) {
  const st = readStore();
  const rec = (st.accounts || {})[login];
  if (!rec || !rec.secret) return null;
  return decrypt(rec.secret);
}

function saveAccount(profile, token, method) {
  const st = readStore();
  st.accounts = st.accounts || {};
  st.accounts[profile.login] = {
    login: profile.login,
    name: profile.name || profile.login,
    avatar: profile.avatar_url || profile.avatar || '',
    scopes: profile.scopes || '',
    method: method || 'token',
    savedAt: Date.now(),
    secret: encrypt(token),
  };
  st.lastLogin = profile.login;
  writeStore(st);
  return true;
}

/**
 * 永久删除某个账号的本机登录信息。
 * 只有用户明确要求"删除"时才调用 —— 普通的"退出登录"用下面那个。
 */
function removeAccount(login) {
  const st = readStore();
  if (st.accounts) delete st.accounts[login];
  if (st.lastLogin === login) st.lastLogin = null;
  writeStore(st);
  return true;
}

/**
 * 退出登录(但保留本机保存的登录信息)。
 *
 * 这是"退出"的默认语义:退出后不再自动登录,凭据还留着 ——
 * 想再用的时候在账号菜单里点一下就回来了,不用重新去 GitHub 生成令牌。
 *
 * 注意:只清 lastLogin,【不】自动切换到别的账号。
 * 用户的意图是"退出",硬把他切到另一个账号会很意外;
 * 要换账号是另一个动作(账号菜单里的"切换")。
 */
function signOut(login) {
  const st = readStore();
  if (login && st.lastLogin === login) st.lastLogin = null;
  writeStore(st);
  return true;
}

function getSettings() {
  const st = readStore();
  return Object.assign({
    defaultBranch: 'main',
    defaultVisibility: 'private',
    commitName: '',
    commitEmail: '',
    defaultSyncStrategy: 'rebase',
    authorMode: 'github',   // github | global | custom
    clientId: '',
    theme: 'system',
    knowledgeRead: [],
  }, st.settings || {});
}

function setSettings(patch) {
  const st = readStore();
  st.settings = Object.assign(getSettings(), patch || {});
  writeStore(st);
  return st.settings;
}

function lastLogin() {
  const st = readStore();
  return st.lastLogin && (st.accounts || {})[st.lastLogin] ? st.lastLogin : null;
}

function storageInfo() {
  return {
    encrypted: encryptionAvailable(),
    file: storeFile(),
  };
}

/** 把 token 从任何字符串里抹掉,防止它出现在错误信息/日志/界面上 */
function redact(text, token) {
  let s = String(text == null ? '' : text);
  if (token && token.length >= 8) {
    s = s.split(token).join('***');
  }
  // https://user:ghp_xxx@github.com -> https://***@github.com
  s = s.replace(/(https?:\/\/)[^@\s/]+:[^@\s/]+@/gi, '$1***@');
  s = s.replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})/g, '***');
  s = s.replace(/\b(github_pat_[A-Za-z0-9_]{20,})/g, '***');
  return s;
}

module.exports = {
  listAccounts,
  getToken,
  saveAccount,
  removeAccount,
  signOut,
  getSettings,
  setSettings,
  lastLogin,
  storageInfo,
  redact,
  storeFile,
};
