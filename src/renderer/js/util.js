/**
 * util.js —— 渲染层通用工具:DOM、格式化、Toast、Markdown、diff 上色。
 * 不依赖任何库,所有输出都经过 HTML 转义,避免把文件名里的尖括号渲染成标签。
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- DOM */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (children != null) {
      const list = Array.isArray(children) ? children : [children];
      for (const c of list) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' || typeof c === 'number'
          ? document.createTextNode(String(c)) : c);
      }
    }
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function frag(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------------------------------------------------------------- 格式化 */

  function bytes(n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i];
  }

  function num(n) {
    if (n == null) return '—';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function timeAgo(input) {
    if (!input) return '';
    const t = typeof input === 'number' ? input : Date.parse(input);
    if (!t || isNaN(t)) return '';
    const diff = Date.now() - t;
    const s = Math.floor(diff / 1000);
    if (s < 60) return '刚刚';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + ' 个月前';
    return Math.floor(mo / 12) + ' 年前';
  }

  function dateTime(input) {
    const t = typeof input === 'number' ? input : Date.parse(input);
    if (!t || isNaN(t)) return '';
    const d = new Date(t);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 路径缩短显示:保留文件名,前面用 … 省略 */
  function shortPath(p, max) {
    const s = String(p || '');
    const n = max || 52;
    if (s.length <= n) return s;
    const parts = s.split(/[\\/]/);
    const file = parts.pop() || '';
    if (file.length >= n - 4) return '…' + file.slice(-(n - 1));
    let acc = file;
    while (parts.length) {
      const next = parts.pop();
      if ((next + '/' + acc).length > n - 2) break;
      acc = next + '/' + acc;
    }
    return '…/' + acc;
  }

  /* ---------------------------------------------------------------- Toast */

  function toast(kind, title, message, opts) {
    opts = opts || {};
    const host = $('#toasts');
    if (!host) return null;
    const iconMap = { ok: '✅', error: '⛔', warn: '⚠️', info: 'ℹ️' };
    const node = el('div', { class: 'toast ' + (kind || 'info') }, [
      el('span', { class: 't-ico', text: iconMap[kind] || 'ℹ️' }),
      el('div', { class: 't-body' }, [
        el('div', { class: 't-title', text: title || '' }),
        message ? el('div', { class: 't-msg selectable', text: message }) : null,
      ]),
    ]);
    host.appendChild(node);
    const life = opts.duration || (kind === 'error' ? 9000 : 4200);
    const kill = () => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 220);
    };
    const timer = setTimeout(kill, life);
    node.addEventListener('click', () => { clearTimeout(timer); kill(); });
    // 最多同时显示 4 条,多的挤掉最老的
    const all = $$('.toast', host);
    if (all.length > 4) all.slice(0, all.length - 4).forEach((n) => n.remove());
    return node;
  }

  /* ---------------------------------------------------------------- 复制 */

  async function copy(text) {
    try {
      const r = await window.gpe.copy(String(text));
      if (r && r.ok) {
        toast('ok', '已复制', String(text).length > 60 ? String(text).slice(0, 60) + '…' : String(text), { duration: 2000 });
        return true;
      }
    } catch (_) {}
    try {
      await navigator.clipboard.writeText(String(text));
      toast('ok', '已复制', '', { duration: 1800 });
      return true;
    } catch (_) {
      toast('error', '复制失败', '请手动选中文本后按 Ctrl+C');
      return false;
    }
  }

  /** 给任意容器里的 [data-copy] 元素绑定复制行为 */
  function bindCopy(root) {
    (root || document).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      copy(btn.getAttribute('data-copy'));
    });
  }

  /* ---------------------------------------------------------------- Markdown */

  /**
   * 极简 Markdown 渲染器。只覆盖本知识库用到的语法,
   * 但每一步都先转义再处理,不会因为内容里带 < > 而破版。
   */
  function md(src) {
    let text = String(src == null ? '' : src).replace(/\r\n/g, '\n');

    // 1. 先把代码块抽出来占位,避免里面的符号被后续规则误伤
    const blocks = [];
    text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      blocks.push({ lang, code });
      return `\u0000BLOCK${blocks.length - 1}\u0000`;
    });

    // 2. 整体转义
    text = esc(text);

    // 3. 缩进 4 空格以上的行当作代码块(知识库里大量使用这种写法)
    const lines = text.split('\n');
    const out = [];
    let inIndent = false;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const isIndent = /^(?: {4,}|\t)/.test(line) && line.trim() !== '';
      if (isIndent) {
        if (!inIndent) { out.push('<pre><code>'); inIndent = true; }
        out.push(line.replace(/^(?: {4}|\t)/, ''));
        continue;
      }
      if (inIndent) { out.push('</code></pre>'); inIndent = false; }
      out.push(line);
    }
    if (inIndent) out.push('</code></pre>');
    text = out.join('\n');

    // 4. 标题
    text = text.replace(/^######\s+(.*)$/gm, '<h4>$1</h4>')
      .replace(/^#####\s+(.*)$/gm, '<h4>$1</h4>')
      .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
      .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
      .replace(/^##\s+(.*)$/gm, '<h3>$1</h3>')
      .replace(/^#\s+(.*)$/gm, '<h2>$1</h2>');

    // 5. 分隔线
    text = text.replace(/^---+$/gm, '<hr>');

    // 6. 引用
    text = text.replace(/^&gt;\s?(.*)$/gm, '<blockquote><p>$1</p></blockquote>');
    text = text.replace(/<\/blockquote>\n<blockquote>/g, '\n');

    // 7. 表格(连续的 | 开头的行)
    text = text.replace(/(^\|.*\|\s*$\n?)+/gm, (chunk) => {
      const rows = chunk.trim().split('\n').map((r) => r.trim()).filter(Boolean);
      if (rows.length < 2) return chunk;
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const bodyRows = rows.slice(2).map(cells);
      let html = '<table><thead><tr>' + head.map((h) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
      for (const r of bodyRows) {
        html += '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>';
      }
      return html + '</tbody></table>\n';
    });

    // 8. 列表
    text = text.replace(/(?:^(?:\s{0,3})(?:[*-]|\d+\.)\s+.*$\n?)+/gm, (chunk) => {
      const items = chunk.trim().split('\n');
      const ordered = /^\s*\d+\./.test(items[0]);
      const inner = items.map((i) => '<li>' + i.replace(/^\s*(?:[*-]|\d+\.)\s+/, '') + '</li>').join('');
      const tag = ordered ? 'ol' : 'ul';
      return `<${tag}>${inner}</${tag}>\n`;
    });

    // 9. 行内
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" data-ext="$2">$1</a>');

    // 10. 段落
    text = text.split(/\n{2,}/).map((p) => {
      const t = p.trim();
      if (!t) return '';
      if (/^<(h\d|ul|ol|pre|blockquote|table|hr|div)/.test(t)) return t;
      return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');

    // 11. 放回代码块
    text = text.replace(/\u0000BLOCK(\d+)\u0000/g, (_m, i) => {
      const b = blocks[Number(i)];
      if (!b) return '';
      const cls = b.lang ? ` class="lang-${esc(b.lang)}"` : '';
      return `<pre><code${cls}>${esc(b.code.replace(/\n$/, ''))}</code></pre>`;
    });

    return text;
  }

  /* ---------------------------------------------------------------- diff */

  /** 把 git diff 的纯文本渲染成带行号、按增删上色的结构 */
  function renderDiff(text) {
    const lines = String(text || '').split('\n');
    if (!lines.some((l) => l.trim())) {
      return '<div class="diff-line meta"><span class="ln"></span><span class="tx">(没有可显示的差异内容)</span></div>';
    }
    let oldNo = 0;
    let newNo = 0;
    const out = [];
    for (const line of lines) {
      if (line === '' && out.length && out[out.length - 1] === '') continue;
      let cls = 'meta';
      let shown = line;
      let ln = '';
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        oldNo = parseInt(hunk[1], 10);
        newNo = parseInt(hunk[2], 10);
        cls = 'hunk';
      } else if (/^(\+\+\+|---|diff |index |new file|deleted file|similarity|rename )/.test(line)) {
        cls = 'meta';
      } else if (line.startsWith('+')) {
        cls = 'add'; ln = String(newNo++);
      } else if (line.startsWith('-')) {
        cls = 'del'; ln = String(oldNo++);
      } else if (line.startsWith(' ') || line === '') {
        cls = ''; ln = String(newNo++); oldNo += 1;
      }
      out.push(`<div class="diff-line ${cls}"><span class="ln">${esc(ln)}</span><span class="tx">${esc(shown)}</span></div>`);
    }
    return out.join('');
  }

  /* ---------------------------------------------------------------- 其它 */

  /** 打开发送外链 */
  function openExt(url) {
    if (!url) return;
    if (/^https?:\/\//i.test(url)) window.gpe.openExternal(url);
  }

  /** 全局事件委托:所有 data-ext 链接、data-copy 都由这里处理 */
  function bindGlobal() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-ext]');
      if (a) {
        e.preventDefault();
        openExt(a.getAttribute('data-ext'));
        return;
      }
      const c = e.target.closest('[data-copy]');
      if (c) {
        e.preventDefault();
        copy(c.getAttribute('data-copy'));
      }
    });
  }

  /** 简单的防抖 */
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms || 200);
    };
  }

  /**
   * 把页面里所有 [data-icon] 的空容器填成 SVG 图标。
   *
   * 这样 HTML 里只写 <span data-icon="settings">,图标实现统一收在 art.js,
   * 既不用在 HTML 里堆一大坨 <svg>,也不会散落 emoji(emoji 在不同系统上
   * 渲染差异很大,而且和线性图标混在一起显得杂乱)。
   * 可以重复调用,已经填过的会跳过。
   */
  function hydrateIcons(root) {
    if (!window.Art || !window.Art.icon) return 0;
    let n = 0;
    $$('[data-icon]', root || document).forEach((node) => {
      if (node.firstElementChild) return;   // 已经填过
      const name = node.getAttribute('data-icon');
      if (!name) return;
      const size = Number(node.getAttribute('data-icon-size')) || 0;
      node.appendChild(window.Art.icon(name, {
        size: size || undefined,
        strokeWidth: Number(node.getAttribute('data-icon-stroke')) || undefined,
      }));
      n += 1;
    });
    return n;
  }

  /** 生成一个规整的按钮/标签内容:图标 + 文字 */
  function iconLabel(name, text, opts) {
    const frag = document.createDocumentFragment();
    frag.appendChild(el('span', { class: 'ic' }, [window.Art.icon(name, {
      size: (opts && opts.size) || 15,
      strokeWidth: (opts && opts.strokeWidth) || 1.8,
    })]));
    if (text != null) frag.appendChild(el('span', { text }));
    return frag;
  }

  /**
   * 提示条里那个图标槽 —— 统一返回一个装好 SVG 的 <span class="ico">。
   * 之前这里放的是 emoji,不同系统渲染差异大,而且和线性图标风格不搭。
   */
  function alertIcon(name) {
    return el('span', { class: 'ico' }, [window.Art.icon(name || 'info', { size: 15 })]);
  }

  /** 空状态里的大图标 */
  function bigIcon(name) {
    return el('div', { class: 'big' }, [window.Art.icon(name || 'info', { size: 34, strokeWidth: 1.5 })]);
  }

  /** 尖角/圆圈里的小标记(✓ ! i) */
  function markIcon(name) {
    return el('span', { class: 'ic' }, [window.Art.icon(name, { size: 13, strokeWidth: 2.2 })]);
  }

  /** 按钮进入 loading 状态,返回 restore 函数 */
  function busy(btn, text) {
    if (!btn) return () => {};
    const original = btn.innerHTML;
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>' + esc(text || '处理中…');
    return () => {
      btn.disabled = wasDisabled;
      btn.innerHTML = original;
    };
  }

  /** 生成一个可在界面上安全展示的错误块 */
  function errorBlock(err, extra) {
    const msg = typeof err === 'string' ? err : (err && (err.friendly || err.error || err.message)) || '未知错误';
    const code = err && err.code ? err.code : '';
    return el('div', { class: 'alert error' }, [
      el('span', { class: 'ico', text: '⛔' }),
      el('div', { class: 'body' }, [
        el('div', { class: 'selectable', text: msg }),
        code && code !== 'ERROR' ? el('div', { class: 'text-xs text-subtle mt-1', text: '错误代码:' + code }) : null,
        extra || null,
      ]),
    ]);
  }

  /** errorBlock 的别名,方便视图代码里读起来更顺 */
  const buildErrorBox = errorBlock;

  window.U = {
    $, $$, el, clear, frag, esc,
    bytes, num, timeAgo, dateTime, shortPath,
    toast, copy, bindCopy, md, renderDiff,
    openExt, bindGlobal, debounce, busy, errorBlock, buildErrorBox,
    hydrateIcons, iconLabel, alertIcon, bigIcon, markIcon,
  };
})();
