/**
 * view-changes.js —— 查看变更并上传(核心界面)。
 *
 * 布局与首页保持一致:
 *   主区 = 问候 + 步骤条 + 仓库状态 + 变更文件清单 + 提交信息
 *   右栏 = 同步状态 + 最近提交 + 上传方式 + 上传按钮
 *
 * 业务上仍是三件事:
 *   1. 把"现在什么情况"讲清楚(分支、领先/落后、文件变更)
 *   2. 给出【一个】推荐动作,同时把其它安全选项摆在旁边
 *   3. 让用户能逐文件勾选、看 diff、改提交信息、决定是否新建分支
 */
(function () {
  'use strict';

  const { el, clear, $, bytes, esc, num } = window.U;
  const A = window.Art;

  let analyzing = false;
  let progressSteps = [];
  let unsubscribe = null;
  let method = 'current';

  /**
   * 实时监控本地文件改动。
   *
   * 为什么需要:用户改完文件后如果不手动刷新,界面还停在旧的分析结果上。
   * 这里每 3 秒做一次**只读本地**的轻量检查(不联网),发现工作区变了就
   * 自动重新分析并提示,这样"改完立刻能看到"。
   */
  let watchTimer = null;
  let watchFingerprint = null;
  let watchPaused = false;

  function startWatch() {
    stopWatch();
    if (!window.S.folder) return;
    watchTimer = setInterval(pollChanges, 3000);
  }

  function stopWatch() {
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  }

  async function pollChanges() {
    // 正在上传 / 弹窗打开时不打扰
    if (watchPaused || analyzing || window.S.pushing) return;
    if (!window.S.folder || window.App.currentView() !== 'changes') return;
    try {
      const r = await window.gpe.repo.quickStatus(window.S.folder);
      if (!r.ok) return;
      const fp = r.data.fingerprint;
      if (watchFingerprint === null) { watchFingerprint = fp; return; }
      if (fp === watchFingerprint) return;

      // 工作区变了 —— 记下新指纹并重新分析
      watchFingerprint = fp;
      const before = window.S.analysis && window.S.analysis.changes
        ? window.S.analysis.changes.total : null;
      await analyze();
      const after = window.S.analysis && window.S.analysis.changes
        ? window.S.analysis.changes.total : null;
      if (after !== null && after !== before) {
        window.U.toast('info', '检测到本地文件改动',
          `变更文件数 ${before === null ? '—' : before} → ${after},已自动刷新。`, { duration: 3500 });
      }
    } catch (_) { /* 轮询失败静默忽略,不能打扰用户 */ }
  }

  /** 手动刷新:强制重新读取一次本地与远程状态 */
  async function refreshNow(silent) {
    if (analyzing) return;
    watchFingerprint = null;
    if (!silent) window.U.toast('info', '正在重新检查…', '会同时读取 GitHub 上的最新状态', { duration: 1600 });
    await analyze();
  }

  /** 外部(例如 push 开始时)可以暂停/恢复轮询 */
  function setWatchPaused(v) {
    watchPaused = !!v;
    if (v) watchFingerprint = null;
  }

  /* ============================================================ 入口 */

  async function render() {
    const main = clear($('#changesMain'));
    const side = clear($('#changesSide'));
    if (!main) return;

    if (!window.S.folder) {
      stopWatch();
      main.appendChild(emptyState());
      if (side) side.appendChild(sidePlaceholder());
      return;
    }

    /**
     * 每次进入这一屏都**重新分析**一次。
     * 之前这里会复用 window.S.analysis 缓存 —— 用户改了文件再回来看到的
     * 还是旧结果,自然会以为"工具没识别到我的变更"。
     * 重新分析只是一次本地 git status + 一次 fetch,代价可以接受。
     */
    main.appendChild(loadingState());
    if (side) side.appendChild(loadingSide());
    await analyze();
    startWatch();
  }

  function emptyState() {
    return el('div', { class: 'card' }, [
      el('div', { class: 'empty' }, [
        U.bigIcon('folderOpen'),
        el('h3', { text: '还没有选择文件夹' }),
        el('div', { class: 'text-sm', text: '先在首页选择一个要上传的项目文件夹。' }),
        el('button', { class: 'btn primary mt-4', type: 'button', text: '去首页选择文件夹', onclick: () => window.App.go('home') }),
      ]),
    ]);
  }

  function sidePlaceholder() {
    return el('div', { class: 'side-card' }, [
      el('div', { class: 'side-head' }, [el('div', { class: 'side-title', text: '同步状态' })]),
      el('div', { class: 'text-sm text-subtle', text: '选择文件夹后这里会显示同步状态。' }),
    ]);
  }

  function loadingState() {
    return el('div', { class: 'card' }, [
      el('div', { class: 'flex items-center gap-3' }, [
        el('span', { class: 'spinner', style: { borderColor: 'var(--brand)', borderRightColor: 'transparent' } }),
        el('div', { class: 'fw-650', text: '正在对比本地和 GitHub 上的内容…' }),
      ]),
      el('div', { class: 'text-sm text-muted mt-2', text: '会先连接 GitHub 读取远程最新状态,这样给出的建议才是准确的。' }),
      el('div', { class: 'mt-4' }, [
        el('div', { class: 'skeleton', style: { height: '13px', width: '68%', marginBottom: '8px' } }),
        el('div', { class: 'skeleton', style: { height: '13px', width: '44%' } }),
      ]),
    ]);
  }

  function loadingSide() {
    return el('div', { class: 'side-card' }, [
      el('div', { class: 'side-head' }, [
        el('div', { class: 'side-title', text: '同步状态' }),
        el('span', { class: 'count-pill', text: '检查中' }),
      ]),
      el('div', { class: 'skeleton', style: { height: '34px', width: '100%' } }),
    ]);
  }

  async function analyze() {
    if (analyzing) return;
    analyzing = true;
    const r = await window.gpe.repo.analyze({
      dir: window.S.folder,
      login: window.S.account ? window.S.account.login : null,
      strategy: window.S.settings.defaultSyncStrategy,
      scan: window.S.scan,
    });
    analyzing = false;

    const main = clear($('#changesMain'));
    const side = clear($('#changesSide'));
    if (!r.ok) {
      main.appendChild(window.U.buildErrorBox(r, el('div', { class: 'flex gap-2 mt-3' }, [
        el('button', { class: 'btn sm', type: 'button', text: '重试', onclick: () => render() }),
        el('button', { class: 'btn sm', type: 'button', text: '更换文件夹', onclick: () => window.App.go('home') }),
      ])));
      if (side) side.appendChild(sidePlaceholder());
      return;
    }

    window.S.analysis = r.data;
    /**
     * 默认全选。但要把"空数组"也视为"还没初始化过":
     * 首页可能在某些路径下先写入了 [],如果照搬,会变成"一个都不上传"。
     */
    const hasValidSelection = Array.isArray(window.S.selectedPaths) && window.S.selectedPaths.length > 0;
    if (!hasValidSelection && r.data.changes) {
      window.S.selectedPaths = r.data.changes.all.map((f) => f.path);
    }
    method = window.ViewHome.currentPrefs().method || 'merge';
    paint(r.data);
  }

  /* ============================================================ 绘制 */

  function paint(a) {
    const main = clear($('#changesMain'));
    const side = clear($('#changesSide'));
    if (!main) return;

    main.appendChild(renderHero(a));
    main.appendChild(renderSteps(a));
    main.appendChild(renderRepoStatus(a));

    for (const w of a.warnings || []) main.appendChild(renderWarning(w, a));

    if (a.changes && a.changes.total > 0) main.appendChild(renderChangeList(a));
    else main.appendChild(renderNoChanges(a));

    if (a.remoteChanges && a.remoteChanges.length) main.appendChild(renderRemoteChanges(a));
    main.appendChild(renderCommitBox(a));
    main.appendChild(renderFootAction(a));

    if (side) {
      side.appendChild(renderSyncCard(a));
      if (a.commits && a.commits.length) side.appendChild(renderCommitsCard(a));
      side.appendChild(renderMethodCard(a));
      side.appendChild(renderPlanCard(a));
    }
  }

  function renderHero(a) {
    const box = el('div', { class: 'hero' });
    box.appendChild(el('h1', { text: '检查到新的改动,准备上传吗?' }));
    box.appendChild(el('div', { class: 'sub', text: '三步完成:选择文件夹、确认变更、推送到 GitHub' }));

    // 右上角:手动刷新 + 历史记录入口(自监控之外再给用户一个确定的手段)
    const tools = el('div', { class: 'hero-tools' }, [
      el('button', {
        class: 'btn sm', type: 'button', title: '重新读取本地与 GitHub 上的最新状态',
        onclick: (e) => {
          const restore = window.U.busy(e.currentTarget, '检查中…');
          refreshNow().finally(restore);
        },
      }, [U.iconLabel('refresh', '刷新变更')]),
      el('button', {
        class: 'btn sm', type: 'button', title: '查看提交历史并回滚',
        onclick: () => window.App.go('history'),
      }, [U.iconLabel('history', '历史记录')]),
    ]);
    box.appendChild(tools);

    const line = el('div', { class: 'greeting-line' }, [
      el('div', { class: 'cap', text: '先看一眼\n再决定怎么传' }),
      A.greetingArt(),
    ]);
    line.querySelector('.cap').style.whiteSpace = 'pre-line';
    box.appendChild(line);
    return box;
  }

  function timeGreeting() {
    const h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 13) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function renderSteps(a) {
    const done = !!window.S.lastResult;
    const steps = [
      { key: 'home', label: '选择文件夹' },
      { key: 'changes', label: '查看变更' },
      { key: 'status', label: '上传完成' },
    ];
    const active = done ? 2 : 1;
    const box = el('div', { class: 'steps' });
    steps.forEach((s, i) => {
      const state = i < active ? 'done' : i === active ? 'active' : 'todo';
      box.appendChild(el('div', { class: 'step ' + state }, [
        el('button', {
          class: 'step-node', type: 'button',
          disabled: s.key === 'status' && !done,
          onclick: () => {
            if (s.key === 'home') window.App.go('home');
            if (s.key === 'status' && window.S.lastResult) window.App.go('status');
          },
        }, [
          el('span', { class: 'num' }, [el('span', { text: String(i + 1) })]),
          el('span', { class: 'lbl', text: s.label }),
        ]),
      ]));
      if (i < steps.length - 1) box.appendChild(el('div', { class: 'step-line' }));
    });
    return box;
  }

  /* ------------------------------------------------------------ 仓库状态 */

  function renderRepoStatus(a) {
    const card = el('div', { class: 'card' });
    const repoName = a.repoInfo ? a.repoInfo.full_name : (a.remoteUrl || '尚未关联仓库');

    card.appendChild(el('div', { class: 'sec-head row' }, [
      el('div', { style: { minWidth: 0 } }, [
        el('div', { class: 'sec-title mono truncate', text: repoName, title: a.remoteUrl || '' }),
        el('div', { class: 'sec-desc truncate mono', text: a.remoteUrl || '还没有关联 GitHub 仓库' }),
      ]),
      el('div', { class: 'flex items-center gap-2 flex-none' }, [
        a.repoInfo ? el('span', { class: 'badge ' + (a.repoInfo.private ? '' : 'blue') }, [
          U.iconLabel(a.repoInfo.private ? 'lock' : 'globe', a.repoInfo.private ? '私有' : '公开', { size: 11, strokeWidth: 2 }),
        ]) : null,
        a.repoInfo ? el('button', {
          class: 'btn sm', type: 'button', text: '在 GitHub 打开',
          onclick: () => window.gpe.openExternal(a.repoInfo.html_url),
        }) : null,
        el('button', { class: 'btn sm', type: 'button', text: '切换仓库', onclick: () => window.ViewRepo.openPicker() }),
      ]),
    ]));

    card.appendChild(el('div', { class: 'sync-bar' }, [
      el('span', { class: 'badge brand' }, [U.iconLabel('branch', a.branch || 'main', { size: 11, strokeWidth: 2 })]),
      el('span', { class: 'flex-1', text: a.syncLabel || '' }),
      a.hasUpstream && a.ahead > 0 ? el('span', { class: 'badge green', text: '↑ 领先 ' + a.ahead }) : null,
      a.hasUpstream && a.behind > 0 ? el('span', { class: 'badge yellow', text: '↓ 落后 ' + a.behind }) : null,
      a.hasUpstream && a.ahead === 0 && a.behind === 0 ? el('span', { class: 'badge green' }, [U.iconLabel('check', '完全同步', { size: 11, strokeWidth: 2.4 })]) : null,
    ]));

    return card;
  }

  function renderWarning(w, a) {
    const files = w.files || [];
    return el('div', { class: 'card', style: { borderLeft: '3px solid ' + (w.level === 'error' ? 'var(--danger)' : 'var(--warn)') } }, [
      el('div', { class: 'flex items-start gap-3' }, [
        el('span', { class: 'ic ' + (w.level === 'error' ? 'text-danger' : 'text-warn'), style: { marginTop: '2px' } }, [A.icon('alert', { size: 16 })]),
        el('div', { class: 'flex-1' }, [
          el('div', { class: 'text-sm', text: w.text }),
          files.length ? el('div', { class: 'mt-2' }, files.map((f) => el('div', { class: 'flex items-center gap-3 text-sm' }, [
            el('span', { class: 'mono flex-1 truncate', text: f.path || f, title: f.path || f }),
            f.size ? el('span', { class: 'badge red', text: bytes(f.size) }) : null,
          ]))) : null,
          w.level === 'error' && files.length ? el('button', {
            class: 'btn sm mt-2', type: 'button', text: '把它们加入 .gitignore',
            onclick: () => ignoreFiles(files.map((f) => f.path || f)),
          }) : null,
        ]),
      ]),
    ]);
  }

  /* ------------------------------------------------------------ 变更清单 */

  function renderChangeList(a) {
    const card = el('div', { class: 'card' });
    const all = a.changes.all;
    const selected = new Set(window.S.selectedPaths || all.map((f) => f.path));

    card.appendChild(el('div', { class: 'sec-head row' }, [
      el('div', { class: 'flex items-center gap-2' }, [
        el('div', { class: 'sec-title', text: '确认变更内容' }),
        el('span', { class: 'count-pill', id: 'selCount', text: selected.size + ' / ' + all.length }),
      ]),
      el('div', { class: 'flex items-center gap-2' }, [
        el('button', { class: 'btn sm ghost', type: 'button', text: '全选', onclick: () => { all.forEach((f) => selected.add(f.path)); sync(); refresh(); } }),
        el('button', { class: 'btn sm ghost', type: 'button', text: '全不选', onclick: () => { selected.clear(); sync(); refresh(); } }),
        el('button', { class: 'btn sm', type: 'button', text: '↻ 重新检查', onclick: () => { window.S.analysis = null; window.S.selectedPaths = null; render(); } }),
      ]),
    ]));

    const list = el('div', { class: 'change-list' });
    const groups = [
      { label: '🆕 新文件', list: a.changes.untracked },
      { label: '已修改的文件', list: a.changes.unstaged },
      { label: '已在暂存区', list: a.changes.staged.filter((f) => f.state !== 'untracked') },
    ];
    let rendered = false;
    for (const g of groups) {
      if (!g.list || !g.list.length) continue;
      rendered = true;
      list.appendChild(el('div', { class: 'change-group-title', text: g.label + ' · ' + g.list.length }));
      for (const f of g.list) list.appendChild(changeRow(f, selected, refresh));
    }
    if (!rendered) for (const f of all) list.appendChild(changeRow(f, selected, refresh));

    card.appendChild(list);

    function sync() { window.S.selectedPaths = Array.from(selected); }
    function refresh() {
      const counter = $('#selCount');
      if (counter) counter.textContent = selected.size + ' / ' + all.length;
      sync();
      updateActionCard();
      const hp = $('#homeSideCount');
      if (hp) hp.textContent = selected.size + ' / ' + all.length;
    }

    return card;
  }

  function changeRow(f, selected, refresh) {
    const cb = el('input', {
      type: 'checkbox', checked: selected.has(f.path),
      onchange: () => {
        if (cb.checked) selected.add(f.path); else selected.delete(f.path);
        refresh();
      },
    });
    return el('div', { class: 'change-row' }, [
      cb,
      el('span', { class: 'st ' + f.state, text: statusGlyph(f.state), title: f.label }),
      el('span', { class: 'c-path', text: f.path, title: f.path, onclick: () => showDiff(f.path) }),
      el('button', {
        class: 'btn ghost sm', type: 'button', text: '忽略', title: '加入 .gitignore,以后不再上传',
        onclick: (e) => { e.stopPropagation(); ignoreFiles([f.path]); },
      }),
    ]);
  }

  function statusGlyph(state) {
    return { untracked: 'U', modified: 'M', added: 'A', deleted: 'D', renamed: 'R', conflict: '!' }[state] || '?';
  }

  function renderNoChanges(a) {
    if (!a.isRepo || !a.hasCommits) return el('span');
    return el('div', { class: 'card' }, [
      el('div', { class: 'alert ok' }, [
        U.alertIcon('check'),
        el('div', { class: 'body' }, [
          el('div', { class: 'fw-650', text: '没有检测到任何文件改动' }),
          el('div', { class: 'mt-1 text-muted', text: '这个文件夹里的内容和你上次提交时一模一样。' }),
        ]),
      ]),
    ]);
  }

  function renderRemoteChanges(a) {
    return el('details', { class: 'card' }, [
      el('summary', {
        class: 'fw-650 text-sm', style: { cursor: 'pointer' },
        text: `GitHub 上还有 ${a.remoteChanges.length} 个文件是你这边没有的(点开看清单)`,
      }),
      el('div', { class: 'mt-3 section-list' }, a.remoteChanges.map((f) => el('div', { class: 'preview-row' }, [
        el('span', { class: 'st ' + remoteState(f.code), text: f.code.charAt(0) }),
        el('span', { class: 'pr-name', text: f.path, title: f.path }),
      ]))),
    ]);
  }

  function remoteState(code) {
    const c = String(code || '').charAt(0);
    return { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' }[c] || 'modified';
  }

  /* ------------------------------------------------------------ 提交信息 */

  function renderCommitBox(a) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'sec-head' }, [
      el('div', { class: 'sec-title', text: '提交说明' }),
      el('div', { class: 'sec-desc', text: '会显示在 GitHub 的历史记录里,写清楚以后自己好找。' }),
    ]));

    const input = el('textarea', {
      class: 'textarea', id: 'commitMessage', rows: 2,
      placeholder: '简单说一下这次改了什么,例如:新增用户登录页面',
      value: defaultMessage(a),
    });
    card.appendChild(input);

    const advanced = el('details', { class: 'mt-3' });
    advanced.appendChild(el('summary', { class: 'fw-600 text-sm', style: { cursor: 'pointer', padding: '2px 0' }, text: '高级选项' }));

    const newBranchCb = el('input', { type: 'checkbox', checked: window.ViewHome.currentPrefs().method === 'branch' });
    const branchInput = el('input', {
      class: 'input mono', type: 'text', placeholder: '例如:update-20250101',
      value: suggestBranch(), disabled: !newBranchCb.checked,
    });
    newBranchCb.addEventListener('change', () => {
      branchInput.disabled = !newBranchCb.checked;
      if (newBranchCb.checked) branchInput.focus();
    });

    advanced.appendChild(el('div', { class: 'mt-3' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: '同步远程内容的方式' }),
        el('div', { class: 'flex gap-4' }, [
          radio('strategy', 'rebase', '变基(推荐)', true),
          radio('strategy', 'merge', '合并', false),
        ]),
        el('div', { class: 'text-xs text-subtle mt-2', html:
          '<strong>变基</strong>会把你的改动"挪到"别人的改动之后,历史是一条直线,更整洁;' +
          '<strong>合并</strong>会保留两条支线并生成一个合并提交。两者最终代码一样。' }),
      ]),
      el('div', { class: 'side-divider' }),
      el('label', { class: 'check' }, [
        newBranchCb,
        el('span', { class: 'txt' }, [
          el('span', { text: '不要直接传到当前分支,改成传到一条新分支' }),
          el('span', { class: 'sub', text: '最安全:完全不影响 ' + (a.branch || 'main') + ' 分支,之后可以在 GitHub 上发起 Pull Request 合并。' }),
        ]),
      ]),
      el('div', { class: 'mt-2' }, [branchInput]),
    ]));

    card.appendChild(advanced);
    return card;
  }

  function radio(name, value, label, checked) {
    return el('label', { class: 'check', style: { padding: '2px 0' } }, [
      el('input', {
        type: 'radio', name, value,
        checked: checked || window.S.settings.defaultSyncStrategy === value,
      }),
      el('span', { class: 'txt', text: label }),
    ]);
  }

  function defaultMessage(a) {
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    if (a.plan && a.plan.action === 'publish') return '项目初始提交';
    return `更新 (${stamp})`;
  }

  function suggestBranch() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `update-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  /* ============================================================ 右栏 */

  function renderSyncCard(a) {
    const card = el('div', { class: 'side-card' });
    card.appendChild(el('div', { class: 'side-head' }, [
      el('div', { class: 'side-title', text: '同步状态' }),
      el('span', { class: 'count-pill', text: (a.branch || 'main') }),
    ]));

    const rows = [];
    rows.push(el('div', { class: 'stat-row' }, [
      el('span', { class: 'sr-ico mod', text: '↑' }),
      el('span', { class: 'sr-label', text: '本地领先' }),
      el('span', { class: 'sr-val', text: String(a.ahead || 0) }),
    ]));
    rows.push(el('div', { class: 'stat-row' }, [
      el('span', { class: 'sr-ico add', text: '↓' }),
      el('span', { class: 'sr-label', text: '本地落后' }),
      el('span', { class: 'sr-val', text: String(a.behind || 0) }),
    ]));
    rows.push(el('div', { class: 'stat-row' }, [
      el('span', { class: 'sr-ico ' + (a.changes && a.changes.total ? 'del' : 'add'), text: '~' }),
      el('span', { class: 'sr-label', text: '文件变更' }),
      el('span', { class: 'sr-val', text: String((a.changes && a.changes.total) || 0) }),
    ]));
    card.appendChild(el('div', { class: 'stat-list' }, rows));

    card.appendChild(el('div', { class: 'side-divider' }));
    card.appendChild(el('div', { class: 'text-xs text-muted', text: a.syncLabel || '' }));

    if (a.plan) {
      const tone = a.plan.tone === 'danger' ? 'error' : a.plan.tone === 'warn' ? 'warn' : 'info';
      card.appendChild(el('div', { class: 'hint-strip', style: tone === 'error' ? { background: 'var(--danger-soft)' } : tone === 'warn' ? { background: 'var(--warn-soft)' } : null }, [
        el('span', { class: 'hs-ico ic' }, [A.icon(a.plan.tone === 'ok' ? 'check' : 'info', { size: 13 })]),
        el('span', { text: a.plan.reason }),
      ]));
    }
    return card;
  }

  function renderCommitsCard(a) {
    const card = el('div', { class: 'side-card' });
    card.appendChild(el('div', { class: 'side-head' }, [
      el('div', { class: 'side-title', text: '最近提交' }),
      el('span', { class: 'count-pill', text: a.commits.length + ' 条' }),
    ]));
    card.appendChild(el('div', { class: 'preview-list' }, a.commits.slice(0, 4).map((c) => el('div', { class: 'preview-row' }, [
      el('span', { class: 'mono', style: { flex: 'none', color: 'var(--fg-subtle)' }, text: c.short }),
      el('span', { class: 'pr-name', style: { direction: 'ltr', textAlign: 'left', color: 'var(--fg)' }, text: c.subject, title: c.subject }),
    ]))));
    card.appendChild(el('button', {
      class: 'link-more', type: 'button', text: '查看全部提交记录  →',
      onclick: () => window.App.go('records'),
    }));
    return card;
  }

  /**
   * 右栏的"上传方式"卡片。
   *
   * 这里的选项必须和首页完全一致(共用同一份 prefs),否则用户在首页选了
   * "传到 main",到这一屏又看到另一套选项,很容易点出和预期不符的结果。
   */
  function renderMethodCard(a) {
    const card = el('div', { class: 'side-card' });
    card.appendChild(el('div', { class: 'side-head' }, [el('div', { class: 'side-title', text: '上传方式' })]));

    const prefs = window.ViewHome.currentPrefs();
    method = prefs.method || 'current';
    const target = window.ViewHome.effectiveBranch();

    card.appendChild(methodRadio('current', `提交到 ${target}`, `不会新建分支,直接提交到 ${target}。`, method === 'current'));
    card.appendChild(methodRadio('branch', '另建一条新分支上传',
      `推到一条新分支上,${a.branch || target} 保持不动。`, method === 'branch'));

    if (method === 'branch') {
      const input = el('input', {
        class: 'input mono mt-2', type: 'text',
        placeholder: '新分支名',
        value: prefs.newBranch || window.ViewHome.suggestBranchName(),
      });
      input.addEventListener('input', () => {
        const p = window.ViewHome.prefs;
        p.newBranch = input.value.trim();
        try { localStorage.setItem('gpe.homePrefs', JSON.stringify(p)); } catch (_) {}
        updateActionBtnLabel();
      });
      card.appendChild(input);
    }

    card.appendChild(el('div', { class: 'hint-strip' }, [
      el('span', { class: 'hs-ico' }, [A.icon('info', { size: 13 })]),
      el('span', { text: method === 'branch'
        ? '适合不确定是否会影响现有内容时使用'
        : '大多数情况下用这个就好 —— 和 GitHub Desktop 的默认行为一致' }),
    ]));
    return card;
  }

  function methodRadio(value, title, desc, on) {
    const input = el('input', { type: 'radio', name: 'changesMethod', value, checked: on });
    const box = el('label', { class: 'radio-card' + (on ? ' on' : '') }, [
      input,
      el('div', { class: 'rc-body' }, [
        el('div', { class: 'rc-title', text: title }),
        el('div', { class: 'rc-desc', text: desc }),
      ]),
    ]);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      method = value;
      // 同步回首页偏好,保证两处一致
      const p = window.ViewHome.prefs;
      p.method = value;
      if (value === 'branch' && !p.newBranch) p.newBranch = window.ViewHome.suggestBranchName();
      try { localStorage.setItem('gpe.homePrefs', JSON.stringify(p)); } catch (_) {}
      paint(window.S.analysis);
    });
    return box;
  }

  function updateActionCard() {
    updateActionBtnLabel();
  }

  function updateActionBtnLabel() {
    const btn = $('#mainUploadBtn');
    if (!btn) return;
    const a = window.S.analysis;
    btn.textContent = uploadLabel(a);
  }

  function uploadLabel(a) {
    const prefs = window.ViewHome.currentPrefs();
    if (prefs.method === 'branch') {
      return `新建分支 ${prefs.newBranch || window.ViewHome.suggestBranchName()} 并上传  →`;
    }
    const plan = (a && a.plan) || {};
    if (plan.action === 'sync-then-push') return '先同步,再上传  →';
    if (plan.action === 'none') return '已经是最新的';
    const target = window.ViewHome.effectiveBranch();
    return `上传到 ${target}  →`;
  }

  /**
   * 右栏的"上传计划"卡片:讲清楚程序打算怎么做,
   * 以及分叉时可供选择的其它出路。真正的上传按钮放在主区底部,
   * 和首页保持同一个位置习惯 —— 用户永远知道"下一步那个绿按钮在下面"。
   */
  function renderPlanCard(a) {
    const card = el('div', { class: 'side-card', id: 'actionCard' });
    paintPlanCard(card, a);
    return card;
  }

  function paintPlanCard(card, a) {
    const plan = a.plan || { action: 'none', title: '无需操作', reason: '', tone: 'ok' };

    card.appendChild(el('div', { class: 'side-head' }, [
      el('div', { class: 'side-title', text: '上传计划' }),
    ]));

    const tone = plan.tone === 'danger' ? 'error' : plan.tone === 'warn' ? 'warn' : plan.tone === 'ok' ? 'ok' : 'info';
    card.appendChild(el('div', { class: 'check-row ' + (tone === 'info' ? 'info' : tone) }, [
      el('span', { class: 'cr-ico ic' }, [A.icon(plan.tone === 'ok' ? 'check' : plan.tone === 'danger' ? 'alert' : 'info', { size: 13, strokeWidth: 2.2 })]),
      el('div', { class: 'cr-body' }, [
        el('div', { class: 'cr-title', text: plan.title }),
        plan.reason ? el('div', { class: 'cr-sub', text: plan.reason }) : null,
      ]),
    ]));

    // 分叉时需要用户二选一
    if (plan.action === 'choose-diverged') {
      card.appendChild(el('div', { class: 'mt-3' }, (plan.alternatives || []).map((alt) => el('button', {
        class: 'btn block mb-2', type: 'button', text: alt.label,
        onclick: () => doUpload(alt.action === 'push-new-branch'
          ? { action: 'push-new-branch', newBranch: suggestBranch(), commit: true }
          : { action: 'sync-then-push', sync: true, commit: true }),
      }))));
      return;
    }

    if (plan.action === 'resolve') {
      card.appendChild(el('button', {
        class: 'btn danger block mt-3', type: 'button', text: '放弃未完成的合并',
        onclick: () => abortMerge(),
      }));
      return;
    }

    if (plan.action === 'fix-large') {
      card.appendChild(el('button', {
        class: 'btn block mt-3', type: 'button', text: '回到首页处理大文件',
        onclick: () => window.App.go('home'),
      }));
      return;
    }

    if (plan.action === 'publish' && !a.remoteUrl) {
      card.appendChild(el('button', {
        class: 'btn primary block mt-3', type: 'button', text: '选择 / 新建 GitHub 仓库 →',
        onclick: () => window.ViewRepo.openPicker(),
      }));
      return;
    }

    card.appendChild(el('div', { class: 'hint-strip' }, [
      el('span', { class: 'hs-ico ic' }, [A.icon('lock', { size: 13 })]),
      el('span', { html: '只会执行 <code>add</code>/<code>commit</code>/<code>fetch</code>/<code>push</code>,永远不会强制推送或丢弃你的改动。' }),
    ]));
  }

  /** 主区底部:和首页同一位置的绿色大按钮 */
  function renderFootAction(a) {
    const wrap = el('div', { class: 'action-row' });

    const left = el('div', { class: 'flex items-center gap-2 flex-1' });
    const selectedCount = window.S.selectedPaths ? window.S.selectedPaths.length : ((a.changes && a.changes.total) || 0);
    const total = (a.changes && a.changes.total) || 0;
    if (total > 0 && selectedCount !== total) {
      left.appendChild(el('span', { class: 'text-xs text-subtle', text: `将只上传勾选的 ${selectedCount} / ${total} 个文件` }));
    }
    wrap.appendChild(left);

    const plan = a.plan || {};
    if (plan.action === 'none') {
      wrap.appendChild(el('button', {
        class: 'btn lg', type: 'button', text: '返回首页',
        onclick: () => window.App.go('home'),
      }));
      return wrap;
    }
    if (plan.action === 'resolve' || plan.action === 'fix-large' || (plan.action === 'publish' && !a.remoteUrl)) {
      wrap.appendChild(el('button', {
        class: 'btn lg', type: 'button', text: '按右侧提示处理',
        onclick: () => {
          const el2 = document.querySelector('#changesSide .side-card:last-child');
          if (el2) el2.scrollIntoView({ block: 'center', behavior: 'smooth' });
        },
      }));
      return wrap;
    }

    const btn = el('button', {
      class: 'btn primary jumbo', id: 'mainUploadBtn', type: 'button',
      text: uploadLabel(a),
    });
    btn.addEventListener('click', () => doUpload(buildUploadOpts(a)));
    wrap.appendChild(btn);
    return wrap;
  }

  /**
   * 组装上传参数。
   *
   * 分支相关的语义全部来自首页的选择,这里不再自己猜:
   *   · 首页选"另建一条新分支" → 用那里的分支名(用户可见可改)
   *   · 否则 → 提交到用户选定的目标分支('' 表示跟随当前分支)
   * 以前这里会在用户没选新分支的情况下也去读一个隐藏的 checkbox,
   * 结果凭空建出 update-时间戳 分支 —— 这正是用户遇到的问题。
   */
  function buildUploadOpts(a) {
    const strategyEl = document.querySelector('input[name="strategy"]:checked');
    const strategy = (strategyEl && strategyEl.value) || window.S.settings.defaultSyncStrategy;
    const msgEl = $('#commitMessage');

    const prefs = window.ViewHome.currentPrefs();
    const plan = a.plan || {};
    const useNewBranch = prefs.method === 'branch';
    const newBranch = useNewBranch
      ? (prefs.newBranch || window.ViewHome.suggestBranchName())
      : '';

    return {
      action: useNewBranch ? 'push-new-branch'
        : plan.action === 'sync-then-push' ? 'sync-then-push'
          : plan.action === 'push' ? 'push' : 'commit-and-push',
      sync: plan.action === 'sync-then-push' || plan.action === 'behind',
      commit: true,
      strategy,
      message: msgEl ? msgEl.value.trim() : '',
      newBranch,
      targetBranch: useNewBranch ? '' : (prefs.branch || ''),
    };
  }

  /* ============================================================ 执行上传 */

  async function doUpload(opts) {
    const a = window.S.analysis;
    if (!a) return;

    // 上传期间暂停轮询,避免和正在进行的 git 操作打架
    setWatchPaused(true);
    window.S.pushing = true;

    const main = clear($('#changesMain'));
    const side = clear($('#changesSide'));
    progressSteps = [];
    main.appendChild(progressCard(opts));
    if (side) side.appendChild(progressSide());

    if (unsubscribe) { try { unsubscribe(); } catch (_) {} }
    unsubscribe = window.gpe.repo.onProgress((payload) => {
      if (!payload || payload.event !== 'progress') return;
      const p = payload.payload || {};
      const idx = progressSteps.findIndex((s) => s.id === p.id);
      if (idx >= 0) progressSteps[idx] = p; else progressSteps.push(p);
      paintProgress();
    });

    const selected = window.S.selectedPaths;
    const allPaths = a.changes ? a.changes.all.map((f) => f.path) : [];
    /**
     * 只有"用户明确勾选了一部分"时才传 paths 做过滤。
     * 注意空数组必须当作"全部":否则某些路径下 selectedPaths 可能是 [],
     * 一旦把它当过滤条件传给 git,就会提交出空改动 —— 表现为
     * "上传成功,但远程什么都没有"。
     */
    const paths = (Array.isArray(selected) && selected.length > 0 && selected.length !== allPaths.length)
      ? selected
      : null;

    const r = await window.gpe.repo.push({
      dir: window.S.folder,
      login: window.S.account ? window.S.account.login : null,
      action: opts.action || 'auto',
      commit: opts.commit !== false,
      sync: !!opts.sync,
      strategy: opts.strategy || window.S.settings.defaultSyncStrategy,
      message: opts.message || '',
      paths,
      newBranch: opts.newBranch || '',
      baseBranch: a.branch || window.S.settings.defaultBranch,
      branch: a.branch,
      scan: window.S.scan,
    });

    if (unsubscribe) { try { unsubscribe(); } catch (_) {} unsubscribe = null; }

    // 上传结束:恢复轮询(下次轮询会重新建立指纹基线)
    window.S.pushing = false;
    setWatchPaused(false);

    if (r.ok) {
      window.S.lastResult = r.data;
      // 记一笔上传历史
      try {
        window.ViewProjects.addRecord({
          ok: true,
          repo: (r.data.repoUrl || '').replace(/^https?:\/\/github\.com\//, ''),
          folder: window.S.folder,
          branch: r.data.branch,
          commit: r.data.commit ? r.data.commit.message : '',
          url: r.data.url || r.data.repoUrl || '',
        });
      } catch (_) {}
      window.U.toast('ok', r.data.upToDate ? '已经是最新的' : '上传成功!', r.data.commit ? r.data.commit.message : '');
      window.App.go('status');
      return;
    }

    if (Array.isArray(r.steps)) {
      progressSteps = r.steps.map((s) => ({ id: s.id, label: s.label, status: s.status, detail: s.detail }));
      paintProgress();
    }
    try {
      window.ViewProjects.addRecord({
        ok: false, folder: window.S.folder, error: r.error, branch: a.branch,
      });
    } catch (_) {}
    main.appendChild(failureCard(r, opts));
    hideFloat();
  }

  function progressCard(opts) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'flex items-center gap-3' }, [
      el('span', { class: 'spinner', style: { borderColor: 'var(--brand)', borderRightColor: 'transparent' } }),
      el('div', { class: 'flex-1' }, [
        el('div', { class: 'sec-title', text: opts.newBranch ? '正在上传到新分支…' : '正在上传到 GitHub…' }),
        el('div', { class: 'sec-desc', text: '请保持这个窗口打开。文件夹越大、网络越慢,需要的时间越长。' }),
      ]),
    ]));
    card.appendChild(el('div', { class: 'bar indeterminate', id: 'mainBar' }, [el('i')]));
    card.appendChild(el('div', { class: 'progress-list', id: 'progressList' }));
    showFloat('正在上传…', '');
    return card;
  }

  function progressSide() {
    return el('div', { class: 'side-card' }, [
      el('div', { class: 'side-head' }, [
        el('div', { class: 'side-title', text: '上传进度' }),
        el('span', { class: 'pulse' }),
      ]),
      el('div', { class: 'text-xs text-muted', text: '上传过程中请不要关闭窗口。文件夹很大的话会需要几分钟。' }),
    ]);
  }

  function paintProgress() {
    const list = $('#progressList');
    if (!list) return;
    clear(list);
    for (const s of progressSteps) {
      list.appendChild(el('div', { class: 'progress-item ' + s.status }, [
        el('span', { class: 'pi-icon' }),
        el('span', { class: 'pi-label', text: s.label }),
        s.detail ? el('span', { class: 'pi-detail', text: s.detail, title: s.detail }) : null,
      ]));
    }
    const running = progressSteps.find((s) => s.status === 'running');
    if (running) showFloat(running.label, running.detail || '');
    const bar = $('#mainBar');
    if (bar && !running && progressSteps.some((s) => s.status === 'done')) bar.classList.remove('indeterminate');
  }

  function failureCard(r, opts) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'alert error' }, [
      U.alertIcon('alert'),
      el('div', { class: 'body selectable' }, [
        el('div', { class: 'fw-650', text: '上传没有成功' }),
        el('div', { class: 'mt-1', text: r.error }),
        r.code && r.code !== 'ERROR' ? el('div', { class: 'text-xs text-subtle mt-1', text: '错误代码:' + r.code }) : null,
      ]),
    ]));

    const actions = el('div', { class: 'flex gap-2 mt-4 flex-wrap' });
    if (r.code === 'NON_FAST_FORWARD' || r.code === 'PUSH_FAILED') {
      actions.appendChild(el('button', {
        class: 'btn primary', type: 'button', text: '先同步再上传',
        onclick: () => doUpload(Object.assign({}, opts, { action: 'sync-then-push', sync: true })),
      }));
      actions.appendChild(el('button', {
        class: 'btn', type: 'button', text: '改用新分支上传(最安全)',
        onclick: () => doUpload(Object.assign({}, opts, { action: 'push-new-branch', newBranch: suggestBranch(), sync: false, commit: true })),
      }));
    } else if (r.code === 'MERGE_CONFLICT') {
      actions.appendChild(el('button', {
        class: 'btn primary', type: 'button', text: '改用新分支上传(推荐)',
        onclick: () => doUpload(Object.assign({}, opts, { action: 'push-new-branch', newBranch: suggestBranch(), sync: false, commit: true })),
      }));
      actions.appendChild(el('button', {
        class: 'btn', type: 'button', text: '学习怎么解决冲突',
        onclick: () => window.KB.open('tutorials', 'conflicts'),
      }));
    } else if (r.code === 'NO_IDENTITY') {
      actions.appendChild(el('button', {
        class: 'btn primary', type: 'button', text: '去设置提交者信息',
        onclick: () => window.Settings.open('identity'),
      }));
    } else if (r.code === 'GIT_MISSING') {
      actions.appendChild(el('button', {
        class: 'btn primary', type: 'button', text: '下载 Git for Windows',
        onclick: () => window.gpe.openExternal('https://git-scm.com/download/win'),
      }));
    } else {
      actions.appendChild(el('button', {
        class: 'btn primary', type: 'button', text: '重试',
        onclick: () => doUpload(opts),
      }));
    }
    actions.appendChild(el('button', { class: 'btn', type: 'button', text: '返回查看变更', onclick: () => render() }));
    actions.appendChild(el('button', { class: 'btn ghost', type: 'button', text: '查报错原因', onclick: () => window.KB.open('troubleshoot') }));
    card.appendChild(actions);
    return card;
  }

  /* ============================================================ diff 弹层 */

  async function showDiff(path) {
    const r = await window.gpe.repo.diff({ dir: window.S.folder, file: path });
    const text = r.ok ? r.data : '(无法读取差异:' + (r.error || '') + ')';
    const isNew = !text || !text.trim();

    const mask = el('div', { class: 'overlay-mask open', style: { zIndex: '250' } });
    const panel = el('div', { class: 'dialog open', style: { inset: '6vh 6vw', maxWidth: '1000px', zIndex: '251' } }, [
      el('div', { class: 'dialog-head' }, [
        el('div', { class: 'flex-1', style: { minWidth: 0 } }, [
          el('div', { class: 'dh-title mono truncate', text: path, title: path }),
          el('div', { class: 'dh-sub', text: isNew ? '这是新文件,或者还没有历史版本可比对' : '和上一次提交对比' }),
        ]),
        el('button', { class: 'x-btn', type: 'button', onclick: close }, [A.icon('close', { size: 16 })]),
      ]),
      el('div', { class: 'dialog-body' }, [
        isNew
          ? el('div', { class: 'alert info' }, [
            U.alertIcon('info'),
            el('div', { class: 'body', text: '这是新加入的文件,还没有可比对的历史版本。上传之后,下次修改就能看到逐行差异了。' }),
          ])
          : el('div', { class: 'diff-view', html: window.U.renderDiff(text) }),
      ]),
    ]);

    function close() {
      mask.remove(); panel.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    mask.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
    document.body.appendChild(panel);
  }

  /* ============================================================ 其它 */

  async function ignoreFiles(paths) {
    if (!paths || !paths.length) return;
    const r = await window.gpe.repo.ignorePaths({ dir: window.S.folder, paths, isDir: false });
    if (!r.ok) { window.U.toast('error', '写入 .gitignore 失败', r.error); return; }
    window.U.toast('ok', '已加入 .gitignore', r.data.added.join('、') + ' 以后不会再被上传。');
    window.S.selectedPaths = null;
    window.S.analysis = null;
    render();
  }

  async function abortMerge() {
    const r = await window.gpe.repo.abortMerge(window.S.folder);
    if (!r.ok) { window.U.toast('error', '操作失败', r.error); return; }
    window.U.toast('ok', '已恢复到干净状态', '可以重新开始上传了。');
    window.S.selectedPaths = null;
    window.S.analysis = null;
    render();
  }

  function showFloat(label, detail) {
    const box = $('#floatStatus');
    if (!box) return;
    box.classList.add('show');
    $('#floatLabel').textContent = label || '处理中…';
    const d = $('#floatDetail');
    d.textContent = detail || '';
    d.classList.toggle('hidden', !detail);
  }

  function hideFloat() {
    const box = $('#floatStatus');
    if (box) box.classList.remove('show');
  }

  window.ViewChanges = {
    render, analyze, doUpload, hideFloat, showDiff, refreshNow, setWatchPaused, stopWatch,
    get method() { return method; },
  };
})();
