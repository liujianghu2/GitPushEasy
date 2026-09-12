/**
 * view-repo.js —— "上传到哪个仓库"的选择器。
 *
 * 三种来源,覆盖所有真实场景:
 *   ① 选一个已有的仓库(列出你名下和你能访问的仓库,可搜索、可分页)
 *   ② 新建一个仓库(私有/公开、可放到组织下)
 *   ③ 直接粘贴仓库地址(适合别人给了你一个仓库、或者你有特殊地址)
 *
 * 选完之后立刻把它设为本地文件夹的 origin 远程,并重新做一次分析。
 */
(function () {
  'use strict';

  const { el, clear, $, esc, timeAgo } = window.U;
  const A = window.Art;

  let dialog = null;
  let dialogMask = null;
  let dialogKeyHandler = null;
  let repos = null;
  let repoPage = 1;
  let repoLoading = false;
  let orgs = [];
  let tab = 'existing';
  let query = '';

  /* ============================================================ 面板 */

  /** 在变更页显示当前仓库与切换入口 */
  function renderPanel(a) {
    return null; // 仓库信息已经合并在状态条里,这里不再单独占位
  }

  /* ============================================================ 弹窗 */

  function openPicker() {
    close();
    dialogMask = el('div', { class: 'overlay-mask open', style: { zIndex: '260' } });
    dialog = el('div', {
      class: 'dialog open fit',
      style: { zIndex: '261', width: 'min(92vw, 780px)' },
      role: 'dialog',
    });

    const searchInput = el('input', {
      class: 'input',
      type: 'search',
      placeholder: '搜索我的仓库…',
      value: query,
      oninput: window.U.debounce((e) => { query = e.target.value; refresh(); }, 180),
    });
    const searchWrap = el('div', { class: 'search-box' }, [
      el('span', { class: 's-ico' }, [
        window.Art.svg('0 0 20 20', {}, [
          window.Art.tag('circle', { cx: 9, cy: 9, r: 5.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }),
          window.Art.tag('path', { d: 'M13.2 13.2 17 17', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', fill: 'none' }),
        ]),
      ]),
      searchInput,
    ]);

    const head = el('div', { class: 'dialog-head' }, [
      el('div', {}, [
        el('div', { class: 'dh-title'}, [U.iconLabel('archive', '上传到哪个 GitHub 仓库?')]),
        el('div', { class: 'dh-sub', text: '选择一个已有仓库,或者新建一个' }),
      ]),
      el('div', { style: { flex: '1' } }),
      el('button', { class: 'x-btn', type: 'button', onclick: close }, [A.icon('close', { size: 16 })]),
    ]);

    // 标签条的内联样式交给 CSS(.dialog > .tabs)统一管理。
    // 之前在这里写死 padding/background,结果被样式表里 `.tabs{overflow-x:auto}`
    // 的收缩行为坑到 —— 高度被压成 18px,标签看着像消失了。
    const tabs = el('nav', { class: 'tabs', id: 'repoTabs' }, [
      tabBtn('existing', '选择一个已有仓库'),
      tabBtn('create', '新建仓库'),
      tabBtn('url', '粘贴地址'),
    ]);

    const content = el('div', { class: 'dialog-body', id: 'repoContent' });

    dialog.appendChild(head);
    dialog.appendChild(tabs);
    dialog.appendChild(content);

    dialogMask.addEventListener('click', close);
    document.body.appendChild(dialogMask);
    document.body.appendChild(dialog);
    dialogKeyHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', dialogKeyHandler);

    paintTabs();
    paint(searchWrap);

    function tabBtn(id, label) {
      const b = el('button', { class: 'tab', type: 'button', 'data-repo-tab': id, text: label });
      b.addEventListener('click', () => { tab = id; paintTabs(); paint(searchWrap); });
      return b;
    }

    function paintTabs() {
      dialog.querySelectorAll('[data-repo-tab]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-repo-tab') === tab);
      });
    }

    function paint(search) {
      const host = clear(content);
      if (tab === 'existing') paintExisting(host, search);
      else if (tab === 'create') paintCreate(host);
      else paintUrl(host);
    }

    if (!repos) loadRepos();
  }

  function paintExisting(host, searchWrap) {
    if (searchWrap) {
      const inner = searchWrap.querySelector('input');
      if (inner && inner.value !== query) inner.value = query;
      host.appendChild(el('div', { class: 'mb-4' }, [searchWrap]));
    }

    if (repoLoading && !repos) {
      host.appendChild(el('div', { class: 'empty' }, [
        el('span', { class: 'spinner', style: { borderColor: 'var(--brand)', borderRightColor: 'transparent', width: '20px', height: '20px' } }),
        el('div', { class: 'text-muted mt-3', text: '正在读取你的仓库列表…' }),
      ]));
      return;
    }

    if (!repos) {
      host.appendChild(el('div', { class: 'empty' }, [
        U.bigIcon('alert'),
        el('h3', { text: '读取仓库列表失败' }),
        el('button', { class: 'btn mt-3', type: 'button', text: '重试', onclick: () => loadRepos(true) }),
      ]));
      return;
    }

    const q = query.trim().toLowerCase();
    const list = q ? repos.filter((r) => r.full_name.toLowerCase().includes(q)) : repos;

    if (!list.length) {
      host.appendChild(el('div', { class: 'empty' }, [
        U.bigIcon('search'),
        el('h3', { text: q ? '没有匹配的仓库' : '你还没有任何仓库' }),
        el('button', { class: 'btn primary mt-3', type: 'button', text: '去新建一个', onclick: () => { tab = 'create'; paintTabs(); paint(); } }),
      ]));
      return;
    }

    host.appendChild(el('div', { class: 'text-xs text-subtle mb-3', text:
      `共找到 ${list.length} 个仓库。点击即可选中,程序会把它设为这个文件夹的上传目标。` }));

    host.appendChild(el('div', { class: 'repo-grid' }, list.map((r) => el('button', {
      class: 'repo-item', type: 'button',
      onclick: () => select(r.clone_url, r.full_name),
    }, [
      el('span', { class: 'ic', style: { color: 'var(--fg-muted)' } }, [A.icon(r.private ? 'lock' : 'globe', { size: 16 })]),
      el('div', { class: 'flex-1', style: { minWidth: 0 } }, [
        el('div', { class: 'r-name truncate', text: r.full_name }),
        el('div', { class: 'r-meta truncate', text: (r.description || '没有描述') + ' · ' + (r.private ? '私有' : '公开') + (r.pushed_at ? ' · 最后推送 ' + timeAgo(r.pushed_at) : '') }),
      ]),
      el('span', { class: 'text-subtle', text: '选择 ›' }),
    ]))));

    // 分页
    if (!q) {
      host.appendChild(el('div', { class: 'flex justify-center gap-2 mt-5' }, [
        el('button', {
          class: 'btn sm', type: 'button', text: '← 上一页',
          disabled: repoPage <= 1,
          onclick: () => { repoPage -= 1; loadRepos(true); },
        }),
        el('span', { class: 'text-sm text-muted', style: { alignSelf: 'center' }, text: '第 ' + repoPage + ' 页' }),
        el('button', {
          class: 'btn sm', type: 'button', text: '下一页 →',
          disabled: repos.length < 100,
          onclick: () => { repoPage += 1; loadRepos(true); },
        }),
      ]));
    }

    host.appendChild(el('div', { class: 'hr dashed' }));
    host.appendChild(el('div', { class: 'text-xs text-subtle', html:
      '找不到想要的?它可能在别的账号下,或者你需要先有权限。也可以切到 <strong>「粘贴地址」</strong> 直接填仓库 URL。' }));
  }

  function paintCreate(host) {
    const nameInput = el('input', {
      class: 'input', type: 'text',
      placeholder: '例如:my-first-project',
      value: window.S.folderInfo && window.S.folderInfo.name
        ? sanitizeRepoName(window.S.folderInfo.name) : '',
    });
    const descInput = el('input', { class: 'input', type: 'text', placeholder: '可选。一句话说明这个项目是干什么的' });

    const visPrivate = el('input', { type: 'radio', name: 'visibility', value: 'private', checked: window.S.settings.defaultVisibility !== 'public' });
    const visPublic = el('input', { type: 'radio', name: 'visibility', value: 'public', checked: window.S.settings.defaultVisibility === 'public' });

    const orgSelect = el('select', { class: 'select' }, [
      el('option', { value: '', text: '我的个人账号(' + (window.S.account ? window.S.account.login : '') + ')' }),
      ...orgs.map((o) => el('option', { value: o.login, text: '组织:' + o.login })),
    ]);

    const autoInit = el('input', { type: 'checkbox' });

    const errBox = el('div');

    const createBtn = el('button', { class: 'btn primary lg', type: 'button', text: '创建并关联这个文件夹' });
    createBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) { window.U.toast('warn', '请先填写仓库名'); nameInput.focus(); return; }
      const restore = window.U.busy(createBtn, '正在创建…');
      clear(errBox);
      const r = await window.gpe.gh.createRepo({
        login: window.S.account ? window.S.account.login : null,
        name,
        description: descInput.value.trim(),
        private: visPrivate.checked,
        org: orgSelect.value,
        autoInit: autoInit.checked,
      });
      restore();
      if (!r.ok) {
        errBox.appendChild(el('div', { class: 'alert error mt-3' }, [
          U.alertIcon('alert'),
          el('div', { class: 'body' }, [
            el('div', { text: r.error }),
            el('div', { class: 'text-xs text-subtle mt-2', text:
              '常见原因:仓库名已被你自己的账号占用;或者令牌缺少创建仓库的权限(需要 repo 权限)。' }),
          ]),
        ]));
        return;
      }
      repos = null; // 下次打开列表时重新拉取
      await select(r.data.clone_url, r.data.full_name);
    });

    host.appendChild(el('div', { class: 'alert info mb-5' }, [
      U.alertIcon('info'),
      el('div', { class: 'body', html:
        '程序会调用 GitHub 官方接口创建 <strong>一个空仓库</strong>,然后把你这个文件夹的内容推上去。' +
        '不会勾选 "Add a README",因为那会让首次推送产生不必要的冲突。' }),
    ]));

    host.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', text: '仓库名称 *' }),
      nameInput,
      el('div', { class: 'text-xs text-subtle mt-2', text: '只能用字母、数字、点、下划线和短横线。建议用英文,避免兼容问题。' }),
    ]));

    host.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', text: '项目描述' }),
      descInput,
    ]));

    if (orgs.length) {
      host.appendChild(el('div', { class: 'field' }, [
        el('label', { class: 'label', text: '放到哪个账号下' }),
        orgSelect,
      ]));
    }

    host.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', text: '谁能看到' }),
      el('label', { class: 'check' }, [
        visPrivate,
        el('span', { class: 'txt' }, [
          U.iconLabel('lock', '私有(推荐)'),
          el('span', { class: 'sub', text: '只有你和你邀请的人能看到。随时可以在 GitHub 上改成公开。' }),
        ]),
      ]),
      el('label', { class: 'check' }, [
        visPublic,
        el('span', { class: 'txt' }, [
          U.iconLabel('globe', '公开'),
          el('span', { class: 'sub', text: '全世界都能看到和下载。确认代码里没有密码、密钥、个人隐私再选这个。' }),
        ]),
      ]),
    ]));

    host.appendChild(el('label', { class: 'check mb-4' }, [
      autoInit,
      el('span', { class: 'txt' }, [
        el('span', { text: '同时创建一个 README 文件' }),
        el('span', { class: 'sub', text: '一般不要勾。勾了的话仓库里会先有一个提交,你上传时需要先同步一次(程序会自动处理)。' }),
      ]),
    ]));

    host.appendChild(errBox);
    host.appendChild(el('div', { class: 'flex gap-2' }, [
      createBtn,
      el('button', {
        class: 'btn', type: 'button', text: '↗ 去 GitHub 网站上手动建',
        onclick: () => window.gpe.openExternal('https://github.com/new'),
      }),
    ]));
  }

  function paintUrl(host) {
    const input = el('input', {
      class: 'input mono', type: 'text', placeholder: 'https://github.com/用户名/仓库名.git',
      value: window.S.analysis && window.S.analysis.remoteUrl ? window.S.analysis.remoteUrl : '',
    });
    const errBox = el('div');

    const okBtn = el('button', { class: 'btn primary lg', type: 'button', text: '使用这个地址' });
    okBtn.addEventListener('click', async () => {
      const url = input.value.trim();
      if (!url) { window.U.toast('warn', '请填写仓库地址'); return; }
      if (!/github\.com/i.test(url) && !/^[\w.-]+\/[\w.-]+$/.test(url)) {
        clear(errBox).appendChild(el('div', { class: 'alert warn mt-3' }, [
          U.alertIcon('alert'),
          el('div', { class: 'body', text: '这看起来不像 GitHub 地址。本工具只支持 github.com 上的仓库。' }),
        ]));
        return;
      }
      const full = /^https?:|^git@|^ssh:/.test(url) ? null : url;
      const finalUrl = full ? `https://github.com/${full}.git` : url;
      await select(finalUrl, full);
    });

    host.appendChild(el('div', { class: 'alert info mb-5' }, [
      U.alertIcon('info'),
      el('div', { class: 'body', html:
        '支持 <code>https://github.com/用户名/仓库.git</code>、<code>git@github.com:用户名/仓库.git</code>,' +
        '也可以只填 <code>用户名/仓库名</code>。' }),
    ]));

    host.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', text: '仓库地址' }),
      input,
    ]));

    host.appendChild(el('div', { class: 'alert warn mb-5' }, [
      U.alertIcon('alert'),
      el('div', { class: 'body', html:
        '如果这个仓库里已经有内容(不是空的),而你本地的历史跟它对不上,' +
        '上传时会被拒绝。程序会检测到并引导你选择"合并"或"新建分支",不会强行覆盖。' }),
    ]));

    host.appendChild(errBox);
    host.appendChild(okBtn);
  }

  /* ============================================================ 数据 */

  async function loadRepos(force) {
    if (repoLoading) return;
    if (repos && !force) return;
    repoLoading = true;
    const content = $('#repoContent');
    if (content && tab === 'existing') {
      clear(content);
      content.appendChild(el('div', { class: 'empty' }, [
        el('span', { class: 'spinner', style: { borderColor: 'var(--brand)', borderRightColor: 'transparent', width: '20px', height: '20px' } }),
        el('div', { class: 'text-muted mt-3', text: '正在读取你的仓库列表…' }),
      ]));
    }

    const [r, o] = await Promise.all([
      window.gpe.gh.repos({ login: window.S.account ? window.S.account.login : null, page: repoPage }),
      window.gpe.gh.orgs({ login: window.S.account ? window.S.account.login : null }),
    ]);

    repoLoading = false;
    if (r.ok) repos = r.data.repos;
    if (o.ok) orgs = o.data || [];

    // 重绘(重新构造搜索框)
    const searchWrap = el('div', { class: 'search-box' }, [
      el('span', { class: 's-ico' }, [
        window.Art.svg('0 0 20 20', {}, [
          window.Art.tag('circle', { cx: 9, cy: 9, r: 5.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }),
          window.Art.tag('path', { d: 'M13.2 13.2 17 17', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', fill: 'none' }),
        ]),
      ]),
      el('input', {
        class: 'input', type: 'search', placeholder: '搜索我的仓库…', value: query,
        oninput: window.U.debounce((e) => { query = e.target.value; refresh(); }, 180),
      }),
    ]);
    refresh(searchWrap);
  }

  /** 只重绘内容,不动弹窗结构 */
  function refresh(searchWrap) {
    const content = $('#repoContent');
    if (!content || tab !== 'existing') return;
    if (!searchWrap) {
      searchWrap = el('div', { class: 'search-box' }, [
        el('span', { class: 's-ico' }, [
          window.Art.svg('0 0 20 20', {}, [
            window.Art.tag('circle', { cx: 9, cy: 9, r: 5.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }),
            window.Art.tag('path', { d: 'M13.2 13.2 17 17', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', fill: 'none' }),
          ]),
        ]),
        el('input', {
          class: 'input', type: 'search', placeholder: '搜索我的仓库…', value: query,
          oninput: window.U.debounce((e) => { query = e.target.value; refresh(); }, 180),
        }),
      ]);
    }
    clear(content);
    paintExisting(content, searchWrap);
  }

  function paintExistingRefresh() { refresh(); }

  /* ============================================================ 选择 */

  async function select(cloneUrl, fullName) {
    const dir = window.S.folder;

    /**
     * 创建/选择一个 GitHub 仓库本身和"本地是否已选文件夹"无关。
     * 所以这里不再把用户赶回首页 —— 没有文件夹时就只记下选择,
     * 等他选好文件夹后再由界面提示关联。
     */
    if (!dir) {
      const label = fullName || cloneUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
      window.S.pendingRemote = { url: cloneUrl, fullName: label };
      close();
      window.U.toast('info', '已选中仓库 ' + label, '接下来选择要上传的本地文件夹,程序会自动关联它。', { duration: 6000 });
      window.App.go('home');
      return;
    }

    const r = await window.gpe.repo.setRemote({ dir, url: cloneUrl, remote: 'origin' });
    if (!r.ok) {
      window.U.toast('error', '关联仓库失败', r.error);
      return;
    }

    const label = fullName || cloneUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    // 记进"最近用过的仓库",首页下拉框可以直接切换
    window.ViewHome.rememberRepo({ full_name: label, clone_url: cloneUrl });

    window.S.repo = { fullName: label };
    window.S.selectedPaths = null;
    window.S.analysis = null;
    close();
    window.U.toast('ok', '已关联仓库', label + ' —— 正在重新检查…', { duration: 3000 });

    if (window.App.currentView() === 'changes') window.ViewChanges.render();
    else {
      window.App.go('home');
      window.ViewHome.reanalyze();
    }
  }

  function sanitizeRepoName(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w.-]/g, '')
      .slice(0, 90) || 'my-project';
  }

  function close() {
    if (dialogKeyHandler) {
      document.removeEventListener('keydown', dialogKeyHandler);
      dialogKeyHandler = null;
    }
    if (dialog) { dialog.remove(); dialog = null; }
    if (dialogMask) { dialogMask.remove(); dialogMask = null; }
  }

  window.ViewRepo = { openPicker, renderPanel, close };
})();
