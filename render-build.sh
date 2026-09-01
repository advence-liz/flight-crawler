#!/bin/bash

# Render 构建脚本
# 执行位置：项目根目录
# 作用：安装依赖、构建后端；构建时从 data 分支拉取 GitHub Actions 每日爬取的最新数据库

set -e

echo "▶ 安装后端依赖..."
cd backend
# 跳过 optional 依赖（puppeteer），保留 dev 依赖（构建需要 @nestjs/cli）
npm install --omit=optional

echo "▶ 构建后端..."
# 使用 tsconfig.prod.json（关闭 noImplicitAny，兼容 puppeteer any 类型）
npx nest build --tsc -p tsconfig.prod.json

echo "▶ 拉取 data 分支最新数据库（GitHub Actions 每日爬取产出）..."
# 改用 git clone 而不是 raw.githubusercontent.com：raw 内容走 CDN 缓存
# （max-age=300s，且验证过 query string 不参与缓存 key 计算，加时间戳参数也没用），
# 短时间内连续 push+deploy 会拿到过期数据；git 协议直连没有这层缓存
DATA_FETCH_DIR=$(mktemp -d)
if git clone --depth=1 --branch=data --quiet https://github.com/advence-liz/flight-crawler.git "$DATA_FETCH_DIR" \
  && cp "$DATA_FETCH_DIR/backend/data/flight-crawler.db" data/flight-crawler.db.tmp; then
  mv data/flight-crawler.db.tmp data/flight-crawler.db
  echo "✓ 已使用 data 分支最新数据库"
else
  echo "⚠ 拉取 data 分支数据库失败，回退使用仓库自带数据库"
fi
rm -rf "$DATA_FETCH_DIR" data/flight-crawler.db.tmp

echo "✓ 构建完成"
