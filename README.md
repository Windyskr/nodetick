# NodeTick 🐘

**完全跑在 Cloudflare 上的自托管 TickTick 兼容任务服务器，带网页应用和配套 CLI。**

正如 [NodeWarden](https://github.com/shuaiplus/nodewarden) 之于 Bitwarden，NodeTick 之于 TickTick：你自己的任务/清单/习惯/专注后端，部署在 Cloudflare Workers + D1 上，实现与官方 [@ticktick/ticktick-cli](https://www.npmjs.com/package/@ticktick/ticktick-cli) 相同的 Open API v1 接口面，外加一个 TickTick 风格的 **React 网页应用**（任务、四象限矩阵、习惯、番茄专注、倒计时）和配套的 `nodetick` CLI。

无需服务器、无需维护数据库、无流量费，免费套餐即可运行。

```
┌────────────┐   session cookie / Bearer      ┌──────────────────────────┐
│ 网页应用    │ ─────────────────────────────► │  Cloudflare Worker       │
│ (React SPA)│        /open/v1/* JSON         │  ├─ Open API v1 (Hono)   │
┌────────────┐   OAuth PKCE / Bearer token    │  ├─ /api/*（会话 JSON）   │
│ nodetick   │ ─────────────────────────────► │  ├─ OAuth PKCE + 令牌    │
│ CLI        │        /open/v1/* JSON         │  └─ 静态资源（SPA）       │
└────────────┘                                │  Cloudflare D1 (SQLite)  │
┌────────────┐                                └──────────────────────────┘
│ 任意 HTTP  │
│ 客户端      │
└────────────┘
```

## 与 `ticktick-cli` 的功能对齐

官方 CLI 的每个命令都能对 NodeTick 使用：

| 领域      | 端点                                                                                       |
| --------- | ------------------------------------------------------------------------------------------ |
| 任务      | get / create / update / complete / delete / move / completed / filter / search、评论（增删查）、子任务、父子任务、标签、提醒、重复规则、专注汇总 |
| 清单      | 增删改查、`data`（清单+任务+看板列）、分组（文件夹）、看板列                                  |
| 标签      | list / create（任务标签自动回填）                                                            |
| 习惯      | get / list / create / update / checkin（按日期 upsert）/ checkins 范围查询                    |
| 专注      | get / list（强制 30 天窗口）/ create / delete，番茄 + 计时两种类型                            |
| 倒计时    | list / create / update / delete（list 对齐官方只读 API；写入为 NodeTick 扩展）                |

认证方式也一致：**OAuth PKCE**（`nodetick auth login`，含浏览器授权页）和**手动令牌**（`nodetick auth token`，令牌在 Web 控制台创建）。

## 仓库结构

```
worker/   Cloudflare Worker：Open API v1 + /api/* 会话端点 + OAuth PKCE（Hono + D1）
webapp/   React SPA，由 Worker 以静态资源方式托管（Vite + Tailwind + zustand）
cli/      NodeTick CLI（commander，命令面与 ticktick-cli 对齐）
tests/    E2E 套件：CLI 对真实服务器
```

## 网页应用

Worker 在 `/` 托管 SPA（`webapp/` 构建为静态资源，SPA 回退）：

- **中英双语** —— 跟随浏览器语言，头像菜单可切换（按浏览器记忆）
- **落地页**（仿 ticktick.com 风格）+ 登录 / 注册（第一个用户 = 管理员；之后可选邀请码）
- **任务**：智能清单（所有 / 今天 / 最近 7 天 / 收集箱）、清单与分组、标签、**智能快速添加**（`#标签`，`~今天/~明天/~周五/~9月5日` 日期，`!1 !2 !3` / `!高 !中 !低` 优先级）、过期一键顺延、**行内悬停快捷设日期**、行菜单复制 / 移动 / 删除、提醒-重复-描述角标、**撤销 toast**、已完成"查看更多"、详情面板（描述 / 子任务 / 标签 / 评论）、清单视图与看板视图、**全文搜索**
- **日历**：年 / 月 / 周 / 日 / 日程 / 3日 / 2周视图 + 迷你月历导航 —— 任务按日期与时间段展示，拖拽到其他日期即可改期，格子内 `+` 直接新建带日期任务
- **外观主题**：头像菜单可切换蓝、紫、绿和深色主题，偏好保存在浏览器本地
- **浏览器通知**：Web Push 推送任务、习惯和纪念日提醒；支持多设备、分类开关、全天提醒时间、测试通知和点击直达
- **四象限矩阵**（按优先级）、**习惯**（7 天打卡条 + 连胜）、**番茄专注**（计时器 + 周统计）、**倒计时**、**API 令牌**
- 已完成与回收站（软删除，可恢复 / 彻底删除）

SPA 直接调用与 CLI 相同的 `/open/v1/*` 端点 —— 用会话 Cookie 认证，无需配置令牌。`nodetick auth login` 的 OAuth 授权确认页仍为服务端渲染。

## TODO / 待办

- [x] 将第一个自然语言日期识别为特殊元素：文字继续保留在快速添加输入框中，显示蓝色识别状态；点击或边界退格只取消识别，不删除文字。
- [ ] 修复专注记录的时间序列化与显示，正确保留本地时区，避免把本地时间标记为 UTC。
- [ ] 为专注增加正计时、更完整的累计统计和完整记录历史。
- [ ] 完善倒计时的提醒、重复、备注、样式、归档和显示设置，进一步对齐官方“倒数纪念日”。
- [ ] 搜索增加清单、标签、日期、优先级、类型、状态筛选，以及保存为过滤器。
- [ ] 完成摘要持久化，并接通模板、保存、复制和分享功能。
- [x] 日历年 / 月 / 周 / 日 / 日程 / 3日 / 2周视图和时间段排程。
- [ ] 增加习惯自定义重复规则、编辑、多次数值打卡和历史统计。
- [ ] 将任务描述升级为富文本编辑器，支持 `/` 快速插入，进一步对齐 TickTick 编辑体验。
- [ ] 增加管理员用户管理，以及邀请码生成和轮换界面。
- [ ] 清理剩余英文文案，并补充生产环境下加载、错误、空状态和响应式场景的 E2E 测试。

## 部署（CLI，约 2 分钟）

```bash
git clone <本仓库> && cd nodetick
npm install

npx wrangler login
npx wrangler d1 create nodetick-db
#   → 把返回的 database_id 填入 worker/wrangler.toml

npm run deploy

# 必填：用于签名 CSRF 的随机 32+ 字符密钥
npx wrangler secret put SESSION_SECRET

# 可选：启用浏览器 Web Push 通知
npm run generate:vapid -w worker
# 把输出的 VAPID_PUBLIC_KEY 和联系邮箱写入 worker/wrangler.toml 的 [vars]
# VAPID_PUBLIC_KEY = "..."
# VAPID_SUBJECT = "mailto:admin@example.com"
# 私钥只写入 Cloudflare Secret，不要写入文件或提交：
npx wrangler secret put VAPID_PRIVATE_KEY

# 如果先部署后设置变量或 secret，需要再 deploy 一次
```

打开 `https://nodetick.<你的子域名>.workers.dev` —— 你注册的第一个用户即管理员。D1 schema 会在首个请求时自动初始化，无需手动建表。

`worker/wrangler.toml` 中的可选变量：

- `INVITE_CODE` —— 第一个用户之后，注册需要此邀请码。不设置则关闭注册。
- `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` —— Web Push 公钥与发送者联系方式；私钥必须通过 `VAPID_PRIVATE_KEY` secret 配置。密钥对可用 `npm run generate:vapid -w worker` 生成。

> **注意**：`*.workers.dev` 域名在部分网络（如中国大陆）不可达，必要时在 Cloudflare 控制台绑定自定义域名。

## 部署（控制台）

Fork 本仓库 → Cloudflare Workers & Pages → *导入仓库* → 选择 fork → 构建命令 `npm install`、部署命令 `npm run deploy -w worker` → 添加名为 `DB` 的 D1 绑定和 `SESSION_SECRET` secret。

## CLI 用法

```bash
npm install -g @nodetick/cli        # 或：npm run build -w cli && npm link -w cli

nodetick auth login --server https://nodetick.example.workers.dev
nodetick auth token <token> --server https://...   # 无浏览器环境用这个
nodetick auth status

nodetick project create --name Work
nodetick task create --title "买牛奶" --project <projectId> --tags groceries
nodetick task search 牛奶 --status 0
nodetick habit checkin <habitId> --stamp 20260831 --value 5
nodetick focus list --from "2026-08-01T00:00:00+0000" --to "2026-08-30T23:59:59+0000" --type pomodoro
nodetick countdown create --name "发布日" --date 2026-12-31
nodetick countdown update <countdownId> --date 2027-01-01
nodetick countdown delete <countdownId>
```

任何命令加 `--json` 输出原始 API JSON。服务器地址记录在 `~/.config/nodetick/config.json`；环境变量 `NODETICK_SERVER` / `NODETICK_TOKEN` 可覆盖（CI 场景友好）。

不安装直接从源码跑：先 `npm run build`，然后 `node cli/dist/index.js ...`。

## Web 控制台

已并入网页应用（见上）：令牌管理在 `/app/tokens`，倒计时在 `/app/countdown`，`nodetick auth login` 的 OAuth 授权确认页仍为服务端渲染。

## 安全模型

- API 令牌（`ntk_…`，256 位）仅存 **SHA-256 哈希**，明文只显示一次。
- 密码：PBKDF2-SHA-256（60 万次迭代），每个密码使用独立的随机 16 字节盐。
- Web 会话：HttpOnly SameSite=Lax Cookie；`/api/*` 只接受 JSON（配合 SameSite 即可免 CSRF 令牌）。OAuth 授权确认表单仍使用签名 CSRF 令牌。
- 登录失败固定延时，抑制时序探测。
- 这是"单租户信任"模型：任何持有令牌者都能读写**你的**数据。保管好令牌，可在网页应用中随时吊销。

## 开发

```bash
npm install
npm run dev           # wrangler dev（本地 D1 自动创建）
npm run dev -w webapp # Vite dev server :5173，/api + /open/v1 代理到 :8787
npm test -w worker    # vitest + @cloudflare/vitest-pool-workers（真实 D1 语义）
npm run test:e2e      # E2E：nodetick CLI 对真实服务器（见 tests/README.md）
npm run build         # 编译 CLI + 构建 webapp 到 webapp/dist
npm run type-check    # 所有 workspace 的 tsc
```

`npm run deploy` 会同时发布 Worker 和当前 `webapp/dist` 静态资源 —— 部署前先 `npm run build` 获得 SPA 新产物。

## API

基础路径：`{server}/open/v1` —— 端点对齐 [TickTick Open API v1](https://developer.ticktick.com/api#/openapi)。认证：`Authorization: Bearer <ntk_…>` **或** Web 会话 Cookie（SPA 使用）：

```
GET/POST        /task, /task/{taskId}          （POST /task/{id} 也可切换 status 0 ↔ 2）
POST            /project/{projectId}/task/{taskId}/complete
DELETE          /project/{projectId}/task/{taskId}      （软删除 → 回收站）
GET             /task/trash                             （NodeTick 扩展）
POST            /task/trash/{taskId}/restore            （NodeTick 扩展）
DELETE          /task/trash/{taskId}                    （NodeTick 扩展，彻底删除）
POST            /task/move, /task/completed, /task/filter, /task/search
GET/POST/DELETE /project/{projectId}/task/{taskId}/comment[/{commentId}]
GET/POST/DELETE /project, /project/{projectId}, /project/{projectId}/data
GET/POST/DELETE /project/group[/{groupId}]
GET/POST        /project/{projectId}/column[/{columnId}]
GET/POST        /tag
GET/POST        /habit, /habit/{habitId}, POST /habit/{habitId}/checkin, GET /habit/checkins
GET/POST/DELETE /focus[/{focusId}?type=]
GET/POST/DELETE /countdown[/{countdownId}]   （写入为 NodeTick 扩展）
```

首次列出 `/project` 时会自动创建每用户 **收集箱** 项目（`id: inbox`）。

SPA 使用的会话/JSON 端点（`/api/*`，Cookie 认证）：`POST /register`、`POST /login`、`POST /logout`、`GET /me`、`GET/POST /tokens`、`POST /tokens/{id}/revoke`。

OAuth：`GET /oauth/authorize`（PKCE S256，仅允许 loopback 回调）、`POST /oauth/token`。
Client id：`nodetick-cli`。

## 兼容性说明与免责声明

- NodeTick 实现的是官方 CLI 所使用的 TickTick Open API *文档化*行为。与 TickTick（Appest Inc.）无任何关联；请不要把 NodeTick 的问题报给 TickTick。
- 字段语义以 CLI 消费为准：`status`（0 未完成 / 2 完成 / -1 放弃）、`priority`（0/1/3/5）、`etag` 乐观锁、提醒 `TRIGGER` 字符串、`RRULE`/`ERULE` 重复规则。
- 提醒与重复规则按原样存储并返回；配置 VAPID 后，Cloudflare Cron Trigger 每分钟扫描到期提醒，并通过 Web Push 推送到已订阅的浏览器。
- 记得备份数据：可用 `nodetick task filter --json` 等导出，或 `wrangler d1 export nodetick-db`。

## 许可

MIT
