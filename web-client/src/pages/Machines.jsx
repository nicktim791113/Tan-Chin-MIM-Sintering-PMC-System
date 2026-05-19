import { useState, useEffect } from 'react';
import { fetchApi } from '../api/client';
import { Table } from '../components/Table';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

export default function Machines() {
  const [machines, setMachines] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('degreasing_immersion'); 
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ 
    machine_code: '', 
    machine_name: '', 
    machine_type: 'degreasing_immersion', 
    status: 'active',
    solvent_weight_limit: 1000,
    standard_temperature: 0,
    notes: '',
    total_layers: 8,
    total_inner_height: 960,
    effective_width: 600,
    effective_depth: 500,
    base_layer_gap: 120,
    positions_per_layer: 2,
    gap_max_extra: 20
  });
  const { showToast } = useToast();

  useEffect(() => {
    loadMachines();
  }, [activeTab]);

  const loadMachines = async () => {
    try {
      setIsLoading(true);
      const data = await fetchApi(`/machines?machine_type=${activeTab}`);
      setMachines(data || []);
    } catch (err) {
      showToast('無法載入設備資料: ' + err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await fetchApi(`/machines/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
        showToast('設備已更新', 'success');
      } else {
        await fetchApi('/machines', { method: 'POST', body: JSON.stringify(form) });
        showToast('設備已新增', 'success');
      }
      setIsModalOpen(false);
      loadMachines();
    } catch (err) {
      showToast('儲存失敗: ' + err.message, 'error');
    }
  };

  const openNew = () => {
    setForm({ 
      machine_code: '', 
      machine_name: '', 
      machine_type: activeTab, 
      status: 'active',
      solvent_weight_limit: 1000,
      standard_temperature: 0,
      notes: '',
      total_layers: 8,
      total_inner_height: 960,
      effective_width: 600,
      effective_depth: 500,
      base_layer_gap: 120,
      positions_per_layer: 2,
      gap_max_extra: 20
    });
    setEditingId(null);
    setIsModalOpen(true);
  };

  const openEdit = (m) => {
    setForm({ 
      machine_code: m.machine_code || '', 
      machine_name: m.machine_name || '', 
      machine_type: m.machine_type || 'degreasing_immersion', 
      status: m.status || 'active',
      solvent_weight_limit: m.solvent_weight_limit ?? 1000,
      standard_temperature: m.standard_temperature ?? 0,
      notes: m.notes || '',
      total_layers: m.total_layers ?? 8,
      total_inner_height: m.total_inner_height ?? 960,
      effective_width: m.effective_width ?? 600,
      effective_depth: m.effective_depth ?? 500,
      base_layer_gap: m.base_layer_gap ?? 120,
      positions_per_layer: m.positions_per_layer ?? 2,
      gap_max_extra: m.gap_max_extra ?? 20
    });
    setEditingId(m.id);
    setIsModalOpen(true);
  };

  const columns = [
    { label: '#', field: 'id' },
    { label: '設備編號', field: 'machine_code' },
    { label: '設備名稱', field: 'machine_name' },
    { 
      label: '狀態', 
      render: (m) => {
        const isOnline = m.status === 'active';
        const isMaintenance = m.status === 'maintenance';
        let className = isOnline ? 'connected' : (isMaintenance ? 'warning' : 'disconnected');
        let text = isOnline ? '啟用' : (isMaintenance ? '維護中' : '停用');
        return <span className={`status-badge ${className}`}>{text}</span>;
      }
    },
    { 
      label: '操作', 
      render: (m) => (
        <button className="btn-secondary sm" onClick={() => openEdit(m)}>編輯</button>
      )
    }
  ];

  const isVacuumOrFurnace = form.machine_type === 'degreasing_reserved' || form.machine_type === 'sintering_furnace';
  const isImmersion = form.machine_type === 'degreasing_immersion';

  return (
    <div className="space-y-4">
      <div className="panel p-4 xl:p-4">
        <div className="panel-header">
          <div>
            <h2 className="text-2xl font-black text-ink">設備設定</h2>
            <p className="text-sm text-slate">管理設備資料與真空爐排盤結構參數。</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button className={`nav-btn ${activeTab === 'degreasing_immersion' ? 'active' : ''}`} onClick={() => setActiveTab('degreasing_immersion')}>浸泡式脫脂槽</button>
        <button className={`nav-btn ${activeTab === 'degreasing_reserved' ? 'active' : ''}`} onClick={() => setActiveTab('degreasing_reserved')}>真空式脫脂爐</button>
        <button className={`nav-btn ${activeTab === 'sintering_furnace' ? 'active' : ''}`} onClick={() => setActiveTab('sintering_furnace')}>真空式燒結爐</button>
      </div>

      <div className="panel p-4 xl:p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-ink">設備列表</h3>
          <button className="btn-primary" onClick={openNew}>+ 新增設備</button>
        </div>
        
        {isLoading ? <p>載入中...</p> : <Table columns={columns} data={machines} />}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto pt-10 pb-10">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 relative my-auto">
            <h3 className="text-xl font-bold text-ink mb-6">{editingId ? '編輯設備' : '新增設備'}</h3>
            <form id="machine-form" onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="form-group">
                  <label className="text-sm font-semibold text-ink">設備類型</label>
                  <select className="input" value={form.machine_type} onChange={e => setForm({...form, machine_type: e.target.value})}>
                    <option value="degreasing_immersion">浸泡式脫脂槽</option>
                    <option value="degreasing_reserved">真空式脫脂爐</option>
                    <option value="sintering_furnace">真空式燒結爐</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="text-sm font-semibold text-ink">狀態</label>
                  <select className="input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                    <option value="active">啟用</option>
                    <option value="inactive">停用</option>
                    <option value="maintenance">維護中</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="text-sm font-semibold text-ink">設備編號</label>
                  <input className="input" value={form.machine_code} onChange={e => setForm({...form, machine_code: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="text-sm font-semibold text-ink">設備名稱</label>
                  <input className="input" value={form.machine_name} onChange={e => setForm({...form, machine_name: e.target.value})} required />
                </div>

                {isImmersion && (
                  <>
                    <div className="form-group">
                      <label className="text-sm font-semibold text-ink">溶劑更換門檻 (kg)</label>
                      <input type="number" step="0.1" min="0" className="input" value={form.solvent_weight_limit} onChange={e => setForm({...form, solvent_weight_limit: parseFloat(e.target.value)})} />
                    </div>
                    <div className="form-group">
                      <label className="text-sm font-semibold text-ink">標準溫度 (°C)</label>
                      <input type="number" step="0.1" className="input" value={form.standard_temperature} onChange={e => setForm({...form, standard_temperature: parseFloat(e.target.value)})} />
                    </div>
                  </>
                )}
              </div>
              <div className="form-group">
                <label className="text-sm font-semibold text-ink">備註</label>
                <textarea className="input min-h-[80px]" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}></textarea>
              </div>

              {isVacuumOrFurnace && (
                <div className="mt-6 p-4 bg-slate-50 border border-slate-100 rounded-lg space-y-4">
                  <h4 className="font-bold text-ink mb-2">真空爐結構設定</h4>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <div className="form-group">
                      <label className="text-sm font-semibold text-ink">層數</label>
                      <input type="number" min="1" className="input" value={form.total_layers} onChange={e => setForm({...form, total_layers: parseInt(e.target.value)})} />
                    </div>
                    <div className="form-group">
                      <label className="text-sm font-semibold text-ink">每層位置數</label>
                      <input type="number" min="1" className="input" value={form.positions_per_layer} onChange={e => setForm({...form, positions_per_layer: parseInt(e.target.value)})} />
                    </div>
                    <div className="form-group">
                      <label className="text-sm font-semibold text-ink">總高度 (mm)</label>
                      <input type="number" step="0.1" className="input" value={form.total_inner_height} onChange={e => setForm({...form, total_inner_height: parseFloat(e.target.value)})} />
                    </div>
                    <div className="form-group">
                      <label className="text-sm font-semibold text-ink">基礎層高 (mm)</label>
                      <input type="number" step="0.1" className="input" value={form.base_layer_gap} onChange={e => setForm({...form, base_layer_gap: parseFloat(e.target.value)})} />
                    </div>
                    <div className="form-group">
                      <label className="text-sm font-semibold text-ink">有效寬度 (mm)</label>
                      <input type="number" step="0.1" className="input" value={form.effective_width} onChange={e => setForm({...form, effective_width: parseFloat(e.target.value)})} />
                    </div>
                    <div className="form-group">
                      <label className="text-sm font-semibold text-ink">有效深度 (mm)</label>
                      <input type="number" step="0.1" className="input" value={form.effective_depth} onChange={e => setForm({...form, effective_depth: parseFloat(e.target.value)})} />
                    </div>
                    <div className="form-group">
                      <label className="text-sm font-semibold text-ink">可調整高度 (mm)</label>
                      <input type="number" step="0.1" className="input" value={form.gap_max_extra} onChange={e => setForm({...form, gap_max_extra: parseFloat(e.target.value)})} />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>取消</button>
                <button type="submit" className="btn-primary">儲存設備</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
