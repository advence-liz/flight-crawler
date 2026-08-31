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
if curl -fsSL "https://raw.githubusercontent.com/advence-liz/flight-crawler/data/backend/data/flight-crawler.db" -o data/flight-crawler.db.tmp; then
  mv data/flight-crawler.db.tmp data/flight-crawler.db
  echo "✓ 已使用 data 分支最新数据库"
else
  rm -f data/flight-crawler.db.tmp
  echo "⚠ 拉取 data 分支数据库失败，回退使用仓库自带数据库"
fi

echo "✓ 构建完成"
