import { lazy, Suspense } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { Spin } from 'antd';
import Layout from './components/Layout';
import { getAdminToken } from './utils/auth';

// 目的地查询是默认落地页，同步加载；其余页面按路由懒加载，避免 echarts/china-map-echarts/xlsx 等重库拖累首屏体积
import DestinationQuery from './pages/DestinationQuery';
const RoutePlanner = lazy(() => import('./pages/RoutePlanner'));
const DataManagement = lazy(() => import('./pages/DataManagement'));
const FlightManagement = lazy(() => import('./pages/FlightManagement'));
const AirportManagement = lazy(() => import('./pages/AirportManagement'));
const FlightMap = lazy(() => import('./pages/FlightMap'));
const CacheManagement = lazy(() => import('./pages/CacheManagement'));
const CronManagement = lazy(() => import('./pages/CronManagement'));

// 管理员路由保护：无 token 时重定向到首页
function AdminRoute({ children }: { children: React.ReactNode }) {
  return getAdminToken() ? <>{children}</> : <Navigate to="/destination" replace />;
}

const PageFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
    <Spin size="large" />
  </div>
);

function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<DestinationQuery />} />
          <Route path="destination" element={<DestinationQuery />} />
          <Route path="route-planner" element={<RoutePlanner />} />
          <Route path="flight-map" element={<FlightMap />} />
          <Route path="data-management" element={<AdminRoute><DataManagement /></AdminRoute>} />
          <Route path="flight-management" element={<AdminRoute><FlightManagement /></AdminRoute>} />
          <Route path="airport-management" element={<AdminRoute><AirportManagement /></AdminRoute>} />
          <Route path="cache-management" element={<AdminRoute><CacheManagement /></AdminRoute>} />
          <Route path="cron-management" element={<AdminRoute><CronManagement /></AdminRoute>} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default App;
