# Agent 操作记录

## 2026-09-05：实现浏览器通知（Web Push）

本次操作在开发环境完成通知功能，并保留已有测试数据。

### 实现内容

- 在 `worker/schema.sql` 中新增通知设置、浏览器 Push 订阅和发送去重记录表；没有新增迁移文件。
- 新增 `worker/src/routes/notifications.ts`：通知配置、设置、订阅/取消订阅和测试通知接口。
- 新增 `worker/src/services/notifications.ts`：VAPID 推送、任务/习惯/纪念日提醒扫描、过期订阅清理和 D1 去重。
- 在 Worker 中接入每分钟 Cron 调度，并加入 Cloudflare Scheduled Handler。
- 新增 `webapp/public/sw.js` 和 `manifest.webmanifest`，支持后台接收通知、点击通知打开任务详情。
- 新增通知设置界面：权限申请、启停、任务/习惯/纪念日分类、提示音、全天事项时间和测试通知。
- 登出前解除当前浏览器订阅，避免同一浏览器后续使用者收到上一个账号的通知。
- 新增 VAPID 密钥生成脚本 `worker/scripts/generate-vapid.mjs`，并更新部署文档。
- 修复审计日志后台清理 Promise 未捕获导致的测试运行时异常。

### 安全与配置

- VAPID 私钥只写入本地忽略文件或 Cloudflare Secret，不提交到 Git。
- 推送订阅仅接受 HTTPS 公共域名，禁止用户名、密码、localhost、本地域名和 IP 地址。
- 推送请求使用手动重定向模式，不跟随订阅端点返回的重定向。
- 通知接口复用现有会话/API Token 鉴权，并对 JSON 字段进行严格类型检查。
- 生产环境需要配置 `VAPID_PUBLIC_KEY`、`VAPID_SUBJECT` 和 `VAPID_PRIVATE_KEY`；私钥使用 `wrangler secret put`。

### 验证记录

- `npm run type-check`：通过。
- `npm run build`：通过。
- `npm test -w worker`：33/33 通过。
- 通过 Chrome Agent profile 实际完成 Push 订阅。
- 通过本地 Cron 手动触发后，浏览器收到测试通知和任务到时通知。
- 任务通知携带的链接可直接打开对应任务详情。
- 本地开发数据库使用 `CREATE IF NOT EXISTS` 补齐当前 schema，未删除原有测试数据。

## 2026-09-05：任务置顶、日历订阅与生产部署

同日晚些时候完成三个功能并首次部署到 Cloudflare 生产环境。

### 实现内容

- 任务置顶（对齐 TickTick「置顶」）：
  - `tasks` 表新增 `pinned` 列，依赖现有 `ensureSchema` 自愈机制自动补列，无迁移文件。
  - 创建/更新任务接口接受 `pinned`；重复任务生成下一次 occurrence 时克隆该字段。
  - 任务行「…」菜单与详情面板菜单提供 置顶/取消置顶；置顶任务在**所有排序方式**下排到所在分组最前，行尾常显图钉图标。
  - 备份导出/导入的 tasks 列清单同步加入 `pinned`（导入用 `row[col] ?? null`，旧备份缺字段可平滑导入）。
- 日历订阅 ICS Feed（对齐 TickTick「订阅日历」）：
  - `users` 表新增 `feed_token`（32 位随机 hex，懒生成）。
  - 新增 `GET /open/v1/feed.ics?token=<密钥>`：外部日历客户端无 Cookie/Bearer 轮询订阅；返回 `text/calendar`。
  - `GET /api/feed` 查询/生成令牌，`POST /api/feed/regenerate` 轮换（旧链接立即失效，写审计日志 `feed.regenerate`）。
  - 「API 令牌」页新增日历订阅区块：完整链接、复制、重新生成。
  - ICS 渲染抽为共享模块 `worker/src/ics.ts`，会话下载 `/api/export/calendar.ics` 复用；修正全天事件 `DTEND` 为非包含的次日（RFC 5545）。
