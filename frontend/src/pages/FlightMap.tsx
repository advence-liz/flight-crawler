import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import {
  Card,
  Form,
  DatePicker,
  Button,
  Select,
  Space,
  message,
  Tag,
  Row,
  Col,
  Statistic,
  Radio,
  Grid,
} from 'antd';
import { SearchOutlined, SwapOutlined, ArrowRightOutlined, NodeIndexOutlined, EnvironmentOutlined, AimOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { queryDestinations, getAvailableCities, DestinationResult, discoverTransferDestinations, TransferRoundTripDest, TransferOneWayDest } from '@/api/flight';
import { getDefaultOrigin, setOriginCookie, getDefaultDateRange } from '@/utils/cookie';

const { useBreakpoint } = Grid;

// ─── 主页面 ──────────────────────────────────────────────────
function FlightMap() {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const screens = useBreakpoint();
  const isMobile = !screens.md; // < 768px
  const [loading, setLoading] = useState(false);
  const [destinations, setDestinations] = useState<DestinationResult[]>([]);
  const [availableOrigins, setAvailableOrigins] = useState<string[]>([]);
  const [origin, setOrigin] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'return' | 'oneway' | 'transfer'>('all');
  const [transferRoundTrip, setTransferRoundTrip] = useState<TransferRoundTripDest[]>([]);
  const [transferOneWay, setTransferOneWay] = useState<TransferOneWayDest[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);

  const doSearch = async (originVal: string, startDate: string, endDate: string, flightType: string) => {
    setLoading(true);
    setTransferRoundTrip([]);
    setTransferOneWay([]);
    try {
      const result = await queryDestinations({
        origin: originVal,
        startDate,
        endDate,
        flightType: (flightType || '全部') as '全部' | '666权益卡' | '2666权益卡',
      });
      setDestinations(result.destinations);
      setOrigin(originVal);
      setOriginCookie(originVal);
      if (result.totalCount === 0) message.warning('未找到航班数据');
    } catch {
      message.error('查询失败，请稍后重试');
      return;
    } finally {
      setLoading(false);
    }

    // 主查询完成后，异步触发中转目的地发现（不阻塞主流程）
    setTransferLoading(true);
    discoverTransferDestinations({
      origin: originVal,
      departureDate: startDate,
      endDate,
      maxTransfers: 1,
    }).then(transferResult => {
      setTransferRoundTrip(transferResult.roundTrip);
      setTransferOneWay(transferResult.oneWay);
    }).catch(() => {
      // 中转查询失败不阻断主流程
    }).finally(() => {
      setTransferLoading(false);
    });
  };

  useEffect(() => {
    // 优先读取 URL 参数（从行程规划页面返回时携带）
    const urlOrigin = searchParams.get('origin');
    const urlDepartureDate = searchParams.get('departureDate');
    const urlReturnDate = searchParams.get('returnDate');

    const defaultOrigin = urlOrigin || getDefaultOrigin();
    form.setFieldValue('origin', defaultOrigin);
    if (urlDepartureDate && urlReturnDate) {
      form.setFieldValue('dateRange', [dayjs(urlDepartureDate), dayjs(urlReturnDate)]);
    }

    // 加载城市列表，完成后自动触发初始查询
    getAvailableCities()
      .then(c => {
        setAvailableOrigins(c.cityList?.length ? c.cityList : c.origins);
        // 如果没有 URL 参数提供日期，使用今天~今天+30天（与目的地查询保持一致，命中缓存）
        if (!urlDepartureDate && !urlReturnDate) {
          const [defStart, defEnd] = getDefaultDateRange();
          form.setFieldValue('dateRange', [dayjs(defStart), dayjs(defEnd)]);
        }
        // 自动触发初始查询
        const values = form.getFieldsValue();
        const dateRange = values.dateRange || [];
        const [start, end] = dateRange;
        if (start && end) {
          doSearch(defaultOrigin, start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'), values.flightType || '全部');
        }
      })
      .catch(console.error);
  }, []);

  const handleSearch = async (values: any) => {
    const [startDate, endDate] = values.dateRange;
    await doSearch(values.origin, startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD'), values.flightType);
  };

  const returnDests = destinations.filter(d => d.hasReturn);
  const onewayDests = destinations.filter(d => !d.hasReturn);

  const visibleDests = useMemo(() => {
    if (viewMode === 'return') return returnDests;
    if (viewMode === 'oneway') return onewayDests;
    if (viewMode === 'transfer') return [];
    return destinations;
  }, [destinations, viewMode, returnDests, onewayDests]);

  // 在 transfer 模式下只显示中转节点；其他模式叠加中转节点
  const showTransfer = viewMode === 'all' || viewMode === 'transfer';

  const chartOption = useMemo(() => {
    const hasDirectDests = visibleDests.length > 0;
    const hasTransferDests = showTransfer && (transferRoundTrip.length > 0 || transferOneWay.length > 0);
    if (!origin || (!hasDirectDests && !hasTransferDests)) return null;

    // 响应式缩放：移动端缩小 30%，PC 端保持原尺寸
    const scale = isMobile ? 0.7 : 1;

    // 节点：出发地固定在画布中心
    // 移动端使用相对定位（百分比），PC端使用固定坐标
    const nodes: any[] = [
      {
        id: origin,
        name: origin,
        symbolSize: 48 * scale,
        itemStyle: { color: '#facc15' },
        label: { show: true, color: '#1a1a1a', fontWeight: 700, fontSize: Math.round(13 * scale) },
        category: 0,
        fixed: !isMobile, // 移动端不固定，让力导向自动居中
        ...(isMobile ? {} : { x: 400, y: 330 }), // PC端使用固定坐标
      },
    ];

    const edges: any[] = [];
    const addedNodeIds = new Set<string>([origin]);

    // 直飞目的地
    visibleDests.forEach(dest => {
      const isReturn = dest.hasReturn;
      if (!addedNodeIds.has(dest.destination)) {
        nodes.push({
          id: dest.destination,
          name: dest.destination,
          symbolSize: Math.max(20 * scale, Math.min(38 * scale, dest.flightCount * 1.2 * scale + 14 * scale)),
          itemStyle: {
            color: isReturn ? '#4ade80' : '#60a5fa',
            borderColor: isReturn ? '#16a34a' : '#2563eb',
            borderWidth: 1.5 * scale,
          },
          label: { show: true, color: '#e2e8f0', fontSize: Math.round(11 * scale) },
          category: isReturn ? 1 : 2,
          flightCount: dest.flightCount,
          returnFlightCount: dest.returnFlightCount,
          hasReturn: isReturn,
          availableDates: dest.availableDates,
          returnAvailableDates: dest.returnAvailableDates,
          nodeType: 'direct',
        });
        addedNodeIds.add(dest.destination);
      }

      edges.push({
        source: origin,
        target: dest.destination,
        lineStyle: {
          color: isReturn ? '#4ade80' : '#60a5fa',
          width: (isReturn ? 2 : 1) * scale,
          opacity: isReturn ? 0.8 : 0.45,
          curveness: 0.15,
        },
        symbol: ['none', 'arrow'],
        symbolSize: [0, 7 * scale],
        value: dest.flightCount,
        hasReturn: isReturn,
      });

      if (isReturn) {
        edges.push({
          source: dest.destination,
          target: origin,
          lineStyle: { color: '#a3e635', width: 1.5 * scale, opacity: 0.5, curveness: 0.15, type: 'dashed' },
          symbol: ['none', 'arrow'],
          symbolSize: [0, 6 * scale],
          value: dest.returnFlightCount,
          hasReturn: true,
          isReturn: true,
        });
      }
    });

    // 中转目的地
    if (showTransfer) {
      const addTransferNode = (city: string, isRoundTrip: boolean, via: string, outboundCount: number, returnCount?: number) => {
        if (!addedNodeIds.has(city)) {
          nodes.push({
            id: city,
            name: city,
            symbolSize: 18 * scale,
            itemStyle: {
              color: isRoundTrip ? '#fb923c' : '#94a3b8',
              borderColor: isRoundTrip ? '#c2410c' : '#64748b',
              borderWidth: 1.5 * scale,
            },
            label: { show: true, color: '#e2e8f0', fontSize: Math.round(10 * scale) },
            category: isRoundTrip ? 3 : 4,
            nodeType: 'transfer',
            isRoundTrip,
            via,
            outboundCount,
            returnCount,
          });
          addedNodeIds.add(city);
        }

        // 中转虚线边（经由城市 → 目的地，或 origin → 目的地虚线）
        edges.push({
          source: origin,
          target: city,
          lineStyle: {
            color: isRoundTrip ? '#fb923c' : '#94a3b8',
            width: 1 * scale,
            opacity: 0.35,
            curveness: 0.25,
            type: 'dashed',
          },
          symbol: ['none', 'arrow'],
          symbolSize: [0, 5 * scale],
          isTransfer: true,
          isRoundTrip,
          via,
          outboundCount,
          returnCount,
        });
      };

      transferRoundTrip.forEach(item => {
        const outSeg = item.outboundRoutes[0].segments;
        const via = outSeg.length > 1 ? outSeg.slice(0, -1).map((s: any) => s.destination).join('、') : '';
        addTransferNode(item.city, true, via, item.outboundCount, item.returnCount);
      });

      transferOneWay.forEach(item => {
        const outSeg = item.routes[0].segments;
        const via = outSeg.length > 1 ? outSeg.slice(0, -1).map((s: any) => s.destination).join('、') : '';
        addTransferNode(item.city, false, via, item.routeCount);
      });
    }

    return {
      backgroundColor: '#0f172a',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15,23,42,0.95)',
        borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: Math.round(13 * scale) },
        formatter: (params: any) => {
          if (params.dataType === 'node') {
            const d = params.data;
            const titleSize = Math.round(14 * scale);
            const subtitleSize = Math.round(12 * scale);
            const textSize = Math.round(13 * scale);

            if (d.id === origin) {
              return `<div style="font-weight:700;font-size:${titleSize}px;color:#facc15">${d.name}</div><div style="color:#94a3b8;margin-top:${Math.round(2 * scale)}px;font-size:${subtitleSize}px">出发地</div>`;
            }
            if (d.nodeType === 'transfer') {
              const lines = [
                `<div style="font-weight:700;font-size:${titleSize}px;margin-bottom:${Math.round(4 * scale)}px">${d.name}</div>`,
                d.via ? `<div style="color:#fb923c;font-size:${subtitleSize}px">经 ${d.via} 中转</div>` : '',
                `<div style="font-size:${textSize}px">去程：<b style="color:#fb923c">${d.outboundCount} 条方案</b></div>`,
              ];
              if (d.isRoundTrip) {
                lines.push(`<div style="font-size:${textSize}px">返程：<b style="color:#fb923c">${d.returnCount} 条方案</b></div>`);
                lines.push(`<div style="margin-top:${Math.round(4 * scale)}px;color:#fb923c;font-size:${subtitleSize}px">⇄ 中转往返</div>`);
              } else {
                lines.push(`<div style="margin-top:${Math.round(4 * scale)}px;color:#94a3b8;font-size:${subtitleSize}px">→ 中转单程</div>`);
              }
              return lines.join('');
            }
            const lines = [
              `<div style="font-weight:700;font-size:${titleSize}px;margin-bottom:${Math.round(4 * scale)}px">${d.name}</div>`,
              `<div style="font-size:${textSize}px">✈ 去程：<b style="color:#60a5fa">${d.flightCount} 班</b>（${d.availableDates?.length} 天）</div>`,
            ];
            if (d.hasReturn) {
              lines.push(`<div style="font-size:${textSize}px">↩ 返程：<b style="color:#4ade80">${d.returnFlightCount} 班</b>（${d.returnAvailableDates?.length} 天）</div>`);
              lines.push(`<div style="margin-top:${Math.round(4 * scale)}px;color:#4ade80;font-size:${subtitleSize}px">⇄ 可往返</div>`);
            } else {
              lines.push(`<div style="margin-top:${Math.round(4 * scale)}px;color:#64748b;font-size:${subtitleSize}px">→ 仅单程</div>`);
            }
            return lines.join('');
          }
          if (params.dataType === 'edge') {
            const d = params.data;
            const titleSize = Math.round(13 * scale);
            const textSize = Math.round(12 * scale);
            if (d.isTransfer) {
              return `<div style="color:${d.isRoundTrip ? '#fb923c' : '#94a3b8'};font-size:${titleSize}px">⇌ 中转${d.isRoundTrip ? '往返' : '单程'}</div><div style="font-size:${textSize}px">${d.source} → ${d.target}${d.via ? `（经 ${d.via}）` : ''}</div>`;
            }
            if (d.isReturn) {
              return `<div style="color:#a3e635;font-size:${titleSize}px">↩ 返程航线</div><div style="font-size:${textSize}px">${d.source} → ${d.target}：${d.value} 班</div>`;
            }
            return `<div style="color:${d.hasReturn ? '#4ade80' : '#60a5fa'};font-size:${titleSize}px">✈ 去程航线</div><div style="font-size:${textSize}px">${d.source} → ${d.target}：${d.value} 班</div>`;
          }
          return '';
        },
      },
      toolbox: {
        feature: {
          saveAsImage: {
            title: '保存为图片',
            backgroundColor: '#0f172a',
            pixelRatio: 2,
          },
        },
        iconStyle: { borderColor: '#94a3b8' },
        top: 12,
        left: 12,
      },
      legend: {
        data: [
          { name: '出发地', icon: 'circle', itemStyle: { color: '#facc15' } },
          { name: '可往返', icon: 'circle', itemStyle: { color: '#4ade80' } },
          { name: '仅单程', icon: 'circle', itemStyle: { color: '#60a5fa' } },
          { name: '中转往返', icon: 'circle', itemStyle: { color: '#fb923c' } },
          { name: '中转单程', icon: 'circle', itemStyle: { color: '#94a3b8' } },
        ],
        textStyle: { color: '#94a3b8' },
        top: 12,
        right: 16,
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          nodes,
          edges,
          categories: [
            { name: '出发地' },
            { name: '可往返' },
            { name: '仅单程' },
            { name: '中转往返' },
            { name: '中转单程' },
          ],
          center: ['50%', '50%'],
          zoom: isMobile ? 0.7 : 0.6,
          force: {
            repulsion: 500 * scale,
            gravity: 0.3,
            edgeLength: [180 * scale, 320 * scale],
            layoutAnimation: true,
            friction: 0.6,
          },
          emphasis: {
            focus: 'adjacency',
            lineStyle: { width: 4 * scale },
          },
          label: {
            position: 'bottom',
            distance: 4 * scale,
          },
          edgeSymbol: ['none', 'arrow'],
          lineStyle: { curveness: 0.15 },
        },
      ],
    };
  }, [origin, visibleDests, showTransfer, transferRoundTrip, transferOneWay, isMobile]);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Form
          form={form}
          layout="horizontal"
          onFinish={handleSearch}
          initialValues={{
            flightType: '全部',
            dateRange: [dayjs(), dayjs().add(30, 'day')],
          }}
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="origin" label="出发地" rules={[{ required: true, message: '请选择出发地' }]}>
                <Select
                  placeholder="请选择出发地"
                  style={{ width: '100%' }}
                  showSearch
                  filterOption={(input, option) =>
                    (option?.value?.toString() || '').includes(input)
                  }
                  options={availableOrigins.map(c => ({ value: c, label: c }))}
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12} md={8}>
              <Form.Item name="dateRange" label="日期范围" rules={[{ required: true }]}>
                <DatePicker.RangePicker
                  style={{ width: '100%' }}
                  getPopupContainer={isMobile ? (trigger) => trigger.parentElement || document.body : undefined}
                  placement={isMobile ? 'bottomLeft' : undefined}
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12} md={5}>
              <Form.Item name="flightType" label="权益卡">
                <Select style={{ width: '100%' }}>
                  <Select.Option value="全部">全部权益卡</Select.Option>
                  <Select.Option value="666权益卡航班">666权益卡</Select.Option>
                  <Select.Option value="2666权益卡航班">2666权益卡</Select.Option>
                </Select>
              </Form.Item>
            </Col>

            <Col xs={12} sm={8} md={2}>
              <Form.Item>
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading} block={isMobile}>
                  查询
                </Button>
              </Form.Item>
            </Col>

            <Col xs={12} sm={16} md={3}>
              <Form.Item>
                <Space size={isMobile ? 4 : 8}>
                  <Button
                    size="small"
                    icon={<EnvironmentOutlined />}
                    onClick={() => {
                      const values = form.getFieldsValue();
                      const [start, end] = values.dateRange || [];
                      const p = new URLSearchParams();
                      if (values.origin) p.set('origin', values.origin);
                      if (start) p.set('departureDate', start.format('YYYY-MM-DD'));
                      if (end) p.set('returnDate', end.format('YYYY-MM-DD'));
                      navigate(`/?${p.toString()}`);
                    }}
                  >
                    {isMobile ? '目的地' : '目的地查询'}
                  </Button>
                  <Button
                    size="small"
                    icon={<AimOutlined />}
                    onClick={() => {
                      const values = form.getFieldsValue();
                      const [start, end] = values.dateRange || [];
                      const p = new URLSearchParams({ tab: 'explore' });
                      if (values.origin) p.set('origin', values.origin);
                      if (start) p.set('departureDate', start.format('YYYY-MM-DD'));
                      if (end) p.set('returnDate', end.format('YYYY-MM-DD'));
                      navigate(`/route-planner?${p.toString()}`);
                    }}
                  >
                    {isMobile ? '规划' : '行程规划'}
                  </Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {destinations.length > 0 && (
        <Card
          styles={{ body: { padding: 0 } }}
          title={
            <div>
              <div style={{ marginBottom: isMobile ? 12 : 0 }}>
                <span>航线关系图</span>
              </div>
              <Row gutter={[16, 16]}>
                <Col xs={8} sm={8} md={8}>
                  <Statistic
                    value={returnDests.length}
                    suffix={isMobile ? '' : '个可往返'}
                    title={isMobile ? '可往返' : undefined}
                    valueStyle={{ color: '#4ade80', fontSize: isMobile ? 16 : 18 }}
                    prefix={<SwapOutlined />}
                  />
                </Col>
                <Col xs={8} sm={8} md={8}>
                  <Statistic
                    value={onewayDests.length}
                    suffix={isMobile ? '' : '个仅单程'}
                    title={isMobile ? '仅单程' : undefined}
                    valueStyle={{ color: '#60a5fa', fontSize: isMobile ? 16 : 18 }}
                    prefix={<ArrowRightOutlined />}
                  />
                </Col>
                <Col xs={8} sm={8} md={8}>
                  <Statistic
                    value={transferRoundTrip.length + transferOneWay.length}
                    suffix={transferLoading ? (isMobile ? '...' : '搜索中...') : (isMobile ? '' : '个中转')}
                    title={isMobile ? '中转' : undefined}
                    valueStyle={{ color: '#fb923c', fontSize: isMobile ? 16 : 18 }}
                    prefix={<NodeIndexOutlined />}
                  />
                </Col>
              </Row>
            </div>
          }
          extra={
            isMobile ? (
              <Radio.Group
                value={viewMode}
                onChange={e => setViewMode(e.target.value)}
                size="small"
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="all">全</Radio.Button>
                <Radio.Button value="return">往返</Radio.Button>
                <Radio.Button value="oneway">单程</Radio.Button>
                <Radio.Button value="transfer">中转</Radio.Button>
              </Radio.Group>
            ) : (
              <Space>
                <Space size={6}>
                  <Tag color="warning">出发地</Tag>
                  <Tag color="success">可往返</Tag>
                  <Tag color="processing">仅单程</Tag>
                  <Tag color="orange">中转</Tag>
                </Space>
                <Radio.Group
                  value={viewMode}
                  onChange={e => setViewMode(e.target.value)}
                  size="small"
                  optionType="button"
                  buttonStyle="solid"
                >
                  <Radio.Button value="all">全部</Radio.Button>
                  <Radio.Button value="return">仅往返</Radio.Button>
                  <Radio.Button value="oneway">仅单程</Radio.Button>
                  <Radio.Button value="transfer">仅中转</Radio.Button>
                </Radio.Group>
              </Space>
            )
          }
        >
          {chartOption ? (
            <ReactECharts
              option={chartOption}
              style={{ height: isMobile ? 500 : 660, background: '#0f172a' }}
              opts={{ renderer: 'canvas' }}
              showLoading={loading}
              onEvents={{
                click: (params: any) => {
                  // 点击目的地节点（非出发地）跳转到行程规划
                  if (params.dataType === 'node' && params.data?.id !== origin) {
                    const values = form.getFieldsValue();
                    const [startDate, endDate] = values.dateRange || [];
                    const start = startDate ? startDate.format('YYYY-MM-DD') : '';
                    const end = endDate ? endDate.format('YYYY-MM-DD') : '';
                    const p = new URLSearchParams({
                      tab: 'plan',
                      origin,
                      destination: params.data.id,
                      // 去程和返程都用航线图的完整日期区间，确保能查到数据
                      departureDate: start,
                      departureDateEnd: end,
                      returnDate: start,
                      returnDateEnd: end,
                    });
                    navigate(`/route-planner?${p.toString()}`);
                  }
                },
              }}
            />
          ) : (
            <div style={{ height: isMobile ? 500 : 660, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#475569' }}>
              暂无数据
            </div>
          )}
          <div style={{ padding: '8px 16px', background: '#0f172a', color: '#475569', fontSize: isMobile ? 11 : 12, borderTop: '1px solid #1e293b' }}>
            {isMobile ? (
              <span>提示：双指缩放 · 点击节点查看详情 · <span style={{ color: '#60a5fa' }}>点击目的地跳转规划</span></span>
            ) : (
              <span>提示：可拖拽节点调整布局 · 滚轮缩放 · 悬浮节点查看详情 · <span style={{ color: '#60a5fa' }}>点击目的地节点跳转行程规划</span></span>
            )}
          </div>
        </Card>
      )}
    </Space>
  );
}

export default FlightMap;
