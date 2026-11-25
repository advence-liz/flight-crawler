import { useState, type ReactNode } from 'react';
import { BookOutlined, CodeOutlined, CompassOutlined, AimOutlined, GlobalOutlined, CopyOutlined } from '@ant-design/icons';
import { Alert, Button, Tabs, Tag } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { MCP_ENDPOINT as endpoint } from '@/api/site-auth';
import styles from './UsageGuide.module.css';

const workBuddyDocs = 'https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector';
const harnessDocs = 'https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-manager/README.zh.md';
const workBuddyConfig = JSON.stringify({ mcpServers: { suixinfei: {
  type: 'streamableHttp', url: endpoint, headers: { Authorization: 'Bearer YOUR_FLIGHT_MCP_TOKEN' },
} } }, null, 2);
const harnessConfig = `suixinfei:
  transport: streamable-http
  url: ${endpoint}
  headers:
    Authorization: 'Bearer \${credential:FLIGHT_MCP_TOKEN}'
  enabled: true`;

const codexDocs = 'https://learn.chatgpt.com/docs/extend/mcp';
const claudeDesktopDocs = 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp';
const codexConfig = `[mcp_servers.suixinfei]\nurl = "${endpoint}"\nbearer_token_env_var = "FLIGHT_MCP_TOKEN"`;

const developerClients = [
  {
    name: 'Claude Code', file: '.mcp.json', docs: 'https://code.claude.com/docs/en/mcp',
    config: JSON.stringify({ mcpServers: { suixinfei: { type: 'http', url: endpoint,
      headers: { Authorization: 'Bearer ${FLIGHT_MCP_TOKEN}' } } } }, null, 2),
    help: '在启动 Claude Code 的进程环境中设置 FLIGHT_MCP_TOKEN，再用 /mcp 查看连接。',
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

function CopyableConfig({ name, file, config, copyLabel = '复制配置', wrap = false, children }: {
  name: string; file: string; config: string; copyLabel?: string; wrap?: boolean; children?: ReactNode;
}) {
  const [notice, setNotice] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(config);
      setNotice('已复制');
    } catch {
      setNotice('无法自动复制，请选中下方配置手动复制。');
    }
  }

  return <div>
    <div className={styles.codeHeader}>
      <code>{file}</code>
      <Button size="small" icon={<CopyOutlined />} onClick={() => void copy()}>{copyLabel}</Button>
      <span className={styles.copyNotice} role="status">{notice}</span>
    </div>
    <pre className={wrap ? `${styles.code} ${styles.wrappedCode}` : styles.code} tabIndex={0} aria-label={`${name} 线上配置示例`}><code>{config}</code></pre>
    {children}
  </div>;
}

function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

function WorkBuddyGuide() {
  return <div>
    <ol className={styles.clientSteps}>
      <li>在腾讯 WorkBuddy 桌面端，打开「专家·技能·连接器」，选「连接器」→「自定义连接器」→「配置 MCP」。</li>
      <li>复制下面的配置，粘贴到连接器配置里。把 <code>YOUR_FLIGHT_MCP_TOKEN</code> 换成你的个人 Token，保留前面的 <code>Bearer</code> 和一个空格。如果已有连接器，只新增 <code>suixinfei</code> 这一项。</li>
      <li>保存并启用连接器。请在连接器配置里填写 Token，不要把带 Token 的配置发到聊天里。</li>
    </ol>
    <CopyableConfig name="WorkBuddy" file="MCP 配置（JSON）" config={workBuddyConfig} copyLabel="复制 WorkBuddy 配置">
      <p className={styles.configHelp}><DocsLink href={workBuddyDocs}>WorkBuddy 官方操作说明</DocsLink> · <DocsLink href="https://open.workbuddy.cn/docs/connector">连接器配置规范</DocsLink></p>
    </CopyableConfig>
  </div>;
}

function HarnessGuide() {
  return <div>
    <ol className={styles.clientSteps}>
      <li>打开 DeepSeek Harness 桌面端（不是普通 DeepSeek 聊天），在凭据设置中保存个人 Token，名称填 <code>FLIGHT_MCP_TOKEN</code>，值只填 Token。</li>
      <li>在设置里的 MCP 管理器添加名为 <code>suixinfei</code> 的服务。传输类型选 <strong>Streamable HTTP</strong>，地址和请求头按下方示例填写。不要开启 OAuth，也不要把 Token 明文填进配置。</li>
      <li>保存并启用。如果没有 MCP 管理器或无法添加请求头，请按官方说明查看版本及配置方式。</li>
    </ol>
    <CopyableConfig name="DeepSeek Harness" file="单个服务器配置（YAML 片段）" config={harnessConfig} copyLabel="复制 Harness 配置">
      <p className={styles.configHelp}>按字段填写，或将片段合并到管理器的 <code>config.servers</code> 下；不要替换已有服务器。<DocsLink href={harnessDocs}>DeepSeek Harness 官方配置说明</DocsLink></p>
    </CopyableConfig>
  </div>;
}

