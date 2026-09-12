/**
 * settings.js —— 设置抽屉。
 *
 * 只放"真的会影响行为"的设置,并且每一条都写清楚为什么需要它。
 * 采用"先改本地草稿,点保存才生效"的方式,避免用户误触就改掉配置。
 */
(function () {
  'use strict';

  const { el, clear, $ } = window.U;

  let draft = null;
  let focusSection = null;

  function open(section) {
    focusSection = section || null;
    draft = JSON.parse(JSON.stringify(window.S.settings || {}));
    if (!draft.commitName && window.S.account) draft.commitName = window.S.account.login;
    if (!draft.commitEmail && window.S.account) {
      draft.commitEmail = `${window.S.account.login}@users.noreply.github.com`;
    }
    paint();
    $('#settingsMask').classList.add('open');
    $('#settingsDrawer').classList.add('open');
  }

  function close() {
    $('#settingsMask').classList.remove('open');
    $('#settingsDrawer').classList.remove('open');
    draft = null;
  }

  function paint() {
    const host = clear($('#settingsBody'));
    if (!host || !draft) return;

    /* ---- 身份 ---- */
    const identity = section('identity', 'user', '提交者身份', '每条提交都会记录"是谁改的"。GitHub 用它把你的提交和账号关联起来。');
    identity.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', text: '姓名' }),
      input('commitName', draft.commitName, '建议用你的 GitHub 用户名'),
    ]));
    identity.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', text: '邮箱' }),
      input('commitEmail', draft.commitEmail, '可以用 GitHub 的匿名邮箱'),
      el('div', { class: 'text-xs text-subtle mt-2', html:
        '不想暴露真实邮箱?用 GitHub 提供的 <code>数字+用户名@users.noreply.github.com</code>,' +
        '在 GitHub 的 Settings → Emails 页面能看到你的那个地址。' }),
    ]));
    identity.appendChild(el('div', { class: 'text-xs text-subtle', html:
      '留空的话,程序会优先使用你电脑上 Git 的全局配置(<code>user.name</code> / <code>user.email</code>);' +
      '如果那里也是空的,提交会失败并提示你来这里填写。' }));
    host.appendChild(identity);

    /* ---- 默认行为 ---- */
    const behavior = section('behavior', 'settings', '默认行为', '这些决定了"一键上传"时程序替你做的选择。');
    behavior.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', text: '默认分支名' }),
      input('defaultBranch', draft.defaultBranch, 'main'),
      el('div', { class: 'text-xs text-subtle mt-2', text: '新建仓库时使用的主分支名。GitHub 现在默认是 main。' }),
    ]));

    behavior.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', text: '同步远程内容的方式' }),
      el('label', { class: 'check' }, [
        radio('syncStrategy', 'rebase', draft.defaultSyncStrategy === 'rebase'),
        el('span', { class: 'txt' }, [
          el('span', { text: '变基(rebase)—— 推荐' }),
          el('span', { class: 'sub', text: '把你的改动接到别人的改动之后,提交历史是一条直线,最整洁。' }),
        ]),
      ]),
      el('label', { class: 'check' }, [
        radio('syncStrategy', 'merge', draft.defaultSyncStrategy === 'merge'),
        el('span', { class: 'txt' }, [
          el('span', { text: '合并(merge)' }),
          el('span', { class: 'sub', text: '保留分叉并生成一个合并提交。历史更"真实"但看起来会有岔路。' }),
        ]),
      ]),
    ]));

    behavior.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', text: '新建仓库时的默认可见性' }),
      el('label', { class: 'check' }, [
        radio('defaultVisibility', 'private', draft.defaultVisibility !== 'public'),
        el('span', { class: 'txt' }, [U.iconLabel('lock', '私有(推荐)')]),
      ]),
      el('label', { class: 'check' }, [
        radio('defaultVisibility', 'public', draft.defaultVisibility === 'public'),
        el('span', { class: 'txt' }, [U.iconLabel('globe', '公开')]),
      ]),
    ]));
    host.appendChild(behavior);

    /* ---- 外观 ---- */
    const theme = section('theme', 'activity', '外观', '');
    theme.appendChild(el('div', { class: 'flex gap-2 flex-wrap' }, [
      themeBtn('light', '亮色', 'sun'),
      themeBtn('dark', '暗色', 'moon'),
      themeBtn('system', '跟随系统', 'activity'),
    ]));
    host.appendChild(theme);

    /* ---- 登录与安全 ---- */
    const secure = section('security', 'lock', '登录与安全', '');
    const storage = (window.S.info && window.S.info.storage) || {};
    secure.appendChild(el('div', { class: 'alert ' + (window.S.info && window.S.info.encryption ? 'ok' : 'warn') + ' mb-4' }, [
      U.alertIcon(window.S.info && window.S.info.encryption ? 'lock' : 'alert'),
      el('div', { class: 'body' }, [
        el('div', { class: 'fw-600', text: window.S.info && window.S.info.encryption
          ? '登录信息已用系统级加密保存'
          : '当前系统不支持加密存储' }),
        el('div', { class: 'text-xs mt-1 break-all', text: '保存位置:' + (storage.file || '(未知)') }),
      ]),
    ]));

    secure.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', html: '浏览器授权的 Client ID <span class="hint">(可选,高级)</span>' }),
      input('clientId', draft.clientId, '留空使用内置的'),
      el('div', { class: 'text-xs text-subtle mt-2', html:
        '内置的 Client ID 若不可用,可以到 GitHub → Settings → Developer settings → OAuth Apps 新建一个应用,' +
        '勾选 <strong>Enable Device Flow</strong>,把 Client ID 填在这里。这样授权页面会显示你自己的应用名。' }),
    ]));

    const accounts = window.S.accounts || [];
    if (accounts.length) {
      secure.appendChild(el('div', { class: 'label', text: '本机保存的账号' }));
      secure.appendChild(el('div', { class: 'text-xs text-subtle mb-2', text:
        '这些账号的登录信息加密保存在本机。切换账号不需要删除 —— 在右上角账号菜单里直接选即可。' }));
      secure.appendChild(el('div', { class: 'mt-2' }, accounts.map((a) => el('div', { class: 'flex items-center gap-3', style: { padding: '6px 0' } }, [
        a.avatar ? el('img', { class: 'avatar sm', src: a.avatar, referrerpolicy: 'no-referrer' }) : null,
        el('div', { class: 'flex-1' }, [
          el('div', { class: 'text-sm mono', text: a.login }),
          el('div', { class: 'text-xs text-subtle', text: window.U.timeAgo(a.savedAt) + ' 保存' }),
        ]),
        window.S.account && window.S.account.login === a.login
          ? el('span', { class: 'badge green', text: '当前使用' })
          : el('button', {
            class: 'btn sm', type: 'button', text: '切换到这个账号',
            onclick: () => { window.App.switchAccount(a.login); close(); },
          }),
        el('button', {
          class: 'btn sm danger', type: 'button', text: '删除登录信息',
          onclick: async () => {
            // 交由 App 统一处理:它会先弹出明确的确认提示
            await window.App.forgetAccount(a.login);
            paint();
          },
        }),
      ]))));
    }
    host.appendChild(secure);

    /* ---- 网络与代理 ---- */
    const netw = section('network', 'globe', '网络与代理',
      '国内网络直连 GitHub 经常失败。程序会自动使用你系统里已开启的代理;也可以在这里手动指定或诊断。');
    const netBox = el('div', { id: 'netPanel' });
    netw.appendChild(netBox);
    paintNetwork(netBox);
    host.appendChild(netw);

    /* ---- 维护 ---- */
    const maint = section('maintenance', 'settings', '疑难排解', '当上传出现莫名其妙的问题时,这几个按钮通常能解决。');
    maint.appendChild(el('div', { class: 'flex gap-2 flex-wrap' }, [
      el('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          const r = await window.gpe.repo.fixSsl();
          if (!r.ok) { window.U.toast('error', '修复失败', r.error); return; }
          window.U.toast('ok', '已修复',
            r.data.length ? '清除了这些残留配置:' + r.data.join(', ') : '没有发现需要清理的残留配置。');
        },
      }, [U.iconLabel('settings', '修复 HTTPS 证书配置')]),
      el('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          await window.App.reloadInfo();
          paint();
          window.U.toast('ok', window.S.info.git.available ? 'Git 已就绪' : '仍未找到 Git', window.S.info.git.available ? '版本 ' + window.S.info.git.version : '请先安装 Git for Windows');
        },
      }, [U.iconLabel('refresh', '重新检测 Git')]),
      el('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => {
          const f = (window.S.info && window.S.info.storage && window.S.info.storage.file) || '';
          if (f) window.gpe.reveal(f);
        },
      }, [U.iconLabel('folderOpen', '打开配置文件夹')]),
    ]));
    maint.appendChild(el('div', { class: 'text-xs text-subtle mt-3', html:
      '如果只是某一次上传失败,更有效的做法是回到上传界面点"重新检查" —— 大多数失败都有具体原因,界面上会直接告诉你。' }));
    host.appendChild(maint);

    /* ---- 关于 ---- */
    const about = section('about', 'info', '关于', '');
    const info = window.S.info || {};
    about.appendChild(el('dl', { class: 'kv' }, [
      el('dt', { text: '程序版本' }), el('dd', { text: 'v' + (info.version || '—') }),
      el('dt', { text: 'Git' }), el('dd', { text: info.git && info.git.available ? 'v' + info.git.version + '(已就绪)' : '未安装' }),
      el('dt', { text: '运行环境' }), el('dd', { text: `Electron ${info.electron || '—'} / Node ${info.node || '—'}` }),
      el('dt', { text: '系统' }), el('dd', { text: (info.platform || '') + ' ' + (info.arch || '') }),
    ]));
    host.appendChild(about);

    /* 定位到指定区块 */
    if (focusSection) {
      const target = host.querySelector('[data-section="' + focusSection + '"]');
      if (target) setTimeout(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
    }
  }

  /* ------------------------------------------------------------ 小部件 */

  /* ------------------------------------------------------------ 网络面板 */

  let netState = { current: null, probing: false };

  /**
   * 网络与代理面板。
   *
   * 这块是专门为解决"大部分时候上传都遇到网络问题"而做的:
   * 自动识别系统里已开的代理(Clash / V2Ray 等),让用户不必自己去
   * 研究 git config;同时提供一键诊断,直接告诉他哪个域名通、哪个不通。
   */
  function paintNetwork(host) {
    clear(host);
    const cur = netState.current;

    // 当前在用的代理
    if (cur) {
      const ok = !!cur.proxy;
      host.appendChild(el('div', { class: 'alert ' + (ok ? 'ok' : 'warn') + ' mb-3' }, [
        U.alertIcon(ok ? 'check' : 'info'),
        el('div', { class: 'body' }, [
          el('div', { class: 'fw-650', text: ok ? '已自动启用代理' : '当前为直连(未使用代理)' }),
          el('div', { class: 'mt-1 mono text-xs break-all', text: ok ? cur.proxy : '—' }),
          el('div', { class: 'text-xs mt-1', text: ok ? '来源:' + cur.label : '如果上传不稳定,可以开启代理工具后回来重新检测' }),
        ]),
      ]));
    }

    // 手动填写
    const input = el('input', {
      class: 'input mono', type: 'text',
      placeholder: '例如 http://127.0.0.1:7890',
      value: cur && cur.proxy ? cur.proxy : '',
    });
    const out = el('div', { class: 'mt-2' });

    const saveBtn = el('button', { class: 'btn sm primary', type: 'button' }, [U.iconLabel('check', '保存代理')]);
    saveBtn.addEventListener('click', async () => {
      const v = input.value.trim();
      const restore = U.busy(saveBtn, '保存中…');
      clear(out);
      const r = await window.gpe.net.setProxy(v);
      restore();
      if (!r.ok) {
        out.appendChild(el('div', { class: 'alert error mt-2' }, [
          U.alertIcon('alert'), el('div', { class: 'body', text: r.error }),
        ]));
        return;
      }
      netState.current = r.data;
      U.toast('ok', v ? '代理已保存' : '已切换为直连', v || '');
      paintNetwork(host);
    });

    const clearBtn = el('button', { class: 'btn sm', type: 'button', text: '清除(改用直连)' });
    clearBtn.addEventListener('click', async () => {
      const r = await window.gpe.net.setProxy('');
      if (r.ok) { netState.current = r.data; U.toast('ok', '已切换为直连'); paintNetwork(host); }
    });

    const detectBtn = el('button', { class: 'btn sm', type: 'button' }, [U.iconLabel('search', '检测本机代理')]);
    detectBtn.addEventListener('click', async () => {
      const restore = U.busy(detectBtn, '正在检测…');
      clear(out);
      const r = await window.gpe.net.autoDetect();
      restore();
      if (!r.ok) { out.appendChild(el('div', { class: 'alert error mt-2' }, [U.alertIcon('alert'), el('div', { class: 'body', text: r.error })])); return; }
      netState.current = r.data.current;
      const found = r.data.found || [];
      if (found.length) {
        out.appendChild(el('div', { class: 'alert ok mt-2' }, [
          U.alertIcon('check'),
          el('div', { class: 'body' }, [
            el('div', { text: '发现 ' + found.length + ' 个正在运行的本地代理:' }),
            el('div', { class: 'flex gap-2 mt-2 flex-wrap' }, found.map((f) => el('button', {
              class: 'btn sm', type: 'button', text: f.proxy + '(' + f.name + ')',
              onclick: async () => {
                const rr = await window.gpe.net.setProxy(f.proxy);
                if (rr.ok) { netState.current = rr.data; U.toast('ok', '已使用 ' + f.proxy); paintNetwork(host); }
              },
            }))),
          ]),
        ]));
      } else {
        out.appendChild(el('div', { class: 'alert warn mt-2' }, [
          U.alertIcon('info'),
          el('div', { class: 'body', text: '没有发现常见端口上的本地代理。如果你在用代理工具,请确认它已开启「允许局域网/系统代理」,然后把地址填到上面的输入框。' }),
        ]));
      }
      paintNetwork(host);
      // 把刚填好的结果补回输入框
      const again = $('#netPanel input');
      if (again && netState.current && netState.current.proxy) again.value = netState.current.proxy;
      if (out.childNodes.length) host.appendChild(out);
    });

    host.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', html: '代理地址 <span class="hint">—— 留空表示直连</span>' }),
      el('div', { class: 'input-row' }, [input, saveBtn]),
      el('div', { class: 'flex gap-2 mt-2 flex-wrap' }, [detectBtn, clearBtn]),
    ]));
    host.appendChild(out);

    // 诊断
    const diagOut = el('div', { class: 'mt-3' });
    const diagBtn = el('button', { class: 'btn block', type: 'button' }, [U.iconLabel('activity', '运行网络诊断')]);
    diagBtn.addEventListener('click', async () => {
      const restore = U.busy(diagBtn, '正在测试…');
      clear(diagOut);
      const r = await window.gpe.net.diagnose();
      restore();
      if (!r.ok) { diagOut.appendChild(el('div', { class: 'alert error' }, [U.alertIcon('alert'), el('div', { class: 'body', text: r.error })])); return; }
      const d = r.data;
      const rows = (d.direct || []).map((x) => el('div', { class: 'flex items-center gap-2', style: { padding: '4px 0' } }, [
        el('span', { class: 'ic ' + (x.ok ? 'text-ok' : 'text-danger') }, [window.Art.icon(x.ok ? 'check' : 'close', { size: 14, strokeWidth: 2.2 })]),
        el('span', { class: 'mono text-sm flex-1', text: x.name }),
        el('span', { class: 'text-xs text-subtle', text: x.ok ? (x.status + ' · ' + x.ms + 'ms') : (x.error || '连接失败') }),
      ]));
      diagOut.appendChild(el('div', { class: 'card tight' }, [
        el('div', { class: 'fw-650 text-sm mb-1', text: '诊断结果' }),
        el('div', { class: 'text-xs text-subtle mb-2', text: '这两个域名分别用于:' }),
        ...rows,
        el('div', { class: 'text-xs text-subtle mt-2' }, [
          el('div', { text: '· api.github.com —— 登录、创建仓库、读取仓库列表' }),
          el('div', { class: 'mt-1', text: '· github.com —— 浏览器授权、打开网页' }),
        ]),
        el('div', { class: 'hr dashed' }),
        el('div', { class: 'text-xs text-muted', text: d.note }),
        el('div', { class: 'text-xs text-subtle mt-1', text:
          '注意:这项诊断本身不经过代理,所以即使这里显示失败,配置代理后 git 上传仍可能成功。' }),
      ]));
      paintNetwork(host);
      if (diagOut.childNodes.length) host.appendChild(diagOut);
    });
    host.appendChild(diagBtn);
    host.appendChild(diagOut);

    // 初次进入时拉一次当前状态
    if (!netState.current) {
      window.gpe.net.info().then((r) => {
        if (r.ok) { netState.current = r.data.current; paintNetwork(host); }
      });
    }
  }

  function section(id, icon, title, desc) {
    const box = el('section', { class: 'card mb-4', 'data-section': id });
    box.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 'sec-ico ic' }, [window.Art.icon(icon || 'info', { size: 18 })]),
      el('div', { class: 'flex-1' }, [
        el('div', { class: 'card-title', text: title }),
        desc ? el('div', { class: 'card-desc', text: desc }) : null,
      ]),
    ]));
    return box;
  }

  function input(key, value, placeholder) {
    const node = el('input', {
      class: 'input', type: 'text', value: value || '', placeholder: placeholder || '',
      oninput: (e) => { draft[key] = e.target.value; },
    });
    return node;
  }

  function radio(name, value, checked) {
    return el('input', {
      type: 'radio', name: name + '-setting', value, checked,
      onchange: (e) => { if (e.target.checked) draft[name] = value; },
    });
  }

  function themeBtn(value, label, icon) {
    const active = (draft.theme || 'light') === value;
    const btn = el('button', {
      class: 'btn' + (active ? ' primary' : ''), type: 'button',
      onclick: () => {
        draft.theme = value;
        // 立即预览
        window.S.settings.theme = value;
        window.SapplyTheme();
        paint();
      },
    }, [U.iconLabel(icon, label)]);
    return btn;
  }

  /* ------------------------------------------------------------ 保存 */

  async function save() {
    if (!draft) return;
    const r = await window.gpe.settings.set(draft);
    if (!r.ok) { window.U.toast('error', '保存失败', r.error); return; }
    window.S.settings = r.data;
    window.SapplyTheme();
    close();
    window.U.toast('ok', '设置已保存', '');
    window.App.renderTopbar();
  }

  function bind() {
    /* 元素不存在时安静跳过 —— 绑定函数里出现 null 引用会中断整个 bind(),
       让后面所有按钮失效,而界面上只表现为"点了没反应"。 */
    const on = (sel, evt, fn) => {
      const node = $(sel);
      if (node) node.addEventListener(evt, fn);
      return node;
    };

    on('#settingsBtn', 'click', () => open());
    on('#navSettings', 'click', () => open());
    on('#settingsClose', 'click', close);
    on('#settingsCancel', 'click', () => {
      close();
      window.SapplyTheme();
    });
    on('#settingsMask', 'click', () => {
      close();
      window.SapplyTheme();
    });
    on('#settingsSave', 'click', save);
  }

  window.Settings = { open, close, bind };
})();
