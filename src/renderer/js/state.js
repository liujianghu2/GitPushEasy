/**
 * state.js —— 界面共享状态 + 持久化的用户偏好。
 * 只放"跨视图都要用"的东西,单页面内部的临时状态各自在视图里管。
 */
(function () {
  'use strict';

  const KEY = 'gpe.ui';

  const state = {
    /* 环境 */
    info: null,               // app:info 的返回

    /* 账号 */
    account: null,            // { login, name, avatar, scopes, method }
    accounts: [],             // 本地保存过的账号

    /* 设置(来自主进程) */
    settings: {
      defaultBranch: 'main',
      defaultVisibility: 'private',
      commitName: '',
      commitEmail: '',
      defaultSyncStrategy: 'rebase',
      authorMode: 'github',
      clientId: '',
      theme: 'light',
    },

    /* 当前文件夹 */
    folder: null,
    folderInfo: null,
    scan: null,

    /* 仓库 */
    repo: null,
    recentRepos: [],          // 在仓库选择器里浏览过的仓库(仅内存)

    /* 分析结果 */
    analysis: null,
    selectedPaths: null,      // null = 全部

    /* 上传 */
    pushing: false,
    lastResult: null,

    /* 知识库 */
    kbTab: 'concepts',
    kbItem: null,
  };

  /* ------------------------------------------------------------ 主题 */

  function resolvedTheme() {
    const t = state.settings.theme || 'light';
    if (t === 'light' || t === 'dark') return t;
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (_) {
      return 'light';
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', resolvedTheme());
  }

  /* ------------------------------------------------------------ 轻量持久化 */

  /** 把界面上的一些小偏好存起来(下次打开保持一致) */
  function persist(patch) {
    try {
      const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
      localStorage.setItem(KEY, JSON.stringify(Object.assign(cur, patch)));
    } catch (_) {}
  }

  function restore(key, fallback) {
    try {
      const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
      return key in cur ? cur[key] : fallback;
    } catch (_) {
      return fallback;
    }
  }

  window.S = state;
  window.SapplyTheme = applyTheme;
  window.Spersist = persist;
  window.Srestore = restore;
})();
