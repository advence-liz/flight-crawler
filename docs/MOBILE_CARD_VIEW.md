# 移动端卡片视图改进说明

## 问题描述

目的地查询页面使用表格（Table）展示航班信息，在移动端存在以下问题：
1. **表格列过多**：目的地、去程、返程、权益卡、操作等多列信息在小屏幕上挤压严重
2. **横向滚动体验差**：虽然添加了 `scroll={{ x: 1000 }}`，但用户需要频繁左右滑动查看完整信息
3. **操作按钮小**：表格中的操作按钮在移动端触摸区域较小，不易点击
4. **信息层级不清晰**：表格的行列结构在小屏幕上难以快速扫描

**影响页面**：DestinationQuery（目的地查询）

---

## 解决方案

采用**响应式布局**策略：
- **移动端（< 768px）**：使用卡片视图（Card）展示航班信息
- **桌面端（≥ 768px）**：保持表格视图（Table）

---

## 实现细节

### 1. 创建移动端卡片组件

**文件路径**：`frontend/src/pages/DestinationQuery.tsx`

**新增组件**：`DestinationCard`

```typescript
interface DestinationCardProps {
  row: UnifiedRow;
  onShowDetail: (dest: DestinationResult) => void;
  onShowTransferRoutes: (city: string) => void;
  onPlan: (city: string) => void;
}

function DestinationCard({ row, onShowDetail, onShowTransferRoutes, onPlan }: DestinationCardProps) {
  const city = row.kind === 'direct' ? row.dest.destination : row.item.city;
  const isDirect = row.kind === 'direct';
  const isTransferRT = row.kind === 'transfer-rt';
  const isTransferOW = row.kind === 'transfer-ow';

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      {/* 标题行：城市名 + 标签 */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Space size={4}>
          <strong style={{ fontSize: 16 }}>{city}</strong>
          {/* 往返/单程/中转标签 */}
        </Space>
      </div>

      {/* 航班信息：去程/返程航班数、日期范围 */}
      <div style={{ marginBottom: 8 }}>
        {/* 直飞：显示航班数和日期 */}
        {/* 中转：显示方案数和经停城市 */}
      </div>

      {/* 权益卡标签（仅直飞） */}
      {isDirect && (
        <div style={{ marginBottom: 8 }}>
          <Space size={2}>
            {/* 666/2666 权益卡标签 */}
          </Space>
        </div>
      )}

      {/* 操作按钮：全宽、易于点击 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="primary" size="small" style={{ flex: 1 }}>
          查看详情
        </Button>
        <Button size="small" style={{ flex: 1 }}>
          行程规划
        </Button>
      </div>
    </Card>
  );
}
```

**卡片布局特点**：
1. **标题行**：城市名（16px 加粗）+ 类型标签（往返/单程/中转）
2. **航班信息**：
   - 直飞：去程/返程航班数、可用天数、日期范围
   - 中转：去程/返程方案数、经停城市、总耗时
3. **权益卡标签**：666/2666 权益卡（仅直飞显示）
4. **操作按钮**：全宽按钮，易于触摸点击

---

### 2. 响应式视图切换

**修改位置**：`Tabs` 组件的 `children` 渲染逻辑

```typescript
<Tabs
  items={tabItems.map(t => ({
    key: t.key,
    label: t.label,
    children: isMobile ? (
      // 移动端：卡片视图
      <div style={{ padding: '12px 0' }}>
        {t.data.map(row => (
          <DestinationCard
            key={getCity(row)}
            row={row}
            onShowDetail={handleShowDetail}
            onShowTransferRoutes={handleShowTransferRoutes}
            onPlan={goToPlan}
          />
        ))}
      </div>
    ) : (
      // 桌面端：表格视图
      <Table<UnifiedRow>
        columns={unifiedColumns}
        dataSource={t.data}
        rowKey={r => getCity(r)}
        scroll={{ x: 1000 }}
      />
    ),
  }))}
/>
```

**切换逻辑**：
- 使用 `isMobile` 变量（`!screens.md`）判断屏幕尺寸
- 移动端渲染卡片列表，桌面端渲染表格
- 保持数据源和操作回调一致

---

### 3. 类型定义调整

**问题**：`UnifiedRow` 类型定义在函数组件内部，`DestinationCard` 组件无法访问

**解决方案**：将类型定义提升到组件外部

```typescript
// ─── 类型定义 ────────────────────────────────────────────────

type UnifiedRow =
  | { kind: 'direct'; dest: Destina }
  | { kind: 'transfer-rt'; item: TransferRoundTripDest }
  | { kind: 'transfer-ow'; item: TransferOneWayDest };

// ─── 移动端卡片视图组件 ──────────────────────────────────────

interface DestinationCardProps {
  row: UnifiedRow;
  // ...
}
```

---

## 改进效果

### 移动端体验提升

#### 修复前（表格视图）❌
- 表格列过多，需要横向滚动
- 信息密集，难以快速扫描
- 操作按钮小，触摸不便
- 日期范围被压缩，难以阅读

