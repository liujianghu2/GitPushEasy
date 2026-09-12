'use strict';
/**
 * repo.js —— 核心业务引擎。
 *
 * 把"这个文件夹现在处于什么状态、我该建议用户怎么做"算清楚(analyze),
 * 以及"照着用户的决定真正把代码传上去"(push)。
 *
 * 关键原则:
 *   · 任何破坏性/有风险的结论,都必须先 fetch 拿到远程真实状态再判断。
 *     很多简易工具只看本地,于是给出"直接推送",然后被 GitHub 拒绝。
 *   · 绝不 force push。分叉时只给两条安全出路:本地合并后推送,或新建分支上传。
 *   · 动作统一返回 { ok, steps, next } 结构,界面只负责展示,不做业务判断。
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const git = require('./git');
const gh = require('./github');

/* ------------------------------------------------------------ 文件夹体检 */

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'bower_components', '.venv', 'venv', 'env',
  '__pycache__', '.next', '.nuxt', 'dist', 'build', 'out', 'target',
  '.idea', '.vscode', '.gradle', '.cache', '.mypy_cache', '.pytest_cache',
  'Library', 'Temp', 'Obj', 'Bin', '.DS_Store',
]);

const PROJECT_MARKERS = [
  { kind: 'node', files: ['package.json', 'pnpm-lock.yaml', 'yarn.lock'] },
  { kind: 'python', files: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', 'manage.py'] },
  { kind: 'java', files: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'] },
  { kind: 'unity', files: ['ProjectSettings/ProjectVersion.txt', 'Assets'] },
  { kind: 'godot', files: ['project.godot'] },
  { kind: 'rust', files: ['Cargo.toml'] },
  { kind: 'go', files: ['go.mod'] },
];

const BIG_FILE_WARN = 50 * 1024 * 1024;    // 50MB 提示
const BIG_FILE_LIMIT = 100 * 1024 * 1024;  // 100MB GitHub 硬上限

/**
 * 快速给文件夹"体检":文件数、体积、疑似不该上传的东西。
 * 不追求绝对精确,目的是及时发现"这是 C 盘根目录"之类的误操作。
 */
async function scanFolder(dir, opts) {
  opts = opts || {};
  const maxFiles = opts.maxFiles || 60000;
  const maxMs = opts.maxMs || 4000;
  const started = Date.now();

  let files = 0;
  let bytes = 0;
  let truncated = false;
  const bigFiles = [];
  const markers = new Set();
  const topLevel = [];

  async function walk(cur, depth) {
    if (truncated || Date.now() - started > maxMs) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (truncated || Date.now() - started > maxMs) { truncated = true; return; }
      const full = path.join(cur, e.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (depth === 0) topLevel.push({ name: e.name, dir: e.isDirectory() });
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) && !(depth === 0 && e.name === 'Assets')) continue;
        const joined = depth === 0 ? e.name : '';
        // 顶层目录也参与项目类型探测
        if (depth === 0) {
          for (const m of PROJECT_MARKERS) {
            if (m.files.includes(e.name)) markers.add(m.kind);
          }
        }
        if (joined === 'ProjectSettings' || joined === 'Assets') markers.add('unity');
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        files += 1;
        let st = null;
        try { st = await fsp.stat(full); } catch (_) {}
        const size = st ? st.size : 0;
        bytes += size;
        if (size >= BIG_FILE_WARN) {
          bigFiles.push({ path: rel, size });
        }
        if (depth <= 2) {
          for (const m of PROJECT_MARKERS) {
            if (m.files.includes(e.name)) markers.add(m.kind);
          }
        }
        if (files >= maxFiles) { truncated = true; return; }
      }
    }
  }

  await walk(dir, 0);
  bigFiles.sort((a, b) => b.size - a.size);

  return {
    dir,
    files,
    bytes,
    truncated,
    bigFiles: bigFiles.slice(0, 20),
    overLimit: bigFiles.filter((f) => f.size >= BIG_FILE_LIMIT),
    projectKind: pickProjectKind(markers, topLevel),
    topLevel,
  };
}

function pickProjectKind(markers, topLevel) {
  const order = ['node', 'python', 'java', 'unity', 'godot', 'rust', 'go'];
  for (const k of order) if (markers.has(k)) return k;
  const names = new Set((topLevel || []).map((t) => t.name));
  if (names.has('index.html') || names.has('src')) return 'generic';
  return 'generic';
}

/** 选目录时的完整检查 */
async function inspectFolder(dir) {
  const st = await fsp.stat(dir).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw new Error('这个路径不是一个文件夹:' + dir);
  }
  const scan = await scanFolder(dir);
  const repo = git.isRepo(dir);
  const parentRepo = repo ? null : git.findParentRepo(dir);

  /**
   * 关键顺序问题:必须【先】准备 .gitignore,再让界面去看"有哪些变更"。
   * 否则一个从没配过 .gitignore 的 Node 项目会把 node_modules 里几万个文件
   * 全部列成"待上传",既吓人又不正确。
   * 只会新建;已存在则原样保留,绝不覆盖用户自己的规则。
   */
  let gitignore = { created: false };
  try {
    gitignore = await git.ensureGitignore(dir, scan.projectKind);
  } catch (_) { /* 只读目录等情况下忽略 */ }

  return {
    path: dir,
    name: path.basename(dir) || dir,
    isEmpty: scan.files === 0,
    scan,
    isRepo: repo,
    parentRepo,
    writable: await isWritable(dir),
    gitignore: {
      created: !!gitignore.created,
      path: gitignore.path || path.join(dir, '.gitignore'),
    },
  };
}