function CodexDesktopGuide() {
  return <div>
    <ol className={styles.clientSteps}>
      <li>在 Codex 桌面端打开 Settings（设置）→ MCP servers。普通 ChatGPT 网页不是这个入口。</li>
      <li>把下方配置合并到 <code>~/.codex/config.toml</code>，保留已有服务器。让桌面应用的启动环境能读到 <code>FLIGHT_MCP_TOKEN</code>，值填个人 Token。不要把 Token 原文写进配置，也不用走 OAuth。</li>
      <li>完全退出再打开应用，回到 MCP servers 确认 <code>suixinfei</code> 已启用。</li>
    </ol>
    <CopyableConfig name="Codex" file="~/.codex/config.toml" config={codexConfig} copyLabel="复制 Codex 配置">
      <p className={styles.configHelp}>桌面端、Codex CLI 和 IDE 扩展共用这份配置。<DocsLink href={codexDocs}>Codex 官方 MCP 说明</DocsLink></p>
    </CopyableConfig>
  </div>;
}

function ClaudeDesktopGuide() {
  return <div>
    <ol className={styles.clientSteps}>
      <li>在 Claude 桌面端打开 Customize（自定义）→ Connectors（连接器）→「+ Add」→「Add custom connector」。名称可填「随心飞」，地址用下方完整链接。</li>
      <li>认证选 No sign in（无需登录）。在 Request headers（请求头）中，名称填 <code>Authorization</code>，值填 <code>Bearer YOUR_FLIGHT_MCP_TOKEN</code>，把占位文字替换成个人 Token，保留 <code>Bearer</code> 和空格。</li>
      <li>添加后，在聊天输入框旁的「+」菜单启用随心飞。请把个人 Token 只填到你自己的连接器里，不要填到组织共享连接器或聊天里。</li>
    </ol>
    <CopyableConfig name="Claude 桌面版" file="远程 MCP 地址" config={endpoint} copyLabel="复制 MCP 地址" wrap>
      <p className={styles.configHelp}>如果没有自定义连接器或 Request headers 入口，请先查看账户权限。<DocsLink href={claudeDesktopDocs}>Claude 官方连接器说明</DocsLink></p>
    </CopyableConfig>
  </div>;
}

const desktopClients = [
  { key: 'workbuddy', label: 'WorkBuddy', Guide: WorkBuddyGuide },
  { key: 'harness', label: 'DeepSeek Harness', Guide: HarnessGuide },
  { key: 'codex', label: 'Codex 桌面版', Guide: CodexDesktopGuide },
  { key: 'claude', label: 'Claude 桌面版', Guide: ClaudeDesktopGuide },
] as const;

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
  const [desktop, setDesktop] = useState<(typeof desktopClients)[number]['key']>('workbuddy');
  const { Guide } = desktopClients.find(client => client.key === desktop) ?? desktopClients[0];
  return <div className={styles.panel}>
    <h2>让你的 AI 直接查随心飞航班</h2>
    <Alert type="info" showIcon message="如何获取 MCP Token" description={<>登录后打开<Link to="/account">我的账号</Link>，在「MCP 访问」生成个人 Token。它只显示一次，请妥善保存，不要发给别人。</>} />
    <ol className={styles.steps}>
      <li>
        <h3>在你的桌面 AI 里添加随心飞</h3>
        <p>选你正在用的桌面应用，按步骤添加随心飞。步骤依据产品文档整理，未做桌面端实测；入口可能随版本变化。</p>
        <div role="radiogroup" aria-label="桌面客户端" className={styles.desktopChoices}>
          {desktopClients.map(({ key, label }) => <label key={key}>
            <input type="radio" name="desktop-mcp-client" checked={desktop === key} onChange={() => setDesktop(key)} />
            <span>{label}</span>
          </label>)}
        </div>
        <Guide />
        <details className={styles.developerConfigs}>
          <summary>开发者配置</summary>
          <Tabs size="small" items={developerClients.map(client => ({ key: client.name, label: client.name, children:
            <CopyableConfig key={client.name} {...client}>
              <p className={styles.configHelp}>{client.help} <DocsLink href={client.docs}>客户端官方文档</DocsLink></p>
            </CopyableConfig>,
          }))} />
        </details>
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
