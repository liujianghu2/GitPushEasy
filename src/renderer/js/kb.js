/**
 * kb.js —— 隐藏的 Git 知识库面板。
 *
 * 入口在左侧导航与右下角,快捷键 Ctrl+K,内容做完整:
 * 核心概念 / 流程图解 / 分步教程 / 命令速查 / 报错对照 / 一分钟小抄。
 *
 * 设计意图:让"我愿意学"的人能一步步学,"我只想赶紧传完"的人一个字都不用看。
 */
(function () {
  'use strict';

  const { el, clear, $, esc, md } = window.U;
  const A = window.Art;
  const K = window.GPEKnowledge;

  let tab = 'concepts';
  let itemId = null;
  let query = '';

  /* ============================================================ 开关 */

  /**
   * 打开知识库。
   *
   * @param whichTab   目标标签(concepts/diagrams/tutorials/commands/troubleshoot/cheat)
   * @param whichItem  目标条目:教程 id,或(搜索模式下)搜索关键词
   *
   * 注意:不传 whichItem 时会清空上一次的搜索词,
   * 否则会出现"点开报错对照却只显示一条"这种状态残留的怪现象。
   */
  function open(whichTab, whichItem) {
    if (whichTab) tab = whichTab;
    if (whichItem) {
      itemId = whichItem;
      if (whichTab === 'commands' || whichTab === 'troubleshoot') query = whichItem;
    } else {
      itemId = null;
      query = '';
    }
    const s = $('#kbSearch');
    if (s) s.value = query;
    paintTabs();
    paint();
    $('#kbMask').classList.add('open');
    $('#kbPanel').classList.add('open');
    setTimeout(() => {
      const box = $('#kbSearch');
      if (box && !query) box.focus();
    }, 60);
  }

  function close() {
    $('#kbMask').classList.remove('open');
    $('#kbPanel').classList.remove('open');
  }

  function isOpen() {
    return $('#kbPanel').classList.contains('open');
  }

  function toggle() {
    if (isOpen()) close(); else open();
  }

  /* ============================================================ 渲染 */

  function paintTabs() {
    const nav = $('#kbTabs');
    if (!nav) return;
    nav.querySelectorAll('[data-kbtab]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-kbtab') === tab);
    });
  }

  function paint() {
    const nav = clear($('#kbNav'));
    const content = clear($('#kbContent'));
    if (!nav || !content) return;

    /* 搜索框是唯一事实来源:如果它的内容变了(比如用户手动清空,
       或者 input 事件还卡在防抖里),以它为准,避免状态不同步。 */
    const box = $('#kbSearch');
    if (box && box.value.trim() !== query) query = box.value.trim();

    // 切换标签时重置选中项
    if (tab !== 'tutorials' && tab !== 'commands') itemId = null;

    if (tab === 'concepts') paintConcepts(content);
    else if (tab === 'diagrams') paintDiagrams(content);
    else if (tab === 'tutorials') paintTutorials(nav, content);
    else if (tab === 'commands') paintCommands(nav, content);
    else if (tab === 'troubleshoot') paintTroubleshoot(content);
    else if (tab === 'cheat') paintCheat(content);

    content.scrollTop = 0;
  }

  /* ------------------------------------------------------------ 核心概念 */

  function paintConcepts(content) {
    content.appendChild(el('h2', { text: 'Git 的六个核心概念' }));
    content.appendChild(el('p', {
      class: 'text-muted',
      text: '不用背命令,先理解这六件事。理解了它们,所有 Git 命令都变得"能猜出来"。',
    }));

    for (const c of K.CONCEPTS) {
      content.appendChild(el('div', { class: 'concept' }, [
        el('div', { class: 'c-ico', text: c.icon }),
        el('div', { class: 'flex-1' }, [
          el('div', { class: 'c-title', text: c.title }),
          el('div', { class: 'c-body', text: c.body }),
        ]),
      ]));
    }

    content.appendChild(el('div', { class: 'hr' }));
    content.appendChild(el('h3', { text: '一个比喻讲完 Git' }));
    content.appendChild(el('div', { class: 'md', html: md(`
Git 就像一个**只会拍照的档案管理员**。

  · 你改文件 —— 他在旁边看着,但**不动手**
  · 你说"记一下"(git add)—— 他把你要记的东西挑出来放进托盘
  · 你说"拍"(git commit)—— 他对整个项目拍一张照片,写上时间、作者、说明,编号存档
  · 你想回到三天前 —— 他翻出三天前那张照片,**一模一样的还原**
  · 你想同时试两个方案 —— 他允许你在"平行世界"里各拍一套照片(branch)
  · 别人也拍了照 —— 他把两套照片**按时间线拼起来**(merge / rebase)
  · 你怕电脑坏 —— 把照片库同步到云端(GitHub)一份(push)

他从不删除照片。所以哪怕你"搞砸了",照片还在,总有办法找回来。
`) }));

    content.appendChild(el('div', { class: 'alert info mt-5' }, [
      U.alertIcon('info'),
      el('div', { class: 'body', html:
        '看完这些,建议接着看 <strong>「流程图解」</strong> 里的第一张图 —— ' +
        '它把"文件从你的文件夹到 GitHub"的完整路径画出来了,只需要记住 4 个动词。' }),
    ]));
  }

  /* ------------------------------------------------------------ 流程图解 */

  function paintDiagrams(content) {
    content.appendChild(el('h2', { text: '流程图解' }));
    content.appendChild(el('p', {
      class: 'text-muted',
      text: '四张图,覆盖 90% 的日常困惑。建议按顺序看。',
    }));

    for (const d of K.DIAGRAMS) {
      content.appendChild(el('div', { class: 'diagram' }, [
        el('div', { class: 'd-title', text: d.title }),
        el('div', { class: 'd-cap', text: d.caption }),
        el('pre', { text: d.art.replace(/^\n/, '') }),
      ]));
    }
  }

  /* ------------------------------------------------------------ 分步教程 */

  function paintTutorials(nav, content) {
    nav.appendChild(el('div', { class: 'nav-group', text: '从零开始' }));
    for (const t of K.TUTORIALS) {
      const active = itemId ? itemId === t.id : K.TUTORIALS.indexOf(t) === 0;
      if (active && !itemId) itemId = t.id;
      nav.appendChild(navItem(t.title, active, () => { itemId = t.id; paint(); },
        t.minutes ? t.minutes + ' 分钟' : ''));
    }

    const t = K.tutorialById(itemId) || K.TUTORIALS[0];
    if (!t) return;

    const idx = K.TUTORIALS.indexOf(t);
    content.appendChild(el('div', { class: 'flex items-center gap-2 mb-3 flex-wrap' }, [
      el('span', { class: 'badge brand', text: '第 ' + (idx + 1) + ' / ' + K.TUTORIALS.length + ' 课' }),
      el('span', { class: 'badge', text: '约 ' + t.minutes + ' 分钟' }),
      ...(t.tags || []).map((g) => el('span', { class: 'badge blue', text: g })),
    ]));
    content.appendChild(el('div', { class: 'md', html: md(t.body) }));

    // 上/下一课
    const prev = K.TUTORIALS[idx - 1];
    const next = K.TUTORIALS[idx + 1];
    content.appendChild(el('div', { class: 'hr' }));
    content.appendChild(el('div', { class: 'flex justify-between gap-3' }, [
      prev ? el('button', {
        class: 'btn', type: 'button', text: '← ' + prev.title.replace(/^第 \d+ 课:/, '').trim(),
        onclick: () => { itemId = prev.id; paint(); },
      }) : el('span'),
      next ? el('button', {
        class: 'btn primary', type: 'button', text: next.title.replace(/^第 \d+ 课:/, '').trim() + ' →',
        onclick: () => { itemId = next.id; paint(); },
      }) : el('span', { class: 'text-sm text-muted'}, [U.iconLabel('check', '全部看完了')]),
    ]));
  }

  /* ------------------------------------------------------------ 命令速查 */

  function paintCommands(nav, content) {
    const results = K.search(query);

    // 搜索框内容与面板同步
    const searchNode = $('#kbSearch');
    if (searchNode && searchNode.value !== query) searchNode.value = query;

    // 左侧:分组导航
    nav.appendChild(el('div', { class: 'nav-group', text: '按分类浏览' }));
    nav.appendChild(navItemIcon('file', '全部命令', !query, () => {
      query = '';
      if (searchNode) searchNode.value = '';
      paint();
    }, String(K.COMMANDS.length)));
    for (const g of K.groups) {
      const count = K.COMMANDS.filter((c) => c.group === g).length;
      nav.appendChild(navItem(g, false, () => {
        query = g;
        if (searchNode) searchNode.value = g;
        paint();
      }, String(count)));
    }

    if (query) {
      content.appendChild(el('h2', { text: '搜索「' + query + '」' }));
      content.appendChild(el('p', { class: 'text-muted' }, [
        el('span', { text: '找到 ' + results.length + ' 条命令。' }),
        el('button', {
          class: 'btn ghost sm', type: 'button', text: '清除搜索',
          onclick: () => { query = ''; if (searchNode) searchNode.value = ''; paint(); },
        }),
      ]));
    } else {
      content.appendChild(el('h2', { text: 'Git 命令速查' }));
      content.appendChild(el('p', { class: 'text-muted', html:
        '共 <strong>' + K.COMMANDS.length + '</strong> 条常用命令,按分类整理。' +
        '鼠标移到某一行会显示"复制"按钮。带 <span class="badge red">危险</span> 标记的请谨慎使用。' }));
      content.appendChild(el('div', { class: 'alert warn' }, [
        U.alertIcon('alert'),
        el('div', { class: 'body', html:
          '<strong>危险操作提醒</strong>:<code>--force</code>、<code>reset --hard</code>、<code>clean -fd</code> ' +
          '这几个会真的丢东西。用以前先确认你没有未提交的改动,或者先 <code>git branch backup-今天</code> 留个后路。' }),
      ]));
    }

    if (!results.length) {
      content.appendChild(el('div', { class: 'empty' }, [
        U.bigIcon('search'),
        el('h3', { text: '没有找到匹配的命令' }),
        el('div', { text: '换个词试试。中文和英文都能搜,比如"撤销""冲突""rebase""token"。' }),
        el('button', {
          class: 'btn mt-3', type: 'button', text: '查看全部命令',
          onclick: () => { query = ''; if (searchNode) searchNode.value = ''; paint(); },
        }),
      ]));
      return;
    }

    // 按分组输出
    const grouped = new Map();
    for (const c of results) {
      if (!grouped.has(c.group)) grouped.set(c.group, []);
      grouped.get(c.group).push(c);
    }

    for (const [group, list] of grouped) {
      content.appendChild(el('div', { class: 'cmd-group-title', text: group + '( ' + list.length + ' )' }));
      for (const c of list) content.appendChild(cmdRow(c));
    }
  }

  function cmdRow(c) {
    const tags = (c.tags || []).filter((t) => !/^(核心|最常用|推荐|进阶)$/.test(t));
    const dangerous = (c.tags || []).some((t) => t === '危险' || t === '禁止');

    const row = el('div', { class: 'cmd' }, [
      el('code', { class: 'c-code', text: c.cmd }),
      el('div', { class: 'c-desc' }, [
        el('span', { text: c.desc }),
        dangerous ? el('span', { class: 'badge red', style: { marginLeft: '6px' }, text: '危险' }) : null,
      ]),
      el('div', { class: 'c-tags' }, tags.slice(0, 3).map((t) => el('span', { class: 'badge', text: t }))),
      el('button', {
        class: 'copy-btn', type: 'button', text: '复制',
        'data-copy': c.cmd,
      }),
    ]);
    return row;
  }

  /* ------------------------------------------------------------ 报错对照 */

  function paintTroubleshoot(content) {
    content.appendChild(el('h2', { text: '报错对照表' }));
    content.appendChild(el('p', { class: 'text-muted', html:
      '把你在命令行里看到的红色报错,或者本工具提示的错误代码,复制一段关键词到这里找。' +
      '点开每一条能看到原因和解决方案。' }));

    if (query) {
      const q = query.toLowerCase();
      const hits = K.TROUBLESHOOT.filter((t) => (t.error + t.cause + t.fix).toLowerCase().includes(q));
      content.appendChild(el('div', { class: 'alert info' }, [
        U.alertIcon('search'),
        el('div', { class: 'body' }, [
          el('span', { text: '正在筛选「' + query + '」,命中 ' + hits.length + ' 条。' }),
          el('button', {
            class: 'btn ghost sm', type: 'button', text: '显示全部',
            onclick: () => { query = ''; const s = $('#kbSearch'); if (s) s.value = ''; paint(); },
          }),
        ]),
      ]));
      for (const t of hits) content.appendChild(tsItem(t, true));
      if (!hits.length) {
        content.appendChild(el('div', { class: 'empty' }, [
          U.bigIcon('info'),
          el('h3', { text: '没找到对应的报错' }),
          el('div', { text: '试试只搜最关键的一两个英文单词,例如 "rejected"、"403"、"SSL"。' }),
        ]));
      }
      return;
    }

    for (const t of K.TROUBLESHOOT) content.appendChild(tsItem(t, false));
  }

  function tsItem(t, openByDefault) {
    const box = el('div', { class: 'ts-item' + (openByDefault ? ' open' : '') });
    const head = el('div', { class: 'ts-head' }, [
      el('span', { class: 'text-danger ic' }, [A.icon('alert', { size: 15 })]),
      el('span', { class: 'ts-err', text: t.error, title: t.error }),
      el('span', { class: 'ts-arrow', text: '›' }),
    ]);
    head.addEventListener('click', () => box.classList.toggle('open'));

    box.appendChild(head);
    box.appendChild(el('div', { class: 'ts-body' }, [
      el('div', { class: 'row' }, [el('b', { text: '原因:' }), el('span', { text: t.cause })]),
      el('div', { class: 'row' }, [el('b', { text: '怎么解决:' }), el('span', { text: t.fix })]),
    ]));
    return box;
  }

  /* ------------------------------------------------------------ 小抄 */

  function paintCheat(content) {
    content.appendChild(el('h2', { text: '一分钟小抄' }));
    content.appendChild(el('p', { class: 'text-muted', text: '只要记住这三块,日常工作就够了。' }));

    for (const block of K.CHEATSHEET) {
      content.appendChild(el('div', { class: 'card mb-4' }, [
        el('div', { class: 'card-head' }, [el('div', { class: 'card-title', text: block.t })]),
        el('div', {}, block.items.map((s) => el('div', {
          class: 'flex items-start gap-2',
          style: { padding: '5px 0' },
        }, [
          el('span', { class: 'text-ok', text: '▸' }),
          el('span', { class: 'mono selectable', style: { fontSize: '12.5px' }, text: s }),
          el('button', {
            class: 'btn ghost sm', type: 'button', text: '复制',
            style: { marginLeft: 'auto', flex: 'none' },
            'data-copy': s.split('——')[0].trim(),
          }),
        ]))),
      ]));
    }

    content.appendChild(el('div', { class: 'hr' }));
    content.appendChild(el('h3', { text: '遇到问题时的固定动作' }));
    content.appendChild(el('div', { class: 'md', html: md(
      '不管出了什么状况,先按这个顺序看一遍,八成能找到原因:\n\n' +
      '    1. git status           —— 我现在到底在哪个状态?\n' +
      '    2. git log --oneline -5 —— 最近发生了什么?\n' +
      '    3. git remote -v        —— 我连的是哪个仓库?\n' +
      '    4. git diff             —— 我改了什么还没提交?\n' +
      '    5. git stash            —— 实在乱了,先把改动收起来,让工作区干净\n\n' +
      '**记住一件事**:只要提交过,Git 几乎不会真的丢东西。\n' +
      '`git reflog` 是你的后悔药,默认保留 90 天。\n'
    ) }));

    content.appendChild(el('div', { class: 'alert ok mt-4' }, [
      U.alertIcon('book'),
      el('div', { class: 'body', html:
        '想系统学一遍?回到 <strong>「分步教程」</strong>,8 节课大约 30 分钟,' +
        '看完你就不需要这类图形工具了 —— 但那也挺好的。' }),
    ]));
  }

  /* ------------------------------------------------------------ 工具 */

  function navItem(label, active, onclick, meta) {
    const b = el('button', {
      class: 'nav-item' + (active ? ' active' : ''), type: 'button',
      title: label,
    });
    if (meta) b.appendChild(el('span', { class: 'n-min', text: meta }));
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', onclick);
    return b;
  }

  /** 带图标的左侧导航项(和 navItem 用法一致,多一个图标名) */
  function navItemIcon(iconName, label, active, onclick, meta) {
    const b = el('button', {
      class: 'nav-item with-ico' + (active ? ' active' : ''), type: 'button',
      title: label,
    });
    if (meta) b.appendChild(el('span', { class: 'n-min', text: meta }));
    b.appendChild(el('span', { class: 'ni' }, [window.Art.icon(iconName, { size: 14 })]));
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', onclick);
    return b;
  }

  /* ============================================================ 绑定 */

  function bind() {
    /* 用 on() 统一绑定:元素不存在时安静跳过,绝不抛错。
       一个 null 引用会中断整个 bind(),导致后面的关闭按钮、标签切换全部失效
       —— 而且用户只会看到"点了没反应",极难排查。 */
    const on = (sel, evt, fn) => {
      const node = $(sel);
      if (node) node.addEventListener(evt, fn);
      return node;
    };

    on('#kbBtn', 'click', () => toggle());
    on('#fabKb', 'click', () => toggle());
    on('#kbClose', 'click', close);
    on('#kbMask', 'click', close);

    on('#kbTabs', 'click', (e) => {
      const btn = e.target.closest('[data-kbtab]');
      if (!btn) return;
      const next = btn.getAttribute('data-kbtab');
      // 切标签时清掉上一个标签遗留的搜索词,否则会出现"报错对照里只剩一条"这种怪现象
      if (next !== tab) {
        const s = $('#kbSearch');
        if (s && s.value) {
          s.value = '';
          query = '';
        }
      }
      tab = next;
      itemId = null;
      paintTabs();
      paint();
    });

    const search = $('#kbSearch');
    /**
     * 搜索框输入处理。
     *
     * 关键点:程序自己调 paint() 时也会改 input.value,那不是"用户在搜索"。
     * 所以这里只在【用户清楚地在打字】时才切换标签 —— 判据有两个:
     *   · 事件是可信的(isTrusted),排除脚本派发的合成事件
     *   · 或者输入框正处在聚焦状态
     * 否则就会出现"切到教程页又被搜索逻辑弹回命令页"的打架现象。
     */
    const handleSearchInput = (input, trusted) => {
      const typing = trusted || document.activeElement === input;
      if (!typing) return;
      const v = input.value.trim();
      query = v;
      if (v && tab !== 'commands' && tab !== 'troubleshoot') {
        tab = 'commands';
        paintTabs();
      }
      paint();
    };

    search.addEventListener('input', window.U.debounce((e) => {
      handleSearchInput(e.target, e.isTrusted);
    }, 220));

    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.target.value = '';
        query = '';
        paint();
      }
      // 回车立即搜索,不用等防抖
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearchInput(e.target, true);
      }
    });

    $('#fabHelp').addEventListener('click', () => {
      const view = window.App.currentView();
      const map = { login: 'tutorials', folder: 'concepts', changes: 'diagrams', status: 'cheat' };
      open(map[view] || 'concepts', view === 'login' ? 'auth' : null);
    });

    // 全局快捷键:Ctrl/Cmd + K
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      }
    });
  }

  window.KB = { open, close, toggle, paint, bind, isOpen };
})();
