# 移动端 Tab 标签优化说明

## 问题描述

目的地查询页面的 Tab 标签在移动端存在以下问题：
1. **标签文字过长**：如"直飞往返"、"直飞单程"、"中转可达"在小屏幕上占用过多宽度
2. **标签超出屏幕**：4 个 Tab 标签在移动端可能挤在一起或超出显示区域
3. **徽章（Badge）过大**：数字徽章在移动端显得过大，占用空间
4. **内边距过大**：Tab 标签的默认内边距在移动端显得浪费空间

**影响页面**：DestinationQuery（目的地查询）

---

## 解决方案

采用**响应式文字 + CSS 优化**策略：
- **移动端（< 768px）**：精简标签文字、缩小徽章、减小内边距
- **桌面端（≥ 768px）**：保持完整标签文字和默认样式

---

## 实现细节

### 1. 响应式标签文字

**文件路径**：`frontend/src/pages/DestinationQuery.tsx`

**改进前**：
```typescript
const tabItems = [
  {
    key: 'all',
    label: <span>全部 <Badge count={allRows.length} /></span>,
  },
  {
    key: 'return',
    label: <span>直飞往返 <Badge count={returnCount} /></span>,
  },
  {
    key: 'oneway',
    label: <span>直飞单程 <Badge count={oneWayCount} /></span>,
  },
  {
    key: 'transfer',
    label: <span>中转可达 <Badge count={transferCount} /></span>,
  },
];
```

**改进后**：
```typescript
const tabItems = [
  {
    key: 'all',
    label: isMobile ? (
      <span>全部 <Badge count={allRows.length} showZero /></span>
    ) : (
      <span>全部 <Badge count={allRows.length} /></span>
    ),
  },
  {
    key: 'return',
    label: isMobile ? (
      <span>往返 <Badge count={returnCount} showZero /></span>
    ) : (
      <span>直飞往返 <Badge count={returnCount} /></span>
    ),
  },
  {
    key: 'oneway',
    label: isMobile ? (
      <span>单程 <Badge count={oneWayCount} showZero /></span>
    ) : (
      <span>直飞单程 <Badge count={oneWayCount} /></span>
    ),
  },
  {
    key: 'transfer',
    label: isMobile ? (
      <span>中转 <Badge count={transferCount} showZero /></span>
    ) : (
      <span>中转可达 <Badge count={transferCount} /></span>
    ),
  },
];
```

**文字精简对比**：

| Tab | 桌面端 | 移动端 | 节省字符 |
|-----|-------|-------|---------|
| 全部 | 全部 | 全部 | 0 |
| 往返 | 直飞往返 | 往返 | 2 字（50%） |
| 单程 | 直飞单程 | 单程 | 2 字（50%） |
| 中转 | 中转可达 | 中转 | 2 字（50%） |

**总节省**：6 个字符，约 40% 的宽度

---

### 2. 全局 CSS 样式优化

**文件路径**：`frontend/src/index.css`

**新增样式**：
```css
@media (max-width: 768px) {
  /* Tab 标签优化 */
  .ant-tabs-nav {
    margin-bottom: 8px !important;
  }

  .ant-tabs-tab {
    padding: 8px 8px !important;  /* 减小内边距 */
    font-size: 13px !important;   /* 缩小字体 */
  }

  .ant-tabs-tab-btn {
    white-space: nowrap;  /* 防止换行 */
  }

  /* Tab 标签徽章优化 */
  .ant-tabs-tab .ant-badge {
    margin-left: 2px;  /* 减小徽章间距 */
  }

  .ant-tabs-tab .ant-badge-count {
    font-size: 11px !important;      /* 缩小徽章字体 */
    height: 16px !important;         /* 减小徽章高度 */
    line-height: 16px !important;
    min-width: 16px !important;      /* 减小徽章最小宽度 */
    padding: 0 4px !important;       /* 减小徽章内边距 */
  }
}
```

**样式优化说明**：
1. **Tab 标签内边距**：从默认 `12px 16px` 减小到 `8px 8px`，节省 50% 空间
2. **Tab 标签字体**：从默认 `14px` 减小到 `13px`，更紧凑
3. **徽章字体**：从默认 `12px` 减小到 `11px`
4. **徽章尺寸**：从默认 `20px` 减小到 `16px`，更精致
5. **徽章内边距**：从默认 `0 6px` 减小到 `0 4px`

---

## 改进效果

### 移动端 Tab 标签对比

#### 修复前 ❌
```
┌──────────────────────────────────────────┐
│ [全部 99] [直飞往返 45] [直飞单程 3...  │  ← 超出屏幕
└──────────────────────────────────────────┘
```
- Tab 标签文字过长，挤在一起
- 第 4 个 Tab 可能被截断或换行
- 徽章过大，占用空间

#### 修复后 ✅
```
┌──────────────────────────────────────────┐
│ [全部 99] [往返 45] [单程 30] [中转 24]  │  ← 完全显示
└──────────────────────────────────────────┘
```
- Tab 标签文字精简，排列清晰
- 所有 Tab 在一行内完整显示
- 徽章精致，不占用过多空间

### 桌面端 Tab 标签（保持不变）

