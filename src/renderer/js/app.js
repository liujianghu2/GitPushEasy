/**
 * app.js —— 界面主控:启动、侧边栏导航、顶栏账号、主题、全局事件。
 * 本身不含业务逻辑,只负责"把各个视图串起来"。
 */
(function () {
  'use strict';

  const { $, $$, el, clear } = window.U;

  const VIEWS = ['home', 'projects', 'records', 'history', 'login', 'changes', 'status'];
  /** 侧边栏高亮到哪个导航项(changes/status 都属于"首页"这条主线) */
  const NAV_OF = {
    home: 'home', projects: 'projects', records: 'records', history: 'history',
    login: null, changes: 'home', status: 'home',
  };

  let current = 'home';

  /* ============================================================ 启动 */

  async function boot() {
    window.U.bindGlobal();
    window.KB.bind();
    window.Settings.bind();
    bindSidebar();
    bindTopbar();
    bindDragDrop();

    /**
     * 先把静态骨架(侧边栏、顶栏)里的 [data-icon] 填成图标。
     * 视图内部的图标由各自 render() 负责,但侧边栏/顶栏不属于任何视图,
     * 必须在这里统一处理一次 —— 否则会看到"图标位置是空的"。
     */
    window.U.hydrateIcons(document);

    await loadSettings();
    window.SapplyTheme();
    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if ((window.S.settings.theme || 'light') === 'system') window.SapplyTheme();
      });
    } catch (_) {}

    await reloadInfo();
    await refreshAccount();

    // 恢复上次用过的文件夹(只恢复路径并静默体检,不自动上传、也不跳过登录)
    if (window.S.account) {
      let last = null;
      try { last = localStorage.getItem('gpe.lastFolder'); } catch (_) {}
      if (last) {
        const r = await window.gpe.folder.inspect(last);
        if (r.ok) {
          window.S.folder = last;
          window.S.folderInfo = r.data;
          window.S.scan = r.data.scan;
          window.ViewProjects.remember(r.data);
        }
      }
    }

    go(window.S.account ? 'home' : 'login');
    hintKnowledgeBase();
  }

  /** 首次启动时轻轻提示一下知识库的存在(只说一次) */
  function hintKnowledgeBase() {
    let seen = false;
    try { seen = localStorage.getItem('gpe.kbHinted') === '1'; } catch (_) {}
    if (seen) return;
    try { localStorage.setItem('gpe.kbHinted', '1'); } catch (_) {}
    setTimeout(() => {
      window.U.toast('info', '顺便说一句',
        '左侧「Git 小课堂」和「命令速查」里有一个完整的 Git 知识库(快捷键 Ctrl+K):概念、流程图、8 节课、116 条命令、报错对照。不看也完全不影响使用。',
        { duration: 11000 });
    }, 2800);
  }

  /* ------------------------------------------------------------ 绑定 */

  /** 空安全的绑定:元素不存在时安静跳过,绝不抛错 */
  function on(sel, evt, fn) {
    const node = $(sel);
    if (node) node.addEventListener(evt, fn);
    return node;
  }

  function bindSidebar() {
    on('#sideNav', 'click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (!btn) return;
      go(btn.getAttribute('data-view'));
    });

    on('#navKbTutorial', 'click', () => window.KB.open('tutorials'));
    on('#navKbCommands', 'click', () => window.KB.open('commands'));
    on('#navSettings', 'click', () => window.Settings.open());
  }

  function bindTopbar() {
    on('#themeBtn', 'click', async () => {
      const order = ['light', 'dark', 'system'];
      const next = order[(order.indexOf(window.S.settings.theme || 'light') + 1) % order.length];
      window.S.settings.theme = next;
      window.SapplyTheme();
      updateThemeBtn();
      const r = await window.gpe.settings.set({ theme: next });
      if (!r.ok) window.U.toast('error', '保存主题设置失败', r.error);
      window.U.toast('info', '主题:' + ({ system: '跟随系统', light: '亮色', dark: '暗色' }[next]), '', { duration: 1500 });
    });

    on('#kbBtn', 'click', () => window.KB.toggle());
    on('#fabHelp', 'click', () => helpForCurrent());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.Settings.close();
        if (window.KB.isOpen()) window.KB.close();
      }
      if ((e.ctrlKey || e.metaKey) && /^[1-4]$/.test(e.key)) {
        const map = ['home', 'projects', 'records', 'login'];
        e.preventDefault();
        go(map[Number(e.key) - 1]);
      }
    });
  }

  /** 右下角 "?" 按钮:打开与当前这一步相关的知识 */
  function helpForCurrent() {
    if (current === 'login') return window.KB.open('tutorials', 'auth');
    if (current === 'home') return window.KB.open('concepts');
    if (current === 'changes') return window.KB.open('diagrams');
    if (current === 'status') return window.KB.open('cheat');
    if (current === 'projects') return window.KB.open('tutorials', 'first-upload');
    if (current === 'records') return window.KB.open('troubleshoot');
    return window.KB.open('concepts');
  }

  function bindDragDrop() {
    // 阻止 Electron 默认的"拖入文件就导航到该文件"行为
    ['dragover', 'drop'].forEach((ev) => {
      window.addEventListener(ev, (e) => { e.preventDefault(); });
    });

    // 把文件夹拖到窗口任意位置都能开始
    window.addEventListener('drop', async (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!window.S.account) {
        window.U.toast('warn', '请先登录 GitHub', '登录之后再拖入文件夹。');
        go('login');
        return;
      }
      let p = '';
      try { p = window.gpe.getPathForFile(f) || f.path || ''; } catch (_) {}
      if (!p) {
        window.U.toast('warn', '无法识别拖入的内容', '请改用"浏览文件夹"按钮。');
        return;
      }
      go('home');
      await window.ViewHome.select(p);
    });
  }

  /* ============================================================ 导航 */

  function go(view) {
    if (VIEWS.indexOf(view) === -1) view = 'home';

    // 前置条件:没登录不能看需要账号的部分
    if (view !== 'login' && !window.S.account) {
      if (view === 'home' || view === 'projects' || view === 'records') {
        // 这些页面本身可以看,只是操作会要求登录
      } else {
        window.U.toast('warn', '请先登录 GitHub', '登录之后才能上传。');
        view = 'login';
      }
    }
    if (view === 'changes' && !window.S.folder) {
      window.U.toast('warn', '请先选择一个文件夹');
      view = 'home';
    }

    current = view;
    VIEWS.forEach((v) => {
      const node = $('#view-' + v);
      if (node) node.classList.toggle('active', v === view);
    });
    paintNav();

    if (view === 'home') window.ViewHome.render();
    else if (view === 'projects') window.ViewProjects.render();
    else if (view === 'records') window.ViewProjects.renderRecords();
    else if (view === 'history') window.ViewHistory.render();
    else if (view === 'login') window.ViewLogin.render();
    else if (view === 'changes') window.ViewChanges.render();
    else if (view === 'status') window.ViewStatus.render();

    // 离开"查看变更"时停止文件轮询并在需要时关掉浮动状态
    if (view !== 'changes') {
      window.ViewChanges.hideFloat();
      window.ViewChanges.stopWatch();
    }
  }

  function paintNav() {
    const target = NAV_OF[current];
    $$('#sideNav [data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === target);
    });
  }

  function currentView() {
    return current;
  }

  /* ============================================================ 账号 */

  /**
   * 重新读取账号列表并同步当前账号。
   *
   * 这里有一个容易踩的坑:主进程用 `lastLogin` 记住"上次用的是谁",
   * 但用户可能刚刚把它删掉了。如果无脑用 lastLogin 回填 S.account,
   * 就会出现"明明退出了,右上角还显示已登录"。
   * 所以规则是:
   *   · 如果当前已有 S.account,先确认它仍然存在于列表里 —— 不存在就清空
   *   · 只有当前为空时,才用 lastLogin 恢复
   */
  async function refreshAccount() {
    const r = await window.gpe.accounts.list();
    if (!r.ok) return window.S.account;
    const list = r.data.accounts || [];
    window.S.accounts = list;

    const currentLogin = window.S.account && window.S.account.login;
    if (currentLogin && list.some((a) => a.login === currentLogin)) {
      setAccountFromLogin(currentLogin, true);      // 当前账号还在 —— 刷新它的信息
    } else {
      /**
       * 当前账号已经不在了(被删除 / 或指向一个不存在的账号)。
       *
       * 这里【不再】用 lastLogin 去"猜一个"账号出来:主进程的 lastLogin
       * 可能因为删除时序而残留旧值,用它回填会造成
       * "明明退出了,右上角还显示已登录"。
       * 只有 lastLogin 确实存在于列表里时,才恢复它。
       */
      const fallback = r.data.last && list.some((a) => a.login === r.data.last) ? r.data.last : null;
      if (fallback) setAccountFromLogin(fallback, true);
      else window.S.account = null;
    }

    /**
     * 统一在这里重绘药丸。
     * 注意:上面几处 setAccountFromLogin(..., true) 是"静默"的,
     * 不会自己重绘 —— 必须由这里收口,否则账号变了界面还是旧的
     * (实测踩过:登录成功了但右上角仍显示"登录 GitHub")。
     */
    renderAccountPill();
    return window.S.account;
  }

  /**
   * 直接用一次登录请求返回的数据落位账号。
   * 比"登录后再查一遍列表"更可靠 —— 不依赖主进程 lastLogin 的时序。
   */
  async function applyLogin(login, profile) {
    // 先把列表刷新出来(此时磁盘上已经写好了新账号)
    await refreshAccount();
    if (login && (window.S.accounts || []).some((a) => a.login === login)) {
      setAccountFromLogin(login);
    } else if (login) {
      // 列表读取失败也不影响本次登录:直接用返回的 profile 兜底
      window.S.account = {
        login,
        name: (profile && (profile.name || profile.login)) || login,
        avatar: (profile && (profile.avatar || profile.avatar_url)) || '',
        scopes: (profile && profile.scopes) || '',
        method: (profile && profile.method) || 'token',
      };
      renderAccountPill();
    }
    return window.S.account;
  }

  /**
   * 切换到本机已保存的另一个账号。
   *
   * 关键点:点击"切换账号"时如果本机只有当前这一个账号,switchAccount
   * 会找不到可切的目标而"什么都不发生" —— 用户的感觉就是按钮坏了。
   * 所以这里在如下情况直接把人带到登录页(那里才能添加账号):
   *   · 本机只有当前账号
   *   · 目标账号已不存在
   * 同时每次切换都会向主进程重新取一次列表,避免用到过期的缓存。
   */
  async function switchAccount(login) {
    closeAccountMenu();
    const r = await window.gpe.accounts.list();
    if (r.ok) window.S.accounts = r.data.accounts || [];
    const list = window.S.accounts || [];

    const others = list.filter((a) => !window.S.account || a.login !== window.S.account.login);

    // 没有别的账号可切 —— 直接去登录页添加
    if (!others.length) {
      window.U.toast('info', '本机只保存了一个账号', '在登录页可以添加另一个 GitHub 账号;想换回去用同一个账号直接登录即可。');
      go('login');
      return;
    }

    if (!login) {
      // 没指定目标:只有一个候选就直接切过去
      if (others.length === 1) return switchAccount(others[0].login);
      go('login');
      return;
    }

    if (window.S.account && window.S.account.login === login) return;

    if (!list.some((a) => a.login === login)) {
      window.U.toast('error', '这个账号的本机登录信息已经不存在了', '请重新登录。');
      await refreshAccount();
      go('login');
      return;
    }

    setAccountFromLogin(login);
    window.U.toast('ok', '已切换到 @' + login);
    // 换了账号,之前的分析结果不再可信,回到首页重新判断
    window.S.analysis = null;
    window.S.recentRepos = [];
    if (current === 'changes' || current === 'status') go('home');
    else if (current === 'home') window.ViewHome.render();
    else if (current === 'login') window.ViewLogin.render();
  }

  /**
   * 退出登录 —— 默认行为:只取消自动登录,【保留】本机保存的凭据。
   * 下次在账号列表里点一下就能回来,不用重新生成令牌。
   */
  async function signOutAccount(login) {
    const target = login || (window.S.account && window.S.account.login);
    if (!target) { closeAccountMenu(); return; }

    const r = await window.gpe.accounts.signOut(target);
    if (!r.ok) { window.U.toast('error', '退出失败', r.error); return; }

    if (window.S.account && window.S.account.login === target) window.S.account = null;
    await refreshAccount();
    closeAccountMenu();
    window.U.toast('ok', '已退出 @' + target, '本机仍保留它的登录信息,想再用时在账号菜单里选它即可。');

    if (current === 'login') window.ViewLogin.render();
    else if (current === 'changes' || current === 'status') go('home');
  }

  /**
   * 彻底删除本机登录信息(需要用户明确确认)。
   * 这是不可逆操作,所以和"退出登录"分开,单独走这里。
   */
  async function forgetAccount(login) {
    if (!login) return;
    const yes = confirm(
      '确定要删除 @' + login + ' 的本机登录信息吗?\n\n' +
      '· 删除后需要重新登录(重新粘贴令牌或重新授权)\n' +
      '· 已经上传到 GitHub 上的文件不受任何影响\n' +
      '· 如果只是想换个账号用,选"退出登录"就够了'
    );
    if (!yes) return;

    const r = await window.gpe.accounts.remove(login);
    if (!r.ok) { window.U.toast('error', '删除失败', r.error); return; }

    if (window.S.account && window.S.account.login === login) window.S.account = null;
    await refreshAccount();
    closeAccountMenu();
    window.U.toast('ok', '已删除 @' + login + ' 的本机登录信息');

    if (current === 'login') window.ViewLogin.render();
    else if (current === 'changes' || current === 'status') go('home');
  }

  /**
   * 把 S.account 设为列表里的某个账号。
   * @param silent true 时不重绘药丸(由调用方统一重绘,避免重复渲染)
   */
  function setAccountFromLogin(login, silent) {
    const found = (window.S.accounts || []).find((a) => a.login === login);
    if (!found) {
      // 找不到就清空 —— 绝不能保留一个已经不存在的账号
      window.S.account = null;
      if (!silent) renderAccountPill();
      return false;
    }
    window.S.account = {
      login: found.login,
      name: found.name || found.login,
      avatar: found.avatar,
      scopes: found.scopes,
      method: found.method,
    };
    if (!silent) renderAccountPill();
    return true;
  }

  /* ------------------------------------------------------------ 账号下拉菜单 */

  let accountMenuOpen = false;

  function closeAccountMenu() {
    const menu = $('#accountMenu');
    if (menu) menu.remove();
    accountMenuOpen = false;
  }

  function toggleAccountMenu() {
    if (accountMenuOpen) closeAccountMenu();
    else openAccountMenu();
  }

  function openAccountMenu() {
    closeAccountMenu();
    const box = $('#accountBox');
    if (!box) return;

    const a = window.S.account;
    const others = (window.S.accounts || []).filter((x) => !a || x.login !== a.login);

    const menu = el('div', { class: 'account-menu', id: 'accountMenu', role: 'menu' });

    if (a) {
      menu.appendChild(el('div', { class: 'am-head' }, [
        avatarNode(a, 34),
        el('div', { class: 'flex-1', style: { minWidth: 0 } }, [
          el('div', { class: 'am-name truncate', text: a.name || a.login }),
          el('div', { class: 'am-sub truncate', text: '@' + a.login }),
        ]),
      ]));
      menu.appendChild(el('div', { class: 'am-divider' }));
      menu.appendChild(menuItem('external', '打开我的 GitHub', () => {
        window.gpe.openExternal('https://github.com/' + a.login);
        closeAccountMenu();
      }));
    } else {
      menu.appendChild(el('div', { class: 'am-empty', text: '还没有登录 GitHub' }));
      menu.appendChild(el('div', { class: 'am-divider' }));
    }

    menu.appendChild(menuItem('plus', '添加账号 / 登录', () => {
      closeAccountMenu();
      go('login');
    }));

    if (others.length) {
      menu.appendChild(el('div', { class: 'am-divider' }));
      menu.appendChild(el('div', { class: 'am-label', text: '切换账号' }));
      for (const o of others) {
        menu.appendChild(menuItem(null, null, () => switchAccount(o.login), {
          avatar: o,
          title: o.login,
          sub: methodLabel(o.method) + (o.name && o.name !== o.login ? ' · ' + o.name : ''),
        }));
      }
    }

    if (a) {
      menu.appendChild(el('div', { class: 'am-divider' }));
      // 默认语义是"退出登录":保留本机凭据,随时能回来
      menu.appendChild(menuItem('logout', '退出登录', () => signOutAccount(a.login)));
      menu.appendChild(menuItem('trash', '删除本机登录信息…', () => forgetAccount(a.login), { danger: true }));
    }

    box.appendChild(menu);
    accountMenuOpen = true;
    window.U.hydrateIcons(menu);

    // 点别处 / 按 Esc 关闭
    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onDocKey, true);
    }, 0);

    function onDocClick(e) {
      if (menu.contains(e.target) || box.contains(e.target)) return;
      cleanup();
    }
    function onDocKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); cleanup(); }
    }
    function cleanup() {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onDocKey, true);
      closeAccountMenu();
    }
  }

  function menuItem(icon, text, onclick, opts) {
    opts = opts || {};
    const children = [];
    if (opts.avatar) {
      const av = opts.avatar;
      children.push(av.avatar
        ? el('img', { class: 'am-avatar', src: av.avatar, alt: '', referrerpolicy: 'no-referrer' })
        : el('span', { class: 'am-avatar ph' }, [window.Art.icon('user', { size: 15 })]));
      children.push(el('div', { class: 'flex-1', style: { minWidth: 0 } }, [
        el('div', { class: 'am-name truncate', text: opts.title || '' }),
        opts.sub ? el('div', { class: 'am-sub truncate', text: opts.sub }) : null,
      ]));
    } else {
      if (icon) children.push(el('span', { class: 'am-ico', 'data-icon': icon, 'data-icon-size': '15' }));
      children.push(el('span', { class: 'flex-1', text: text }));
    }
    const node = el('button', {
      class: 'am-item' + (opts.danger ? ' danger' : ''),
      type: 'button', role: 'menuitem',
      onclick,
    }, children);
    return node;
  }

  function confirmRemove(login) {
    forgetAccount(login);
  }

  function avatarNode(a, size) {
    const style = { width: size + 'px', height: size + 'px', borderRadius: '50%', flex: 'none', objectFit: 'cover' };
    if (a && a.avatar) {
      return el('img', { src: a.avatar, alt: '', referrerpolicy: 'no-referrer', style });
    }
    return el('span', {
      style: Object.assign({}, style, {
        background: 'var(--brand-soft)', display: 'grid', placeItems: 'center', color: 'var(--brand-deep)',
      }),
    }, [window.Art.icon('user', { size: Math.round(size * 0.55) })]);
  }

  function methodLabel(m) {
    return { device: '浏览器授权', token: '访问令牌', gcm: '本机凭据' }[m] || m;
  }

  /** 右上角显示登录状态的小药丸(点击展开菜单) */
  function renderAccountPill() {
    const box = clear($('#accountBox'));
    if (!box) return;
    updateThemeBtn();
    closeAccountMenu();

    const a = window.S.account;
    const pill = el('button', {
      class: 'account-pill' + (a ? '' : ' is-off'),
      type: 'button',
      title: a ? (a.name + '(@' + a.login + ')') : '点击登录 GitHub',
      onclick: (e) => { e.stopPropagation(); toggleAccountMenu(); },
    }, [
      a && a.avatar
        ? el('img', { class: 'avatar', src: a.avatar, referrerpolicy: 'no-referrer', alt: '' })
        : el('span', { class: 'avatar ph' }, [window.Art.icon('user', { size: 13 })]),
      el('span', { class: 'who', text: a ? ('已登录 ' + a.login) : '登录 GitHub' }),
      el('span', { class: 'caret', 'data-icon': 'chevronDown', 'data-icon-size': '13' }),
    ]);
    box.appendChild(pill);
    window.U.hydrateIcons(box);
  }

  function updateThemeBtn() {
    const btn = $('#themeBtn');
    if (!btn) return;
    const t = window.S.settings.theme || 'light';
    const shape = { system: 'activity', light: 'sun', dark: 'moon' }[t] || 'sun';
    clear(btn).appendChild(window.Art.icon(shape, { size: 17 }));
    btn.title = '主题:当前 ' + ({ system: '跟随系统', light: '亮色', dark: '暗色' }[t] || '') + '(点击切换)';
  }

  /* ============================================================ 数据 */

  async function loadSettings() {
    const r = await window.gpe.settings.get();
    if (r.ok) window.S.settings = Object.assign(window.S.settings, r.data);
  }

  async function reloadInfo() {
    const r = await window.gpe.info();
    if (r.ok) window.S.info = r.data;
    return window.S.info;
  }

  /* ============================================================ 对外 */

  window.App = {
    go, boot, currentView, refreshAccount, renderAccountPill, reloadInfo, loadSettings,
    setAccountFromLogin, helpForCurrent,
    applyLogin, switchAccount, signOutAccount, forgetAccount,
    openAccountMenu, closeAccountMenu, toggleAccountMenu,
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.__gpeErrors = window.__gpeErrors || [];
    window.addEventListener('error', (e) => {
      window.__gpeErrors.push(String(e.message || e));
      try { window.gpe.reportError({ message: e.message, source: e.filename, line: e.lineno }); } catch (_) {}
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
      window.__gpeErrors.push(msg);
      try { window.gpe.reportError({ message: msg, source: 'promise' }); } catch (_) {}
    });

    boot().catch((e) => {
      window.__gpeErrors.push(String(e && e.message ? e.message : e));
      document.body.appendChild(el('div', {
        class: 'alert error',
        style: { margin: '40px' },
        text: '程序启动失败:' + (e && e.message ? e.message : String(e)) +
          ' —— 可以尝试重新打开程序;若反复出现,请把这段信息反馈给开发者。',
      }));
    });
  });
})();
