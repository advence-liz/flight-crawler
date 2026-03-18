import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card,
  Form,
  DatePicker,
  Button,
  Table,
  Space,
  message,
  Select,
  Tag,
  Modal,
  Row,
  Col,
  Statistic,
  Tooltip,
  Divider,
  Spin,
} from 'antd';
import {
  SearchOutlined,
  SwapOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
  MinusCircleOutlined,
  AimOutlined,
  SendOutlined,
  NodeIndexOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  queryDestinations,
  DestinationResult,
  getAvailableCities,
  queryRoundTripFlights,
  RoundTripFlights,
  Flight,
  RouteResult,
  discoverTransferDestinations,
  TransferRoundTripDest,
  TransferOneWayDest,
} from '@/api/flight';
import { getDefaultOrigin, setOriginCookie } from '@/utils/cookie';

const { RangePicker } = DatePicker;

// ─── 中转目的地气泡卡片 ──────────────────────────────────────

interface TransferDestCardProps {
  city: string;
  hasReturn: boolean;
  outboundRoute: RouteResult;
  returnRoute?: RouteResult;
  outboundCount: number;
  returnCount?: number;
  onShowRoutes: () => void;
  onPlan: () => void;
}

function TransferDestCard({ city, hasReturn, outboundRoute, outboundCount, returnCount, onShowRoutes, onPlan }: TransferDestCardProps) {
  const outSeg = outboundRoute.segments;
  const via = outSeg.length > 1 ? outSeg.slice(0, -1).map(s => s.destination).join('、') : '';

  return (
    <div
      style={{
        border: `1.5px solid ${hasReturn ? '#ffd591' : '#e8e8e8'}`,
        borderRadius: 8,
        padding: '10px 14px',
        background: hasReturn ? '#fffbe6' : '#fafafa',
        transition: 'all 0.2s',
        userSelect: 'none',
        minWidth: 120,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(250,140,22,0.25)';
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLDivElement).style.transform = 'none';
      }}
    >
      {/* 城市名 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <NodeIndexOutlined style={{ color: '#fa8c16', fontSize: 12 }} />
        <span style={{ fontWeight: 600, fontSize: 14, color: hasReturn ? '#874d00' : '#595959', cursor: 'pointer' }} onClick={onShowRoutes}>
          {city}
        </span>
      </div>

      {/* 经由城市 */}
      {via && (
        <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>
          经 {via}
        </div>
      )}

      {/* 去程/返程方案数 + 操作按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6, fontSize: 12 }}>
          <span style={{ color: '#fa8c16' }}>去 {outboundCount} 条</span>
          {hasReturn ? (
            <>
              <SwapOutlined style={{ color: '#fa8c16', fontSize: 10 }} />
              <span style={{ color: '#fa8c16' }}>返 {returnCount} 条</span>
            </>
          ) : (
            <span style={{ color: '#bfbfbf' }}>无返程</span>
          )}
        </div>
        <Space size={2}>
          <Button
            type="link"
            size="small"
            icon={<NodeIndexOutlined />}
            style={{ padding: '0 2px', fontSize: 11, height: 'auto', color: '#fa8c16' }}
            onClick={e => { e.stopPropagation(); onShowRoutes(); }}
          >
            方案
          </Button>
          <Button
            type="link"
            size="small"
            icon={<SendOutlined />}
            style={{ padding: '0 2px', fontSize: 11, height: 'auto', color: hasReturn ? '#52c41a' : '#1677ff' }}
            onClick={e => { e.stopPropagation(); onPlan(); }}
          >
            规划
          </Button>
        </Space>
      </div>
    </div>
  );
}

// ─── 目的地气泡卡片 ──────────────────────────────────────────

interface DestCardProps {
  dest: DestinationResult;
  onClick: () => void;
  onPlan: () => void;
  onTransfer: () => void;
  hasTransfer?: boolean;
}

function DestCard({ dest, onClick, onPlan, onTransfer, hasTransfer }: DestCardProps) {
  const canReturn = dest.hasReturn;

  return (
    <Tooltip
      title={
        canReturn
          ? `去程 ${dest.flightCount} 班 / ${dest.availableDates.length} 天  ·  返程 ${dest.returnFlightCount} 班 / ${dest.returnAvailableDates?.length} 天`
          : `去程 ${dest.flightCount} 班 / ${dest.availableDates.length} 天  ·  无返程`
      }
    >
      <div
        style={{
          cursor: 'pointer',
          border: `1.5px solid ${canReturn ? '#52c41a' : '#d9d9d9'}`,
          borderRadius: 8,
          padding: '10px 14px',
          background: canReturn ? '#f6ffed' : '#fafafa',
          transition: 'all 0.2s',
          userSelect: 'none',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = canReturn
            ? '0 2px 8px rgba(82,196,26,0.35)'
            : '0 2px 8px rgba(0,0,0,0.12)';
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
          (e.currentTarget as HTMLDivElement).style.transform = 'none';
        }}
      >
        {/* 城市名 + 往返图标 */}
        <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          {canReturn
            ? <CheckCircleFilled style={{ color: '#52c41a', fontSize: 13 }} />
            : <MinusCircleOutlined style={{ color: '#bfbfbf', fontSize: 13 }} />
          }
          <span style={{
            fontWeight: 600,
            fontSize: 14,
            color: canReturn ? '#135200' : '#595959',
          }}>
            {dest.destination}
          </span>
        </div>

        {/* 去程 / 返程航班数 */}
        <div onClick={onClick} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
          <span style={{ color: '#1677ff' }}>
            ✈ {dest.flightCount} 班
          </span>
          {canReturn ? (
            <>
              <SwapOutlined style={{ color: '#52c41a', fontSize: 10 }} />
              <span style={{ color: '#52c41a' }}>
                {dest.returnFlightCount} 班
              </span>
            </>
          ) : (
            <span style={{ color: '#bfbfbf' }}>
              <ArrowRightOutlined style={{ fontSize: 10 }} /> 无返程
            </span>
          )}
        </div>

        {/* 权益卡标签 + 去规划按钮 */}
        <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {dest.cardTypes.map(type => (
              <Tag
                key={type}
                color={type === '666权益卡航班' ? 'blue' : 'green'}
                style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px', marginBottom: 0 }}
              >
                {type.replace('权益卡航班', '')}
              </Tag>
            ))}
          </div>
          <Space size={2}>
            {hasTransfer && (
              <Button
                type="link"
                size="small"
                icon={<NodeIndexOutlined />}
                style={{ padding: '0 2px', fontSize: 11, height: 'auto', color: '#fa8c16' }}
                onClick={e => { e.stopPropagation(); onTransfer(); }}
              >
                中转
              </Button>
            )}
            <Button
              type="link"
              size="small"
              icon={<SendOutlined />}
              style={{ padding: '0 2px', fontSize: 11, height: 'auto', color: canReturn ? '#52c41a' : '#1677ff' }}
              onClick={e => { e.stopPropagation(); onPlan(); }}
            >
              规划
            </Button>
          </Space>
        </div>
      </div>
    </Tooltip>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────

function DestinationQuery() {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [destinations, setDestinations] = useState<DestinationResult[]>([]);
  const [availableOrigins, setAvailableOrigins] = useState<string[]>([]);
  const [selectedDestination, setSelectedDestination] = useState<DestinationResult | null>(null);
  const [roundTripFlights, setRoundTripFlights] = useState<RoundTripFlights | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);

  // 中转方案 Modal 状态（点击气泡后弹出，直接用已有数据）
  const [transferModalCity, setTransferModalCity] = useState<string | null>(null);

  // 中转目的地分区状态
  const [transferRoundTrip, setTransferRoundTrip] = useState<TransferRoundTripDest[]>([]);
  const [transferOneWay, setTransferOneWay] = useState<TransferOneWayDest[]>([]);
  const [discoverTransferLoading, setDiscoverTransferLoading] = useState(false);
  const [transferDiscovered, setTransferDiscovered] = useState(false);

  // 跳转到行程规划
  const goToPlan = (destination: string) => {
    const values = form.getFieldsValue();
    const [startDate, endDate] = values.dateRange || [];
    // 直飞目的地：可往返的传 returnDate，仅单程的不传（避免查往返查不到结果）
    const directDest = destinations.find(d => d.destination === destination);
    const isDirectFlight = !!directDest;
    const canReturn = directDest?.hasReturn ?? false;
    // 中转目的地：判断是否有往返中转方案
    const hasTransferReturn = validTransferRoundTrip.some(i => i.city === destination);
    const shouldIncludeReturn = canReturn || hasTransferReturn;
    const params = new URLSearchParams({
      tab: 'plan',
      origin: values.origin || '',
      destination,
      departureDate: startDate ? startDate.format('YYYY-MM-DD') : '',
      ...(endDate ? { departureDateEnd: endDate.format('YYYY-MM-DD') } : {}),
      // 往返：returnDate 用 startDate（最早可返程），returnDateEnd 用 endDate（最晚可返程）
      ...(shouldIncludeReturn && startDate ? { returnDate: startDate.format('YYYY-MM-DD') } : {}),
      ...(shouldIncludeReturn && endDate ? { returnDateEnd: endDate.format('YYYY-MM-DD') } : {}),
      maxTransfers: isDirectFlight ? '0' : '1',
    });
    navigate(`/route-planner?${params.toString()}`);
  };

  const goToExplore = () => {
    const values = form.getFieldsValue();
    const [startDate, endDate] = values.dateRange || [];
    const params = new URLSearchParams({
      tab: 'explore',
      origin: values.origin || '',
      departureDate: startDate ? startDate.format('YYYY-MM-DD') : '',
      returnDate: endDate ? endDate.format('YYYY-MM-DD') : '',
    });
    navigate(`/route-planner?${params.toString()}`);
  };

  useEffect(() => {
    // 优先读取 URL 参数（从行程规划页面返回时携带）
    const urlOrigin = searchParams.get('origin');
    const urlDepartureDate = searchParams.get('departureDate');
    const urlReturnDate = searchParams.get('returnDate');

    form.setFieldValue('origin', urlOrigin || getDefaultOrigin());
    if (urlDepartureDate && urlReturnDate) {
      form.setFieldValue('dateRange', [dayjs(urlDepartureDate), dayjs(urlReturnDate)]);
    }

    getAvailableCities()
      .then(cities => {
        setAvailableOrigins(cities.origins);
        // 如果没有 URL 参数提供日期，使用数据库日期范围作为默认值
        if (!urlDepartureDate && !urlReturnDate && cities.minDate && cities.maxDate) {
          form.setFieldValue('dateRange', [dayjs(cities.minDate), dayjs(cities.maxDate)]);
        }
        // 城市列表加载完成后自动触发一次查询
        form.submit();
      })
      .catch(console.error);
  }, []);

  const handleSearch = async (values: any) => {
    const [startDate, endDate] = values.dateRange;
    const queryParams = {
      origin: values.origin,
      startDate: startDate.format('YYYY-MM-DD'),
      endDate: endDate.format('YYYY-MM-DD'),
      flightType: values.flightType,
    };

    // 重置状态
    setDestinations([]);
    setTransferRoundTrip([]);
    setTransferOneWay([]);
    setTransferDiscovered(false);
    setLoading(true);

    // 第一步：仅查去程，立即渲染（无缓存，速度快）
    try {
      const fastResult = await queryDestinations({ ...queryParams, includeReturn: false });
      setDestinations(fastResult.destinations);
      setOriginCookie(values.origin);
    } catch {
      message.error('查询失败，请稍后重试');
      setLoading(false);
      return;
    }

    // 第二步：补充返程信息（有缓存命中时很快，无缓存时稍慢但不阻塞首屏）
    queryDestinations({ ...queryParams, includeReturn: true })
      .then(fullResult => {
        setDestinations(fullResult.destinations);
        message.success(`查询成功，共 ${fullResult.totalCount} 个目的地`);
      })
      .catch(() => {
        // 返程查询失败不影响已展示的去程数据
        message.warning('返程信息加载失败，仅显示去程数据');
      })
      .finally(() => {
        setLoading(false);
      });

    // 第三步：异步触发中转目的地发现（不阻塞前两步）
    setDiscoverTransferLoading(true);
    discoverTransferDestinations({
      origin: values.origin,
      departureDate: startDate.format('YYYY-MM-DD'),
      endDate: endDate.format('YYYY-MM-DD'),
      maxTransfers: 1,
    }).then(transferResult => {
      setTransferRoundTrip(transferResult.roundTrip);
      setTransferOneWay(transferResult.oneWay);
      setTransferDiscovered(true);
    }).catch(() => {
      // 中转查询失败不阻断主流程
    }).finally(() => {
      setDiscoverTransferLoading(false);
    });
  };

  const handleShowDetail = async (dest: DestinationResult) => {
    setSelectedDestination(dest);
    setIsModalVisible(true);
    setDetailLoading(true);
    try {
      const values = form.getFieldsValue();
      const [startDate, endDate] = values.dateRange;
      const flights = await queryRoundTripFlights({
        origin: values.origin,
        destination: dest.destination,
        startDate: startDate.format('YYYY-MM-DD'),
        endDate: endDate.format('YYYY-MM-DD'),
        flightType: values.flightType,
      });
      setRoundTripFlights(flights);
    } catch {
      message.error('加载航班详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // 点击中转目的地气泡，弹出该城市的中转路线 Modal（直接用已有数据，无需再请求）
  const handleShowTransferRoutes = (city: string) => {
    setTransferModalCity(city);
  };

  // 统计
  const returnCount = destinations.filter(d => d.hasReturn).length;
  const oneWayCount = destinations.filter(d => !d.hasReturn).length;

  // 过滤掉「过滤直飞后无中转路线」的 item
  const validTransferRoundTrip = transferRoundTrip.filter(item =>
    item.outboundRoutes.some(r => r.transferCount > 0) &&
    item.returnRoutes.some(r => r.transferCount > 0),
  );
  const validTransferOneWay = transferOneWay.filter(item =>
    item.routes.some(r => r.transferCount > 0),
  );

  // 表格列
  const columns: ColumnsType<DestinationResult> = [
    {
      title: '目的地',
      dataIndex: 'destination',
      key: 'destination',
      render: (text: string, record: DestinationResult) => (
        <Space>
          <strong>{text}</strong>
          {record.hasReturn
            ? <Tag color="success" icon={<SwapOutlined />}>可往返</Tag>
            : <Tag color="default" icon={<ArrowRightOutlined />}>仅单程</Tag>
          }
        </Space>
      ),
    },
    {
      title: '权益标签',
      dataIndex: 'cardTypes',
      key: 'cardTypes',
      render: (cardTypes: string[]) => (
        <Space>
          {cardTypes.map(type => (
            <Tag key={type} color={type === '666权益卡航班' ? 'blue' : 'green'}>
              {type.replace('权益卡航班', '')}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '去程',
      dataIndex: 'flightCount',
      key: 'flightCount',
      render: (count: number, record: DestinationResult) => (
        <div>
          <span style={{ color: '#1677ff', fontWeight: 500 }}>{count} 班</span>
          <div style={{ fontSize: 12, color: '#999' }}>{record.availableDates.length} 天可选</div>
        </div>
      ),
    },
    {
      title: '返程',
      key: 'returnFlights',
      render: (_: any, record: DestinationResult) =>
        record.hasReturn ? (
          <div>
            <span style={{ color: '#52c41a', fontWeight: 500 }}>{record.returnFlightCount} 班</span>
            <div style={{ fontSize: 12, color: '#999' }}>{record.returnAvailableDates?.length} 天可选</div>
          </div>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: DestinationResult) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => handleShowDetail(record)}>
            查看详情
          </Button>
          <Button
            type="link"
            size="small"
            icon={<NodeIndexOutlined />}
            style={{ color: '#fa8c16' }}
            onClick={() => handleShowTransferRoutes(record.destination)}
          >
            中转方案
          </Button>
          <Button
            type="link"
            size="small"
            icon={<AimOutlined />}
            onClick={() => goToPlan(record.destination)}
          >
            去规划
          </Button>
        </Space>
      ),
    },
  ];

  const flightDetailColumns: ColumnsType<Flight> = [
    { title: '航班号', dataIndex: 'flightNo', key: 'flightNo' },
    {
      title: '出发时间',
      dataIndex: 'departureTime',
      key: 'departureTime',
      render: (t: string) => dayjs(t).format('MM-DD HH:mm'),
    },
    {
      title: '到达时间',
      dataIndex: 'arrivalTime',
      key: 'arrivalTime',
      render: (t: string) => dayjs(t).format('MM-DD HH:mm'),
    },
    {
      title: '权益卡',
      dataIndex: 'cardType',
      key: 'cardType',
      render: (cardType: string) => (
        <Space>
          {cardType.split(',').map(t => t.trim()).map(type => (
            <Tag key={type} color={type === '666权益卡航班' ? 'blue' : 'green'}>
              {type.replace('权益卡航班', '')}
            </Tag>
          ))}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* 搜索表单 */}
      <Card title="目的地查询">
        <Form
          form={form}
          layout="inline"
          onFinish={handleSearch}
          initialValues={{
            flightType: '全部',
            dateRange: [dayjs(), dayjs().add(30, 'day')],
          }}
        >
          <Form.Item name="origin" label="出发地" rules={[{ required: true, message: '请选择出发地' }]}>
            <Select
              placeholder="请选择出发地"
              style={{ width: 180 }}
              showSearch
              filterOption={(input, option) =>
                (option?.label?.toString() || '').toLowerCase().includes(input.toLowerCase())
              }
            >
              {availableOrigins.map(city => (
                <Select.Option key={city} value={city}>{city}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="dateRange" label="日期范围" rules={[{ required: true, message: '请选择日期范围' }]}>
            <RangePicker />
          </Form.Item>

          <Form.Item name="flightType" label="权益卡类型">
            <Select style={{ width: 160 }}>
              <Select.Option value="全部">全部权益卡</Select.Option>
              <Select.Option value="666权益卡航班">666权益卡航班</Select.Option>
              <Select.Option value="2666权益卡航班">2666权益卡航班</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}>
              查询
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {destinations.length > 0 && (
        <>
          {/* ── 可视化概览区 ── */}
          <Card>
            {/* 统计摘要 */}
            <Row gutter={24} style={{ marginBottom: 20 }}>
              <Col>
                <Statistic
                  title="可往返目的地"
                  value={returnCount}
                  suffix="个"
                  valueStyle={{ color: '#52c41a', fontSize: 28 }}
                  prefix={<SwapOutlined />}
                />
              </Col>
              <Col>
                <Statistic
                  title="仅单程目的地"
                  value={oneWayCount}
                  suffix="个"
                  valueStyle={{ color: '#8c8c8c', fontSize: 28 }}
                  prefix={<ArrowRightOutlined />}
                />
              </Col>
              <Col>
                <Statistic
                  title="目的地总数"
                  value={destinations.length}
                  suffix="个"
                  valueStyle={{ fontSize: 28 }}
                />
              </Col>
              {transferDiscovered && (validTransferRoundTrip.length + validTransferOneWay.length > 0) && (
                <Col>
                  <Statistic
                    title="中转可达"
                    value={validTransferRoundTrip.length + validTransferOneWay.length}
                    suffix="个"
                    valueStyle={{ color: '#fa8c16', fontSize: 28 }}
                    prefix={<NodeIndexOutlined />}
                  />
                </Col>
              )}
            </Row>

            {/* 可往返目的地气泡 */}
            {returnCount > 0 && (
              <>
                <Divider orientation="left" style={{ margin: '0 0 12px' }}>
                  <Space>
                    <CheckCircleFilled style={{ color: '#52c41a' }} />
                    <span style={{ color: '#52c41a', fontWeight: 600 }}>可往返（{returnCount} 个）</span>
                    <span style={{ color: '#999', fontSize: 12, fontWeight: 400 }}>点击查看航班详情</span>
                    <Button
                      type="link"
                      size="small"
                      icon={<AimOutlined />}
                      style={{ padding: 0, fontSize: 12 }}
                      onClick={goToExplore}
                    >
                      前往行程规划
                    </Button>
                  </Space>
                </Divider>
                <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
                  {destinations.filter(d => d.hasReturn).map(dest => (
                    <Col key={dest.destination}>
                      <DestCard
                        dest={dest}
                        onClick={() => handleShowDetail(dest)}
                        onPlan={() => goToPlan(dest.destination)}
                        onTransfer={() => handleShowTransferRoutes(dest.destination)}
                        hasTransfer={transferDiscovered && (
                          validTransferRoundTrip.some(i => i.city === dest.destination) ||
                          validTransferOneWay.some(i => i.city === dest.destination)
                        )}
                      />
                    </Col>
                  ))}
                </Row>
              </>
            )}

            {/* 仅单程目的地气泡 */}
            {oneWayCount > 0 && (
              <>
                <Divider orientation="left" style={{ margin: '0 0 12px' }}>
                  <Space>
                    <MinusCircleOutlined style={{ color: '#bfbfbf' }} />
                    <span style={{ color: '#8c8c8c', fontWeight: 600 }}>仅单程（{oneWayCount} 个）</span>
                  </Space>
                </Divider>
                <Row gutter={[10, 10]}>
                  {destinations.filter(d => !d.hasReturn).map(dest => (
                    <Col key={dest.destination}>
                      <DestCard
                        dest={dest}
                        onClick={() => handleShowDetail(dest)}
                        onPlan={() => goToPlan(dest.destination)}
                        onTransfer={() => handleShowTransferRoutes(dest.destination)}
                        hasTransfer={transferDiscovered && (
                          validTransferRoundTrip.some(i => i.city === dest.destination) ||
                          validTransferOneWay.some(i => i.city === dest.destination)
                        )}
                      />
                    </Col>
                  ))}
                </Row>
              </>
            )}

            {/* 中转可达分区：loading 中或有数据时才显示 */}
            {(discoverTransferLoading || validTransferRoundTrip.length > 0 || validTransferOneWay.length > 0) && (
              <>
                <Divider orientation="left" style={{ margin: '16px 0 12px' }}>
                  <Space>
                    <NodeIndexOutlined style={{ color: '#fa8c16' }} />
                    <span style={{ color: '#fa8c16', fontWeight: 600 }}>中转可达</span>
                    {discoverTransferLoading && (
                      <span style={{ color: '#999', fontSize: 12, fontWeight: 400 }}>搜索中...</span>
                    )}
                    {transferDiscovered && (
                      <span style={{ color: '#999', fontSize: 12, fontWeight: 400 }}>
                        往返 {validTransferRoundTrip.length} 个 · 单程 {validTransferOneWay.length} 个
                      </span>
                    )}
                  </Space>
                </Divider>

                {discoverTransferLoading && (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <Spin tip="正在搜索中转方案..." />
                  </div>
                )}

                {validTransferRoundTrip.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, color: '#fa8c16', fontWeight: 600, marginBottom: 8 }}>
                      <SwapOutlined style={{ marginRight: 4 }} />中转往返（{validTransferRoundTrip.length} 个）
                    </div>
                    <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
                      {validTransferRoundTrip.map(item => (
                        <Col key={item.city}>
                          <TransferDestCard
                            city={item.city}
                            hasReturn={true}
                            outboundRoute={item.outboundRoutes.find(r => r.transferCount > 0)!}
                            returnRoute={item.returnRoutes.find(r => r.transferCount > 0)!}
                            outboundCount={item.outboundRoutes.filter(r => r.transferCount > 0).length}
                            returnCount={item.returnRoutes.filter(r => r.transferCount > 0).length}
                            onShowRoutes={() => handleShowTransferRoutes(item.city)}
                            onPlan={() => goToPlan(item.city)}
                          />
                        </Col>
                      ))}
                    </Row>
                  </>
                )}

                {validTransferOneWay.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 600, marginBottom: 8 }}>
                      <ArrowRightOutlined style={{ marginRight: 4 }} />中转单程（{validTransferOneWay.length} 个）
                    </div>
                    <Row gutter={[10, 10]}>
                      {validTransferOneWay.map(item => (
                        <Col key={item.city}>
                          <TransferDestCard
                            city={item.city}
                            hasReturn={false}
                            outboundRoute={item.routes.find(r => r.transferCount > 0)!}
                            outboundCount={item.routes.filter(r => r.transferCount > 0).length}
                            onShowRoutes={() => handleShowTransferRoutes(item.city)}
                            onPlan={() => goToPlan(item.city)}
                          />
                        </Col>
                      ))}
                    </Row>
                  </>
                )}
              </>
            )}
          </Card>

          {/* ── 详细表格 ── */}
          <Card title={`全部目的地（${destinations.length} 个）`}>
            <Table
              columns={columns}
              dataSource={destinations}
              rowKey="destination"
              rowClassName={record => record.hasReturn ? '' : 'row-one-way'}
              pagination={{ pageSize: 15, showSizeChanger: true, showTotal: total => `共 ${total} 条` }}
            />
          </Card>
        </>
      )}

      {/* 中转方案 Modal（直接使用已发现的数据，无需再请求） */}
      {(() => {
        const city = transferModalCity;
        const roundTripItem = transferRoundTrip.find(i => i.city === city);
        const oneWayItem = transferOneWay.find(i => i.city === city);
        const origin = form.getFieldValue('origin');

        const renderRoute = (route: RouteResult, label: string, color: string) => (
          <div style={{ border: `1px solid ${color === 'orange' ? '#ffd591' : '#91d5ff'}`, borderRadius: 8, padding: '12px 16px', background: color === 'orange' ? '#fff7e6' : '#e6f7ff', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Space>
                <Tag color={color}>{label}</Tag>
                <Space size={4}>
                  <ClockCircleOutlined style={{ color: '#999', fontSize: 12 }} />
                  <span style={{ fontSize: 12, color: '#666' }}>
                    总耗时 {Math.floor(route.totalDuration / 60)}h{route.totalDuration % 60}m
                  </span>
                </Space>
                <Tag color="orange">{route.transferCount} 次中转</Tag>
              </Space>
              <span style={{ fontSize: 12, color: '#999' }}>评分 {route.score.toFixed(1)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              {route.segments.map((seg, si) => (
                <>
                  <div key={`seg-${si}`} style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 6, padding: '6px 10px', fontSize: 12, minWidth: 160 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{seg.origin} → {seg.destination}</div>
                    <div style={{ color: '#666' }}>
                      {seg.flightNo}&nbsp;
                      {new Date(seg.departureTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {' → '}
                      {new Date(seg.arrivalTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ color: '#999', fontSize: 11 }}>飞行 {Math.floor(seg.duration / 60)}h{seg.duration % 60}m</div>
                  </div>
                  {si < route.layovers.length && (
                    <div key={`layover-${si}`} style={{ textAlign: 'center', fontSize: 11, color: '#fa8c16', padding: '0 4px' }}>
                      <div>⏱</div>
                      <div>{route.layovers[si].city}</div>
                      <div>停 {Math.floor(route.layovers[si].duration / 60)}h{route.layovers[si].duration % 60}m</div>
                    </div>
                  )}
                </>
              ))}
            </div>
          </div>
        );

        return (
          <Modal
            title={
              <Space>
                <NodeIndexOutlined style={{ color: '#fa8c16' }} />
                <span>中转方案：</span>
                <span>{origin}</span>
                <SwapOutlined style={{ color: '#fa8c16' }} />
                <span>{city}</span>
              </Space>
            }
            open={!!city}
            onCancel={() => setTransferModalCity(null)}
            width={780}
            footer={
              <Button
                type="primary"
                icon={<AimOutlined />}
                onClick={() => { setTransferModalCity(null); goToPlan(city!); }}
              >
                去行程规划
              </Button>
            }
          >
            {roundTripItem ? (
              <Space direction="vertical" style={{ width: '100%' }} size={0}>
                <div style={{ color: '#fa8c16', fontWeight: 600, marginBottom: 8 }}>
                  去程（共 {roundTripItem.outboundCount} 条，展示 Top {roundTripItem.outboundRoutes.length}）
                </div>
                {roundTripItem.outboundRoutes.filter(r => r.transferCount > 0).map((r, i) => renderRoute(r, `去程 #${i + 1}`, 'orange'))}
                <div style={{ color: '#fa8c16', fontWeight: 600, margin: '16px 0 8px' }}>
                  返程（共 {roundTripItem.returnCount} 条，展示 Top {roundTripItem.returnRoutes.length}）
                </div>
                {roundTripItem.returnRoutes.filter(r => r.transferCount > 0).map((r, i) => renderRoute(r, `返程 #${i + 1}`, 'orange'))}
              </Space>
            ) : oneWayItem ? (
              <Space direction="vertical" style={{ width: '100%' }} size={0}>
                <div style={{ color: '#8c8c8c', fontWeight: 600, marginBottom: 8 }}>
                  去程（共 {oneWayItem.routeCount} 条，展示 Top {oneWayItem.routes.length}）
                </div>
                {oneWayItem.routes.filter(r => r.transferCount > 0).map((r, i) => renderRoute(r, `去程 #${i + 1}`, 'blue'))}
                <div style={{ color: '#bfbfbf', fontSize: 13, marginTop: 12 }}>无返程方案</div>
              </Space>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#bfbfbf' }}>无中转方案数据</div>
            )}
          </Modal>
        );
      })()}

      {/* 往返航班详情 Modal */}
      <Modal
        title={
          <Space>
            <span>{form.getFieldValue('origin')}</span>
            <SwapOutlined style={{ color: '#52c41a' }} />
            <span>{selectedDestination?.destination}</span>
            {selectedDestination?.hasReturn
              ? <Tag color="success">可往返</Tag>
              : <Tag color="default">仅单程</Tag>
            }
          </Space>
        }
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        width={1100}
        footer={null}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 10, color: '#1677ff' }}>
              ✈ 去程：{form.getFieldValue('origin')} → {selectedDestination?.destination}
              <span style={{ fontWeight: 400, color: '#999', marginLeft: 8, fontSize: 13 }}>
                共 {roundTripFlights?.outboundFlights?.length || 0} 班
              </span>
            </div>
            <Table
              columns={flightDetailColumns}
              dataSource={roundTripFlights?.outboundFlights || []}
              rowKey="id"
              loading={detailLoading}
              size="small"
              pagination={{ pageSize: 5, showSizeChanger: false, showTotal: total => `共 ${total} 班` }}
            />
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 10, color: '#52c41a' }}>
              ↩ 返程：{selectedDestination?.destination} → {form.getFieldValue('origin')}
              <span style={{ fontWeight: 400, color: '#999', marginLeft: 8, fontSize: 13 }}>
                共 {roundTripFlights?.returnFlights?.length || 0} 班
              </span>
            </div>
            {roundTripFlights?.returnFlights?.length ? (
              <Table
                columns={flightDetailColumns}
                dataSource={roundTripFlights.returnFlights}
                rowKey="id"
                loading={detailLoading}
                size="small"
                pagination={{ pageSize: 5, showSizeChanger: false, showTotal: total => `共 ${total} 班` }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '32px', color: '#bfbfbf', background: '#fafafa', borderRadius: 6 }}>
                暂无返程航班
              </div>
            )}
          </div>
        </Space>
      </Modal>
    </Space>
  );
}

export default DestinationQuery;