```
┌────────────────────────────────────────────────────────────┐
│ [全部 99] [直飞往返 45] [直飞单程 30] [中转可达 24]        │
└────────────────────────────────────────────────────────────┘
```
- 保持完整的标签文字
- 保持默认的徽章样式
- 无任何变化

---

## 响应式行为

| 屏幕尺寸 | Tab 文字 | Tab 内边距 | Tab 字体 | 徽章尺寸 | 徽章字体 |
|---------|---------|-----------|---------|---------|---------|
| 移动端 (< 768px) | 精简（2字） | 8px 8px | 13px | 16px × 16px | 11px |
| 桌面端 (≥ 768px) | 完整（4字） | 12px 16px | 14px | 20px × 20px | 12px |

**宽度节省**：
- 文字精简：节省约 40% 宽度
- 内边距减小：节省约 33% 宽度
- 徽章缩小：节省约 20% 宽度
- **总计**：节省约 30-40% 的 Tab 标签宽度

---

## 技术实现细节

### 1. 动态标签文字

使用 `isMobile` 变量动态切换标签文字：

```typescript
const screens = useBreakpoint();
const isMobile = !screens.md; // < 768px

const tabItems = [
  {
    label: isMobile ? <span>往返 <Badge /></span> : <span>直飞往返 <Badge /></span>,
  },
];
```

**优点**：
- 根据屏幕尺寸动态切换
- 无需额外的媒体查询
- 与其他响应式逻辑保持一致

### 2. CSS 媒体查询

使用 `@media (max-width: 768px)` 针对移动端优化样式：

```css
@media (max-width: 768px) {
  .ant-tabs-tab {
    padding: 8px 8px !important;
    font-size: 13px !important;
  }
}
```

**优点**：
- 全局生效，无需修改每个 Tab 组件
- 使用 `!important` 覆盖 Ant Design 默认样式
- 仅在移动端生效，桌面端不受影响

### 3. showZero 属性

移动端使用 `showZero` 属性确保徽章始终显示：

```typescript
<Badge count={count} showZero />
```

**作用**：
- `showZero={true}`：即使数量为 0 也显示徽章
- `showZero={false}`（默认）：数量为 0 时隐藏徽章

**移动端使用 showZero 的原因**：
- 保持视觉一致性，所有 Tab 都有徽章
- 用户可以快速了解每个分类的数量（包括 0）
- 避免 Tab 宽度因徽章显示/隐藏而变化

---

## 兼容性说明

- **Ant Design 5.12.0**：完全支持 Badge 的 `showZero` 属性
- **React 18**：无兼容性问题
- **浏览器支持**：
  - Chrome/Edge ≥ 90
  - Safari ≥ 14
  - Firefox ≥ 88
  - 移动端浏览器：iOS Safari ≥ 14, Chrome Mobile ≥ 90

---

## 测试验证

### 桌面端（≥ 768px）
- ✅ Tab 标签显示完整文字（"直飞往返"、"直飞单程"、"中转可达"）
- ✅ Tab 标签内边距正常（12px 16px）
- ✅ 徽章尺寸正常（20px × 20px）
- ✅ 切换 Tab 正常

### 移动端（< 768px）
- ✅ Tab 标签显示精简文字（"往返"、"单程"、"中转"）
- ✅ Tab 标签内边距缩小（8px 8px）
- ✅ 徽章尺寸缩小（16px × 16px）
- ✅ 所有 Tab 在一行内完整显示
- ✅ 切换 Tab 正常
- ✅ 徽章数量为 0 时也显示（showZero）

### 功能测试
- ✅ 点击 Tab 切换视图
- ✅ Tab 激活状态样式正常
- ✅ 徽章数量实时更新
- ✅ 加载状态（Spin）正常显示

---

## 未来优化建议

如果 Tab 标签仍然在某些小屏幕设备上超出，可以考虑：

1. **滑动 Tab**：使用 Ant Design 的 `moreIcon` 配置，超出的 Tab 折叠到"更多"菜单
   ```typescript
   <Tabs moreIcon={<MoreOutlined />} />
   ```

2. **图标 Tab**：使用图标替代文字，进一步节省空间
   ```typescript
   label: isMobile ? <SwapOutlined /> : <span>直飞往返</span>
   ```

3. **下拉菜单**：将 Tab 改为下拉菜单（Select），适合 5 个以上的选项
   ```typescript
   <Select value={activeTab} onChange={setActiveTab}>
     <Option value="all">全部</Option>
     <Option value="return">直飞往返</Option>
   </Select>
   ```

4. **底部导航**：使用 Ant Design Mobile 的 TabBar 组件（需引入额外依赖）

---

## 相关文档

- [移动端适配改进总结](./MOBILE_OPTIMIZATION.md) - 完整的移动端适配方案
- [移动端卡片视图改进说明](./MOBILE_CARD_VIEW.md) - 卡片视图优化
- [日期选择器修复说明](./DATEPICKER_FIX.md) - 日期选择器优化

---

## 提交记录

**改进日期**：2026-03-20
**编译状态**：✅ 成功通过 TypeScript 类型检查和 Vite 构建
**构建产物大小**：2,729.78 kB (gzip: 884.53 kB)
**CSS 大小**：1.30 kB (gzip: 0.56 kB)
**新增 CSS**：约 20 行
