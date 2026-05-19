import { useState, useCallback, useEffect } from 'react';
import ConnectionSetup from './pages/ConnectionSetup';
import Dashboard from './pages/Dashboard';
import Machines from './pages/Machines';
import Products from './pages/Products';
import { setupApiClient } from './api/client';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [config, setConfig] = useState(() => {
    const savedIp = localStorage.getItem('pmc_server_ip');
    const savedToken = localStorage.getItem('pmc_api_token');
    return { ip: savedIp || '', token: savedToken || '' };
  });
  const [view, setView] = useState('dashboard');

  useEffect(() => {
    if (config.ip) {
      setupApiClient(config.ip, config.token);
      setIsConnected(true);
    }
  }, []);

  const handleConnect = useCallback((ip, token) => {
    localStorage.setItem('pmc_server_ip', ip);
    localStorage.setItem('pmc_api_token', token);
    setConfig({ ip, token });
    setupApiClient(ip, token);
    setIsConnected(true);
  }, []);

  const handleDisconnect = useCallback(() => {
    localStorage.removeItem('pmc_server_ip');
    localStorage.removeItem('pmc_api_token');
    setConfig({ ip: '', token: '' });
    setIsConnected(false);
  }, []);

  if (!isConnected) {
    return <ConnectionSetup onConnect={handleConnect} />;
  }

  return (
    <div className="app-container">
      <header className="app-header glass-panel">
        <div className="header-brand">
          <div className="brand-logo">TC</div>
          <div>
            <div className="brand-subtitle">TAN CHIN MIM</div>
            <h1 className="brand-title">整合監控系統 (Web)</h1>
          </div>
        </div>
        
        <nav className="header-nav">
          <button className={`nav-btn ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>儀表板</button>
          <button className={`nav-btn ${view === 'machines' ? 'active' : ''}`} onClick={() => setView('machines')}>設備設定</button>
          <button className={`nav-btn ${view === 'products' ? 'active' : ''}`} onClick={() => setView('products')}>產品主資料</button>
          <button className={`nav-btn ${view === 'degreasing' ? 'active' : ''}`} onClick={() => setView('degreasing')}>脫脂作業</button>
          <button className={`nav-btn ${view === 'sintering' ? 'active' : ''}`} onClick={() => setView('sintering')}>燒結作業</button>
        </nav>

        <div className="header-actions">
          <div className="status-badge connected">已連線: {config.ip}</div>
          <button className="btn-secondary sm" onClick={handleDisconnect}>斷開</button>
        </div>
      </header>
      
      <main className="app-main">
        {view === 'dashboard' && <Dashboard />}
        {view === 'machines' && <Machines />}
        {view === 'products' && <Products />}
        {['dashboard', 'machines', 'products'].indexOf(view) === -1 && (
          <div className="glass-panel padded">
            <h2 className="title-large">功能建置中...</h2>
            <p className="text-secondary mt-2">此頁面即將於後續階段實作。</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
