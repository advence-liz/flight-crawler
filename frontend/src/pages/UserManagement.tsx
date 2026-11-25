import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Form, Input, Modal, Space, Spin, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { isAxiosError } from 'axios';
import { createMcpUser, issueMcpToken, listMcpUsers, revokeMcpToken, setMcpUserActive, type McpUser } from '@/api/mcp-users';
import styles from './UserManagement.module.css';

function failure(error: unknown) {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 401) return '登录已失效，请在「我的账号」重新登录。';
  if (status === 403) return '此账号没有管理员权限。';
  if (status === 503) return '用户与额度数据库暂不可用，请稍后重试。';
  if (status === 409 || status === 404) return '该用户的状态可能已改变，请刷新名单后再试。';
  return '操作未完成，请确认网络后重试。';
}

export default function UserManagement() {
  const [form] = Form.useForm<{ name: string; email?: string }>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [roster, setRoster] = useState<{ users: McpUser[]; hasMore: boolean }>();
  const [readError, setReadError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; token: string }>();
  const [copyNote, setCopyNote] = useState('');
  const refresh = () => setRevision(value => value + 1);

  useEffect(() => {
    let active = true;
    setReadError('');
    setRoster(undefined);
    void listMcpUsers(page).then(result => { if (active) setRoster(result); })
      .catch((error: unknown) => { if (active) setReadError(failure(error)); });
    return () => { active = false; };
  }, [page, revision]);

  async function change(run: () => Promise<void>) {
    setWriteError('');
    setBusy(true);
    try {
      await run();
      refresh();
    } catch (error) { setWriteError(failure(error)); }
    finally { setBusy(false); }
  }

  function confirm(title: string, content: string, action: () => Promise<void>) {
    Modal.confirm({ title, content, okText: '确认', cancelText: '取消', okButtonProps: { danger: true },
      onOk: () => change(action) });
  }

  function issue(user: McpUser) {
    const action = async () => {
      const { token } = await issueMcpToken(user.id);
      setCopyNote('');
      setSecret({ name: user.name, token });
    };
    if (user.hasToken) confirm('轮换 MCP Token？', '新 Token 发放后，旧 Token 立即失效。', action);
    else void change(action);
  }

  async function copy(token: string) {
    try { await navigator.clipboard.writeText(token); setCopyNote('已复制'); }
    catch { setCopyNote('无法自动复制，请选中上方 Token 手动复制。'); }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><h1>用户管理</h1><p>管理网站账号与 MCP 访问。新建用户时填写邮箱即可邀请其使用验证码登录。</p></div>
      <Button type="primary" icon={<PlusOutlined />} disabled={busy || !roster} onClick={() => { setWriteError(''); setCreating(true); }}>新建用户</Button>
    </header>
    <p className={styles.caption}>今日用量按北京时间统计，只记录获准的 MCP 工具调用；查看工具列表不计入。</p>
    {readError && <Alert type="error" showIcon message={readError} action={<Button onClick={refresh}>重试</Button>} />}
    {!creating && writeError && <Alert type="error" showIcon message={writeError} />}
    {!readError && <section className={styles.roster} aria-label="受邀用户名单">
      {!roster ? <Empty image={<Spin />} description="正在读取用户名单" /> : roster.users.length === 0
        ? <Empty description="还没有受邀用户。新建用户后，再为其发放 Token。" /> : <>
        <div className={styles.columns} aria-hidden="true"><span>用户</span><span>访问状态</span><span>今日调用</span><span>操作</span></div>
        <div role="list">{roster.users.map(user => <div className={styles.row} role="listitem" key={user.id}>
          <strong className={styles.name}>{user.name}{user.email && <small style={{ display: 'block', fontWeight: 'normal' }}>{user.email}</small>}</strong>
          <span>{user.active ? user.hasToken ? <Tag color="green">已发放 Token</Tag> : <Tag>未发放 Token</Tag> : <Tag color="red">已停用</Tag>}</span>
          <span className={styles.calls}><span className={styles.mobileLabel}>今日调用 </span>{user.todayCalls} 次</span>
          <Space wrap size={4}>
            {user.active && <Button size="small" disabled={busy} onClick={() => issue(user)}>{user.hasToken ? '轮换 Token' : '发放 Token'}</Button>}
            {user.hasToken && <Button size="small" disabled={busy} onClick={() => confirm('撤销 MCP Token？', '该 Token 将立即失效，已统计的用量保留。', async () => { await revokeMcpToken(user.id); })}>撤销 Token</Button>}
            <Button size="small" danger={user.active} disabled={busy} onClick={() => user.active
              ? confirm('停用用户？', '停用会撤销现有 Token。重新启用后，需要重新发放。', async () => { await setMcpUserActive(user.id, false); })
              : void change(async () => { await setMcpUserActive(user.id, true); })}>{user.active ? '停用' : '启用'}</Button>
          </Space>
        </div>)}</div>
      </>}
    </section>}
    {roster && (page > 1 || roster.hasMore) && <div className={styles.pagination}>
      <Button disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <span>第 {page} 页</span>
      <Button disabled={busy || !roster.hasMore} onClick={() => setPage(value => value + 1)}>下一页</Button>
    </div>}
    <Modal title="新建受邀用户" open={creating} onOk={() => form.submit()} confirmLoading={busy} okText="创建" cancelText="取消"
      onCancel={() => { if (!busy) { setCreating(false); form.resetFields(); setWriteError(''); } }}>
      {writeError && <Alert type="error" showIcon message={writeError} />}
      <Form form={form} layout="vertical" onFinish={({ name, email }) => void change(async () => {
        await createMcpUser(name.trim(), email?.trim() || undefined); setPage(1); setCreating(false); form.resetFields();
      })}>
        <Form.Item name="name" label="用户名称" rules={[{ required: true, whitespace: true, message: '请输入用户名称' }]}>
          <Input maxLength={60} placeholder="识别受邀者用的名称" autoComplete="off" />
        </Form.Item>
        <Form.Item name="email" label="邀请邮箱（可选）" rules={[{ type: 'email', message: '请输入有效邮箱' }]}>
          <Input type="email" maxLength={254} placeholder="填邮箱才能使用验证码登录" autoComplete="off" />
        </Form.Item>
      </Form>
    </Modal>
    <Modal title={`MCP Token${secret ? `：${secret.name}` : ''}`} open={Boolean(secret)} destroyOnHidden onCancel={() => setSecret(undefined)}
      footer={<Button type="primary" onClick={() => setSecret(undefined)}>完成</Button>}>
      <Alert type="warning" showIcon message="仅显示这一次。请通过安全渠道交给受邀用户。" />
      {secret && <Input.TextArea className={styles.secret} aria-label="一次性显示的 MCP Token" value={secret.token} readOnly autoSize />}
      <Button onClick={() => { if (secret) void copy(secret.token); }}>复制 Token</Button> <span role="status">{copyNote}</span>
    </Modal>
  </main>;
}
