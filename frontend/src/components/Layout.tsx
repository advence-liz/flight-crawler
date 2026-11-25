import { lazy, Suspense, useEffect, useState } from 'react';
import { Layout as AntLayout, Menu, Drawer, Button, Grid } from 'antd';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { CompassOutlined, AimOutlined, DatabaseOutlined, UnorderedListOutlined, EnvironmentOutlined, GlobalOutlined, HddOutlined, MenuOutlined, FieldTimeOutlined, BookOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { getAiTripStatus } from '@/api/ai-trip';
import { useSiteSession } from '@/hooks/useSiteSession';
import styles from './Layout.module.css';

const TripAgent = lazy(() => import('./TripAgent'));
const { Header, Content } = AntLayout;
const { useBreakpoint } = Grid;

function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [tripAgentEnabled, setTripAgentEnabled] = useState(false);
  const accountSession = useSiteSession();
  const { session, options } = accountSession;
  useEffect(() => {
    try { localStorage.removeItem('admin_token'); } catch { /* Old storage is optional. */ }
    let active = true;
    getAiTripStatus().then(({ chatEnabled }) => { if (active) setTripAgentEnabled(chatEnabled === true); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const isMobile = !useBreakpoint().md;
  const signedIn = session.status === 'member';
  const isAdmin = session.status === 'member' && session.account.isAdmin === true;
  const checking = session.status === 'checking';
  const label = signedIn ? '已登录' : session.status === 'guest' ? '登录' : '账号';
  const accountEntry = (session.status !== 'guest' || (options && Object.values(options).some(Boolean))) && (
    <Link to="/account" className={styles.account} aria-current={location.pathname === '/account' ? 'page' : undefined}
      aria-label={signedIn ? '已登录，打开我的账号' : checking ? '正在确认登录状态，打开账号页' : `${label}，打开账号页`}>
      <UserOutlined aria-hidden="true" />
      {signedIn && <span className={styles.dot} aria-hidden="true" />}
      <span>{isAdmin ? '管理员' : label}</span>
    </Link>
  );

  const allMenuItems = [
    { key: '/destination', icon: <CompassOutlined />, label: '目的地查询' },
    { key: '/flight-map', icon: <GlobalOutlined />, label: '航线地图' },
    { key: '/route-planner', icon: <AimOutlined />, label: '行程规划' },
    { key: '/guide', icon: <BookOutlined />, label: '使用指南' },
    { key: '/user-management', icon: <TeamOutlined />, label: '用户管理', adminOnly: true },
    { key: '/flight-management', icon: <UnorderedListOutlined />, label: '航班管理', adminOnly: true },
    { key: '/airport-management', icon: <EnvironmentOutlined />, label: '机场管理', adminOnly: true },
    { key: '/data-management', icon: <DatabaseOutlined />, label: '数据管理', adminOnly: true },
    { key: '/cache-management', icon: <HddOutlined />, label: '缓存管理', adminOnly: true },
    { key: '/cron-management', icon: <FieldTimeOutlined />, label: '定时任务', adminOnly: true },
  ];
  const menuItems = allMenuItems.filter(item => !item.adminOnly || isAdmin);
  const currentPath = location.pathname === '/' ? '/destination' : location.pathname;

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', padding: isMobile ? '0 16px' : '0 50px' }}>
        <Link to="/guide" aria-label="随心飞分析工具：使用指南" style={{
          display: 'flex', alignItems: 'center', gap: isMobile ? 16 : 8, color: 'white',
          fontSize: isMobile ? '16px' : '20px', marginRight: isMobile ? 'auto' : '50px',
          whiteSpace: 'nowrap', lineHeight: 1.4,
        }}>
          <img src="/logo.svg" alt="" style={{ width: isMobile ? 28 : 36, height: isMobile ? 28 : 36 }} />
          随心飞分析工具
        </Link>
        {isMobile ? (
          <>
            {accountEntry}
            <Button type="text" icon={<MenuOutlined />} aria-label="打开导航菜单"
              onClick={() => setDrawerVisible(true)} style={{ color: 'white' }} />
            <Drawer title="导航菜单" placement="right" onClose={() => setDrawerVisible(false)} open={drawerVisible}>
              <Menu mode="inline" selectedKeys={[currentPath]} items={menuItems}
                onClick={({ key }) => { navigate(key); setDrawerVisible(false); }} />
            </Drawer>
          </>
        ) : (
          <>
            <Menu theme="dark" mode="horizontal" selectedKeys={[currentPath]} items={menuItems}
              onClick={({ key }) => navigate(key)} style={{ flex: 1, minWidth: 0 }} />
            {accountEntry}
          </>
        )}
      </Header>
      <Content style={{ padding: isMobile ? '16px' : '24px', background: '#f0f2f5' }}>
        <Outlet context={{ accountSession, tripAgentEnabled }} />
      </Content>
      {signedIn && tripAgentEnabled && <Suspense fallback={null}><TripAgent /></Suspense>}
    </AntLayout>
  );
}

export default Layout;