- 落地页清理遗留的「邀请码注册」文案，改为「首个注册用户即管理员」。

### 关键实现要点（坑）

- **Cloudflare 生产 runtime 的 PBKDF2 迭代上限是 100,000**：本地 workerd 允许更高（曾用 600,000，本地登录正常、线上注册直接 500 `NotSupportedError`）。现已改为 100,000，并且哈希格式改为自带迭代次数的 `<iterations>$<hex>`，`verifyPassword` 按存储值里的次数校验（旧纯 hex 哈希回退到当前常量），以后调整迭代数不会锁死老用户。
- **注册接口有 IP 限流（15 分钟 5 次）**：测试注册连续失败几次后会被 429 挡住，开发时可 `DELETE FROM registration_attempts_ip` 清掉（生产同理，但先确认不是真实攻击）。
- **路由挂载顺序**：`/open/v1/feed.ics` 必须挂在 token 鉴权子应用（`requireApiToken`）**之前**，否则会被 401 拦截——feed 用查询串密钥鉴权，日历客户端带不了 Bearer。
- **IAB 内嵌浏览器无法订阅 Web Push**：`pushManager.subscribe` 抛 `AbortError: push service not available`，因为 webview 没接 FCM。真实订阅测试必须用桌面 Chrome（computer-use 驱动），登录 → 弹窗开关 → 浏览器原生权限框点「允许」→ 订阅成功。
- computer-use 对 Chrome 页面内嵌弹窗元素的无障碍按压（AXPress）可能不生效，改用当前帧坐标点击即可。
- `wrangler dev` 改 `.dev.vars` 后必须重启才生效；`wrangler deploy` 偶发 `fetch failed`（代理/网络抖动），重试即可。
- 密码框类元素 `set_value` 回执可能报 `mismatched`，重新 `get_app_state` 确认实际已写入。
- 线上排错用 `npx wrangler tail nodetick --format pretty` 复现一次请求就能拿到未捕获异常的堆栈（本次 PBKDF2 问题即靠它 30 秒定位）。

### 生产部署与配置

- `wrangler.toml` 填入真实 `database_id`（账号下已有的空库 `nodetick-db`）和 `VAPID_PUBLIC_KEY`、`VAPID_SUBJECT`（vars）。
- `npx wrangler deploy` 发布到 `https://nodetick.ccgslb.workers.dev`，每分钟 Cron 已随部署挂载。
- `wrangler secret put` 写入 `VAPID_PRIVATE_KEY`（与本地 `.dev.vars` 同一副密钥对）和 `SESSION_SECRET`（随机 37 字符）。
- 生产库为空库时注册开放：**首个注册用户即管理员，之后注册自动关闭**；部署完成后应立即注册管理员账号。

### 验证记录

- `npm run type-check` 通过；`npm test -w worker` 60/60 通过（新增置顶、日历订阅两组用例）。
- 浏览器实测置顶：置顶 → 分组顶部 + 已置顶图标；取消置顶恢复；刷新后状态保持；详情菜单同样生效。
- 浏览器实测订阅链接：设置页显示并复制订阅 URL，curl 返回合法 `text/calendar`（含全天事件 DTSTART/DTEND 次日）。
- Web Push 端到端（真 Chrome）：订阅成功（已开启 · 1 台设备）→ 发送测试通知 → Windows 系统气泡弹出「NodeTick 通知测试 / 通知功能已经连接成功」，链路 FCM → sw.js → 系统通知全部打通。
- 生产冒烟：`/` 200；`/api/register/status` 返回 `{"open":true}`；坏 token 访问 `/open/v1/feed.ics` 403；无会话访问 `/api/export/calendar.ics` 401。
- `.dev.vars` 在 `.gitignore` 第 4 行，私钥不会进 Git。

## 2026-11-19：README 重写、全功能测试与修复

本次在本地开发环境完成，未部署、未提交。两个子代理在独立 git worktree 中并行测试（后端/CLI 与网页端），各自使用独立端口和本地 D1，修复后合并回工作区。

### 实现内容

