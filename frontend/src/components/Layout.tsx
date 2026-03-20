import { useState } from 'react';
import { Layout as AntLayout, Menu, Drawer, Button, Grid } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { CompassOutlined, AimOutlined, DatabaseOutlined, UnorderedListOutlined, EnvironmentOutlined, GlobalOutlined, HddOutlined, MenuOutlined } from '@ant-design/icons';

const { Header, Content } = AntLayout;
const { useBreakpoint } = Grid;

function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md; // < 768px

  const menuItems = [
    {
      key: '/destination',
      icon: <CompassOutlined />,
      label: '目的地查询',
    },
    {
      key: '/flight-map',
      icon: <GlobalOutlined />,
      label: '航线地图',
    },
    {
      key: '/route-planner',
      icon: <AimOutlined />,
      label: '行程规划',
    },
    {
      key: '/flight-management',
      icon: <UnorderedListOutlined />,
      label: '航班管理',
    },
    {
      key: '/airport-management',
      icon: <EnvironmentOutlined />,
      label: '机场管理',
    },
    {
      key: '/data-management',
      icon: <DatabaseOutlined />,
      label: '数据管理',
    },
    {
      key: '/cache-management',
      icon: <HddOutlined />,
      label: '缓存管理',
    },
  ];

  const currentPath = location.pathname === '/' ? '/destination' : location.pathname;

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header style={{
        display: 'flex',
        alignItems: 'center',
        padding: isMobile ? '0 16px' : '0 50px'
      }}>
        <div style={{
          color: 'white',
          fontSize: isMobile ? '16px' : '20px',
          marginRight: isMobile ? '16px' : '50px',
          whiteSpace: 'nowrap'
        }}>
          ✈️ 随心飞分析工具
        </div>

        {isMobile ? (
          <>
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setDrawerVisible(true)}
              style={{ color: 'white', marginLeft: 'auto' }}
            />
            <Drawer
              title="导航菜单"
              placement="right"
              onClose={() => setDrawerVisible(false)}
              open={drawerVisible}
            >
              <Menu
                mode="inline"
                selectedKeys={[currentPath]}
                items={menuItems}
                onClick={({ key }) => {
                  navigate(key);
                  setDrawerVisible(false);
                }}
              />
            </Drawer>
          </>
        ) : (
          <Menu
            theme="dark"
            mode="horizontal"
            selectedKeys={[currentPath]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ flex: 1, minWidth: 0 }}
          />
        )}
      </Header>
      <Content style={{
        padding: isMobile ? '16px' : '24px',
        background: '#f0f2f5'
      }}>
        <Outlet />
      </Content>
    </AntLayout>
  );
}

export default Layout;
