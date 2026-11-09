import { evaluateTripPattern } from './trip-pattern';

/**
 * 2026-11-09 是周一：
 *   11-13 周五、11-14 周六、11-15 周日
 * 航班时间按北京墙钟时间入库，这里用 UTC 字符串构造（口径与 leave-days 一致）。
 */
const at = (s: string) => new Date(s);

describe('evaluateTripPattern', () => {

  it('周五晚走、周日回：满分行且过 2 晚', () => {
    const p = evaluateTripPattern(
      at('2026-11-13T20:00:00Z'), // 周五 20:00 出发
      at('2026-11-15T16:00:00Z'), // 周日 16:00 返程起飞
      at('2026-11-15T18:00:00Z'), // 周日 18:00 落地
    );
    expect(p.nights).toBe(2);
    expect(p.weekendScore).toBe(100);
    expect(p.label).toBe('周五走 · 周日回');
  });

  it('周六上午走、周日晚回：次高分', () => {
    const p = evaluateTripPattern(
      at('2026-11-14T08:00:00Z'),
      at('2026-11-15T19:00:00Z'),
      at('2026-11-15T21:00:00Z'),
    );
    expect(p.nights).toBe(1);
    expect(p.weekendScore).toBe(92);
  });

  it('当天往返（周六走周六回）拿不到过夜分，明显低于周末行程', () => {
    const sameDay = evaluateTripPattern(
      at('2026-11-14T08:00:00Z'),
      at('2026-11-14T18:00:00Z'),
      at('2026-11-14T20:00:00Z'),
    );
    const weekend = evaluateTripPattern(
      at('2026-11-13T20:00:00Z'),
      at('2026-11-15T16:00:00Z'),
      at('2026-11-15T18:00:00Z'),
    );
    expect(sameDay.nights).toBe(0);
    expect(sameDay.weekendScore).toBeLessThan(weekend.weekendScore - 20);
  });

  it('工作日白天走、当天回：分数最低', () => {
    const p = evaluateTripPattern(
      at('2026-11-11T09:00:00Z'), // 周三
      at('2026-11-11T18:00:00Z'),
      at('2026-11-11T20:00:00Z'),
    );
    expect(p.nights).toBe(0);
    expect(p.weekendScore).toBeLessThanOrEqual(20);
  });

  it('排序符合人类直觉：周五晚→周日 > 周六早→周日 > 周六→周六 > 周三当天往返', () => {
    const weekendFront = evaluateTripPattern(
      at('2026-11-13T20:00:00Z'), at('2026-11-15T16:00:00Z'), at('2026-11-15T18:00:00Z'),
    ).weekendScore;
    const satMorning = evaluateTripPattern(
      at('2026-11-14T08:00:00Z'), at('2026-11-15T19:00:00Z'), at('2026-11-15T21:00:00Z'),
    ).weekendScore;
    const satSameDay = evaluateTripPattern(
      at('2026-11-14T08:00:00Z'), at('2026-11-14T18:00:00Z'), at('2026-11-14T20:00:00Z'),
    ).weekendScore;
    const weekdaySameDay = evaluateTripPattern(
      at('2026-11-11T09:00:00Z'), at('2026-11-11T18:00:00Z'), at('2026-11-11T20:00:00Z'),
    ).weekendScore;

    expect(weekendFront).toBeGreaterThan(satMorning);
    expect(satMorning).toBeGreaterThan(satSameDay);
    expect(satSameDay).toBeGreaterThan(weekdaySameDay);
  });

  it('周日回程偏好：傍晚走 > 一大早走（当天不至于全耗在路上）', () => {
    const lateSunday = evaluateTripPattern(
      at('2026-11-13T20:00:00Z'),
      at('2026-11-15T17:00:00Z'), // 周日下午走
      at('2026-11-15T19:00:00Z'),
    );
    const earlySunday = evaluateTripPattern(
      at('2026-11-13T20:00:00Z'),
      at('2026-11-15T08:00:00Z'), // 周日一早走
      at('2026-11-15T10:00:00Z'),
    );
    expect(lateSunday.weekendScore).toBeGreaterThan(earlySunday.weekendScore);
  });

  it('跨周（周五走下周一早班机回）仍算周末友好', () => {
    const p = evaluateTripPattern(
      at('2026-11-13T20:00:00Z'),
      at('2026-11-16T06:00:00Z'),
      at('2026-11-16T07:30:00Z'),
    );
    expect(p.nights).toBe(3);
    expect(p.weekendScore).toBeGreaterThanOrEqual(85);
  });
});
