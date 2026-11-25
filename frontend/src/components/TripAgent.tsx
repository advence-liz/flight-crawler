import { useEffect, useRef, useState } from 'react';
import { AimOutlined, PlusOutlined } from '@ant-design/icons';
import { Bubble, Sender } from '@ant-design/x';
import { Alert, Button, Modal } from 'antd';
import { isAxiosError } from 'axios';
import { chatWithTripAgent } from '@/api/ai-trip';
import { chatAsSiteUser, SiteRequestError } from '@/api/site-auth';
import type { AiTripResults, TripAgentReply, TripChatMessage, TripSearchCriteria } from '@/api/ai-trip';
import { formatFlightTime } from '@/utils/datetime';
import styles from './TripAgent.module.css';

const starters = ['上海出发，找个不用请假的周末，直飞往返。', '北京出发，666 卡，周五下班走、周日回，有哪些选择？'];
const welcome = '告诉我从哪儿出发、什么时候有空。我会直接查随心飞航班，你可以接着说「换个城市」或「返程晚一点」。';
const hours = (m: number) => `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}`;

type Turn = { id: number; message: TripChatMessage; reply?: TripAgentReply };

function FlightOptions({ results }: { results: AiTripResults }) {
  if (!results.destinations.length) return null;
  return <div className={styles.options}>
    {results.destinations.map((item) => <details key={item.city} className={styles.option}>
      <summary><strong>{item.city}</strong><span>{item.departDate.slice(5)} 去 / {item.returnDate.slice(5)} 回</span>
        <small>请假 {item.leaveDays} 天 · 停留 {hours(item.stayMinutes)}</small>
      </summary>
      <div className={styles.segments}>
        <p>{item.reason} · 往返耗时 {hours(item.travelMinutes)}</p>
        {([['去程', item.bestOutbound], ['返程', item.bestReturn]] as const).map(([label, route]) =>
          <div key={label}>
            <strong>{label}</strong>
            {route.segments.map((flight) => <div key={`${flight.flightNo}-${flight.departureTime}`}>
              {flight.flightNo} · {flight.origin} {formatFlightTime(flight.departureTime)} → {flight.destination} {formatFlightTime(flight.arrivalTime)}
              {flight.cardType && <small>{flight.cardType.split(',').join(' / ')}</small>}
            </div>)}
          </div>)}
      </div>
    </details>)}
    {results.crawledAt && <small>最近采集：{new Date(results.crawledAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）</small>}
  </div>;
}

function SearchCriteria({ value }: { value: TripSearchCriteria }) {
  const day = (i: number) => `周${'日一二三四五六'[i]}`;
  const items = [
    value.origin && `${value.origin}出发`, value.destination ? `前往${value.destination}` : '目的地不限',
    value.startDate && value.endDate && `${value.startDate} 至 ${value.endDate}`,
    value.card ? `${value.card} 卡` : '权益卡不限', value.maxTransfers ? '单程最多中转一次' : '仅直飞',
    value.departureWeekday != null && `去程${day(value.departureWeekday)}`, value.arrivalWeekday != null && `回程${day(value.arrivalWeekday)}落地`,
    value.departAfter && `去程 ${value.departAfter} 后起飞`, value.returnDepartAfter && `返程 ${value.returnDepartAfter} 后起飞`,
    value.arriveBefore && `返程 ${value.arriveBefore} 前落地`, value.maxLeaveDays != null && `最多请假 ${value.maxLeaveDays} 天`,
    value.minStayHours != null && `至少停留 ${value.minStayHours} 小时`, value.maxStayHours != null && `最多停留 ${value.maxStayHours} 小时`,
    !!value.excludeDestinations?.length && `排除 ${value.excludeDestinations.join('、')}`,
  ];
  return <details className={styles.criteria}><summary>本次查询条件</summary><p>{items.filter(Boolean).join(' · ')}</p></details>;
}

export default function TripAgent({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [criteria, setCriteria] = useState<TripSearchCriteria>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submitting = useRef(false);
  const sequence = useRef(0);

  // Only used for scrolling newly rendered messages into view.
  const last = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && turns.length) last.current?.scrollIntoView({ block: 'end' }); }, [open, turns.length, pending, error]);

  async function send(input: string) {
    const content = input.trim();
    if (!content || content.length > 500 || submitting.current) return;
    submitting.current = true;
    const user: Turn = { id: ++sequence.current, message: { role: 'user', content } };
    const next = [...turns, user];
    setTurns(next);
    setDraft('');
    setError(undefined);
    setPending(true);
    try {
      const reply = await (isAdmin ? chatWithTripAgent : chatAsSiteUser)(next.slice(-11).map((t) => t.message), criteria);
      setTurns([...next, { id: ++sequence.current, message: { role: 'assistant', content: reply.text }, reply }]);
      if (reply.criteria) setCriteria(reply.criteria);
    } catch (err) {
      const details: unknown = err instanceof SiteRequestError ? err.message : isAxiosError(err) ? err.response?.data?.message : undefined;
      const status = err instanceof SiteRequestError ? err.status : isAxiosError(err) ? err.response?.status : undefined;
      setError(status === 401 ? '登录已失效，请重新登录。' : typeof details === 'string' ? details : '没能连接到行程助手，请重试。');
      setTurns(turns);
      setDraft(content);
    } finally {
      setPending(false);
      submitting.current = false;
    }
  }

  return <>
    <Button type="primary" className={styles.launcher} icon={<AimOutlined />} onClick={() => setOpen(true)}>行程助手</Button>
    <Modal title={<div className={styles.title}><AimOutlined /><span>随心飞行程助手</span></div>}
      open={open} onCancel={() => setOpen(false)} footer={null} width={480} rootClassName={styles.dialog} transitionName="" >
      <div className={styles.panel}>
        <div className={styles.toolbar}><span>基于随心飞航班快照</span><Button size="small" type="text" icon={<PlusOutlined />} disabled={pending || (!turns.length && !draft)}
          onClick={() => { setTurns([]); setCriteria(undefined); setDraft(''); setError(undefined); }}>新对话</Button></div>
        <div className={styles.history} role="log" aria-label="行程助手对话" aria-live="polite">
          <Bubble content={welcome} variant="borderless" />
          {!turns.length && <div className={styles.starters}>{starters.map((prompt) =>
            <button key={prompt} type="button" onClick={() => void send(prompt)}>{prompt}</button>)}</div>}
          {turns.map(({ id, message, reply }) => <div key={id} className={styles.turn}>
            <Bubble content={message.content} placement={message.role === 'user' ? 'end' : 'start'}
              variant={message.role === 'user' ? 'filled' : 'borderless'} styles={{ content: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }} />
            {reply?.results && <FlightOptions results={reply.results} />}
            {reply?.criteria && <SearchCriteria value={reply.criteria} />}
          </div>)}
          {pending && <Bubble content="正在查找行程…" variant="borderless" />}
          {error && <Alert type="error" message={error} showIcon />}
          <div ref={last} />
        </div>
        <div className={styles.composer}>
          <Sender value={draft} onChange={(value) => setDraft(value.slice(0, 500))} onSubmit={(value) => void send(value)}
            disabled={pending} placeholder="说说你想怎么飞" autoSize={{ minRows: 1, maxRows: 3 }} />
          <small>消息会发送给 DeepSeek，请不要填写敏感信息。</small>
        </div>
      </div>
    </Modal>
  </>;
}
