# Agent 操作记录

只记代码和提交记录里看不出来的东西：线上状态、踩过的坑、没解决的问题。实现细节看 `git log`。

## 生产环境

- 地址 `https://nodetick.ccgslb.workers.dev`，每分钟一次的 Cron 随部署挂载。部署都在本地执行 `pnpm run deploy`，推送到 GitHub 不会触发 Cloudflare 构建。
- D1 `nodetick-db`（`01623c4d-ce1c-47e2-aae5-d5c187974719`），2026-11-20 建在 APAC，实际在香港（`served_by_colo` 为 HKG）。本机连 Cloudflare 走东京（NRT），每次查询约 50ms。原来的库（`b271ddb8…`，在美西 SJC，每次约 130ms）已在迁移时删除。`wrangler.toml` 不写 `database_id`，部署时沿用线上绑定（`env.DB (inherited)`）。
- 沿用绑定的条件是配置里的 `database_name` 和线上库同名（wrangler `D1Handler.canInherit`，4.165 起还比较 jurisdiction，本项目没设）；不同名时会按名字找库，找不到还会新建一个空库。所以生产库必须一直叫 `nodetick-db`。
- 账号的 D1 库数量已到免费套餐上限 10 个（其余 9 个属于别的项目，不要动），临时库也建不了。
- 2026-11-20 生产数据：1 个用户、0 个任务、0 个推送订阅，库约 283 kB。迁移前 97% 的读取（每天约 4.7 万行）来自每次请求都跑的表结构检查（`sqlite_master` 64 行）；现在每个实例只读 `schema_meta` 一行。看 D1 消耗：`pnpm --filter worker exec wrangler d1 info nodetick-db`、`… d1 insights nodetick-db --sort-by reads`。
- Secret：`SESSION_SECRET`、`VAPID_PRIVATE_KEY`（与本地 `.dev.vars` 是同一副密钥对）。`VAPID_PUBLIC_KEY`、`VAPID_SUBJECT` 是控制台变量，靠 `keep_vars = true` 在部署时保留。
- 注册已关闭，首个注册用户是管理员。
- 版本（新的在前）：`5b137473-baae-4775-840b-a07f4b28f639`（2026-11-20，提交 `dab787f`，wrangler 4.165.0，D1 沿用香港库）、`0ee94213-982d-461c-a5f5-dd343a6b569d`（2026-11-20，第一次绑定香港新库，部署时代码未提交，内容同 `3e35189`）、`df1dfff6-43e0-434a-98ff-23912c07d2f1`（2026-11-20）、`f1c6aa24-a86c-4e5c-a0bf-fb9a7a84a6f2`（2026-11-19 16:14 UTC，内容没有记录）、`8c5a9f24-a087-4512-b2e5-e417eeb13b51`（2026-11-19）。
- 回滚：可以 `wrangler rollback` 到 `0ee94213` 及之后的版本（都绑定香港库）；更早的版本绑定着已删除的旧库，**不能**回滚到它们。要退回旧代码，就检出旧提交后正常 `pnpm run deploy`，绑定会沿用新库（旧代码兼容新增的表和索引）。
- 数据备份（都在 `~/nodetick-backups/`，权限 600）：`nodetick-prod-20261120-110400.sql`（迁移前最后一份，导入新库前在本地导入并验证过），更早的 `…20261119-234132.sql`、`…20261120-001341.sql`。旧库的 Time Travel 书签随旧库删除已失效；新库的 Time Travel 从 2026-11-20 起算，恢复用 `pnpm --filter worker exec wrangler d1 time-travel restore nodetick-db --bookmark=<书签>`。

## 坑

