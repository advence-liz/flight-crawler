import { calcLeaveDays, isWorkday } from './leave-days';

/** 构造"北京墙钟时间当 UTC"的时刻，与爬虫入库口径一致 */
const at = (iso: string) => new Date(iso);

describe('isWorkday', () => {
  it('普通工作日/周末', () => {
    expect(isWorkday('2026-11-09')).toBe(true); // 周一
    expect(isWorkday('2026-11-13')).toBe(true); // 周五
    expect(isWorkday('2026-11-14')).toBe(false); // 周六
    expect(isWorkday('2026-11-15')).toBe(false); // 周日
  });

  it('法定节假日不算工作日', () => {
    expect(isWorkday('2026-10-01')).toBe(false); // 国庆
    expect(isWorkday('2026-09-25')).toBe(false); // 中秋
  });
});

describe('calcLeaveDays', () => {
  it('周五 18:00 后走、周日回 → 不请假', () => {
    const r = calcLeaveDays(at('2026-11-13T18:00:00Z'), at('2026-11-15T22:00:00Z'));
    expect(r.leaveDays).toBe(0);
    expect(r.noLeaveNeeded).toBe(true);
    expect(r.eveningDeparture).toBe(true);
  });

  it('周五 18:00 后走、周一回 → 请 1 天', () => {
    expect(calcLeaveDays(at('2026-11-13T18:00:00Z'), at('2026-11-16T20:00:00Z')).leaveDays).toBe(1);
  });

  it('周四走、周日回 → 中间周五被占，请 1 天', () => {
    expect(calcLeaveDays(at('2026-11-12T18:00:00Z'), at('2026-11-15T22:00:00Z')).leaveDays).toBe(1);
  });

  it('周五白天走、周日回 → 请 1 天（没赶上"下班后"豁免）', () => {
    expect(calcLeaveDays(at('2026-11-13T08:00:00Z'), at('2026-11-15T22:00:00Z')).leaveDays).toBe(1);
  });

  it('周六走、周日回 → 不请假', () => {
    expect(calcLeaveDays(at('2026-11-14T09:00:00Z'), at('2026-11-15T22:00:00Z')).leaveDays).toBe(0);
  });

  it('周一早班落地（08:00 前）→ 不占周一', () => {
    // 周日 20:00 出发、周一 06:00 落地
    const r = calcLeaveDays(at('2026-11-15T20:00:00Z'), at('2026-11-16T06:00:00Z'));
    expect(r.leaveDays).toBe(0);
    expect(r.earlyArrival).toBe(true);
  });

  it('整段落在国庆假期内 → 不请假', () => {
    // 9/30 20:00 出发（下班后），10/7 回
    expect(calcLeaveDays(at('2026-09-30T20:00:00Z'), at('2026-10-07T22:00:00Z')).leaveDays).toBe(0);
  });

  it('整段落在中秋假期内 → 不请假', () => {
    // 9/24 19:00 出发（周四下班后），9/27 回（中秋 9/25-27）
    expect(calcLeaveDays(at('2026-09-24T19:00:00Z'), at('2026-09-27T22:00:00Z')).leaveDays).toBe(0);
  });

  it('工作日整周 → 按工作日天数计', () => {
    // 周一 09:00 出发、周五 18:00 落地：周一~周五共 5 天
    expect(calcLeaveDays(at('2026-11-09T09:00:00Z'), at('2026-11-13T18:00:00Z')).leaveDays).toBe(5);
  });

  it('超长区间不会死循环（内部有 120 天上限）', () => {
    const r = calcLeaveDays(at('2026-01-01T09:00:00Z'), at('2027-01-01T09:00:00Z'));
    expect(Number.isFinite(r.leaveDays)).toBe(true);
    expect(r.leaveDays).toBeGreaterThan(0);
  });
});
