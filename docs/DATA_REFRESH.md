# 数据刷新链路与调度策略

> 这份文档记录「航班数据怎么被刷新、刷新多频繁、为什么这么频繁」，以及实测出来的
> GitHub Actions 调度限制。下次调整频率前先读一遍，能省掉重新摸一遍的成本。

## 一、数据是怎么流转的

```
GitHub Actions（.github/workflows/daily-crawl.yml，每 6 小时）
   │
   ├─ 1. 在 runner 上起后端（本地 :3000，临时 SQLite）
   ├─ 2. 调 POST /api/crawler/initialize/refresh { startDate, endDate }
   │      → Puppeteer 逐个机场 × 日期 × 权益卡（666 / 2666）爬海航页面
   │      → 每个日期子任务：先删该日期全部旧数据，再写新数据
   ├─ 3. 清理 query_cache / 30 天前的执行日志（控制 db 体积）
   ├─ 4. 把 db 推到 data 分支（孤儿分支，只放 backend/data/flight-crawler.db）
   └─ 5. 调 Render API 触发重建
          → render-build.sh 构建时从 data 分支 git clone 最新 db，烤进镜像
          → 线上实例重启后读到的就是新数据
```

**关键点：数据是烤进镜像的，所以"刷新数据"必然伴随一次 Render 重建（约 2~3 分钟不可用）。**
没有持久磁盘可用，无法做到"只更新数据不重启"。

## 二、当前调度配置

```yaml
schedule:
  - cron: '0 */6 * * *'   # 00/06/12/18 UTC = 北京 08:00 / 14:00 / 20:00 / 次日 02:00
concurrency:
  group: daily-crawl
  cancel-in-progress: false   # 上一轮没跑完则排队，不双跑、不重复部署
```

- 每次都是**完整 30 天窗口**（不区分全量/增量）
- `days` 默认 30，手动触发可覆盖

## 三、为什么是 6 小时（实测数据）

### 3.1 GitHub 对计划任务的限流

| 配置 | 实测结果 |
|---|---|
| `*/5`（5 分钟） | 7 天 **0 次**触发 |
| `0 */2 * * *`（2 小时） | 14 小时应触发 7 次，**实际 1 次** |
| `0 18 * * *`（每天） | 每天都能跑，但延迟 **2~5 小时** |

GitHub 实际派发的频率大约只有「每天一两次」，cron 写得再密也只是被吞掉。
所以 6 小时（4 个时段）是「多给几次机会，又不至于写成明显滥用」的折中值。

### 3.2 单次运行耗时

30 天 × 44 个机场 × 2 种权益卡的完整爬取，近 12 次耗时：

```
37 / 39 / 41 / 41 / 42 / 43 / 44 / 45 / 46 / 47 / 48 分钟
```

即 **40~48 分钟**。这就是间隔不能压到 1 小时以下的原因（跑完只剩十几分钟余量，容易和下一轮重叠）。

### 3.3 成功率与失败模式

近 20 次运行：**5 次失败（约 25%）**，两类：

| 耗时 | 报错 | 原因 |
|---|---|---|
| 2~3 分钟 | 装依赖步骤失败 | npm / Puppeteer Chromium 下载不稳定 |
| 47~48 分钟 | `The hosted runner lost communication with the server` | 长时间跑 Chromium 把 runner 拖垮 |

另有 3 天完全没有运行记录（其中一天是修改 workflow 文件导致重新注册、错过了当天的时段）。

**结论：单次不可靠，靠"次数"兜底。** 每 6 小时给 4 次机会，
即使吞掉一半、再失败一两次，一天下来大概率仍能成功刷新 1~2 次；
而且失败是整轮失败，不会留下半截数据。

## 四、数据准确性保障

| 机制 | 说明 |
|---|---|
| **先删后写** | 每个日期子任务执行 `deleteDiscoveryFlights(dates)` 再插入，海航那边消失的航班会被清掉，不会一直挂着 |
| **权益卡精确过滤** | 用 `has666Card` / `has2666Card` 布尔列匹配，不用 `LIKE`（`2666权益卡航班` 包含 `666权益卡航班` 子串，会误命中） |
| **数据新鲜度展示** | `GET /api/flights/data-freshness` 返回最新 `crawledAt`；前端底部显示「航班数据更新于 X，实际余票以海航 App 为准」 |
| **卡种标注** | 每个航段标 `666` / `2666` / `666·2666`；权益卡选择写 cookie，下次默认用用户自己的卡种 |

> 注意：海航「随心飞」页面本身声明只提供**航班计划时刻**，不保证舱位——座位随时可能被兑走。
> 我们的数据是"某次爬取时刻的班表快照"，不是实时余票。

## 五、运维手册

### 手动触发一次爬取

```bash
gh workflow run daily-crawl.yml                    # 全量 30 天
gh workflow run daily-crawl.yml -f days=7          # 只刷 7 天
gh workflow run daily-crawl.yml -f skip_crawl=true # 不爬取，只验证「推 data 分支 + 触发部署」链路
```

### 查看运行情况

```bash
gh run list --workflow=daily-crawl.yml --limit 20            # 最近 20 次
gh run view <run-id> --log-failed                            # 只看失败步骤
```

判断调度是否正常：数一下当天有几条 `schedule` 记录。≥2 条说明 6 小时配置生效；
长期只有 1 条说明 GitHub 按天封顶，频率再调也没意义。

### 查看数据有多旧

```bash
curl -s https://flight-crawler.onrender.com/api/flights/data-freshness
```

### 本地调试单次爬取

```bash
cd backend
NODE_ENV=development CRAWLER_ENABLED=true npm run dev
curl "http://localhost:3000/api/crawler/debug?origin=北京大兴&date=2026-11-27"
```

调试模式**不写库**，只返回解析到的航班；同时会在 `backend/debug-screenshots/`
留下页面截图，排查"抓错了"时非常有用。

## 六、已知限制

1. **GitHub 调度延迟/限流**——见第三节，无法通过调 cron 解决。
2. **长任务容易被 runner 杀掉**——47~48 分钟的运行有掉线风险。
3. **每次刷新都要重建部署**——数据烤在镜像里，每天最多 4 次 2~3 分钟的中断。
4. **Render 免费实例会休眠**——目前靠外部定时任务每 5 分钟打一次 `/api/health` 保活；
   这个保活任务跑在 `rasonserver` 的 crontab 上（`*/5 * * * *`），与爬取链路无关。
   ⚠️ 如果不希望依赖 rasonserver，保活也要另找落点（GitHub Actions 的 5 分钟 cron 实测不可用）。
