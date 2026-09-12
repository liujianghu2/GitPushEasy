/**
 * view-history.js —— 提交历史与回滚。
 *
 * 这一屏要回答三个问题:
 *   1. 我这条分支上都有哪些提交?(哪些已经推送到 GitHub,哪些还只在本地)
 *   2. 我想回到哪一条?
 *   3. 回滚会不会影响到别人 / 会不会丢东西?——这是最关键的一点。
 *
 * 回滚提供三种方式,风险依次升高,界面必须让用户明确看到区别:
 *   · 创建备份分支后回退  ← 默认推荐,永远安全
 *   · 生成反向提交        ← 已推送的提交只能用这个
 *   · 丢弃之后的提交      ← 只对未推送的本地提交可用
 */
(function () {
  'use strict';

  const { el, clear, $, timeAgo, dateTime } = window.U;
  const A = window.Art;

  let data = null;
  let loading = false;

  /* ============================================================ 入口 */

  async function render() {
    const host = clear($('#historyMain'));
    if (!host) return;

    if (!window.S.folder) {
      host.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'empty' }, [
          U.bigIcon('folder'),
          el('h3', { text: '还没有选择文件夹' }),
          el('div', { class: 'text-sm', text: '先在首页选择一个 Git 项目,才能查看它的提交历史。' }),
          el('button', {
            class: 'btn primary mt-4', type: 'button', text: '去首页选择文件夹',
            onclick: () => window.App.go('home'),
          }),
        ]),
      ]));
      return;
    }

    host.appendChild(renderHead());
    const listBox = el('div', { id: 'historyList' });
    host.appendChild(listBox);
    await load();
  }

  function renderHead() {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'sec-head row' }, [
      el('div', { style: { minWidth: 0 } }, [
        el('div', { class: 'sec-title', text: '提交历史' }),
        el('div', { class: 'sec-desc', text: '查看这条分支上发生过的改动,并可以回滚到其中任意一条。' }),
      ]),
      el('div', { class: 'flex items-center gap-2 flex-none' }, [
        el('span', { class: 'badge brand' }, [
          U.iconLabel('branch', (data && data.branch) || (window.S.analysis && window.S.analysis.branch) || '—',
            { size: 11, strokeWidth: 2 }),
        ]),
        el('button', {
          class: 'btn sm', type: 'button',
          onclick: (e) => {
            const restore = window.U.busy(e.currentTarget, '刷新中…');
            load().finally(restore);
          },
        }, [U.iconLabel('refresh', '刷新')]),
        el('button', {
          class: 'btn sm', type: 'button', text: '返回上传',
          onclick: () => window.App.go('changes'),
        }),
      ]),
    ]));

    if (data && data.remoteError) {
      card.appendChild(el('div', { class: 'alert info' }, [
        U.alertIcon('info'),
        el('div', { class: 'body', text:
          '暂时无法确认哪些提交已经推送到 GitHub(' + data.remoteError + ')。' +
          '为了安全,程序会把所有提交都当作"可能已推送",只提供不重写历史的方式。' }),
      ]));
    }
    return card;
  }

  /* ============================================================ 数据 */

  async function load() {
    if (loading) return;
    loading = true;
    const box = $('#historyList');
    if (box) {
      clear(box);
      box.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'flex items-center gap-3' }, [
          el('span', { class: 'spinner', style: { borderColor: 'var(--brand)', borderRightColor: 'transparent' } }),
          el('div', { class: 'fw-600', text: '正在读取提交历史…' }),
        ]),
      ]));
    }

    const r = await window.gpe.repo.history({
      dir: window.S.folder,
      branch: window.S.analysis ? window.S.analysis.branch : undefined,
    });
    loading = false;
    if (!box) return;

    clear(box);
    if (!r.ok) {
      box.appendChild(window.U.buildErrorBox(r, el('button', {
        class: 'btn sm mt-3', type: 'button', text: '重试', onclick: () => load(),
      })));
      return;
    }

    data = r.data;
    // 头部里的分支名可能是刚拿到的,重画一次
    const head = $('#historyMain .card');
    if (head) head.replaceWith(renderHead());

    if (!data.commits || !data.commits.length) {
      box.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'empty' }, [
          U.bigIcon('history'),
          el('h3', { text: '还没有任何提交' }),
          el('div', { class: 'text-sm', text: '这个仓库还没有提交记录。先回到上传页做一次上传,这里就会有内容了。' }),
          el('button', {
            class: 'btn primary mt-4', type: 'button', text: '去上传',
            onclick: () => window.App.go('changes'),
          }),
        ]),
      ]));
      return;
    }

    box.appendChild(renderList(data));
  }

  function renderList(d) {
    const card = el('div', { class: 'card flush' });

    // 统计
    const pushed = d.commits.filter((c) => c.status === 'pushed').length;
    const local = d.commits.filter((c) => c.status === 'local').length;
    card.appendChild(el('div', { class: 'hist-summary' }, [
      el('span', { class: 'text-sm text-muted', text: `共 ${d.commits.length} 条提交` }),
      el('span', { style: { flex: '1' } }),
      pushed ? el('span', { class: 'badge green', text: `${pushed} 条已推送到 GitHub` }) : null,
      local ? el('span', { class: 'badge yellow', text: `${local} 条只在本地` }) : null,
    ]));

    const list = el('div', { class: 'hist-list' });
    d.commits.forEach((c, i) => list.appendChild(renderRow(c, i)));
    card.appendChild(list);
    return card;
  }

  function renderRow(c, index) {
    const isHead = index === 0;
    const statusMeta = {
      pushed: { cls: 'green', text: '已推送' },
      local: { cls: 'yellow', text: '仅本地' },
      unknown: { cls: '', text: '状态未知' },
    }[c.status] || { cls: '', text: '' };

    const row = el('div', { class: 'hist-row' + (isHead ? ' head' : '') }, [
      el('span', { class: 'hist-dot' }, [isHead ? A.icon('arrowRight', { size: 11, strokeWidth: 2.6 }) : null]),
      el('div', { class: 'hist-body' }, [
        el('div', { class: 'hist-subject', text: c.subject || '(无提交说明)', title: c.subject || '' }),
        el('div', { class: 'hist-meta' }, [
          el('code', { class: 'hist-hash', text: c.short || c.hash.slice(0, 7) }),
          el('span', { text: c.author || '' }),
          el('span', { text: timeAgo(c.date) || dateTime(c.date) }),
          isHead ? el('span', { class: 'badge brand', text: '当前' }) : null,
          statusMeta.text ? el('span', { class: 'badge ' + statusMeta.cls, text: statusMeta.text }) : null,
        ]),
      ]),
      el('div', { class: 'hist-actions' }, [
        el('button', {
          class: 'btn sm', type: 'button', title: '查看这条提交改了什么',
          onclick: () => showCommit(c),
        }, [U.iconLabel('search', '详情')]),
        isHead
          ? el('span', { class: 'text-xs text-subtle', text: '就是当前版本' })
          : el('button', {
            class: 'btn sm', type: 'button', title: '回到这条提交时的状态',
            onclick: () => openRollback(c),
          }, [U.iconLabel('history', '回滚到这里')]),
      ]),
    ]);
    return row;
  }

  /* ============================================================ 提交详情 */

  async function showCommit(c) {
    const r = await window.gpe.repo.diff({ dir: window.S.folder, file: null, ref: c.hash });
    const text = r.ok ? r.data : '';

    const mask = el('div', { class: 'overlay-mask open', style: { zIndex: '280' } });
    const dialog = el('div', {
      class: 'dialog open fit', style: { zIndex: '281', width: 'min(92vw, 900px)' },
      role: 'dialog', 'aria-modal': 'true',
    }, [
      el('div', { class: 'dialog-head' }, [
        el('div', { style: { flex: '1', minWidth: 0 } }, [
          el('div', { class: 'dh-title', text: c.subject || '(无提交说明)' }),
          el('div', { class: 'dh-sub mono', text:
            (c.short || '') + ' · ' + (c.author || '') + ' · ' + dateTime(c.date) }),
        ]),
        el('button', { class: 'x-btn', type: 'button', 'aria-label': '关闭', onclick: close }, [A.icon('close', { size: 16 })]),
      ]),
      el('div', { class: 'dialog-body' }, [
        text
          ? el('div', { class: 'diff-view', html: window.U.renderDiff(text) })
          : el('div', { class: 'alert info' }, [
            U.alertIcon('info'),
            el('div', { class: 'body', text: '这条提交没有可显示的差异(可能是空提交)。' }),
          ]),
      ]),
    ]);

    function close() {
      mask.remove(); dialog.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    mask.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
    document.body.appendChild(dialog);
  }

  /* ============================================================ 回滚 */

  function openRollback(c) {
    const canReset = c.status === 'local';
    const pushed = c.status === 'pushed';

    const mask = el('div', { class: 'overlay-mask open', style: { zIndex: '290' } });
    const dialog = el('div', {
      class: 'dialog open fit', style: { zIndex: '291', width: 'min(92vw, 640px)' },
      role: 'dialog', 'aria-modal': 'true',
    });

    let chosenMode = 'backup';
    const errBox = el('div', { class: 'mt-3' });

    const option = (mode, title, desc, disabled, disabledReason) => {
      const input = el('input', { type: 'radio', name: 'rollbackMode', value: mode, checked: chosenMode === mode, disabled });
      const box = el('label', { class: 'radio-card' + (chosenMode === mode ? ' on' : '') }, [
        input,
        el('div', { class: 'rc-body' }, [
          el('div', { class: 'rc-title', text: title }),
          el('div', { class: 'rc-desc', text: disabled ? disabledReason : desc }),
        ]),
      ]);
      input.addEventListener('change', () => {
        if (!input.checked) return;
        chosenMode = mode;
        dialog.querySelectorAll('.radio-card').forEach((n) => n.classList.remove('on'));
        box.classList.add('on');
      });
      return box;
    };

    dialog.appendChild(el('div', { class: 'dialog-head' }, [
      el('div', { style: { flex: '1', minWidth: 0 } }, [
        el('div', { class: 'dh-title', text: '回滚到这条提交' }),
        el('div', { class: 'dh-sub mono truncate', text: (c.short || '') + ' · ' + (c.subject || '') }),
      ]),
      el('button', { class: 'x-btn', type: 'button', 'aria-label': '关闭', onclick: close }, [A.icon('close', { size: 16 })]),
    ]));

    dialog.appendChild(el('div', { class: 'dialog-body' }, [
      el('div', { class: 'alert warn mb-3' }, [
        U.alertIcon('alert'),
        el('div', { class: 'body' }, [
          el('div', { class: 'fw-650', text: '回滚会把项目内容退回到这条提交时的样子' }),
          el('div', { class: 'mt-1 text-muted', text:
            '这条提交之后的所有改动都会被撤销。请选择一种方式 —— 不同方式对"历史"和"别人"的影响不一样。' }),
        ]),
      ]),

      option('backup', '① 先创建备份分支,再回退(推荐)',
        '先把当前状态完整备份到一条新分支,再回退。就算事后发现回滚错了,也能从备份分支找回来。',
        false),

      option('revert', '② 生成一条反向提交来抵消',
        '不删除任何历史,而是新增一条"撤销这些改动"的提交。已经推送到 GitHub 的改动必须用这个方式。',
        false),

      option('reset', '③ 直接丢弃这条提交之后的所有提交',
        canReset
          ? '历史会被重写。只在你确定这些提交还没推送到 GitHub 时才安全。'
          : '这些提交已经推送到 GitHub,用它会让本地历史和远程不一致、之后推送被拒。已禁用。',
        !canReset,
        '这条提交已经推送到 GitHub(或状态未知),不能重写历史。请用方式 ① 或 ②。'),

      errBox,
    ]));

    const confirmBtn = el('button', { class: 'btn primary', type: 'button' }, [U.iconLabel('check', '确认回滚')]);
    confirmBtn.addEventListener('click', async () => {
      const label = { backup: '方式①', revert: '方式②', reset: '方式③' }[chosenMode];
      const extra = chosenMode === 'reset'
        ? '\n\n⚠️ 方式③ 会永久丢弃这些提交。'
        : chosenMode === 'revert'
          ? '\n\n会新增一条回滚提交(历史保留)。'
          : '\n\n会先建一条备份分支,再用安全的方式回退。';
      if (!confirm(`确定要用${label}回滚到「${c.subject || c.short}」吗?${extra}`)) return;

      clear(errBox);
      const restore = window.U.busy(confirmBtn, '正在回滚…');
      const r = await window.gpe.repo.rollback({
        dir: window.S.folder,
        hash: c.hash,
        mode: chosenMode,
        branch: data ? data.branch : undefined,
        confirm: true,
      });
      restore();

      if (!r.ok) {
        errBox.appendChild(window.U.buildErrorBox(r, el('div', { class: 'flex gap-2 mt-2 flex-wrap' }, [
          el('button', { class: 'btn sm', type: 'button', text: '重试', onclick: () => { clear(errBox); } }),
          el('button', {
            class: 'btn sm ghost', type: 'button', text: '查看回滚帮助',
            onclick: () => window.KB.open('tutorials', 'rescue'),
          }),
        ])));
        return;
      }

      close();
      showRollbackResult(r.data);
    });

    dialog.appendChild(el('div', { class: 'dialog-foot' }, [
      el('button', { class: 'btn', type: 'button', text: '取消', onclick: close }),
      confirmBtn,
    ]));

    function close() {
      mask.remove(); dialog.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    mask.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
    document.body.appendChild(dialog);
    window.U.hydrateIcons(dialog);
  }

  /** 回滚完成后的结果提示:说清做了什么、怎么找回 */
  function showRollbackResult(res) {
    const mask = el('div', { class: 'overlay-mask open', style: { zIndex: '300' } });
    const dialog = el('div', {
      class: 'dialog open fit', style: { zIndex: '301', width: 'min(92vw, 560px)' },
      role: 'dialog', 'aria-modal': 'true',
    }, [
      el('div', { class: 'dialog-head' }, [
        el('div', { style: { flex: '1' } }, [
          el('div', { class: 'dh-title', text: '回滚完成' }),
          el('div', { class: 'dh-sub', text: '以下是这次回滚做了什么' }),
        ]),
        el('button', { class: 'x-btn', type: 'button', 'aria-label': '关闭', onclick: close }, [A.icon('close', { size: 16 })]),
      ]),
      el('div', { class: 'dialog-body' }, [
        el('div', { class: 'progress-list' }, (res.steps || []).map((s) => el('div', { class: 'progress-item done' }, [
          el('span', { class: 'pi-icon' }),
          el('span', { class: 'pi-label', text: s.label }),
          s.detail ? el('span', { class: 'pi-detail', text: s.detail }) : null,
        ]))),

        res.backupBranch
          ? el('div', { class: 'alert ok mt-3' }, [
            U.alertIcon('check'),
            el('div', { class: 'body' }, [
              el('div', { class: 'fw-650', text: '已经帮你留了后路' }),
              el('div', { class: 'mt-1', text: '回滚之前的状态完整保存在备份分支:' }),
              el('div', { class: 'mono text-sm mt-1', text: res.backupBranch }),
              el('div', { class: 'text-xs text-subtle mt-1', text: '如果发现回滚错了,可以切回这条分支找回原来的内容。' }),
            ]),
          ])
          : res.createdCommit
            ? el('div', { class: 'alert ok mt-3' }, [
              U.alertIcon('check'),
              el('div', { class: 'body', text: '已生成回滚提交 ' + res.createdCommit + '。记得把它推送到 GitHub,别人才能看到这次回滚。' }),
            ])
            : null,

        el('div', { class: 'alert info mt-3' }, [
          U.alertIcon('info'),
          el('div', { class: 'body', text: res.wasOnRemote
            ? '这条提交之前已经推送到 GitHub,所以程序用了不重写历史的方式。'
            : '这条提交只在本地,程序可以直接安全回退。' }),
        ]),
      ]),
      el('div', { class: 'dialog-foot' }, [
        el('button', {
          class: 'btn primary', type: 'button', text: '知道了',
          onclick: () => { close(); window.App.go('changes'); },
        }),
      ]),
    ]);

    function close() {
      mask.remove(); dialog.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    mask.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
    document.body.appendChild(dialog);
    window.U.hydrateIcons(dialog);
  }

  window.ViewHistory = { render, load };
})();
