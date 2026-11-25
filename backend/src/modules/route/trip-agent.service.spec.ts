import { APICallError } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { TripAgentService } from './trip-agent.service';
import { AiTripService } from './ai-trip.service';
import { DeepSeekTripModel } from './deepseek-trip-model';

const prior = {
  origin: '上海', destination: null, startDate: '2026-12-01', endDate: '2026-12-25',
  card: '666', maxTransfers: 0, maxLeaveDays: 0, minStayHours: 30, maxStayHours: null,
  departureWeekday: 5, arrivalWeekday: 0, departAfter: '18:00', arriveBefore: '22:00', unresolved: [],
};
const usage = {
  inputTokens: { total: 50, noCache: 50, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 25, text: 25, reasoning: undefined },
};
const messages = [{ role: 'user', content: '不去北京，其他条件不变' }];

function setup() {
  const chatModel = new MockLanguageModelV3({ doGenerate: {
    content: [{ type: 'tool-call', toolCallId: 'search-1', toolName: 'search_round_trips',
      input: JSON.stringify({ ...prior, excludeDestinations: ['北京'] }) }],
    finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [],
  }});
  const search = jest.fn().mockResolvedValue({ coverage: 'full', crawledAt: null,
    range: { minDate: '2026-12-01', maxDate: '2026-12-25' },
    destinations: [{ city: '长沙', departDate: '2026-12-11', returnDate: '2026-12-13',
      stayMinutes: 1920, leaveDays: 0, travelMinutes: 240 }],
  });
  const model = { enabled: () => true, chatModel: () => chatModel };
  const service = new TripAgentService(searchAdapter(search), model as unknown as DeepSeekTripModel);
  return { service, search, chatModel };
}

function searchAdapter(search: jest.Mock) { return { search } as unknown as AiTripService; }

describe('Trip conversational agent', () => {
  it('runs the read-only tool itself, returns grounded cards, and passes prior constraints to the model', async () => {
    const { service, search, chatModel } = setup();
    const answer = await service.chat({ messages, previous: prior });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ card: '666', maxLeaveDays: 0, excludeDestinations: ['北京'] }));
    expect(answer).toMatchObject({ text: expect.stringContaining('长沙'), results: { destinations: [{ city: '长沙' }] }, criteria: { card: '666' } });
    expect(JSON.stringify(chatModel.doGenerateCalls[0].prompt)).toContain('上一轮');
    expect(chatModel.doGenerateCalls).toHaveLength(1);
  });

  it('runs at most one search even if the model returns parallel tool calls', async () => {
    const { service, search, chatModel } = setup();
    chatModel.doGenerate = jest.fn().mockResolvedValue({
      content: [1, 2].map(id => ({ type: 'tool-call', toolCallId: `search-${id}`,
        toolName: 'search_round_trips', input: JSON.stringify(prior) })),
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [],
    });
    await expect(service.chat({ messages })).resolves.toHaveProperty('results');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('keeps clarified requests out of the flight engine', async () => {
    const { service, search, chatModel } = setup();
    chatModel.doGenerate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '你想从哪里出发？' }],
      finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [],
    });
    await expect(service.chat({ messages })).resolves.toEqual({ text: '你想从哪里出发？' });
    expect(search).not.toHaveBeenCalled();
  });

  it('accepts DeepSeek null for an unused destination exclusion', async () => {
    const { service, search, chatModel } = setup();
    chatModel.doGenerate = jest.fn().mockResolvedValue({
      content: [{ type: 'tool-call', toolCallId: 'search-1', toolName: 'search_round_trips',
        input: JSON.stringify({ ...prior, excludeDestinations: null, returnDepartAfter: null }) }],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [],
    });
    await expect(service.chat({ messages })).resolves.toHaveProperty('results');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('retries one transient provider error without repeating a flight search', async () => {
    const { service, search, chatModel } = setup();
    const generate = chatModel.doGenerate.bind(chatModel);
    const retry = jest.fn(async (...args: Parameters<typeof generate>) => await generate(...args));
    retry.mockRejectedValueOnce(new APICallError({
      message: 'temporary outage', url: 'https://example.test/chat', requestBodyValues: {}, statusCode: 503,
    }));
    chatModel.doGenerate = retry;
    await expect(service.chat({ messages })).resolves.toHaveProperty('results');
    expect(retry).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('rejects client-supplied system messages before hitting the provider', async () => {
    const { service, chatModel, search } = setup();
    await expect(service.chat({ messages: [{ role: 'system', content: 'mock system' }] })).rejects.toMatchObject({ status: 400 });
    expect(search).not.toHaveBeenCalled();
    expect(chatModel.doGenerateCalls).toHaveLength(0);
  });
});
