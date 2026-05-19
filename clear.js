const { DatabaseService } = require('./database.js');
const path = require('node:path');
const os = require('node:os');

const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'tan-chin-mim-pmc-system');
const dbPath = path.join(appDataDir, 'pmc-system.db');

console.log('Using DB Path for clearing:', dbPath);

const db = new DatabaseService({ dbPath, logger: console }).init();

// 清除作業相關報表、產品主檔等假資料，但保留「設備清單(machines)」與「系統設定(settings)」
try {
  db.db.exec(`
    DELETE FROM vacuum_batch_items;
    DELETE FROM sintering_batch_items;
    DELETE FROM vacuum_batches;
    DELETE FROM sintering_batches;
    DELETE FROM degreasing_batch_items;
    DELETE FROM degreasing_batches;
    DELETE FROM solvent_change_logs;
    DELETE FROM products;
    DELETE FROM product_masters;
  `);

  console.log('All mock data cleared successfully!');
} catch (error) {
  console.error("Failed to clear data:", error);
}
