import { RouteResultDto } from '../dto/route-result.dto';
import {
  outboundBucket,
  returnBucket,
  pickCandidatesPerDate,
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
  it('去程按是否 18:00 后出发分桶', () => {
    expect(outboundBucket(makeRoute('2026-11-13T08:00:00Z', '2026-11-13T10:00:00Z', 1))).toBe('day');
    expect(outboundBucket(makeRoute('2026-11-13T17:59:00Z', '2026-11-13T19:59:00Z', 1))).toBe('day');
    expect(outboundBucket(makeRoute('2026-11-13T18:00:00Z', '2026-11-13T20:00:00Z', 1))).toBe('evening');
    expect(outboundBucket(makeRoute('2026-11-13T21:00:00Z', '2026-11-13T23:00:00Z', 1))).toBe('evening');
  });

  it('返程按是否 08:00 前落地分桶', () => {
    expect(returnBucket(makeRoute('2026-11-16T04:00:00Z', '2026-11-16T07:59:00Z', 1))).toBe('early');
    expect(returnBucket(makeRoute('2026-11-16T04:00:00Z', '2026-11-16T08:00:00Z', 1))).toBe('late');
    expect(returnBucket(makeRoute('2026-11-16T14:00:00Z', '2026-11-16T16:00:00Z', 1))).toBe('late');
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
    const early = picked.filter(r => returnBucket(r) === 'early');
    expect(early.length).toBe(1);
    expect(picked.length).toBe(2); // early 1 + late 1
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
