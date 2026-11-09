import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Card,
  Form,
  DatePicker,
  Button,
  Space,
  message,
  InputNumber,
  Timeline,
  Tag,
  Empty,
  Select,
  Row,
  Col,
  Divider,
  Grid,
} from 'antd';
import {
  SearchOutlined,
  ClockCircleOutlined,
  RightOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  planRoute,
  planRoundTrip,
  exploreDestinations,
  RouteResult,
  RoundTripResult,
  ExploreDestination,
  getRouteDateWindow,
  RouteDateWindow,
} from '@/api/route';
import { getAvailableCities } from '@/api/flight';
import { getDefaultOrigin, setOriginCookie, getDefaultDateRange } from '@/utils/cookie';
import { PRESET_CITIES, mergeOriginOptions } from '@/utils/cities';
import CuteLoader from '@/components/CuteLoader';

const { useBreakpoint } = Grid;

// ─── 工具函数 ───────────────────────────────────────────────

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function formatDate(dt: string): string {
  return dayjs(dt).format('MM-DD HH:mm');
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** YYYY-MM-DD -> "09-25（周五）"。日期口径与后端一致，按 UTC 读取北京墙钟日期 */
function formatDayWithWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${dateStr.slice(5)}（${WEEKDAY_LABELS[d.getUTCDay()]}）`;
}

// ─── 单程方案时间线 ─────────────────────────────────────────

interface RouteTimelineProps {
  route: RouteResult;
  color?: string;
}

function RouteTimeline({ route, color = 'blue' }: RouteTimelineProps) {
  const items: any[] = [];

  route.segments.forEach((seg, idx) => {
    items.push({
      color,
      children: (
        <div>
          <Space size={4}>
            <Tag style={{ fontFamily: 'monospace', fontSize: 11 }}>{seg.flightNo}</Tag>
            <span style={{ fontWeight: 500 }}>{seg.origin}</span>
            <ArrowRightOutlined style={{ fontSize: 10, color: '#999' }} />
            <span style={{ fontWeight: 500 }}>{seg.destination}</span>
          </Space>
          <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
            {formatDate(seg.departureTime)} → {formatDate(seg.arrivalTime)}
            <span style={{ marginLeft: 8, color: '#bbb' }}>({formatDuration(seg.duration)})</span>
          </div>
        </div>
      ),
    });

    // 中转停留
    if (idx < route.layovers.length) {
      const layover = route.layovers[idx];
      items.push({
        color: 'gray',
        dot: <ClockCircleOutlined style={{ fontSize: 10 }} />,
        children: (
          <div style={{ color: '#aaa', fontSize: 12 }}>
            在 <strong>{layover.city}</strong> 候机 {formatDuration(layover.duration)}
          </div>
        ),
      });
    }
  });

  return <Timeline items={items} style={{ marginTop: 8 }} />;
}

// ─── 往返方案卡片 ───────────────────────────────────────────

interface RoundTripCardProps {
  result: RoundTripResult;
  index: number;
}

function RoundTripCard({ result, index }: RoundTripCardProps) {
  const isDirectBoth = result.outbound.transferCount === 0 && result.return.transferCount === 0;

  const header = (
    <Space size={4} wrap>
      <span style={{ color: '#666', fontSize: 12 }}>#{index}</span>
      {result.noLeaveNeeded
        ? <Tag color="success" style={{ margin: 0 }}>不请假</Tag>
        : <Tag color="warning" style={{ margin: 0 }}>请 {result.leaveDays} 天</Tag>
      }
      {isDirectBoth ? <Tag color="green" style={{ margin: 0 }}>双直飞</Tag> : <Tag color="blue" style={{ margin: 0 }}>含中转</Tag>}
      <Tag icon={<ClockCircleOutlined />} color="default" style={{ margin: 0 }}>总 {formatDuration(result.totalDuration)}</Tag>
    </Space>
  );

  return (
    <Card size="small" style={{ height: '100%' }} title={header}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
        {formatDayWithWeekday(result.departDate)} 出发 · {formatDayWithWeekday(result.returnDate)} 返回
      </div>
      <div style={{ marginBottom: 4 }}>
        <Tag color="blue">✈ 去程</Tag>
        <span style={{ color: '#888', fontSize: 12, marginLeft: 4 }}>
          {formatDuration(result.outbound.totalDuration)}
          {result.outbound.transferCount > 0 && ` · ${result.outbound.transferCount} 次中转`}
        </span>
      </div>
      <RouteTimeline route={result.outbound} color="blue" />
      <Divider style={{ margin: '8px 0' }} dashed />
      <div style={{ marginBottom: 4 }}>
        <Tag color="orange">↩ 返程</Tag>
        <span style={{ color: '#888', fontSize: 12, marginLeft: 4 }}>
          {formatDuration(result.return.totalDuration)}
          {result.return.transferCount > 0 && ` · ${result.return.transferCount} 次中转`}
        </span>
      </div>
      <RouteTimeline route={result.return} color="orange" />
    </Card>
  );
}

// ─── 探索目的地卡片 ─────────────────────────────────────────

interface ExploreCardProps {
  dest: ExploreDestination;
  onViewAll: () => void;
}

function ExploreCard({ dest, onViewAll }: ExploreCardProps) {
  const out = dest.bestOutbound;
  const ret = dest.bestReturn;
  const isDirect = out.transferCount === 0 && ret.transferCount === 0;

  return (
    <Card
      size="small"
      style={{ height: '100%' }}
      title={
        <Space wrap>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{dest.city}</span>
          {isDirect
            ? <Tag color="green" style={{ fontSize: 11 }}>直飞往返</Tag>
            : <Tag color="orange" style={{ fontSize: 11 }}>含中转</Tag>
          }
          {dest.noLeaveNeeded
            ? <Tag color="success" style={{ fontSize: 11 }}>不请假</Tag>
            : <Tag color="warning" style={{ fontSize: 11 }}>请 {dest.leaveDays} 天</Tag>
          }
        </Space>
      }
      extra={
        <Button type="link" size="small" icon={<RightOutlined />} onClick={onViewAll}>
          查看方案
        </Button>
      }
    >
      <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
        {formatDayWithWeekday(dest.departDate)} 出发 · {formatDayWithWeekday(dest.returnDate)} 返回
      </div>
      <div style={{ marginBottom: 4 }}>
        <Tag color="blue">✈ 去程</Tag>
        <span style={{ color: '#888', fontSize: 12, marginLeft: 4 }}>
          {formatDuration(out.totalDuration)}
          {out.transferCount > 0 && ` · ${out.transferCount} 次中转`}
        </span>
      </div>
      <RouteTimeline route={out} color="blue" />

      <Divider dashed style={{ margin: '8px 0' }} />

      <div style={{ marginBottom: 4 }}>
        <Tag color="orange">↩ 返程</Tag>
        <span style={{ color: '#888', fontSize: 12, marginLeft: 4 }}>
          {formatDuration(ret.totalDuration)}
          {ret.transferCount > 0 && ` · ${ret.transferCount} 次中转`}
        </span>
      </div>
      <RouteTimeline route={ret} color="orange" />

      <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #f0f0f0', color: '#aaa', fontSize: 11 }}>
        去程 {dest.outboundCount} 个方案 · 返程 {dest.returnCount} 个方案
      </div>
    </Card>
  );
}

// ─── 行程查询（探索 + 规划合一） ──────────────────────────────

interface UrlParams {
  origin: string;
  destination: string;
  departureDate: string;
  departureDateEnd?: string;
  returnDate: string;
  returnDateEnd?: string;
  tab: string;
  maxTransfers?: string;
}

interface TripTabProps {
  cities: string[];
  urlParams?: UrlParams;
  dateRange: { minDate: string | null; maxDate: string | null };
}

/**
 * 探索和规划本质是同一件事：给出发地 + 日期区间查行程。
 * 唯一区别是目的地填不填——留空就从这里出发找"能去哪"，填了就查"怎么去"。
 * 所以合成一个表单、一套日期语义，结果区按模式渲染。
 */
function TripTab({ cities, urlParams, dateRange }: TripTabProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  // explore：to=null，展示可往返目的地；plan：展示具体方案
  const [exploreResults, setExploreResults] = useState<ExploreDestination[]>([]);
  const [oneWayRoutes, setOneWayRoutes] = useState<RouteResult[]>([]);
  const [roundTripRoutes, setRoundTripRoutes] = useState<RoundTripResult[]>([]);
  const [mode, setMode] = useState<'explore' | 'plan'>('explore');
  const [searched, setSearched] = useState(false);
  const triggeredRef = useRef(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const applyDateWindow = (win: RouteDateWindow): string[] => {
    const notes: string[] = [];
    const values = form.getFieldsValue();
    const toStr = (d: any) => (d ? dayjs(d).format('YYYY-MM-DD') : null);
    const overlaps = (dates: string[], s: string | null, e: string | null) =>
      !!s && !!e && dates.some(d => d >= s && d <= e);

    // 去程：当前区间内一天都没有航班时才改
    const [depStartDay, depEndDay] = values.departureRange || [];
    const depStart = toStr(depStartDay);
    const depEnd = toStr(depEndDay);
    if (win.outbound.first && win.outbound.last && !overlaps(win.outbound.dates, depStart, depEnd)) {
      form.setFieldValue('departureRange', [dayjs(win.outbound.first), dayjs(win.outbound.last)]);
      notes.push(`去程 ${win.outbound.first} ~ ${win.outbound.last}`);
    }

    // 返程：用户本来就选的单程（区间为空）就不动；有返程区间但该航线没有返程航班，则退回单程
    const [retStartDay] = values.returnRange || [];
    const retStart = toStr(retStartDay);
    const retEnd = toStr((values.returnRange || [])[1]);
    if (!retStart) {
      // 单程意图，保持
    } else if (!win.hasReturn) {
      form.setFieldValue('returnRange', [null, null]);
      notes.push('该航线没有返程航班，已切换为单程');
    } else if (win.return.first && win.return.last && !overlaps(win.return.dates, retStart, retEnd)) {
      form.setFieldValue('returnRange', [dayjs(win.return.first), dayjs(win.return.last)]);
      notes.push(`返程 ${win.return.first} ~ ${win.return.last}`);
    }

    return notes;
  };

  /** 指定目的地时：先把日期区间对齐到真实可飞日期，再查询 */
  const alignDatesAndSearch = async () => {
    const values = form.getFieldsValue();
    const { origin, destination } = values;
    setLoading(true);
    if (origin && destination && origin !== destination) {
      try {
        const win = await getRouteDateWindow({
          origin,
          destination,
          maxTransfers: values.maxTransfers ?? 1,
          flightType: values.flightType === '666权益卡航班' ? '666权益卡航班' : undefined,
        });
        const notes = applyDateWindow(win);
        if (notes.length) {
          message.info(`已按该航线可飞日期自动调整：${notes.join('；')}`);
        }
      } catch {
        // 对齐失败不阻断，按原区间照常查询
      }
    }
    form.submit();
  };

  useEffect(() => {
    // URL params 优先，否则用 cookie 默认值
    form.setFieldValue('origin', urlParams?.origin || getDefaultOrigin());
    if (urlParams?.destination) {
      form.setFieldValue('destination', urlParams.destination);
    }

    // 去程：URL 参数 > 默认今天~一个月后
    if (urlParams?.departureDate) {
      const dep = dayjs(urlParams.departureDate);
      const depEnd = urlParams.departureDateEnd ? dayjs(urlParams.departureDateEnd) : dep.add(2, 'day');
      form.setFieldValue('departureRange', [dep, depEnd]);
    } else {
      const [defStart, defEnd] = getDefaultDateRange();
      form.setFieldValue('departureRange', [dayjs(defStart), dayjs(defEnd)]);
    }

    // 返程：URL 参数有就设；带目的地跳进来的视为单程；否则默认今天~一个月后
    if (urlParams?.returnDate) {
      const ret = dayjs(urlParams.returnDate);
      const retEnd = urlParams.returnDateEnd ? dayjs(urlParams.returnDateEnd) : ret.add(2, 'day');
      form.setFieldValue('returnRange', [ret, retEnd]);
    } else if (urlParams?.destination) {
      form.setFieldValue('returnRange', [null, null]);
    } else {
      const [defStart, defEnd] = getDefaultDateRange();
      form.setFieldValue('returnRange', [dayjs(defStart), dayjs(defEnd)]);
    }

    if (urlParams?.maxTransfers !== undefined) {
      form.setFieldValue('maxTransfers', parseInt(urlParams.maxTransfers, 10));
    }

    // 没有 URL 日期时，"今天~+30 天"有可能和库里实际数据窗口完全不重叠
    // （本地库陈旧、爬虫停更时常见），结果就是永远空。这时改用数据窗口。
    const hasUrlDates = !!(urlParams?.departureDate || urlParams?.returnDate);
    if (!hasUrlDates && dateRange.minDate && dateRange.maxDate) {
      const dbStart = dayjs(dateRange.minDate);
      const dbEnd = dayjs(dateRange.maxDate);
      const [curStart, curEnd] = form.getFieldValue('departureRange') || [];
      const overlaps = !!curStart && !!curEnd &&
        !curEnd.isBefore(dbStart, 'day') && !curStart.isAfter(dbEnd, 'day');
      if (!overlaps) {
        form.setFieldValue('departureRange', [dbStart, dbEnd]);
        form.setFieldValue('returnRange', [dbStart, dbEnd]);
      }
    }

    // 表单字段已填好（cities 由预设兜底，下拉框首屏可用），
    // 但自动查询仍等接口返回真实的 minDate，避免用错的默认区间去查
    if (cities.length === 0 || !dateRange.minDate) return;
    if (triggeredRef.current) return;
    triggeredRef.current = true;

    if (urlParams?.destination) {
      void alignDatesAndSearch();
    } else {
      form.submit();
    }
  }, [cities, dateRange.minDate]);

  /** 从"目的地卡片"跳到该城市的方案：回填目的地后按规划模式查询 */
  const handleViewDest = (dest: ExploreDestination) => {
    form.setFieldValue('destination', dest.city);
    form.scrollToField?.('destination');
    void alignDatesAndSearch();
  };

  const handleSearch = async (values: any) => {
    const destination: string | undefined = values.destination?.trim() || undefined;
    const [depStart, depEnd] = values.departureRange || [];
    if (!depStart) return;

    const departureDate = depStart.format('YYYY-MM-DD');
    const departureDateEnd = depEnd ? depEnd.format('YYYY-MM-DD') : departureDate;
    const [retStart, retEnd] = values.returnRange || [];
    const returnDate: string | undefined = retStart?.format('YYYY-MM-DD');
    const returnDateEnd: string | undefined = retEnd ? retEnd.format('YYYY-MM-DD') : returnDate;

    const flightType = values.flightType === '666权益卡航班' ? '666权益卡航班' : undefined;

    setLoading(true);
    setSearched(true);
    setExploreResults([]);
    setOneWayRoutes([]);
    setRoundTripRoutes([]);
    setOriginCookie(values.origin);

    // 目的地留空 → 探索：从这里出发能去哪
    if (!destination) {
      setMode('explore');
      try {
        const resp = await exploreDestinations({
          origin: values.origin,
          departureDate,
          departureDateEnd,
          returnDate: returnDate!,
          returnDateEnd: returnDateEnd!,
          maxTransfers: 1,
          flightType,
        });
        setExploreResults(resp.destinations);
        if (resp.destinations.length === 0) {
          message.warning('未找到可往返的目的地，请换个日期试试');
        } else {
          message.success(`发现 ${resp.destinations.length} 个可往返目的地`);
        }
      } catch {
        message.error('查询失败，请稍后重试');
      } finally {
        setLoading(false);
      }
      return;
    }

    // 目的地填了 → 规划：具体怎么去
    setMode('plan');
    try {
      if (returnDate) {
        const resp = await planRoundTrip({
          origin: values.origin,
          destination,
          departureDate,
          departureDateEnd,
          returnDate,
          returnDateEnd,
          maxTransfers: values.maxTransfers ?? 1,
          minLayoverHours: 2,
          maxLayoverHours: 24,
          flightType,
        });
        setRoundTripRoutes(resp.routes);
        if (resp.routes.length === 0) {
          message.warning('未找到合适的往返方案');
        } else {
          message.success(`找到 ${resp.routes.length} 个往返方案`);
        }
      } else {
        const resp = await planRoute({
          origin: values.origin,
          destination,
          departureDate,
          endDate: departureDateEnd !== departureDate ? departureDateEnd : undefined,
          maxTransfers: values.maxTransfers ?? 2,
          minLayoverHours: 2,
          maxLayoverHours: 24,
          flightType,
        });
        setOneWayRoutes(resp.routes);
        if (resp.routes.length === 0) {
          message.warning('未找到合适的单程方案');
        } else {
          message.success(`找到 ${resp.routes.length} 个单程方案`);
        }
      }
    } catch {
      message.error('查询失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const isRoundTrip = roundTripRoutes.length > 0;
  const hasPlanResults = oneWayRoutes.length > 0 || roundTripRoutes.length > 0;
  const hasResults = mode === 'explore' ? exploreResults.length > 0 : hasPlanResults;

  const originSelect = (
    <Select placeholder="出发地" showSearch style={{ width: '100%' }}
      filterOption={(input, option) => (option?.value?.toString() || '').includes(input)}
      options={cities.map(c => ({ value: c, label: c }))} />
  );

  const destinationSelect = (
    <Select
      placeholder="留空则探索全部"
      allowClear
      showSearch
      style={{ width: '100%' }}
      filterOption={(input, option) => (option?.value?.toString() || '').includes(input)}
      options={cities.map(c => ({ value: c, label: c }))}
    />
  );

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSearch}
          initialValues={{ maxTransfers: 1, flightType: '2666权益卡航班' }}
        >
          <Row gutter={[12, 12]} style={{ width: '100%' }}>
            <Col xs={12} md={6} lg={5}>
              <Form.Item name="origin" label="出发地" rules={[{ required: true, message: '请选择出发地' }]}>
                {originSelect}
              </Form.Item>
            </Col>
            <Col xs={12} md={6} lg={7}>
              <Form.Item name="destination" label="目的地">
                {destinationSelect}
              </Form.Item>
            </Col>
            <Col xs={24} md={6} lg={6}>
              <Form.Item name="departureRange" label="去程" rules={[{ required: true, message: '请选择去程日期' }]}>
                <DatePicker.RangePicker placeholder={['最早', '最晚']} style={{ width: '100%' }}
                  getPopupContainer={(trigger) => trigger.parentElement || document.body} placement="bottomLeft" />
              </Form.Item>
            </Col>
            <Col xs={24} md={6} lg={6}>
              <Form.Item
                name="returnRange"
                label="返程"
                dependencies={['destination']}
                rules={[({ getFieldValue }) => ({
                  validator(_, value) {
                    // 留空目的地（探索模式）必须给返程区间；规划模式可以只查单程
                    if (!getFieldValue('destination') && (!value || !value[0] || !value[1])) {
                      return Promise.reject(new Error('探索模式请选择返程日期'));
                    }
                    return Promise.resolve();
                  },
                })]}
              >
                <DatePicker.RangePicker placeholder={['最早', '最晚']} style={{ width: '100%' }} allowEmpty={[true, true]}
                  getPopupContainer={(trigger) => trigger.parentElement || document.body} placement="bottomLeft" />
              </Form.Item>
            </Col>
          </Row>
          {/* 次要选项和查询按钮单独一行，按钮靠右——避免在窄一点的屏幕上被挤到
              下一行单独占一行、左对齐地挂在字段下面 */}
          <Row gutter={[12, 12]} justify="end" style={{ width: '100%', marginTop: 12 }}>
            <Col xs={12} md={3} lg={2}>
              <Form.Item name="maxTransfers" label="中转">
                <InputNumber min={0} max={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3} lg={3}>
              <Form.Item name="flightType" label="权益卡">
                <Select style={{ width: '100%' }}>
                  <Select.Option value="666权益卡航班">666</Select.Option>
                  <Select.Option value="2666权益卡航班">2666</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={6} lg={5} style={{ textAlign: 'right' }}>
              <Form.Item label=" " colon={false} style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading} block={isMobile}>
                  查询
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <CuteLoader text={mode === 'explore' ? '正在发现可往返目的地...' : '正在规划路线...'} />
        </div>
      )}

      {/* 探索结果：能去哪 */}
      {!loading && mode === 'explore' && exploreResults.length > 0 && (
        <>
          <div style={{ marginBottom: 12, color: '#666' }}>
            共找到 <strong>{exploreResults.length}</strong> 个可往返目的地（按请假成本优先排序）
          </div>
          <Row gutter={[12, 12]}>
            {exploreResults.map((dest) => (
              <Col key={dest.city} xs={24} sm={12} lg={8}>
                <ExploreCard dest={dest} onViewAll={() => handleViewDest(dest)} />
              </Col>
            ))}
          </Row>
        </>
      )}

      {/* 规划结果：怎么去 */}
      {!loading && mode === 'plan' && hasPlanResults && (
        <div>
          <div style={{ marginBottom: 12, color: '#666' }}>
            共 {isRoundTrip ? roundTripRoutes.length : oneWayRoutes.length} 个方案
            {isRoundTrip ? '（往返，已按请假成本优先排序）' : '（单程）'}
          </div>
          <Row gutter={[12, 12]}>
            {isRoundTrip
              ? roundTripRoutes.map((rt, idx) => (
                  <Col key={idx} xs={24} sm={12} lg={8}>
                    <RoundTripCard result={rt} index={idx + 1} />
                  </Col>
                ))
              : oneWayRoutes.map((route, idx) => (
                  <Col key={idx} xs={24} sm={12} lg={8}>
                    <Card
                      size="small"
                      style={{ height: '100%' }}
                      title={
                        <Space>
                          <span style={{ color: '#666', fontSize: 12 }}>#{idx + 1}</span>
                          {route.transferCount === 0
                            ? <Tag color="green" style={{ margin: 0 }}>直飞</Tag>
                            : <Tag color="blue" style={{ margin: 0 }}>{route.transferCount} 次中转</Tag>
                          }
                          <Tag icon={<ClockCircleOutlined />} color="default" style={{ margin: 0 }}>
                            {formatDuration(route.totalDuration)}
                          </Tag>
                        </Space>
                      }
                    >
                      <RouteTimeline route={route} color="blue" />
                    </Card>
                  </Col>
                ))
            }
          </Row>
        </div>
      )}

      {!loading && !hasResults && (
        <Card>
          <Empty
            description={
              mode === 'explore' || !searched
                ? '选择出发地和日期，看看能飞去哪儿（目的地留空）'
                : '换个日期或目的地再试试'
            }
          />
        </Card>
      )}
    </div>
  );
}

// ─── 主页面 ────────────────────────────────────────────────

function RoutePlanner() {
  // 预设兜底：出发地/目的地下拉框不必等接口返回，冷启动期间也能选
  const [cities, setCities] = useState<string[]>(PRESET_CITIES);
  const [dateRange, setDateRange] = useState<{ minDate: string | null; maxDate: string | null }>({ minDate: null, maxDate: null });
  const [searchParams] = useSearchParams();

  // 从 URL params 解析初始参数
  const urlParams = {
    origin: searchParams.get('origin') || '',
    destination: searchParams.get('destination') || '',
    departureDate: searchParams.get('departureDate') || '',
    departureDateEnd: searchParams.get('departureDateEnd') || undefined,
    returnDate: searchParams.get('returnDate') || '',
    returnDateEnd: searchParams.get('returnDateEnd') || undefined,
    // tab 只用于兼容老链接，实际模式由"目的地是否为空"决定
    tab: searchParams.get('tab') || '',
    maxTransfers: searchParams.get('maxTransfers') || undefined,
  };

  useEffect(() => {
    getAvailableCities()
      .then(({ cityList, origins, destinations, minDate, maxDate }) => {
        // 优先使用城市维度列表（北京/上海各出现一次），兼容旧接口
        const all = cityList?.length
          ? cityList
          : Array.from(new Set([...origins, ...destinations])).sort();
        setCities(prev => mergeOriginOptions(prev, all));
        setDateRange({ minDate, maxDate });
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ padding: '0 4px' }}>
      <TripTab cities={cities} urlParams={urlParams} dateRange={dateRange} />
    </div>
  );
}

export default RoutePlanner;