async function isWritable(dir) {
  const probe = path.join(dir, '.gpe-write-test-' + Date.now());
  try {
    await fsp.writeFile(probe, 'x');
    await fsp.unlink(probe);
    return true;
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------ 状态分析 */

const SYNC_LABEL = {
  new: '本地是新仓库,远程还是空的',
  ahead: '本地多了几个提交,还没传上去',
  behind: '远程有新内容,本地还没同步下来',
  diverged: '本地和远程都有对方没有的提交',
  uptodate: '本地和远程一模一样',
  unknown: '无法连接远程,暂时判断不了',
  empty: '远程仓库是空的',
};

/**
 * 分析当前仓库状态,并给出下一步建议。
 * 返回的对象里:
 *   state     —— 给界面用的原始事实
 *   plan      —— 推荐动作(含中文理由)
 *   canPush   —— 是否可以直接推送
 */
async function analyze(input) {
  const { dir, syncStrategy, token, login, remoteName } = input;
  const remote = remoteName || 'origin';

  const out = {
    dir,
    remote,
    isRepo: false,
    hasCommits: false,
    branch: '',
    changes: { all: [], staged: [], unstaged: [], untracked: [], total: 0, clean: true },
    remoteUrl: '',
    repoInfo: null,
    ahead: 0,
    behind: 0,
    hasUpstream: false,
    sync: 'new',
    syncLabel: SYNC_LABEL.new,
    warnings: [],
    commits: [],
    branches: [],
    conflictInProgress: [],
    canPush: false,
    plan: null,
  };

  if (!git.isRepo(dir)) {
    out.sync = 'new';
    out.syncLabel = '这个文件夹还没有用 Git 管理过';
    applyFileChecks(out, input.scan);
    out.plan = out.blocked
      ? {
        action: 'fix-large',
        title: '先处理超大文件',
        reason: '有文件超过 GitHub 的 100MB 上限,现在传一定失败。先把它们排除掉。',
        tone: 'danger',
      }
      : {
        action: 'publish',
        title: '第一次上传',
        reason: '我们会在这个文件夹里初始化 Git,把文件整理成第一个"提交",然后传到 GitHub。',
        tone: 'primary',
      };
    return out;
  }

  out.isRepo = true;
  out.branch = await git.currentBranch(dir);
  out.hasCommits = await git.hasCommits(dir);
  out.conflictInProgress = await git.inProgress(dir);

  const status = await git.status(dir);
  out.changes = summarizeChanges(status);
  out.commits = out.hasCommits ? await git.log(dir, 12) : [];
  out.branches = await git.branches(dir);

  const remotes = await git.remotes(dir);
  const rem = remotes.find((r) => r.name === remote) || remotes[0];
  if (rem) out.remote = rem.name;
  out.remoteUrl = rem ? git.normalizeUrl(rem.push || rem.fetch) : '';

  if (out.conflictInProgress.length) {
    out.warnings.push({
      level: 'error',
      text: '仓库停在一个未完成的合并/变基中间状态(上次操作被打断了)。建议先在界面点"放弃未完成的合并",再重新上传。',
    });
    out.plan = {
      action: 'resolve',
      title: '先清理未完成的合并',
      reason: '仓库现在是"半途"状态,直接推送可能带上一堆奇怪的历史。先恢复到干净状态最稳妥。',
      tone: 'danger',
    };
    return out;
  }

  // 没有远程:需要先创建/指定仓库
  if (!out.remoteUrl) {
    out.sync = 'new';
    out.syncLabel = '还没有关联 GitHub 仓库';
    applyFileChecks(out, input.scan);
    if (out.blocked) {
      out.plan = {
        action: 'fix-large',
        title: '先处理超大文件',
        reason: '有文件超过 GitHub 的 100MB 上限,现在传一定失败。先把它们排除掉。',
        tone: 'danger',
      };
      return out;
    }
    out.plan = out.hasCommits
      ? {
        action: 'publish',
        title: '上传到新的 GitHub 仓库',
        reason: '本地已有提交历史,可以直接把这个仓库整个传上 GitHub。',
        tone: 'primary',
      }
      : {
        action: 'publish',
        title: '第一次上传',
        reason: '先给这个文件夹建立第一个提交,然后传到 GitHub。',
        tone: 'primary',
      };
    out.canPush = true;
    return out;
  }

  // 有远程且是 GitHub:拉取真实状态后再判断
  const parsed = gh.parseRepoUrl(out.remoteUrl);
  if (parsed && token) {
    try {
      out.repoInfo = await gh.getRepo(token, parsed.owner, parsed.repo);
    } catch (e) {
      out.warnings.push({
        level: e.status === 404 ? 'error' : 'warn',
        text: e.status === 404
          ? '远程地址指向的仓库在 GitHub 上不存在了(可能被改名或删除)。'
          : '读取远程仓库信息失败:' + e.message,
      });
    }
  }

  const authUrl = token && parsed
    ? gh.authUrl(out.repoInfo ? out.repoInfo.clone_url : out.remoteUrl, login, token)
    : null;

  let fetched = false;
  try {
    await git.fetch(dir, out.remote, { extraArgs: authUrl ? ['-c', `url.${authUrl}.insteadOf=${out.remoteUrl}`] : [] });
    fetched = true;
  } catch (e) {
    out.sync = 'unknown';
    out.syncLabel = SYNC_LABEL.unknown;
    out.warnings.push({
      level: 'warn',
      text: '连不上远程仓库,下面的判断基于本地信息。原因:' + e.message,
    });
  }

  if (fetched) {
    const ab = await git.aheadBehind(dir, out.branch, `${out.remote}/${out.branch}`);
    out.ahead = ab.ahead;
    out.behind = ab.behind;
    out.hasUpstream = ab.hasUpstream;

    if (!ab.hasUpstream) {
      // 远程没有同名分支
      out.sync = 'new';
      out.syncLabel = `远程还没有 ${out.branch} 分支`;
    } else if (ab.ahead === 0 && ab.behind === 0) {
      out.sync = 'uptodate';
      out.syncLabel = SYNC_LABEL.uptodate;
    } else if (ab.ahead > 0 && ab.behind === 0) {
      out.sync = 'ahead';
      out.syncLabel = `本地多 ${ab.ahead} 个提交,还没传上去`;
    } else if (ab.ahead === 0 && ab.behind > 0) {
      out.sync = 'behind';
      out.syncLabel = `远程多 ${ab.behind} 个提交,本地落后了`;
    } else {
      out.sync = 'diverged';
      out.syncLabel = `分叉了:本地多 ${ab.ahead} 个,远程多 ${ab.behind} 个`;
    }

    // 远程改动预览:本地没动但远程动了,说明是别人改的
    if (ab.behind > 0 && out.changes.clean) {
      const r = await git.gitAsync(
        ['diff', '--name-status', `HEAD...${out.remote}/${out.branch}`],
        { cwd: dir, timeout: 60000 }
      );
      out.remoteChanges = r.stdout.split(/\r?\n/).filter(Boolean).slice(0, 200).map((line) => {
        const [code, ...rest] = line.split(/\t/);
        return { code, path: rest.join('\t') };
      });
    }
  } else {
    // 拉取失败时,退回到"只看本地"的判断
    out.ahead = out.hasCommits ? 1 : 0;
    out.sync = out.changes.clean && out.hasCommits ? 'uptodate' : 'ahead';
  }

  // 大文件检查(其他分支里已经在更早的位置调用过 applyFileChecks)
  applyFileChecks(out, input.scan);

  out.plan = decidePlan(out, syncStrategy || 'rebase');
  out.canPush = !out.blocked && !['diverged'].includes(out.sync) || out.sync === 'diverged';
  out.syncLabel = buildSyncLabel(out);
  return out;
}

/**
 * 生成同步状态文案。
 *
 * 这里修的是一个会造成严重误解的问题:
 *   `ahead === 0 && behind === 0` 只说明**已提交的历史**一致,
 *   并不代表"本地和远程一模一样" —— 工作区里完全可以有一堆没提交的改动。
 *   以前这种情况会显示"本地和远程一模一样",用户明明改了文件却看到这句话,
 *   自然会以为工具没识别到他的变更(实际是识别到了,只是这句话说错了)。
 *
 * 现在按优先级描述:先讲未提交的改动,再讲领先/落后。
 */
function buildSyncLabel(out) {
  const dirty = out.changes && out.changes.total > 0;
  const n = (out.changes && out.changes.total) || 0;
  const parts = [];

  if (dirty) {
    parts.push(`有 ${n} 个文件改动还没提交`);
  }

  if (out.sync === 'unknown') {
    parts.push('无法连接远程,暂时判断不了同步状态');
  } else if (!out.isRepo) {
    parts.push('这个文件夹还没有用 Git 管理');
  } else if (!out.hasUpstream && out.sync === 'new' && out.remoteUrl) {
    parts.push(`远程还没有 ${out.branch} 分支,首次上传会创建它`);
  } else if (out.ahead > 0 && out.behind > 0) {
    parts.push(`已提交的历史分叉了:本地多 ${out.ahead} 个,远程多 ${out.behind} 个`);
  } else if (out.ahead > 0) {
    parts.push(`已提交的历史领先远程 ${out.ahead} 个提交`);
  } else if (out.behind > 0) {
    parts.push(`已提交的历史落后远程 ${out.behind} 个提交`);
  } else if (!dirty) {
    parts.push('本地和远程一模一样,没有需要上传的内容');
  } else {
    parts.push('已提交的历史与远程一致');
  }

  return parts.join(';');
}

/**
 * 大文件检查。
 *
 * 单独抽出来是因为它必须在【所有】提前 return 之前执行 —— 没有远程、
 * 不是仓库这些分支同样要能拦住超 100MB 的文件,否则用户会走到最后
 * 一步才被 GitHub 拒绝,体验很差。
 */
function applyFileChecks(out, scan) {
  if (!scan) return;
  if (scan.overLimit && scan.overLimit.length) {
    out.warnings.push({
      level: 'error',
      text: `有 ${scan.overLimit.length} 个文件超过 100MB,GitHub 会直接拒绝。请把它们加入 .gitignore,或用 Git LFS 管理。`,
      files: scan.overLimit.slice(0, 5),
    });
    out.blocked = true;
  } else if (scan.bigFiles && scan.bigFiles.length) {
    out.warnings.push({
      level: 'warn',
      text: `有 ${scan.bigFiles.length} 个文件大于 50MB,上传会比较慢,也会让仓库变大。`,
      files: scan.bigFiles.slice(0, 5),
    });
  }
}

function summarizeChanges(status) {
  const all = status.map((f) => ({
    path: f.path,
    state: f.state,
    label: stateLabel(f.state),
    staged: !(f.x === '?' || f.x === ' '),
  }));
  return {
    all,
    staged: all.filter((f) => f.staged),
    unstaged: all.filter((f) => !f.staged && f.state !== 'untracked'),
    untracked: all.filter((f) => f.state === 'untracked'),
    total: all.length,
    clean: all.length === 0,
  };
}

function stateLabel(s) {
  return {
    untracked: '新文件',
    modified: '已修改',
    deleted: '已删除',
    added: '新增',
    renamed: '已重命名',
    conflict: '有冲突',
    changed: '有变化',
  }[s] || '有变化';
}

/** 决定"下一步做什么"。这里就是小白最需要的那个判断。 */
function decidePlan(out, strategy) {
  const dirty = !out.changes.clean;
  const sync = out.sync;

  if (out.blocked) {
    return {
      action: 'fix-large',
      title: '先处理超大文件',
      reason: '有文件超过 GitHub 的 100MB 上限,现在传一定失败。先把它们排除掉。',
      tone: 'danger',
    };
  }

  if (sync === 'unknown') {
    return {
      action: 'retry-remote',
      title: '先检查网络/权限',
      reason: '没能连上 GitHub 读取远程状态,无法安全判断。先解决连接问题再上传。',
      tone: 'warn',
    };
  }

  // 远程有新内容
  if (sync === 'behind') {
    if (dirty) {
      return {
        action: 'sync-then-push',
        title: '先同步、再上传',
        reason: `GitHub 上已经有 ${out.behind} 个提交是你这边没有的(别人改的或在别的电脑上改的)。` +
          '程序会先把你本地的改动放心地暂存起来,同步远程内容,然后一起提交上传。',
        tone: 'warn',
        strategy,
        alternatives: [
          { action: 'push-new-branch', label: '不改主干,新建分支上传', reason: '完全不动你本地的这条分支,把改动放到一条新分支上推上去。' },
        ],
      };
    }
    return {
      action: 'sync-then-push',
      title: '先同步、再上传',
      reason: `GitHub 上多了 ${out.behind} 个提交,你本地没有。直接上传会被拒绝,先同步下来再传。`,
      tone: 'warn',
      strategy,
    };
  }

  if (sync === 'diverged') {
    return {
      action: 'choose-diverged',
      title: '两边都有新内容,需要你选一下',
      reason: '你本地和 GitHub 上都有对方没有的提交。这是最需要小心的情况,请二选一。',
      tone: 'danger',
      alternatives: [
        {
          action: 'sync-then-push',
          label: '合并后一起上传(推荐)',
          reason: `把 GitHub 上的 ${out.behind} 个提交先合并到你本地,再把你的 ${out.ahead} 个提交一起传上去。` +
            '程序会自动取消失败的合并,不会把你的仓库搞乱。',
          strategy,
        },
        {
          action: 'push-new-branch',
          label: '新建分支上传',
          reason: '不碰你本地这条分支,把你的改动推到一条新分支上。之后可以在 GitHub 上发起 Pull Request 合并。最安全。',
        },
      ],
    };
  }

  if (dirty) {
    return {
      action: 'commit-and-push',
      title: sync === 'ahead' ? `提交并上传(还有 ${out.ahead} 个提交没传)` : '提交并上传',
      reason: `检测到 ${out.changes.total} 个文件有变化,程序会把它们打包成一个提交,然后推送到 GitHub。`,
      tone: 'primary',
    };
  }

  if (sync === 'ahead') {
    return {
      action: 'push',
      title: `上传 ${out.ahead} 个提交`,
      reason: '本地有已提交但还没推送的内容,直接传上去就好。',
      tone: 'primary',
      needsCommit: false,
    };
  }

  if (sync === 'new') {
    if (!out.hasCommits) {
      return {
        action: 'commit-and-push',
        title: '建立第一个提交并上传',
        reason: '这个仓库还没有任何提交,先建立一个,再传上去。',
        tone: 'primary',
      };
    }
    return {
      action: 'push',
      title: `把 ${out.branch} 分支上传到 GitHub`,
      reason: `远程还没有 ${out.branch} 分支,直接推上去就行了。`,
      tone: 'primary',
    };
  }

  // uptodate 且干净
  return {
    action: 'none',
    title: '已经是最新的了',
    reason: '本地和 GitHub 完全一致,没有需要上传的内容。',
    tone: 'ok',
  };
}

/* ------------------------------------------------------------ 执行上传 */

function makeCtx(options, emit) {
  return {
    dir: options.dir,
    branch: options.branch || '',
    remote: options.remote || 'origin',
    strategy: options.strategy || 'rebase',
    token: options.token,
    login: options.login,
    author: options.author || null,
    message: options.message || '',
    paths: Array.isArray(options.paths) && options.paths.length ? options.paths : null,
    newBranch: options.newBranch || '',
    ssh: !!options.ssh,
    emit: (event, payload) => { try { if (emit) emit(event, payload); } catch (_) {} },
    steps: [],
  };
}

function step(ctx, id, label, status, detail) {
  const existing = ctx.steps.find((s) => s.id === id);
  if (existing) {
    existing.status = status;
    if (detail) existing.detail = detail;
    return existing;
  }
  const s = { id, label, status, detail: detail || '' };
  ctx.steps.push(s);
  return s;
}

/** 解析目标推送地址与临时凭据注入参数 */
async function resolveTarget(ctx) {
  const url = await git.remoteUrl(ctx.dir, ctx.remote);
  if (!url) throw new Error('没有找到远程仓库地址,请先选择或创建 GitHub 仓库。');
  const clean = git.normalizeUrl(url);
  if (!ctx.token || ctx.ssh || /^(git@|ssh:\/\/)/i.test(clean)) {
    return { url: clean, pushUrl: clean, extraArgs: [], parsed: gh.parseRepoUrl(clean) };
  }
  const parsed = gh.parseRepoUrl(clean);
  let cloneUrl = clean;
  if (parsed) {
    try {
      const info = await gh.getRepo(ctx.token, parsed.owner, parsed.repo);
      cloneUrl = info.clone_url;
    } catch (_) { /* 用原地址即可 */ }
  }
  const authUrl = gh.authUrl(cloneUrl, ctx.login, ctx.token);
  // url.<带凭据地址>.insteadOf=<干净地址> 让 git 在校验/输出时都用干净地址,
  // 令牌不落盘、不进 .git/config,也不会出现在任何回显里。
  return { url: clean, pushUrl: authUrl, extraArgs: ['-c', `url.${authUrl}.insteadOf=${clean}`], parsed };
}

/**
 * 主流程。
 *
 * options:
 *   dir            要上传的文件夹(必填)
 *   action         'auto' | 'push' | 'sync-then-push' | 'push-new-branch'
 *   commit         true 时先暂存 + 提交(不传则按 action 推断)
 *   sync           true 时推送前先拉取远程并合并(仅 action 为 auto 或 sync-then-push 时有意义)
 *   newBranch      非空时先切/建这个分支
 *   strategy       'rebase' | 'merge'
 *   paths          只提交这些文件(null/空 = 全部)
 *   message        自定义提交信息
 *   token / login  凭据
 *   author         { name, email } 或 null(用 git 全局配置)
 *   noSync         true 表示明确不合并(分叉时用户选了"我的本地为准"路径)
 *
 * 返回 { ok, steps, pushed, branch, commit, repoUrl, url, next }
 */
async function push(options, emit) {
  const ctx = makeCtx(options, emit);
  const gitInfo = git.requireGit();

  const action = options.action || 'auto';
  const wantPull = options.sync === true ||
    action === 'sync-then-push' ||
    (action === 'auto' && !!options.autoSync);
  const wantCommit = options.commit !== undefined
    ? !!options.commit
    : (action !== 'push');

  const report = (id, label, status, detail) => {
    const s = step(ctx, id, label, status, detail);
    ctx.emit('progress', { id: s.id, label: s.label, status: s.status, detail: s.detail });
    return s;
  };

  try {
    /* 1. 初始化仓库(如果还不是) */
    if (!git.isRepo(ctx.dir)) {
      report('init', '初始化 Git 仓库', 'running');
      await git.init(ctx.dir);
      report('init', '初始化 Git 仓库', 'done');
    }

    /**
     * 确定"当前分支"。
     *
     * 这一步很关键:不能想当然地用 main。用户的 git 全局配置可能是
     * init.defaultBranch=master,或者这个仓库本来就在别的分支上。
     * 一旦推错了 refspec,git 只会回一句 "src refspec main does not match any",
     * 对小白来说完全不知所云。所以以仓库的真实 HEAD 为准。
     */
    if (!ctx.newBranch) {
      const real = await git.currentBranch(ctx.dir);
      if (real && real !== ctx.branch) {
        ctx.branch = real;
      }
    }

    /* 2. .gitignore */
    report('gitignore', '检查 .gitignore', 'running');
    const scan = options.scan || await scanFolder(ctx.dir, { maxMs: 2500 });
    const gi = await git.ensureGitignore(ctx.dir, scan.projectKind);
    report('gitignore', '检查 .gitignore', 'done',
      gi.created ? '已生成一份适合本项目的 .gitignore' : '已存在,保持原样');

    /* 3. 暂存 + 提交 */
    let commitInfo = null;
    if (wantCommit) {
      const dirty = await git.status(ctx.dir);
      let stagedAny = false;
      if (dirty.length) {
        report('stage', '整理要上传的文件', 'running');
        if (ctx.paths) await git.stage(ctx.dir, ctx.paths);
        else await git.stage(ctx.dir, dirty.map((f) => f.path));
        stagedAny = true;
        report('stage', '整理要上传的文件', 'done', `共 ${dirty.length} 个文件有变化`);
      }

      if (stagedAny) {
        const message = ctx.message || defaultCommitMessage(ctx);
        report('commit', '保存这次改动', 'running');
        try {
          const r = await git.commit(ctx.dir, message, ctx.author);
          const m = (r.stdout || '').match(/\[[^\]]+\s+([0-9a-f]{7,})\]/);
          commitInfo = { short: m ? m[1] : '', message };
          report('commit', '保存这次改动', 'done', message.split('\n')[0]);
        } catch (e) {
          const raw = ((e.raw && (e.raw.stdout || '') + (e.raw.stderr || '')) || '') + (e.message || '');
          if (/nothing to commit|no changes added/i.test(raw)) {
            report('commit', '保存这次改动', 'skipped', '没有需要提交的新内容');
          } else if (/Please tell me who you are|unable to auto-detect email|Author identity unknown|empty ident name/i.test(raw)) {
            const err = new Error(
              'Git 不知道"你是谁",所以无法生成提交。请在右上角「设置」里填上提交者姓名和邮箱' +
              '(邮箱可以用 GitHub 提供的匿名邮箱,格式如 12345678+用户名@users.noreply.github.com)。'
            );
            err.code = 'NO_IDENTITY';
            err.steps = ctx.steps;
            throw err;
          } else {
            throw e;
          }
        }
      } else if (!(await git.hasCommits(ctx.dir))) {
        const err = new Error('这个文件夹里没有可上传的内容(可能是空的,或所有文件都被 .gitignore 排除了)。');
        err.code = 'NOTHING_TO_COMMIT';
        err.steps = ctx.steps;
        throw err;
      }
    }

    /* 4. 确认远程地址 */
    if (!(await git.remoteUrl(ctx.dir, ctx.remote))) {
      const err = new Error('还没有关联 GitHub 仓库。请先在"上传到哪个仓库"里选择一个或新建一个。');
      err.code = 'NO_REMOTE';
      err.steps = ctx.steps;
      throw err;
    }
    const target = await resolveTarget(ctx);

    /* 5. 切到目标分支 / 新建分支(如果用户明确指定了) */
    const targetBranch = String(options.targetBranch || '').trim();
    if (ctx.newBranch) {
      report('branch', `切换到分支 ${ctx.newBranch}`, 'running');
      const exists = (await git.branches(ctx.dir)).some((b) => b.name === ctx.newBranch);
      if (exists) {
        await git.switchBranch(ctx.dir, ctx.newBranch, false);
        report('branch', `切换到分支 ${ctx.newBranch}`, 'done', '分支已存在,直接切过去');
      } else {
        await git.switchBranch(ctx.dir, ctx.newBranch, true);
        report('branch', `切换到分支 ${ctx.newBranch}`, 'done', '已新建该分支');
      }
      ctx.branch = ctx.newBranch;
    } else if (targetBranch && targetBranch !== ctx.branch) {
      /**
       * 用户在"目标分支"里选了另一条分支。
       *
       * 以前这个下拉框只是个摆设 —— 界面显示 main,实际却传当前分支,
       * 甚至凭空新建一条 update-时间戳 的分支,完全不是用户的选择。
       * 现在按用户的意图来:本地有就切过去,没有就按这个名字建出来。
       */
      report('branch', `切换到目标分支 ${targetBranch}`, 'running');
      const exists = (await git.branches(ctx.dir)).some((b) => b.name === targetBranch);
      if (exists) {
        await git.switchBranch(ctx.dir, targetBranch, false);
        report('branch', `切换到目标分支 ${targetBranch}`, 'done');
      } else {
        await git.switchBranch(ctx.dir, targetBranch, true);
        report('branch', `创建并切换到 ${targetBranch}`, 'done', '本地还没有这条分支,已按你的选择创建');
      }
      ctx.branch = targetBranch;
    }

    /* 6. 读取远程真实状态 */
    report('check', '核对 GitHub 上的最新状态', 'running');
    await git.fetch(ctx.dir, ctx.remote, { extraArgs: target.extraArgs });
    let ab = await git.aheadBehind(ctx.dir, ctx.branch, `${ctx.remote}/${ctx.branch}`);
    report('check', '核对 GitHub 上的最新状态', 'done',
      ab.hasUpstream ? `本地领先 ${ab.ahead} 个提交,落后 ${ab.behind} 个` : '远程还没有这个分支');

    /* 7. 需要时先同步 */
    if (wantPull && ab.hasUpstream && ab.behind > 0) {
      report('sync', '同步 GitHub 上的新内容', 'running',
        ctx.strategy === 'rebase' ? '采用变基方式,提交历史更干净' : '采用合并方式,保留分叉记录');
      await git.syncDown(ctx.dir, ctx.remote, ctx.branch, ctx.strategy, { extraArgs: target.extraArgs });
      ab = await git.aheadBehind(ctx.dir, ctx.branch, `${ctx.remote}/${ctx.branch}`);
      report('sync', '同步 GitHub 上的新内容', 'done', `同步完成,现在本地领先 ${ab.ahead} 个提交`);
    } else if (ab.hasUpstream && ab.behind > 0 && !wantPull) {
      report('sync', '同步 GitHub 上的新内容', 'skipped', '按你的选择未同步');
    }

    /* 8. 推送 */
    if (ab.hasUpstream && ab.ahead === 0 && ab.behind === 0) {
      report('push', '上传到 GitHub', 'done', '已经是最新的,无需推送');
      ctx.emit('done', {});
      return {
        ok: true,
        steps: ctx.steps,
        pushed: false,
        upToDate: true,
        branch: ctx.branch,
        commit: commitInfo,
        repoUrl: target.parsed ? `https://github.com/${target.parsed.owner}/${target.parsed.repo}` : '',
        url: target.parsed
          ? `https://github.com/${target.parsed.owner}/${target.parsed.repo}/tree/${encodeURIComponent(ctx.branch)}`
          : '',
        next: null,
      };
    }

    report('push', '上传到 GitHub', 'running');
    try {
      await git.push(ctx.dir, ctx.remote, ctx.branch, {
        authUrl: target.pushUrl,
        setUpstream: !ab.hasUpstream,
        upstreamRemote: ctx.remote,
        onProgress: (line) => ctx.emit('progress', {
          id: 'push', label: '上传到 GitHub', status: 'running', detail: line,
        }),
      });
    } catch (e) {
      report('push', '上传到 GitHub', 'failed', e.friendly || e.message);
      const err = new Error(e.message);
      err.code = /non-fast-forward|fetch first|Updates were rejected|behind its remote/i.test(
        JSON.stringify(e.raw || {}) + ' ' + e.message
      ) ? 'NON_FAST_FORWARD' : 'PUSH_FAILED';
      err.friendly = e.friendly || e.message;
      err.steps = ctx.steps;
      throw err;
    }

    report('push', '上传到 GitHub', 'done');
    ctx.emit('done', {});

    const repoUrl = target.parsed ? `https://github.com/${target.parsed.owner}/${target.parsed.repo}` : '';
    const branchUrl = target.parsed
      ? `${repoUrl}/tree/${encodeURIComponent(ctx.branch)}`
      : '';

    return {
      ok: true,
      steps: ctx.steps,
      pushed: true,
      upToDate: false,
      branch: ctx.branch,
      commit: commitInfo,
      repoUrl,
      url: branchUrl,
      gitVersion: gitInfo.version,
      newBranch: ctx.newBranch || '',
      next: ctx.newBranch && target.parsed
        ? {
          type: 'pr',
          text: `改动已经在分支 ${ctx.newBranch} 上了。想让主干也更新,可以到 GitHub 上发起 Pull Request。`,
          url: `${repoUrl}/compare/${encodeURIComponent(
            (options.baseBranch || 'main')
          )}...${encodeURIComponent(ctx.newBranch)}?expand=1`,
        }
        : null,
    };
  } catch (e) {
    e.steps = ctx.steps;
    if (!e.friendly) e.friendly = e.message;
    throw e;
  }
}

function defaultCommitMessage(ctx) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `更新文件 (${stamp})`;
}