- README 重写：导航、Mermaid 架构图、分步部署、配置项表、可折叠 API 参考；并按代码修正（CLI 未发布到 npm、`wrangler d1 export` 需要 `--remote --output`、`SESSION_SECRET` 是所有登录的前提、本地开发需要 `worker/.dev.vars`）。
- 部署：`npm run deploy` 先构建网页应用；`wrangler.toml` 去掉 `database_id` 和 VAPID 变量，加 `keep_vars = true`（部署时沿用线上已绑定的 `nodetick-db` 和线上变量）；`.sql` 规则加 `fallthrough = false` 消除警告。
- 新增 `.worktreeinclude`（把 `worker/.dev.vars` 复制进新 worktree），`.gitignore` 忽略 `.claude/worktrees/`。
- 后端/CLI 修复（分支 `agent/api-cli-fixes`，13 个提交）：导入他人备份会把对方数据移到自己账号（严重）；重复完成任务会重复生成下一次；全天提醒按 UTC 零点触发、`TRIGGER:PT0S` 被忽略；推送订阅可用 `localhost.` 绕过检查；OAuth 授权页 CSP `form-action` 拦截回调重定向（Chrome 下 `nodetick auth login` 卡住）；大小写不同的标签改名/删除/筛选失效；批量移动出错时已部分生效；专注记录超过 5000 条后查询全部 413；ICS 出现裸 CR；CLI 数值参数写错被静默忽略、配置文件创建时短暂可读、E2E 只能在 Windows 上运行。
- 网页端修复（分支 `agent/webapp-fixes`，22 个提交）：开发代理导致所有写请求 403；优先级统一为 TickTick 的 0/1/3/5；专注记录时间按瞬时解析、以本地时间显示，DST 后历史为空；快速连续编辑子任务/标签丢失；输入法回车误提交；顺延丢失时间；倒计时"下一步"直接保存、重复倒计时天数错误；搜索结果点击无效；深色主题文字不可读；手机宽度下任务列表为 0；键盘焦点不可见；Escape 关闭对话框；回收站勾选报 404；按路由懒加载（落地页 610 KB → 257 KB）。
- OAuth 授权页「取消」改为带 `error=access_denied` 回到 CLI 回调；授权页加 favicon。
- 修复按写死日期断言的快速添加测试。

### 关键实现要点（坑）

- 本地 `main` 当时落后 `origin/main` 19 个提交，而 Claude Code 的 worktree 基于 `origin/main` 创建；已快进到 `0ccd713` 再合并。
- 去掉 `database_id` 后，本地 `wrangler dev` 的 D1 文件 key 从占位符变为 binding 名 `DB`；已把原本地库 `82898e5c…sqlite` 复制为 `e7352547…sqlite`，原文件保留作备份。
- wrangler 4.127 的 D1 自动关联顺序：沿用线上 Worker 已有绑定 → 按 `database_name` 查找 → 都没有才创建（读源码确认，未实际部署）。
- Vite 字符串形式的代理默认 `changeOrigin: true`，会让 Worker 的同源校验拒绝所有写请求。
- zsh 中 `$VAR:path` 会被当成修饰符（如 `:w`、`:e`），git 引用要写成 `"${VAR}:path"`。

### 待决定

- 旧版网页端按 0–3 存的优先级（高 = 3）现在显示为「中」。如需迁移线上数据：`UPDATE tasks SET priority = CASE priority WHEN 3 THEN 5 WHEN 2 THEN 3 ELSE priority END WHERE priority IN (2,3);`。只在没有人通过 CLI/API 设过「中」(3) 时执行；已保存过滤器的 priorities 同理。
- 未修复：修改密码后 API 令牌仍有效；并发 `POST /task/{id}` 完成重复任务仍可能生成两次；输入校验偏宽松；每月 29–31 日的倒计时跳过短月，1 月 1–3 日的年度倒计时缺「提前 3 天」提醒；时间线视图不显示无日期任务；今天/明天/最近 7 天没有快速添加；在一台设备上关闭通知会关掉所有设备。

