import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import Overview from './pages/Overview';
import RuntimeDetail from './pages/RuntimeDetail';
import TokenDetail from './pages/TokenDetail';
import ContextDetail from './pages/ContextDetail';
import ToolDetail from './pages/ToolDetail';
import LogDetail from './pages/LogDetail';
import PluginDetail from './pages/PluginDetail';
import LockDetail from './pages/LockDetail';
import Settings from './pages/Settings';
import ErrorBoundary from './components/ErrorBoundary';
import { ready } from './api/bridge';
import { useTheme } from './theme';

/** 导航项配置 */
const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/', label: '总览' },
  { to: '/runtime', label: '运行时' },
  { to: '/token', label: 'Token' },
  { to: '/context', label: '上下文' },
  { to: '/tool', label: '工具' },
  { to: '/log', label: '日志' },
  { to: '/plugin', label: '插件' },
  { to: '/lock', label: '会话锁' },
  { to: '/settings', label: '设置' },
];

/** 顶部导航布局 */
function Layout({ children }: { children: React.ReactNode }) {
  const [bridgeReady, setBridgeReady] = useState(false);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    ready()
      .then(() => setBridgeReady(true))
      .catch(() => setBridgeReady(false));
  }, []);

  return (
    <>
      <header className="app-header">
        <Link to="/" className="app-header__brand">
          <span className="brand-icon">+</span>
          <span>359度 Debug</span>
          <span className="brand-sub">· 359°体检</span>
        </Link>
        <nav className="app-header__nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                'nav-link' + (isActive ? ' active' : '')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-header__actions">
          <button
            className="theme-toggle"
            onClick={toggle}
            title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
            aria-label="切换主题"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <div className="app-header__status">
            <span className={'live-dot' + (bridgeReady ? '' : ' offline')} />
            <span>{bridgeReady ? '已连接' : '连接中'}</span>
          </div>
        </div>
      </header>
      <main className="app-main">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/runtime" element={<RuntimeDetail />} />
          <Route path="/token" element={<TokenDetail />} />
          <Route path="/context" element={<ContextDetail />} />
          <Route path="/tool" element={<ToolDetail />} />
          <Route path="/log" element={<LogDetail />} />
          <Route path="/plugin" element={<PluginDetail />} />
          <Route path="/lock" element={<LockDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Overview />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