#### 修复后（卡片视图）✅
- 卡片垂直排列，无需横向滚动
- 信息层级清晰，易于扫描
- 操作按钮全宽，触摸友好
- 日期范围完整显示，易于阅读

### 桌面端体验保持

- ✅ 表格视图完全保持不变
- ✅ 排序、筛选功能正常
- ✅ 分页器显示正常
- ✅ 横向滚动仍然可用（宽表格场景）

---

## 卡片视图设计细节

### 1. 直飞目的地卡片

```
┌─────────────────────────────────┐
│ 北京 [往返]                      │
│                                  │
│ ✈ 去程    15 班 · 20 天          │
│ 03-20 ~ 04-10                    │
│                                  │
│ ↩ 返程    12 班 · 18 天          │
│ 03-22 ~ 04-12                    │
│                                  │
│ [666] [2666]                     │
│                                  │
│ [查看详情]  [行程规划]            │
└─────────────────────────────────┘
```

**信息密度**：
- 标题行：城市名（16px）+ 往返标签
- 去程：航班数 + 天数 + 日期范围
- 返程：航班数 + 天数 + 日期范围
- 权益卡：666/2666 标签
- 操作：2 个全宽按钮

### 2. 中转目的地卡片

```
┌─────────────────────────────────┐
│ 成都 [中转往返]                  │
│                                  │
│ ✈ 去程    8 条方案               │
│ 经 西安 · 5h30m                  │
│                                  │
│ ↩ 返程    6 条方案               │
│ 经 重庆 · 6h15m                  │
│                                  │
│ [中转方案]  [行程规划]            │
└─────────────────────────────────┘
```

**信息密度**：
- 标题行：城市名（16px）+ 中转标签
- 去程：方案数 + 经停城市 + 总耗时
- 返程：方案数 + 经停城市 + 总耗时
- 操作：2 个全宽按钮

---

## 响应式断点

| 屏幕尺寸 | 视图类型 | 布局特点 |
|---------|---------|---------|
| 移动端 (< 768px) | 卡片视图 | 垂直排列，全宽卡片，无横向滚动 |
| 平板 (768-992px) | 表格视图 | 表格布局，可能需要横向滚动 |
| 桌面 (≥ 992px) | 表格视图 | 表格布局，无需横向滚动 |

**切换逻辑**：
```typescript
const screens = useBreakpoint();
const isMobile = !screens.md; // < 768px

{isMobile ? <CardView /> : <TableView />}
```

---

## 性能优化

### 1. 避免重复渲染

**问题**：每次切换 Tab 时重新渲染所有卡片

**优化**：使用 `key` 属性确保 React 正确识别和复用组件

```typescript
{t.data.map(row => (
  <DestinationCard
    key={getCity(row)}  // 使用城市名作为唯一 key
    row={row}
  />
))}
```

### 2. 按需渲染

**问题**：所有 Tab 的数据都被渲染（即使不可见）

**Ant Design 优化**：Tabs 组件默认只渲染当前激活的 Tab 内容

**无需额外优化**：Ant Design 已自动处理

---

## 兼容性说明

- **Ant Design 5.12.0**：完全支持响应式卡片布局
- **React 18**：无兼容性问题
- **浏览器支持**：
  - Chrome/Edge ≥ 90
  - Safari ≥ 14
  - Firefox ≥ 88
  - 移动端浏览器：iOS Safari ≥ 14, Chrome Mobile ≥ 90

---

## 测试验证

### 桌面端（≥ 768px）
- ✅ 显示表格视图
- ✅ 排序功能正常
- ✅ 分页器显示正常
- ✅ 操作按钮点击正常

### 移动端（< 768px）
- ✅ 显示卡片视图
- ✅ 卡片垂直排列，无横向滚动
- ✅ 信息完整显示，易于阅读
- ✅ 操作按钮全宽，触摸友好
- ✅ 切换 Tab 正常

### 功能测试
- ✅ 查看详情（直飞）
- ✅ 查看中转方案（中转）
- ✅ 跳转行程规划
- ✅ 切换 Tab（全部/往返/单程/中转）
- ✅ 数据加载和刷新

---

## 未来优化建议

如果需要进一步提升移动端体验，可以考虑：

1. **虚拟滚动**：使用 `react-window` 或 `react-virtualized` 优化长列表性能
2. **懒加载**：只渲染可视区域的卡片，减少初始渲染时间
3. **骨架屏**：加载数据时显示骨架屏，提升感知性能
4. **下拉刷新**：添加下拉刷新功能，提升移动端体验
5. **滑动操作**：支持左滑/右滑快速操作（如收藏、分享）

---

## 相关文档

- [移动端适配改进总结](./MOBILE_OPTIMIZATION.md) - 完整的移动端适配方案
- [日期选择器修复说明](./DATEPICKER_FIX.md) - 日期选择器移动端优化

---

## 提交记录

**改进日期**：2026-03-20
**编译状态**：✅ 成功通过 TypeScript 类型检查和 Vite 构建
**构建产物大小**：2,729.37 kB (gzip: 884.49 kB)
**新增代码**：约 150 行（DestinationCard 组件）