### 验证记录

- `npm test -w worker` 73/73；`npm test -w webapp` 109/109；`npm run type-check` 通过；`npm run build` 通过。
- E2E（本地 `wrangler dev`，临时存储）78/78。
- Playwright 冒烟：登录、快速添加（`!3` 存为 5、标签保留大小写、「明天」为全天）、大小写标签页、390 px 手机布局、OAuth 授权与取消都正确回调，无控制台错误。
- `wrangler deploy --dry-run` 通过（`env.DB (nodetick-db)`）。

## 2026-11-19（续）：输入校验、提醒与通知修复，部署到生产

用户授权直接操作生产数据并部署。

### 实现内容

- 输入校验：新增 `parseApiDate`（只接受真实日历日期，格式 `yyyy-MM-dd[THH:mm[:ss]][Z|±HH:mm|±HHmm]`）和 `nonStringField`；任务、评论、清单/分组/看板列、习惯、标签、过滤器的字符串字段类型错误返回 400（原来对象会被存成 `"[object Object]"`），`2026-02-30` 之类的日期不再被 `Date.parse` 顺延成 3 月 2 日；任务 `priority` 只接受 0–5 的整数，`isAllDay` 必须是布尔值，标签/提醒数组元素必须是字符串；专注记录时间同样做日历校验。清单 `viewMode` 只校验类型（网页端还在用 `grid`）。
- 倒计时重复：`countdownFallsOn` 按「今天 + 提前天数」匹配，每月 29–31 日遇到小月在月末提醒、2 月 29 日的每年重复平年在 2 月 28 日提醒、1 月初的「提前 3 天」能跨年触发，重复不会早于原始日期。网页端 `nextOccurrence` 原本就按月末截断，两边一致。
- 每台设备单独开关通知：开关只订阅/取消当前浏览器，不再把账号级 `enabled` 改成关闭；对话框显示「此设备未开启 · 其他 N 台设备已开启」；当前设备已订阅但账号级开关是旧版遗留的关闭状态时自动修复为开启。
- 推送文案多语言：`push_subscriptions` 新增 `lang`（默认 `zh`，靠 `ensureSchema` 自动补列）；订阅时网页端带上界面语言，旧客户端按 `Accept-Language` 推断；切换界面语言时重新登记当前设备；服务端按每个订阅的语言选择文案，测试通知同理；`sw.js` 的兜底文案也按浏览器语言选择。
- 时间线视图下方列出无日期任务，点击打开详情设日期。
- 「今天」「明天」「最近 7 天」显示快速添加，任务进入收集箱并预设今天/明天/今天；输入中的日期优先。

### 生产部署记录

- 部署前生产数据：1 个用户、1 个清单、1 个习惯，任务和过滤器都是 0 条，所以优先级迁移没有可改的数据，未执行。
- 备份：`~/nodetick-backups/nodetick-prod-20261119-234132.sql`（权限 600）；D1 Time Travel 书签 `00000e67-00000000-00005128-804ff266f563bf9642e808f3b3ab040e`，回滚命令 `npx wrangler d1 time-travel restore nodetick-db --bookmark=<书签> -c worker/wrangler.toml`。
- `npm run deploy` 发布版本 `8c5a9f24-a087-4512-b2e5-e417eeb13b51`；去掉 `database_id` 后 wrangler 显示 `env.DB (inherited)`，仍绑定 `b271ddb8…`；`keep_vars` 保住了线上的 `VAPID_PUBLIC_KEY`、`VAPID_SUBJECT`。
- 部署后：`push_subscriptions.lang` 已自动补列，数据行数不变；`/` 200、`/api/register/status` 为 `{"open":false}`、无会话访问受保护接口 401、坏 feed 令牌 403、`/oauth/authorize` 未登录跳转登录页。

### 验证记录

- `npm test -w worker` 80/80；`npm test -w webapp` 110/110；`npm run type-check`、`npm run build` 通过；E2E 78/78。
- Playwright 冒烟：三个智能清单的快速添加日期正确且输入日期优先；时间线列出无日期任务并能打开详情；通知对话框在「无设备」和「其他设备已开启」两种状态下文案和可用性正确；无控制台错误。

