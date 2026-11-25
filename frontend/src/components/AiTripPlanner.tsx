import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Input, InputNumber, Row, Select, Space, Tag, Typography } from 'antd';
import { isAxiosError } from 'axios';
import { getAiTripStatus, interpretAiTrip, searchAiTrip } from '@/api/ai-trip';
import type { AiTripIntent, AiTripResults } from '@/api/ai-trip';
import { formatFlightTime } from '@/utils/datetime';

const weekdays = ['日', '一', '二', '三', '四', '五', '六'].map((day, value) => ({ label: `周${day}`, value }));
const example = '上海出发，下个月周五下班后走，周日晚上 10 点前落地，只用 666 卡，不中转，不请假，在当地至少停留 30 小时。';

function duration(minutes: number) {
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

export default function AiTripPlanner() {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<AiTripIntent>();
  const [results, setResults] = useState<AiTripResults>();
  const [busy, setBusy] = useState<'interpret' | 'search'>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let mounted = true;
    getAiTripStatus().then(result => { if (mounted) setEnabled(result.enabled); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  function update<K extends keyof AiTripIntent>(key: K, value: AiTripIntent[K]) {
    setIntent(prev => prev && { ...prev, [key]: value });
    setResults(undefined);
    setError(undefined);
  }

  async function run(action: 'interpret' | 'search') {
    setBusy(action);
    setError(undefined);
    setResults(undefined);
    try {
      if (action === 'interpret') {
        setIntent(undefined);
        setIntent(await interpretAiTrip(text));
      } else if (intent) {
        setResults(await searchAiTrip(intent));
      }
    } catch (err) {
      const detail: unknown = isAxiosError(err) ? err.response?.data?.message : undefined;
      setError(typeof detail === 'string' ? detail : '请求失败，请稍后重试或使用下方普通规划。');
    } finally {
      setBusy(undefined);
    }
  }

  if (!enabled) return null;

  function field(label: string, control: React.ReactNode) {
    return <Col key={label} xs={12} md={8} lg={6}>
      <label><Typography.Text type="secondary">{label}</Typography.Text>{control}</label>
    </Col>;
  }

  return <Card title="AI 随心飞规划" size="small" style={{ marginBottom: 16 }}>
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Text type="secondary">用一句话说你什么时候有空。出行描述会发送给 DeepSeek 解析，请勿填写个人敏感信息。</Typography.Text>
      <Input.TextArea aria-label="出行需求" value={text} maxLength={500} showCount autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder={example} disabled={!!busy} onChange={event => {
          setText(event.target.value);
          setIntent(undefined);
          setResults(undefined);
          setError(undefined);
        }} />
      <Button onClick={() => void run('interpret')} loading={busy === 'interpret'} disabled={!text.trim() || !!busy}>
        用 DeepSeek 解析
      </Button>
      {error && <Alert type="error" showIcon message={error} />}
      {intent && <>
        <Typography.Text strong>确认行程条件（北京时间，可修改）</Typography.Text>
        {intent.unresolved.length > 0 && <Alert type="warning" showIcon message="这些条件暂不能执行，请改写描述再解析"
          description={intent.unresolved.join('；')} />}
        <Row gutter={[12, 8]}>
          {field('出发地', <Input aria-label="出发地" value={intent.origin ?? ''} maxLength={40} disabled={!!busy} onChange={e => update('origin', e.target.value || null)} />)}
          {field('目的地', <Input aria-label="目的地" placeholder="不限" value={intent.destination ?? ''} maxLength={40} disabled={!!busy} onChange={e => update('destination', e.target.value || null)} />)}
          {field('最早出发日期', <Input aria-label="最早出发日期" type="date" value={intent.startDate ?? ''} disabled={!!busy} onChange={e => update('startDate', e.target.value || null)} />)}
          {field('最晚返回日期', <Input aria-label="最晚返回日期" type="date" value={intent.endDate ?? ''} disabled={!!busy} onChange={e => update('endDate', e.target.value || null)} />)}
          {field('去程星期', <Select aria-label="去程星期" options={weekdays} value={intent.departureWeekday ?? undefined} placeholder="不限" allowClear disabled={!!busy} style={{ width: '100%' }} onChange={value => update('departureWeekday', value ?? null)} />)}
          {field('返程落地星期', <Select aria-label="返程落地星期" options={weekdays} value={intent.arrivalWeekday ?? undefined} placeholder="不限" allowClear disabled={!!busy} style={{ width: '100%' }} onChange={value => update('arrivalWeekday', value ?? null)} />)}
          {field('去程最早起飞', <Input aria-label="去程最早起飞" type="time" value={intent.departAfter ?? ''} disabled={!!busy} onChange={e => update('departAfter', e.target.value || null)} />)}
          {field('返程最晚落地', <Input aria-label="返程最晚落地" type="time" value={intent.arriveBefore ?? ''} disabled={!!busy} onChange={e => update('arriveBefore', e.target.value || null)} />)}
          {field('权益卡', <Select aria-label="权益卡" style={{ width: '100%' }} value={intent.card ?? undefined} options={[{ label: '666 卡', value: '666' }, { label: '2666 卡', value: '2666' }]} allowClear placeholder="不限" disabled={!!busy} onChange={value => update('card', value ?? null)} />)}
          {field('单程中转上限', <Select aria-label="单程中转上限" style={{ width: '100%' }} value={intent.maxTransfers} options={[{ label: '仅直飞', value: 0 }, { label: '最多一次', value: 1 }]} disabled={!!busy} onChange={value => update('maxTransfers', value)} />)}
          {field('最多请假（天）', <InputNumber aria-label="最多请假" value={intent.maxLeaveDays} placeholder="不限" min={0} max={42} precision={0} disabled={!!busy} style={{ width: '100%' }} onChange={value => update('maxLeaveDays', value)} />)}
          {field('最少停留（小时）', <InputNumber aria-label="最少停留" value={intent.minStayHours} placeholder="不限" min={0} max={1008} precision={0} disabled={!!busy} style={{ width: '100%' }} onChange={value => update('minStayHours', value)} />)}
          {field('最多停留（小时）', <InputNumber aria-label="最多停留" value={intent.maxStayHours} placeholder="不限" min={0} max={1008} precision={0} disabled={!!busy} style={{ width: '100%' }} onChange={value => update('maxStayHours', value)} />)}
        </Row>
        <Button type="primary" loading={busy === 'search'} disabled={!!busy || !!intent.unresolved.length || !intent.origin || !intent.startDate || !intent.endDate}
          onClick={() => void run('search')}>确认并搜索往返</Button>
      </>}
      {results && <>
        <Typography.Text type="secondary">航班来自采集快照，不代表实时余票。{results.crawledAt &&
          ` 库内最近采集：${new Date(results.crawledAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）。`}</Typography.Text>
        {results.coverage !== 'full' && <Alert type="warning" showIcon message={results.coverage === 'none' ? '该日期区间没有航班快照覆盖' : '仅搜索了与航班快照重叠的部分日期'}
          description={results.range.minDate && results.range.maxDate ? `已采集日期范围：${results.range.minDate} 至 ${results.range.maxDate}（不代表每天都有数据）` : '当前数据库没有航班快照'} />}
        {!results.destinations.length && results.coverage !== 'none' && <Empty description="当前快照没有符合全部条件的往返；可手动调整日期、起降时间或停留限制再查。" />}
        {results.destinations.map(item => <Card key={item.city} size="small" title={item.city} extra={<Tag>{item.reason}</Tag>}>
          <p>请假 {item.leaveDays} 天 · 停留 {duration(item.stayMinutes)} · 往返耗时 {duration(item.travelMinutes)}</p>
          {([['去程', item.bestOutbound], ['返程', item.bestReturn]] as const).map(([direction, route]) =>
            <div key={direction}><strong>{direction}</strong>
              {route.segments.map(flight => <div key={`${flight.flightNo}-${flight.departureTime}`}>
                {flight.flightNo} · {flight.origin} {formatFlightTime(flight.departureTime)} → {flight.destination} {formatFlightTime(flight.arrivalTime)}
                {flight.cardType && ` · ${flight.cardType}`}
              </div>)}
            </div>)}
        </Card>)}
      </>}
    </Space>
  </Card>;
}