/* ------------------------------------------------------------ 关联远程仓库 */

/**
 * 把一个本地文件夹关联到远程仓库。
 *
 * 关键点:必须保证文件夹已经是 Git 仓库再写 remote。
 * 原先直接 `git remote add` 会在"全新文件夹 + 刚创建好仓库"这条最常见的路径上
 * 报 `fatal: not a git repository (or any of the parent directories): .git` ——
 * 这正是用户截图里遇到的问题。
 *
 * 这里顺手把 .gitignore 也准备好,理由同 inspectFolder:让"关联仓库"这一步
 * 之后看到的状态就是准确、干净的。
 */
async function setRemote(dir, url, remoteName) {
  const remote = remoteName || 'origin';
  git.requireGit();

  let initialized = false;
  if (!git.isRepo(dir)) {
    await git.init(dir);
    initialized = true;
    // 新建仓库时给一份适合本项目的 .gitignore(已存在则保留)
    try {
      const scan = await scanFolder(dir, { maxMs: 2000 });
      await git.ensureGitignore(dir, scan.projectKind);
    } catch (_) { /* 写不进去也不影响关联 */ }
  }

  await git.addRemote(dir, remote, git.normalizeUrl(url));
  return { ok: true, initialized, remote, url: git.normalizeUrl(url) };
}

