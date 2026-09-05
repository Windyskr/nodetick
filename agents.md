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

- **路由挂载顺序**：`/open/v1/feed.ics` 必须挂在 token 鉴权子应用（`requireApiToken`）**之前**，否则会被 401 拦截——feed 用查询串密钥鉴权，日历客户端带不了 Bearer。
- **IAB 内嵌浏览器无法订阅 Web Push**：`pushManager.subscribe` 抛 `AbortError: push service not available`，因为 webview 没接 FCM。真实订阅测试必须用桌面 Chrome（computer-use 驱动），登录 → 弹窗开关 → 浏览器原生权限框点「允许」→ 订阅成功。
- computer-use 对 Chrome 页面内嵌弹窗元素的无障碍按压（AXPress）可能不生效，改用当前帧坐标点击即可。
- `wrangler dev` 改 `.dev.vars` 后必须重启才生效；`wrangler deploy` 偶发 `fetch failed`（代理/网络抖动），重试即可。
- 密码框类元素 `set_value` 回执可能报 `mismatched`，重新 `get_app_state` 确认实际已写入。

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
