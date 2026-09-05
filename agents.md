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