async function cloneInto() {
  throw new Error('本工具专注于"本地上传到 GitHub",不提供克隆功能。');
}

/** 放弃未完成的合并/变基 */
async function abortMerge(dir) {
  await git.abortInProgress(dir);
  return true;
}

/* ------------------------------------------------------------ 快速状态 */

/**
 * 只读本地状态的轻量检查 —— 用于界面轮询"文件有没有被改动"。
 *
 * 刻意**不联网**:不 fetch、不比较远程。目的是能以很低的代价每几秒跑一次,
 * 让用户改完文件立刻就能在界面上看到提示,而不是必须手点刷新。
 * 返回一个可以拿来比较的"指纹",变了就说明工作区有变化。
 */
async function quickStatus(dir) {
  if (!git.isRepo(dir)) {
    return { isRepo: false, total: 0, fingerprint: '', files: [] };
  }
  const st = await git.status(dir);
  const files = st.map((f) => f.path + ':' + f.x + f.y).sort();
  return {
    isRepo: true,
    branch: await git.currentBranch(dir),
    hasCommits: await git.hasCommits(dir),
    total: st.length,
    files: st.slice(0, 300).map((f) => ({ path: f.path, state: f.state, x: f.x, y: f.y })),
    fingerprint: files.join('|'),
  };
}

