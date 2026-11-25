import { useEffect, useState } from 'react';
import { Alert, Button, Divider, Form, Input, Modal, Space, Spin, Tag } from 'antd';
import { GithubOutlined, GoogleOutlined, MailOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { beginSocialLogin, enterEmailCode, getLoginOptions, getSiteAccount, issueOwnMcpToken, revokeOwnMcpToken,
  sendEmailCode, signOutSite, SiteRequestError, type LoginOptions, type SiteAccount } from '@/api/site-auth';
import styles from './UsageGuide.module.css';

export default function Account() {
  const [options, setOptions] = useState<LoginOptions>();
  const [account, setAccount] = useState<SiteAccount>();
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string>();
  const [copyStatus, setCopyStatus] = useState('');
  const [error, setError] = useState(new URLSearchParams(location.search).has('login') ? '登录未完成，请确认第三方账号邮箱已验证后重试。' : '');
  useEffect(() => {
    let active = true;
    void getLoginOptions().then(value => { if (active) setOptions(value); }).catch(() => { if (active) setOptions({ email: false, github: false, google: false }); });
    void getSiteAccount().then(value => { if (active) setAccount(value); }).catch(error => {
      if (active && error instanceof SiteRequestError && error.status === 403) setError('账号已停用，请联系管理员。');
    });
    return () => { active = false; };
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); }
    catch (e) { setError(e instanceof SiteRequestError && e.status === 429 ? '请求过于频繁或额度已用完，请稍后再试。' : '操作未完成，请检查登录信息或稍后再试。'); }
    finally { setBusy(false); }
  }
  function social(provider: 'github' | 'google') {
    void action(async () => {
      const { url } = await beginSocialLogin(provider);
      const destination = new URL(url);
      if (destination.origin !== (provider === 'github' ? 'https://github.com' : 'https://accounts.google.com')) throw new Error('Invalid provider URL');
      location.assign(destination.href);
    });
  }
  return <article className={styles.guide} style={{ maxWidth: 480 }}>
    <header className={styles.header}><MailOutlined /><div><h1>{account ? '我的账号' : '登录随心飞'}</h1>
      <p>{account ? account.email : '登录后可以使用行程助手，并管理自己的 MCP Token。'}</p></div></header>
    {error && <Alert type="error" showIcon message={error} style={{ marginBlock: 12 }} />}
    {!options && !account && <Spin />}
    {account ? <>
      <Divider />
      <h2>MCP 访问</h2>
      <p>{account.mcpEnabled ? '用你的独立 Token 接入外部 AI，关闭发放窗口后无法再查看明文。' : 'MCP 尚未对外开放。'}</p>
      <Space wrap style={{ marginBlock: 12 }}>
        <Tag color={account.hasToken ? 'green' : 'default'}>{account.hasToken ? '已有 Token' : '未发放 Token'}</Tag>
        {account.mcpEnabled && <Button type="primary" disabled={busy} onClick={() => {
          const issue = () => action(async () => { setCopyStatus(''); setToken((await issueOwnMcpToken()).token); setAccount({ ...account, hasToken: true }); });
          if (account.hasToken) Modal.confirm({ title: '轮换 Token？', content: '原 Token 将立即失效。', onOk: issue });
          else void issue();
        }}>{account.hasToken ? '轮换 Token' : '发放 Token'}</Button>}
        {account.hasToken && <Button danger disabled={busy} onClick={() => Modal.confirm({ title: '撤销 Token？',
          onOk: () => action(async () => { await revokeOwnMcpToken(); setAccount({ ...account, hasToken: false }); }) })}>撤销 Token</Button>}
      </Space>
      <p><Link to="/guide?section=mcp">查看 MCP 使用指南</Link></p>
      <Divider />
      <Button disabled={busy} onClick={() => void action(async () => { await signOutSite(); location.reload(); })}>退出登录</Button>
    </> : options && <>
      <Divider />
      {!Object.values(options).some(Boolean) && <Alert type="info" message="网站登录暂未开放，仍可直接查询航班。" />}
      <Space direction="vertical" style={{ display: 'flex' }}>
        {options.github && <Button block icon={<GithubOutlined />} disabled={busy} onClick={() => social('github')}>使用 GitHub 登录</Button>}
        {options.google && <Button block icon={<GoogleOutlined />} disabled={busy} onClick={() => social('google')}>使用 Google 登录</Button>}
      </Space>
      {options.email && <>
        {(options.github || options.google) && <Divider plain>或</Divider>}
        <p>邮箱验证码仅限受邀用户。</p>
        {!sentTo ? <Form layout="vertical" onFinish={({ email }: { email: string }) => void action(async () => {
          const normalized = email.trim().toLowerCase(); await sendEmailCode(normalized); setSentTo(normalized);
        })}>
          <Form.Item label="邮箱地址" name="email" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}><Input type="email" autoComplete="email" maxLength={254} /></Form.Item>
          <Button block type="primary" htmlType="submit" loading={busy}>发送验证码</Button>
        </Form> : <Form layout="vertical" onFinish={({ otp }: { otp: string }) => void action(async () => {
          await enterEmailCode(sentTo, otp); location.reload();
        })}>
          <p>如果该邮箱已受邀，你将收到一封验证码邮件（5 分钟内有效）。</p>
          <Form.Item label="6 位验证码" name="otp" rules={[{ required: true, pattern: /^\d{6}$/, message: '请输入 6 位验证码' }]}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></Form.Item>
          <Button block type="primary" htmlType="submit" loading={busy}>验证并登录</Button>
          <Button type="link" disabled={busy} onClick={() => setSentTo('')}>更换邮箱或重新发送</Button>
        </Form>}
      </>}
    </>}
    <Modal title="一次性显示的 MCP Token" open={Boolean(token)} destroyOnHidden onCancel={() => setToken(undefined)}
      footer={<Button type="primary" onClick={() => setToken(undefined)}>完成</Button>}>
      {token && <Input.TextArea value={token} aria-label="MCP Token" readOnly autoSize />}
      <Button onClick={() => { if (token) void navigator.clipboard.writeText(token).then(() => setCopyStatus('已复制'), () => setCopyStatus('请选中 Token 手动复制。')); }}>复制 Token</Button>
      <span role="status">{copyStatus}</span>
    </Modal>
  </article>;
}
