/**
 * art.js —— 界面里的插画与图标。
 *
 * 全部内联生成,不依赖任何图片文件:打包体积为零,任意缩放都清晰,
 * 颜色跟着 currentColor 走,亮/暗主题自动适配。
 *
 * 图标统一规格:24×24 viewBox,线性描边 1.7,圆角端点。
 * 这样整套图标的视觉重量是一致的 —— 混用 emoji 会显得杂乱、
 * 在不同系统上还会渲染成完全不同的样子。
 */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  function tag(name, attrs, kids) {
    const node = document.createElementNS(NS, name);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        node.setAttribute(k, String(v));
      }
    }
    for (const c of [].concat(kids || [])) {
      if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function svg(viewBox, attrs, children) {
    const node = tag('svg', Object.assign({
      viewBox,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }, attrs || {}));
    for (const c of [].concat(children || [])) {
      if (c) node.appendChild(c);
    }
    return node;
  }

  /** 便捷:描边路径 */
  const P = (d, attrs) => tag('path', Object.assign({ d }, attrs || {}));
  /** 便捷:圆 */
  const C = (cx, cy, r, attrs) => tag('circle', Object.assign({ cx, cy, r }, attrs || {}));
  /** 便捷:矩形 */
  const R = (x, y, w, h, rx, attrs) => tag('rect', Object.assign({ x, y, width: w, height: h, rx }, attrs || {}));
  /** 便捷:直线 */
  const L = (x1, y1, x2, y2, attrs) => tag('line', Object.assign({ x1, y1, x2, y2 }, attrs || {}));

  /* ============================================================ 图标库 */

  /**
   * 每个条目是 () => SVGElement。
   * 需要填充色的图标(实心)单独标 fill: 'currentColor' 并去掉描边。
   */
  const ICONS = {
    /* ---- 侧边栏 ---- */
    home: () => svg('0 0 24 24', null, [
      P('M3.5 10.3 12 3.6l8.5 6.7'),
      P('M5.6 9.6V19a1.4 1.4 0 0 0 1.4 1.4h3.2v-5.1h3.6v5.1H17a1.4 1.4 0 0 0 1.4-1.4V9.6'),
    ]),
    folder: () => svg('0 0 24 24', null, [
      P('M3.4 7.4c0-.9.7-1.6 1.6-1.6h3.3l1.5 1.8h8.2c.9 0 1.6.7 1.6 1.6v8.4c0 .9-.7 1.6-1.6 1.6H5c-.9 0-1.6-.7-1.6-1.6z'),
    ]),
    history: () => svg('0 0 24 24', null, [
      C(12, 12, 8.2),
      P('M12 7.4V12l3.1 1.9'),
    ]),
    book: () => svg('0 0 24 24', null, [
      P('M3.4 5h5.4a2.4 2.4 0 0 1 2.4 2.4V20a1.9 1.9 0 0 0-1.9-1.9H3.4z'),
      P('M20.6 5h-5.4A2.4 2.4 0 0 0 12.8 7.4V20a1.9 1.9 0 0 1 1.9-1.9h5.9z'),
    ]),
    terminal: () => svg('0 0 24 24', null, [
      R(3, 4.6, 18, 14.8, 2.2),
      P('M7.2 9.6 9.9 12.2 7.2 14.8'),
      P('M12.4 15h4.4'),
    ]),
    settings: () => svg('0 0 24 24', null, [
      C(12, 12, 2.9),
      P('M19.3 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3.4a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3.4a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1z'),
    ]),

    /* ---- 登录方式 ---- */
    globe: () => svg('0 0 24 24', null, [
      C(12, 12, 8.4),
      P('M3.6 12h16.8'),
      P('M12 3.6c2.1 2.3 3.2 5.2 3.2 8.4S14.1 18.1 12 20.4c-2.1-2.3-3.2-5.2-3.2-8.4S9.9 5.9 12 3.6z'),
    ]),
    key: () => svg('0 0 24 24', null, [
      C(8.2, 15.8, 4.2),
      P('M11.2 12.8 19.4 4.6'),
      P('M16.4 7.6l2.2 2.2'),
      P('M14.2 9.8l2.2 2.2'),
    ]),
    archive: () => svg('0 0 24 24', null, [
      R(3.4, 4.6, 17.2, 4.2, 1.4),
      P('M5.2 8.8v9.4a1.4 1.4 0 0 0 1.4 1.4h10.8a1.4 1.4 0 0 0 1.4-1.4V8.8'),
      P('M10 12.4h4'),
    ]),

    /* ---- 通用动作 ---- */
    check: () => svg('0 0 24 24', null, [P('M4.8 12.6l4.6 4.6 9.8-10.4')]),
    close: () => svg('0 0 24 24', null, [P('M6 6l12 12'), P('M18 6L6 18')]),
    plus: () => svg('0 0 24 24', null, [P('M12 5.4v13.2'), P('M5.4 12h13.2')]),
    minus: () => svg('0 0 24 24', null, [P('M5.4 12h13.2')]),
    chevronDown: () => svg('0 0 24 24', null, [P('M6.4 9.4 12 15l5.6-5.6')]),
    chevronRight: () => svg('0 0 24 24', null, [P('M9.4 5.6 15 12l-5.6 6.4')]),
    arrowRight: () => svg('0 0 24 24', null, [P('M4.6 12h14.2'), P('M13.4 6.6 18.8 12l-5.4 5.4')]),
    arrowLeft: () => svg('0 0 24 24', null, [P('M19.4 12H5.2'), P('M10.6 6.6 5.2 12l5.4 5.4')]),
    external: () => svg('0 0 24 24', null, [
      P('M14.2 4.6h5.2v5.2'),
      P('M19.4 4.6 11 13'),
      P('M18 14.4v4.2a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 18.6V7.4A1.4 1.4 0 0 1 5.4 6h4.2'),
    ]),
    refresh: () => svg('0 0 24 24', null, [
      P('M20 11.4A8 8 0 1 0 18.2 16.8'),
      P('M20 5.6v5.8h-5.8'),
    ]),
    search: () => svg('0 0 24 24', null, [C(10.8, 10.8, 6.2), P('M15.4 15.4 20 20')]),
    copy: () => svg('0 0 24 24', null, [
      R(8.4, 8.4, 11.2, 11.2, 1.8),
      P('M15.6 5.4V4.6a1.4 1.4 0 0 0-1.4-1.4H5.4A1.4 1.4 0 0 0 4 4.6v8.8a1.4 1.4 0 0 0 1.4 1.4h.8'),
    ]),
    trash: () => svg('0 0 24 24', null, [
      P('M4.6 6.8h14.8'),
      P('M9.4 6.8V5.2a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.6'),
      P('M6.6 6.8l.9 12a1.4 1.4 0 0 0 1.4 1.3h6.2a1.4 1.4 0 0 0 1.4-1.3l.9-12'),
    ]),
    upload: () => svg('0 0 24 24', null, [
      P('M12 15.4V4.6'),
      P('M7.4 9.2 12 4.6l4.6 4.6'),
      P('M4.6 15.4v2.6a1.4 1.4 0 0 0 1.4 1.4h12a1.4 1.4 0 0 0 1.4-1.4v-2.6'),
    ]),
    eye: () => svg('0 0 24 24', null, [
      P('M2.6 12S6.2 5.8 12 5.8 21.4 12 21.4 12 17.8 18.2 12 18.2 2.6 12 2.6 12z'),
      C(12, 12, 3),
    ]),
    eyeOff: () => svg('0 0 24 24', null, [
      P('M4 4l16 16'),
      P('M9.6 5.9A8.6 8.6 0 0 1 12 5.8c5.8 0 9.4 6.2 9.4 6.2a17 17 0 0 1-3 3.8'),
      P('M6.4 7.6A16.6 16.6 0 0 0 2.6 12S6.2 18.2 12 18.2a9 9 0 0 0 3.4-.7'),
    ]),
    lock: () => svg('0 0 24 24', null, [
      R(5.2, 10.4, 13.6, 9, 2),
      P('M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6'),
    ]),
    shield: () => svg('0 0 24 24', null, [
      P('M12 3.4 5 6.2v5.4c0 4.3 2.9 8.1 7 9.2 4.1-1.1 7-4.9 7-9.2V6.2z'),
      P('M9.2 11.8l2 2 3.6-3.8'),
    ]),
    activity: () => svg('0 0 24 24', null, [P('M3.4 12h4l2.6 6.4L14 5.6l2.6 6.4h4')]),
    send: () => svg('0 0 24 24', null, [P('M20.4 3.6 10.6 13.4'), P('M20.4 3.6l-6.2 16.8-3.6-7 -7-3.6z')]),
    info: () => svg('0 0 24 24', null, [C(12, 12, 8.4), P('M12 11v5.2'), P('M12 7.9h.01')]),
    alert: () => svg('0 0 24 24', null, [
      P('M12 4.4 2.9 19.6h18.2z'),
      P('M12 10v4.2'),
      P('M12 17.2h.01'),
    ]),
    user: () => svg('0 0 24 24', null, [
      C(12, 8.4, 3.8),
      P('M4.8 20a7.2 7.2 0 0 1 14.4 0'),
    ]),
    users: () => svg('0 0 24 24', null, [
      C(9.4, 8.4, 3.6),
      P('M3.2 19.6a6.4 6.4 0 0 1 12.4 0'),
      P('M16 5.2a3.6 3.6 0 0 1 0 6.9'),
      P('M17.6 14.2a6.4 6.4 0 0 1 3.2 5.4'),
    ]),
    logout: () => svg('0 0 24 24', null, [
      P('M14.6 8V5.4A1.4 1.4 0 0 0 13.2 4H5.4A1.4 1.4 0 0 0 4 5.4v13.2A1.4 1.4 0 0 0 5.4 20h7.8a1.4 1.4 0 0 0 1.4-1.4V16'),
      P('M9.6 12h10.8'),
      P('M17 8.6 20.4 12 17 15.4'),
    ]),
    swap: () => svg('0 0 24 24', null, [
      P('M4.6 8.4h13'),
      P('M14.2 5 17.6 8.4 14.2 11.8'),
      P('M19.4 15.6h-13'),
      P('M9.8 12.2 6.4 15.6l3.4 3.4'),
    ]),
    clock: () => svg('0 0 24 24', null, [C(12, 12, 8.2), P('M12 7.4V12l3.1 1.9')]),
    branch: () => svg('0 0 24 24', null, [
      C(7, 6, 2.2),
      C(7, 18, 2.2),
      C(17, 8.4, 2.2),
      P('M7 8.2v7.6'),
      P('M17 10.6c0 3.2-2.6 4.4-5.4 5'),
    ]),
    file: () => svg('0 0 24 24', null, [
      P('M6 3.6h7.2L19 9.4v11a1.4 1.4 0 0 1-1.4 1.4H6a1.4 1.4 0 0 1-1.4-1.4V5A1.4 1.4 0 0 1 6 3.6z'),
      P('M13.2 3.8v5.4H18.8'),
    ]),
    folderOpen: () => svg('0 0 24 24', null, [
      P('M3.4 7.4c0-.9.7-1.6 1.6-1.6h3.3l1.5 1.8h8.2c.9 0 1.6.7 1.6 1.6v1.2'),
      P('M3.4 10.4h16.4l-1.7 7.6a1.6 1.6 0 0 1-1.6 1.2H5.1a1.6 1.6 0 0 1-1.6-1.3z'),
    ]),
    rocket: () => svg('0 0 24 24', null, [
      P('M12 3.4c3 1.6 5 4.6 5 8.2 0 2-1 3.8-2.4 4.8H9.4A6.2 6.2 0 0 1 7 11.6c0-3.6 2-6.6 5-8.2z'),
      C(12, 10.4, 1.9),
      P('M9.4 16.4 7.6 20.4'),
      P('M14.6 16.4l1.8 4'),
    ]),
    git: () => svg('0 0 24 24', null, [
      C(6.4, 6.4, 2.4),
      C(6.4, 17.6, 2.4),
      C(17.6, 17.6, 2.4),
      P('M6.4 8.8v6.4'),
      P('M8.8 6.4h4.8a4 4 0 0 1 4 4v4.8'),
    ]),
    sun: () => svg('0 0 24 24', null, [
      C(12, 12, 4),
      P('M12 3.2v2'),
      P('M12 18.8v2'),
      P('M3.2 12h2'),
      P('M18.8 12h2'),
      P('M5.8 5.8 7.2 7.2'),
      P('M16.8 16.8l1.4 1.4'),
      P('M5.8 18.2 7.2 16.8'),
      P('M16.8 7.2l1.4-1.4'),
    ]),
    moon: () => svg('0 0 24 24', null, [
      P('M20.2 14.2A8.4 8.4 0 0 1 9.8 3.8a8.6 8.6 0 1 0 10.4 10.4z'),
    ]),
  };

  /** 取一个图标节点;未知名字回退到圆点,方便排查 */
  function icon(name, opts) {
    opts = opts || {};
    const make = ICONS[name];
    const node = make ? make() : svg('0 0 24 24', null, [C(12, 12, 7)]);
    if (opts.size) {
      node.setAttribute('width', String(opts.size));
      node.setAttribute('height', String(opts.size));
    }
    if (opts.class) node.setAttribute('class', opts.class);
    if (opts.strokeWidth) node.setAttribute('stroke-width', String(opts.strokeWidth));
    return node;
  }

  /** 图标名列表,便于自检 */
  const iconNames = Object.keys(ICONS);

  /* ============================================================ 插画 */

  /** 顶部问候区的小插画:淡青渐变、远山、小船、太阳 */
  function greetingArt() {
    return svg('0 0 190 74', { class: 'greet-svg', role: 'img', 'aria-label': '', stroke: 'none' }, [
      tag('rect', { x: 0, y: 0, width: 190, height: 74, rx: 10, fill: 'url(#gradSky)', opacity: 0.75 }),
      tag('circle', { cx: 152, cy: 21, r: 9.5, fill: '#e9d9a0', opacity: 0.8 }),
      tag('path', { d: 'M4 64 L40 30 L70 58 L96 34 L130 64 Z', fill: '#b9dccb', opacity: 0.85 }),
      tag('path', { d: 'M66 64 L104 40 L138 64 Z', fill: '#9ed2ba', opacity: 0.8 }),
      tag('path', { d: 'M2 64 H188', stroke: '#cfe6da', 'stroke-width': 1.4, fill: 'none' }),
      tag('path', { d: 'M40 68 H92 M112 68 H160', stroke: '#dbece4', 'stroke-width': 1.2, 'stroke-linecap': 'round', fill: 'none' }),
      tag('path', { d: 'M104 62 L122 62 L118 66 L106 66 Z', fill: '#8fb8d8', opacity: 0.9 }),
      tag('path', { d: 'M112 62 V40 L124 58 Z', fill: '#ffffff', stroke: '#a9c6dd', 'stroke-width': 0.9 }),
      tag('path', { d: 'M111 62 V44 L103 58 Z', fill: '#f2f7fa', stroke: '#a9c6dd', 'stroke-width': 0.9 }),
      tag('line', { x1: 112, y1: 38, x2: 112, y2: 62, stroke: '#9ab6c9', 'stroke-width': 1.1, 'stroke-linecap': 'round' }),
    ]);
  }

  /** 底部装饰山峦 */
  function footerArt() {
    return svg('0 0 190 62', { class: 'foot-mtn-svg', preserveAspectRatio: 'none', role: 'img', 'aria-label': '', stroke: 'none' }, [
      tag('path', {
        d: 'M0 62 V44 L30 14 L58 40 L82 20 L116 48 L150 26 L190 50 V62 Z',
        fill: 'url(#gradMtnA)', opacity: 0.6,
      }),
      tag('path', {
        d: 'M0 62 V52 L34 32 L64 50 L92 34 L126 54 L158 40 L190 54 V62 Z',
        fill: 'url(#gradMtnB)', opacity: 0.5,
      }),
      tag('path', { d: 'M118 24 q6 -5 12 0 q6 -5 12 0', stroke: '#bcd9cb', 'stroke-width': 1.1, fill: 'none', 'stroke-linecap': 'round' }),
    ]);
  }

  /** 文件夹图标(实心扁平,用于文件夹卡片) */
  function folderIcon(color) {
    const c = color || '#f0b849';
    return svg('0 0 24 24', { stroke: 'none' }, [
      tag('path', { d: 'M2.5 6.4c0-1 .8-1.8 1.8-1.8h4l1.7 2h9.7c1 0 1.8.8 1.8 1.8v9.2c0 1-.8 1.8-1.8 1.8H4.3c-1 0-1.8-.8-1.8-1.8z', fill: c }),
      tag('path', { d: 'M2.5 8.6h21', stroke: '#000', 'stroke-opacity': 0.07, 'stroke-width': 1 }),
    ]);
  }

  /** 文件类型图标:按扩展名给不同颜色和符号 */
  function fileIcon(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    let color = '#9aa8a1';
    let label = '';
    if (['md', 'markdown', 'txt', 'rst'].includes(ext)) { color = '#5b8fb9'; label = 'T'; }
    else if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) { color = '#d8a13a'; label = '{}'; }
    else if (['json', 'yml', 'yaml', 'toml', 'ini', 'cfg'].includes(ext)) { color = '#8a9a92'; label = '{}'; }
    else if (['css', 'scss', 'less'].includes(ext)) { color = '#5aa8d8'; label = '#'; }
    else if (['html', 'htm', 'vue'].includes(ext)) { color = '#d97757'; label = '<>'; }
    else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) { color = '#a279c9'; label = '▣'; }
    else if (['py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'sh'].includes(ext)) { color = '#6aa84f'; label = '‹›'; }

    const kids = [
      tag('path', { d: 'M5 3.2h8.6L19 8.6v12.2c0 .6-.5 1.1-1.1 1.1H5c-.6 0-1.1-.5-1.1-1.1V4.3c0-.6.5-1.1 1.1-1.1z', fill: color, opacity: 0.16 }),
      tag('path', { d: 'M5 3.2h8.6L19 8.6v12.2c0 .6-.5 1.1-1.1 1.1H5c-.6 0-1.1-.5-1.1-1.1V4.3c0-.6.5-1.1 1.1-1.1z', fill: 'none', stroke: color, 'stroke-width': 1.4 }),
      tag('path', { d: 'M13.4 3.4v5.2H18.8', fill: 'none', stroke: color, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }),
    ];
    if (label && label.length <= 2) {
      kids.push(tag('text', {
        x: 11.9, y: 17.2, 'text-anchor': 'middle', 'font-size': 7.2,
        'font-family': 'monospace', fill: color, 'font-weight': 'bold', stroke: 'none',
      }, [label]));
    }
    return svg('0 0 24 24', { role: 'img', 'aria-label': '', stroke: 'none' }, kids);
  }

  window.Art = {
    svg, tag, P, C, R, L,
    icon, iconNames,
    greetingArt, footerArt,
    folderIcon, fileIcon,
  };
})();