- Cloudflare 生产环境的 PBKDF2 迭代上限是 100,000，本地 workerd 允许更高（曾用 600,000，线上注册直接 500 `NotSupportedError`）。哈希存成 `<iterations>$<hex>`，以后改迭代次数不会锁死老用户。
- 注册按 IP 限流（15 分钟 5 次），测试时被 429 挡住可以 `DELETE FROM registration_attempts_ip`。
- `/open/v1/feed.ics` 用查询串里的密钥鉴权，必须挂在 `requireApiToken` 之前，否则一律 401。
- Vite 字符串形式的代理默认 `changeOrigin: true`，Worker 的同源校验会拒绝所有写请求。
- 测 Web Push 要用桌面 Chrome（computer-use 驱动，Agent profile）：内嵌浏览器没接 FCM，`pushManager.subscribe` 抛 `AbortError`。computer-use 点 Chrome 页内弹窗时 AXPress 可能无效，改用坐标点击；密码框 `set_value` 报 `mismatched` 时重新读状态确认。
- D1 每次请求的查询数有上限：D1 文档写免费套餐 50 次（Workers 限额页写内部服务子请求 1,000），一次 `db.batch()` 只算一次。随数据量增长的写入用 `db.ts` 的 `runBatches`；本地不执行这个上限，`api.test.ts` 的 `countingWorker` 按同样口径数查询。
- D1 免费套餐每天 500 万行读取，2026-09-01 起超额后查询直接失败；按扫描行数计，不是返回行数。每分钟的 Cron 尤其要走索引：提醒扫描用部分索引 `idx_tasks_reminders`（`INDEXED BY` 写死），改那条查询时 WHERE 里要保留索引的三个条件。查询计划用 `EXPLAIN QUERY PLAN` 看，`api.test.ts` 里有断言。
- 表结构检查（`ensureSchema`）每个 Worker 实例只跑一次，平时只读 `schema_meta` 一行：里面存的是 `schema.sql` 的指纹，改了 `schema.sql` 指纹就变，部署后自动补表、补列、补索引。手动改坏表结构时指纹不会变，等查询报 `no such table/column` 时会强制全量检查一次。
- 每次往返都按 ~130ms 算（见生产环境）：写入后用 `RETURNING *`，不要再 SELECT 一遍；几条互不依赖的语句放进一个 `db.batch()`。`api.test.ts` 的「hot paths」测试固定了网页端常用接口的往返次数。
- 本地测 Microsoft To Do 导入：`pnpm dev … --var MS_TODO_CLIENT_ID:<任意 GUID>` 打开开关；假 ID 会让微软返回 AADSTS700038，能看到真实的错误链路。完整流程用 Playwright `page.route` 拦截 `/api/import/microsoft/device`、`/token` 和 `https://graph.microsoft.com/**`（要回 CORS 头并应答 OPTIONS），`/tasks` 走真实 Worker。
- 改 `.dev.vars` 后要重启 `wrangler dev`。`wrangler deploy` 偶发 `fetch failed`，重试即可。线上异常用 `pnpm --filter worker exec wrangler tail nodetick --format pretty` 看堆栈。
- worker 测试从 `worker/.dev.vars` 读 `SESSION_SECRET`，缺了大半用例失败；新 worktree 靠 `.worktreeinclude` 复制它。测试输出里的 `deleteAllDurableObjects` 未捕获异常日志一直都有，不影响结果。
- 本地跑 E2E：`pnpm dev --persist-to <临时目录> --port 8788` 起一个空库，先 `POST /api/register` 建账号（harness 只登录不注册），再带上 `NODETICK_SERVER`、`NODETICK_EMAIL`、`NODETICK_PASSWORD` 运行 `pnpm test:e2e`。
- 项目用的 wrangler 是 `worker` 的本地开发依赖，`pnpm run deploy` 和 `pnpm --filter worker exec wrangler …` 都走它；全局 `npm i -g wrangler` 不影响部署。升级时 wrangler、`@cloudflare/vitest-pool-workers`、`@cloudflare/workers-types` 一起升（wrangler 对 workers-types 有 peer 要求），升完跑 `pnpm peers check`。
- pnpm 12 不装发布不满一天的版本（`minimumReleaseAge`）。`pnpm add` 指定了这样的版本时，会往 `pnpm-workspace.yaml` 写 `minimumReleaseAgeExclude`，不要提交，换一个早一点的版本。`@cloudflare/workers-types` 每天都发新版，最容易碰上。
- pnpm：`-w` 是 workspace 根目录，不是 npm 的 `--workspace`，选包用 `--filter`；`pnpm --filter worker exec …` 在 `worker/` 下运行，相对路径以它为准；新增带安装脚本的依赖要加进 `pnpm-workspace.yaml` 的 `allowBuilds`，否则安装报 `ERR_PNPM_IGNORED_BUILDS`。
- Claude Code 的 worktree 从 `origin/main` 创建，开工前先 `git fetch`，确认本地 `main` 没有落后（2026-11-19 曾落后 19 个提交）。
- zsh 里 `$VAR:path` 会被当成修饰符（`:w`、`:e` 等），git 引用写成 `"${VAR}:path"`。
- README 截图：本地 `wrangler dev` 临时库加演示账号，Playwright `page.clock` 固定时间避免跨零点；环境没有 emoji 字体，演示数据别用 emoji（倒数纪念日的默认图标也是 emoji，要显式给 `♥`、`★` 这类符号）。已完成的历史任务用 `POST /open/v1/backup/import` 写入，才能带上过去的 `completed_time`。
- README 有中文 `README.md`（默认）和英文 `README.en.md` 两份，结构逐节对应、截图共用（中文界面）；改一份要同步另一份。
- `schema.sql` 里不要写注释：`ensureSchema` 按 `;` 切分语句再逐条建表、补列、补索引，注释会混进语句里。`ADD COLUMN … NOT NULL` 必须带 `DEFAULT`，否则老库补列失败。
- 农历换算表有两份：`worker/src/lunar.ts`（Cron 提醒）和 `webapp/src/lib/lunar.ts`（界面），改一份要同步另一份。不要改用 `Intl` 的 `ca-chinese`：新月落在午夜前后几分钟时 ICU 会差一天，逐日扫描也超出 Cron 的 CPU 预算。
- 倒计时提醒的 Cron 查询用部分索引 `idx_countdowns_reminders`（`INDEXED BY` 写死），改查询时 WHERE 里要保留索引的两个条件，和任务提醒的 `idx_tasks_reminders` 一样。
- `pnpm test:web` 会先构建网页应用；手动用 `wrangler dev` 看改动时，重新构建后要重启 `wrangler dev` 才会提供新文件。
- Playwright 驱动富文本编辑器：按 End 或 Ctrl+End 后等约 100ms 再输入，ProseMirror 是异步移动光标的。
- 停本地服务按 PID 杀（`ps aux | grep '[w]rangler dev --port 8797'`），`pkill -f '<命令行>'` 会匹配到执行它的 shell 本身。
- 摘要页的设置、模板和编辑中的草稿都存在服务端（`summary_state`、`summary_templates`）；草稿按「设置 + 当时的日期范围」做键，换了范围就显示按任务生成的内容，原草稿留在库里直到被覆盖。

