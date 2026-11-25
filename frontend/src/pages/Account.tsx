import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Space, Spin } from 'antd';
import { AimOutlined, ApiOutlined, ArrowRightOutlined, CheckCircleOutlined, CopyOutlined, GithubOutlined, GoogleOutlined, KeyOutlined, LogoutOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { beginSocialLogin, enterEmailCode, issueOwnMcpToken, revokeOwnMcpToken, sendEmailCode, signOutSite,
  MCP_ENDPOINT, SiteRequestError } from '@/api/site-auth';
import { useAccountPage } from '@/hooks/useSiteSession';
import styles from './Account.module.css';

export default function Account() {
  const { accountSession, tripAgentEnabled } = useAccountPage();
  const { session, options, refresh, clearSession, setHasToken } = accountSession;
  const account = session.status === 'member' ? session.account : undefined;
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string>();
  const [copyStatus, setCopyStatus] = useState('');
  const [addressStatus, setAddressStatus] = useState('');
  const [error, setError] = useState(new URLSearchParams(location.search).has('login') ? '登录未完成，请确认第三方账号邮箱已验证后重试。' : '');

  async function action(fn: () => Promise<void>, fallback: string) {
    setBusy(true); setError('');
    try { await fn(); }
    catch (e) {
      const status = e instanceof SiteRequestError ? e.status : undefined;
      if (account && status === 401) {
        clearSession();
        setToken(undefined);
        setError('登录已失效，请重新登录。');
      } else {
        setError(status === 429 ? '请求过于频繁或额度已用完，请稍后再试。' : fallback);
      }
    } finally { setBusy(false); }
  }

  function social(provider: 'github' | 'google') {
    void action(async () => {
      const { url } = await beginSocialLogin(provider);
      const destination = new URL(url);
      if (destination.origin !== (provider === 'github' ? 'https://github.com' : 'https://accounts.google.com')) throw new Error('Invalid provider URL');
      location.assign(destination.href);
    }, '暂时无法打开授权页，请稍后重试。');
  }

  function issue() {
    const run = () => action(async () => {
      const result = await issueOwnMcpToken();
      setCopyStatus('');
      setToken(result.token);
      setHasToken(true);
    }, '无法生成 Token，请刷新账号状态后重试。');
    if (account?.hasToken) Modal.confirm({ title: '轮换 Token？', content: '原 Token 会立即失效。请在 AI 客户端换上新 Token。', okText: '确认轮换', cancelText: '取消', onOk: run });
    else void run();
  }

  const revoke = () => Modal.confirm({ title: '撤销 Token？', content: '使用这个 Token 的 AI 客户端将不能再查询航班。', okText: '确认撤销', cancelText: '取消', okButtonProps: { danger: true },
    onOk: () => action(async () => { await revokeOwnMcpToken(); setHasToken(false); }, '无法撤销 Token，请稍后重试。') });

  async function copy(value: string, feedback: (value: string) => void) {
    try { await navigator.clipboard.writeText(value); feedback('已复制'); }
    catch { feedback('无法自动复制，请选中文字手动复制。'); }
  }

  const retry = () => { setError(''); void refresh(); };
  const providersEnabled = options && Object.values(options).some(Boolean);
  const title = account ? '我的账号' : session.status === 'guest' ? '登录随心飞' : '我的账号';

  return <article className={`${styles.page} ${account ? '' : styles.compact}`}>
    <header className={account ? styles.identity : styles.signInHeader}>
      <div className={styles.identityMain}>
        <span className={styles.avatar} aria-hidden="true">{account ? <UserOutlined /> : <MailOutlined />}</span>
        <div>
          <h1>{title}</h1>
          {account ? <><strong>{account.name || '随心飞用户'}</strong><p>{account.email}{account.isAdmin === true ? ' · 管理员' : ''}</p></>
            : <p>登录后可使用行程助手，或让自己的 AI 查航班。</p>}
        </div>
      </div>
      {account && <div className={styles.identityActions}>
        <span><CheckCircleOutlined aria-hidden="true" /> 已登录</span>
        <Button ghost icon={<LogoutOutlined />} loading={busy} onClick={() => void action(async () => {
          await signOutSite(); setToken(undefined); setSentTo(''); clearSession();
        }, '退出失败，当前仍处于登录状态。请稍后再试。')}>退出登录</Button>
      </div>}
    </header>
    {error && <Alert type="error" showIcon message={error} className={styles.error} />}
    {account ? <div className={styles.workspace}>
      <section className={styles.connect} aria-labelledby="mcp-heading">
        <div className={styles.sectionHeading}>
          <span className={styles.icon}><ApiOutlined aria-hidden="true" /></span>
          <div><h2 id="mcp-heading">接入自己的 AI</h2><p>通过 MCP 查询随心飞航班与直飞往返。</p></div>
        </div>
        {account.mcpEnabled ? <div className={styles.endpoint}>
          <span>线上 MCP 地址</span>
          <code>{MCP_ENDPOINT}</code>
          <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(MCP_ENDPOINT, setAddressStatus)}>复制地址</Button>
          {addressStatus && <small role="status">{addressStatus}</small>}
        </div> : <Alert type="info" showIcon message="MCP 尚未开放。" className={styles.error} />}
        <div className={styles.keyRow}>
          <div><h3><KeyOutlined aria-hidden="true" /> 个人 Token</h3>
            <span className={account.hasToken ? styles.active : styles.inactive}>{account.hasToken ? '已生成 Token' : '未生成 Token'}</span></div>
          <Space wrap size={8}>
            {account.mcpEnabled && <Button type="primary" disabled={busy} onClick={issue}>{account.hasToken ? '轮换 Token' : '生成 Token'}</Button>}
            {account.hasToken && <Button danger disabled={busy} onClick={revoke}>撤销 Token</Button>}
          </Space>
        </div>
        <Link to="/guide?section=mcp" className={styles.guideLink}>查看客户端配置 <ArrowRightOutlined aria-hidden="true" /></Link>
      </section>
      <aside className={styles.aside} aria-label="站内行程助手">
        <span className={styles.icon}><AimOutlined aria-hidden="true" /></span>
        <h2>站内行程助手</h2>
        <p>{tripAgentEnabled ? '不需要 MCP Token。点右下角「行程助手」，直接说出你的出行计划。' : '行程助手暂不可用，仍可手动查询或规划。'}</p>
        <Link to="/route-planner" className={styles.guideLink}>打开行程规划 <ArrowRightOutlined aria-hidden="true" /></Link>
      </aside>
    </div> : <section className={styles.signInBody} aria-label="登录方式">
      {(session.status === 'checking' || (session.status === 'guest' && options === undefined)) ? <div className={styles.loading} role="status"><Spin size="small" /> 正在确认登录状态…</div>
        : session.status === 'blocked' ? <Alert type="warning" showIcon message="账号已停用，请联系管理员。" action={<Button size="small" onClick={retry}>重试</Button>} />
        : session.status === 'unavailable' ? <Alert type="warning" showIcon message="暂时无法确认登录状态" description="请稍后再试，不需要重新授权。" action={<Button size="small" onClick={retry}>重试</Button>} />
        : options === null ? <Alert type="warning" showIcon message="暂时无法读取登录方式" action={<Button size="small" onClick={retry}>重试</Button>} />
        : <>
          {!providersEnabled && <Alert type="info" message="网站登录暂未开放，仍可直接查询航班。" />}
          {(options?.github || options?.google) && <div className={styles.providers}>
            {options.github && <>
              <Button block icon={<GithubOutlined />} type="primary" disabled={busy} onClick={() => social('github')}>使用 GitHub 登录</Button>
              <details className={styles.signupHelp}>
                <summary>没有 GitHub 账号？</summary>
                <div className={styles.signupSteps}>
                  <ol>
                    <li><a href="https://github.com/signup" target="_blank" rel="noopener noreferrer">去 GitHub 官网免费注册（新标签页）</a>。用常用邮箱注册，并按邮件提示验证邮箱。不需要 Gmail，也不必安装软件或创建仓库。</li>
                    <li>回到随心飞，点击「使用 GitHub 登录」，在 GitHub 页面确认授权。</li>
                  </ol>
                  <p><strong>收不到验证邮件？</strong> 核对邮箱地址、查看垃圾邮件，或在 GitHub 上重发。</p>
                  <p><strong>GitHub 页面打不开？</strong> 可以稍后再试。查航班和手动规划行程都不需要登录。</p>
                  <p>密码和验证码只在 GitHub 官网输入，不要填到随心飞或发给别人。</p>
                </div>
              </details>
            </>}
            {options.google && <Button block icon={<GoogleOutlined />} disabled={busy} onClick={() => social('google')}>使用 Google 登录</Button>}
            <p>首次授权会创建网站账号。</p>
          </div>}
          {options?.email && <div className={styles.email}>
            <p>邮箱验证码仅限受邀用户。</p>
            {!sentTo ? <Form layout="vertical" onFinish={({ email }: { email: string }) => void action(async () => {
              const normalized = email.trim().toLowerCase(); await sendEmailCode(normalized); setSentTo(normalized);
            }, '验证码发送失败，请稍后重试。')}>
              <Form.Item label="邮箱地址" name="email" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}><Input type="email" autoComplete="email" maxLength={254} /></Form.Item>
              <Button block type="primary" htmlType="submit" loading={busy}>发送验证码</Button>
            </Form> : <Form layout="vertical" onFinish={({ otp }: { otp: string }) => void action(async () => {
              await enterEmailCode(sentTo, otp); setSentTo(''); await refresh();
            }, '验证码无效或已过期，请重试。')}>
              <p>如果该邮箱已受邀，你将收到一封验证码邮件（5 分钟内有效）。</p>
              <Form.Item label="6 位验证码" name="otp" rules={[{ required: true, pattern: /^\d{6}$/, message: '请输入 6 位验证码' }]}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></Form.Item>
              <Button block type="primary" htmlType="submit" loading={busy}>验证并登录</Button>
              <Button type="link" disabled={busy} onClick={() => setSentTo('')}>更换邮箱或重新发送</Button>
            </Form>}
          </div>}
          <Link to="/destination" className={styles.guideLink}>先不登录，去查航班</Link>
        </>}
    </section>}
    <Modal title="保存你的 MCP Token" open={Boolean(token)} destroyOnHidden onCancel={() => setToken(undefined)}
      footer={<Button type="primary" onClick={() => setToken(undefined)}>完成</Button>}>
      <Alert type="warning" showIcon message="仅显示这一次。请保存到可信的密钥工具，不要发到聊天或提交到仓库。" />
      {token && <Input.TextArea className={styles.secret} value={token} aria-label="MCP Token" readOnly autoSize />}
      <Button icon={<CopyOutlined />} onClick={() => { if (token) void copy(token, setCopyStatus); }}>复制 Token</Button>
      <span className={styles.copyStatus} role="status">{copyStatus}</span>
    </Modal>
  </article>;
}
