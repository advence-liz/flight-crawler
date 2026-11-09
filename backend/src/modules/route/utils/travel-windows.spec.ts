import { findTravelWindows } from './travel-windows';

describe('findTravelWindows', () => {
  it('识别出中秋、国庆这类法定节假日窗口', () => {
    const windows = findTravelWindows('2026-09-20', '2026-10-10');
    const labels = windows.map(w => w.label);
    expect(labels).toContain('中秋');
    expect(labels).toContain('国庆节');
  });

  it('普通周末也会成为窗口，类型是 weekend', () => {
    const windows = findTravelWindows('2026-11-01', '2026-11-30');
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every(w => w.type === 'weekend')).toBe(true);
  });

  it('去程从假期前一天开始（下班后走），返程到假期最后一天', () => {
    const windows = findTravelWindows('2026-11-01', '2026-11-30');
    const first = windows[0];
    expect(first.departStart < first.startDate).toBe(true);
    expect(first.returnEnd).toBe(first.endDate);
    expect(first.departEnd >= first.departStart).toBe(true);
    expect(first.returnStart >= first.departEnd).toBe(true);
  });

  it('单天休息日不成行', () => {
    // 只有一天休息时不应该产生窗口
    const windows = findTravelWindows('2026-11-16', '2026-11-16');
    expect(windows).toHaveLength(0);
  });

  it('区间倒置 / 非法日期不抛错', () => {
    expect(findTravelWindows('2026-11-30', '2026-11-01')).toEqual([]);
    expect(findTravelWindows('bad-date', '2026-11-30')).toEqual([]);
  });
});
