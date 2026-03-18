#!/bin/bash

# 随心飞特价行程爬虫工具 - 本地生产部署脚本
# 构建前后端并以生产模式运行，无需 Docker

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BACKEND_PORT=3000
FRONTEND_PORT=8080
PID_FILE="$ROOT_DIR/.deploy.pid"

# ── 工具函数 ────────────────────────────────────────────────────

log_info()    { echo -e "${GREEN}✓${NC} $1"; }
log_warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
log_error()   { echo -e "${RED}✗${NC} $1"; }
log_section() { echo -e "\n${BLUE}▶ $1${NC}"; }

# ── 停止已有进程 ────────────────────────────────────────────────

stop() {
  if [ -f "$PID_FILE" ]; then
    echo -e "${YELLOW}停止已运行的服务...${NC}"
    while IFS= read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" && log_info "已停止进程 $pid"
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
}

if [ "$1" = "stop" ]; then
  stop
  log_info "服务已停止"
  exit 0
fi

if [ "$1" = "restart" ]; then
  stop
fi

# ── 环境检查 ────────────────────────────────────────────────────

log_section "环境检查"

if ! command -v node &>/dev/null; then
  log_error "未检测到 Node.js，请先安装 Node.js >= 18"
  exit 1
fi
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  log_error "Node.js 版本过低，需要 >= 18，当前: $(node -v)"
  exit 1
fi
log_info "Node.js $(node -v)"

if ! command -v npx &>/dev/null; then
  log_error "未检测到 npx"
  exit 1
fi

# ── 安装依赖 ────────────────────────────────────────────────────

log_section "安装依赖"

cd "$ROOT_DIR/backend"
[ ! -d node_modules ] && npm install --silent && log_info "后端依赖安装完成" || log_info "后端依赖已就绪"

cd "$ROOT_DIR/frontend"
[ ! -d node_modules ] && npm install --silent && log_info "前端依赖安装完成" || log_info "前端依赖已就绪"

# ── 构建 ────────────────────────────────────────────────────────

log_section "构建后端"
cd "$ROOT_DIR/backend"
npm run build
log_info "后端构建完成 → backend/dist/"

log_section "构建前端"
cd "$ROOT_DIR/frontend"
npm run build
log_info "前端构建完成 → frontend/dist/"

# ── 环境变量 ────────────────────────────────────────────────────

cd "$ROOT_DIR/backend"
if [ ! -f .env ]; then
  cp .env.example .env
  log_warn "已从 .env.example 创建 .env，如需修改请编辑 backend/.env"
fi
mkdir -p data logs

# ── 启动后端 ────────────────────────────────────────────────────

log_section "启动后端服务（端口 $BACKEND_PORT）"
mkdir -p "$ROOT_DIR/logs"

# 释放端口占用
OCCUPIED=$(lsof -ti tcp:$BACKEND_PORT 2>/dev/null || true)
if [ -n "$OCCUPIED" ]; then
  log_warn "端口 $BACKEND_PORT 被占用，正在释放..."
  echo "$OCCUPIED" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

NODE_ENV=production node dist/main.js \
  > "$ROOT_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!

# 等待后端就绪（检查端口是否监听）
echo -n "  等待后端启动"
for i in $(seq 1 20); do
  sleep 1
  echo -n "."
  if lsof -ti tcp:$BACKEND_PORT &>/dev/null; then
    echo ""
    log_info "后端服务已就绪 (PID: $BACKEND_PID)"
    break
  fi
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo ""
    log_error "后端进程意外退出，请查看日志: logs/backend.log"
    exit 1
  fi
  if [ $i -eq 20 ]; then
    echo ""
    log_error "后端启动超时，请查看日志: logs/backend.log"
    kill $BACKEND_PID 2>/dev/null
    exit 1
  fi
done

# ── 启动前端静态服务 ─────────────────────────────────────────────

log_section "启动前端服务（端口 $FRONTEND_PORT）"

OCCUPIED=$(lsof -ti tcp:$FRONTEND_PORT 2>/dev/null || true)
if [ -n "$OCCUPIED" ]; then
  log_warn "端口 $FRONTEND_PORT 被占用，正在释放..."
  echo "$OCCUPIED" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# 用 vite preview 托管构建产物（自带反向代理配置）
cd "$ROOT_DIR/frontend"
npx vite preview --port $FRONTEND_PORT --host 0.0.0.0 \
  > "$ROOT_DIR/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!

sleep 2
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
  log_error "前端启动失败，请查看日志: logs/frontend.log"
  kill $BACKEND_PID 2>/dev/null
  exit 1
fi
log_info "前端服务已就绪 (PID: $FRONTEND_PID)"

# ── 保存 PID ────────────────────────────────────────────────────

echo "$BACKEND_PID" > "$PID_FILE"
echo "$FRONTEND_PID" >> "$PID_FILE"

# ── 完成 ────────────────────────────────────────────────────────

echo ""
echo "========================================="
echo -e "${GREEN}  部署完成！${NC}"
echo "========================================="
echo -e "  前端地址:  ${BLUE}http://localhost:$FRONTEND_PORT${NC}"
echo -e "  后端 API:  ${BLUE}http://localhost:$BACKEND_PORT/api${NC}"
echo -e "  后端日志:  logs/backend.log"
echo -e "  前端日志:  logs/frontend.log"
echo ""
echo -e "  停止服务:  ${YELLOW}./deploy-local.sh stop${NC}"
echo -e "  重启服务:  ${YELLOW}./deploy-local.sh restart${NC}"
echo "========================================="
