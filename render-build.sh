#!/bin/bash

# Render 构建脚本
# 执行位置：项目根目录
# 作用：安装依赖、构建后端、从 data 分支拉取最新数据库

set -e

echo "▶ 安装后端依赖..."
cd backend
npm ci

echo "▶ 构建后端..."
npm run build

echo "▶ 拉取最新数据库（data 分支）..."
mkdir -p data
DB_URL="https://raw.githubusercontent.com/${GITHUB_REPO}/data/backend/data/flight-crawler.db"
curl -fsSL "$DB_URL" -o data/flight-crawler.db
echo "✓ 数据库已就绪（$(du -sh data/flight-crawler.db | cut -f1)）"
