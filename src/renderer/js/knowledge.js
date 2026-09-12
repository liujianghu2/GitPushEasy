/**
 * knowledge.js —— 隐藏的「Git 完全指南」内容库。
 *
 * 这里刻意不依赖任何框架,纯数据 + 渲染函数,方便日后单独维护。
 * 内容分四块:
 *   1. 心智模型   —— 用生活化的比喻讲清 Git 到底在干什么
 *   2. 流程图     —— 文件从你手里到 GitHub 的完整旅程(ASCII 图,样式里用等宽字体展示)
 *   3. 分步教程   —— 从零到推送成功的 8 个场景,每个都给出对应命令
 *   4. 命令速查   —— 可按关键词搜索的完整命令表
 */
(function () {
  'use strict';

  /* ============================================================ 一、心智模型 */

  const CONCEPTS = [
    {
      icon: '📁',
      title: '工作区 —— 你眼前这个文件夹',
      body:
        '你平时编辑、新建、删除文件的地方就是"工作区"。它只是普通文件夹,和 Git 没有直接关系。\n' +
        'Git 只会在你明确说"记一下"的时候才去看它。',
    },
    {
      icon: '📸',
      title: '提交(commit)—— 一张全仓库的快照',
      body:
        '提交不是"保存某个文件",而是把当时整个仓库的样子拍一张照片存起来,并且附上:\n' +
        '  · 谁拍的(作者)\n' +
        '  · 什么时候(时间)\n' +
        '  · 为什么拍(提交信息)\n' +
        '  · 上一张照片是谁(父提交)\n' +
        '所有照片串成一条链,这就是"历史"。历史只能追加,不能偷偷修改 —— 所以 Git 很安全。',
    },
    {
      icon: '📦',
      title: '暂存区(staging area)—— 购物车',
      body:
        '这是 Git 最独特、也最容易让人困惑的设计。\n' +
        '改了 10 个文件,但只想把其中 3 个放进这次提交?先把那 3 个"加入暂存区"(git add),\n' +
        '再把暂存区里的东西"结账"成一个提交(git commit)。\n' +
        '本工具的"选择要上传的文件"勾选框,改的就是暂存区。',
    },
    {
      icon: '🌿',
      title: '分支(branch)—— 平行世界的便利贴',
      body:
        '分支本质上只是一个"指向某张快照的可移动标签",创建分支几乎是零成本的。\n' +
        '在分支上随便折腾,主干(main)不受影响。满意了就合并回去,不满意就删掉。\n' +
        '所以"新建分支上传"永远是最安全的做法 —— 出问题也不会影响别人。',
    },
    {
      icon: '☁️',
      title: '远程(remote)—— GitHub 上的那份副本',
      body:
        'origin 是默认的远程名字,它只是一个"地址的别名",本身不神秘。\n' +
        'git push = 把我的提交送上去;git fetch = 把对方的提交取下来(但不合并);\n' +
        'git pull = fetch + 合并。这三件事是全部网络操作的根基。',
    },
    {
      icon: '🔗',
      title: 'HEAD 与"分离头指针"',
      body:
        'HEAD 是"我现在站在哪"的指针,通常指向某个分支名。\n' +
        '如果直接用 commit 号切换过去,HEAD 就指向了提交本身而不是分支,这叫"分离头指针"。\n' +
        '此时提交的东西不属于任何分支,很容易丢。新手记住一句:切换位置请用分支名。',
    },
  ];

  /* ============================================================ 二、流程图 */

  const DIAGRAMS = [
    {
      title: '文件的一生:从你的文件夹到 GitHub',
      caption: '只用记住 4 个动词:add → commit → fetch → push',
      art: `
   ┌──────────────────────────────────────────────────────────────────────┐
   │  你的电脑(本地)                                                    │
   │                                                                      │
   │   ┌────────────┐   git add    ┌────────────┐   git commit  ┌────────┐│
   │   │  工作区     │ ───────────► │  暂存区     │ ───────────► │ 本地仓库││
   │   │  (文件夹)   │              │ (购物车)    │              │(历史)   ││
   │   └────────────┘ ◄─────────── └────────────┘              └────────┘│
   │         ▲          git restore                                   │    │
   │         │          (撤销修改)                                     │    │
   │         └────────────── git checkout / switch ────────────────────┘    │
   │                          (切换到别的分支/版本)                        │
   └──────────────────────────────────────────────────────────────────────┘
                                    │  ▲
                       git push     │  │     git fetch / git pull
                     (送上去)       ▼  │     (取下来)
   ┌──────────────────────────────────────────────────────────────────────┐
   │  GitHub(远程)                                                      │
   │   origin/main   ← 别人也能看到、也能修改的同一份历史                  │
   └──────────────────────────────────────────────────────────────────────┘
`,
    },
    {
      title: '为什么会被拒绝推送?(小白最常撞的三种墙)',
      caption: '看懂这张图,你就再也不会被 "rejected" 吓到',
      art: `
 情况 A:本地领先 —— 直接推就好 ✅
    GitHub:  A──B──C
    本地:    A──B──C──D──E         git push → 成功

 情况 B:本地落后 —— 先拉再推 ✅
    GitHub:  A──B──C──D──E
    本地:    A──B──C                git pull → 变成本地也有 D E,再 push

 情况 C:分叉了 —— 两边都有新东西 ⚠️
    GitHub:  A──B──C──D
    本地:    A──B──C──────X──Y     push 会被拒绝(non-fast-forward)

    两条出路(本工具都会引导你):
      ① 先合并再推:git pull --rebase  →  C──D──X'──Y'  然后 push
         (变基 = 把你的 X Y 挪到 D 后面,历史看起来像一条直线)
      ② 新建分支推:git switch -c my-work → push 到新分支,不动主干
         (最安全,之后在 GitHub 上发 Pull Request 请求合并)

 ⛔ 千万不要用 git push --force!
    它会用你本地的历史"盖掉"GitHub 上的历史,别人的提交会凭空消失。
    本工具在任何情况下都不会替你执行强制推送。
`,
    },
    {
      title: '三种"撤销"到底该用哪个?',
      caption: '这是 Git 里最容易用错的地方,请务必分清',
      art: `
  ┌────────────────┬──────────────────────┬──────────────────────────────┐
  │ 想撤销什么      │ 命令                  │ 后果                          │
  ├────────────────┼──────────────────────┼──────────────────────────────┤
  │ 工作区里改坏的  │ git restore <文件>    │ 文件回到上次提交的样子,       │
  │ 还没 add 的修改 │ git checkout -- <文件>│ 未提交的修改永久丢失 ⚠️       │
  ├────────────────┼──────────────────────┼──────────────────────────────┤
  │ 已经 add 进     │ git restore --staged  │ 只是从购物车里拿出来,         │
  │ 暂存区的文件    │   <文件>              │ 文件内容一点没动 ✅           │
  │                │ git reset HEAD <文件> │                              │
  ├────────────────┼──────────────────────┼──────────────────────────────┤
  │ 最近一次提交    │ git commit --amend    │ 改写这条提交(信息/内容)。     │
  │ (还没推送)      │                       │ 没推送过就安全 ✅              │
  ├────────────────┼──────────────────────┼──────────────────────────────┤
  │ 已经推送的提交  │ git revert <commit>   │ 生成一条"反向提交"来抵消,     │
  │                │                       │ 历史保留,最安全 ✅            │
  │                │ git reset --hard <c>  │ 强行丢弃后续提交,再强推 ⛔    │
  └────────────────┴──────────────────────┴──────────────────────────────┘
  口诀:没推送 → 可以改历史;已推送 → 只能用 revert。
`,
    },
    {
      title: '四个区域 + 三种文件状态',
      caption: '所有 Git 命令都在这些状态之间搬运文件',
      art: `
        未跟踪            已暂存            已提交
      (untracked)  →   (staged)   →   (committed)
           │              │                 │
           │  git add     │   git commit    │
           └──────────────┴─────────────────┘
                  ▲                │
                  │  git restore   │  git reset --soft HEAD~1
                  │  --staged      │  (退回暂存区,改动还在)
                  └────────────────┘

   已修改(modified) 是第四种状态:文件被改了,但还没 add。
   \`git status\` 会同时告诉你"哪些在暂存区、哪些还没暂存"。
`,
    },
  ];

  /* ============================================================ 三、教程 */

  const TUTORIALS = [
    {
      id: 'what-is-git',
      title: '第 1 课:Git 到底解决什么问题?',
      minutes: 3,
      tags: ['概念'],
      body: `
**一句话**:Git 是给文件夹装的一台"时光机 + 平行世界机器"。

没有 Git 的时候,你大概这么干过:

    project/
    project-最终版/
    project-最终版2/
    project-最终版-真的最终-改了点东西/
    project-最终版-老板说要改/

有了 Git,只需要一个文件夹,历史由 Git 替你记:

    改了点东西 → 提交"改了点东西"
    又改回去   → 提交"改回去"
    想回到三天前 → 一条命令切回去看看
    想同时试两种方案 → 开两条分支,互不干扰

**它和"网盘备份"有什么不同?**

  · 网盘备份的是"文件",Git 备份的是"整个项目在某一刻的状态 + 为什么变成这样"
  · Git 能精确回答:"这行代码是谁、什么时候、为什么改的?"
  · Git 支持多人同时改同一个项目,并且能自动合并大部分改动

**GitHub 又是什么?** 就是一个"放 Git 仓库的网站"。Git 是工具,GitHub 是托管服务。
你不用 GitHub 也能用 Git(但那样就没法给同事看你的代码了)。
`,
    },
    {
      id: 'first-time-setup',
      title: '第 2 课:第一次使用要做的 3 个设置',
      minutes: 2,
      tags: ['入门', '配置'],
      body: `
装好 Git 之后,**必须**先告诉它你是谁,否则连提交都做不了。

  ① 名字和邮箱(会写进每一条提交里,全世界可见)

      git config --global user.name  "你的名字"
      git config --global user.email "你的邮箱"

     小技巧:不想暴露真实邮箱,可以用 GitHub 提供的匿名邮箱,
     形如 12345678+你的用户名@users.noreply.github.com
     (在 GitHub → Settings → Emails 页面能看到你的这个地址)

  ② 默认分支名(新建仓库时用哪个名字)

      git config --global init.defaultBranch main

     GitHub 现在默认用 main,老教程里的 master 是历史遗留。

  ③ 换行符处理(Windows 上强烈建议设)

      # Windows
      git config --global core.autocrlf true
      # macOS / Linux
      git config --global core.autocrlf input

  查看当前所有配置:

      git config --global --list

  改错了想删掉某一项:

      git config --global --unset user.email
`,
    },
    {
      id: 'first-upload',
      title: '第 3 课:把一个文件夹第一次传上 GitHub(完整 6 步)',
      minutes: 5,
      tags: ['入门', '推送', '核心'],
      body: `
**第 0 步 —— 先写 .gitignore(最重要的一步,别跳)**

在文件夹里新建一个名为 \`.gitignore\` 的文件,写上不想上传的东西:

      node_modules/        # 依赖,几百 MB,别人 npm install 就能装回来
      dist/                # 构建产物,能重新生成
      .env                 # 里面有密码和密钥,绝对不能传!
      .DS_Store            # macOS 自动生成的垃圾文件
      Thumbs.db            # Windows 自动生成的垃圾文件

为什么要先做?因为一旦提交过,文件就永远留在历史里了,之后再删也删不干净。

**第 1 步 —— 初始化仓库**

      cd 你的文件夹
      git init

这会在文件夹里建一个隐藏的 \`.git\` 目录。整个"历史数据库"就在里面。
删掉 \`.git\`,这个文件夹就变回普通文件夹(历史全没了)。

**第 2 步 —— 看看现在的状态**

      git status

它会告诉你:哪些文件是新的(untracked)、哪些改了、哪些已经在暂存区。

**第 3 步 —— 把文件放进"购物车"**

      git add .              # 全部加入(注意末尾那个点)
      git add src/main.js    # 只加某一个文件
      git add src/           # 只加某一个文件夹

**第 4 步 —— 提交(拍快照)**

      git commit -m "第一次提交:项目初始化"

提交信息写什么?写"这次改动的意图",不要写"update"、"修改"这种等于没说的话。
好的例子:"修复登录按钮在 Safari 上点不动的问题"

**第 5 步 —— 在 GitHub 网站上建一个空仓库**

浏览器打开 https://github.com/new ,填仓库名,**不要**勾选
"Add a README file"、"Add .gitignore"、"Choose a license" ——
我们要的是一个完全空的仓库,否则第一次推送会有冲突。

**第 6 步 —— 关联并推送**

      git remote add origin https://github.com/你的用户名/仓库名.git
      git branch -M main
      git push -u origin main

\`-u\` 是"记住这次的上游关系",以后直接 \`git push\` 就行,不用再写后面那一串。

> 这六步就是本工具"一键上传"背后真正在做的事。理解之后,
> 你在任何一台电脑上都能徒手完成同样的操作。
`,
    },
    {
      id: 'auth',
      title: '第 4 课:为什么不能用密码?令牌(Token)与 SSH 怎么选',
      minutes: 4,
      tags: ['登录', '认证', '核心'],
      body: `
**2021 年 8 月 13 日之后,GitHub 不再接受账号密码推送代码。**

你在命令行输密码,会得到:

      remote: Support for password authentication was removed on August 13, 2021.
      remote: Please see https://docs.github.com/get-started/getting-started-with-git/about-remote-repositories

三种替代方案:

**方案一:Personal Access Token(PAT)—— 最简单**

  1. 打开 https://github.com/settings/tokens
  2. 点 "Generate new token" → 选 "classic"
  3. 勾选权限:\`repo\`(完整仓库读写)+ \`workflow\`(如果你要用 Actions)
  4. 设置有效期(建议 90 天,到期重新生成)
  5. 点生成,**立刻复制**那一串(离开页面就再也看不到了)
  6. 推送时:
       · 用户名:填你的 GitHub 用户名
       · 密码:粘贴这串令牌(不是你的登录密码!)

  想少输几次?让 Git 记住:

      git config --global credential.helper manager    # Windows(装 Git 时自带)
      git config --global credential.helper osxkeychain # macOS
      git config --global credential.helper store       # 明文存 ~/.git-credentials ⚠️
      git config --global credential.helper cache       # 只在内存里存 15 分钟

**方案二:SSH 密钥 —— 配一次,永久免密**

      ssh-keygen -t ed25519 -C "你的邮箱"        # 一路回车
      # Windows 下公钥在 C:\\Users\\你\\.ssh\\id_ed25519.pub
      cat ~/.ssh/id_ed25519.pub                  # 复制输出的全部内容

  粘贴到 https://github.com/settings/keys → New SSH key
  然后测试并改用 SSH 地址:

      ssh -T git@github.com
      git remote set-url origin git@github.com:用户名/仓库名.git

**方案三:GitHub CLI 或 Git Credential Manager —— 浏览器授权**

      gh auth login          # 装 GitHub CLI 之后
      git push               # 剩下的交给 Git Credential Manager 弹窗

**到底选哪个?**

  ┌─────────────┬────────┬──────────┬──────────────────────────┐
  │ 方式         │ 难度    │ 安全性    │ 适合谁                    │
  ├─────────────┼────────┼──────────┼──────────────────────────┤
  │ 令牌 PAT     │ ★☆☆    │ 高(可随时吊销) │ 所有人,首选         │
  │ SSH 密钥     │ ★★☆    │ 最高      │ 经常推送、有多个仓库的人   │
  │ 浏览器授权   │ ★☆☆    │ 高        │ 不想管密钥的人             │
  │ 账号密码     │   —    │    —     │ 已废弃,不可用 ⛔          │
  └─────────────┴────────┴──────────┴──────────────────────────┘

**令牌泄露了怎么办?** 立刻去 https://github.com/settings/tokens 点 Delete,
一分钟内所有使用它的地方都会失效。这就是令牌比密码安全的原因:密码泄露要改所有东西。
`,
    },
    {
      id: 'branches',
      title: '第 5 课:分支 —— 安全地"另起一摊"',
      minutes: 4,
      tags: ['分支', '协作', '核心'],
      body: `
**什么时候该新建分支?**

  · 要做一个不确定能不能成的新功能
  · 要修一个 bug,但主干上还有没完成的工作
  · 你**没有**仓库主干的直接推送权限(开源项目贡献者)
  · 推送被拒绝了,懒得处理冲突(最快、最安全的绕路)

**基本操作**

      git branch                     # 列出所有本地分支(* 号是当前所在)
      git branch -a                  # 连远程分支一起列
      git switch -c 新分支名          # 新建并切过去(推荐)
      git checkout -b 新分支名        # 老写法,效果一样
      git switch 已有分支名           # 切换
      git branch -d 已合并的分支      # 删除本地分支
      git branch -D 没合并也想删的分支 # 强制删
      git push -u origin 分支名       # 把新分支推上去并建立追踪

**分支命名建议**(纯经验,不是强制规则)

      feature/user-login        新功能
      fix/crash-on-startup      修 bug
      docs/update-readme        改文档
      chore/upgrade-deps        杂活

**合并分支**

      # 站在 main 上,把 feature 合进来
      git switch main
      git merge feature/user-login

      # 想让历史保持一条直线,可以用变基
      git switch feature/user-login
      git rebase main
      git switch main
      git merge --ff-only feature/user-login

**删除远程分支**

      git push origin --delete 分支名

**分支活在哪儿?** 就在 \`.git/refs/heads/\` 目录下,每个分支是一个几十字节的小文件,
里面只写了一行 commit 号。所以"建分支"才会快到几乎感觉不到。
`,
    },
    {
      id: 'conflicts',
      title: '第 6 课:冲突(Conflict)到底是什么,怎么解决',
      minutes: 5,
      tags: ['冲突', '进阶'],
      body: `
**冲突不是错误,是 Git 在向你求助。**

Git 能自动合并"两个人在不同文件、或同一文件不同位置"的改动。
但如果是**同一个文件的同一行**被两边改成了不同的内容,Git 没法猜你想要哪个,
于是它把两种版本都留在文件里,让你自己决定:

      <<<<<<< HEAD
      console.log("我本地的写法")
      =======
      console.log("远程的写法")
      >>>>>>> origin/main

  上面一段 = 你本地的版本(HEAD)
  中间 ===  = 分隔线
  下面一段 = 远程来的版本

**解决步骤**

  1. 打开冲突文件,把 \`<<<<<<<\`、\`=======\`、\`>>>>>>>\` 三行全删掉
  2. 在上面的位置写下你最终想要的内容(可以两边都要,也可以只要一边)
  3. 标记为已解决:

         git add 冲突文件

  4. 完成合并:

         git commit            # merge 时
         git rebase --continue # rebase 时

**后悔了怎么办?**

      git merge --abort        # 放弃这次合并,回到动手之前
      git rebase --abort       # 放弃这次变基
      git checkout --ours 文件  # 这一处要我的版本
      git checkout --theirs 文件# 这一处要对方的版本

**冲突最少的工作方式**

  · 推送前先 \`git pull\`,不要攒一个星期再推
  · 每个人负责的文件尽量不重叠
  · 大改动前先开分支,改完尽早合并回主干
`,
    },
    {
      id: 'workflow',
      title: '第 7 课:一套能长期用下去的工作流',
      minutes: 3,
      tags: ['协作', '流程'],
      body: `
**每天开始工作前**

      git pull                    # 先拿到同事的最新代码

**工作中**

      git status                  # 随时看状态(最常用,没有之一)
      git add -p                  # 逐块挑选要提交的改动(进阶但非常好用)
      git commit -m "说明这次改了什么"

**一天结束时**

      git pull --rebase           # 把同事的提交挪到你的下面
      git push

**做一个新功能**

      git switch -c feature/xxx
      # ...写代码,多次 commit...
      git push -u origin feature/xxx
      # 到 GitHub 上点 "Compare & pull request" 发起 PR

**Pull Request(PR)是什么?**
就是"我改好了,请你看看要不要合进主干"的正式请求。
开源项目里,你**没有**主干推送权限,所有贡献都是通过 PR 完成的。
PR 上可以:评论、逐行 review、跑自动化测试、讨论,最后点 Merge 合并。

**提交信息怎么写才专业**(约定式提交,可选但推荐)

      feat: 新增用户头像上传
      fix: 修正导出 CSV 时中文乱码
      docs: 补充部署说明
      refactor: 拆分订单模块
      chore: 升级依赖到最新版

**千万不要提交的东西**

      ✗ 密码、API Key、私钥、.env 文件
      ✗ node_modules、venv 等可重新生成的依赖
      ✗ 你自己电脑上的绝对路径配置
      ✗ 编译产物(dist、build、*.exe)

> 已经不小心传上去了怎么办?**删掉文件再提交是没用的**,历史里还在。
> 必须用 \`git filter-repo\` 或 BFG 工具重写历史,并且**立刻把那个密钥作废**。
> 最省事的做法永远是:一开始就写对 .gitignore。
`,
    },
    {
      id: 'rescue',
      title: '第 8 课:出事了怎么救(reflog 是你的安全网)',
      minutes: 4,
      tags: ['进阶', '救援'],
      body: `
**先记住一句话:只要提交过,Git 几乎不会真的丢东西。**

**场景 1:reset --hard 之后发现删错了**

      git reflog
      # 输出形如:
      # a1b2c3d HEAD@{0}: reset: moving to HEAD~3
      # 9f8e7d6 HEAD@{1}: commit: 重要的工作

      git reset --hard 9f8e7d6      # 回到那个提交

\`reflog\` 记录了 HEAD 的每一次移动,默认保留 90 天。它是 Git 的"行车记录仪"。

**场景 2:合并到一半想反悔**

      git merge --abort
      git rebase --abort
      git cherry-pick --abort

**场景 3:把不该提交的文件提交了(还没推送)**

      git rm --cached 文件名         # 从 Git 里移除,但保留你磁盘上的文件
      echo "文件名" >> .gitignore
      git commit --amend             # 把它从刚才那次提交里去掉

**场景 4:写错了提交信息**

      git commit --amend -m "正确的信息"

**场景 5:想撤销一个已经推送的提交**

      git revert <commit号>          # 生成一条反向提交,安全
      git push

**场景 6:不小心提交了密码**

  1. **立刻**去对应平台作废那个密钥(这是唯一真正的补救)
  2. 再清理历史:装 \`git-filter-repo\` 后执行

         git filter-repo --path 泄露的文件 --invert-paths
         git push --force --all

  3. 通知所有协作者重新 clone(历史变了,他们的本地副本已经对不上)

**场景 7:仓库彻底乱了,但 GitHub 上是好的**

      git fetch origin
      git reset --hard origin/main     # 本地完全变成远程的样子 ⚠️ 本地未推送的改动会丢

**最后的安全建议**
  · 重要的仓库定期 \`git push\`,推到远程就等于有了异地备份
  · 动手做危险操作(reset --hard、filter-repo、push --force)前先 \`git branch backup-今天日期\`
  · 本工具永远不会替你执行 force push 和 reset --hard
`,
    },
  ];

  /* ============================================================ 四、命令速查 */

  const COMMANDS = [
    // —— 配置
    { cmd: 'git config --global user.name "名字"', desc: '设置全局用户名(会写进每条提交)', group: '配置', tags: ['config', '入门'] },
    { cmd: 'git config --global user.email "邮箱"', desc: '设置全局邮箱', group: '配置', tags: ['config', '入门'] },
    { cmd: 'git config --global init.defaultBranch main', desc: '新建仓库默认用 main 分支', group: '配置' },
    { cmd: 'git config --global core.autocrlf true', desc: 'Windows 换行符自动转换(建议开启)', group: '配置' },
    { cmd: 'git config --global --list', desc: '查看所有全局配置', group: '配置' },
    { cmd: 'git config --global --unset 配置项', desc: '删除某一项配置', group: '配置' },
    { cmd: 'git config --global --edit', desc: '用编辑器直接打开配置文件', group: '配置' },
    { cmd: 'git config --global credential.helper manager', desc: '让 Git 记住账号密码(Windows)', group: '配置', tags: ['认证', '免密', 'token', '令牌'] },

    // —— 创建仓库
    { cmd: 'git init', desc: '把当前文件夹变成 Git 仓库', group: '开始', tags: ['入门', '核心'] },
    { cmd: 'git init -b main', desc: '初始化并直接指定主分支名', group: '开始' },
    { cmd: 'git clone 地址', desc: '把远程仓库完整下载到本地', group: '开始', tags: ['入门'] },
    { cmd: 'git clone 地址 目录名', desc: '下载到指定目录名', group: '开始' },
    { cmd: 'git clone --depth 1 地址', desc: '只下载最新一次提交(仓库很大时用)', group: '开始', tags: ['大仓库'] },

    // —— 查看状态
    { cmd: 'git status', desc: '查看哪些文件改了、哪些已暂存(最常用)', group: '查看', tags: ['入门', '核心', '最常用'] },
    { cmd: 'git status -s', desc: '精简格式输出,一行一个文件', group: '查看' },
    { cmd: 'git diff', desc: '查看还没 add 的具体改动内容', group: '查看', tags: ['核心'] },
    { cmd: 'git diff --staged', desc: '查看已经 add、还没提交的改动', group: '查看' },
    { cmd: 'git diff 分支A 分支B', desc: '比较两个分支的差异', group: '查看' },
    { cmd: 'git log', desc: '查看提交历史', group: '查看', tags: ['核心'] },
    { cmd: 'git log --oneline --graph --all', desc: '一行式 + 分支图,最直观的历史视图', group: '查看', tags: ['推荐', '图形'] },
    { cmd: 'git log -p 文件名', desc: '查看某个文件的完整修改历史', group: '查看' },
    { cmd: 'git log --author="名字"', desc: '只看某个人的提交', group: '查看' },
    { cmd: 'git show 提交号', desc: '查看某次提交的具体改动', group: '查看' },
    { cmd: 'git blame 文件名', desc: '逐行显示"这行是谁什么时候改的"', group: '查看', tags: ['排查'] },
    { cmd: 'git shortlog -sn', desc: '按人统计提交次数', group: '查看' },

    // —— 暂存与提交
    { cmd: 'git add .', desc: '把所有改动加入暂存区', group: '提交', tags: ['入门', '核心'] },
    { cmd: 'git add 文件名', desc: '只把某个文件加入暂存区', group: '提交' },
    { cmd: 'git add -A', desc: '包括新增、修改、删除全部加入', group: '提交' },
    { cmd: 'git add -p', desc: '逐块挑选要提交的改动(强烈推荐)', group: '提交', tags: ['推荐', '进阶'] },
    { cmd: 'git commit -m "说明"', desc: '把暂存区的内容提交成一个快照', group: '提交', tags: ['入门', '核心'] },
    { cmd: 'git commit -am "说明"', desc: '已跟踪文件改动的 add + commit 一步到位', group: '提交' },
    { cmd: 'git commit --amend', desc: '修改最近一次提交(信息或内容)', group: '提交', tags: ['撤销'] },
    { cmd: 'git commit --amend --no-edit', desc: '把新改动并进上一次提交,不改信息', group: '提交' },
    { cmd: 'git commit --allow-empty -m "说明"', desc: '创建一次空提交(触发 CI 时有用)', group: '提交' },

    // —— 撤销
    { cmd: 'git restore 文件名', desc: '丢弃工作区改动,回到上次提交的样子 ⚠️', group: '撤销', tags: ['危险', '核心'] },
    { cmd: 'git restore --staged 文件名', desc: '把文件移出暂存区(内容不变)', group: '撤销', tags: ['安全'] },
    { cmd: 'git restore --source=HEAD~2 文件名', desc: '把文件恢复到两次提交之前的版本', group: '撤销' },
    { cmd: 'git reset --soft HEAD~1', desc: '撤销最近一次提交,改动留在暂存区', group: '撤销' },
    { cmd: 'git reset --mixed HEAD~1', desc: '撤销提交,改动留在工作区(默认)', group: '撤销' },
    { cmd: 'git reset --hard HEAD~1', desc: '彻底丢弃最近一次提交和改动 ⛔', group: '撤销', tags: ['危险'] },
    { cmd: 'git revert 提交号', desc: '生成一条反向提交来撤销(已推送时唯一安全做法)', group: '撤销', tags: ['安全', '推荐'] },
    { cmd: 'git clean -nd', desc: '预览哪些未跟踪文件会被删(先看再做)', group: '撤销', tags: ['安全'] },
    { cmd: 'git clean -fd', desc: '删除所有未跟踪的文件和目录 ⛔', group: '撤销', tags: ['危险'] },
    { cmd: 'git reflog', desc: '查看 HEAD 的移动记录,误删后的救命稻草', group: '撤销', tags: ['救援', '核心'] },

    // —— 分支
    { cmd: 'git branch', desc: '列出本地分支', group: '分支', tags: ['核心'] },
    { cmd: 'git branch -a', desc: '列出本地 + 远程所有分支', group: '分支' },
    { cmd: 'git branch -vv', desc: '列出分支并显示追踪关系与领先/落后情况', group: '分支', tags: ['推荐'] },
    { cmd: 'git switch -c 新分支', desc: '新建分支并切换过去', group: '分支', tags: ['推荐', '核心'] },
    { cmd: 'git checkout -b 新分支', desc: '同上(老写法)', group: '分支' },
    { cmd: 'git switch 分支名', desc: '切换分支', group: '分支', tags: ['核心'] },
    { cmd: 'git switch -', desc: '切回上一个分支', group: '分支' },
    { cmd: 'git branch -m 新名字', desc: '重命名当前分支', group: '分支' },
    { cmd: 'git branch -d 分支名', desc: '删除已合并的分支', group: '分支' },
    { cmd: 'git branch -D 分支名', desc: '强制删除未合并的分支 ⚠️', group: '分支' },
    { cmd: 'git merge 分支名', desc: '把指定分支合并到当前分支(遇到冲突会停下来让你决定)', group: '分支', tags: ['核心', '冲突', 'conflict'] },
    { cmd: 'git merge --no-ff 分支名', desc: '合并时保留分支记录(生成合并提交)', group: '分支' },
    { cmd: 'git merge --abort', desc: '放弃这次合并,回到合并之前的状态(冲突解不开时的退路)', group: '分支', tags: ['冲突', '救援', '推荐'] },
    { cmd: 'git rebase --abort', desc: '放弃这次变基,回到变基之前的状态', group: '分支', tags: ['冲突', '救援'] },
    { cmd: 'git rebase --continue', desc: '冲突解决并 git add 之后,继续完成变基', group: '分支', tags: ['冲突'] },
    { cmd: 'git checkout --ours 文件名', desc: '冲突时保留"我这边"的版本', group: '分支', tags: ['冲突'] },
    { cmd: 'git checkout --theirs 文件名', desc: '冲突时保留"对方"的版本', group: '分支', tags: ['冲突'] },
    { cmd: 'git rebase 分支名', desc: '把当前分支的提交"挪"到目标分支之后', group: '分支', tags: ['进阶'] },
    { cmd: 'git rebase -i HEAD~3', desc: '交互式整理最近 3 次提交(合并/改信息)', group: '分支', tags: ['进阶'] },
    { cmd: 'git cherry-pick 提交号', desc: '把别的分支上的某一次提交复制过来', group: '分支', tags: ['进阶'] },

    // —— 远程与推送
    { cmd: 'git remote -v', desc: '查看远程仓库地址(repo 的地址)', group: '远程', tags: ['核心', 'repo', '仓库'] },
    { cmd: 'git remote add origin 地址', desc: '关联一个远程仓库(把本地文件夹连到某个 repo)', group: '远程', tags: ['核心', 'repo', '仓库'] },
    { cmd: 'git remote set-url origin 地址', desc: '修改远程地址', group: '远程' },
    { cmd: 'git remote remove origin', desc: '解除关联', group: '远程' },
    { cmd: 'git fetch', desc: '下载远程最新信息,但不合并', group: '远程', tags: ['安全'] },
    { cmd: 'git fetch --prune', desc: '下载并清理远程已删除的分支引用', group: '远程' },
    { cmd: 'git pull', desc: '下载并合并远程改动(= fetch + merge)', group: '远程', tags: ['核心'] },
    { cmd: 'git pull --rebase', desc: '下载后变基,历史更干净(推荐)', group: '远程', tags: ['推荐'] },
    { cmd: 'git pull --ff-only', desc: '只在能快进时拉取,否则报错(最保守)', group: '远程' },
    { cmd: 'git push', desc: '把本地提交推送到远程', group: '远程', tags: ['核心'] },
    { cmd: 'git push -u origin main', desc: '首次推送并记住上游关系', group: '远程', tags: ['入门', '核心'] },
    { cmd: 'git push origin 分支名', desc: '推送指定分支', group: '远程' },
    { cmd: 'git push origin --delete 分支名', desc: '删除远程分支', group: '远程' },
    { cmd: 'git push --tags', desc: '把所有标签推上去', group: '远程' },
    { cmd: 'git push --force-with-lease', desc: '比 --force 安全的强推(会被别人抢先时拒绝)⚠️', group: '远程', tags: ['危险'] },
    { cmd: 'git push --force', desc: '强制覆盖远程历史 ⛔ 会毁掉别人的提交', group: '远程', tags: ['危险', '禁止'] },

    // —— 标签
    { cmd: 'git tag', desc: '列出所有标签', group: '标签' },
    { cmd: 'git tag -a v1.0.0 -m "说明"', desc: '创建带说明的标签(发布版本用)', group: '标签' },
    { cmd: 'git tag -d v1.0.0', desc: '删除本地标签', group: '标签' },
    { cmd: 'git push origin --delete v1.0.0', desc: '删除远程标签', group: '标签' },

    // —— 储藏
    { cmd: 'git stash', desc: '把当前改动暂时收起来,工作区变干净', group: '储藏', tags: ['实用'] },
    { cmd: 'git stash -u', desc: '连未跟踪的新文件一起收起来', group: '储藏' },
    { cmd: 'git stash list', desc: '查看收起来的列表', group: '储藏' },
    { cmd: 'git stash pop', desc: '恢复最近一次储藏并删除记录', group: '储藏' },
    { cmd: 'git stash apply stash@{1}', desc: '恢复指定的储藏(保留记录)', group: '储藏' },
    { cmd: 'git stash drop', desc: '删除最近一次储藏记录', group: '储藏' },

    // —— 文件与忽略
    { cmd: 'git rm 文件名', desc: '从 Git 和磁盘同时删除', group: '文件' },
    { cmd: 'git rm --cached 文件名', desc: '只从 Git 移除,保留磁盘文件(常用于补救误提交)', group: '文件', tags: ['常用'] },
    { cmd: 'git mv 旧 新', desc: '重命名/移动文件并让 Git 记录', group: '文件' },
    { cmd: 'git check-ignore -v 文件名', desc: '查这个文件到底被哪条 .gitignore 规则忽略了', group: '文件', tags: ['排查', '推荐'] },
    { cmd: 'git ls-files', desc: '列出所有被 Git 跟踪的文件', group: '文件' },

    // —— 排查
    { cmd: 'git fsck', desc: '检查仓库完整性', group: '排查' },
    { cmd: 'git gc', desc: '压缩整理仓库,回收空间', group: '排查' },
    { cmd: 'git count-objects -vH', desc: '查看仓库占用多大', group: '排查' },
    { cmd: 'git bisect start', desc: '二分查找是哪个提交引入了 bug', group: '排查', tags: ['进阶'] },
    { cmd: 'git grep "关键词"', desc: '在当前版本的所有文件里搜索', group: '排查' },
    { cmd: 'git log -S "某段代码" --oneline', desc: '查出这段代码是哪次提交加进来的', group: '排查', tags: ['进阶'] },
    { cmd: 'git -c http.sslbackend=schannel <命令>', desc: '强制用系统证书库,解决 SSL 证书报错', group: '排查', tags: ['网络', '代理', 'SSL'] },
    { cmd: 'git config --global http.proxy http://127.0.0.1:7890', desc: '给 Git 设置代理(端口换成你自己的)', group: '排查', tags: ['网络', '代理'] },
    { cmd: 'git config --global --unset http.proxy', desc: '取消代理设置(换了网络环境后要记得清掉)', group: '排查', tags: ['网络', '代理'] },
    { cmd: 'git config --global --unset http.sslcainfo', desc: '删掉残留的旧 CA 证书路径配置', group: '排查', tags: ['网络', 'SSL'] },
    { cmd: 'git ls-remote origin', desc: '不克隆也能看到远程有哪些分支(用来测连通性)', group: '排查', tags: ['网络'] },

    // —— SSH / 凭据
    { cmd: 'ssh-keygen -t ed25519 -C "邮箱"', desc: '生成一对 SSH 密钥', group: '认证', tags: ['SSH', '密钥', '免密'] },
    { cmd: 'ssh -T git@github.com', desc: '测试 SSH 是否配置成功', group: '认证', tags: ['SSH', '测试'] },
    { cmd: 'git credential fill', desc: '查看本机凭据管理器里保存的账号(需手动输入 host)', group: '认证', tags: ['凭据', 'token', '令牌', '密码'] },
    { cmd: 'git credential-manager github logout', desc: '退出 Git Credential Manager 里的 GitHub 账号', group: '认证', tags: ['凭据', 'token', '登录'] },
    { cmd: 'git config --global credential.helper store', desc: '把凭据明文保存在 ~/.git-credentials ⚠️ 不建议', group: '认证', tags: ['凭据', 'token', '危险'] },

    // —— 大文件
    { cmd: 'git lfs install', desc: '初始化 Git LFS(管理大文件)', group: '大文件', tags: ['LFS'] },
    { cmd: 'git lfs track "*.psd"', desc: '让某类文件走 LFS 管理', group: '大文件', tags: ['LFS'] },
    { cmd: 'git lfs ls-files', desc: '列出正在被 LFS 管理的文件', group: '大文件', tags: ['LFS'] },

    // —— 子模块
    { cmd: 'git submodule add 地址 路径', desc: '把一个仓库作为子模块嵌入', group: '子模块', tags: ['进阶'] },
    { cmd: 'git submodule update --init --recursive', desc: '克隆后拉取所有子模块', group: '子模块', tags: ['进阶'] },
  ];

  /* ============================================================ 五、故障对照表 */

  const TROUBLESHOOT = [
    {
      error: 'Support for password authentication was removed',
      cause: 'GitHub 不支持账号密码了',
      fix: '改用 Personal Access Token 当作密码,或配置 SSH 密钥。本工具的"访问令牌"登录方式就是为这个准备的。',
    },
    {
      error: 'Updates were rejected because the remote contains work that you do not have',
      cause: '远程有你本地没有的提交(别人先推了,或你在别的电脑上推过)',
      fix: '先 git pull --rebase (或本工具点"先同步再上传")。不想动主干就新建分支上传。',
    },
    {
      error: 'failed to push some refs to ... (non-fast-forward)',
      cause: '同上,本地历史不能"覆盖式"地接上去',
      fix: '先同步再推。绝不要用 --force 解决这个问题。',
    },
    {
      error: 'remote: Repository not found',
      cause: '仓库地址写错、仓库被删/改名,或当前账号没有访问权限',
      fix: 'git remote -v 检查地址;确认在 GitHub 上能看到这个仓库;私有仓库要确认账号有权限。',
    },
    {
      error: 'Please tell me who you are / Author identity unknown',
      cause: '没设置 user.name 和 user.email',
      fix: 'git config --global user.name "名字" 和 git config --global user.email "邮箱"。',
    },
    {
      error: 'src refspec main does not match any',
      cause: '本地还没有 main 分支(可能还没提交,或分支名是 master)',
      fix: '先 git add . && git commit -m "init";用 git branch 看实际分支名。',
    },
    {
      error: 'error: failed to push some refs (protected branch)',
      cause: '主干被设置为受保护分支,不允许直接推送',
      fix: '新建分支推送,再在 GitHub 上发 Pull Request。',
    },
    {
      error: 'this exceeds GitHub\'s file size limit of 100.00 MB',
      cause: '有文件超过 100MB',
      fix: '把它加入 .gitignore,或用 Git LFS:git lfs track "*.大后缀"。已经提交过则需要从历史里清理。',
    },
    {
      error: 'SSL certificate problem: unable to get local issuer certificate',
      cause: '本机残留了失效的 CA 证书路径配置(常见于装过又卸载了其他 Git 工具)',
      fix: 'git config --global --unset http.sslcainfo;然后 git config --global http.sslbackend schannel。本工具设置里有"一键修复"。',
    },
    {
      error: 'fatal: unable to access ... Could not resolve host: github.com',
      cause: '网络/DNS 问题,或需要代理',
      fix: '检查网络;需要代理时:git config --global http.proxy http://127.0.0.1:端口',
    },
    {
      error: 'error: Your local changes would be overwritten by merge',
      cause: '本地有未提交的改动,而拉取会覆盖它们',
      fix: '先 commit 或 git stash 收起来,再 pull,然后 git stash pop。',
    },
    {
      error: 'fatal: not a git repository',
      cause: '当前目录(或其任何父目录)都不是 Git 仓库',
      fix: 'cd 到项目根目录,或先 git init。',
    },
    {
      error: 'LF will be replaced by CRLF',
      cause: '换行符转换提示(Windows 上常见)',
      fix: '不是错误,可以忽略。想统一行为就设置 core.autocrlf。',
    },
  ];

  /* ============================================================ 小抄 */

  const CHEATSHEET = [
    { t: '每天只需记住这 5 条', items: ['git status —— 现在什么情况', 'git add . —— 全都放进购物车', 'git commit -m "说明" —— 拍快照', 'git pull --rebase —— 先拿别人的', 'git push —— 传上去'] },
    { t: '推不上去时的排查顺序', items: ['git status 看有没有没提交的', 'git fetch 看远程有没有新东西', 'git log --oneline origin/main..HEAD 看我领先几个', 'git log --oneline HEAD..origin/main 看我落后几个', '都领先又落后 → 分叉了,选合并或新建分支'] },
    { t: '五个绝对不能做', items: ['git push --force(除非你完全清楚后果)', 'git reset --hard(会丢本地改动)', 'git clean -fd(会删未跟踪文件)', '把 .env / 密钥提交上去', '在共享分支上改写历史'] },
  ];

  /* ============================================================ 对外 */

  window.GPEKnowledge = {
    CONCEPTS,
    DIAGRAMS,
    TUTORIALS,
    COMMANDS,
    TROUBLESHOOT,
    CHEATSHEET,
    groups: Array.from(new Set(COMMANDS.map((c) => c.group))),
    /**
     * 按关键词搜索命令。
     *
     * 匹配规则(对小白尽量宽容):
     *   · 支持多关键词,空格分隔,全部命中才算匹配
     *   · 中文/英文、命令/说明/分组/标签 都参与匹配
     *   · 短词(<= 3 字符)在任意位置匹配即可,所以 "repo" 能搜到
     *     "远程仓库地址","lf" 能搜到 "Git LFS"
     *   · 长词要求出现在单词边界或作为子串出现,避免 "add" 命中 "address" 之类的噪声
     *   · "git" 单独出现时视为无效词(因为每条命令都带它),直接忽略
     */
    search(q) {
      const s = String(q || '').trim().toLowerCase();
      if (!s) return COMMANDS;
      const parts = s.split(/\s+/).filter((p) => p && p !== 'git');
      if (!parts.length) return COMMANDS;

      const scored = [];
      for (const c of COMMANDS) {
        const head = c.cmd.toLowerCase();
        const rest = (' ' + c.desc + ' ' + c.group + ' ' + (c.tags || []).join(' ')).toLowerCase();
        let score = 0;
        let ok = true;

        for (const p of parts) {
          if (head.includes(p)) {
            // 命中命令本身权重最高;越靠前越是"用户想要的那条"
            score += head.startsWith(p) ? 40 : (head.indexOf(p) < 12 ? 24 : 12);
          } else if (rest.includes(p)) {
            score += 6;
          } else {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        // 常用/推荐类的命令在同等匹配下排前面
        const tags = c.tags || [];
        if (tags.includes('最常用')) score += 8;
        if (tags.includes('核心')) score += 5;
        if (tags.includes('推荐')) score += 3;
        if (tags.includes('危险') || tags.includes('禁止')) score -= 2;
        scored.push({ c, score });
      }

      return scored.sort((a, b) => b.score - a.score).map((x) => x.c);
    },
    tutorialById(id) {
      return TUTORIALS.find((t) => t.id === id) || null;
    },
  };
})();
