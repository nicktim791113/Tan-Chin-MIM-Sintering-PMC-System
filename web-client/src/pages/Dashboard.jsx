import { useState, useEffect } from 'react';
import { fetchApi } from '../api/client';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setIsLoading(true);
      setError('');
      const data = await fetchApi('/dashboard');
      setSummary(data);
    } catch (err) {
      setError('無法取得儀表板資料: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return <div className="glass-panel padded">載入中...</div>;
  if (error) return <div className="glass-panel padded"><div className="text-danger">{error}</div><button className="btn-secondary mt-4" onClick={loadDashboard}>重試</button></div>;
  if (!summary) return null;

  const degreasingActive = summary.degreasing?.machines?.filter(m => m.status === 'active')?.length || 0;
  const degreasingTotal = summary.degreasing?.machines?.length || 0;
  const vacuumTotal = summary.vacuum_units?.length || 0;
  const sinteringTotal = summary.furnaces?.length || 0;

  return (
    <div className="space-y-4">
      {/* Top Summary Cards */}
      <div className="panel p-4 xl:p-4">
        <div className="panel-header">
          <div>
            <h2 className="text-2xl font-black text-ink">儀表板</h2>
            <p className="text-sm text-slate">總覽溶劑警示、真空設備數量與近期批次。</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-5 mt-4">
          <div className="glass-panel dashboard-card p-4 rounded-xl border border-slate-100 bg-white">
            <div className="text-sm text-slate uppercase tracking-wide">浸泡式脫脂數量</div>
            <div className="text-2xl font-bold mt-1">{degreasingActive} / {degreasingTotal}</div>
          </div>
          <div className="glass-panel dashboard-card p-4 rounded-xl border border-slate-100 bg-white">
            <div className="text-sm text-slate uppercase tracking-wide">溶劑超標警示</div>
            <div className="text-2xl font-bold mt-1" style={{ color: summary.degreasing?.solvent_alert_count > 0 ? 'var(--danger)' : 'inherit' }}>
              {summary.degreasing?.solvent_alert_count || 0} 台
            </div>
          </div>
          <div className="glass-panel dashboard-card p-4 rounded-xl border border-slate-100 bg-white">
            <div className="text-sm text-slate uppercase tracking-wide">待更換容忍</div>
            <div className="text-2xl font-bold mt-1 text-alert">
              {summary.degreasing?.near_threshold_count || 0} 台
            </div>
          </div>
          <div className="glass-panel dashboard-card p-4 rounded-xl border border-slate-100 bg-white">
            <div className="text-sm text-slate uppercase tracking-wide">真空脫脂爐數量</div>
            <div className="text-2xl font-bold mt-1">{vacuumTotal}</div>
          </div>
          <div className="glass-panel dashboard-card p-4 rounded-xl border border-slate-100 bg-white">
            <div className="text-sm text-slate uppercase tracking-wide">真空燒結爐數量</div>
            <div className="text-2xl font-bold mt-1">{sinteringTotal}</div>
          </div>
        </div>
      </div>

      {/* Tables Section */}
      <div className="grid gap-4 xl:gap-4 xl:grid-cols-3">
        <div className="panel p-4 xl:p-4">
          <div className="panel-header mb-4"><h3 className="text-xl font-bold text-ink">近期真空式脫脂排程</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-200 text-slate">
                  <th className="pb-2 font-medium">批次號</th>
                  <th className="pb-2 font-medium">設備</th>
                  <th className="pb-2 font-medium">預定日期</th>
                </tr>
              </thead>
              <tbody>
                {summary.upcoming_vacuum?.length > 0 ? (
                  summary.upcoming_vacuum.map(batch => (
                    <tr key={batch.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2">{batch.batch_no}</td>
                      <td className="py-2">{batch.vacuum_machine_code || '-'}</td>
                      <td className="py-2">{batch.planned_date}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="3" className="py-4 text-center text-slate">無資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel p-4 xl:p-4">
          <div className="panel-header mb-4"><h3 className="text-xl font-bold text-ink">近期真空式燒結排程</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-200 text-slate">
                  <th className="pb-2 font-medium">批次號</th>
                  <th className="pb-2 font-medium">設備</th>
                  <th className="pb-2 font-medium">預定日期</th>
                </tr>
              </thead>
              <tbody>
                {summary.upcoming_sintering?.length > 0 ? (
                  summary.upcoming_sintering.map(batch => (
                    <tr key={batch.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2">{batch.batch_no}</td>
                      <td className="py-2">{batch.furnace_machine_code || '-'}</td>
                      <td className="py-2">{batch.planned_date}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="3" className="py-4 text-center text-slate">無資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel p-4 xl:p-4">
          <div className="panel-header mb-4"><h3 className="text-xl font-bold text-ink">最近浸泡式脫脂投入</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-200 text-slate">
                  <th className="pb-2 font-medium">批次號</th>
                  <th className="pb-2 font-medium">作業人員</th>
                  <th className="pb-2 font-medium">投入時間</th>
                </tr>
              </thead>
              <tbody>
                {summary.recent_degreasing?.length > 0 ? (
                  summary.recent_degreasing.map(batch => (
                    <tr key={batch.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2">{batch.batch_no || `BATCH-${batch.id}`}</td>
                      <td className="py-2">{batch.operator_name}</td>
                      <td className="py-2">{new Date(batch.operated_at).toLocaleString()}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="3" className="py-4 text-center text-slate">無資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
