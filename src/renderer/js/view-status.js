/**
 * view-status.js —— 步骤 4:上传结果。
 *
 * 成功的界面要回答三个问题:
 *   1. 到底成了没成?(明确结论,不要含糊)
 *   2. 传上去的是什么?(提交、分支、仓库)
 *   3. 接下来我要干什么?(打开仓库 / 发 Pull Request / 继续改)
 */
(function () {
  'use strict';

  const { el, clear, $, esc, bytes } = window.U;
  const A = window.Art;

  function render() {
    const host = clear($('#statusMain'));
    if (!host) return;

    const r = window.S.lastResult;
    if (!r) {
      host.appendChild(el('div', { class: 'empty' }, [
        U.bigIcon('upload'),
        el('h3', { text: '还没有上传记录' }),
        el('button', {
          class: 'btn primary mt-3', type: 'button', text: '去查看变更并上传',
          onclick: () => window.App.go('changes'),
        }),
      ]));
      return;
    }

    if (r.upToDate && !r.pushed) {
      renderUpToDate(host, r);
    } else {
      renderSuccess(host, r);
    }
  }

  /* ------------------------------------------------------------ 已经最新 */

  function renderUpToDate(host, r) {
    host.appendChild(el('div', { class: 'success-hero' }, [
      el('div', { class: 'ring ic', style: { background: 'var(--info-soft)' } }, [A.icon('clock', { size: 34, strokeWidth: 1.5 })]),
      el('h2', { text: '已经是最新的了' }),
      el('p', { text: '本地内容和 GitHub 上一模一样,没有什么需要上传的。' }),
    ]));

    host.appendChild(renderSteps(r.steps));

    host.appendChild(el('div', { class: 'flex gap-3 justify-center mt-5 flex-wrap' }, [
      r.repoUrl ? el('button', {
        class: 'btn primary', type: 'button', text: '↗ 打开 GitHub 仓库',
        onclick: () => window.gpe.openExternal(r.repoUrl),
      }) : null,
      el('button', {
        class: 'btn', type: 'button', text: '返回查看变更',
        onclick: () => window.App.go('changes'),
      }),
    ]));
  }

  /* ------------------------------------------------------------ 成功 */

  function renderSuccess(host, r) {
    host.appendChild(el('div', { class: 'success-hero' }, [
      el('div', { class: 'ring ic' }, [A.icon('check', { size: 36, strokeWidth: 2 })]),
      el('h2', { text: '上传成功!' }),
      el('p', { html: r.newBranch
        ? `你的改动已经安全地放到了 GitHub 的 <code>${esc(r.newBranch)}</code> 分支上。`
        : '你的代码已经在 GitHub 上了,现在别人也能看到、能协作。' }),
    ]));

    /* 关键信息 */
    const card = el('div', { class: 'card' });
    card.appendChild(el('dl', { class: 'kv' }, [
      el('dt', { text: '仓库' }),
      el('dd', {}, [el('span', { class: 'mono', text: repoLabel(r) })]),
      el('dt', { text: '分支' }),
      el('dd', {}, [
        el('span', { class: 'badge brand' }, [U.iconLabel('branch', r.branch || 'main', { size: 11, strokeWidth: 2 })]),
      ]),
      r.commit && r.commit.short ? el('dt', { text: '提交' }) : null,
      r.commit && r.commit.short ? el('dd', {}, [
        el('code', { text: r.commit.short }),
        el('span', { class: 'text-muted', style: { marginLeft: '8px' }, text: r.commit.message }),
      ]) : null,
      r.gitVersion ? el('dt', { text: '使用 Git' }) : null,
      r.gitVersion ? el('dd', { class: 'text-muted', text: 'v' + r.gitVersion }) : null,
    ].filter(Boolean)));
    host.appendChild(card);

    /* 执行过程 */
    host.appendChild(renderSteps(r.steps));

    /* Pull Request 引导 */
    if (r.next && r.next.type === 'pr') {
      host.appendChild(el('div', { class: 'alert info mt-4' }, [
        U.alertIcon('swap'),
        el('div', { class: 'body' }, [
          el('div', { class: 'fw-600', text: '下一步:把这些改动合并到主干' }),
          el('div', { class: 'mt-1 text-muted', text: r.next.text }),
          el('button', {
            class: 'btn primary sm mt-3', type: 'button',
            onclick: () => window.gpe.openExternal(r.next.url),
          }, [U.iconLabel('external', '到 GitHub 发起 Pull Request')]),
          el('button', {
            class: 'btn sm', type: 'button',
            onclick: () => window.KB.open('tutorials', 'workflow'),
          }, [U.iconLabel('book', '什么是 Pull Request?')]),
        ]),
      ]));
    }

    /* 接下来 */
    const actions = el('div', { class: 'flex gap-3 justify-center mt-6 flex-wrap' }, [
      r.url ? el('button', {
        class: 'btn primary lg', type: 'button',
        onclick: () => window.gpe.openExternal(r.url),
      }, [U.iconLabel('external', '在 GitHub 上查看')]) : null,
      r.repoUrl ? el('button', {
        class: 'btn lg', type: 'button',
        onclick: () => window.gpe.openExternal(r.repoUrl),
      }, [U.iconLabel('archive', '打开仓库主页')]) : null,
      el('button', {
        class: 'btn lg', type: 'button',
        onclick: () => {
          window.S.lastResult = null;
          window.S.selectedPaths = null;
          window.App.go('changes');
        },
      }, [U.iconLabel('refresh', '继续修改并上传')]),
    ]);
    host.appendChild(actions);

    /* 小提示 */
    host.appendChild(el('div', { class: 'hr' }));
    host.appendChild(el('div', { class: 'flex gap-2 flex-wrap justify-center' }, [
      el('button', {
        class: 'btn ghost sm', type: 'button',
        onclick: () => window.KB.open('tutorials', 'workflow'),
      }, [U.iconLabel('book', '接下来能做什么?')]),
      el('button', {
        class: 'btn ghost sm', type: 'button',
        onclick: () => window.KB.open('tutorials', 'branches'),
      }, [U.iconLabel('users', '怎么让别人一起改?')]),
      el('button', {
        class: 'btn ghost sm', type: 'button',
        onclick: () => window.KB.open('tutorials', 'auth'),
      }, [U.iconLabel('key', '换成免密登录')]),
    ]));

    host.appendChild(el('div', { class: 'text-xs text-subtle text-center mt-5', text:
      '这次上传的所有步骤都记录在上面的列表里 —— 它们对应的 Git 命令,你也可以在知识库里查到。' }));
  }

  /* ------------------------------------------------------------ 步骤列表 */

  function renderSteps(steps) {
    if (!steps || !steps.length) return el('span');
    const box = el('details', { class: 'card mt-4', open: true });
    box.appendChild(el('summary', { class: 'fw-600', style: { cursor: 'pointer' }, text: '上传过程明细' }));
    box.appendChild(el('div', { class: 'progress-list' }, steps.map((s) => el('div', { class: 'progress-item ' + s.status }, [
      el('span', { class: 'pi-icon' }),
      el('span', { class: 'pi-label', text: s.label }),
      s.detail ? el('span', { class: 'pi-detail', text: s.detail, title: s.detail }) : null,
    ]))));
    return box;
  }

  function repoLabel(r) {
    if (!r.repoUrl) return '—';
    return String(r.repoUrl).replace(/^https?:\/\/github\.com\//, '');
  }

  window.ViewStatus = { render };
})();
