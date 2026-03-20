import { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Space, message, Tooltip, Badge } from 'antd';
import { ReloadOutlined, ThunderboltOutlined, ClockCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { getCronJobs, triggerCronJob, type CronJob } from '@/api/flight';

// cron 表达式转人读描述
function parseCron(cron: string): string {
  const map: Record<string, string> = {
    '0 2 * * *': '每天 02:00',
    '0 3 * * *': '每天 03:00',
    '7 * * * *': '每小时 :07 分',
  };
  return map[cron] ?? cron;
}

export default function CronManagement() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);

  const loadJobs = () => {
    setLoading(true);
    getCronJobs()
      .then(setJobs)
      .catch(() => message.error('加载定时任务失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadJobs(); }, []);

  const handleTrigger = async (name: string) => {
    setTriggering(name);
    try {
      const res = await triggerCronJob(name);
      if (res.success) {
        message.success(`已触发：${name}`);
      } else {
        message.warning(res.message);
      }
    } catch {
      message.error('触发失败');
    } finally {
      setTriggering(null);
    }
  };

  const columns: ColumnsType<CronJob> = [
    {
      title: '任务名称',
      dataIndex: 'name',
      render: (name: string) => <code style={{ fontSize: 12 }}>{name}</code>,
    },
    {
      title: '功能描述',
      dataIndex: 'desc',
    },
    {
      title: '执行频率',
      dataIndex: 'cron',
      render: (cron: string) => (
        <Space size={4}>
          <ClockCircleOutlined style={{ color: '#1677ff' }} />
          <span>{parseCron(cron)}</span>
          <Tooltip title={cron}>
            <Tag style={{ fontFamily: 'monospace', fontSize: 11, cursor: 'help' }}>{cron}</Tag>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'running',
      width: 90,
      render: (running: boolean) =>
        running
          ? <Badge status="processing" text="运行中" />
          : <Badge status="default" text="空闲" />,
    },
    {
      title: '下次执行',
      dataIndex: 'nextDate',
      width: 160,
      render: (next: string | null) =>
        next ? (
          <Tooltip title={next}>
            <span style={{ fontSize: 12 }}>{dayjs(next).format('MM-DD HH:mm:ss')}</span>
          </Tooltip>
        ) : <span style={{ color: '#bbb' }}>—</span>,
    },
    {
      title: '操作',
      width: 100,
      render: (_, record) => (
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          loading={triggering === record.name}
          onClick={() => handleTrigger(record.name)}
        >
          立即触发
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="定时任务管理"
      extra={
        <Button icon={<ReloadOutlined />} onClick={loadJobs} loading={loading}>
          刷新
        </Button>
      }
    >
      <Table
        rowKey="name"
        columns={columns}
        dataSource={jobs}
        loading={loading}
        pagination={false}
        size="small"
      />
    </Card>
  );
}
