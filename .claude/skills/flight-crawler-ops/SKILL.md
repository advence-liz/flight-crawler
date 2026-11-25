---
name: flight-crawler-ops
description: 随心飞项目运维。用户问如何连接 Neon/PostgreSQL 或航班 SQLite、怎样查 Render 日志/部署状态、更新航班数据、排查线上登录/MCP/AI 额度或验证发布时使用。默认只读。
---

# 随心飞运维

**先选对数据源与服务，再根据目标做最小核验。** 航班数据查 SQLite；账号和额度查 Neon；构建、发布、请求错误查 Render。历史 PM2/Nginx 部署文档不是当前 Render 生产环境的说明。

| 要排查什么 | 实际存放位置 |
|---|---|
| 航班缺失、日期覆盖、爬取时间 | `backend/data/flight-crawler.db`；Render 后端构建时从 GitHub `data` 分支复制快照 |
| Better Auth 登录/会话、用户权限、MCP Token 哈希、MCP/邮件/站内对话次数 | Neon PostgreSQL；后端 `FLIGHT_MCP_QUOTA_DATABASE_URL`；Better Auth 也用这个变量，**没有单独的 `SITE_AUTH_DATABASE_URL`** |
| DeepSeek 实际用量和全站金额配额 | Neon PostgreSQL；后端 `TRIP_AI_BUDGET_DATABASE_URL`；按此变量查账本，不假设它与上面的连接指向同一数据库 |

默认不修改生产环境。部署、回滚、重爬、换连接串、改配额、迁移/恢复、写 SQL 等只在本次用户明确授权后执行。数据库密码、完整连接串、Token、OAuth Secret、Cookie 仅经已授权进程环境或平台密钥管理使用：不读 `.env` 来找生产凭证；不打印、不写文件、不进命令参数、不进提交和截图。查看日志只取与当前问题相关的小范围，转述时脱敏。

## 航班过期先核对线上快照，别先触发重爬

从仓库根目录检查静态快照：先确认没有后端在写且没有 `-wal`/`-shm` 文件，仅对确定不会变化的快照使用 `immutable=1`。运行中的库不能用 `immutable=1`，否则可能忽略 WAL；诊断运行库应使用普通只读连接。

```sh
sqlite3 -readonly -header 'file:backend/data/flight-crawler.db?immutable=1' \
  'SELECT COUNT(*) AS flights, MIN(DATE(departureTime)) AS first_day, MAX(DATE(departureTime)) AS last_day, MAX(crawledAt) AS latest_crawl FROM flights;'
git ls-remote origin refs/heads/data
```

线上用 `/api/flights/data-freshness` 核验 `crawledAt`。如果确实要把线上数据拉到本地，确认目标 worktree、保留需要的本地数据，先停掉使用该库的后端再运行 `./pull-prod-db.sh`（不要 `--force`）。脚本会替换本地 SQLite 及旧 WAL/SHM；数据库在 Git 中受跟踪，不要把这次下载夹进代码提交。

爬取日志、`data` 分支更新和构建细节见 `docs/DATA_REFRESH.md`、`.github/workflows/daily-crawl.yml` 和 `render-build.sh`。构建取不到 `data` 时会回退到仓库自带快照，因此部署 `live` 不等于航班数据已更新。

## Neon 先确认分支、数据库和角色，再跑只读探针

1. 在 Neon Console 进入该项目，在 **Connect** 中确认目标分支、数据库和角色。日常诊断优先选只读角色；有已授权的 Console 登录时，可在 SQL Editor 选中同一分支/库后运行 `SELECT 1;`，不用复制连接串。
2. 程序需要连接时，把对应的 PostgreSQL URL 通过可信渠道注入后端进程环境（线上是 Render **后端**的 Environment），保留 Neon 提供的 TLS 参数，不关闭证书校验。没有授权的连接或与线上目标不符就停，不扫描本机凭据、不创建数据库客户端配置。修改生产连接前要确认不是新空库；Better Auth 自动建表不等于迁移了旧用户。Better Auth 初始化用会话级 advisory lock；如需改连接方式，不要把直连随意替换成事务池化连接，先在隔离分支验证迁移行为。
3. 已授权连接串注入环境后，从 `backend/` 运行下面的探针。查账本时**只**把 `TARGET_VAR` 的值换成 `TRIP_AI_BUDGET_DATABASE_URL`；只输出成功标志或错误代码，不查询业务行：

