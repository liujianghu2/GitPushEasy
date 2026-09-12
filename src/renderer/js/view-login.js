/**
 * view-login.js —— 登录 GitHub。
 *
 * 设计原则:
 *   · 图标统一用 art.js 的线性 SVG,不用 emoji(不同系统渲染差异大,且显得杂乱)
 *   · 每一步只出现一次说明,不重复解释同一件事
 *   · 详细步骤一律收进可折叠的「查看步骤」,主界面保持干净
 *   · 只提供三条真正可用的路;密码登录已废弃,不设这个注定失败的入口
 */
(function () {
  'use strict';

  const { el, clear, $ } = window.U;
  const A = window.Art;

  let deviceUnsub = null;
  let activeTab = 'token';

  /**
   * github.com 是否可达。
   *   true  = 探测过,能通
   *   false = 探测过,连不上
   *   null  = 还不知道(还没探测 / 用户手动忽略了提示)
   * 探测只在启动后做一次,结果缓存在内存里。
   */
  let githubWebState = null;
  let githubWebProbed = false;
  let userIgnoredNetHint = false;

  function githubWebReachable() {
    if (userIgnoredNetHint) return null;
    if (!githubWebProbed) {
      githubWebProbed = true;
      // 后台探测,不阻塞界面
      window.gpe.gh.probeWeb().then((r) => {
        if (!r || !r.ok) return;
        githubWebState = !!r.data.reachable;
        if (githubWebState === false && !window.S.account) render();
      }).catch(() => {});
    }
    return githubWebState;
  }

  function ignoreNetHint() {
    userIgnoredNetHint = true;
    render();
  }

  /* ============================================================ 渲染 */

  function render() {
    renderMain();
    renderSide();
    window.U.hydrateIcons($('#loginMain'));
  }

  function renderMain() {
    const host = clear($('#loginMain'));
    if (!host) return;

    if (window.S.account) {
      host.appendChild(renderSignedIn());
      window.U.hydrateIcons(host);
      return;
    }

    host.appendChild(hero());

    const env = renderEnv();
    if (env.childNodes.length) host.appendChild(env);

    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'sec-head' }, [
      el('div', { class: 'sec-title', text: '选择登录方式' }),
      el('div', { class: 'sec-desc', text: '三种方式任选其一,登录一次之后就不需要再操作了。' }),
    ]));

    card.appendChild(el('div', {}, [
      methodCard({ id: 'token', icon: 'key', title: '访问令牌', badge: '推荐',
        desc: '最稳定,受网络和浏览器影响最小。没有令牌?下面有一步到位的创建引导。' }),
      methodCard({ id: 'device', icon: 'globe', title: '用浏览器授权',
        desc: '复制一个 6 位验证码到 GitHub 网页即可,不用手动创建令牌。' }),
      methodCard({ id: 'gcm', icon: 'archive', title: '使用本机已保存的账号',
        desc: '以前在命令行或 GitHub Desktop 登录过的话,可以直接读取。' }),
    ]));

    /**
     * 浏览器授权需要访问 github.com,而国内网络经常连不上这个域名
     * (api.github.com 往往能通)。与其等用户点了再失败,不如提前说清楚。
     */
    if (githubWebReachable() === false) {
      card.appendChild(el('div', { class: 'alert warn mt-3' }, [
        U.alertIcon('alert'),
        el('div', { class: 'body' }, [
          el('div', { class: 'fw-650', text: '当前网络似乎连不上 github.com' }),
          el('div', { class: 'mt-1 text-muted', text:
            '「用浏览器授权」需要访问 github.com,在你当前的网络环境下可能打不开。' +
            '建议直接选「访问令牌」—— 它只访问 api.github.com,不受影响。' }),
          el('div', { class: 'flex gap-2 mt-2 flex-wrap' }, [
            el('button', {
              class: 'btn sm primary', type: 'button',
              onclick: () => openMethodDialog('token'),
            }, [iconText('key', '改用访问令牌')]),
            el('button', {
              class: 'btn sm ghost', type: 'button',
              onclick: () => ignoreNetHint(),
            }, [iconText('refresh', '仍然要试浏览器授权')]),
          ]),
        ]),
      ]));
    }

    host.appendChild(card);
    window.U.hydrateIcons(host);
  }

  function hero() {
    const box = el('div', { class: 'hero' });
    box.appendChild(el('h1', { text: '先登录 GitHub' }));
    box.appendChild(el('div', { class: 'sub', text: '登录只是为了让程序有权限把文件传到你自己名下的仓库。' }));
    const line = el('div', { class: 'greeting-line' }, [
      el('div', { class: 'cap', text: '安全登录\n只连 GitHub' }),
      A.greetingArt(),
    ]);
    line.querySelector('.cap').style.whiteSpace = 'pre-line';
    box.appendChild(line);
    return box;
  }

  function methodCard(m) {
    const node = el('button', {
      class: 'method' + (activeTab === m.id ? ' on' : ''),
      type: 'button',
      'data-method': m.id,
      onclick: () => openMethodDialog(m.id),
    }, [
      el('span', { class: 'm-ico', 'data-icon': m.icon, 'data-icon-size': '19' }),
      el('span', { class: 'm-body' }, [
        el('span', { class: 'm-title' }, [
          el('span', { text: m.title }),
          m.badge ? el('span', { class: 'badge brand', text: m.badge }) : null,
        ]),
        el('span', { class: 'm-desc', text: m.desc }),
      ]),
      el('span', { class: 'm-arrow', 'data-icon': 'chevronRight', 'data-icon-size': '16' }),
    ]);
    return node;
  }

  function paintMethodSelection() {
    document.querySelectorAll('#loginMain .method').forEach((n) => {
      n.classList.toggle('on', n.getAttribute('data-method') === activeTab);
    });
  }

  /* ============================================================ 各方式详情 */

  /**
   * 点击登录方式时,在一个独立弹窗里完成整个流程。
   *
   * 为什么不内嵌在主区:这些流程的内容长短差别很大(访问令牌有创建引导,
   * 浏览器授权有 Client ID 设置向导),全部堆在主区会把页面撑得很长,
   * 用户得一直往下滚才能看到按钮。放进弹窗后:
   *   · 主区始终只有三张方式卡,一眼看完
   *   · 每个流程都有充足空间,不用滚动
   *   · 关掉弹窗就回到原处,不会有"内容不见了"的感觉
   */
  function openMethodDialog(id) {
    /**
     * 弹窗已经开着(用户在流程内部点了"改用访问令牌"这类按钮)时,
     * 只把内容换掉,不要叠一个新弹窗 —— 否则会出现两层遮罩、
     * 关一次还剩一层的问题。
     */
    if (dialogEl && activeTab === id) return;
    if (dialogEl) {
      // 从浏览器授权切走时先停掉后台轮询,避免"人都换了还在转"
      if (activeTab === 'device' && id !== 'device') {
        unsubscribeDevice();
        window.gpe.auth.deviceCancel().catch(() => {});
      }
      activeTab = id;
      refreshDialog(id);
      return;
    }

    closeMethodDialog();
    activeTab = id;

    const mask = el('div', { class: 'overlay-mask open', style: { zIndex: '280' } });
    const dialog = el('div', {
      class: 'dialog open fit',
      style: { zIndex: '281' },
      role: 'dialog', 'aria-modal': 'true',
    }, [
      el('div', { class: 'dialog-head', id: 'methodDialogHead' }),
      el('div', { class: 'dialog-body', id: 'methodDialogBody' }),
    ]);

    function onKey(e) { if (e.key === 'Escape') closeMethodDialog(); }
    mask.addEventListener('click', closeMethodDialog);
    document.addEventListener('keydown', onKey);

    dialogMaskEl = mask;
    dialogEl = dialog;
    dialogKeyEl = onKey;
    document.body.appendChild(mask);
    document.body.appendChild(dialog);

    refreshDialog(id);
  }

  /** 把弹窗的标题与内容换成指定方式 */
  function refreshDialog(id) {
    if (!dialogEl) return;
    const meta = {
      token: { icon: 'key', title: '登录 · 访问令牌', sub: '最稳定,且不需要任何额外配置' },
      device: { icon: 'globe', title: '登录 · 浏览器授权', sub: '在浏览器里输一个验证码即可' },
      gcm: { icon: 'archive', title: '登录 · 本机已保存的账号', sub: '复用命令行 / GitHub Desktop 登录过的账号' },
    }[id] || { icon: 'key', title: '登录', sub: '' };

    let panel = null;
    if (id === 'token') panel = buildTokenPanel();
    else if (id === 'device') panel = buildDevicePanel();
    else panel = buildGcmPanel();

    const head = clear($('#methodDialogHead'));
    head.appendChild(el('span', { class: 'dh-ico ic' }, [A.icon(meta.icon, { size: 18 })]));
    head.appendChild(el('div', { style: { flex: '1', minWidth: 0 } }, [
      el('div', { class: 'dh-title', text: meta.title }),
      el('div', { class: 'dh-sub', text: meta.sub }),
    ]));
    head.appendChild(el('button', {
      class: 'x-btn', type: 'button', 'aria-label': '关闭', onclick: closeMethodDialog,
    }, [A.icon('close', { size: 16 })]));

    const body = clear($('#methodDialogBody'));
    body.appendChild(panel);
    window.U.hydrateIcons(dialogEl);

    const focusTarget = body.querySelector('input, textarea');
    if (focusTarget) setTimeout(() => focusTarget.focus(), 80);
  }

  let dialogEl = null;
  let dialogMaskEl = null;
  let dialogKeyEl = null;

  function closeMethodDialog() {
    if (dialogKeyEl) { document.removeEventListener('keydown', dialogKeyEl); dialogKeyEl = null; }
    if (dialogEl) { dialogEl.remove(); dialogEl = null; }
    if (dialogMaskEl) { dialogMaskEl.remove(); dialogMaskEl = null; }
    // 停掉可能还在跑的轮询
    unsubscribeDevice();
    window.gpe.auth.deviceCancel().catch(() => {});
  }

  /** 兼容旧调用:showDetail 现在等价于打开弹窗 */
  function showDetail(id) {
    if (window.S.account) return;
    openMethodDialog(id);
  }

  /** 折叠的步骤说明 —— 详细内容只在用户需要时展开 */
  function guide(summaryText, steps, actions) {
    const box = el('details', { class: 'guide' });
    box.appendChild(el('summary', {}, [
      el('span', { class: 'g-ico', 'data-icon': 'info', 'data-icon-size': '14' }),
      el('span', { text: summaryText }),
      el('span', { class: 'g-arrow', 'data-icon': 'chevronDown', 'data-icon-size': '14' }),
    ]));
    box.appendChild(el('div', { class: 'g-body' }, [
      el('ol', { class: 'g-steps' }, steps.map((s) => el('li', { html: s }))),
      actions && actions.length
        ? el('div', { class: 'flex gap-2 mt-3 flex-wrap' }, actions)
        : null,
    ]));
    return box;
  }

  /* ---------- 1. 访问令牌 ---------- */

  function buildTokenPanel() {
    const box = el('div', { class: 'panel' });

    box.appendChild(guide('查看令牌创建步骤(约 1 分钟)', [
      '点下面的 <strong>打开令牌创建页面</strong>(权限已经帮你预勾好)',
      'Note 随便写,Expiration 建议选 <strong>90 days</strong>',
      '确认 <strong>repo</strong> 这一整项是勾选状态',
      '拉到底点 <strong>Generate token</strong>,然后<strong>立刻复制</strong>那一串(离开页面就看不到了)',
      '回到这里粘贴到下面的输入框,点登录',
    ], [
      el('button', {
        class: 'btn sm primary', type: 'button',
        onclick: () => window.gpe.openExternal(
          'https://github.com/settings/tokens/new?scopes=repo,workflow&description=' +
          encodeURIComponent('小白推送 GitPushEasy')),
      }, [iconText('external', '打开令牌创建页面')]),
      el('button', {
        class: 'btn sm', type: 'button', text: '管理已有令牌',
        onclick: () => window.gpe.openExternal('https://github.com/settings/tokens'),
      }),
    ]));

    const input = el('input', {
      class: 'input mono', type: 'password', placeholder: 'ghp_…',
      autocomplete: 'off', spellcheck: 'false',
    });
    const toggle = el('button', { class: 'btn icon-only', type: 'button', title: '显示/隐藏' });
    toggle.appendChild(A.icon('eye', { size: 16 }));
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      clear(toggle).appendChild(A.icon(show ? 'eyeOff' : 'eye', { size: 16 }));
    });

    box.appendChild(el('div', { class: 'field mt-3' }, [
      el('label', { class: 'label', text: '访问令牌' }),
      el('div', { class: 'input-row' }, [input, toggle]),
      el('div', { class: 'text-xs text-subtle mt-2', text: '令牌只保存在这台电脑上,并以系统加密方式存储。' }),
    ]));

    const remember = el('input', { type: 'checkbox', checked: true });
    box.appendChild(el('label', { class: 'check mb-3' }, [
      remember,
      el('span', { class: 'txt' }, [
        el('span', { text: '记住这个账号' }),
        el('span', { class: 'sub', text: '下次打开程序自动登录;取消勾选则只在本次运行期间有效' }),
      ]),
    ]));

    const errBox = el('div');
    const loginBtn = el('button', { class: 'btn primary lg block', type: 'button', text: '登录' });
    loginBtn.addEventListener('click', async () => {
      const token = input.value.trim();
      if (!token) { window.U.toast('warn', '请先粘贴令牌'); input.focus(); return; }
      const restore = window.U.busy(loginBtn, '正在验证…');
      clear(errBox);
      const r = await window.gpe.auth.token({ token, remember: remember.checked });
      restore();
      if (!r.ok) {
        errBox.appendChild(el('div', { class: 'alert error mb-3' }, [
          el('span', { class: 'ico' }, [A.icon('alert', { size: 15 })]),
          el('div', { class: 'body' }, [
            el('div', { class: 'selectable', text: r.error }),
            el('div', { class: 'flex gap-2 mt-2 flex-wrap' }, [
              el('button', {
                class: 'btn sm', type: 'button',
                onclick: () => window.gpe.openExternal('https://github.com/settings/tokens/new?scopes=repo,workflow'),
              }, [iconText('external', '重新创建令牌')]),
              el('button', {
                class: 'btn sm', type: 'button', text: '改用浏览器授权',
                onclick: () => { openMethodDialog('device') },
              }),
            ]),
          ]),
        ]));
        return;
      }
      // 用返回的 login 直接落位,避免依赖"再查一次列表"
      await window.App.applyLogin(r.data.login, r.data);
      window.U.toast('ok', '登录成功', '欢迎,' + (r.data.name || r.data.login));
      window.App.go('home');
    });
    box.appendChild(errBox);
    box.appendChild(loginBtn);
    setTimeout(() => input.focus(), 60);
    return box;
  }

  /* ---------- 2. 浏览器授权 ---------- */

  /**
   * 浏览器授权(Device Flow)。
   *
   * 这里有个绕不开的现实:Device Flow 必须由**一个已勾选 Enable Device Flow
   * 的 OAuth App** 发起,而每个 OAuth App 都归属于某个具体账号 ——
   * GitHub 没有"公共 Client ID"这种东西可以借用。
   *
   * 所以没配置 Client ID 时,这一步必然失败(404)。与其让用户点了按钮才看到
   * 报错,不如把"申请 + 粘贴 + 立即校验"整套流程直接做在这张卡片里,
   * 并把「改用访问令牌」(唯一开箱即用的方式)放在同等显眼的位置。
   */
  function buildDevicePanel() {
    const box = el('div', { class: 'panel' });
    const hasOwnClientId = !!(window.S.settings.clientId || '').trim();

    if (!hasOwnClientId) {
      box.appendChild(renderClientIdSetup());
      return box;
    }

    // 已配置 Client ID —— 正常走授权流程
    box.appendChild(el('div', { class: 'flex items-center gap-2 mb-3' }, [
      el('span', { class: 'ic text-ok' }, [A.icon('check', { size: 15 })]),
      el('span', { class: 'text-sm', text: 'Client ID 已配置' }),
      el('button', {
        class: 'btn ghost sm', type: 'button', text: '换一个',
        onclick: async () => {
          await window.gpe.settings.set({ clientId: '' });
          window.S.settings.clientId = '';
          showDetail('device');
        },
      }),
    ]));

    const body = el('div', { id: 'deviceBody' });
    const startBtn = el('button', { class: 'btn primary lg block', type: 'button' },
      [iconText('globe', '开始授权(会自动打开浏览器)')]);
    startBtn.addEventListener('click', () => startDevice(startBtn, body));

    box.appendChild(body);
    box.appendChild(startBtn);
    return box;
  }

  /** 未配置 Client ID 时的完整引导(全部在这一张卡里完成) */
  function renderClientIdSetup() {
    const wrap = el('div', {});

    // ---- 先说清楚现状,并给出真正开箱即用的替代方案 ----
    wrap.appendChild(el('div', { class: 'alert warn mb-3' }, [
      U.alertIcon('alert'),
      el('div', { class: 'body' }, [
        el('div', { class: 'fw-650', text: '用这个方式前,需要先准备一个 Client ID' }),
        el('div', { class: 'mt-1 text-muted', text:
          'GitHub 规定浏览器授权必须由你自己的 OAuth App 发起,没有可以公用的 ID。' +
          '准备过程约 1 分钟,只需做一次。' }),
        el('div', { class: 'flex gap-2 mt-2 flex-wrap' }, [
          el('button', {
            class: 'btn sm primary', type: 'button',
            onclick: () => window.gpe.openExternal('https://github.com/settings/developers'),
          }, [iconText('external', '去创建 Client ID(1 分钟)')]),
          el('button', {
            class: 'btn sm', type: 'button',
            onclick: () => { openMethodDialog('token') },
          }, [iconText('key', '改用访问令牌(免配置)')]),
        ]),
      ]),
    ]));

    // ---- 步骤:默认折叠,需要时展开 ----
    const steps = el('div', { class: 'setup-steps' });
    const stepDefs = [
      {
        t: '打开 OAuth Apps 页面并新建应用',
        d: '点上面的按钮 → 再点页面里的 <strong>New OAuth App</strong>。',
      },
      {
        t: '按下面两行填写(其余保持默认)',
        d: '这两项必须填对,否则创建按钮点不动。点「复制」即可。',
        copy: [
          { label: 'Application name', value: '小白推送' },
          { label: 'Homepage URL', value: 'https://github.com' },
        ],
      },
      {
        t: '进入刚创建的应用,勾选 Enable Device Flow',
        d: '在应用设置页往下找 <strong>Enable Device Flow</strong>,勾上并保存。' +
          '这一步最关键 —— 不勾的话授权会一直失败。',
      },
      {
        t: '复制 Client ID 并粘贴到下面',
        d: '在应用页顶部能看到 <strong>Client ID</strong>,是一串 20 位左右的字母数字' +
          '(注意别复制成 Client Secret)。',
      },
    ];
    stepDefs.forEach((s, i) => {
      steps.appendChild(el('div', { class: 'setup-step' }, [
        el('span', { class: 'ss-num', text: String(i + 1) }),
        el('div', { class: 'ss-body' }, [
          el('div', { class: 'ss-title', text: s.t }),
          el('div', { class: 'ss-desc', html: s.d }),
          s.copy
            ? el('div', { class: 'mt-2' }, s.copy.map((c) => el('div', { class: 'copy-row' }, [
              el('span', { class: 'cr-label', text: c.label }),
              el('code', { class: 'cr-value', text: c.value }),
              el('button', {
                class: 'btn sm', type: 'button', 'data-copy': c.value,
              }, [iconText('copy', '复制')]),
            ])))
            : null,
        ]),
      ]));
    });

    const stepsBox = el('details', { class: 'guide' });
    stepsBox.appendChild(el('summary', {}, [
      el('span', { class: 'g-ico', 'data-icon': 'info', 'data-icon-size': '14' }),
      el('span', { text: '查看详细步骤(4 步)' }),
      el('span', { class: 'g-arrow', 'data-icon': 'chevronDown', 'data-icon-size': '14' }),
    ]));
    stepsBox.appendChild(el('div', { class: 'g-body' }, [steps]));
    wrap.appendChild(stepsBox);

    // ---- 粘贴 + 立即校验(始终可见,这是这一屏的主操作) ----
    const input = el('input', {
      class: 'input mono', type: 'text', placeholder: '粘贴 Client ID,例如 Ov23liXXXXXXXXXXXXXX',
      autocomplete: 'off', spellcheck: 'false',
    });
    const result = el('div', { class: 'mt-2' });

    const verifyBtn = el('button', { class: 'btn primary', type: 'button' }, [iconText('check', '校验并保存')]);
    const doVerify = async () => {
      const id = input.value.trim();
      if (!id) { window.U.toast('warn', '请先粘贴 Client ID'); input.focus(); return; }
      const restore = window.U.busy(verifyBtn, '正在向 GitHub 校验…');
      clear(result);
      const r = await window.gpe.auth.verifyClientId(id);
      restore();
      if (r.ok) {
        window.S.settings.clientId = id;
        result.appendChild(el('div', { class: 'alert ok' }, [
          U.alertIcon('check'),
          el('div', { class: 'body', text: '校验通过!这个 Client ID 可以用来登录了。' }),
        ]));
        window.U.toast('ok', 'Client ID 已保存', '现在可以开始授权了');
        setTimeout(() => showDetail('device'), 700);
        return;
      }
      const kind = r.data && r.data.reason;
      const hint = {
        'not-found': 'GitHub 上找不到这个 Client ID。请确认复制完整、没有多余空格;' +
          '另外注意 Client ID 和 Client Secret 是两串不同的值,别复制错了。',
        'device-flow-disabled': '这个应用的 Device Flow 没有启用。请到该应用的设置页勾选 Enable Device Flow 后再试。',
        'format': '格式看起来不对 —— Client ID 一般是一串 20 位左右的字母数字。',
        'network': '网络连不上 github.com。浏览器授权必须访问这个域名,可以开启代理后重试,或改用「访问令牌」。',
        'rate-limit': 'GitHub 接口访问次数暂时用完了,请稍后再试。',
      }[kind] || '';
      result.appendChild(el('div', { class: 'alert error' }, [
        U.alertIcon('alert'),
        el('div', { class: 'body' }, [
          el('div', { class: 'selectable', text: (r.data && r.data.message) || r.error || '校验失败' }),
          hint ? el('div', { class: 'mt-1', text: hint }) : null,
          el('div', { class: 'flex gap-2 mt-2 flex-wrap' }, [
            el('button', {
              class: 'btn sm', type: 'button',
              onclick: () => window.gpe.openExternal('https://github.com/settings/developers'),
            }, [iconText('external', '检查我的 OAuth Apps')]),
            el('button', {
              class: 'btn sm ghost', type: 'button',
              onclick: () => { openMethodDialog('token') },
            }, [iconText('key', '改用访问令牌')]),
          ]),
        ]),
      ]));
    };
    verifyBtn.addEventListener('click', doVerify);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doVerify(); });

    wrap.appendChild(el('div', { class: 'field mt-3' }, [
      el('label', { class: 'label', text: '已有 Client ID?粘贴到这里' }),
      el('div', { class: 'input-row' }, [input, verifyBtn]),
      el('div', { class: 'text-xs text-subtle mt-2', text:
        '校验通过后会自动保存在本机,以后不用再填。此操作只会向 GitHub 申请一次设备码用于验证,没有任何副作用。' }),
    ]));
    wrap.appendChild(result);

    return wrap;
  }

  async function startDevice(btn, body) {
    const restore = window.U.busy(btn, '正在获取验证码…');
    const r = await window.gpe.auth.deviceStart();
    restore();
    if (!r.ok) {
      clear(body).appendChild(el('div', { class: 'alert error mb-3' }, [
        el('span', { class: 'ico' }, [A.icon('alert', { size: 15 })]),
        el('div', { class: 'body' }, [
          el('div', { class: 'selectable', text: r.error }),
          el('div', { class: 'mt-2' }, [
            el('button', {
              class: 'btn sm', type: 'button', text: '填写 Client ID',
              onclick: () => window.Settings.open('security'),
            }),
          ]),
        ]),
      ]));
      return;
    }
    btn.classList.add('hidden');
    renderDeviceCode(body, r.data);
    window.gpe.openExternal(r.data.verificationUriComplete || r.data.verificationUri);
    subscribeDevice(body);
  }

  function renderDeviceCode(body, d) {
    clear(body);
    body.appendChild(el('div', { class: 'device-box' }, [
      el('div', { class: 'text-sm text-muted', text: '在浏览器页面里输入这串验证码' }),
      el('div', {
        class: 'device-code', text: d.userCode, title: '点击复制',
        onclick: () => window.U.copy(d.userCode),
      }),
      el('div', { class: 'flex gap-2 justify-center' }, [
        el('button', {
          class: 'btn sm', type: 'button', onclick: () => window.U.copy(d.userCode),
        }, [iconText('copy', '复制验证码')]),
        el('button', {
          class: 'btn sm', type: 'button',
          onclick: () => window.gpe.openExternal(d.verificationUriComplete || d.verificationUri),
        }, [iconText('external', '重新打开授权页')]),
      ]),
      el('div', { class: 'mt-4', id: 'deviceStatus' }, [
        el('div', { class: 'flex items-center justify-center gap-2 text-sm text-muted' }, [
          el('span', { class: 'pulse' }),
          el('span', { text: '等待你在浏览器里完成授权…(验证码 ' + Math.round(d.expiresIn / 60) + ' 分钟内有效)' }),
        ]),
      ]),
      el('button', {
        class: 'btn ghost sm mt-3', type: 'button', text: '取消',
        onclick: async () => {
          await window.gpe.auth.deviceCancel();
          unsubscribeDevice();
          showDetail('device');
        },
      }),
    ]));
    window.U.hydrateIcons(body);
  }

  function subscribeDevice() {
    unsubscribeDevice();
    deviceUnsub = window.gpe.auth.onDevice((payload) => {
      const status = $('#deviceStatus');
      if (!status) return;
      if (payload.state === 'ok') {
        clear(status).appendChild(el('div', { class: 'alert ok' }, [
          el('span', { class: 'ico' }, [A.icon('check', { size: 15 })]),
          el('div', { class: 'body', text: '授权成功,正在登录…' }),
        ]));
        unsubscribeDevice();
        setTimeout(async () => {
          await window.App.refreshAccount();
          window.U.toast('ok', '登录成功', '欢迎,' + (window.S.account ? window.S.account.name : ''));
          window.App.go('home');
        }, 400);
        return;
      }
      if (payload.state === 'pending') return;
      if (payload.state === 'expired' || payload.state === 'denied' || payload.state === 'error') {
        unsubscribeDevice();
        const clientIdIssue = payload.needsClientId ||
          /Client ID|Device Flow|OAuth/i.test(String(payload.message || ''));
        clear(status).appendChild(el('div', { class: 'alert ' + (payload.state === 'error' ? 'error' : 'warn') }, [
          el('span', { class: 'ico' }, [A.icon(payload.state === 'error' ? 'alert' : 'info', { size: 15 })]),
          el('div', { class: 'body' }, [
            el('div', { text: payload.message || '授权未完成。' }),
            el('div', { class: 'flex gap-2 mt-2 flex-wrap' }, [
              clientIdIssue ? el('button', {
                class: 'btn sm primary', type: 'button', text: '填写 Client ID',
                onclick: () => window.Settings.open('security'),
              }) : null,
              clientIdIssue ? el('button', {
                class: 'btn sm', type: 'button',
                onclick: () => window.gpe.openExternal('https://github.com/settings/developers'),
              }, [iconText('external', '申请一个')]) : null,
              el('button', {
                class: 'btn sm', type: 'button', text: '改用访问令牌',
                onclick: () => { openMethodDialog('token') },
              }),
              el('button', {
                class: 'btn sm ghost', type: 'button', text: '重试',
                onclick: () => showDetail('device'),
              }),
            ]),
          ]),
        ]));
        window.U.hydrateIcons(status);
      }
    });
  }

  function unsubscribeDevice() {
    if (deviceUnsub) { try { deviceUnsub(); } catch (_) {} deviceUnsub = null; }
  }

  /* ---------- 3. 本机 Git 凭据 ---------- */

  function buildGcmPanel() {
    const box = el('div', { class: 'panel' });

    const out = el('div');
    const btn = el('button', { class: 'btn primary lg block', type: 'button' },
      [iconText('archive', '读取本机保存的账号')]);
    btn.addEventListener('click', async () => {
      const restore = window.U.busy(btn, '正在读取…');
      clear(out);
      const r = await window.gpe.auth.credentialManager();
      restore();
      if (!r.ok) {
        out.appendChild(el('div', { class: 'alert warn mt-3' }, [
          el('span', { class: 'ico' }, [A.icon('info', { size: 15 })]),
          el('div', { class: 'body' }, [
            el('div', { text: r.error }),
            el('div', { class: 'flex gap-2 mt-2' }, [
              el('button', {
                class: 'btn sm', type: 'button', text: '改用访问令牌',
                onclick: () => { openMethodDialog('token') },
              }),
            ]),
          ]),
        ]));
        window.U.hydrateIcons(out);
        return;
      }
      await window.App.applyLogin(r.data.login, r.data);
      window.U.toast('ok', '登录成功', '已读取到 @' + r.data.login);
      window.App.go('home');
    });
    box.appendChild(btn);
    box.appendChild(out);

    box.appendChild(guide('什么情况下能用这个方式?', [
      '你以前在本机的命令行里推送过 GitHub 代码(用过 <code>git push</code> 并保存了密码)',
      '或者用过 GitHub Desktop 并保持登录状态',
      '从没登录过的话,换个方式即可 —— 「访问令牌」最简单',
    ], []));
    return box;
  }

  /* ============================================================ 已登录 */

  function renderSignedIn() {
    const a = window.S.account;
    const box = el('div', { class: 'card' });

    box.appendChild(el('div', { class: 'flex items-center gap-4' }, [
      avatarNode(a, 54),
      el('div', { class: 'flex-1' }, [
        el('div', { style: { fontSize: '16px', fontWeight: '680' }, text: a.name || a.login }),
        el('div', { class: 'text-muted text-sm', text: '@' + a.login }),
        el('div', { class: 'flex gap-2 mt-2 flex-wrap' }, [
          el('span', { class: 'badge green' }, [
            el('span', { class: 'ic', 'data-icon': 'check', 'data-icon-size': '11' }),
            el('span', { text: '已登录' }),
          ]),
          a.method ? el('span', { class: 'badge', text: methodLabel(a.method) }) : null,
          a.scopes ? el('span', { class: 'badge blue', text: '权限:' + shortenScopes(a.scopes) }) : null,
        ]),
      ]),
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => window.gpe.openExternal('https://github.com/' + a.login),
      }, [iconText('external', '打开我的 GitHub')]),
    ]));

    box.appendChild(el('div', { class: 'mt-5' }));
    box.appendChild(el('div', { class: 'flex gap-3 flex-wrap' }, [
      el('button', {
        class: 'btn primary lg', type: 'button', onclick: () => window.App.go('home'),
      }, [iconText('arrowRight', '开始上传项目')]),
      el('button', {
        class: 'btn lg', type: 'button',
        onclick: () => { window.S.account = null; render(); },
      }, [iconText('plus', '登录另一个账号')]),
      el('button', {
        class: 'btn lg', type: 'button', onclick: () => window.App.signOutAccount(a.login),
      }, [iconText('logout', '退出登录')]),
    ]));
    box.appendChild(el('div', { class: 'text-xs text-subtle mt-2', text:
      '退出登录不会删除本机保存的信息 —— 想再用时在下面或右上角账号菜单里选它即可。' }));

    /**
     * 本机保存过的其它账号 —— 在这里就能直接切过去。
     * 用户从"添加账号 / 登录"进来时,期待的就是这一屏能换账号,
     * 而不是看到和刚才一模一样的界面(那样会以为按钮坏了)。
     */
    const others = (window.S.accounts || []).filter((x) => x.login !== a.login);
    if (others.length) {
      box.appendChild(el('div', { class: 'mt-5' }));
      box.appendChild(el('div', { class: 'sec-title mb-1', text: '切换到本机已保存的账号' }));
      box.appendChild(el('div', { class: 'sec-desc mb-3', text: '不需要重新登录,点一下即可切换。' }));
      box.appendChild(el('div', { class: 'repo-grid' }, others.map((o) => el('button', {
        class: 'repo-item', type: 'button',
        onclick: () => window.App.switchAccount(o.login),
      }, [
        avatarNode(o, 22),
        el('div', { class: 'flex-1' }, [
          el('div', { class: 'r-name', text: o.login }),
          el('div', { class: 'r-meta', text: methodLabel(o.method) + ' · ' + window.U.timeAgo(o.savedAt) + ' 保存' }),
        ]),
        el('span', { class: 'text-subtle' }, [A.icon('chevronRight', { size: 14 })]),
      ]))));
    } else {
      box.appendChild(el('div', { class: 'mt-5' }));
      box.appendChild(el('div', { class: 'alert info' }, [
        U.alertIcon('info'),
        el('div', { class: 'body', text:
          '本机目前只保存了这一个账号。用上面的登录方式可以再添加一个 GitHub 账号,添加后就能在这里一键切换。' }),
      ]));
    }

    return box;
  }

  function avatarNode(a, size) {
    const style = {
      width: size + 'px', height: size + 'px',
      borderRadius: '50%', flex: 'none', objectFit: 'cover',
    };
    if (a && a.avatar) {
      return el('img', { src: a.avatar, alt: '', referrerpolicy: 'no-referrer', style });
    }
    return el('span', {
      style: Object.assign({}, style, {
        background: 'var(--brand-soft)', display: 'grid', placeItems: 'center',
        color: 'var(--brand-deep)', fontSize: Math.round(size * 0.46) + 'px',
      }),
    }, [A.icon('user', { size: Math.round(size * 0.55) })]);
  }

  function shortenScopes(s) {
    const list = String(s).split(/,\s*/).filter(Boolean);
    if (list.includes('repo')) return 'repo(可读写仓库)';
    if (!list.length) return '细粒度令牌';
    return list.slice(0, 3).join(', ') + (list.length > 3 ? '…' : '');
  }

  function methodLabel(m) {
    return { device: '浏览器授权', token: '访问令牌', gcm: '本机凭据' }[m] || m;
  }

  async function logout() {
    if (!window.S.account) return;
    await window.App.signOutAccount(window.S.account.login);
  }

  /* ============================================================ 右栏 */

  function renderSide() {
    const host = clear($('#loginSide'));
    if (!host) return;

    const card = el('div', { class: 'side-card' });
    card.appendChild(el('div', { class: 'side-head' }, [
      el('div', { class: 'side-title', text: '为什么需要登录?' }),
    ]));
    card.appendChild(el('div', { class: 'text-sm text-muted', text:
      '上传代码必须证明"你是这个仓库的主人",所以需要一次授权。' }));

    card.appendChild(el('div', { class: 'side-divider' }));
    card.appendChild(el('div', { class: 'checks' }, [
      sideLine('lock', '凭证只存在这台电脑', '用 Windows 系统级加密(DPAPI)保存,只有你的账户能解开。'),
      sideLine('shield', '只和 GitHub 通信', '没有中间服务器,没有埋点统计,代码不会经过任何第三方。'),
      sideLine('trash', '随时可以清除', '退出登录即可删除本机凭证;用令牌的话也能到 GitHub 上单独吊销。'),
    ]));
    host.appendChild(card);

    if (!window.S.info || !window.S.info.git || !window.S.info.git.available) {
      const warn = el('div', { class: 'side-card' });
      warn.appendChild(el('div', { class: 'side-head' }, [
        el('div', { class: 'side-title' }, [
          el('span', { class: 'ic text-warn', 'data-icon': 'alert', 'data-icon-size': '15' }),
          el('span', { text: '缺少 Git' }),
        ]),
      ]));
      warn.appendChild(el('div', { class: 'text-sm text-muted', text:
        '本工具底层使用官方 Git 程序上传文件,这是最可靠的方式。请先安装它,装好后重启本程序。' }));
      warn.appendChild(el('button', {
        class: 'btn primary block mt-3', type: 'button',
        onclick: () => window.gpe.openExternal('https://git-scm.com/download/win'),
      }, [iconText('external', '下载 Git for Windows')]));
      warn.appendChild(el('button', {
        class: 'btn block mt-2', type: 'button',
        onclick: async () => { await window.App.reloadInfo(); render(); },
      }, [iconText('refresh', '我已装好,重新检测')]));
      host.appendChild(warn);
    }
    window.U.hydrateIcons(host);
  }

  function sideLine(icon, title, text) {
    return el('div', { class: 'flex items-start gap-2', style: { padding: '5px 0' } }, [
      el('span', { class: 'ic text-muted', style: { flex: 'none', marginTop: '2px' },
        'data-icon': icon, 'data-icon-size': '14' }),
      el('div', { class: 'flex-1' }, [
        el('div', { class: 'text-sm fw-600', text: title }),
        el('div', { class: 'text-xs text-subtle', text: text }),
      ]),
    ]);
  }

  /** 图标 + 文字的 DocumentFragment */
  function iconText(name, text) {
    return window.U.iconLabel(name, text, { size: 15, strokeWidth: 1.9 });
  }

  /** 环境提示(缺 Git / 无法加密存储) */
  function renderEnv() {
    const box = el('div');
    if (window.S.info && window.S.info.git && !window.S.info.git.available) {
      box.appendChild(el('div', { class: 'alert error mb-4' }, [
        el('span', { class: 'ico' }, [A.icon('alert', { size: 15 })]),
        el('div', { class: 'body' }, [
          el('div', { class: 'fw-650', text: '没有检测到 Git,暂时无法上传' }),
          el('div', { class: 'mt-1', html:
            '请先安装 <strong>Git for Windows</strong>(一路点"下一步"装完,默认选项都不用改),然后重启本程序。' }),
          el('div', { class: 'flex gap-2 mt-2' }, [
            el('button', {
              class: 'btn sm primary', type: 'button',
              onclick: () => window.gpe.openExternal('https://git-scm.com/download/win'),
            }, [iconText('external', '下载 Git for Windows')]),
            el('button', {
              class: 'btn sm', type: 'button',
              onclick: async () => { await window.App.reloadInfo(); render(); },
            }, [iconText('refresh', '重新检测')]),
          ]),
        ]),
      ]));
    } else if (window.S.info && !window.S.info.encryption) {
      box.appendChild(el('div', { class: 'alert warn mb-4' }, [
        el('span', { class: 'ico' }, [A.icon('info', { size: 15 })]),
        el('div', { class: 'body', text:
          '当前系统不支持加密存储,登录信息会用较弱的保护方式保存,请自行注意。' }),
      ]));
    }
    return box;
  }

  window.ViewLogin = {
    render, renderSide, showDetail, unsubscribeDevice, ignoreNetHint,
    openMethodDialog, closeMethodDialog,
    /** 仅供测试注入探测结果 */
    __setWebReachable: (v) => {
      githubWebProbed = true;
      githubWebState = v;
      userIgnoredNetHint = false;
      render();
    },
  };
})();
