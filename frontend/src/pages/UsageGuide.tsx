import { useState } from 'react';
import { BookOutlined, CodeOutlined, CompassOutlined, AimOutlined, GlobalOutlined, CopyOutlined } from '@ant-design/icons';
import { Alert, Button, Tabs, Tag } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import styles from './UsageGuide.module.css';

const endpoint = 'https://flight-crawler.onrender.com/api/mcp';
const clients = [
  {
    name: 'Claude Code', file: '.mcp.json', docs: 'https://code.claude.com/docs/en/mcp',
    config: JSON.stringify({ mcpServers: { suixinfei: { type: 'http', url: endpoint,
      headers: { Authorization: 'Bearer ${FLIGHT_MCP_TOKEN}' } } } }, null, 2),
    help: '在启动 Claude Code 的进程环境中设置 FLIGHT_MCP_TOKEN，再用 /mcp 查看连接。',
  },
  {
    name: 'Codex', file: '~/.codex/config.toml', docs: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
    config: `[mcp_servers.suixinfei]\nurl = "${endpoint}"\nbearer_token_env_var = "FLIGHT_MCP_TOKEN"`,
    help: '在启动 Codex 的进程环境中设置 FLIGHT_MCP_TOKEN。适用于 Codex CLI 和 IDE 扩展。',
  },
  {
    name: 'Cursor', file: '.cursor/mcp.json', docs: 'https://cursor.com/docs/context/mcp',
    config: JSON.stringify({ mcpServers: { suixinfei: { url: endpoint,
      headers: { Authorization: 'Bearer ${env:FLIGHT_MCP_TOKEN}' } } } }, null, 2),
    help: '让 Cursor 进程能读取 FLIGHT_MCP_TOKEN，再到 MCP 设置里确认工具是否出现。',
  },
  {
    name: 'VS Code', file: '.vscode/mcp.json', docs: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
    config: JSON.stringify({ inputs: [{ type: 'promptString', id: 'flight-mcp-token', description: '航班 MCP Token', password: true }],
      servers: { suixinfei: { type: 'http', url: endpoint, headers: { Authorization: 'Bearer ${input:flight-mcp-token}' } } } }, null, 2),
    help: '这是 VS Code 编辑器内 Copilot Agent 的配置。首次连接时在编辑器的密码输入框里填 Token，不要写进配置文件。',
  },
];

function ConfigExample({ client }: { client: (typeof clients)[number] }) {
  const [notice, setNotice] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(client.config);
      setNotice('已复制');
    } catch {
      setNotice('无法自动复制，请选中下方配置手动复制。');
    }
  }

  return <div>
    <div className={styles.codeHeader}>
      <code>{client.file}</code>
      <Button size="small" icon={<CopyOutlined />} onClick={() => void copy()}>复制配置</Button>
      <span className={styles.copyNotice} role="status">{notice}</span>
    </div>
    <pre className={styles.code} tabIndex={0} aria-label={`${client.name} 线上配置示例`}><code>{client.config}</code></pre>
    <p className={styles.configHelp}>{client.help} <a href={client.docs} target="_blank" rel="noreferrer">客户端官方文档</a></p>
  </div>;
}

function WebsiteGuide() {
  return <div className={styles.panel}>
    <h2>先查能飞哪，再比较怎么飞</h2>
    <div className={styles.board}>
      <section>
        <CompassOutlined aria-hidden="true" />
        <div><h3>目的地还没定</h3><p>在「目的地查询」选择出发城市或机场、日期范围和权益卡。查询后展开有兴趣的目的地，查看去程和返程。</p></div>
        <Link to="/destination">打开目的地查询</Link>
      </section>
      <section>
        <AimOutlined aria-hidden="true" />
        <div><h3>要比较具体行程</h3><p>在「行程规划」选择去、返程的日期范围和中转条件。目的地可留空探索；填上目的地就查指定路线。展开方案查看每一段航班。</p></div>
        <Link to="/route-planner">打开行程规划</Link>
      </section>
      <section>
        <GlobalOutlined aria-hidden="true" />
        <div><h3>想从地图看航线</h3><p>在「航线地图」选一个出发地，查看从这里出发的航线。</p></div>
        <Link to="/flight-map">打开航线地图</Link>
      </section>
    </div>
    <aside className={styles.example}>
      <Tag color="blue">需要登录</Tag>
      <h3>用行程助手直接说需求</h3>
      <p>站点启用 AI 时，右下角会出现「行程助手」。登录后可以问：「上海出发，找个不用请假的周末，666 卡直飞往返。」也可以接着说「换个城市」或「返程晚一点」。助手不可用时，仍可手动查航班或规划行程。</p>
    </aside>
  </div>;
}

function McpGuide() {
  return <div className={styles.panel}>
    <h2>让你的 AI 直接查随心飞航班</h2>
    <Alert type="info" showIcon message="如何获取 MCP Token" description={<>登录后打开<Link to="/account">我的账号</Link>，在「MCP 访问」里发放个人 Token。Token 明文只显示一次；请妥善保存，不要把它发给别人，也不要使用管理员 Token。</>} />
    <ol className={styles.steps}>
      <li>
        <h3>复制线上配置到你的 AI 客户端</h3>
        <p>选择客户端，把配置合并到已有设置里，并按提示提供你的个人 Token。不要覆盖其他 MCP 服务。</p>
        <Tabs size="small" items={clients.map(client => ({ key: client.name, label: client.name, children: <ConfigExample client={client} /> }))} />
        <p>ChatGPT 网页版不能直接使用这套固定 Token 配置。</p>
      </li>
      <li>
        <h3>连接后，直接问一个出行问题</h3>
        <p>试试「上海出发，找个不用请假的周末，666 卡直飞往返」。客户端可以用 <code>search_flights</code> 查指定航线的班次，或用 <code>find_round_trips</code> 查直飞往返。</p>
        <p>查询结果带采集时间和日期覆盖范围。「超出快照范围」不等于「没有符合条件的航班」。</p>
      </li>
      <li>
        <h3>查不到时，先区分未授权和限流</h3>
        <dl className={styles.errors}>
          <div><dt><code>401</code></dt><dd>检查是否注入了正确的 MCP Token。</dd></div>
          <div><dt><code>429</code></dt><dd>站内繁忙或配额用完。按响应的 <code>Retry-After</code> 等待；每日配额按北京时间零点重置。</dd></div>
          <div><dt><code>503</code></dt><dd>配额服务暂不可用，稍后重试，或回站内手动查航班。</dd></div>
        </dl>
      </li>
    </ol>
  </div>;
}

export default function UsageGuide() {
  const [params, setParams] = useSearchParams();
  const section = params.get('section') === 'mcp' ? 'mcp' : 'website';
  return <article className={styles.guide}>
    <header className={styles.header}>
      <BookOutlined aria-hidden="true" />
      <div><h1>使用指南</h1><p>在本站查航班、比行程，也可以了解如何把随心飞航班数据接入自己的 AI。</p></div>
    </header>
    <p className={styles.snapshot}>本站使用航班采集快照，不代表实时余票；兑换前请以航司页面为准。</p>
    <Tabs activeKey={section} onChange={key => setParams(key === 'mcp' ? { section: 'mcp' } : {}, { preventScrollReset: true })} items={[
      { key: 'website', label: <><CompassOutlined />在本站使用</>, children: <WebsiteGuide /> },
      { key: 'mcp', label: <><CodeOutlined />接入自己的 AI</>, children: <McpGuide /> },
    ]} />
  </article>;
}
