import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Button, Space, Tag, Statistic, Row, Col,
  message, Popconfirm, Select, Switch, Typography, Badge,
} from 'antd';
import { DeleteOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  getQueryCacheStats,
  listQueryCache,
  clearQueryCache,
  deleteCacheByKeys,
  toggleCache,
  type CacheItem,
} from '@/api/flight';

const { Text } = Typography;

const CACHE_TYPES = [
  { label: '全部', value: '' },
  { label: '目的地查询 (destinations)', value: 'destinations' },
  { label: '探索往返 (explore)', value: 'explore' },
  { label: '中转搜索 (transfer)', value: 'transfer' },
];

export default function CacheManagement() {
  const [stats, setStats] = useState<{ total: number; expired: number; valid: number; disabled: boolean } | null>(null);
  const [list, setList] = useState<CacheItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);

  const loadStats = useCallback(() => {
    getQueryCacheStats().then(setStats).catch(() => {});
  }, []);

  const loadList = useCallback(() => {
    setLoading(true);
    listQueryCache({ page, pageSize, type: typeFilter || undefined })
      .then(({ list, total }) => {
        setList(list);
        setTotal(total);
        setSelectedKeys([]);
      })
      .catch(() => message.error('加载缓存列表失败'))
      .finally(() => setLoading(false));
  }, [page, pageSize, typeFilter]);

  useEffect(() => {
    loadStats();
    loadList();
  }, [loadStats, loadList]);

  const handleToggle = async (enable: boolean) => {
    setToggleLoading(true);
    try {
      await toggleCache(enable);
      message.success(enable ? '缓存已开启' : '缓存已关闭');
      loadStats();
    } catch {
      message.error('操作失败');
    } finally {
      setToggleLoading(false);
    }
  };

  const handleClearAll = async () => {
    setClearLoading(true);
    try {
      const res = await clearQueryCache();
      message.success(`已清除 ${res.deletedCount} 条缓存`);
      loadStats();
      loadList();
    } catch {
      message.error('清除失败');
    } finally {
      setClearLoading(false);
    }
  };

  const handleBatchDelete = async () => {
    if (!selectedKeys.length) return;
    setBatchDeleteLoading(true);
    try {
      const res = await deleteCacheByKeys(selectedKeys);
      message.success(`已删除 ${res.deletedCount} 条缓存`);
      loadStats();
      loadList();
    } catch {
      message.error('删除失败');
    } finally {
      setBatchDeleteLoading(false);
    }
  };

  const handleDeleteOne = async (key: string) => {
    try {
      await deleteCacheByKeys([key]);
      message.success('已删除');
      loadStats();
      loadList();
    } catch {
      message.error('删除失败');
    }
  };

  const columns: ColumnsType<CacheItem> = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (type: string) => {
        const colorMap: Record<string, string> = {
          destinations: 'blue',
          explore: 'green',
          transfer: 'orange',
        };
        return <Tag color={colorMap[type] || 'default'}>{type}</Tag>;
      },
    },
    {
      title: '缓存 Key',
      dataIndex: 'cacheKey',
      ellipsis: true,
      render: (key: string) => (
        <Text copyable style={{ fontSize: 12, fontFamily: 'monospace' }}>{key}</Text>
      ),
    },
    {
      title: '大小',
      dataIndex: 'dataSize',
      width: 90,
      render: (size: number) => `${(size / 1024).toFixed(1)} KB`,
    },
    {
      title: '状态',
      dataIndex: 'expired',
      width: 80,
      render: (expired: boolean) =>
        expired
          ? <Badge status="error" text="已过期" />
          : <Badge status="success" text="有效" />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm:ss'),
    },
    {
      title: '过期时间',
      dataIndex: 'expireAt',
      width: 160,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      width: 80,
      render: (_, record) => (
        <Popconfirm title="确认删除?" onConfirm={() => handleDeleteOne(record.cacheKey)} okText="删除" cancelText="取消">
          <Button type="link" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      {/* 统计 + 开关 */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24} align="middle">
          <Col>
            <Statistic title="缓存总数" value={stats?.total ?? '-'} suffix="条" />
          </Col>
          <Col>
            <Statistic
              title="有效缓存"
              value={stats?.valid ?? '-'}
              suffix="条"
              valueStyle={{ color: '#3f8600' }}
            />
          </Col>
          <Col>
            <Statistic
              title="已过期"
              value={stats?.expired ?? '-'}
              suffix="条"
              valueStyle={{ color: '#cf1322' }}
            />
          </Col>
          <Col flex="auto" />
          <Col>
            <Space direction="vertical" size={4} style={{ textAlign: 'right' }}>
              <Space>
                <Text type="secondary">缓存开关</Text>
                <Switch
                  checked={stats ? !stats.disabled : true}
                  loading={toggleLoading}
                  onChange={handleToggle}
                  checkedChildren="开启"
                  unCheckedChildren="关闭"
                />
              </Space>
              {stats?.disabled && (
                <Text type="warning" style={{ fontSize: 12 }}>缓存已关闭，每次查询实时计算</Text>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 列表 + 操作 */}
      <Card
        title="缓存列表"
        extra={
          <Space>
            <Select
              value={typeFilter}
              onChange={v => { setTypeFilter(v); setPage(1); }}
              options={CACHE_TYPES}
              style={{ width: 220 }}
              placeholder="按类型筛选"
            />
            <Button icon={<ReloadOutlined />} onClick={() => { loadStats(); loadList(); }}>
              刷新
            </Button>
            {selectedKeys.length > 0 && (
              <Popconfirm
                title={`确认删除选中的 ${selectedKeys.length} 条缓存?`}
                onConfirm={handleBatchDelete}
                okText="删除"
                cancelText="取消"
              >
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  loading={batchDeleteLoading}
                >
                  删除选中 ({selectedKeys.length})
                </Button>
              </Popconfirm>
            )}
            <Popconfirm
              title="确认清除所有缓存?"
              onConfirm={handleClearAll}
              okText="清除"
              cancelText="取消"
            >
              <Button
                danger
                icon={<SyncOutlined />}
                loading={clearLoading}
              >
                清除全部
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Table
          rowKey="cacheKey"
          columns={columns}
          dataSource={list}
          loading={loading}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: keys => setSelectedKeys(keys as string[]),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: p => setPage(p),
            showTotal: t => `共 ${t} 条`,
          }}
          size="small"
        />
      </Card>
    </div>
  );
}
