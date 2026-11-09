import { RouteResultDto } from '../dto/route-result.dto';
import {
  outboundBucket,
  returnBucket,
  pickCandidatesPerDate,
  keepBestPerDatePair,
} from './route-candidates';

function makeRoute(departureIso: string, arrivalIso: string, score: number): RouteResultDto {
  return {
    segments: [
      {
        flightNo: `F${score}`,
        origin: 'A',
        destination: 'B',
        departureTime: new Date(departureIso),
        arrivalTime: new Date(arrivalIso),
        duration: 60,
      },
    ],
    totalDuration: 60,
    transferCount: 0,
    layovers: [],
    score,
  };
}

describe('分桶', () => {
  it('去程按起飞时段分早/午/晚', () => {
    expect(outboundBucket(makeRoute('2026-11-13T08:00:00Z', '2026-11-13T10:00:00Z', 1))).toBe('morning');
    expect(outboundBucket(makeRoute('2026-11-13T11:59:00Z', '2026-11-13T13:59:00Z', 1))).toBe('morning');
    expect(outboundBucket(makeRoute('2026-11-13T17:59:00Z', '2026-11-13T19:59:00Z', 1))).toBe('afternoon');
    expect(outboundBucket(makeRoute('2026-11-13T18:00:00Z', '2026-11-13T20:00:00Z', 1))).toBe('evening');
    expect(outboundBucket(makeRoute('2026-11-13T21:00:00Z', '2026-11-13T23:00:00Z', 1))).toBe('evening');
  });

  it('返程：08:00 前落地单独一桶，其余按起飞时段', () => {
    expect(returnBucket(makeRoute('2026-11-16T04:00:00Z', '2026-11-16T07:59:00Z', 1))).toBe('early-arrival');
    expect(returnBucket(makeRoute('2026-11-16T04:00:00Z', '2026-11-16T08:00:00Z', 1))).toBe('morning');
    expect(returnBucket(makeRoute('2026-11-16T14:00:00Z', '2026-11-16T16:00:00Z', 1))).toBe('afternoon');
    expect(returnBucket(makeRoute('2026-11-16T21:25:00Z', '2026-11-16T23:45:00Z', 1))).toBe('evening');
  });

  it('周日返程：白天的航班再快，也不能把晚班挤掉', () => {
    // 真实数据：9/27 杭州→北京 有 07:30、08:25（白天）和 21:25（晚上）
    const routes = [
      makeRoute('2026-09-27T07:30:00Z', '2026-09-27T09:45:00Z', 100),
      makeRoute('2026-09-27T08:25:00Z', '2026-09-27T10:40:00Z', 99),
      makeRoute('2026-09-27T21:25:00Z', '2026-09-27T23:45:00Z', 80),
    ];
    const picked = pickCandidatesPerDate(routes, 2, returnBucket);
    expect(picked.some(r => returnBucket(r) === 'evening')).toBe(true);
  });
});

describe('pickCandidatesPerDate', () => {
  it('晚班评分更低也不会被淘汰（去程）', () => {
    const routes = [
      makeRoute('2026-11-13T08:00:00Z', '2026-11-13T10:00:00Z', 100),
      makeRoute('2026-11-13T09:00:00Z', '2026-11-13T11:00:00Z', 99),
      makeRoute('2026-11-13T19:00:00Z', '2026-11-13T21:00:00Z', 90),
      makeRoute('2026-11-13T21:00:00Z', '2026-11-13T23:00:00Z', 80),
    ];
    const picked = pickCandidatesPerDate(routes, 2, outboundBucket);
    const evening = picked.filter(r => outboundBucket(r) === 'evening');
    expect(evening.length).toBeGreaterThan(0);
    // 每桶各取前 2
    expect(picked.length).toBe(4);
  });

  it('早到评分更低也不会被淘汰（返程）', () => {
    const routes = [
      makeRoute('2026-11-15T20:00:00Z', '2026-11-15T22:00:00Z', 100),
      makeRoute('2026-11-15T22:00:00Z', '2026-11-16T00:30:00Z', 99),
      makeRoute('2026-11-15T18:00:00Z', '2026-11-16T05:00:00Z', 60),
    ];
    const picked = pickCandidatesPerDate(routes, 1, returnBucket);
    const early = picked.filter(r => returnBucket(r) === 'early-arrival');
    expect(early.length).toBe(1);
    expect(picked.length).toBeGreaterThanOrEqual(2); // 早到桶 + 晚走桶各至少 1
  });

  it('不同日期互不影响', () => {
    const routes = [
      makeRoute('2026-11-13T08:00:00Z', '2026-11-13T10:00:00Z', 100),
      makeRoute('2026-11-14T08:00:00Z', '2026-11-14T10:00:00Z', 90),
    ];
    const picked = pickCandidatesPerDate(routes, 1, outboundBucket);
    expect(picked.length).toBe(2);
  });

  it('空 segments 不抛错', () => {
    const broken = { segments: [], totalDuration: 0, transferCount: 0, layovers: [], score: 1 } as unknown as RouteResultDto;
    expect(() => pickCandidatesPerDate([broken], 2, outboundBucket)).not.toThrow();
    expect(pickCandidatesPerDate([broken], 2, outboundBucket)).toHaveLength(0);
  });
});

describe('keepBestPerDatePair', () => {
  const r = (departDate: string, returnDate: string) => ({ departDate, returnDate });

  it('同一对日期只留排名最高的那条', () => {
    const routes = [
      r('2026-11-13', '2026-11-15'),
      r('2026-11-13', '2026-11-15'),
      r('2026-11-20', '2026-11-22'),
    ];
    expect(keepBestPerDatePair(routes, 5)).toEqual([
      r('2026-11-13', '2026-11-15'),
      r('2026-11-20', '2026-11-22'),
    ]);
  });

  it('不拿重复组合凑数', () => {
    const routes = Array.from({ length: 10 }, () => r('2026-11-13', '2026-11-15'));
    expect(keepBestPerDatePair(routes, 5).length).toBe(1);
  });

  it('limit 生效', () => {
    const routes = [
      r('2026-11-13', '2026-11-15'),
      r('2026-11-20', '2026-11-22'),
      r('2026-11-27', '2026-11-29'),
    ];
    expect(keepBestPerDatePair(routes, 2).length).toBe(2);
  });
});
