/**
 * view-home.js —— 首页:选择文件夹并确认上传设置。
 *
 * 这一屏的结构完全对应参考设计:
 *   主区 = 问候语 + 三步流程条 + 文件夹卡片 + 仓库设置(三个下拉框)+ 三个检查结果 + 底部寄语
 *   右栏 = 本次变更统计 + 部分文件预览 + 上传方式
 *
 * 与旧版的区别:不再用顶栏步骤条,也不再需要单独"选择文件夹"页 ——
 * 选好文件夹后直接在本页继续,由底部那个绿色大按钮推进到"查看变更"。
 */
(function () {
  'use strict';

  const { el, clear, $, bytes, num, esc } = window.U;
  const A = window.Art;

  const LAST_KEY = 'gpe.lastFolder';
  const PREFS_KEY = 'gpe.homePrefs';

  /**
   * 首页上的临时选择(仓库 / 可见性 / 目标分支 / 上传方式)。
   *
   * branch 的语义很关键:'' 表示"跟随当前分支",而不是写死 'main'。
   * 之前默认写成 'main',既和实际分支可能不符,也让下方的"上传方式"
   * 显示出与实际行为不一致的文案。
   */
  let prefs = {
    repoChoice: '',        // '' = 自动;'__new__' = 新建仓库;其它 = clone_url
    visibility: 'private',
    branch: '',            // '' = 当前分支;其它 = 用户明确指定的目标分支
    method: 'current',     // current = 传到所选分支;branch = 另建一条新分支上传
    newBranch: '',         // method === 'branch' 时的分支名
  };

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) prefs = Object.assign(prefs, JSON.parse(raw));
    } catch (_) {}
    prefs.visibility = window.S.settings.defaultVisibility || prefs.visibility;
    // 兼容旧版本存下来的 'merge' / 'main'
    if (prefs.method === 'merge') prefs.method = 'current';
    if (prefs.method !== 'branch') prefs.method = 'current';
    if (prefs.branch === 'main' || prefs.branch === 'master') {
      // 旧默认值不算"用户指定",交回自动判断
      if (!window.S.analysis || window.S.analysis.branch !== prefs.branch) prefs.branch = '';
    }
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) {}
  }

  /* ============================================================ 入口 */

  function render() {
    loadPrefs();
    renderMain();
    renderSide();
  }

  /* ============================================================ 主区 */

  function renderMain() {
    const host = clear($('#homeMain'));
    if (!host) return;

    host.appendChild(renderHero());
    host.appendChild(renderSteps());
    host.appendChild(renderFolderCard());
    host.appendChild(renderRepoSection());
    host.appendChild(renderChecks());
    host.appendChild(renderFootNote());
  }

  /** 问候语 + 右上角小插画 */
  function renderHero() {
    const info = window.S.folderInfo;
    const greeting = timeGreeting();
    const title = info
      ? (window.S.analysis && window.S.analysis.changes && window.S.analysis.changes.total
        ? '检查到新的改动,准备上传吗?'
        : '准备上传新项目吗?')
      : '准备上传新项目吗?';

    const box = el('div', { class: 'hero' });
    box.appendChild(el('h1', { text: greeting + ',' + title.replace(/^准备/, '准备') }));
    box.appendChild(el('div', { class: 'sub', text: '三步完成:选择文件夹、确认变更、推送到 GitHub' }));

    const line = el('div', { class: 'greeting-line' }, [
      el('div', { class: 'cap', text: '你好呀\n从一次上传开始' }),
      A.greetingArt(),
    ]);
    // 把 \n 变成真正的换行
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

  /** 三步流程条 */
  function renderSteps() {
    const analyzed = !!window.S.analysis;
    const done = !!window.S.lastResult;
    const steps = [
      { key: 'home', label: '选择文件夹' },
      { key: 'changes', label: '查看变更' },
      { key: 'status', label: '上传完成' },
    ];
    const active = done ? 2 : analyzed ? 1 : 0;

    const box = el('div', { class: 'steps', id: 'stepNav' });
    steps.forEach((s, i) => {
      const state = i < active ? 'done' : i === active ? 'active' : 'todo';
      const node = el('div', { class: 'step ' + state }, [
        el('button', {
          class: 'step-node', type: 'button',
          disabled: i === 2 && !done ? true : (i === 1 && !window.S.folder ? true : false),
          onclick: () => goStep(s.key, i, active, done),
        }, [
          el('span', { class: 'num' }, [el('span', { text: String(i + 1) })]),
          el('span', { class: 'lbl', text: s.label }),
        ]),
      ]);
      box.appendChild(node);
      if (i < steps.length - 1) box.appendChild(el('div', { class: 'step-line' }));
    });
    return box;
  }

  function goStep(key, i, active) {
    if (key === 'home') return;
    if (key === 'changes') {
      if (!window.S.folder) { window.U.toast('warn', '请先选择一个文件夹'); return; }
      window.App.go('changes');
      return;
    }
    if (key === 'status') {
      if (!window.S.lastResult) { window.U.toast('info', '还没有上传记录'); return; }
      window.App.go('status');
    }
  }

  /** 选择本地文件夹 */
  function renderFolderCard() {
    const info = window.S.folderInfo;
    const card = el('div', { class: 'card' });

    card.appendChild(el('div', { class: 'sec-head' }, [
      el('div', { class: 'sec-title', text: '选择本地文件夹' }),
      el('div', { class: 'sec-desc', text: '选择你想上传的项目文件夹,小白推送将帮你完成后续的 Git 操作。' }),
    ]));

    if (!info) {
      card.appendChild(renderDrop());
      return card;
    }

    const scan = info.scan || { files: 0, bytes: 0 };
    const sizeText = bytes(scan.bytes) + (scan.truncated ? '+' : '');

    card.appendChild(el('div', { class: 'folder-card' }, [
      el('span', { class: 'fc-ico' }, [A.folderIcon()]),
      el('div', { class: 'fc-body' }, [
        el('div', { class: 'fc-path', text: info.path, title: info.path }),
        el('div', { class: 'fc-meta', text: `${num(scan.files)}${scan.truncated ? '+' : ''} 个文件 · ${sizeText}` }),
      ]),
      el('button', {
        class: 'btn', type: 'button', text: '重新选择',
        onclick: () => pick(),
      }),
    ]));

    // 风险提示
    const dangerous = info._risky && info._risky.length;
    if (dangerous) {
      card.appendChild(el('div', { class: 'alert error mt-3' }, [
        U.alertIcon('alert'),
        el('div', { class: 'body' }, [
          el('div', { class: 'fw-650', text: '请换一个文件夹 —— ' + info._risky[0] }),
          el('div', { class: 'mt-1', text:
            '把整个磁盘或用户目录上传到 GitHub 会有两个严重问题:文件数量巨大、几乎必然失败;' +
            '而且会把你的个人文件和密钥一起公开。' }),
        ]),
      ]));
    }

    // 目录选择建议
    if (info.parentRepo) {
      card.appendChild(el('div', { class: 'alert warn mt-3' }, [
        U.alertIcon('alert'),
        el('div', { class: 'body' }, [
          el('div', { class: 'fw-650', text: '你选的可能是子文件夹' }),
          el('div', { class: 'mt-1 break-all', html:
            '上层目录 <code>' + esc(info.parentRepo) + '</code> 已经是一个 Git 仓库。想上传整个项目的话,建议改选那个上层目录。' }),
          el('button', {
            class: 'btn sm mt-2', type: 'button', text: '改用上层目录',
            onclick: () => select(info.parentRepo),
          }),
        ]),
      ]));
    }

    // 大文件
    const over = (scan.bigFiles || []).filter((f) => f.size >= 100 * 1024 * 1024);
    if (over.length) {
      card.appendChild(el('div', { class: 'alert error mt-3' }, [
        U.alertIcon('alert'),
        el('div', { class: 'body' }, [
          el('div', { class: 'fw-650', text: `有 ${over.length} 个文件超过 GitHub 的 100MB 上限,现在上传会失败` }),
          el('div', { class: 'mt-2' }, over.slice(0, 4).map((f) => el('div', { class: 'flex items-center gap-3 text-sm' }, [
            el('span', { class: 'mono flex-1 truncate', text: f.path, title: f.path }),
            el('span', { class: 'badge red', text: bytes(f.size) }),
          ]))),
          el('button', {
            class: 'btn sm mt-2', type: 'button', text: '把它们加入 .gitignore',
            onclick: () => ignoreFiles(over.map((f) => f.path)),
          }),
        ]),
      ]));
    } else if ((scan.bigFiles || []).length) {
      card.appendChild(el('div', { class: 'alert warn mt-3' }, [
        U.alertIcon('alert'),
        el('div', { class: 'body', text: `有 ${scan.bigFiles.length} 个文件大于 50MB,上传会比较慢。` }),
      ]));
    }

    if (!scan.files) {
      card.appendChild(el('div', { class: 'alert warn mt-3' }, [
        U.alertIcon('alert'),
        el('div', { class: 'body', text: '这个文件夹是空的,没有内容可以上传。' }),
      ]));
    }

    return card;
  }

  function renderDrop() {
    const drop = el('div', { class: 'folder-drop' }, [
      el('div', { class: 'fd-ico' }, [A.folderIcon('#e8b64c')]),
      el('h3', { text: '点击选择文件夹' }),
      el('p', { html: '也可以直接把文件夹<strong>拖进窗口</strong>' }),
      el('div', { class: 'mt-4' }, [
        el('button', {
          class: 'btn primary', type: 'button', text: '浏览文件夹…',
          onclick: (e) => { e.stopPropagation(); pick(); },
        }),
      ]),
    ]);
    drop.addEventListener('click', () => pick());
    ['dragenter', 'dragover'].forEach((ev) => {
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); });
    });
    return drop;
  }

  /* ------------------------------------------------------------ 仓库设置 */

  function renderRepoSection() {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'sec-head' }, [
      el('div', { class: 'sec-title', text: '仓库设置' }),
      el('div', { class: 'sec-desc', text: '将本地项目上传到你的 GitHub 仓库。' }),
    ]));

    const a = window.S.analysis;
    const repoLabel = repoDisplayName();

    const grid = el('div', { class: 'field-grid' }, [
      // 仓库
      el('div', {}, [
        el('label', { class: 'label', text: '仓库' }),
        selectBox(buildRepoOptions(), repoSelectValue(), (v, sel) => {
          /**
           * 「＋ 新建仓库 / 选择其它…」是动作型选项:执行完动作后立刻把
           * 显示值恢复成真实仓库,保证下一次点击一定是一次真正的"变化"。
           * 不这样做就会出现"点了没反应,得先点别的再点回来"。
           */
          if (v === '__new__') {
            prefs.repoChoice = currentRepoValue();
            savePrefs();
            sel.value = prefs.repoChoice;
            if (!window.S.folder) {
              window.U.toast('warn', '请先选择文件夹', '先选好本地文件夹,再来挑选或新建要上传到的仓库。');
              return;
            }
            window.ViewRepo.openPicker();
            return;
          }

          prefs.repoChoice = v;
          savePrefs();
          if (v && v !== '__current__') applyRepoChoice(v, sel);
        }),
      ]),
      // 可见性
      el('div', {}, [
        el('label', { class: 'label', text: '可见性' }),
        el('div', { class: 'select-lock' }, [
          el('span', { class: 'lk' }, [
            A.svg('0 0 20 20', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }, [
              A.tag('rect', { x: 4.4, y: 8.6, width: 11.2, height: 7.6, rx: 1.8 }),
              A.tag('path', { d: 'M6.8 8.6V6.6a3.2 3.2 0 0 1 6.4 0v2', fill: 'none' }),
            ]),
          ]),
          selectBox([
            { value: 'private', label: '私有' },
            { value: 'public', label: '公开' },
          ], prefs.visibility, (v) => { prefs.visibility = v; savePrefs(); }),
        ]),
      ]),
      // 目标分支
      el('div', {}, [
        el('label', { class: 'label' }, [
          el('span', { text: '目标分支' }),
          el('span', { class: 'hint', text: ' 传到哪条分支' }),
        ]),
        selectBox(buildBranchOptions(), branchSelectValue(), (v, sel) => {
          prefs.branch = v === '__current__' ? '' : v;
          savePrefs();
          if (v === '__custom__') {
            // 让用户直接输入分支名:用一个内联输入框,避免再弹一层弹窗
            sel.value = branchSelectValue();
            promptCustomBranch();
            return;
          }
          renderSide();
        }),
      ]),
    ]);
    card.appendChild(grid);
    // 自定义分支名的输入位置(选了"自定义分支名…"才出现)
    card.appendChild(el('div', { id: 'branchCustom' }));

    return card;
  }

  /** 下拉框里代表"当前仓库"的值 */
  function currentRepoValue() {
    const a = window.S.analysis;
    return a && a.remoteUrl ? '__current__' : '';
  }

  /**
   * 仓库下拉框应当选中哪一项。
   * 优先用用户这次会话里的选择(prefs),但必须校验它仍然存在于选项里,
   * 否则会出现"select 显示空白"或"显示的值和实际仓库不符"。
   */
  function repoSelectValue() {
    const opts = buildRepoOptions().map((o) => String(o.value));
    if (prefs.repoChoice && opts.includes(String(prefs.repoChoice))) return prefs.repoChoice;
    return currentRepoValue();
  }

  function buildRepoOptions() {
    const a = window.S.analysis;
    const out = [];
    const current = a && a.repoInfo ? a.repoInfo.full_name : (a && a.remoteUrl ? a.remoteUrl : '');
    if (current) {
      out.push({ value: '__current__', label: current });
    } else {
      out.push({ value: '', label: '还没有关联仓库' });
    }
    // 已经浏览过的仓库缓存(在仓库选择器里选过之后会有)
    const recent = (window.S.recentRepos || []).filter((r) => r.full_name !== current);
    for (const r of recent.slice(0, 6)) out.push({ value: r.clone_url, label: r.full_name });
    out.push({ value: '__new__', label: '＋ 新建仓库 / 选择其它…' });
    return out;
  }

  /**
   * 目标分支的选项。
   *
   * 关键改动:第一项永远是"当前分支"(跟随 HEAD),而不是写死 main。
   * 这样用户不选就保持原样,选了才切 —— 不会再出现"界面显示 main、
   * 实际却传到别处"这种对不上的情况。
   */
  function buildBranchOptions() {
    const a = window.S.analysis;
    const current = (a && a.branch) || '';
    const names = [];
    const push = (n) => { if (n && !names.includes(n)) names.push(n); };

    // 仓库里已有的分支
    for (const b of (a && a.branches) || []) push(b.name);
    // 常见的主干名始终给出来,方便用户选
    const def = window.S.settings.defaultBranch || 'main';
    push('main');
    push('master');
    if (def !== 'main' && def !== 'master') push(def);

    const out = [];
    if (current) {
      out.push({ value: '__current__', label: `当前分支(${current})` });
    }
    for (const n of names) out.push({ value: n, label: n });
    out.push({ value: '__custom__', label: '＋ 自定义分支名…' });
    return out;
  }

  /** 下拉框应当选中哪一项 */
  function branchSelectValue() {
    if (!prefs.branch) return '__current__';
    const opts = buildBranchOptions().map((o) => String(o.value));
    return opts.includes(prefs.branch) ? prefs.branch : '__custom__';
  }

  /** 让用户输入一个自定义分支名 */
  function promptCustomBranch() {
    const host = $('#branchCustom');
    if (!host) return;
    clear(host);
    const input = el('input', {
      class: 'input mono', type: 'text', placeholder: '输入分支名,例如 feature/login',
      value: prefs.branch || '',
    });
    const okBtn = el('button', { class: 'btn sm primary', type: 'button', text: '确定' });
    const cancelBtn = el('button', { class: 'btn sm ghost', type: 'button', text: '取消' });

    const commit = () => {
      const name = input.value.trim();
      if (name && !/^[A-Za-z0-9._\/-]+$/.test(name)) {
        window.U.toast('warn', '分支名不合法', '只能用字母、数字、点、下划线、短横线和斜杠。');
        return;
      }
      prefs.branch = name;
      savePrefs();
      renderMain();
      renderSide();
      if (name) window.U.toast('info', '目标分支已设为 ' + name);
    };
    okBtn.addEventListener('click', commit);
    cancelBtn.addEventListener('click', () => { prefs.branch = ''; savePrefs(); renderMain(); renderSide(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });

    host.appendChild(el('div', { class: 'flex gap-2 mt-2' }, [input, okBtn, cancelBtn]));
    setTimeout(() => input.focus(), 40);
  }

  function repoDisplayName() {
    const a = window.S.analysis;
    if (!a) return '';
    if (a.repoInfo) return a.repoInfo.full_name;
    if (a.remoteUrl) return a.remoteUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    return '';
  }

  /**
   * 生成一个下拉框。
   *
   * 注意:下拉框的"显示值"必须始终等于"真实生效的值"。
   * 「＋ 新建仓库 / 选择其它…」是一个**动作型选项**,它执行完动作后
   * 不应停留在选中态 —— 否则下一次再点它,浏览器认为值没变化、
   * 不触发 change,用户就会遇到"点了没反应,得先点别的再点回来"。
   * 因此调用方处理完动作后必须把 sel.value 恢复成真实值。
   */
  function selectBox(options, value, onChange) {
    const sel = el('select', { class: 'select' });
    let matched = false;
    for (const o of options) {
      const opt = el('option', { value: o.value, text: o.label });
      if (String(o.value) === String(value)) { opt.selected = true; matched = true; }
      sel.appendChild(opt);
    }
    if (!matched && options.length) {
      // 当前值不在列表里(比如刚切到别的分支),补一个占位项
      const opt = el('option', { value: value, text: value || '—' });
      opt.selected = true;
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.addEventListener('change', () => onChange(sel.value, sel));
    return sel;
  }

  /** 用户在下拉框里选了另一个仓库 */
  async function applyRepoChoice(cloneUrl, sel) {
    const dir = window.S.folder;
    if (!dir) return;
    const r = await window.gpe.repo.setRemote({ dir, url: cloneUrl, remote: 'origin' });
    if (!r.ok) {
      window.U.toast('error', '关联仓库失败', r.error);
      // 失败时把下拉框恢复成真实状态,不要让界面显示一个并未生效的选择
      if (sel) sel.value = currentRepoValue();
      prefs.repoChoice = currentRepoValue();
      savePrefs();
      return;
    }
    window.S.analysis = null;
    window.S.selectedPaths = null;
    window.U.toast('ok', '已切换上传目标', cloneUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, ''));
    await reanalyze();
  }

  /** 把仓库选择器里选中的仓库记下来,方便下拉框复用 */
  function rememberRepo(repo) {
    if (!repo) return;
    window.S.recentRepos = window.S.recentRepos || [];
    if (!window.S.recentRepos.some((r) => r.full_name === repo.full_name)) {
      window.S.recentRepos.unshift(repo);
      window.S.recentRepos = window.S.recentRepos.slice(0, 8);
    }
  }

  /* ------------------------------------------------------------ 检查结果 */

  function renderChecks() {
    const a = window.S.analysis;
    const info = window.S.folderInfo;
    const box = el('div', { class: 'checks' });

    // 1. GitHub 连接
    const logged = !!window.S.account;
    const connected = logged && a && a.sync !== 'unknown';
    box.appendChild(checkRow(
      connected ? 'ok' : logged ? 'info' : 'warn',
      connected ? '已连接 GitHub' : logged ? '已登录 GitHub' : '尚未登录 GitHub',
      connected
        ? '账户连接正常'
        : logged
          ? '账户已登录,首次上传时才会创建仓库'
          : '点右上角登录后才能上传',
      !logged ? { label: '去登录', onclick: () => window.App.go('login') } : null
    ));

    // 2. 敏感文件检测
    const scan = (info && info.scan) || { files: 0 };
    const riskFiles = detectSensitive(info);
    box.appendChild(checkRow(
      riskFiles.length ? 'warn' : 'ok',
      riskFiles.length ? `发现 ${riskFiles.length} 个可能含敏感信息的文件` : '未发现敏感文件',
      riskFiles.length
        ? '建议加入 .gitignore 后再上传'
        : '未检测到密钥、密码等敏感信息',
      riskFiles.length
        ? { label: '忽略它们', onclick: () => ignoreFiles(riskFiles) }
        : null
    ));

    // 3. .gitignore
    const gi = info && info.gitignore;
    const hasGi = gi && !gi.created && window.S.folderInfo && window.S.folderInfo.isRepo;
    box.appendChild(checkRow(
      'ok',
      '‎.gitignore 已就绪',
      gi && gi.created
        ? '已根据项目类型自动生成规则'
        : '已为常见文件类型配置忽略规则',
      null
    ));

    if (a && a.warnings && a.warnings.length) {
      for (const w of a.warnings) {
        box.appendChild(checkRow(w.level === 'error' ? 'error' : 'warn', '提示', w.text, null));
      }
    }

    return box;
  }

  /** 粗略识别"看起来像密钥"的文件名 */
  function detectSensitive(info) {
    if (!info || !info.scan) return [];
    // scan 里没有完整文件清单,只能靠顶层目录名 + 大文件列表做粗略判断。
    // 精确判断交给后端 status():.env 之类本来就被默认 .gitignore 覆盖了。
    const hits = [];
    const top = (info.scan.topLevel || []).map((t) => t.name);
    for (const name of top) {
      if (/^\.env(\.|$)/i.test(name)) hits.push(name);
      if (/^(id_rsa|id_ed25519|\.pem|.*\.p12|.*\.pfx|.*\.key)$/i.test(name)) hits.push(name);
    }
    return hits.slice(0, 8);
  }

  function checkRow(kind, title, sub, action) {
    const cls = kind === 'ok' ? '' : kind === 'warn' ? 'warn' : kind === 'error' ? 'error' : 'info';
    const iconName = kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert';
    return el('div', { class: 'check-row ' + cls }, [
      el('span', { class: 'cr-ico ic' }, [A.icon(iconName, { size: 13, strokeWidth: 2.4 })]),
      el('div', { class: 'cr-body' }, [
        el('div', { class: 'cr-title', text: title }),
        el('div', { class: 'cr-sub', text: sub }),
      ]),
      action ? el('button', {
        class: 'btn sm', type: 'button', text: action.label,
        onclick: action.onclick,
      }) : null,
    ]);
  }

  /* ------------------------------------------------------------ 底部寄语 */

  function renderFootNote() {
    const wrap = el('div', { class: 'foot-note' }, [
      el('div', { class: 'foot-quote', html: '" 把创意放进版本库,<br>也成长被看见。 "' }),
      el('div', { class: 'foot-mtn' }, [A.footerArt()]),
    ]);

    const canGo = !!(window.S.folder && window.S.folderInfo && window.S.folderInfo.scan.files > 0);
    const btn = el('button', {
      class: 'btn primary jumbo', type: 'button',
      text: (window.S.analysis ? '查看变更并上传' : '查看变更并上传') + '  →',
      disabled: !canGo,
    });
    btn.addEventListener('click', () => onPrimary());
    wrap.appendChild(btn);
    return wrap;
  }

  async function onPrimary() {
    if (!window.S.account) { window.App.go('login'); return; }
    if (!window.S.folder) { window.U.toast('warn', '请先选择一个文件夹'); return; }
    // 先做/刷新一次分析,再进入变更页
    window.App.go('changes');
  }

  /* ============================================================ 右栏 */

  function renderSide() {
    const host = clear($('#homeSide'));
    if (!host) return;
    host.appendChild(renderChangesSummaryCard());
    host.appendChild(renderMethodCard());
  }

  function renderChangesSummaryCard() {
    const card = el('div', { class: 'side-card' });
    const a = window.S.analysis;
    const changes = a && a.changes ? a.changes.all : [];
    const info = window.S.folderInfo;
    const hasFolder = !!(info && info.scan && info.scan.files > 0);
    const isRepo = !!(info && info.isRepo);

    // 统计
    const stat = { add: 0, mod: 0, del: 0 };
    for (const f of changes) {
      if (f.state === 'untracked' || f.state === 'added') stat.add += 1;
      else if (f.state === 'deleted') stat.del += 1;
      else stat.mod += 1;
    }
    const total = changes.length;

    card.appendChild(el('div', { class: 'side-head' }, [
      el('div', { class: 'side-title', text: '本次变更' }),
      el('span', { class: 'count-pill', text: total ? `共 ${total} 项` : '待检查' }),
    ]));

    card.appendChild(el('div', { class: 'stat-list' }, [
      statRow('add', '新增', stat.add),
      statRow('mod', '修改', stat.mod),
      statRow('del', '删除', stat.del),
    ]));

    card.appendChild(el('div', { class: 'side-divider' }));

    // 预览
    card.appendChild(el('div', { class: 'text-xs fw-650 mb-1', style: { color: 'var(--fg-muted)' }, text: '部分文件预览' }));

    const previewBox = el('div', { class: 'preview-list' });
    const previewItems = buildPreview(changes, info, hasFolder);

    if (!previewItems.length) {
      previewBox.appendChild(el('div', { class: 'text-xs text-subtle', style: { padding: '6px 4px' },
        text: !hasFolder ? '选择文件夹后会显示变更清单' : (isRepo ? '尚未检测到改动' : '首次上传,全部文件都是新增') }));
    } else {
      for (const it of previewItems.slice(0, 3)) {
        previewBox.appendChild(el('div', { class: 'preview-row' }, [
          el('span', { class: 'pr-ico' }, [A.fileIcon(it.path)]),
          el('span', { class: 'pr-name', text: it.path, title: it.path }),
          el('span', { class: 'pr-mark ' + it.kind, text: it.kind === 'add' ? '+' : it.kind === 'del' ? '−' : '~' }),
        ]));
      }
    }
    card.appendChild(previewBox);

    if (previewItems.length > 3 || hasFolder) {
      card.appendChild(el('button', {
        class: 'link-more', type: 'button',
        text: (total > 3 ? `查看全部 ${total} 项` : '查看详细信息') + '  →',
        onclick: () => {
          if (!window.S.account) { window.App.go('login'); return; }
          if (!window.S.folder) { window.U.toast('warn', '请先选择一个文件夹'); return; }
          window.App.go('changes');
        },
      }));
    }

    return card;
  }

  function statRow(kind, label, value) {
    const glyph = { add: '+', mod: '~', del: '−' }[kind];
    return el('div', { class: 'stat-row' }, [
      el('span', { class: 'sr-ico ' + kind, text: glyph }),
      el('span', { class: 'sr-label', text: label }),
      el('span', { class: 'sr-val', text: String(value) }),
    ]);
  }

  function buildPreview(changes, info, hasFolder) {
    if (changes && changes.length) {
      return changes.slice(0, 12).map((f) => ({
        path: f.path,
        kind: (f.state === 'untracked' || f.state === 'added') ? 'add'
          : f.state === 'deleted' ? 'del' : 'mod',
      }));
    }
    // 没有分析结果时,用顶层文件给个直观预览
    if (hasFolder && !info.isRepo && info.scan.topLevel) {
      return info.scan.topLevel.filter((t) => !t.dir && !/^\./.test(t.name))
        .slice(0, 6).map((t) => ({ path: t.name, kind: 'add' }));
    }
    return [];
  }

  function renderMethodCard() {
    const card = el('div', { class: 'side-card' });
    card.appendChild(el('div', { class: 'side-head' }, [
      el('div', { class: 'side-title', text: '上传方式' }),
    ]));

    /**
     * 卡片一始终描述"提交到哪条分支"(即所选目标分支,不含新分支);
     * 新分支名只在卡片二上出现。
     * 之前两个卡片共用 effectiveBranch(),选了新分支后卡片一也跟着变成
     * 新分支名,读起来自相矛盾。
     */
    const commitTo = prefs.branch
      || (window.S.analysis && window.S.analysis.branch)
      || window.S.settings.defaultBranch || 'main';
    const newName = prefs.newBranch || suggestBranchName();
    const isNewRepo = !window.S.folderInfo || !window.S.folderInfo.isRepo;

    card.appendChild(radioCard(
      'current',
      `提交到 ${commitTo}`,
      isNewRepo
        ? `这些文件会成为 ${commitTo} 分支的第一个提交。`
        : `把改动提交到 ${commitTo} 分支,不会新建其它分支。`,
      prefs.method === 'current'
    ));

    // 卡片二:把新分支名显示出来,不再凭空使用 update-时间戳
    card.appendChild(radioCard(
      'branch',
      `另建一条新分支上传(${newName})`,
      isNewRepo
        ? '不占用主干,先推到一条新分支上。'
        : `${commitTo} 分支保持不动,改动推到一条新分支。`,
      prefs.method === 'branch'
    ));

    // 选了新分支就必须让用户看见并修改分支名
    if (prefs.method === 'branch') {
      const input = el('input', {
        class: 'input mono mt-2', type: 'text',
        placeholder: '新分支名,例如 update-20260101',
        value: newName,
      });
      input.addEventListener('input', () => { prefs.newBranch = input.value.trim(); savePrefs(); });
      card.appendChild(input);
      card.appendChild(el('div', { class: 'text-xs text-subtle mt-1', text:
        '这个名字会作为 GitHub 上的新分支名,可以随时改。' }));
    }

    card.appendChild(el('div', { class: 'hint-strip' }, [
      el('span', { class: 'hs-ico' }, [A.icon('info', { size: 13 })]),
      el('span', { text: prefs.method === 'branch'
        ? '适合不确定是否会影响现有内容时使用'
        : '大多数情况下用这个就好 —— 和 GitHub Desktop 的默认行为一致' }),
    ]));

    return card;
  }

  /** 当前实际会传到哪条分支 */
  function effectiveBranch() {
    if (prefs.method === 'branch') return prefs.newBranch || suggestBranchName();
    if (prefs.branch) return prefs.branch;
    const a = window.S.analysis;
    if (a && a.branch) return a.branch;
    return window.S.settings.defaultBranch || 'main';
  }

  /** 建议的新分支名(基于日期,不至于看不出是什么时候的) */
  function suggestBranchName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `update-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  function radioCard(value, title, desc, on) {
    const input = el('input', { type: 'radio', name: 'uploadMethod', value, checked: on });
    const box = el('label', { class: 'radio-card' + (on ? ' on' : '') }, [
      input,
      el('div', { class: 'rc-body' }, [
        el('div', { class: 'rc-title', text: title }),
        el('div', { class: 'rc-desc', text: desc }),
      ]),
    ]);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      prefs.method = value;
      savePrefs();
      renderSide();
    });
    return box;
  }

  /* ============================================================ 动作 */

  async function pick() {
    const r = await window.gpe.folder.pick();
    if (!r.ok) { window.U.toast('error', '选择文件夹失败', r.error); return; }
    if (!r.data) return;
    select(r.data);
  }

  async function select(dir) {
    renderLoading(dir);
    const [inspect, difficulty] = await Promise.all([
      window.gpe.folder.inspect(dir),
      window.gpe.folder.difficulty(dir),
    ]);
    if (!inspect.ok) {
      const host = clear($('#homeMain'));
      host.appendChild(window.U.buildErrorBox(inspect, el('button', {
        class: 'btn sm mt-3', type: 'button', text: '重新选择',
        onclick: () => { window.S.folderInfo = null; render(); },
      })));
      return;
    }
    window.S.folder = dir;
    window.S.folderInfo = inspect.data;
    window.S.scan = inspect.data.scan;
    window.S.analysis = null;
    window.S.selectedPaths = null;
    if (difficulty.ok) inspect.data._risky = difficulty.data.risky || [];
    try { localStorage.setItem(LAST_KEY, dir); } catch (_) {}

    render();
    // 后台做一次分析,让右栏立刻有真实数据
    await reanalyze();

    /**
     * 用户可能先在建仓库弹窗里选好了仓库、之后才选文件夹。
     * 这种情况下把那次选择补上,不用让他再点一次。
     */
    if (window.S.pendingRemote && window.S.pendingRemote.url) {
      const pr = window.S.pendingRemote;
      window.S.pendingRemote = null;
      await applyRepoChoice(pr.url);
    }
  }

  function renderLoading(dir) {
    const host = clear($('#homeMain'));
    host.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'flex items-center gap-3' }, [
        el('span', { class: 'spinner', style: { borderColor: 'var(--brand)', borderRightColor: 'transparent' } }),
        el('div', { class: 'fw-600', text: '正在检查这个文件夹…' }),
      ]),
      el('div', { class: 'folder-card mt-4' }, [
        el('span', { class: 'fc-ico' }, [A.folderIcon()]),
        el('div', { class: 'fc-body' }, [el('div', { class: 'fc-path', text: dir })]),
      ]),
    ]));
  }

  /** 刷新分析结果并重画(右栏统计要用) */
  async function reanalyze() {
    if (!window.S.folder || !window.S.account) { renderSide(); return; }
    const r = await window.gpe.repo.analyze({
      dir: window.S.folder,
      login: window.S.account.login,
      strategy: window.S.settings.defaultSyncStrategy,
      scan: window.S.scan,
    });
    if (r.ok) {
      window.S.analysis = r.data;
      /**
       * 把下拉框的选中值同步到"真实生效的仓库"。
       * 只在当前值已经不在选项里时回退,避免覆盖用户刚刚做出的选择。
       */
      const opts = buildRepoOptions().map((o) => String(o.value));
      if (!prefs.repoChoice || !opts.includes(String(prefs.repoChoice))) {
        prefs.repoChoice = currentRepoValue();
        savePrefs();
      }
      render();
    } else {
      renderSide();
    }
  }

  async function ignoreFiles(paths) {
    if (!paths || !paths.length) return;
    const r = await window.gpe.repo.ignorePaths({ dir: window.S.folder, paths, isDir: false });
    if (!r.ok) { window.U.toast('error', '写入 .gitignore 失败', r.error); return; }
    window.U.toast('ok', '已加入 .gitignore', r.data.added.join('、') + ' 以后不会再被上传。');
    window.S.analysis = null;
    window.S.selectedPaths = null;
    await select(window.S.folder);
  }

  /** 供外部读取首页选择的上传方式 */
  function currentPrefs() {
    return Object.assign({}, prefs);
  }

  window.ViewHome = {
    effectiveBranch,
    suggestBranchName,
    render, renderSide, select, pick, reanalyze, rememberRepo,
    currentPrefs,
    get prefs() { return prefs; },
  };
})();
