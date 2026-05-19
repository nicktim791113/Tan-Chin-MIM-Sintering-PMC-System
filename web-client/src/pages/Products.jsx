import { useState, useEffect } from 'react';
import { fetchApi } from '../api/client';
import { Table } from '../components/Table';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

function HelpIcon({ label, text }) {
  return (
    <span className="help-icon" tabIndex={0} aria-label={label} data-tooltip={text}>
      ?
    </span>
  );
}

export default function Products() {
  const [activeTab, setActiveTab] = useState('masters'); // 'masters' or 'specs'
  const [data, setData] = useState([]);
  const [masters, setMasters] = useState([]); // Used for the spec form dropdown
  const [fixtures, setFixtures] = useState([]); // Support blocks for spec form
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const { showToast } = useToast();

  useEffect(() => {
    loadData();
    if (activeTab === 'specs') {
      loadDependencies();
    }
  }, [activeTab]);

  const loadData = async (query = searchQuery) => {
    try {
      setIsLoading(true);
      const urlQuery = query ? `?keyword=${encodeURIComponent(query)}` : '?limit=5&order=desc';
      const endpoint = activeTab === 'masters' ? `/product-masters${urlQuery}` : `/products${urlQuery}`;
      const result = await fetchApi(endpoint);
      setData(result || []);
    } catch (err) {
      showToast('無法載入資料: ' + err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDependencies = async () => {
    try {
      const [mastersData, fixturesData] = await Promise.all([
        fetchApi('/product-masters?limit=1000'),
        fetchApi('/support-blocks')
      ]);
      setMasters(mastersData || []);
      setFixtures(fixturesData || []);
    } catch (err) {
      console.warn("Could not load dependencies for specs:", err);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const endpoint = activeTab === 'masters' ? '/product-masters' : '/products';
    try {
      // Clean up stringified numbers for specs
      const payload = { ...form };
      if (activeTab === 'specs') {
        const productHeight = parseFloat(payload.product_height);
        const trayCapacity = parseInt(payload.tray_capacity, 10);
        payload.product_height = Number.isFinite(productHeight) ? productHeight : undefined;
        payload.tray_capacity = Number.isInteger(trayCapacity) ? trayCapacity : undefined;
        payload.support_stack_quantity = parseInt(payload.support_stack_quantity) || 1;
        payload.can_mix_load = !!payload.can_mix_load;
        payload.product_master_id = parseInt(payload.product_master_id) || null;
      }

      if (editingId) {
        await fetchApi(`${endpoint}/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('資料已更新', 'success');
      } else {
        await fetchApi(endpoint, { method: 'POST', body: JSON.stringify(payload) });
        showToast('資料已新增', 'success');
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      showToast('儲存失敗: ' + err.message, 'error');
    }
  };

  const openNew = () => {
    if (activeTab === 'masters') {
      setForm({ 
        product_code: '', 
        product_name: '', 
        erp_item_code: '', 
        erp_item_id: '', 
        revision: '', 
        source_system: 'local', 
        sync_status: 'local_only', 
        notes: '' 
      });
    } else {
      setForm({
        product_master_id: '',
        spec_code: '',
        spec_name: '',
        process_revision: '',
        erp_spec_id: '',
        erp_route_id: '',
        product_height: '',
        tray_capacity: '',
        tray_fixture_id: '',
        support_fixture_id: '',
        support_stack_quantity: 1,
        ceramic_tray_fixture_id: '',
        foot_fixture_id: '',
        preferred_furnace_type: '',
        source_system: 'local',
        sync_status: 'local_only',
        notes: '',
        can_mix_load: false
      });
    }
    setEditingId(null);
    setIsModalOpen(true);
  };

  const openEdit = (item) => {
    setForm(item);
    setEditingId(item.id);
    setIsModalOpen(true);
  };

  const masterColumns = [
    { label: '#', field: 'id' },
    { label: '產品代碼', field: 'product_code' },
    { label: '產品名稱', field: 'product_name' },
    { label: '版次', field: 'revision' },
    { label: '來源', render: (m) => m.source_system === 'erp' ? 'ERP同步' : '本地建立' },
    { 
      label: '操作', 
      render: (m) => <button className="btn-secondary sm" onClick={() => openEdit(m)}>編輯</button>
    }
  ];

  const specColumns = [
    { label: '#', field: 'id' },
    { label: '主檔料號', field: 'part_no' },
    { label: '規格代碼', field: 'spec_code' },
    { label: '單盤容量', field: 'tray_capacity' },
    { label: '產品高度', field: 'product_height' },
    { label: '來源', render: (m) => m.source_system === 'erp' ? 'ERP同步' : '本地建立' },
    { 
      label: '操作', 
      render: (m) => <button className="btn-secondary sm" onClick={() => openEdit(m)}>編輯</button>
    }
  ];

  return (
    <div className="space-y-4">
      <div className="panel p-4 xl:p-4">
        <div className="panel-header">
          <div>
            <h2 className="text-2xl font-black text-ink">產品資料管理</h2>
            <p className="text-sm text-slate">管理由ERP同步或獨立建檔的產品主檔與製程規格。</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button className={`nav-btn ${activeTab === 'masters' ? 'active' : ''}`} onClick={() => setActiveTab('masters')}>產品主檔</button>
        <button className={`nav-btn ${activeTab === 'specs' ? 'active' : ''}`} onClick={() => setActiveTab('specs')}>製程規格</button>
      </div>

      <div className="panel p-4 xl:p-4">
        <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-100">
          <div className="flex gap-2 items-center">
            <h3 className="text-xl font-bold text-ink mr-4">{activeTab === 'masters' ? '產品主檔列表' : '製程規格列表'}</h3>
            <input 
              type="text" 
              placeholder="🔍 請輸入代碼或名稱..." 
              className="input w-64"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadData(searchQuery)}
            />
            <button className="btn-secondary" onClick={() => loadData(searchQuery)}>查詢</button>
            {!searchQuery && <span className="text-xs text-slate-400 ml-2">只顯示最近 5 筆</span>}
          </div>
          <button className="btn-primary" onClick={openNew}>+ 新增{activeTab === 'masters' ? '主檔' : '規格'}</button>
        </div>
        
        {isLoading ? <p>載入中...</p> : <Table columns={activeTab === 'masters' ? masterColumns : specColumns} data={data} />}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm">
          <div className="bg-white shadow-2xl w-full max-w-2xl h-full flex flex-col">
            
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-xl font-bold text-ink">
                {editingId ? '編輯' : '新增'}{activeTab === 'masters' ? '產品主檔' : '製程規格'}
              </h3>
              <button 
                className="text-slate-400 hover:text-ink text-3xl leading-none" 
                onClick={() => setIsModalOpen(false)}
              >
                &times;
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <form id="product-form" onSubmit={handleSave} className="space-y-4">
              {activeTab === 'masters' ? (
                /* Master Form */
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">產品代碼</label>
                    <input className="input" value={form.product_code || ''} onChange={e => setForm({...form, product_code: e.target.value})} required autoFocus />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">產品名稱</label>
                    <input className="input" value={form.product_name || ''} onChange={e => setForm({...form, product_name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">ERP 料號</label>
                    <input className="input" value={form.erp_item_code || ''} onChange={e => setForm({...form, erp_item_code: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">ERP 產品 ID</label>
                    <input className="input" value={form.erp_item_id || ''} onChange={e => setForm({...form, erp_item_id: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">主檔版次</label>
                    <input className="input" value={form.revision || ''} onChange={e => setForm({...form, revision: e.target.value})} placeholder="例如 A0 / R01" />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">資料來源</label>
                    <select className="input" value={form.source_system || 'local'} onChange={e => setForm({...form, source_system: e.target.value})}>
                      <option value="local">本地建立</option>
                      <option value="erp">ERP 同步</option>
                      <option value="hybrid">混合維護</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">同步狀態</label>
                    <select className="input" value={form.sync_status || 'local_only'} onChange={e => setForm({...form, sync_status: e.target.value})}>
                      <option value="local_only">僅本地</option>
                      <option value="pending_sync">待同步</option>
                      <option value="synced">已同步</option>
                    </select>
                  </div>
                  <div className="form-group md:col-span-2">
                    <label className="text-sm font-semibold text-ink">備註</label>
                    <textarea className="input min-h-[60px]" value={form.notes || ''} onChange={e => setForm({...form, notes: e.target.value})}></textarea>
                  </div>
                </div>
              ) : (
                /* Specs Form */
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="operation-guide md:col-span-2">
                    <p className="operation-guide-title">操作說明：高度計算規則</p>
                    <ul className="operation-guide-list">
                      <li>產品高度只代表產品本身高度，不含托盤、墊塊或其他治具。</li>
                      <li>真空式脫脂與真空式燒結會以作業標準治具高度加總作為排盤高度來源。</li>
                      <li>批次頁若填寫墊塊總高度，該值不含產品高度，並會覆寫墊塊 / 隔離類治具高度。</li>
                    </ul>
                    <p className="operation-guide-example">例：產品 10 mm、托盤 3 mm、墊塊 5 mm，未覆寫時需求高度為 18 mm。</p>
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">對應產品主檔</label>
                    <select className="input" value={form.product_master_id || ''} onChange={e => setForm({...form, product_master_id: e.target.value})} required>
                      <option value="">請選擇產品主檔</option>
                      {masters.map(m => <option key={m.id} value={m.id}>{m.product_code} ({m.product_name})</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">規格代碼</label>
                    <input className="input" value={form.spec_code || ''} onChange={e => setForm({...form, spec_code: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">規格名稱</label>
                    <input className="input" value={form.spec_name || ''} onChange={e => setForm({...form, spec_name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">製程版次</label>
                    <input className="input" value={form.process_revision || ''} onChange={e => setForm({...form, process_revision: e.target.value})} />
                  </div>
                  
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink label-with-help">
                      產品高度 (mm)
                      <HelpIcon label="產品高度說明" text="只代表產品本身高度，不含托盤、墊塊或其他治具；真空作業品項的單件高度會預設帶入此值。" />
                    </label>
                    <input type="number" step="0.1" min="0" className="input" value={form.product_height ?? ''} onChange={e => setForm({...form, product_height: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink label-with-help">
                      單盤容量 (pcs)
                      <HelpIcon label="單盤容量說明" text="用來換算盤數與排盤位置，不會直接加入單層需求高度。" />
                    </label>
                    <input type="number" min="1" className="input" value={form.tray_capacity ?? ''} onChange={e => setForm({...form, tray_capacity: e.target.value})} required />
                  </div>

                  {/* Fixure selectors simplified for now, as fixtures UI is phase 3. Just text fields or optional selects. */}
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink">托盤 ID (選填)</label>
                    <input type="number" className="input" value={form.tray_fixture_id || ''} onChange={e => setForm({...form, tray_fixture_id: e.target.value || null})} />
                  </div>
                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink label-with-help">
                      墊塊 ID (選填)
                      <HelpIcon label="墊塊 ID 說明" text="選填的預設墊塊來源；實際批次仍可用墊塊總高度覆寫墊塊 / 隔離類治具高度。" />
                    </label>
                    <input type="number" className="input" value={form.support_fixture_id || ''} onChange={e => setForm({...form, support_fixture_id: e.target.value || null})} />
                  </div>

                  <div className="form-group">
                    <label className="text-sm font-semibold text-ink label-with-help">
                      墊塊堆疊數量
                      <HelpIcon label="墊塊堆疊數量說明" text="預設墊塊高度會以治具高度乘上堆疊數量；批次填墊塊總高度時則改用批次填入值。" />
                    </label>
                    <input type="number" min="1" className="input" value={form.support_stack_quantity ?? 1} onChange={e => setForm({...form, support_stack_quantity: e.target.value})} />
                  </div>
                  
                  <div className="form-group">
                    <label className="flex items-center gap-2 mt-8 cursor-pointer">
                      <input type="checkbox" className="h-4 w-4" checked={form.can_mix_load || false} onChange={e => setForm({...form, can_mix_load: e.target.checked})} />
                      <span className="font-semibold text-ink">允許混裝</span>
                    </label>
                  </div>
                  
                  <div className="form-group md:col-span-2">
                    <label className="text-sm font-semibold text-ink">備註</label>
                    <textarea className="input min-h-[60px]" value={form.notes || ''} onChange={e => setForm({...form, notes: e.target.value})}></textarea>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-slate-100">
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>取消</button>
                <button type="submit" className="btn-primary">儲存資料</button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