## 2026-11-20：README 截图与专注页布局修复

- 新增 `docs/screenshots/`（任务列表与详情、日历月视图、四象限、习惯、专注深色主题，1280×800 PNG，共约 435 KB），README 顶部放主图，「功能」下放 2×2 截图表。截图用本地 `wrangler dev` 的临时库和演示账号拍摄，浏览器时钟用 Playwright `page.clock` 固定在 2026-11-20 15:30，避免跨零点；环境没有 emoji 字体，演示数据不用 emoji 图标。
- 修复专注页两个问题（尚未部署到生产，需要 `npm run deploy`）：
  - 开始/暂停/继续/结束按钮原来用 `top-[717px]` 绝对定位，在高度约 800px 的窗口里被 `overflow-hidden` 裁掉、无法点全；现在按钮回到正常文档流，间距和表盘尺寸用 `clamp()`/`min()` 随视口高度缩放，720px 高度下暂停态的两个按钮也完整可见。
  - 表盘刻度和圆环写死了 `rgba(20,20,20,0.1)` 和 `#4772fa`，深色主题下圆环看不见、紫/绿主题下进度色不跟随；改用 `var(--color-ink)`（低不透明度）和 `var(--color-tt)`。
- 验证：`npm test -w webapp` 110/110，`npm run type-check` 通过；Playwright 在 1280×800、1280×720 下检查空闲、计时、暂停三种状态的按钮都在可视区内。

## 2026-11-20（续）：改用 pnpm 管理依赖

- 包管理器换成 pnpm 12.21.0，由根 `package.json` 的 `packageManager` 固定（Cloudflare Workers Builds 通过 Corepack 读取这个字段）。删除 `package-lock.json` 和 npm 装的 `node_modules`，workspaces 移到 `pnpm-workspace.yaml`，不保留 npm 兼容。
- `pnpm-lock.yaml` 用 `pnpm import` 从旧锁文件生成，直接依赖版本不变；少数间接依赖升了补丁版本，worker 的 vitest 改用 webapp 已有的 vite 6.4.3（npm 下是 7.3.6）。
- pnpm 默认拒绝依赖的安装脚本，未列出就报 `ERR_PNPM_IGNORED_BUILDS`；`allowBuilds` 只放行 esbuild 和 workerd。fsevents 的 tarball 里没有安装脚本，不用列（用 `supportedArchitectures` 模拟 macOS/Windows 安装验证过）。
- 命令对照（前面记录里的 npm 命令按此换算）：`npm run X -w pkg` → `pnpm --filter pkg X`（pnpm 的 `-w` 是 workspace 根目录，不是 npm 的 `--workspace`）；`npx wrangler … -c worker/wrangler.toml` → `pnpm --filter worker exec wrangler …`（在 `worker/` 下运行，相对路径以 `worker/` 为准）；`npm link -w cli` → `pnpm add -g ./cli`（需先 `pnpm setup`）；部署写 `pnpm run deploy`。
- E2E 的 `buildCli()` 改为通过 shell 运行 `pnpm --filter cli build`：pnpm 12 是原生二进制，`npm_execpath` 不再是能交给 node 执行的 JS 文件。
- Node 要求改为 22+：wrangler 4.127 要求 `>=22.0.0`，原来写的 20+ 已不准确。
- 验证：`pnpm type-check`、`pnpm build` 通过；`pnpm test` 中 worker 80/80、webapp 110/110；`wrangler deploy --dry-run` 通过；E2E（本地 `pnpm dev`，临时存储）78/78。
- 遗留：`pnpm peers check` 提示 wrangler 需要 `@cloudflare/workers-types@^5`，worker 装的是 v4（npm 下同样如此，只是不提示）；worker 测试输出里的 `deleteAllDurableObjects` 未捕获异常日志在 npm 基线上也有，不影响结果。
