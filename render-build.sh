#!/bin/bash

# Render 构建脚本
# 执行位置：项目根目录
# 作用：安装依赖、构建后端（数据库随代码仓库一起部署）

set -e

echo "▶ 安装后端依赖..."
cd backend
# 跳过 optional 依赖（puppeteer），保留 dev 依赖（构建需要 @nestjs/cli）
npm install --omit=optional

echo "▶ 构建后端..."
# 使用 tsconfig.prod.json（关闭 noImplicitAny，兼容 puppeteer any 类型）
npx nest build --tsc -p tsconfig.prod.json

echo "✓ 构建完成，数据库随代码仓库部署（backend/data/flight-crawler.db）"
