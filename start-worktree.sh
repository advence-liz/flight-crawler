#!/bin/bash

# 随心飞 - Worktree 开发环境启动脚本
# 用途：在 git worktree 中启动独立端口的前后端，不影响主目录的服务
# 使用：./start-worktree.sh [后端端口] [前端端口]
# 示例：./start-worktree.sh 3001 5174

set -e

BACKEND_PORT=${1:-3001}
FRONTEND_PORT=${2:-5174}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================="
echo "  Worktree 开发环境"
echo "  后端端口: $BACKEND_PORT  前端端口: $FRONTEND_PORT"
echo "========================================="
echo ""

# 检查端口是否被占用
check_port() {
  if lsof -i ":$1" &>/dev/null; then
    echo -e "${RED}错误: 端口 $1 已被占用，请换一个端口${NC}"
    exit 1
  fi
}
check_port $BACKEND_PORT
check_port $FRONTEND_PORT

# 后端：覆盖 PORT 环境变量启动
echo -e "${YELLOW}启动后端 (port: $BACKEND_PORT)...${NC}"
cd "$SCRIPT_DIR/backend"

if [ ! -d "node_modules" ]; then
  npm install
fi

if [ ! -f ".env" ]; then
  cp .env.example .env
fi

mkdir -p ../logs

PORT=$BACKEND_PORT npm run dev > "../logs/backend-$BACKEND_PORT.log" 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓ 后端已启动 (PID: $BACKEND_PID, log: logs/backend-$BACKEND_PORT.log)${NC}"

# 等待后端就绪
echo -e "${YELLOW}等待后端就绪...${NC}"
for i in $(seq 1 10); do
  sleep 1
  if curl -s "http://localhost:$BACKEND_PORT/api/health" &>/dev/null; then
    echo -e "${GREEN}✓ 后端已就绪${NC}"
    break
  fi
  if [ $i -eq 10 ]; then
    echo -e "${RED}✗ 后端启动超时，请查看日志: logs/backend-$BACKEND_PORT.log${NC}"
    exit 1
  fi
done
echo ""

# 前端：覆盖 proxy target 和端口
echo -e "${YELLOW}启动前端 (port: $FRONTEND_PORT)...${NC}"
cd "$SCRIPT_DIR/frontend"

if [ ! -d "node_modules" ]; then
  npm install
fi

# 通过环境变量传递 API 地址，前端 api/index.ts 会读取 VITE_API_BASE_URL
VITE_API_BASE_URL="http://localhost:$BACKEND_PORT/api" npm run dev -- --port $FRONTEND_PORT

# 注意：前端占用当前终端，Ctrl+C 会同时退出前端（后端仍在后台运行）