/* ------------------------------------------------------------ 历史与回滚 */

/**
 * 读取提交历史,并标注每条提交在远程的状态。
 *
 * status 的含义:
 *   'pushed'   远程那个分支已经包含这条提交(回滚它会影响别人,必须用 revert)
 *   'local'    只存在于本地(还没推送,可以用 reset 干净地回退)
 *   'unknown'  连不上远程,判断不了(此时一律按"影响别人"处理,更保守)
 */
async function history(input) {
  const { dir, remote } = input;
  const branch = input.branch || await git.currentBranch(dir);
  const limit = Math.min(Number(input.limit) || 60, 300);
  const remoteName = remote || 'origin';

  const commits = await git.log(dir, limit);

  // 远程该分支上的提交集合(用于判断哪些已经推送)
  let remoteHashes = null;
  let remoteError = '';
  try {
    const r = await git.gitAsync(
      ['rev-list', `refs/remotes/${remoteName}/${branch}`],
      { cwd: dir, timeout: 30000 }
    );
    if (r.code === 0) {
      remoteHashes = new Set(r.stdout.split(/\r?\n/).filter(Boolean));
    }
  } catch (e) {
    remoteError = e.message || String(e);
  }
  // 没有远程跟踪分支时,退一步用本地记录的 origin/<branch>
  if (!remoteHashes) {
    const r2 = await git.gitAsync(['rev-parse', '--verify', '--quiet', `${remoteName}/${branch}`],
      { cwd: dir });
    if (r2.code !== 0) remoteError = remoteError || '远程还没有这条分支';
  }

  const out = commits.map((c, i) => ({
    ...c,
    index: i,
    status: remoteHashes ? (remoteHashes.has(c.hash) ? 'pushed' : 'local') : 'unknown',
  }));

  // 分支列表 + 每条分支的位置,便于用户看清"回滚的是哪条分支"
  const branches = await git.branches(dir);

  return {
    branch,
    branches,
    commits: out,
    remoteError,
    // 当前 HEAD 之前还有多少条(用于判断能不能 reset)
    canReset: out.length > 0,
  };
}

