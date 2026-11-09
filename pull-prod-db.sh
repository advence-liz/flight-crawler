#!/bin/bash

# 把线上数据（GitHub Actions 每日爬取推送到 data 分支的 SQLite）拉到本地开发库
#
# 用途：本地开发库常年停在最后一次本地爬取的时间点，而页面默认查"今天 ~ +30 天"，
# 于是本地打开页面经常是空的。线上数据就在 data 分支上，直接拉下来即可。
#
# 用法：
#   ./pull-prod-db.sh            # 后端没在跑时直接覆盖本地库
#   ./pull-prod-db.sh --force    # 后端在跑也强制覆盖（有损坏风险，自己确认）
#
# 注意：先停掉本地后端再拉，运行中的 SQLite（WAL 模式）被整体替换会损坏。

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="$ROOT_DIR/backend/data/flight-crawler.db"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

FORCE=0
[ "$1" = "--force" ] && FORCE=1

# ── 安全检查：后端在跑时不要覆盖库 ────────────────────────────
if lsof -ti tcp:3000 >/dev/null 2>&1; then
  if [ "$FORCE" -ne 1 ]; then
    echo -e "${RED}✗ 检测到 3000 端口有服务在跑（大概率是本地后端）${NC}"
    echo -e "  运行中的 SQLite 被整体替换会损坏，请先停掉后端再执行。"
    echo -e "  确认要强制覆盖：${YELLOW}./pull-prod-db.sh --force${NC}"
    exit 1
  fi
  echo -e "${YELLOW}⚠ 后端仍在运行，按 --force 继续覆盖（有损坏风险）${NC}"
fi

REMOTE_URL="$(git -C "$ROOT_DIR" remote get-url origin)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo -e "${YELLOW}▶ 从 data 分支拉取线上数据库...${NC}"
git clone --depth=1 --branch=data --quiet "$REMOTE_URL" "$TMP_DIR"

SRC="$TMP_DIR/backend/data/flight-crawler.db"
if [ ! -f "$SRC" ]; then
  echo -e "${RED}✗ data 分支里没有 backend/data/flight-crawler.db${NC}"
  exit 1
fi

mkdir -p "$ROOT_DIR/backend/data"
# 旧库残留的 WAL/SHM 必须一起清掉，否则会和替换后的主库对不上
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
cp "$SRC" "$DB_PATH"

echo -e "${GREEN}✓ 已更新本地开发库${NC}"
echo -e "  文件: $DB_PATH ($(du -h "$DB_PATH" | cut -f1))"
echo -e "  来源: $(git -C "$TMP_DIR" log -1 --format='%h %s')"

echo -e "${YELLOW}  提示：backend/data/flight-crawler.db 在 git 中是受跟踪的（首次部署兜底用），${NC}"
echo -e "${YELLOW}        拉取后 git status 会显示它已修改，提交代码时注意别把它一起带上。${NC}"

if command -v sqlite3 >/dev/null 2>&1; then
  RANGE=$(sqlite3 "$DB_PATH" "SELECT MIN(DATE(departureTime)) || ' ~ ' || MAX(DATE(departureTime)) || '（' || COUNT(*) || ' 条）' FROM flights;")
  echo -e "  数据: ${RANGE}"
fi
