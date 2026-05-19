const { DatabaseService } = require('./database.js');
const path = require('node:path');
const os = require('node:os');

const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'tan-chin-mim-pmc-system');
const dbPath = path.join(appDataDir, 'pmc-system.db');

console.log('Using DB Path:', dbPath);

const db = new DatabaseService({ dbPath, logger: console }).init();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateDateString(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(randomInt(8, 20), randomInt(0, 59));
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Ensure enough machines
const machines = db.listMachines();
if (machines.length === 0) {
  console.log("No machines found, skipping...");
  process.exit(1);
}
const immersionMachines = machines.filter(m => m.machine_type === 'degreasing_immersion');
const vacuumMachines = machines.filter(m => m.machine_type === 'degreasing_reserved');
const sinteringMachines = machines.filter(m => m.machine_type === 'sintering_furnace');

// Clear existing tables for a fresh seed
db.db.exec(`
  DELETE FROM vacuum_batch_items;
  DELETE FROM sintering_batch_items;
  DELETE FROM vacuum_batches;
  DELETE FROM sintering_batches;
  DELETE FROM degreasing_batch_items;
  DELETE FROM degreasing_batches;
  DELETE FROM products;
  DELETE FROM product_masters;
`);

// 1. Create 20 Product Masters
console.log('Creating 20 Product Masters...');
const productNames = ["齒輪配件", "不鏽鋼螺絲", "精密卡榫", "醫療導管接頭", "汽車引擎閥門", "電子裝飾外殼", "鎖芯組件", "傳動軸", "光學鏡頭座", "錶殼", "高壓接頭", "航空扣件", "手工具扳手座", "微型齒輪箱", "散熱片組", "相機旋鈕", "無人機旋翼座", "智慧鎖扣", "精密彈簧片", "卡钳組件"];
for (let i = 0; i < 20; i++) {
  const code = `PM-2026-${(i + 1).toString().padStart(3, '0')}`;
  db.createProductMaster({
    product_code: code,
    product_name: productNames[i],
    category: randomItem(["汽車零件", "醫療器材", "消費電子", "工業五金"]),
    material: randomItem(["SUS304", "SUS316L", "17-4PH", "Titanium", "Fe-Ni"]),
    unit_weight: Number((Math.random() * 50 + 5).toFixed(2)),
    notes: `測試建立主檔資料 ${i+1}`
  });
}
const productMastersList = db.listProductMasters({});

// 2. Create 20 Process Specs
console.log('Creating 20 Process Specs...');
for (const pm of productMastersList) {
  const trayCapacity = randomInt(50, 500);
  db.createProduct({
    product_master_id: pm.id,
    spec_code: `${pm.product_code}-SPEC-01`,
    spec_name: `${pm.product_name} 標準製程`,
    process_revision: "A0",
    product_height: Number((Math.random() * 30 + 5).toFixed(1)),
    tray_capacity: trayCapacity,
    sintering_tray_type: randomItem(["ceramic_spacer_ring", "ceramic_tray", "ceramic_strip", "ceramic_round_bar", "graphite_tray", "foot_support", "other"]),
    sintering_tray_weight: Number((Math.random() * 5 + 1).toFixed(2)),
    sintering_jig_weight: Number((Math.random() * 2 + 0.5).toFixed(2)),
    sintering_pieces_per_tray: trayCapacity,
    sintering_layers_per_batch: randomInt(3, 10),
    estimated_yield_rate: Number((randomInt(850, 995) / 10).toFixed(1)),
    vacuum_degreasing_tray_type: randomItem(["tray", "ceramic_tray", "support_block"]),
    vacuum_degreasing_tray_weight: Number((Math.random() * 5 + 1).toFixed(2)),
    vacuum_degreasing_pieces_per_tray: randomInt(50, 500),
    vacuum_degreasing_layers_per_batch: randomInt(3, 10),
    vacuum_degreasing_jig_weight: Number((Math.random() * 2 + 0.5).toFixed(2)),
    status: randomItem(['active', 'active', 'active', 'inactive'])
  });
}
const productsList = db.listProducts({});

// 3. Create 20 Immersion Degreasing Batches
console.log('Creating 20 Immersion Degreasing Batches...');
for (let i = 0; i < 20; i++) {
  if (immersionMachines.length === 0) break;
  const machine = randomItem(immersionMachines);
  
  // Random items
  const itemCount = randomInt(1, 3);
  const items = [];
  for (let j = 0; j < itemCount; j++) {
    const prod = randomItem(productsList);
    items.push({
      part_no: prod.product_code,
      product_name: prod.product_name,
      work_order_no: `WO-${randomInt(10000, 99999)}`,
      input_weight: Number((Math.random() * 30 + 10).toFixed(2)),
      item_notes: randomItem(["急件處理", "正常流程", "重工件", "注意表面", ""]),
      quantity_pcs: randomInt(100, 2000)
    });
  }

  const startDate = generateDateString(randomInt(0, 30));
  const endDate = new Date(new Date(startDate).getTime() + 8 * 60 * 60 * 1000);
  
  db.createDegreasingBatch({
    machine_id: machine.id,
    batch_no: `IDB-${randomInt(1000, 9999)}`,
    operator_name: randomItem(["林班長", "陳師傅", "李專員", "王作業員"]),
    operated_at: startDate,
    ended_at: endDate.toISOString().slice(0, 16),
    notes: randomItem(["", "溶劑顏色正常", "稍微有味道"]),
    items: items
  });
}

// 4. Create 20 Vacuum Degreasing Batches
console.log('Creating 20 Vacuum Degreasing Batches...');
for (let i = 0; i < 20; i++) {
  if (vacuumMachines.length === 0) break;
  const p = randomItem(productsList);
  const machine = randomItem(vacuumMachines);
  const totalLayers = p.vacuum_degreasing_layers_per_batch || 5;

  db.createVacuumBatch({
    planned_date: generateDateString(randomInt(0, 15)).slice(0, 10),
    batch_no: `VD-${randomInt(1000, 9999)}`,
    vacuum_machine_id: machine.id,
    operator_name: randomItem(["林班長", "陳師傅", "李專員"]),
    operated_at: generateDateString(randomInt(0, 15)),
    notes: "測試真空脫脂記錄",
    status: randomItem(["completed", "completed", "in_progress", "planned"]),
    items: [{
      product_id: p.id,
      input_weight: Number((Math.random() * 20 + 5).toFixed(2)),
      work_order_no: `WO-VD-${randomInt(10000, 99999)}`,
      quantity: randomInt(100, 3000),
      quantity_pcs: randomInt(100, 3000)
    }]
  });
}

// 5. Create 20 Sintering Batches
console.log('Creating 20 Sintering Batches...');
for (let i = 0; i < 20; i++) {
  if (sinteringMachines.length === 0) break;
  const p = randomItem(productsList);
  const machine = randomItem(sinteringMachines);
  const totalLayers = p.sintering_layers_per_batch || 5;

  db.createSinteringBatch({
    planned_date: generateDateString(randomInt(0, 15)).slice(0, 10),
    batch_no: `SB-${randomInt(1000, 9999)}`,
    furnace_machine_id: machine.id,
    operator_name: randomItem(["林班長", "陳師傅", "李專員"]),
    operated_at: generateDateString(randomInt(0, 15)),
    notes: "測試真空燒結記錄",
    status: randomItem(["completed", "completed", "in_progress", "planned", "completed", "completed"]),
    items: [{
      product_id: p.id,
      input_weight: Number((Math.random() * 20 + 5).toFixed(2)),
      work_order_no: `WO-SB-${randomInt(10000, 99999)}`,
      quantity: randomInt(100, 3000),
      quantity_pcs: randomInt(100, 3000)
    }]
  });
}

console.log('Successfully seeded database!');