/**
 * 回滚到某一条提交。
 *
 * mode 有三种,风险依次升高 —— 界面必须让用户明确选择,不能默认执行危险操作:
 *
 *   'backup'  先建一条备份分支保住当前状态,再回退。**永远安全**,默认推荐。
 *   'revert'  生成一条反向提交来抵消(不重写历史)。已推送的必须用这个。
 *   'reset'   直接丢弃该提交之后的所有提交(只对未推送的本地提交安全)。
 */
async function rollback(input) {
  const { dir, hash, mode } = input;
  const remoteName = input.remote || 'origin';

  if (!hash) throw new Error('没有指定要回滚到哪一条提交。');
  git.requireGit();

  const steps = [];
  const report = (label, detail) => steps.push({ label, detail: detail || '' });

  // 校验这个 hash 存在,并取它的简短信息
  const info = await git.gitAsync(
    ['log', '-1', '--pretty=%H%x1f%h%x1f%s%x1f%ci', hash],
    { cwd: dir, timeout: 30000 }
  );
  if (info.code !== 0) {
    throw new Error('找不到这条提交,可能它已经被删除了。');
  }
  const [full, short, subject, date] = info.stdout.trim().split('\x1f');
  const branch = input.branch || await git.currentBranch(dir);

  // 工作区必须干净 —— 回滚过程中丢掉未提交的改动是不可接受的
  const dirty = await git.status(dir);
  if (dirty.length) {
    const err = new Error(
      `当前有 ${dirty.length} 个文件还没提交。回滚前请先提交或撤销这些改动,` +
      '否则它们会在回滚过程中丢失。'
    );
    err.code = 'DIRTY_WORKTREE';
    throw err;
  }

  // 判断要丢弃的那些提交里,有没有已经推送到远程的
  let discarded = [];
  let onRemote = false;
  const rr = await git.gitAsync(['rev-parse', '--verify', '--quiet', `${remoteName}/${branch}`],
    { cwd: dir, timeout: 30000 });
  if (rr.code === 0) {
    /**
     * 注意方向:危险的不是"目标提交是否已推送",而是
     * **被丢弃的那些提交是否已经推送**。
     * 从 HEAD 回退到目标提交,途中经过的每一条都会被丢掉 ——
     * 只要其中有任何一条在远程上,reset 就会让本地与远程历史不一致。
     */
    const rl = await git.gitAsync(
      ['rev-list', `${full}..HEAD`],
      { cwd: dir, timeout: 60000 }
    );
    discarded = rl.stdout.split(/\r?\n/).filter(Boolean);

    if (discarded.length) {
      const r2 = await git.gitAsync(
        ['rev-list', `refs/remotes/${remoteName}/${branch}`],
        { cwd: dir, timeout: 60000 }
      );
      const remoteSet = new Set(r2.stdout.split(/\r?\n/).filter(Boolean));
      onRemote = discarded.some((hash) => remoteSet.has(hash));
    }
  }

  if (mode === 'reset' && onRemote) {
    const err = new Error(
      '要丢弃的提交里有 ' + discarded.length + ' 条已经推送到 GitHub 了,不能用"丢弃提交"的方式回滚 —— ' +
      '那会造成本地和远程历史不一致,之后推送会被拒绝。请改用"生成反向提交"(revert)。'
    );
    err.code = 'PUSHED_CANNOT_RESET';
    err.discardedCount = discarded.length;
    throw err;
  }

  let backupBranch = '';
  let result = {};

  if (mode === 'backup') {
    // 1) 建一条备份分支保住"回滚之前"的状态
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    backupBranch = `backup-${branch}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    let r = await git.gitAsync(['branch', backupBranch], { cwd: dir, timeout: 30000 });
    if (r.code !== 0) {
      // 同名分支已存在(同一分钟内点了两次),加个后缀
      backupBranch += '-' + Math.floor(Math.random() * 1000);
      r = await git.gitAsync(['branch', backupBranch], { cwd: dir, timeout: 30000 });
      if (r.code !== 0) throw new Error('创建备份分支失败:' + (r.stderr || '').trim());
    }
    report('创建备份分支', backupBranch);

    // 2) 回退
    if (onRemote) {
      // 已推送 → 只能用 revert,再推一条反向提交
      result = await doRevert(dir, full, short, report);
    } else {
      result = await doReset(dir, full, branch, report);
    }
    result.backupBranch = backupBranch;
  } else if (mode === 'revert') {
    result = await doRevert(dir, full, short, report);
  } else if (mode === 'reset') {
    result = await doReset(dir, full, branch, report);
  } else {
    throw new Error('未知的回滚方式:' + mode);
  }

  return {
    ok: true,
    mode,
    branch,
    target: { hash: full, short, subject, date },
    wasOnRemote: onRemote,
    backupBranch,
    steps,
    ...result,
  };
}

/** 用 revert 回滚:生成反向提交,历史保留 */
async function doRevert(dir, full, short, report) {
  /**
   * `git revert --no-commit <hash>..HEAD` 会把这之后的所有提交逐个反向应用。
   * 用 --no-commit 累积起来,最后一次性提交,避免一串零碎的 revert 提交。
   */
  const r = await git.gitAsync(
    ['revert', '--no-commit', '--no-edit', `${full}..HEAD`],
    { cwd: dir, timeout: 180000 }
  );

  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || '').trim();
    if (/conflict|冲突/i.test(msg)) {
      await git.abortInProgress(dir);
      const err = new Error(
        '回滚时出现冲突 —— 说明这些改动后来被别人改过,Git 无法自动反向应用。' +
        '已自动取消,仓库保持原样。建议改用"创建备份分支后回退",或手动处理。'
      );
      err.code = 'REVERT_CONFLICT';
      throw err;
    }
    throw new Error('生成反向提交失败:' + msg);
  }
  report('生成反向改动', '已按提交 ' + short + ' 反向应用');

  // 可能出现"没有需要提交的内容"(例如目标提交本身是空提交)
  const st = await git.status(dir);
  if (!st.length) {
    report('无需回滚', '这个提交之后没有可撤销的内容');
    return { createdCommit: null };
  }

  const commit = await git.commit(
    dir,
    `回滚到 ${short}\n\n撤销 ${short} 之后的提交(由小白推送自动生成)`,
    null
  );
  const m = (commit.stdout || '').match(/\[[^\]]+\s+([0-9a-f]{7,})\]/);
  report('生成回滚提交', m ? m[1] : '');
  return { createdCommit: m ? m[1] : '' };
}

/** 用 reset 回滚:直接丢弃之后的提交(仅限未推送) */
async function doReset(dir, full, branch, report) {
  const r = await git.gitAsync(['reset', '--hard', full], { cwd: dir, timeout: 60000 });
  if (r.code !== 0) {
    throw new Error('回退失败:' + (r.stderr || '').trim());
  }
  const head = await git.gitAsync(['rev-parse', '--short', 'HEAD'], { cwd: dir, timeout: 15000 });
  report('回退分支', `${branch} → ${full.slice(0, 7)}`);
  return { resetTo: full, newHead: (head.stdout || '').trim() };
}

/** 修复被写坏的 HTTPS 证书配置(有些机器上残留了已卸载软件的 ca-bundle 路径) */
async function fixSslConfig() {
  const out = [];
  for (const key of ['http.sslcainfo', 'http.sslcapath', 'http.sslverify', 'http.sslbackend']) {
    const r = git.gitSync(['config', '--global', '--unset', key], { timeout: 15000 });
    if (r.code === 0) out.push(key);
  }
  // schannel 让 Windows 直接用系统证书库,基本不会出错
  if (process.platform === 'win32') {
    git.gitSync(['config', '--global', 'http.sslbackend', 'schannel'], { timeout: 15000 });
  }
  return out;
}

module.exports = {
  scanFolder,
  inspectFolder,
  analyze,
  push,
  setRemote,
  cloneInto,
  abortMerge,
  quickStatus,
  history,
  rollback,
  buildSyncLabel,
  fixSslConfig,
  defaultCommitMessage,
  SYNC_LABEL,
};
