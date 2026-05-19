import { useState } from 'react';
import { fetchApi } from '../api/client';

export default function ConnectionSetup({ onConnect }) {
  const [ip, setIp] = useState(window.location.host || '127.0.0.1:3186');
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Temporary setup to test health endpoint
      let apiBase = ip;
      if (!apiBase.startsWith('http')) apiBase = `http://${apiBase}`;
      if (!apiBase.includes(':', 6)) apiBase = `${apiBase}:3186`;
      
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['x-api-key'] = token;

      const res = await fetch(`${apiBase}/api/health`, { headers });
      if (!res.ok) {
        if (res.status === 401) throw new Error('API Key 無效或未授權 (401)');
        throw new Error(`連線失敗 (HTTP ${res.status})`);
      }
      
      // Success!
      onConnect(ip, token);
    } catch (err) {
      setError(err.message || '無法連線到伺服器，請確認 IP 位址及網路連線。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-card glass-panel padded">
        <div className="setup-header">
          <div className="brand-logo">TC</div>
          <h2 className="title-large">TC MIM (Web)</h2>
          <p className="text-secondary mt-2">請輸入桌面版伺服器的內網 IP 與金鑰以建立連線。</p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>伺服器 IP (或 hostname)</label>
            <input 
              type="text" 
              className="input" 
              value={ip} 
              onChange={e => setIp(e.target.value)}
              placeholder="例如 192.168.1.100"
              required 
            />
          </div>
          
          <div className="form-group">
            <label>API 授權金鑰 (x-api-key)</label>
            <input 
              type="password" 
              className="input" 
              value={token} 
              onChange={e => setToken(e.target.value)}
              placeholder="留空若目標伺服器未啟用驗證"
            />
          </div>

          <button 
            type="submit" 
            className="btn-primary w-full mt-4"
            disabled={isLoading}
          >
            {isLoading ? '連線中...' : '建立安全連線'}
          </button>
        </form>
      </div>
    </div>
  );
}
