'use strict';
/**
 * preload.js —— 主进程与界面之间唯一的通道。
 *
 * 渲染层拿不到 require、也碰不到 Node,只能用下面这份白名单。
 * 每个方法都返回 Promise<{ ok, data } | { ok:false, error, code }>,
 * 所以界面里统一用 `const r = await api.xxx(); if (!r.ok) ...` 的写法。
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** 把 ipcRenderer.invoke 包成统一形状,并且绝不把异常抛到界面里 */
function call(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((e) => ({
    ok: false,
    error: '程序内部错误:' + (e && e.message ? e.message : String(e)),
    code: 'IPC_ERROR',
  }));
}

/** 订阅主进程推送(进度、设备授权状态) */
function on(channel, cb) {
  const listener = (_evt, payload) => {
    try { cb(payload); } catch (e) { console.error(e); }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('gpe', {
  /**
   * 把拖进窗口的文件对象还原成真实磁盘路径。
   * Electron 32 之后 File.path 被移除,必须走 webUtils.getPathForFile。
   */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      try { return file && file.path ? file.path : ''; } catch (__) { return ''; }
    }
  },

  /* 应用 */
  info: () => call('app:info'),
  openExternal: (url) => call('app:openExternal', url),
  copy: (text) => call('app:copy', text),
  reveal: (p) => call('app:reveal', p),
  openPath: (p) => call('app:openPath', p),
  /** 把界面里的 JS 错误报给主进程记录(单向,不等待结果) */
  reportError: (payload) => {
    try { ipcRenderer.send('app:renderer-error', payload); } catch (_) {}
  },

  /* 设置与账户 */
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  accounts: {
    list: () => call('accounts:list'),
    signOut: (login) => call('accounts:signOut', login),
    remove: (login) => call('accounts:remove', login),
  },

  /* 登录 */
  auth: {
    token: (payload) => call('auth:token', payload),
    credentialManager: () => call('auth:credentialManager'),
    deviceStart: () => call('auth:deviceStart'),
    deviceCancel: () => call('auth:deviceCancel'),
    verifyClientId: (clientId) => call('auth:verifyClientId', clientId),
    onDevice: (cb) => on('auth:device', cb),
  },

  /* 文件夹 */
  folder: {
    pick: () => call('folder:pick'),
    inspect: (dir) => call('folder:inspect', dir),
    openInExplorer: (dir) => call('folder:openInExplorer', dir),
    difficulty: (dir) => call('folder:difficulty', dir),
  },

  /* 仓库与上传 */
  repo: {
    analyze: (input) => call('repo:analyze', input),
    push: (input) => call('repo:push', input),
    resolve: (input) => call('repo:resolve', input),
    abortMerge: (dir) => call('repo:abortMerge', dir),
    fixSsl: () => call('repo:fixSsl'),
    setRemote: (input) => call('repo:setRemote', input),
    remotes: (dir) => call('repo:remotes', dir),
    commits: (input) => call('repo:commits', input),
    diff: (input) => call('repo:diff', input),
    branches: (dir) => call('repo:branches', dir),
    gitignorePreview: (input) => call('repo:gitignorePreview', input),
    writeGitignore: (input) => call('repo:writeGitignore', input),
    ignorePaths: (input) => call('repo:ignorePaths', input),
    quickStatus: (dir) => call('repo:quickStatus', dir),
    history: (input) => call('repo:history', input),
    rollback: (input) => call('repo:rollback', input),
    onProgress: (cb) => on('push:progress', cb),
  },

  /* 网络与代理 */
  net: {
    info: () => call('net:info'),
    diagnose: () => call('net:diagnose'),
    setProxy: (proxy) => call('net:setProxy', proxy),
    autoDetect: () => call('net:autoDetect'),
  },

  /* GitHub 接口 */
  gh: {
    repos: (input) => call('gh:repos', input),
    orgs: (input) => call('gh:orgs', input),
    checkRepo: (input) => call('gh:checkRepo', input),
    createRepo: (input) => call('gh:createRepo', input),
    branchTree: (input) => call('gh:branchTree', input),
    probeWeb: () => call('gh:probeWeb'),
  },
});
