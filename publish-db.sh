#!/bin/bash

# 发布最新数据库到 data 分支（force push，只保留最新版本）

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="$ROOT_DIR/backend/data/flight-crawler.db"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -f "$DB_PATH" ]; then
  echo -e "${RED}✗ 数据库文件不存在: $DB_PATH${NC}"
  exit 1
fi

DB_SIZE=$(du -sh "$DB_PATH" | cut -f1)
echo -e "${YELLOW}▶ 发布数据库到 data 分支（$DB_SIZE）...${NC}"

# 在临时目录操作，不影响当前工作区
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# clone 只拉 data 分支（shallow，速度快）
git clone --depth=1 --branch=data "$(git remote get-url origin)" "$TMP_DIR" 2>/dev/null

# 替换 db 文件
mkdir -p "$TMP_DIR/backend/data"
cp "$DB_PATH" "$TMP_DIR/backend/data/flight-crawler.db"

# 提交并 force push
cd "$TMP_DIR"
git add -f backend/data/flight-crawler.db
git commit --allow-empty -m "data: 更新航班数据库 $(date '+%Y-%m-%d %H:%M')"
git push --force origin data

echo -e "${GREEN}✓ 数据库已发布到 data 分支${NC}"