```sh
TARGET_VAR=FLIGHT_MCP_QUOTA_DATABASE_URL node <<'JS'
const { Client } = require('pg');
const key = process.env.TARGET_VAR;
const allowed = ['FLIGHT_MCP_QUOTA_DATABASE_URL', 'TRIP_AI_BUDGET_DATABASE_URL'];
if (!allowed.includes(key) || !process.env[key]) {
  console.error('Missing authorized PostgreSQL connection');
  process.exit(1);
}
(async () => {
  const db = new Client({ connectionString: process.env[key], connectionTimeoutMillis: 12000,
    statement_timeout: 5000, query_timeout: 6000 });
  try {
    await db.connect();
    await db.query('BEGIN READ ONLY');
    await db.query('SELECT 1');
    await db.query('ROLLBACK');
    console.log(`${key}: SELECT 1 OK`);
  } finally {
    await db.end().catch(() => {});
  }
})().catch(error => {
  const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'UNKNOWN';
  console.error(`PostgreSQL check failed (${code})`);
  process.exitCode = 1;
});
JS
```

一次连接失败先区分 Neon 计算休眠、Render 后端冷启动、DNS/TLS、角色权限、连接超时和 SQL 超时。`SELECT 1` 不是业务读写验证。不能用航班 `data` 分支做 PG 的备份；没有证实可恢复的独立备份时，不声称已完成备份。参考 `backend/src/modules/route/site-auth.service.ts`、`flight-mcp-quota.ts`、`deepseek-trip-model.ts` 与 `trip-ai-budget.ts`。

## Render 查对应服务；`live` 后还要从公开网址回读

| 服务 | ID | 浏览器地址 |
|---|---|---|
| `flight-crawler-frontend`（静态站） | `srv-d6t9dunpm1nc739e4dr0` | `https://flight-crawler-frontend.onrender.com` |
| `flight-crawler`（Nest 后端） | `srv-d6t91fua2pns738l8iqg` | `https://flight-crawler.onrender.com` |

```sh
render whoami
render deploys list srv-d6t9dunpm1nc739e4dr0 -o json | jq -r '.[0:3][] | [.commit.id,.status,.trigger] | @tsv'
render deploys list srv-d6t91fua2pns738l8iqg -o json | jq -r '.[0:3][] | [.commit.id,.status,.trigger] | @tsv'
render logs --resources srv-d6t91fua2pns738l8iqg --level error --limit 20 -o text
```

- **发布**：确认个人仓库 `advence-liz/flight-crawler`、目标 `main` 和当前线上 SHA；两项 Render 服务均关联 `main` 并开启自动部署，但要分别查实际触发的部署，不假设两项都需要重建。在独立 worktree 验证构建与受影响的 smoke，只提交本轮文件，先确认远端基线，按已有发布方式推送，不 force push。推后确认目标 SHA 已在 `main`；走 PR 时依全局检查是否有合并后孤悬提交。不要同时手动发起一轮重复部署；仅在明确授权的重部署/回滚中，确认服务和 SHA 后使用 `render deploys create <service-id> --commit <sha> --wait`。回滚代码不等于恢复旧 SQLite（构建仍取当前 `data`）或恢复 Neon。
- **登录链路**：前端 Render 的 `/api/*` 要 **Rewrite** 到 `https://flight-crawler.onrender.com/api/*`，放在 SPA 回退 `/*` → `/index.html` 前；不是重定向。GitHub 回调使用公开前端域的 `/api/auth/callback/github`。排查时先比较前端同源 `/api/account/status` 和后端同路径有没有返回 JSON；`200` 加 HTML 不是正常响应，也不代表 OAuth 已跑通。不要为了调试顺手开启其他登录方式。
- **线上核验**：部署记录显示 `live` 且 SHA 正确后，用正常公开 URL 打开变更页面（`/#/account`、`/#/guide?section=mcp` 等）。前端暂时还是旧内容时，比较普通请求和带发布标记查询参数的 HTML bundle，再回到正常 URL 验证；不要仅凭控制台状态宣布上线。`/api/flights/data-freshness` 查快照时间；`/api/routes/ai-trip/status` 只查开关、不调用模型；裸 `POST /api/mcp` 在线上启用时需要 Token，`401` 只能证明鉴权生效，不能证明客户端已连通。实际 OAuth、持 Token 查航班或模型调用都要单独标注验证范围。