## 遗留问题

- 修改密码只清掉其他会话，API 令牌仍然有效。
- 并发 `POST /task/{id}` 完成同一个重复任务，可能生成两次下一次（`/complete` 已用条件更新防住）。
- 首页快速开始多了一步 `wrangler d1 create`，首次部署会自动建库。
- Cloudflare 控制台（Git 构建）部署没实际跑过，pnpm 12 经 Corepack 运行这一步未验证。
- 网页每次打开都加载全部已完成任务。几千个时，单个请求的序列化约 4ms（Node 粗测 3,000 个任务），加上 D1 结果解析，冷实例接近免费套餐每次 10ms 的 CPU 上限；真遇到再把已完成任务改为按需加载。
- `/task/move` 每个任务要 3–8 次查询，一次请求移动较多任务会超过 50 次的上限（CLI 一次只移一个，网页的批量移动走 `POST /task/{id}`）。
- Microsoft To Do 导入没用真实微软账号跑过：代码已随 `0ee94213` 上线，但还没注册 Entra 应用、`MS_TODO_CLIENT_ID` 未设置，所以界面显示「未配置」。任务列表上的 `$expand=checklistItems,linkedResources` 是 Graph 文档没写的用法，被拒（400）时前端自动退回只展开 `checklistItems`；如果两种都不行，步骤导入会失败，需要改成逐个任务读取。
- 摘要的专注时长来自 `/focus/stats`，时间范围超过 371 天（自定义的长范围）时不显示专注时长。导出图片靠 SVG `foreignObject` 画到 canvas，Safari 可能拒绝导出（会提示「此浏览器无法生成图片」），PDF 和复制不受影响。

## 记录

