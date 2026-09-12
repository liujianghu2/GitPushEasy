/**
 * view-projects.js —— 「项目」页:当前文件夹 + 最近用过的文件夹。
 *
 * 小白最常见的诉求是"我上次传的那个文件夹在哪",所以这里把最近用过的
 * 目录列出来,点一下就能直接继续上传,不用每次重新一层层翻目录。
 */
(function () {
  'use strict';

  const { el, clear, $, bytes, num, timeAgo } = window.U;
  const A = window.Art;

  const KEY = 'gpe.recentFolders';

  /* ============================================================ 记录读写 */

  function list() {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => x && x.path) : [];
    } catch (_) {
      return [];
    }
  }

  function remember(info) {
    if (!info || !info.path) return;
    const arr = list().filter((x) => x.path !== info.path);
    arr.unshift({
      path: info.path,
      name: info.name,
      files: (info.scan && info.scan.files) || 0,
      bytes: (info.scan && info.scan.bytes) || 0,
      isRepo: !!info.isRepo,
      at: Date.now(),
    });
    try { localStorage.setItem(KEY, JSON.stringify(arr.slice(0, 12))); } catch (_) {}
  }

  function forget(path) {
    const arr = list().filter((x) => x.path !== path);
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (_) {}
  }

  /* ============================================================ 渲染 */

  function render() {
    const host = clear($('#projectsMain'));
    if (!host) return;

    host.appendChild(renderCurrent());

    const arr = list();
    host.appendChild(renderRecent(arr));
  }

  function renderCurrent() {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'sec-head' }, [
      el('div', { class: 'sec-title', text: '当前项目' }),
      el('div', { class: 'sec-desc', text: '正在操作的这个文件夹。想换一个,点右侧按钮或直接用下面的最近列表。' }),
    ]));

    const info = window.S.folderInfo;
    if (!info) {
      card.appendChild(el('div', { class: 'empty' }, [
        U.bigIcon('folderOpen'),
        el('h3', { text: '还没有选择任何项目' }),
        el('div', { class: 'text-sm', text: '回到首页选择一个文件夹,或者把文件夹直接拖进窗口。' }),
        el('button', {
          class: 'btn primary mt-4', type: 'button', text: '去选择文件夹',
          onclick: () => window.App.go('home'),
        }),
      ]));
      return card;
    }

    const scan = info.scan || { files: 0, bytes: 0 };
    card.appendChild(el('div', { class: 'folder-card' }, [
      el('span', { class: 'fc-ico' }, [A.folderIcon()]),
      el('div', { class: 'fc-body' }, [
        el('div', { class: 'fc-path', text: info.path, title: info.path }),
        el('div', { class: 'fc-meta', text:
          `${num(scan.files)} 个文件 · ${bytes(scan.bytes)} · ` + (info.isRepo ? '已是 Git 仓库' : '尚未初始化 Git') }),
      ]),
      el('button', {
        class: 'btn', type: 'button', text: '打开所在位置',
        onclick: () => window.gpe.folder.openInExplorer(info.path),
      }),
      el('button', {
        class: 'btn primary', type: 'button', text: '继续上传',
        onclick: () => window.App.go('changes'),
      }),
    ]));

    const a = window.S.analysis;
    if (a) {
      card.appendChild(el('div', { class: 'sync-bar mt-4' }, [
        el('span', { class: 'badge brand' }, [U.iconLabel('branch', a.branch || 'main', { size: 11, strokeWidth: 2 })]),
        el('span', { class: 'flex-1', text: a.syncLabel || '' }),
        a.changes ? el('span', { class: 'badge', text: a.changes.total + ' 项变更' }) : null,
      ]));
    }

    return card;
  }

  function renderRecent(arr) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'sec-head row' }, [
      el('div', {}, [
        el('div', { class: 'sec-title', text: '最近使用' }),
        el('div', { class: 'sec-desc', text: '点一下即可切换到这个文件夹继续上传。' }),
      ]),
      arr.length ? el('button', {
        class: 'btn sm ghost', type: 'button', text: '清空列表',
        onclick: () => { try { localStorage.removeItem(KEY); } catch (_) {} render(); },
      }) : null,
    ]));

    if (!arr.length) {
      card.appendChild(el('div', { class: 'text-sm text-subtle', text: '还没有记录。选择过的文件夹会自动出现在这里。' }));
      return card;
    }

    const grid = el('div', { class: 'repo-grid' });
    for (const item of arr) {
      const cur = window.S.folder === item.path;
      grid.appendChild(el('div', { class: 'repo-item', style: { cursor: 'default' } }, [
        el('span', { class: 'fc-ico', style: { width: '26px', height: '26px' } }, [A.folderIcon(cur ? undefined : '#b9c6c0')]),
        el('div', { class: 'flex-1', style: { minWidth: 0 } }, [
          el('div', { class: 'r-name truncate', text: item.name || item.path, title: item.path }),
          el('div', { class: 'r-meta truncate', text:
            item.path + ' · ' + (item.files || 0) + ' 个文件 · ' + (item.at ? timeAgo(item.at) : '') }),
        ]),
        cur
          ? el('span', { class: 'badge green', text: '当前' })
          : el('button', {
            class: 'btn sm', type: 'button', text: '使用',
            onclick: () => use(item.path),
          }),
        el('button', {
          class: 'btn sm ghost', type: 'button', text: '移除', title: '从列表中移除(不会删除文件夹)',
          onclick: () => { forget(item.path); render(); },
        }),
      ]));
    }
    card.appendChild(grid);
    return card;
  }

  async function use(path) {
    // 直接切到首页并选中它
    window.S.folderInfo = null;
    window.S.analysis = null;
    window.S.selectedPaths = null;
    window.App.go('home');
    await window.ViewHome.select(path);
  }

  /* ============================================================ 上传记录 */

  const REC_KEY = 'gpe.records';

  function readRecords() {
    try {
      const arr = JSON.parse(localStorage.getItem(REC_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function writeRecords(arr) {
    try { localStorage.setItem(REC_KEY, JSON.stringify(arr.slice(0, 50))); } catch (_) {}
  }

  /** 上传结束后记一笔(成功和失败都记,失败也值得回顾) */
  function addRecord(rec) {
    const arr = readRecords();
    arr.unshift(Object.assign({ at: Date.now() }, rec));
    writeRecords(arr);
  }

  function renderRecords() {
    const host = clear($('#recordsMain'));
    if (!host) return;

    const arr = readRecords();

    const head = el('div', { class: 'card' });
    head.appendChild(el('div', { class: 'sec-head row' }, [
      el('div', {}, [
        el('div', { class: 'sec-title', text: '上传记录' }),
        el('div', { class: 'sec-desc', text: '这台电脑上每一次上传的结果。只保存在本地,不会上传到任何服务器。' }),
      ]),
      arr.length ? el('button', {
        class: 'btn sm ghost', type: 'button', text: '清空记录',
        onclick: () => {
          if (!confirm('确定要清空所有上传记录吗?\n(只删除这份列表,不影响 GitHub 上的任何内容。')) return;
          writeRecords([]);
          renderRecords();
        },
      }) : null,
    ]));

    if (!arr.length) {
      head.appendChild(el('div', { class: 'empty' }, [
        U.bigIcon('history'),
        el('h3', { text: '还没有上传记录' }),
        el('div', { class: 'text-sm', text: '第一次上传成功后,这里会留下记录,方便你回顾。' }),
        el('button', {
          class: 'btn primary mt-4', type: 'button', text: '去上传第一个项目',
          onclick: () => window.App.go('home'),
        }),
      ]));
      host.appendChild(head);
      return;
    }

    // 统计
    const okCount = arr.filter((r) => r.ok).length;
    head.appendChild(el('div', { class: 'stat-list', style: { gridTemplateColumns: 'repeat(3, 1fr)', display: 'grid' } }, [
      el('div', { class: 'stat-row' }, [
        el('span', { class: 'sr-ico add', text: '+' }),
        el('span', { class: 'sr-label', text: '成功' }),
        el('span', { class: 'sr-val', text: String(okCount) }),
      ]),
      el('div', { class: 'stat-row' }, [
        el('span', { class: 'sr-ico del', text: '!' }),
        el('span', { class: 'sr-label', text: '失败' }),
        el('span', { class: 'sr-val', text: String(arr.length - okCount) }),
      ]),
      el('div', { class: 'stat-row' }, [
        el('span', { class: 'sr-ico mod', text: 'Σ' }),
        el('span', { class: 'sr-label', text: '总计' }),
        el('span', { class: 'sr-val', text: String(arr.length) }),
      ]),
    ]));
    host.appendChild(head);

    const listCard = el('div', { class: 'card' });
    for (const r of arr) {
      listCard.appendChild(el('div', { class: 'record-item' + (r.ok ? '' : ' fail') }, [
        el('span', { class: 'ri-ico ic' }, [A.icon(r.ok ? 'check' : 'alert', { size: 14, strokeWidth: 2.2 })]),
        el('div', { class: 'ri-body' }, [
          el('div', { class: 'ri-title', text: r.repo || r.folder || '(未知)' }),
          el('div', { class: 'ri-sub', text:
            (r.ok ? (r.commit || '上传成功') : (r.error || '上传失败')) +
            (r.branch ? ' · 分支 ' + r.branch : '') +
            (r.at ? ' · ' + timeAgo(r.at) : '') }),
        ]),
        r.url ? el('button', {
          class: 'btn sm', type: 'button', text: '在 GitHub 打开',
          onclick: () => window.gpe.openExternal(r.url),
        }) : null,
        el('button', {
          class: 'btn sm ghost', type: 'button', text: '删除',
          onclick: () => {
            writeRecords(readRecords().filter((x) => x.at !== r.at));
            renderRecords();
          },
        }),
      ]));
    }
    host.appendChild(listCard);
  }

  window.ViewProjects = { render, renderRecords, remember, list, addRecord, readRecords };
})();
