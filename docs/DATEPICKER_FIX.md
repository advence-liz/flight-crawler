# 移动端日期选择器修复说明

## 问题描述

在移动端使用日期范围选择器（RangePicker）时，弹出的日期选择面板超出屏幕展示区域，导致用户无法正常选择日期。

**影响页面**：
- DestinationQuery（目的地查询）
- RoutePlanner（行程规划 - 探索 Tab 和规划 Tab）
- FlightMap（航线地图）

---

## 问题原因

1. **弹出层宽度过大**：Ant Design 的 RangePicker 默认显示两个并排的日期面板（开始日期 + 结束日期），在移动端宽度不足
2. **弹出层挂载位置**：默认挂载到 `document.body`，可能导致滚动和定位问题
3. **日期单元格尺寸**：默认单元格尺寸为桌面端优化，在移动端显得过大

---

## 解决方案

### 1. RangePicker 配置优化

为所有 RangePicker 组件添加移动端配置：

```typescript
<RangePicker
  style={{ width: '100%' }}
  getPopupContainer={isMobile ? (trigger) => trigger.parentElement || document.body : undefined}
  placement={isMobile ? 'bottomLeft' : undefined}
/>
```

**配置说明**：
- `getPopupContainer`：移动端将弹出层挂载到触发元素的父元素，避免滚动问题
- `placement`：移动端指定弹出位置为 `bottomLeft`，确保面板从左下方弹出

### 2. 全局 CSS 样式优化

在 `frontend/src/index.css` 中添加移动端日期选择器样式：

```css
@media (max-width: 768px) {
  /* 日期选择器弹出层宽度限制 */
  .ant-picker-dropdown {
    max-width: 95vw !important;
  }

  .ant-picker-panel-container {
    max-width: 95vw !important;
  }

  /* 日期范围选择器双面板改为垂直排列（移动端友好） */
  .ant-picker-panels {
    flex-direction: column !important;
  }

  /* 日期选择器面板宽度调整 */
  .ant-picker-panel {
    width: 100% !important;
  }

  /* 日期单元格大小调整 */
  .ant-picker-cell {
    padding: 2px 0 !important;
  }

  .ant-picker-cell-inner {
    min-width: 20px !important;
    height: 20px !important;
    line-height: 20px !important;
    font-size: 12px !important;
  }
}
```

**样式说明**：
- **宽度限制**：弹出层最大宽度限制为 95vw，确保不超出屏幕
- **垂直排列**：将双面板从水平排列改为垂直排列，节省宽度
- **单元格优化**：减小日期单元格尺寸和字体，适配小屏幕

---

## 修复效果

### 修复前 ❌
- 日期选择面板超出屏幕右侧
- 用户需要横向滚动才能看到完整面板
- 双面板并排显示，占用过多宽度
- 日期单元格过大，面板整体过于拥挤

### 修复后 ✅
- 日期选择面板完全在屏幕可视区域内
- 双面板垂直排列，用户可以上下滚动选择
- 日期单元格大小适中，触摸操作友好
- 弹出层挂载到父元素，滚动体验更好

---

## 技术细节

### 1. getPopupContainer 的作用

```typescript
getPopupContainer={(trigger) => trigger.parentElement || document.body}
```

- **默认行为**：弹出层挂载到 `document.body`，使用绝对定位
- **优化后**：弹出层挂载到触发元素的父元素，跟随父元素滚动
- **好处**：避免在页面滚动时弹出层位置错位

### 2. flex-direction: column 的作用

```css
.ant-picker-panels {
  flex-direction: column !important;
}
```

- **默认行为**：双面板水平排列（`flex-direction: row`）
- **优化后**：双面板垂直排列（`flex-direction: column`）
- **好处**：宽度从 600px+ 减少到 300px，适配移动端

### 3. 响应式断点

所有优化仅在移动端生效（`@media (max-width: 768px)`），桌面端保持原有体验。

---

## 影响范围

### 修改的文件
1. `frontend/src/pages/DestinationQuery.tsx`
   - 1 个 RangePicker（日期范围）

2. `frontend/src/pages/RoutePlanner.tsx`
   - 4 个 RangePicker（探索 Tab 2 个 + 规划 Tab 2 个）

3. `frontend/src/pages/FlightMap.tsx`
   - 1 个 RangePicker（日期范围）

4. `frontend/src/index.css`
   - 新增移动端日期选择器样式（约 30 行）

### 不影响的功能
- ✅ 桌面端日期选择器体验完全不变
- ✅ 日期选择逻辑和数据处理不变
- ✅ 日期格式和验证规则不变

---

## 测试验证

### 桌面端（≥ 768px）
- ✅ 日期选择器显示为双面板并排
- ✅ 弹出层挂载到 body
- ✅ 日期单元格大小正常

### 移动端（< 768px）
- ✅ 日期选择器显示为双面板垂直排列
- ✅ 弹出层宽度不超过屏幕 95%
- ✅ 日期单元格大小适中，触摸友好
- ✅ 弹出层挂载到父元素，滚动体验好

### 功能测试
- ✅ 选择开始日期和结束日期
- ✅ 快捷选择（今天、本周、本月等）
- ✅ 清空日期
- ✅ 日期验证（开始日期 ≤ 结束日期）

---

## 兼容性说明

- **Ant Design 5.12.0**：完全支持 `getPopupContainer` 和 `placement` 配置
- **React 18**：无兼容性问题
- **浏览器支持**：
  - Chrome/Edge ≥ 90
  - Safari ≥ 14
  - Firefox ≥ 88
  - 移动端浏览器：iOS Safari ≥ 14, Chrome Mobile ≥ 90

---

## 相关文档

- [移动端适配改进总结](./MOBILE_OPTIMIZATION.md) - 完整的移动端适配方案
- [Ant Design DatePicker 文档](https://ant.design/components/date-picker-cn) - 官方文档

---

## 提交记录

**修复日期**：2026-03-20
**编译状态**：✅ 成功通过 TypeScript 类型检查和 Vite 构建
**构建产物大小**：2,724.89 kB (gzip: 883.85 kB)
