# Agent 操作记录

只记代码和提交记录里看不出来的东西：线上状态、踩过的坑、没解决的问题。实现细节看 `git log`。

## 生产环境

- 地址 `https://nodetick.ccgslb.workers.dev`，每分钟一次的 Cron 随部署挂载。部署都在本地执行 `pnpm run deploy`，推送到 GitHub 不会触发 Cloudflare 构建。
- D1 `nodetick-db`（`b271ddb8…`）。`wrangler.toml` 不写 `database_id`，部署时沿用线上已有的绑定，输出显示 `env.DB (inherited)`。
- Secret：`SESSION_SECRET`、`VAPID_PRIVATE_KEY`（与本地 `.dev.vars` 是同一副密钥对）。`VAPID_PUBLIC_KEY`、`VAPID_SUBJECT` 是控制台变量，靠 `keep_vars = true` 在部署时保留。
- 注册已关闭，首个注册用户是管理员。
- 版本（新的在前）：`df1dfff6-43e0-434a-98ff-23912c07d2f1`（2026-11-20）、`f1c6aa24-a86c-4e5c-a0bf-fb9a7a84a6f2`（2026-11-19 16:14 UTC，内容没有记录）、`8c5a9f24-a087-4512-b2e5-e417eeb13b51`（2026-11-19）。回滚：`pnpm --filter worker exec wrangler rollback <版本 ID>`。
- 数据备份：`~/nodetick-backups/nodetick-prod-20261119-234132.sql`（权限 600，部署 `8c5a9f24` 前导出）；同一时刻的 D1 Time Travel 书签 `00000e67-00000000-00005128-804ff266f563bf9642e808f3b3ab040e`，恢复用 `pnpm --filter worker exec wrangler d1 time-travel restore nodetick-db --bookmark=<书签>`。

## 坑

- Cloudflare 生产环境的 PBKDF2 迭代上限是 100,000，本地 workerd 允许更高（曾用 600,000，线上注册直接 500 `NotSupportedError`）。哈希存成 `<iterations>$<hex>`，以后改迭代次数不会锁死老用户。
- 注册按 IP 限流（15 分钟 5 次），测试时被 429 挡住可以 `DELETE FROM registration_attempts_ip`。
- `/open/v1/feed.ics` 用查询串里的密钥鉴权，必须挂在 `requireApiToken` 之前，否则一律 401。
- Vite 字符串形式的代理默认 `changeOrigin: true`，Worker 的同源校验会拒绝所有写请求。
- 测 Web Push 要用桌面 Chrome（computer-use 驱动，Agent profile）：内嵌浏览器没接 FCM，`pushManager.subscribe` 抛 `AbortError`。computer-use 点 Chrome 页内弹窗时 AXPress 可能无效，改用坐标点击；密码框 `set_value` 报 `mismatched` 时重新读状态确认。
- 改 `.dev.vars` 后要重启 `wrangler dev`。`wrangler deploy` 偶发 `fetch failed`，重试即可。线上异常用 `pnpm --filter worker exec wrangler tail nodetick --format pretty` 看堆栈。
- worker 测试从 `worker/.dev.vars` 读 `SESSION_SECRET`，缺了大半用例失败；新 worktree 靠 `.worktreeinclude` 复制它。测试输出里的 `deleteAllDurableObjects` 未捕获异常日志一直都有，不影响结果。
- 本地跑 E2E：`pnpm dev --persist-to <临时目录> --port 8788` 起一个空库，先 `POST /api/register` 建账号（harness 只登录不注册），再带上 `NODETICK_SERVER`、`NODETICK_EMAIL`、`NODETICK_PASSWORD` 运行 `pnpm test:e2e`。
- pnpm：`-w` 是 workspace 根目录，不是 npm 的 `--workspace`，选包用 `--filter`；`pnpm --filter worker exec …` 在 `worker/` 下运行，相对路径以它为准；新增带安装脚本的依赖要加进 `pnpm-workspace.yaml` 的 `allowBuilds`，否则安装报 `ERR_PNPM_IGNORED_BUILDS`。
- Claude Code 的 worktree 从 `origin/main` 创建，开工前先 `git fetch`，确认本地 `main` 没有落后（2026-11-19 曾落后 19 个提交）。
- zsh 里 `$VAR:path` 会被当成修饰符（`:w`、`:e` 等），git 引用写成 `"${VAR}:path"`。
- README 截图：本地 `wrangler dev` 临时库加演示账号，Playwright `page.clock` 固定时间避免跨零点；环境没有 emoji 字体，演示数据别用 emoji。

## 遗留问题

- 修改密码只清掉其他会话，API 令牌仍然有效。
- 并发 `POST /task/{id}` 完成同一个重复任务，可能生成两次下一次（`/complete` 已用条件更新防住）。
- `pnpm peers check`：wrangler 要 `@cloudflare/workers-types@^5`，worker 装的是 v4。
- 首页快速开始多了一步 `wrangler d1 create`，首次部署会自动建库。
- Cloudflare 控制台（Git 构建）部署没实际跑过，pnpm 12 经 Corepack 运行这一步未验证。

## 记录

- 2026-09-05：浏览器通知（Web Push + Cron 提醒）、任务置顶、日历订阅 ICS；首次部署到生产。
- 2026-11-19：README 重写；两个子代理在独立 worktree 里分别测试后端/CLI 和网页端并修复；部署配置去掉 `database_id`，本地 D1 文件因此改名，旧文件 `82898e5c…sqlite` 留作备份。
- 2026-11-19（续）：输入校验、倒计时重复规则、每台设备单独开关通知、多语言推送、时间线列出无日期任务、智能清单快速添加；部署 `8c5a9f24`。生产当时没有任务和过滤器，旧版 0–3 优先级不用迁移。
- 2026-11-20：README 截图；修复专注页按钮被裁切、表盘颜色不跟主题。
- 2026-11-20（续）：改用 pnpm 12.21.0，锁文件由 `pnpm import` 生成，直接依赖版本不变（worker 的 vitest 改用 vite 6.4.3，npm 下是 7.3.6）；部署 `df1dfff6`，专注页修复随之上线。