- 2026-09-05：浏览器通知（Web Push + Cron 提醒）、任务置顶、日历订阅 ICS；首次部署到生产。
- 2026-11-19：README 重写；两个子代理在独立 worktree 里分别测试后端/CLI 和网页端并修复；部署配置去掉 `database_id`，本地 D1 文件因此改名，旧文件 `82898e5c…sqlite` 留作备份。
- 2026-11-19（续）：输入校验、倒计时重复规则、每台设备单独开关通知、多语言推送、时间线列出无日期任务、智能清单快速添加；部署 `8c5a9f24`。生产当时没有任务和过滤器，旧版 0–3 优先级不用迁移。
- 2026-11-20：README 截图；修复专注页按钮被裁切、表盘颜色不跟主题。
- 2026-11-20（续）：改用 pnpm 12.21.0，锁文件由 `pnpm import` 生成，直接依赖版本不变（worker 的 vitest 改用 vite 6.4.3，npm 下是 7.3.6）；部署 `df1dfff6`，专注页修复随之上线。
- 2026-11-20（续）：Microsoft To Do 导入（设备码登录由 Worker 转发，浏览器直接读 Graph，按清单分批写入；id 由用户 id 和 Graph id 哈希得出，重复导入只加新任务）。本地用 Playwright 模拟微软响应走通全流程，未部署。
- 2026-11-20（续）：重复规则支持「第 N 个 / 最后一个周几」（`BYDAY=2TU`、`BYSETPOS`）、多值和负数 `BYMONTHDAY`、`UNTIL`、`COUNT`（生成下一次时扣减），网页显示对应文字。按个位数用户做了一轮省资源：表结构检查每实例一次；两个任务索引，Cron 只读有提醒的未完成任务；标签改名/删除、备份导入、标签登记改批量，习惯打卡一条查询；令牌使用时间至多每小时写一次；投递记录每小时清理一次；网页批量操作不再整页刷新；带哈希的静态文件长期缓存。未部署；上线后首次请求会给生产库补建两个索引。
- 2026-11-20（续）：按生产数据再优化一轮：表结构检查改为读 `schema_meta` 一行；新建/保存/完成/删除任务、清单列表、`/api/me`、习惯打卡、看板数据、清单增删改都压到 1–2 次往返（`RETURNING`、`db.batch`、子任务列表用 SQL JSON 函数改）；网页启动时 `/api/me` 与数据并行加载。未部署，数据库也还在 WNAM。
- 2026-11-20（续）：部署 `0ee94213`（To Do 导入、重复规则、两轮性能优化），同时把 D1 从美西迁到香港：导出 → 本地导入并用新代码验证 → 删除旧库 → 以 `--location apac` 新建同名库 → 导入 → 临时写入 `database_id` 部署一次后改回。中断约 3 分钟；17 行数据全部核对一致，部署后第一个请求自动补上 `schema_meta` 和两个索引。
- 2026-11-20（续）：worker 的 wrangler 4.127.1 → 4.165.0，`@cloudflare/vitest-pool-workers` 0.22 → 0.23，`@cloudflare/workers-types` v4 → v5（5.20261119.1）；`pnpm peers check` 无告警，类型检查、全部测试、`wrangler deploy --dry-run` 和本地冒烟都通过。随后用 4.165.0 部署 `5b137473`：不写 `database_id` 也正确沿用了香港库（`env.DB (inherited)`，版本详情里的 id 为 `01623c4d…`），Cron 正常。
- 2026-11-20（续）：本地 `main` 按路线图逐项提交（未推送、未部署）：搜索筛选与保存为过滤器、出错 / 离线状态和浏览器 E2E、TickTick 备份导入、统计页、快速添加识别时间与重复、快捷键、倒数纪念日（农历、提前提醒、样式、归档）、嵌套标签、习惯（重复规则、多次打卡、历史统计）、每日提醒、专注（正计时、完整记录、统计）、富文本描述（TipTap + 自写 Markdown 层）、摘要（模板、草稿、导出）；放弃任务也记 `completedTime`；看板卡片标题换行，笔记不再显示勾选框；E2E 增加摘要流程和对话框文案检查。路线图全部完成。部署后首个请求会补建 `summary_state`、`summary_templates`、`focus_records.added` 等新表、列和索引。
