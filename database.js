const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const MACHINE_TYPES = {
  DEGREASING_IMMERSION: "degreasing_immersion",
  DEGREASING_VACUUM: "degreasing_reserved",
  SINTERING_FURNACE: "sintering_furnace"
};
const FIXTURE_TYPES = {
  SUPPORT_BLOCK: "support_block",
  TRAY: "tray",
  CERAMIC_TRAY: "ceramic_tray",
  FOOT: "foot"
};
const FIXTURE_QUICK_TYPES = {
  CERAMIC_SPACER_RING: "ceramic_spacer_ring",
  CERAMIC_TRAY: "ceramic_tray",
  CERAMIC_STRIP: "ceramic_strip",
  CERAMIC_ROUND_BAR: "ceramic_round_bar",
  GRAPHITE_TRAY: "graphite_tray",
  FOOT_SUPPORT: "foot_support",
  OTHER: "other"
};
const FIXTURE_QUICK_TYPE_TO_FIXTURE_TYPE = {
  [FIXTURE_QUICK_TYPES.CERAMIC_SPACER_RING]: FIXTURE_TYPES.SUPPORT_BLOCK,
  [FIXTURE_QUICK_TYPES.CERAMIC_TRAY]: FIXTURE_TYPES.CERAMIC_TRAY,
  [FIXTURE_QUICK_TYPES.CERAMIC_STRIP]: FIXTURE_TYPES.SUPPORT_BLOCK,
  [FIXTURE_QUICK_TYPES.CERAMIC_ROUND_BAR]: FIXTURE_TYPES.SUPPORT_BLOCK,
  [FIXTURE_QUICK_TYPES.GRAPHITE_TRAY]: FIXTURE_TYPES.TRAY,
  [FIXTURE_QUICK_TYPES.FOOT_SUPPORT]: FIXTURE_TYPES.FOOT,
  [FIXTURE_QUICK_TYPES.OTHER]: FIXTURE_TYPES.SUPPORT_BLOCK
};

const MACHINE_STATUSES = ["active", "inactive", "maintenance"];
const ALERT_STATES = ["normal", "warning", "needs_change"];
const SINTERING_BATCH_STATUSES = ["draft", "planned", "ready", "completed"];
const DATA_SOURCE_SYSTEMS = ["local", "erp", "hybrid"];
const SYNC_STATUSES = ["local_only", "pending_sync", "synced", "stale", "sync_error", "unlinked"];
const PRODUCT_RECORD_STATUSES = ["active", "inactive", "archived"];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toOptionalInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readPayloadValue(payload, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return payload[key];
    }
  }
  return undefined;
}

function isBlankValue(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function requireTextValue(payload, keys, label) {
  const value = readPayloadValue(payload, keys);
  if (isBlankValue(value)) {
    throw new Error(`${label} 必須選擇或輸入。`);
  }
  return String(value).trim();
}

function requireNumberValue(payload, keys, label, options = {}) {
  const { min = Number.NEGATIVE_INFINITY, integer = false } = options;
  const value = readPayloadValue(payload, keys);
  if (isBlankValue(value)) {
    throw new Error(`${label} 必須明確輸入。`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (integer && !Number.isInteger(parsed))) {
    const minimumText = Number.isFinite(min) ? `大於或等於 ${min} 的` : "";
    const typeText = integer ? "整數" : "數字";
    throw new Error(`${label} 必須是${minimumText}${typeText}。`);
  }

  return parsed;
}

function normalizeRangeEnd(value) {
  if (typeof value === "string" && value.length === 10) {
    return `${value}T23:59:59.999`;
  }

  return value;
}

function normalizeEnum(value, allowedValues, fallback) {
  return allowedValues.includes(value) ? value : fallback;
}

function inferFixtureQuickTypeFromFixtureType(fixtureType) {
  if (fixtureType === FIXTURE_TYPES.CERAMIC_TRAY) {
    return FIXTURE_QUICK_TYPES.CERAMIC_TRAY;
  }

  if (fixtureType === FIXTURE_TYPES.TRAY) {
    return FIXTURE_QUICK_TYPES.GRAPHITE_TRAY;
  }

  if (fixtureType === FIXTURE_TYPES.FOOT) {
    return FIXTURE_QUICK_TYPES.FOOT_SUPPORT;
  }

  return FIXTURE_QUICK_TYPES.OTHER;
}

function normalizeFixtureQuickType(value, fallback = FIXTURE_QUICK_TYPES.OTHER) {
  return normalizeEnum(value, Object.values(FIXTURE_QUICK_TYPES), fallback);
}

function normalizeFixtureType(value, fallback = FIXTURE_TYPES.SUPPORT_BLOCK) {
  return normalizeEnum(value, Object.values(FIXTURE_TYPES), fallback);
}

function normalizeProductRecordStatus(value, fallback = "active") {
  return normalizeEnum(value, PRODUCT_RECORD_STATUSES, fallback);
}

class DatabaseService {
  constructor(options = {}) {
    this.dbPath = options.dbPath || path.join(process.cwd(), "data", "pmc-system.db");
    this.logger = options.logger || console;
    this.db = null;
  }

  init() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.runMigrations();
    this.seedDefaults();
    this.logSystemEvent("info", "database", "init", "Database initialized.", {
      dbPath: this.dbPath
    });
    return this;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  now() {
    return new Date().toISOString();
  }

  stringify(value) {
    if (value === undefined || value === null) {
      return null;
    }

    try {
      return JSON.stringify(value);
    } catch (error) {
      this.logger.warn("Failed to stringify payload for database log.", error);
      return JSON.stringify({ fallback: "unserializable" });
    }
  }

  parseJson(text, fallback = null) {
    if (!text) {
      return fallback;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      this.logger.warn("Failed to parse stored JSON.", error);
      return fallback;
    }
  }

  getMeta(name) {
    return this.db.prepare("SELECT value FROM app_meta WHERE name = ?").get(name)?.value ?? null;
  }

  setMeta(name, value) {
    this.db
      .prepare(
        `
          INSERT INTO app_meta (name, value)
          VALUES (@name, @value)
          ON CONFLICT(name) DO UPDATE SET value = excluded.value
        `
      )
      .run({ name, value: String(value) });
  }

  columnExists(tableName, columnName) {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    return rows.some((row) => row.name === columnName);
  }

  ensureColumn(tableName, columnName, definition) {
    if (!this.columnExists(tableName, columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const currentVersion = Number(this.getMeta("schema_version") || 0);
    const migrations = [
      {
        version: 1,
        up: () => {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS machines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              machine_code TEXT NOT NULL UNIQUE,
              machine_name TEXT NOT NULL,
              machine_type TEXT NOT NULL CHECK (machine_type IN ('degreasing_immersion', 'degreasing_reserved', 'sintering_furnace')),
              status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
              alert_state TEXT NOT NULL DEFAULT 'normal' CHECK (alert_state IN ('normal', 'warning', 'needs_change')),
              solvent_weight_limit REAL NOT NULL DEFAULT 0,
              current_solvent_accum_weight REAL NOT NULL DEFAULT 0,
              current_cycle_started_at TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS degreasing_batches (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              machine_id INTEGER NOT NULL,
              batch_no TEXT,
              work_order_no TEXT,
              part_no TEXT NOT NULL,
              input_weight REAL NOT NULL,
              operator_name TEXT NOT NULL,
              operated_at TEXT NOT NULL,
              notes TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(machine_id) REFERENCES machines(id)
            );

            CREATE TABLE IF NOT EXISTS solvent_change_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              machine_id INTEGER NOT NULL,
              changed_at TEXT NOT NULL,
              previous_accum_weight REAL NOT NULL,
              operator_name TEXT NOT NULL,
              notes TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(machine_id) REFERENCES machines(id)
            );

            CREATE TABLE IF NOT EXISTS products (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              part_no TEXT NOT NULL UNIQUE,
              part_name TEXT NOT NULL,
              product_height REAL NOT NULL DEFAULT 0,
              tray_capacity INTEGER NOT NULL DEFAULT 1,
              tray_height REAL NOT NULL DEFAULT 0,
              support_block_height REAL NOT NULL DEFAULT 0,
              can_mix_load INTEGER NOT NULL DEFAULT 0,
              preferred_furnace_type TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS furnace_profiles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              machine_id INTEGER NOT NULL UNIQUE,
              total_layers INTEGER NOT NULL DEFAULT 1,
              total_inner_height REAL NOT NULL DEFAULT 0,
              effective_width REAL NOT NULL DEFAULT 0,
              effective_depth REAL NOT NULL DEFAULT 0,
              base_layer_gap REAL NOT NULL DEFAULT 0,
              gap_adjust_rule_json TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(machine_id) REFERENCES machines(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sintering_batches (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              furnace_machine_id INTEGER,
              batch_no TEXT NOT NULL,
              planned_date TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('draft', 'planned', 'ready', 'completed')),
              estimated_load_rate REAL,
              actual_load_rate REAL,
              operator_name TEXT NOT NULL,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(furnace_machine_id) REFERENCES machines(id)
            );

            CREATE TABLE IF NOT EXISTS sintering_batch_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              sintering_batch_id INTEGER NOT NULL,
              product_id INTEGER NOT NULL,
              quantity INTEGER NOT NULL,
              unit_height REAL NOT NULL,
              tray_count INTEGER NOT NULL,
              support_block_height REAL NOT NULL DEFAULT 0,
              notes TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(sintering_batch_id) REFERENCES sintering_batches(id) ON DELETE CASCADE,
              FOREIGN KEY(product_id) REFERENCES products(id)
            );

            CREATE TABLE IF NOT EXISTS sintering_layout_plans (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              sintering_batch_id INTEGER NOT NULL,
              furnace_machine_id INTEGER NOT NULL,
              plan_name TEXT NOT NULL,
              layout_json TEXT NOT NULL,
              estimated_load_rate REAL,
              is_selected INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(sintering_batch_id) REFERENCES sintering_batches(id) ON DELETE CASCADE,
              FOREIGN KEY(furnace_machine_id) REFERENCES machines(id)
            );

            CREATE TABLE IF NOT EXISTS system_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              level TEXT NOT NULL,
              module_name TEXT NOT NULL,
              event_type TEXT NOT NULL,
              message TEXT NOT NULL,
              payload_json TEXT,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_machines_type ON machines(machine_type);
            CREATE INDEX IF NOT EXISTS idx_degreasing_machine_time ON degreasing_batches(machine_id, operated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_degreasing_batch_no ON degreasing_batches(batch_no);
            CREATE INDEX IF NOT EXISTS idx_solvent_change_machine_time ON solvent_change_logs(machine_id, changed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_products_part_no ON products(part_no);
            CREATE INDEX IF NOT EXISTS idx_sintering_batch_date ON sintering_batches(planned_date DESC);
            CREATE INDEX IF NOT EXISTS idx_sintering_batch_item_batch_id ON sintering_batch_items(sintering_batch_id);
            CREATE INDEX IF NOT EXISTS idx_layout_plan_batch_id ON sintering_layout_plans(sintering_batch_id);
            CREATE INDEX IF NOT EXISTS idx_system_logs_module_time ON system_logs(module_name, created_at DESC);
          `);
        }
      },
      {
        version: 2,
        up: () => {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS support_blocks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              block_code TEXT NOT NULL UNIQUE,
              block_name TEXT NOT NULL,
              shape_type TEXT,
              height REAL NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_support_blocks_code ON support_blocks(block_code);
            CREATE INDEX IF NOT EXISTS idx_support_blocks_status ON support_blocks(status);
          `);
        }
      },
      {
        version: 3,
        up: () => {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS support_block_product_links (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              support_block_id INTEGER NOT NULL,
              product_id INTEGER NOT NULL,
              compatibility_status TEXT NOT NULL CHECK (compatibility_status IN ('recommended', 'allowed', 'restricted')),
              priority INTEGER NOT NULL DEFAULT 0,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE (support_block_id, product_id),
              FOREIGN KEY(support_block_id) REFERENCES support_blocks(id) ON DELETE CASCADE,
              FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS vacuum_batches (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              vacuum_machine_id INTEGER,
              batch_no TEXT NOT NULL,
              planned_date TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('draft', 'planned', 'ready', 'completed')),
              estimated_load_rate REAL,
              actual_load_rate REAL,
              operator_name TEXT NOT NULL,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(vacuum_machine_id) REFERENCES machines(id)
            );

            CREATE TABLE IF NOT EXISTS vacuum_batch_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              vacuum_batch_id INTEGER NOT NULL,
              product_id INTEGER NOT NULL,
              quantity INTEGER NOT NULL,
              unit_height REAL NOT NULL,
              tray_count INTEGER NOT NULL,
              support_block_id INTEGER,
              support_block_height REAL NOT NULL DEFAULT 0,
              notes TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(vacuum_batch_id) REFERENCES vacuum_batches(id) ON DELETE CASCADE,
              FOREIGN KEY(product_id) REFERENCES products(id),
              FOREIGN KEY(support_block_id) REFERENCES support_blocks(id)
            );

            CREATE TABLE IF NOT EXISTS vacuum_layout_plans (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              vacuum_batch_id INTEGER NOT NULL,
              vacuum_machine_id INTEGER NOT NULL,
              plan_name TEXT NOT NULL,
              layout_json TEXT NOT NULL,
              estimated_load_rate REAL,
              is_selected INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(vacuum_batch_id) REFERENCES vacuum_batches(id) ON DELETE CASCADE,
              FOREIGN KEY(vacuum_machine_id) REFERENCES machines(id)
            );

            CREATE INDEX IF NOT EXISTS idx_support_block_links_product ON support_block_product_links(product_id);
            CREATE INDEX IF NOT EXISTS idx_support_block_links_block ON support_block_product_links(support_block_id);
            CREATE INDEX IF NOT EXISTS idx_vacuum_batches_planned_date ON vacuum_batches(planned_date DESC);
            CREATE INDEX IF NOT EXISTS idx_vacuum_batch_items_batch_id ON vacuum_batch_items(vacuum_batch_id);
            CREATE INDEX IF NOT EXISTS idx_vacuum_layout_plans_batch_id ON vacuum_layout_plans(vacuum_batch_id);
          `);

          this.ensureColumn("sintering_batch_items", "support_block_id", "INTEGER REFERENCES support_blocks(id)");
        }
      },
      {
        version: 4,
        up: () => {
          this.ensureColumn(
            "support_blocks",
            "fixture_type",
            `TEXT NOT NULL DEFAULT '${FIXTURE_TYPES.SUPPORT_BLOCK}' CHECK (fixture_type IN ('support_block', 'tray', 'ceramic_tray', 'foot'))`
          );
          this.ensureColumn("support_blocks", "max_stack_count", "INTEGER NOT NULL DEFAULT 1");
          this.ensureColumn("products", "tray_fixture_id", "INTEGER");
          this.ensureColumn("products", "support_fixture_id", "INTEGER");
          this.ensureColumn("products", "ceramic_tray_fixture_id", "INTEGER");
          this.ensureColumn("products", "foot_fixture_id", "INTEGER");
          this.ensureColumn("products", "support_stack_quantity", "INTEGER NOT NULL DEFAULT 1");
          this.ensureColumn("furnace_profiles", "positions_per_layer", "INTEGER NOT NULL DEFAULT 2");

          this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_support_blocks_type ON support_blocks(fixture_type);
          `);
        }
      },
      {
        version: 5,
        up: () => {
          this.ensureColumn("machines", "standard_temperature", "REAL NOT NULL DEFAULT 0");
        }
      },
      {
        version: 6,
        up: () => {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS product_masters (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              product_code TEXT NOT NULL UNIQUE,
              product_name TEXT NOT NULL,
              erp_item_id TEXT,
              erp_item_code TEXT,
              revision TEXT,
              source_system TEXT NOT NULL DEFAULT 'local',
              sync_status TEXT NOT NULL DEFAULT 'local_only',
              last_synced_at TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_product_masters_code ON product_masters(product_code);
            CREATE INDEX IF NOT EXISTS idx_product_masters_sync_status ON product_masters(sync_status);
          `);

          this.ensureColumn("products", "product_master_id", "INTEGER");
          this.ensureColumn("products", "spec_code", "TEXT NOT NULL DEFAULT 'DEFAULT'");
          this.ensureColumn("products", "spec_name", "TEXT NOT NULL DEFAULT '預設製程規格'");
          this.ensureColumn("products", "process_revision", "TEXT");
          this.ensureColumn("products", "erp_spec_id", "TEXT");
          this.ensureColumn("products", "erp_route_id", "TEXT");
          this.ensureColumn("products", "source_system", "TEXT NOT NULL DEFAULT 'local'");
          this.ensureColumn("products", "sync_status", "TEXT NOT NULL DEFAULT 'local_only'");
          this.ensureColumn("products", "last_synced_at", "TEXT");

          this.ensureColumn("degreasing_batches", "erp_work_order_id", "TEXT");
          this.ensureColumn("degreasing_batches", "erp_work_order_no", "TEXT");
          this.ensureColumn("degreasing_batches", "erp_dispatch_id", "TEXT");
          this.ensureColumn("degreasing_batches", "erp_completion_id", "TEXT");
          this.ensureColumn("degreasing_batches", "source_system", "TEXT NOT NULL DEFAULT 'local'");
          this.ensureColumn("degreasing_batches", "sync_status", "TEXT NOT NULL DEFAULT 'unlinked'");
          this.ensureColumn("degreasing_batches", "last_synced_at", "TEXT");

          this.ensureColumn("vacuum_batches", "erp_work_order_id", "TEXT");
          this.ensureColumn("vacuum_batches", "erp_work_order_no", "TEXT");
          this.ensureColumn("vacuum_batches", "erp_dispatch_id", "TEXT");
          this.ensureColumn("vacuum_batches", "erp_completion_id", "TEXT");
          this.ensureColumn("vacuum_batches", "source_system", "TEXT NOT NULL DEFAULT 'local'");
          this.ensureColumn("vacuum_batches", "sync_status", "TEXT NOT NULL DEFAULT 'unlinked'");
          this.ensureColumn("vacuum_batches", "last_synced_at", "TEXT");

          this.ensureColumn("sintering_batches", "erp_work_order_id", "TEXT");
          this.ensureColumn("sintering_batches", "erp_work_order_no", "TEXT");
          this.ensureColumn("sintering_batches", "erp_dispatch_id", "TEXT");
          this.ensureColumn("sintering_batches", "erp_completion_id", "TEXT");
          this.ensureColumn("sintering_batches", "source_system", "TEXT NOT NULL DEFAULT 'local'");
          this.ensureColumn("sintering_batches", "sync_status", "TEXT NOT NULL DEFAULT 'unlinked'");
          this.ensureColumn("sintering_batches", "last_synced_at", "TEXT");

          this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_products_master_id ON products(product_master_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_products_master_spec_code
              ON products(product_master_id, spec_code);
          `);

          const now = this.now();
          const productRows = this.db.prepare("SELECT * FROM products ORDER BY id").all();
          const findMasterByCode = this.db.prepare("SELECT id FROM product_masters WHERE product_code = ?");
          const insertMaster = this.db.prepare(`
            INSERT INTO product_masters (
              product_code,
              product_name,
              erp_item_id,
              erp_item_code,
              revision,
              source_system,
              sync_status,
              last_synced_at,
              notes,
              created_at,
              updated_at
            ) VALUES (
              @product_code,
              @product_name,
              @erp_item_id,
              @erp_item_code,
              @revision,
              @source_system,
              @sync_status,
              @last_synced_at,
              @notes,
              @created_at,
              @updated_at
            )
          `);
          const updateProduct = this.db.prepare(`
            UPDATE products
            SET product_master_id = @product_master_id,
                spec_code = @spec_code,
                spec_name = @spec_name,
                process_revision = @process_revision,
                source_system = @source_system,
                sync_status = @sync_status,
                last_synced_at = COALESCE(last_synced_at, @last_synced_at)
            WHERE id = @id
          `);

          for (const row of productRows) {
            const productCode = String(row.part_no || `PRODUCT-${row.id}`).trim();
            const productName = String(row.part_name || productCode).trim();
            let masterId = toOptionalInteger(row.product_master_id);

            if (!masterId) {
              const existingMaster = findMasterByCode.get(productCode);
              if (existingMaster) {
                masterId = existingMaster.id;
              } else {
                masterId = insertMaster.run({
                  product_code: productCode,
                  product_name: productName,
                  erp_item_id: null,
                  erp_item_code: null,
                  revision: null,
                  source_system: "local",
                  sync_status: "local_only",
                  last_synced_at: null,
                  notes: row.notes || null,
                  created_at: row.created_at || now,
                  updated_at: row.updated_at || now
                }).lastInsertRowid;
              }
            }

            updateProduct.run({
              id: row.id,
              product_master_id: masterId,
              spec_code: String(row.spec_code || "DEFAULT").trim() || "DEFAULT",
              spec_name: String(row.spec_name || "預設製程規格").trim() || "預設製程規格",
              process_revision: String(row.process_revision || "A0").trim() || "A0",
              source_system: normalizeEnum(row.source_system, DATA_SOURCE_SYSTEMS, "local"),
              sync_status: normalizeEnum(row.sync_status, SYNC_STATUSES, "local_only"),
              last_synced_at: row.last_synced_at || null
            });
          }
        }
      },
      {
        version: 7,
        up: () => {
          this.ensureColumn(
            "support_blocks",
            "fixture_quick_type",
            `TEXT NOT NULL DEFAULT '${FIXTURE_QUICK_TYPES.OTHER}' CHECK (fixture_quick_type IN ('ceramic_spacer_ring', 'ceramic_tray', 'ceramic_strip', 'ceramic_round_bar', 'graphite_tray', 'foot_support', 'other'))`
          );

          this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_support_blocks_quick_type ON support_blocks(fixture_quick_type);
          `);

          this.db.prepare(
            `
              UPDATE support_blocks
              SET fixture_quick_type = CASE fixture_type
                WHEN '${FIXTURE_TYPES.CERAMIC_TRAY}' THEN '${FIXTURE_QUICK_TYPES.CERAMIC_TRAY}'
                WHEN '${FIXTURE_TYPES.TRAY}' THEN '${FIXTURE_QUICK_TYPES.GRAPHITE_TRAY}'
                WHEN '${FIXTURE_TYPES.FOOT}' THEN '${FIXTURE_QUICK_TYPES.FOOT_SUPPORT}'
                ELSE '${FIXTURE_QUICK_TYPES.OTHER}'
              END
              WHERE fixture_quick_type IS NULL
                 OR TRIM(fixture_quick_type) = ''
                 OR fixture_quick_type = '${FIXTURE_QUICK_TYPES.OTHER}'
            `
          ).run();
        }
      },
      {
        version: 8,
        up: () => {
          this.ensureColumn(
            "product_masters",
            "status",
            `TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived'))`
          );
          this.ensureColumn("product_masters", "archived_at", "TEXT");
          this.ensureColumn(
            "products",
            "status",
            `TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived'))`
          );
          this.ensureColumn("products", "archived_at", "TEXT");

          this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_product_masters_status ON product_masters(status);
            CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
          `);
        }
      },
      {
        version: 9,
        up: () => {
          this.ensureColumn("degreasing_batches", "ended_at", "TEXT");

          this.db.exec(`
            CREATE TABLE IF NOT EXISTS degreasing_batch_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              degreasing_batch_id INTEGER NOT NULL,
              part_no TEXT NOT NULL,
              work_order_no TEXT,
              input_weight REAL NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              FOREIGN KEY(degreasing_batch_id) REFERENCES degreasing_batches(id) ON DELETE CASCADE
            );
          `);

          this.db.exec(`
            INSERT INTO degreasing_batch_items (degreasing_batch_id, part_no, work_order_no, input_weight, created_at)
            SELECT id, COALESCE(part_no, 'UNKNOWN'), work_order_no, COALESCE(input_weight, 0), created_at
            FROM degreasing_batches
            WHERE NOT EXISTS (SELECT 1 FROM degreasing_batch_items dbi WHERE dbi.degreasing_batch_id = degreasing_batches.id);
          `);
        }
      },
      {
        version: 10,
        up: () => {
          this.ensureColumn("degreasing_batch_items", "product_name", "TEXT");
        }
      },
      {
        version: 11,
        up: () => {
          this.ensureColumn("degreasing_batch_items", "item_notes", "TEXT");
          this.ensureColumn("degreasing_batch_items", "quantity_pcs", "INTEGER");
        }
      },
      {
        version: 12,
        up: () => {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS process_spec_fixtures (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              product_id INTEGER NOT NULL,
              fixture_id INTEGER NOT NULL,
              quantity INTEGER NOT NULL DEFAULT 1,
              sequence_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
              FOREIGN KEY(fixture_id) REFERENCES support_blocks(id)
            );
            CREATE INDEX IF NOT EXISTS idx_process_spec_fixtures_product ON process_spec_fixtures(product_id);
          `);

          this.db.exec(`
            INSERT INTO process_spec_fixtures (product_id, fixture_id, quantity, sequence_order, created_at)
            SELECT id, tray_fixture_id, 1, 1, created_at FROM products WHERE tray_fixture_id IS NOT NULL;

            INSERT INTO process_spec_fixtures (product_id, fixture_id, quantity, sequence_order, created_at)
            SELECT id, ceramic_tray_fixture_id, 1, 2, created_at FROM products WHERE ceramic_tray_fixture_id IS NOT NULL;

            INSERT INTO process_spec_fixtures (product_id, fixture_id, quantity, sequence_order, created_at)
            SELECT id, support_fixture_id, support_stack_quantity, 3, created_at FROM products WHERE support_fixture_id IS NOT NULL;

            INSERT INTO process_spec_fixtures (product_id, fixture_id, quantity, sequence_order, created_at)
            SELECT id, foot_fixture_id, 1, 4, created_at FROM products WHERE foot_fixture_id IS NOT NULL;
          `);
        }
      }
    ];

    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        this.db.transaction(() => {
          migration.up();
          this.setMeta("schema_version", migration.version);
        })();
      }
    }
  }

  seedDefaults() {
    const now = this.now();

    this.db.transaction(() => {
      const immersionCount = this.db
        .prepare("SELECT COUNT(*) AS count FROM machines WHERE machine_type = ?")
        .get(MACHINE_TYPES.DEGREASING_IMMERSION).count;

      if (immersionCount === 0) {
        const stmt = this.db.prepare(`
          INSERT INTO machines (
            machine_code,
            machine_name,
            machine_type,
            status,
            alert_state,
            solvent_weight_limit,
            standard_temperature,
            current_solvent_accum_weight,
            current_cycle_started_at,
            notes,
            created_at,
            updated_at
          ) VALUES (
            @machine_code,
            @machine_name,
            @machine_type,
            @status,
            @alert_state,
            @solvent_weight_limit,
            @standard_temperature,
            @current_solvent_accum_weight,
            @current_cycle_started_at,
            @notes,
            @created_at,
            @updated_at
          )
        `);

        for (let index = 1; index <= 10; index += 1) {
          stmt.run({
            machine_code: `DG-${String(index).padStart(2, "0")}`,
            machine_name: `Immersion Degreasing ${String(index).padStart(2, "0")}`,
            machine_type: MACHINE_TYPES.DEGREASING_IMMERSION,
            status: "active",
            alert_state: "normal",
            solvent_weight_limit: 1000,
            standard_temperature: 0,
            current_solvent_accum_weight: 0,
            current_cycle_started_at: now,
            notes: "Seeded default immersion degreasing machine.",
            created_at: now,
            updated_at: now
          });
        }
      }

      const furnaceCount = this.db
        .prepare("SELECT COUNT(*) AS count FROM machines WHERE machine_type = ?")
        .get(MACHINE_TYPES.SINTERING_FURNACE).count;

      if (furnaceCount === 0) {
        const machineStmt = this.db.prepare(`
          INSERT INTO machines (
            machine_code,
            machine_name,
            machine_type,
            status,
            alert_state,
            solvent_weight_limit,
            standard_temperature,
            current_solvent_accum_weight,
            current_cycle_started_at,
            notes,
            created_at,
            updated_at
          ) VALUES (
            @machine_code,
            @machine_name,
            @machine_type,
            @status,
            @alert_state,
            @solvent_weight_limit,
            @standard_temperature,
            @current_solvent_accum_weight,
            @current_cycle_started_at,
            @notes,
            @created_at,
            @updated_at
          )
        `);
        const profileStmt = this.db.prepare(`
          INSERT INTO furnace_profiles (
            machine_id,
            total_layers,
            total_inner_height,
            effective_width,
            effective_depth,
            base_layer_gap,
            gap_adjust_rule_json,
            notes,
            created_at,
            updated_at
          ) VALUES (
            @machine_id,
            @total_layers,
            @total_inner_height,
            @effective_width,
            @effective_depth,
            @base_layer_gap,
            @gap_adjust_rule_json,
            @notes,
            @created_at,
            @updated_at
          )
        `);

        for (let index = 1; index <= 6; index += 1) {
          const machineResult = machineStmt.run({
            machine_code: `FR-${String(index).padStart(2, "0")}`,
            machine_name: `Sintering Furnace ${String(index).padStart(2, "0")}`,
            machine_type: MACHINE_TYPES.SINTERING_FURNACE,
            status: "active",
            alert_state: "normal",
            solvent_weight_limit: 0,
            standard_temperature: 0,
            current_solvent_accum_weight: 0,
            current_cycle_started_at: null,
            notes: "Seeded default sintering furnace.",
            created_at: now,
            updated_at: now
          });

          profileStmt.run({
            machine_id: machineResult.lastInsertRowid,
            total_layers: 8,
            total_inner_height: 960,
            effective_width: 600,
            effective_depth: 500,
            base_layer_gap: 120,
            gap_adjust_rule_json: this.stringify({
              adjustable: true,
              maxExtraGap: 20,
              rule: "Initial version assumes each layer can stretch by up to 20 mm."
            }),
            notes: "Seeded standard furnace profile.",
            created_at: now,
            updated_at: now
          });
        }
      }
    })();
  }

  logSystemEvent(level, moduleName, eventType, message, payload = null) {
    const createdAt = this.now();
    if (this.db) {
      this.db
        .prepare(
          `
            INSERT INTO system_logs (level, module_name, event_type, message, payload_json, created_at)
            VALUES (@level, @module_name, @event_type, @message, @payload_json, @created_at)
          `
        )
        .run({
          level,
          module_name: moduleName,
          event_type: eventType,
          message,
          payload_json: this.stringify(payload),
          created_at: createdAt
        });
    }

    const loggerMethod = this.logger[level] || this.logger.info || console.log;
    loggerMethod.call(this.logger, `[${moduleName}] ${eventType}: ${message}`, payload ?? "");
  }

  sanitizeMachinePayload(payload = {}) {
    const machineType = payload.machine_type || payload.machineType || MACHINE_TYPES.DEGREASING_IMMERSION;
    const status = payload.status || "active";
    const alertState = payload.alert_state || payload.alertState || "normal";

    if (!Object.values(MACHINE_TYPES).includes(machineType)) {
      throw new Error("Invalid machine type.");
    }

    if (!MACHINE_STATUSES.includes(status)) {
      throw new Error("Invalid machine status.");
    }

    if (!ALERT_STATES.includes(alertState)) {
      throw new Error("Invalid alert state.");
    }

    return {
      machine_code: String(payload.machine_code || payload.machineCode || "").trim(),
      machine_name: String(payload.machine_name || payload.machineName || "").trim(),
      machine_type: machineType,
      status,
      alert_state: alertState,
      solvent_weight_limit: toNumber(payload.solvent_weight_limit ?? payload.solventWeightLimit, 0),
      standard_temperature: toNumber(payload.standard_temperature ?? payload.standardTemperature, 0),
      current_solvent_accum_weight: toNumber(
        payload.current_solvent_accum_weight ?? payload.currentSolventAccumWeight,
        0
      ),
      current_cycle_started_at:
        payload.current_cycle_started_at || payload.currentCycleStartedAt || this.now(),
      notes: String(payload.notes || "").trim() || null
    };
  }

  sanitizeFurnaceProfilePayload(payload = {}) {
    return {
      total_layers: Math.max(1, Math.round(toNumber(payload.total_layers ?? payload.totalLayers, 1))),
      total_inner_height: toNumber(payload.total_inner_height ?? payload.totalInnerHeight, 0),
      effective_width: toNumber(payload.effective_width ?? payload.effectiveWidth, 0),
      effective_depth: toNumber(payload.effective_depth ?? payload.effectiveDepth, 0),
      base_layer_gap: toNumber(payload.base_layer_gap ?? payload.baseLayerGap, 0),
      positions_per_layer: Math.max(1, Math.round(toNumber(payload.positions_per_layer ?? payload.positionsPerLayer, 2))),
      gap_adjust_rule_json: this.stringify(
        payload.gap_adjust_rule_json || payload.gapAdjustRuleJson || payload.gapAdjustRule || {
          adjustable: false,
          maxExtraGap: 0
        }
      ),
      notes: String(payload.notes || "").trim() || null
    };
  }

  formatMachineRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      machine_code: row.machine_code,
      machine_name: row.machine_name,
      machine_type: row.machine_type,
      status: row.status,
      alert_state: row.alert_state,
      solvent_weight_limit: toNumber(row.solvent_weight_limit, 0),
      standard_temperature: toNumber(row.standard_temperature, 0),
      current_solvent_accum_weight: toNumber(row.current_solvent_accum_weight, 0),
      current_cycle_started_at: row.current_cycle_started_at,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  formatProductRow(row) {
    if (!row) {
      return null;
    }

    const master = row.master_id
      ? {
          id: row.master_id,
          product_code: row.master_product_code,
          product_name: row.master_product_name,
          erp_item_id: row.master_erp_item_id,
          erp_item_code: row.master_erp_item_code,
          revision: row.master_revision,
          source_system: row.master_source_system,
          sync_status: row.master_sync_status,
          status: row.master_status,
          archived_at: row.master_archived_at,
          last_synced_at: row.master_last_synced_at,
          notes: row.master_notes,
          created_at: row.master_created_at,
          updated_at: row.master_updated_at
        }
      : toOptionalInteger(row.product_master_id)
        ? this.getProductMasterById(row.product_master_id)
        : null;
    const trayFixture = toOptionalInteger(row.tray_fixture_id) ? this.getSupportBlockById(row.tray_fixture_id) : null;
    const supportFixture = toOptionalInteger(row.support_fixture_id)
      ? this.getSupportBlockById(row.support_fixture_id)
      : null;
    const ceramicTrayFixture = toOptionalInteger(row.ceramic_tray_fixture_id)
      ? this.getSupportBlockById(row.ceramic_tray_fixture_id)
      : null;
    const footFixture = toOptionalInteger(row.foot_fixture_id) ? this.getSupportBlockById(row.foot_fixture_id) : null;
    const supportStackQuantity = Math.max(1, Math.round(toNumber(row.support_stack_quantity, 1)));
    const trayHeight = trayFixture?.height ?? toNumber(row.tray_height, 0);
    const supportUnitHeight = supportFixture?.height ?? toNumber(row.support_block_height, 0);
    const supportTotalHeight = supportUnitHeight * supportStackQuantity;
    const ceramicTrayHeight = ceramicTrayFixture?.height ?? 0;
    const footHeight = footFixture?.height ?? 0;
    const productCode = master?.product_code || row.part_no;
    const productName = master?.product_name || row.part_name;
    const specCode = String(row.spec_code || "DEFAULT").trim() || "DEFAULT";
    const specName = String(row.spec_name || "預設製程規格").trim() || "預設製程規格";
    const displayLabel = `${productCode} | ${productName}${specName ? ` / ${specName}` : ""}`;

    const specFixturesRaw = this.db.prepare(`
      SELECT f.id, f.product_id, f.fixture_id, f.quantity, f.sequence_order,
             sb.block_code, sb.block_name, sb.height, sb.fixture_type, sb.fixture_quick_type
      FROM process_spec_fixtures f
      JOIN support_blocks sb ON sb.id = f.fixture_id
      WHERE f.product_id = ?
      ORDER BY f.sequence_order ASC
    `).all(row.id);

    const specFixtures = specFixturesRaw.map(f => ({
      id: f.id,
      fixture_id: f.fixture_id,
      quantity: f.quantity,
      sequence_order: f.sequence_order,
      block_code: f.block_code,
      block_name: f.block_name,
      height: f.height,
      fixture_type: f.fixture_type,
      fixture_quick_type: f.fixture_quick_type
    }));


    return {
      id: row.id,
      product_master_id: master?.id || toOptionalInteger(row.product_master_id),
      product_code: productCode,
      product_name: productName,
      part_no: productCode,
      part_name: productName,
      stored_part_no: row.part_no,
      stored_part_name: row.part_name,
      spec_code: specCode,
      spec_name: specName,
      process_revision: String(row.process_revision || "").trim() || null,
      erp_spec_id: row.erp_spec_id || null,
      erp_route_id: row.erp_route_id || null,
      source_system: normalizeEnum(row.source_system, DATA_SOURCE_SYSTEMS, "local"),
      sync_status: normalizeEnum(row.sync_status, SYNC_STATUSES, "local_only"),
      status: normalizeEnum(row.status, PRODUCT_RECORD_STATUSES, "active"),
      archived_at: row.archived_at || null,
      last_synced_at: row.last_synced_at || null,
      erp_item_id: master?.erp_item_id || null,
      erp_item_code: master?.erp_item_code || null,
      revision: master?.revision || null,
      master_source_system: normalizeEnum(master?.source_system, DATA_SOURCE_SYSTEMS, "local"),
      master_sync_status: normalizeEnum(master?.sync_status, SYNC_STATUSES, "local_only"),
      master_status: normalizeEnum(master?.status, PRODUCT_RECORD_STATUSES, "active"),
      master_archived_at: master?.archived_at || null,
      master_last_synced_at: master?.last_synced_at || null,
      display_label: displayLabel,
      product_height: toNumber(row.product_height, 0),
      tray_capacity: Math.max(1, Math.round(toNumber(row.tray_capacity, 1))),
      tray_height: trayHeight,
      support_block_height: supportTotalHeight,
      support_block_unit_height: supportUnitHeight,
      support_stack_quantity: supportStackQuantity,
      ceramic_tray_height: ceramicTrayHeight,
      foot_height: footHeight,
      tray_fixture_id: trayFixture?.id || null,
      tray_fixture_code: trayFixture?.block_code || null,
      tray_fixture_name: trayFixture?.block_name || null,
      support_fixture_id: supportFixture?.id || null,
      support_fixture_code: supportFixture?.block_code || null,
      support_fixture_name: supportFixture?.block_name || null,
      ceramic_tray_fixture_id: ceramicTrayFixture?.id || null,
      ceramic_tray_fixture_code: ceramicTrayFixture?.block_code || null,
      ceramic_tray_fixture_name: ceramicTrayFixture?.block_name || null,
      foot_fixture_id: footFixture?.id || null,
      foot_fixture_code: footFixture?.block_code || null,
      foot_fixture_name: footFixture?.block_name || null,
      can_mix_load: Boolean(row.can_mix_load),
      preferred_furnace_type: row.preferred_furnace_type,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      spec_fixtures: specFixtures
    };
  }

  formatProductMasterRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      product_code: row.product_code,
      product_name: row.product_name,
      erp_item_id: row.erp_item_id || null,
      erp_item_code: row.erp_item_code || null,
      revision: row.revision || null,
      source_system: normalizeEnum(row.source_system, DATA_SOURCE_SYSTEMS, "local"),
      sync_status: normalizeEnum(row.sync_status, SYNC_STATUSES, "local_only"),
      status: normalizeEnum(row.status, PRODUCT_RECORD_STATUSES, "active"),
      archived_at: row.archived_at || null,
      last_synced_at: row.last_synced_at || null,
      notes: row.notes || null,
      spec_count: Math.max(0, Math.round(toNumber(row.spec_count, 0))),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  formatSupportBlockRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      block_code: row.block_code,
      block_name: row.block_name,
      fixture_quick_type: normalizeFixtureQuickType(
        row.fixture_quick_type,
        inferFixtureQuickTypeFromFixtureType(row.fixture_type)
      ),
      fixture_type: row.fixture_type || FIXTURE_TYPES.SUPPORT_BLOCK,
      shape_type: row.shape_type,
      height: toNumber(row.height, 0),
      max_stack_count: Math.max(1, Math.round(toNumber(row.max_stack_count, 1))),
      status: row.status,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  formatSupportBlockLinkRow(row) {
    if (!row) {
      return null;
    }

    const productCode = row.master_product_code || row.part_no;
    const productName = row.master_product_name || row.part_name;

    return {
      id: row.id,
      support_block_id: row.support_block_id,
      product_id: row.product_id,
      compatibility_status: row.compatibility_status,
      priority: Math.round(toNumber(row.priority, 0)),
      notes: row.notes,
      block_code: row.block_code,
      block_name: row.block_name,
      fixture_quick_type: normalizeFixtureQuickType(
        row.fixture_quick_type,
        inferFixtureQuickTypeFromFixtureType(row.fixture_type)
      ),
      fixture_type: row.fixture_type || FIXTURE_TYPES.SUPPORT_BLOCK,
      shape_type: row.shape_type,
      block_height: toNumber(row.block_height, 0),
      max_stack_count: Math.max(1, Math.round(toNumber(row.max_stack_count, 1))),
      part_no: productCode,
      part_name: productName,
      product_code: productCode,
      product_name: productName,
      spec_code: row.spec_code || "DEFAULT",
      spec_name: row.spec_name || "預設製程規格",
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  formatFurnaceProfileRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.profile_id ?? row.id,
      machine_id: row.machine_id ?? row.id,
      machine_code: row.machine_code,
      machine_name: row.machine_name,
      machine_status: row.machine_status || row.status,
      total_layers: Math.max(1, Math.round(toNumber(row.total_layers, 1))),
      total_inner_height: toNumber(row.total_inner_height, 0),
      effective_width: toNumber(row.effective_width, 0),
      effective_depth: toNumber(row.effective_depth, 0),
      base_layer_gap: toNumber(row.base_layer_gap, 0),
      positions_per_layer: Math.max(1, Math.round(toNumber(row.positions_per_layer, 2))),
      gap_adjust_rule: this.parseJson(row.gap_adjust_rule_json, {
        adjustable: false,
        maxExtraGap: 0
      }),
      notes: row.profile_notes || row.notes,
      created_at: row.profile_created_at || row.created_at,
      updated_at: row.profile_updated_at || row.updated_at
    };
  }

  listMachines(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.machine_type || filters.machineType) {
      conditions.push("machine_type = ?");
      params.push(filters.machine_type || filters.machineType);
    }

    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM machines
          ${whereClause}
          ORDER BY machine_type, machine_code
        `
      )
      .all(...params);

    return rows.map((row) => this.formatMachineRow(row));
  }

  getMachineById(id) {
    const row = this.db.prepare("SELECT * FROM machines WHERE id = ?").get(id);
    return this.formatMachineRow(row);
  }

  createMachine(payload = {}) {
    const machine = this.sanitizeMachinePayload(payload);
    if (!machine.machine_code || !machine.machine_name) {
      throw new Error("Machine code and name are required.");
    }

    const now = this.now();
    const insert = this.db.prepare(`
      INSERT INTO machines (
        machine_code,
        machine_name,
        machine_type,
        status,
        alert_state,
        solvent_weight_limit,
        standard_temperature,
        current_solvent_accum_weight,
        current_cycle_started_at,
        notes,
        created_at,
        updated_at
      ) VALUES (
        @machine_code,
        @machine_name,
        @machine_type,
        @status,
        @alert_state,
        @solvent_weight_limit,
        @standard_temperature,
        @current_solvent_accum_weight,
        @current_cycle_started_at,
        @notes,
        @created_at,
        @updated_at
      )
    `);

    const machineId = this.db.transaction(() => {
      const result = insert.run({
        ...machine,
        created_at: now,
        updated_at: now
      });

      if (
        machine.machine_type === MACHINE_TYPES.SINTERING_FURNACE ||
        machine.machine_type === MACHINE_TYPES.DEGREASING_VACUUM
      ) {
        this.upsertFurnaceProfile(result.lastInsertRowid, payload.profile || payload.furnace_profile || {});
      }

      this.logSystemEvent("info", "machines", "create", "Machine created.", {
        machineId: result.lastInsertRowid,
        machineType: machine.machine_type
      });

      return result.lastInsertRowid;
    })();

    return this.getMachineById(machineId);
  }

  updateMachine(id, payload = {}) {
    const current = this.getMachineById(id);
    if (!current) {
      throw new Error("Machine not found.");
    }

    const merged = this.sanitizeMachinePayload({
      ...current,
      ...payload
    });
    if (!merged.machine_code || !merged.machine_name) {
      throw new Error("Machine code and name are required.");
    }

    const now = this.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `
            UPDATE machines
            SET machine_code = @machine_code,
                machine_name = @machine_name,
                machine_type = @machine_type,
                status = @status,
                alert_state = @alert_state,
                solvent_weight_limit = @solvent_weight_limit,
                standard_temperature = @standard_temperature,
                current_solvent_accum_weight = @current_solvent_accum_weight,
                current_cycle_started_at = @current_cycle_started_at,
                notes = @notes,
                updated_at = @updated_at
            WHERE id = @id
          `
        )
        .run({
          ...merged,
          id,
          updated_at: now
        });

      if (
        merged.machine_type === MACHINE_TYPES.SINTERING_FURNACE ||
        merged.machine_type === MACHINE_TYPES.DEGREASING_VACUUM
      ) {
        this.upsertFurnaceProfile(id, payload.profile || payload.furnace_profile || {});
      }

      this.logSystemEvent("info", "machines", "update", "Machine updated.", {
        machineId: id
      });
    })();

    return this.getMachineById(id);
  }

  upsertFurnaceProfile(machineId, payload = {}) {
    const machine = this.getMachineById(machineId);
    if (!machine) {
      throw new Error("Machine not found.");
    }

    if (
      machine.machine_type !== MACHINE_TYPES.SINTERING_FURNACE &&
      machine.machine_type !== MACHINE_TYPES.DEGREASING_VACUUM
    ) {
      throw new Error("Structured profiles can only be assigned to vacuum degreasing or sintering machines.");
    }

    const now = this.now();
    const existing = this.db
      .prepare("SELECT * FROM furnace_profiles WHERE machine_id = ?")
      .get(machineId);
    const profile = this.sanitizeFurnaceProfilePayload({
      ...(existing || {}),
      ...payload
    });

    if (existing) {
      this.db
        .prepare(
          `
            UPDATE furnace_profiles
            SET total_layers = @total_layers,
                total_inner_height = @total_inner_height,
                effective_width = @effective_width,
                effective_depth = @effective_depth,
                base_layer_gap = @base_layer_gap,
                positions_per_layer = @positions_per_layer,
                gap_adjust_rule_json = @gap_adjust_rule_json,
                notes = @notes,
                updated_at = @updated_at
            WHERE machine_id = @machine_id
          `
        )
        .run({
          ...profile,
          machine_id: machineId,
          updated_at: now
        });
    } else {
      this.db
        .prepare(
          `
            INSERT INTO furnace_profiles (
              machine_id,
              total_layers,
              total_inner_height,
              effective_width,
              effective_depth,
              base_layer_gap,
              positions_per_layer,
              gap_adjust_rule_json,
              notes,
              created_at,
              updated_at
            ) VALUES (
              @machine_id,
              @total_layers,
              @total_inner_height,
              @effective_width,
              @effective_depth,
              @base_layer_gap,
              @positions_per_layer,
              @gap_adjust_rule_json,
              @notes,
              @created_at,
              @updated_at
            )
          `
        )
        .run({
          ...profile,
          machine_id: machineId,
          created_at: now,
          updated_at: now
        });
    }

    this.logSystemEvent("info", "furnaces", "profile-upsert", "Furnace profile saved.", {
      machineId
    });

    return this.getFurnaceProfileByMachineId(machineId);
  }

  getFurnaceProfileByMachineId(machineId) {
    const row = this.db
      .prepare(
        `
          SELECT
            fp.id AS profile_id,
            fp.machine_id,
            fp.total_layers,
            fp.total_inner_height,
            fp.effective_width,
            fp.effective_depth,
            fp.base_layer_gap,
            fp.positions_per_layer,
            fp.gap_adjust_rule_json,
            fp.notes AS profile_notes,
            fp.created_at AS profile_created_at,
            fp.updated_at AS profile_updated_at,
            m.machine_code,
            m.machine_name,
            m.status AS machine_status
          FROM furnace_profiles fp
          JOIN machines m ON m.id = fp.machine_id
          WHERE fp.machine_id = ?
        `
      )
      .get(machineId);

    return this.formatFurnaceProfileRow(row);
  }

  listFurnaceProfiles(filters = {}) {
    const machineTypes =
      Array.isArray(filters.machineTypes) && filters.machineTypes.length > 0
        ? filters.machineTypes
        : filters.machineType
          ? [filters.machineType]
          : [MACHINE_TYPES.SINTERING_FURNACE];
    const placeholders = machineTypes.map(() => "?").join(", ");
    const conditions = [`m.machine_type IN (${placeholders})`];
    const params = [...machineTypes];

    if (filters.activeOnly) {
      conditions.push("m.status = 'active'");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT
            fp.id AS profile_id,
            fp.machine_id,
            fp.total_layers,
            fp.total_inner_height,
            fp.effective_width,
            fp.effective_depth,
            fp.base_layer_gap,
            fp.positions_per_layer,
            fp.gap_adjust_rule_json,
            fp.notes AS profile_notes,
            fp.created_at AS profile_created_at,
            fp.updated_at AS profile_updated_at,
            m.machine_code,
            m.machine_name,
            m.status AS machine_status
          FROM machines m
          LEFT JOIN furnace_profiles fp ON fp.machine_id = m.id
          ${whereClause}
          ORDER BY m.machine_code
        `
      )
      .all(...params);

    return rows.map((row) => this.formatFurnaceProfileRow(row));
  }

  createDegreasingBatch(payload = {}) {
    const machineId = Number(payload.machine_id || payload.machineId);
    const machine = this.getMachineById(machineId);
    if (!machine || machine.machine_type !== MACHINE_TYPES.DEGREASING_IMMERSION) {
      throw new Error("Valid immersion degreasing machine is required.");
    }

    if (machine.status !== "active") {
      throw new Error("Selected machine is not active.");
    }

    const items = payload.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("At least one item is required.");
    }

    const operatedAt = payload.operated_at || payload.operatedAt || this.now();
    const endedAt = payload.ended_at || payload.endedAt || null;
    const operatorName = String(payload.operator_name || payload.operatorName || "").trim();
    if (!operatorName) {
      throw new Error("Operator name is required.");
    }

    let totalWeight = 0;
    const validatedItems = items.map((item) => {
      const partNo = String(item.part_no || item.partNo || "").trim();
      if (!partNo) throw new Error("Part number is required for all items.");
      const weight = toNumber(item.input_weight ?? item.inputWeight, NaN);
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error("Input weight must be greater than 0 for all items.");
      }
      totalWeight += weight;
      return {
        part_no: partNo,
        product_name: String(item.product_name || item.productName || "").trim() || null,
        input_weight: weight,
        work_order_no: String(item.work_order_no || item.workOrderNo || "").trim() || null,
        item_notes: String(item.item_notes || item.itemNotes || "").trim() || null,
        quantity_pcs: toNumber(item.quantity_pcs || item.quantityPcs, null)
      };
    });

    const batchNo = String(payload.batch_no || payload.batchNo || "").trim() || null;
    const notes = String(payload.notes || "").trim() || null;
    const createdAt = this.now();

    const result = this.db.transaction(() => {
      const insertResult = this.db
        .prepare(
          `
            INSERT INTO degreasing_batches (
              machine_id,
              batch_no,
              work_order_no,
              part_no,
              input_weight,
              operator_name,
              operated_at,
              ended_at,
              notes,
              created_at
            ) VALUES (
              @machine_id,
              @batch_no,
              NULL,
              '',
              @total_weight,
              @operator_name,
              @operated_at,
              @ended_at,
              @notes,
              @created_at
            )
          `
        )
        .run({
          machine_id: machineId,
          batch_no: batchNo,
          total_weight: totalWeight,
          operator_name: operatorName,
          operated_at: operatedAt,
          ended_at: endedAt,
          notes,
          created_at: createdAt
        });

      const batchId = insertResult.lastInsertRowid;
      const insertItemStmt = this.db.prepare(
        `
          INSERT INTO degreasing_batch_items (
            degreasing_batch_id, part_no, product_name, work_order_no, input_weight, item_notes, quantity_pcs, created_at
          ) VALUES (
            @batch_id, @part_no, @product_name, @work_order_no, @input_weight, @item_notes, @quantity_pcs, @created_at
          )
        `
      );

      for (const item of validatedItems) {
        insertItemStmt.run({
          batch_id: batchId,
          part_no: item.part_no,
          product_name: item.product_name,
          work_order_no: item.work_order_no,
          input_weight: item.input_weight,
          item_notes: item.item_notes,
          quantity_pcs: item.quantity_pcs,
          created_at: createdAt
        });
      }

      const newAccumWeight = toNumber(machine.current_solvent_accum_weight, 0) + totalWeight;
      const warningThreshold = machine.solvent_weight_limit > 0 ? machine.solvent_weight_limit * 0.8 : 0;
      const alertState =
        machine.solvent_weight_limit > 0 && newAccumWeight >= machine.solvent_weight_limit
          ? "needs_change"
          : machine.solvent_weight_limit > 0 && newAccumWeight >= warningThreshold
            ? "warning"
            : "normal";

      this.db
        .prepare(
          `
            UPDATE machines
            SET current_solvent_accum_weight = @current_solvent_accum_weight,
                alert_state = @alert_state,
                updated_at = @updated_at
            WHERE id = @id
          `
        )
        .run({
          id: machineId,
          current_solvent_accum_weight: newAccumWeight,
          alert_state: alertState,
          updated_at: this.now()
        });

      return {
        batchId: batchId,
        machine: this.getMachineById(machineId)
      };
    })();

    return {
      batch_id: result.batchId,
      machine: result.machine
    };
  }

  createDegreasingBatchBulk(payload = {}) {
    const machineIds = Array.isArray(payload.machine_ids || payload.machineIds)
      ? payload.machine_ids || payload.machineIds
      : [];
    if (machineIds.length === 0) {
      throw new Error("At least one machine must be selected.");
    }

    const results = [];
    for (const machineId of machineIds) {
      results.push(
        this.createDegreasingBatch({
          ...payload,
          machine_id: Number(machineId)
        })
      );
    }

    return {
      machine_count: results.length,
      results
    };
  }

  changeSolvent(payload = {}) {
    const machineId = Number(payload.machine_id || payload.machineId);
    const machine = this.getMachineById(machineId);
    if (!machine || machine.machine_type !== MACHINE_TYPES.DEGREASING_IMMERSION) {
      throw new Error("Valid immersion degreasing machine is required.");
    }

    if (machine.status !== "active") {
      throw new Error("選取的浸泡式脫脂設備目前未啟用。");
    }

    const changedAt = payload.changed_at || payload.changedAt || this.now();
    const operatorName = String(payload.operator_name || payload.operatorName || "").trim();
    if (!operatorName) {
      throw new Error("Operator name is required.");
    }

    const notes = String(payload.notes || "").trim() || null;
    const previousWeight = toNumber(machine.current_solvent_accum_weight, 0);

    const result = this.db.transaction(() => {
      const insertResult = this.db
        .prepare(
          `
            INSERT INTO solvent_change_logs (
              machine_id,
              changed_at,
              previous_accum_weight,
              operator_name,
              notes,
              created_at
            ) VALUES (
              @machine_id,
              @changed_at,
              @previous_accum_weight,
              @operator_name,
              @notes,
              @created_at
            )
          `
        )
        .run({
          machine_id: machineId,
          changed_at: changedAt,
          previous_accum_weight: previousWeight,
          operator_name: operatorName,
          notes,
          created_at: this.now()
        });

      this.db
        .prepare(
          `
            UPDATE machines
            SET current_solvent_accum_weight = 0,
                current_cycle_started_at = @current_cycle_started_at,
                alert_state = 'normal',
                updated_at = @updated_at
            WHERE id = @id
          `
        )
        .run({
          id: machineId,
          current_cycle_started_at: changedAt,
          updated_at: this.now()
        });

      this.logSystemEvent("info", "degreasing", "solvent-change", "Solvent change completed.", {
        changeLogId: insertResult.lastInsertRowid,
        machineId,
        previousWeight
      });

      return {
        changeLogId: insertResult.lastInsertRowid,
        machine: this.getMachineById(machineId)
      };
    })();

    return {
      change_log_id: result.changeLogId,
      machine: result.machine
    };
  }

  changeSolventBulk(payload = {}) {
    const machineIds = Array.isArray(payload.machine_ids || payload.machineIds)
      ? payload.machine_ids || payload.machineIds
      : [];
    if (machineIds.length === 0) {
      throw new Error("At least one machine must be selected.");
    }

    const results = [];
    for (const machineId of machineIds) {
      results.push(
        this.changeSolvent({
          ...payload,
          machine_id: Number(machineId)
        })
      );
    }

    return {
      machine_count: results.length,
      results
    };
  }

  listDegreasingBatches(filters = {}) {
    const conditions = [];
    const params = [];

    if (Array.isArray(filters.machine_ids || filters.machineIds) && (filters.machine_ids || filters.machineIds).length) {
      const machineIds = filters.machine_ids || filters.machineIds;
      conditions.push(`db.machine_id IN (${machineIds.map(() => "?").join(", ")})`);
      params.push(...machineIds);
    }

    if (filters.machine_id || filters.machineId) {
      conditions.push("db.machine_id = ?");
      params.push(filters.machine_id || filters.machineId);
    }

    if (filters.part_no || filters.partNo) {
      conditions.push("dbi.part_no LIKE ?");
      params.push(`%${filters.part_no || filters.partNo}%`);
    }

    if (filters.batch_no || filters.batchNo) {
      conditions.push("(db.batch_no LIKE ? OR dbi.work_order_no LIKE ?)");
      params.push(`%${filters.batch_no || filters.batchNo}%`, `%${filters.batch_no || filters.batchNo}%`);
    }

    if (filters.date_from || filters.dateFrom) {
      conditions.push("db.operated_at >= ?");
      params.push(filters.date_from || filters.dateFrom);
    }

    if (filters.date_to || filters.dateTo) {
      conditions.push("db.operated_at <= ?");
      params.push(normalizeRangeEnd(filters.date_to || filters.dateTo));
    }

    const limit = Math.min(Math.max(Math.round(toNumber(filters.limit, 100)), 1), 500);
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db
      .prepare(
        `
          SELECT
            db.id, db.machine_id, db.batch_no, db.operator_name, db.operated_at, db.ended_at, db.notes, db.created_at,
            m.machine_code,
            m.machine_name,
            dbi.id AS item_id,
            dbi.part_no,
            dbi.product_name,
            dbi.work_order_no,
            dbi.input_weight,
            dbi.item_notes,
            dbi.quantity_pcs
          FROM degreasing_batches db
          LEFT JOIN degreasing_batch_items dbi ON dbi.degreasing_batch_id = db.id
          JOIN machines m ON m.id = db.machine_id
          ${whereClause}
          ORDER BY db.operated_at DESC, dbi.id ASC
          LIMIT ${limit}
        `
      )
      .all(...params);
  }

  listSolventChangeLogs(filters = {}) {
    const conditions = [];
    const params = [];

    if (Array.isArray(filters.machine_ids || filters.machineIds) && (filters.machine_ids || filters.machineIds).length) {
      const machineIds = filters.machine_ids || filters.machineIds;
      conditions.push(`scl.machine_id IN (${machineIds.map(() => "?").join(", ")})`);
      params.push(...machineIds);
    }

    if (filters.machine_id || filters.machineId) {
      conditions.push("scl.machine_id = ?");
      params.push(filters.machine_id || filters.machineId);
    }

    if (filters.date_from || filters.dateFrom) {
      conditions.push("scl.changed_at >= ?");
      params.push(filters.date_from || filters.dateFrom);
    }

    if (filters.date_to || filters.dateTo) {
      conditions.push("scl.changed_at <= ?");
      params.push(normalizeRangeEnd(filters.date_to || filters.dateTo));
    }

    const limit = Math.min(Math.max(Math.round(toNumber(filters.limit, 100)), 1), 500);
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db
      .prepare(
        `
          SELECT
            scl.*,
            m.machine_code,
            m.machine_name
          FROM solvent_change_logs scl
          JOIN machines m ON m.id = scl.machine_id
          ${whereClause}
          ORDER BY scl.changed_at DESC
          LIMIT ${limit}
        `
      )
      .all(...params);
  }

  getProductMasterById(id) {
    const row = this.db
      .prepare(
        `
          SELECT
            pm.*,
            COUNT(p.id) AS spec_count
          FROM product_masters pm
          LEFT JOIN products p ON p.product_master_id = pm.id
          WHERE pm.id = ?
          GROUP BY pm.id
        `
      )
      .get(id);
    return this.formatProductMasterRow(row);
  }

  getProductMasterByCode(productCode) {
    const code = String(productCode || "").trim();
    if (!code) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            pm.*,
            COUNT(p.id) AS spec_count
          FROM product_masters pm
          LEFT JOIN products p ON p.product_master_id = pm.id
          WHERE pm.product_code = ?
          GROUP BY pm.id
        `
      )
      .get(code);
    return this.formatProductMasterRow(row);
  }

  listProductMasters(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.keyword) {
      conditions.push("(pm.product_code LIKE ? OR pm.product_name LIKE ? OR pm.erp_item_code LIKE ?)");
      params.push(`%${filters.keyword}%`, `%${filters.keyword}%`, `%${filters.keyword}%`);
    }

    if (filters.source_system || filters.sourceSystem) {
      conditions.push("pm.source_system = ?");
      params.push(filters.source_system || filters.sourceSystem);
    }

    if (filters.sync_status || filters.syncStatus) {
      conditions.push("pm.sync_status = ?");
      params.push(filters.sync_status || filters.syncStatus);
    }

    if (filters.status) {
      conditions.push("pm.status = ?");
      params.push(filters.status);
    }

    const limit = Math.min(Math.max(Math.round(toNumber(filters.limit, 1000)), 1), 2000);
    const orderClause = filters.order === 'desc' ? 'pm.created_at DESC' : 'pm.product_code ASC';
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT
            pm.*,
            COUNT(p.id) AS spec_count
          FROM product_masters pm
          LEFT JOIN products p ON p.product_master_id = pm.id
          ${whereClause}
          GROUP BY pm.id
          ORDER BY ${orderClause}
          LIMIT ${limit}
        `
      )
      .all(...params);

    return rows.map((row) => this.formatProductMasterRow(row));
  }

  createProductMaster(payload = {}) {
    const values = this.buildProductMasterValues(payload);
    if (!values.product_code || !values.product_name) {
      throw new Error("Product code and product name are required.");
    }

    const now = this.now();
    const result = this.db
      .prepare(
        `
          INSERT INTO product_masters (
            product_code,
            product_name,
            erp_item_id,
            erp_item_code,
            revision,
            source_system,
            sync_status,
            status,
            archived_at,
            last_synced_at,
            notes,
            created_at,
            updated_at
          ) VALUES (
            @product_code,
            @product_name,
            @erp_item_id,
            @erp_item_code,
            @revision,
            @source_system,
            @sync_status,
            @status,
            @archived_at,
            @last_synced_at,
            @notes,
            @created_at,
            @updated_at
          )
        `
      )
      .run({
        ...values,
        status: normalizeProductRecordStatus(payload.status, "active"),
        archived_at: payload.archived_at || payload.archivedAt || null,
        created_at: now,
        updated_at: now
      });

    this.logSystemEvent("info", "product-masters", "create", "Product master created.", {
      productMasterId: result.lastInsertRowid,
      productCode: values.product_code
    });

    return this.getProductMasterById(result.lastInsertRowid);
  }

  updateProductMaster(id, payload = {}) {
    const current = this.getProductMasterById(id);
    if (!current) {
      throw new Error("Product master not found.");
    }

    const values = this.buildProductMasterValues({
      ...current,
      ...payload
    });
    if (!values.product_code || !values.product_name) {
      throw new Error("Product code and product name are required.");
    }

    this.db
      .prepare(
        `
          UPDATE product_masters
          SET product_code = @product_code,
              product_name = @product_name,
              erp_item_id = @erp_item_id,
              erp_item_code = @erp_item_code,
              revision = @revision,
              source_system = @source_system,
              sync_status = @sync_status,
              status = @status,
              archived_at = @archived_at,
              last_synced_at = @last_synced_at,
              notes = @notes,
              updated_at = @updated_at
          WHERE id = @id
        `
      )
      .run({
        id,
        ...values,
        status: normalizeProductRecordStatus(payload.status || current.status, current.status || "active"),
        archived_at:
          payload.archived_at !== undefined || payload.archivedAt !== undefined
            ? payload.archived_at || payload.archivedAt || null
            : current.archived_at || null,
        updated_at: this.now()
      });

    this.syncProductSnapshotsForMaster(id);
    this.logSystemEvent("info", "product-masters", "update", "Product master updated.", {
      productMasterId: id
    });

    return this.getProductMasterById(id);
  }

  createProduct(payload = {}) {
    const master = this.ensureProductMasterForSpec(payload);
    const values = this.buildProductValues(payload);
    const specCode = String(payload.spec_code || payload.specCode || "DEFAULT").trim() || "DEFAULT";
    const specName =
      String(payload.spec_name || payload.specName || "預設製程規格").trim() || "預設製程規格";
    const processRevision = String(payload.process_revision || payload.processRevision || "A0").trim() || "A0";
    const sourceSystem = normalizeEnum(
      String(payload.source_system || payload.sourceSystem || "local").trim(),
      DATA_SOURCE_SYSTEMS,
      "local"
    );
    const syncStatus = normalizeEnum(
      String(payload.sync_status || payload.syncStatus || "local_only").trim(),
      SYNC_STATUSES,
      "local_only"
    );
    const duplicate = this.db
      .prepare("SELECT id FROM products WHERE product_master_id = ? AND spec_code = ?")
      .get(master.id, specCode);
    if (duplicate) {
      throw new Error("此產品主檔已經有相同的作業標準代碼（規格代碼不能重複）。");
    }

    const now = this.now();
    const storedPartNo = this.buildStoredProductPartNo(master.product_code, specCode);
    const storedPartName = this.buildStoredProductPartName(master.product_name, specName);
    const result = this.db
      .prepare(
        `
          INSERT INTO products (
            product_master_id,
            part_no,
            part_name,
            spec_code,
            spec_name,
            process_revision,
            erp_spec_id,
            erp_route_id,
            source_system,
            sync_status,
            status,
            archived_at,
            last_synced_at,
            product_height,
            tray_capacity,
            tray_height,
            support_block_height,
            tray_fixture_id,
            support_fixture_id,
            ceramic_tray_fixture_id,
            foot_fixture_id,
            support_stack_quantity,
            can_mix_load,
            preferred_furnace_type,
            notes,
            created_at,
            updated_at
          ) VALUES (
            @product_master_id,
            @part_no,
            @part_name,
            @spec_code,
            @spec_name,
            @process_revision,
            @erp_spec_id,
            @erp_route_id,
            @source_system,
            @sync_status,
            @status,
            @archived_at,
            @last_synced_at,
            @product_height,
            @tray_capacity,
            @tray_height,
            @support_block_height,
            @tray_fixture_id,
            @support_fixture_id,
            @ceramic_tray_fixture_id,
            @foot_fixture_id,
            @support_stack_quantity,
            @can_mix_load,
            @preferred_furnace_type,
            @notes,
            @created_at,
            @updated_at
          )
        `
      )
      .run({
        product_master_id: master.id,
        part_no: storedPartNo,
        part_name: storedPartName,
        spec_code: specCode,
        spec_name: specName,
        process_revision: processRevision,
        erp_spec_id: String(payload.erp_spec_id || payload.erpSpecId || "").trim() || null,
        erp_route_id: String(payload.erp_route_id || payload.erpRouteId || "").trim() || null,
        source_system: sourceSystem,
        sync_status: syncStatus,
        status: normalizeProductRecordStatus(payload.status, "active"),
        archived_at: payload.archived_at || payload.archivedAt || null,
        last_synced_at: payload.last_synced_at || payload.lastSyncedAt || null,
        ...values,
        created_at: now,
        updated_at: now
      });

        if (payload.spec_fixtures && Array.isArray(payload.spec_fixtures)) {
      const insertFixture = this.db.prepare(`
        INSERT INTO process_spec_fixtures (product_id, fixture_id, quantity, sequence_order, created_at)
        VALUES (@product_id, @fixture_id, @quantity, @sequence_order, @created_at)
      `);
      payload.spec_fixtures.forEach((f, idx) => {
        insertFixture.run({
          product_id: result.lastInsertRowid,
          fixture_id: f.fixture_id,
          quantity: f.quantity || 1,
          sequence_order: f.sequence_order ?? (idx + 1),
          created_at: now
        });
      });
    }

    this.logSystemEvent("info", "products", "create", "Process specification created.", {
      productId: result.lastInsertRowid,
      productMasterId: master.id,
      specCode
    });

    return this.getProductById(result.lastInsertRowid);
  }

  getProductById(id) {
    const row = this.db
      .prepare(
        `
          SELECT
            p.*,
            pm.id AS master_id,
            pm.product_code AS master_product_code,
            pm.product_name AS master_product_name,
            pm.erp_item_id AS master_erp_item_id,
            pm.erp_item_code AS master_erp_item_code,
            pm.revision AS master_revision,
            pm.source_system AS master_source_system,
            pm.sync_status AS master_sync_status,
            pm.status AS master_status,
            pm.archived_at AS master_archived_at,
            pm.last_synced_at AS master_last_synced_at,
            pm.notes AS master_notes,
            pm.created_at AS master_created_at,
            pm.updated_at AS master_updated_at
          FROM products p
          LEFT JOIN product_masters pm ON pm.id = p.product_master_id
          WHERE p.id = ?
        `
      )
      .get(id);
    return this.formatProductRow(row);
  }

  updateProduct(id, payload = {}) {
    const current = this.getProductById(id);
    if (!current) {
      throw new Error("Product not found.");
    }

    const merged = {
      ...current,
      ...payload,
      product_master_id: payload.product_master_id || payload.productMasterId || current.product_master_id,
      product_code: payload.product_code || payload.productCode || current.product_code,
      product_name: payload.product_name || payload.productName || current.product_name
    };
    const master = this.ensureProductMasterForSpec(merged);
    const values = this.buildProductValues(merged);
    const specCode = String(merged.spec_code || merged.specCode || "DEFAULT").trim() || "DEFAULT";
    const specName = String(merged.spec_name || merged.specName || "預設製程規格").trim() || "預設製程規格";
    const processRevision = String(merged.process_revision || merged.processRevision || "A0").trim() || "A0";
    const sourceSystem = normalizeEnum(
      String(merged.source_system || merged.sourceSystem || "local").trim(),
      DATA_SOURCE_SYSTEMS,
      "local"
    );
    const syncStatus = normalizeEnum(
      String(merged.sync_status || merged.syncStatus || "local_only").trim(),
      SYNC_STATUSES,
      "local_only"
    );
    const duplicate = this.db
      .prepare("SELECT id FROM products WHERE product_master_id = ? AND spec_code = ? AND id <> ?")
      .get(master.id, specCode, id);
    if (duplicate) {
      throw new Error("此產品主檔已經有相同的作業標準代碼（規格代碼不能重複）。");
    }

    this.db
      .prepare(
        `
          UPDATE products
          SET product_master_id = @product_master_id,
              part_no = @part_no,
              part_name = @part_name,
              spec_code = @spec_code,
              spec_name = @spec_name,
              process_revision = @process_revision,
              erp_spec_id = @erp_spec_id,
              erp_route_id = @erp_route_id,
              source_system = @source_system,
              sync_status = @sync_status,
              status = @status,
              archived_at = @archived_at,
              last_synced_at = @last_synced_at,
              product_height = @product_height,
              tray_capacity = @tray_capacity,
              tray_height = @tray_height,
              support_block_height = @support_block_height,
              tray_fixture_id = @tray_fixture_id,
              support_fixture_id = @support_fixture_id,
              ceramic_tray_fixture_id = @ceramic_tray_fixture_id,
              foot_fixture_id = @foot_fixture_id,
              support_stack_quantity = @support_stack_quantity,
              can_mix_load = @can_mix_load,
              preferred_furnace_type = @preferred_furnace_type,
              notes = @notes,
              updated_at = @updated_at
          WHERE id = @id
        `
      )
      .run({
        id,
        product_master_id: master.id,
        part_no: this.buildStoredProductPartNo(master.product_code, specCode),
        part_name: this.buildStoredProductPartName(master.product_name, specName),
        spec_code: specCode,
        spec_name: specName,
        process_revision: processRevision,
        erp_spec_id: String(merged.erp_spec_id || merged.erpSpecId || "").trim() || null,
        erp_route_id: String(merged.erp_route_id || merged.erpRouteId || "").trim() || null,
        source_system: sourceSystem,
        sync_status: syncStatus,
        status: normalizeProductRecordStatus(merged.status, current.status || "active"),
        archived_at:
          merged.archived_at !== undefined || merged.archivedAt !== undefined
            ? merged.archived_at || merged.archivedAt || null
            : current.archived_at || null,
        last_synced_at: merged.last_synced_at || merged.lastSyncedAt || null,
        ...values,
        updated_at: this.now()
      });

        if (payload.spec_fixtures && Array.isArray(payload.spec_fixtures)) {
      this.db.prepare("DELETE FROM process_spec_fixtures WHERE product_id = ?").run(id);
      const insertFixture = this.db.prepare(`
        INSERT INTO process_spec_fixtures (product_id, fixture_id, quantity, sequence_order, created_at)
        VALUES (@product_id, @fixture_id, @quantity, @sequence_order, @created_at)
      `);
      const nowStr = this.now();
      payload.spec_fixtures.forEach((f, idx) => {
        insertFixture.run({
          product_id: id,
          fixture_id: f.fixture_id,
          quantity: f.quantity || 1,
          sequence_order: f.sequence_order ?? (idx + 1),
          created_at: nowStr
        });
      });
    }

    this.logSystemEvent("info", "products", "update", "Process specification updated.", {
      productId: id
    });

    return this.getProductById(id);
  }

  listProducts(filters = {}) {
    const conditions = [];
    const params = [];
    if (filters.keyword) {
      conditions.push(
        "(pm.product_code LIKE ? OR pm.product_name LIKE ? OR p.spec_code LIKE ? OR p.spec_name LIKE ?)"
      );
      params.push(
        `%${filters.keyword}%`,
        `%${filters.keyword}%`,
        `%${filters.keyword}%`,
        `%${filters.keyword}%`
      );
    }

    if (filters.product_master_id || filters.productMasterId) {
      conditions.push("p.product_master_id = ?");
      params.push(Number(filters.product_master_id || filters.productMasterId));
    }

    if (filters.sync_status || filters.syncStatus) {
      conditions.push("p.sync_status = ?");
      params.push(filters.sync_status || filters.syncStatus);
    }

    if (filters.status) {
      conditions.push("p.status = ?");
      params.push(filters.status);
    }

    const limit = Math.min(Math.max(Math.round(toNumber(filters.limit, 1000)), 1), 2000);
    const orderClause = filters.order === 'desc' ? 'p.created_at DESC' : 'pm.product_code, p.spec_code';
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT
            p.*,
            pm.id AS master_id,
            pm.product_code AS master_product_code,
            pm.product_name AS master_product_name,
            pm.erp_item_id AS master_erp_item_id,
            pm.erp_item_code AS master_erp_item_code,
            pm.revision AS master_revision,
            pm.source_system AS master_source_system,
            pm.sync_status AS master_sync_status,
            pm.status AS master_status,
            pm.archived_at AS master_archived_at,
            pm.last_synced_at AS master_last_synced_at,
            pm.notes AS master_notes,
            pm.created_at AS master_created_at,
            pm.updated_at AS master_updated_at
          FROM products p
          LEFT JOIN product_masters pm ON pm.id = p.product_master_id
          ${whereClause}
          ORDER BY ${orderClause}
          LIMIT ${limit}
        `
      )
      .all(...params);

    return rows.map((row) => this.formatProductRow(row));
  }

  getProductUsageSummary(productId) {
    const product = this.getProductById(productId);
    if (!product) {
      throw new Error("Product not found.");
    }

    const supportRuleCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM support_block_product_links WHERE product_id = ?")
      .get(productId).count;
    const vacuumBatchCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM vacuum_batch_items WHERE product_id = ?")
      .get(productId).count;
    const sinteringBatchCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM sintering_batch_items WHERE product_id = ?")
      .get(productId).count;
    const degreasingBatchCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM degreasing_batches WHERE part_no = ?")
      .get(product.stored_part_no).count;

    const references = [
      { key: "support_rules", label: "治具關聯規則", count: Math.round(toNumber(supportRuleCount, 0)) },
      { key: "vacuum_batches", label: "真空式脫脂批次", count: Math.round(toNumber(vacuumBatchCount, 0)) },
      { key: "sintering_batches", label: "真空式燒結批次", count: Math.round(toNumber(sinteringBatchCount, 0)) },
      { key: "degreasing_batches", label: "浸泡式脫脂紀錄", count: Math.round(toNumber(degreasingBatchCount, 0)) }
    ].filter((entry) => entry.count > 0);

    const totalReferences = references.reduce((sum, entry) => sum + entry.count, 0);
    return {
      product_id: product.id,
      product_master_id: product.product_master_id,
      product_code: product.product_code,
      product_name: product.product_name,
      spec_code: product.spec_code,
      spec_name: product.spec_name,
      status: product.status,
      total_references: totalReferences,
      in_use: totalReferences > 0,
      references
    };
  }

  getProductMasterUsageSummary(productMasterId) {
    const master = this.getProductMasterById(productMasterId);
    if (!master) {
      throw new Error("Product master not found.");
    }

    const specs = this.listProducts({ product_master_id: productMasterId });
    const specUsages = specs.map((spec) => this.getProductUsageSummary(spec.id));
    const totalReferences = specUsages.reduce((sum, entry) => sum + entry.total_references, 0);
    const usedSpecCount = specUsages.filter((entry) => entry.in_use).length;

    return {
      product_master_id: master.id,
      product_code: master.product_code,
      product_name: master.product_name,
      status: master.status,
      spec_count: specs.length,
      active_spec_count: specs.filter((spec) => spec.status === "active").length,
      archived_spec_count: specs.filter((spec) => spec.status === "archived").length,
      used_spec_count: usedSpecCount,
      total_references: totalReferences,
      in_use: totalReferences > 0,
      specs: specUsages
    };
  }

  disposeProduct(productId) {
    const current = this.getProductById(productId);
    if (!current) {
      throw new Error("Product not found.");
    }

    const usage = this.getProductUsageSummary(productId);
    if (usage.in_use) {
      const now = this.now();
      this.db
        .prepare(
          `
            UPDATE products
            SET status = 'archived',
                archived_at = COALESCE(archived_at, @archived_at),
                updated_at = @updated_at
            WHERE id = @id
          `
        )
        .run({
          id: productId,
          archived_at: now,
          updated_at: now
        });

      const product = this.getProductById(productId);
      this.logSystemEvent("info", "products", "archive", "Product specification archived because it is in use.", {
        productId: productId,
        usage
      });

      return {
        entity: "product",
        action: "archived",
        product,
        usage
      };
    }

    this.db.prepare("DELETE FROM products WHERE id = ?").run(productId);
    this.logSystemEvent("info", "products", "delete", "Product specification deleted.", {
      productId: productId,
      productCode: current.product_code,
      specCode: current.spec_code
    });

    return {
      entity: "product",
      action: "deleted",
      product: current,
      usage
    };
  }

  disposeProductMaster(productMasterId) {
    const current = this.getProductMasterById(productMasterId);
    if (!current) {
      throw new Error("Product master not found.");
    }

    const usage = this.getProductMasterUsageSummary(productMasterId);
    if (usage.in_use) {
      const now = this.now();
      this.db.transaction(() => {
        this.db
          .prepare(
            `
              UPDATE product_masters
              SET status = 'archived',
                  archived_at = COALESCE(archived_at, @archived_at),
                  updated_at = @updated_at
              WHERE id = @id
            `
          )
          .run({
            id: productMasterId,
            archived_at: now,
            updated_at: now
          });

        this.db
          .prepare(
            `
              UPDATE products
              SET status = 'archived',
                  archived_at = COALESCE(archived_at, @archived_at),
                  updated_at = @updated_at
              WHERE product_master_id = @product_master_id
            `
          )
          .run({
            product_master_id: productMasterId,
            archived_at: now,
            updated_at: now
          });
      })();

      const productMaster = this.getProductMasterById(productMasterId);
      this.logSystemEvent("info", "product-masters", "archive", "Product master archived because child specifications are in use.", {
        productMasterId: productMasterId,
        usage
      });

      return {
        entity: "product-master",
        action: "archived",
        productMaster,
        usage
      };
    }

    this.db.transaction(() => {
      this.db.prepare("DELETE FROM products WHERE product_master_id = ?").run(productMasterId);
      this.db.prepare("DELETE FROM product_masters WHERE id = ?").run(productMasterId);
    })();

    this.logSystemEvent("info", "product-masters", "delete", "Product master deleted.", {
      productMasterId: productMasterId,
      productCode: current.product_code
    });

    return {
      entity: "product-master",
      action: "deleted",
      productMaster: current,
      usage
    };
  }

  restoreProduct(productId) {
    const current = this.getProductById(productId);
    if (!current) {
      throw new Error("Product not found.");
    }

    const now = this.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `
            UPDATE products
            SET status = 'active',
                archived_at = NULL,
                updated_at = @updated_at
            WHERE id = @id
          `
        )
        .run({
          id: productId,
          updated_at: now
        });

      if (current.product_master_id) {
        this.db
          .prepare(
            `
              UPDATE product_masters
              SET status = 'active',
                  archived_at = NULL,
                  updated_at = @updated_at
              WHERE id = @id
            `
          )
          .run({
            id: current.product_master_id,
            updated_at: now
          });
        this.syncProductSnapshotsForMaster(current.product_master_id);
      }
    })();

    const product = this.getProductById(productId);
    this.logSystemEvent("info", "products", "restore", "Product specification restored.", {
      productId: productId,
      productMasterId: current.product_master_id
    });

    return {
      entity: "product",
      action: "restored",
      product
    };
  }

  restoreProductMaster(productMasterId) {
    const current = this.getProductMasterById(productMasterId);
    if (!current) {
      throw new Error("Product master not found.");
    }

    const now = this.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `
            UPDATE product_masters
            SET status = 'active',
                archived_at = NULL,
                updated_at = @updated_at
            WHERE id = @id
          `
        )
        .run({
          id: productMasterId,
          updated_at: now
        });

      this.db
        .prepare(
          `
            UPDATE products
            SET status = 'active',
                archived_at = NULL,
                updated_at = @updated_at
            WHERE product_master_id = @product_master_id
          `
        )
        .run({
          product_master_id: productMasterId,
          updated_at: now
        });

      this.syncProductSnapshotsForMaster(productMasterId);
    })();

    const productMaster = this.getProductMasterById(productMasterId);
    this.logSystemEvent("info", "product-masters", "restore", "Product master restored with child specifications.", {
      productMasterId: productMasterId
    });

    return {
      entity: "product-master",
      action: "restored",
      productMaster
    };
  }

  getSupportBlockById(id) {
    const row = this.db.prepare("SELECT * FROM support_blocks WHERE id = ?").get(id);
    return this.formatSupportBlockRow(row);
  }

  listSupportBlocks(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }

    if (filters.fixture_type || filters.fixtureType) {
      conditions.push("fixture_type = ?");
      params.push(filters.fixture_type || filters.fixtureType);
    }

    if (filters.fixture_quick_type || filters.fixtureQuickType) {
      conditions.push("fixture_quick_type = ?");
      params.push(filters.fixture_quick_type || filters.fixtureQuickType);
    }

    if (filters.keyword) {
      conditions.push("(block_code LIKE ? OR block_name LIKE ? OR shape_type LIKE ?)");
      params.push(`%${filters.keyword}%`, `%${filters.keyword}%`, `%${filters.keyword}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM support_blocks
          ${whereClause}
          ORDER BY status = 'active' DESC, block_code
        `
      )
      .all(...params);

    return rows.map((row) => this.formatSupportBlockRow(row));
  }

  createSupportBlock(payload = {}) {
    const blockCode = String(payload.block_code || payload.blockCode || "").trim();
    const blockName = String(payload.block_name || payload.blockName || "").trim();
    if (!blockCode || !blockName) {
      throw new Error("Fixture code and name are required.");
    }

    const rawFixtureQuickType = requireTextValue(payload, ["fixture_quick_type", "fixtureQuickType"], "治具材質");
    const rawFixtureType = requireTextValue(payload, ["fixture_type", "fixtureType"], "用途");
    const rawStatus = requireTextValue(payload, ["status"], "狀態");
    if (!["active", "inactive"].includes(rawStatus)) {
      throw new Error("狀態必須選擇啟用或停用。");
    }

    const fixtureQuickType = normalizeFixtureQuickType(
      rawFixtureQuickType,
      inferFixtureQuickTypeFromFixtureType(rawFixtureType)
    );
    const fixtureType = normalizeFixtureType(
      rawFixtureType,
      FIXTURE_QUICK_TYPE_TO_FIXTURE_TYPE[fixtureQuickType] || FIXTURE_TYPES.SUPPORT_BLOCK
    );
    const now = this.now();
    const result = this.db
      .prepare(
        `
          INSERT INTO support_blocks (
            block_code,
            block_name,
            fixture_quick_type,
            fixture_type,
            shape_type,
            height,
            max_stack_count,
            status,
            notes,
            created_at,
            updated_at
          ) VALUES (
            @block_code,
            @block_name,
            @fixture_quick_type,
            @fixture_type,
            @shape_type,
            @height,
            @max_stack_count,
            @status,
            @notes,
            @created_at,
            @updated_at
          )
        `
      )
      .run({
        block_code: blockCode,
        block_name: blockName,
        fixture_quick_type: fixtureQuickType,
        fixture_type: fixtureType,
        shape_type: String(payload.shape_type || payload.shapeType || "").trim() || null,
        height: toNumber(payload.height, 0),
        max_stack_count: Math.max(1, Math.round(toNumber(payload.max_stack_count ?? payload.maxStackCount, 1))),
        status: rawStatus,
        notes: String(payload.notes || "").trim() || null,
        created_at: now,
        updated_at: now
      });

    this.logSystemEvent("info", "support-blocks", "create", "Support block created.", {
      supportBlockId: result.lastInsertRowid,
      blockCode
    });

    return this.getSupportBlockById(result.lastInsertRowid);
  }

  updateSupportBlock(id, payload = {}) {
    const current = this.getSupportBlockById(id);
    if (!current) {
      throw new Error("Support block not found.");
    }

    const merged = { ...current, ...payload };
    const blockCode = String(merged.block_code || merged.blockCode || "").trim();
    const blockName = String(merged.block_name || merged.blockName || "").trim();
    if (!blockCode || !blockName) {
      throw new Error("Fixture code and name are required.");
    }

    const rawFixtureQuickType = requireTextValue(merged, ["fixture_quick_type", "fixtureQuickType"], "治具材質");
    const rawFixtureType = requireTextValue(merged, ["fixture_type", "fixtureType"], "用途");
    const rawStatus = requireTextValue(merged, ["status"], "狀態");
    if (!["active", "inactive"].includes(rawStatus)) {
      throw new Error("狀態必須選擇啟用或停用。");
    }

    const fixtureQuickType = normalizeFixtureQuickType(
      rawFixtureQuickType,
      inferFixtureQuickTypeFromFixtureType(rawFixtureType || current.fixture_type)
    );
    const fixtureType = normalizeFixtureType(
      rawFixtureType,
      FIXTURE_QUICK_TYPE_TO_FIXTURE_TYPE[fixtureQuickType] || current.fixture_type || FIXTURE_TYPES.SUPPORT_BLOCK
    );
    this.db
      .prepare(
        `
          UPDATE support_blocks
          SET block_code = @block_code,
              block_name = @block_name,
              fixture_quick_type = @fixture_quick_type,
              fixture_type = @fixture_type,
              shape_type = @shape_type,
              height = @height,
              max_stack_count = @max_stack_count,
              status = @status,
              notes = @notes,
              updated_at = @updated_at
          WHERE id = @id
        `
      )
      .run({
        id,
        block_code: blockCode,
        block_name: blockName,
        fixture_quick_type: fixtureQuickType,
        fixture_type: fixtureType,
        shape_type: String(merged.shape_type || merged.shapeType || "").trim() || null,
        height: toNumber(merged.height, 0),
        max_stack_count: Math.max(1, Math.round(toNumber(merged.max_stack_count ?? merged.maxStackCount, 1))),
        status: rawStatus,
        notes: String(merged.notes || "").trim() || null,
        updated_at: this.now()
      });

    this.logSystemEvent("info", "support-blocks", "update", "Support block updated.", {
      supportBlockId: id
    });

    return this.getSupportBlockById(id);
  }

  listSupportBlockRelations(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.product_id || filters.productId) {
      conditions.push("link.product_id = ?");
      params.push(filters.product_id || filters.productId);
    }

    if (filters.support_block_id || filters.supportBlockId) {
      conditions.push("link.support_block_id = ?");
      params.push(filters.support_block_id || filters.supportBlockId);
    }

    if (filters.fixture_type || filters.fixtureType) {
      conditions.push("sb.fixture_type = ?");
      params.push(filters.fixture_type || filters.fixtureType);
    }

    if (filters.fixture_quick_type || filters.fixtureQuickType) {
      conditions.push("sb.fixture_quick_type = ?");
      params.push(filters.fixture_quick_type || filters.fixtureQuickType);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT
            link.*,
            sb.block_code,
            sb.block_name,
            sb.fixture_quick_type,
            sb.fixture_type,
            sb.shape_type,
            sb.height AS block_height,
            sb.max_stack_count,
            p.part_no,
            p.part_name,
            p.spec_code,
            p.spec_name,
            pm.product_code AS master_product_code,
            pm.product_name AS master_product_name
          FROM support_block_product_links link
          JOIN support_blocks sb ON sb.id = link.support_block_id
          JOIN products p ON p.id = link.product_id
          LEFT JOIN product_masters pm ON pm.id = p.product_master_id
          ${whereClause}
          ORDER BY link.product_id, link.priority DESC, sb.block_code
        `
      )
      .all(...params);

    return rows.map((row) => this.formatSupportBlockLinkRow(row));
  }

  replaceSupportBlockRulesForProduct(productId, rules = []) {
    const product = this.getProductById(productId);
    if (!product) {
      throw new Error("Product not found.");
    }

    const normalizedRules = Array.isArray(rules)
      ? rules
          .filter((rule) => rule.compatibility_status && rule.compatibility_status !== "unset")
          .map((rule) => {
            const supportBlockId = Number(rule.support_block_id || rule.supportBlockId);
            const supportBlock = this.getSupportBlockById(supportBlockId);
            if (!supportBlock) {
              throw new Error("Support block not found for relation rule.");
            }

            const compatibilityStatus = String(rule.compatibility_status || rule.compatibilityStatus || "").trim();
            if (!["recommended", "allowed", "restricted"].includes(compatibilityStatus)) {
              throw new Error("Invalid compatibility status.");
            }

            return {
              support_block_id: supportBlockId,
              compatibility_status: compatibilityStatus,
              priority: Math.round(toNumber(rule.priority, 0)),
              notes: String(rule.notes || "").trim() || null
            };
          })
      : [];

    const now = this.now();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM support_block_product_links WHERE product_id = ?").run(productId);

      const insert = this.db.prepare(`
        INSERT INTO support_block_product_links (
          support_block_id,
          product_id,
          compatibility_status,
          priority,
          notes,
          created_at,
          updated_at
        ) VALUES (
          @support_block_id,
          @product_id,
          @compatibility_status,
          @priority,
          @notes,
          @created_at,
          @updated_at
        )
      `);

      for (const rule of normalizedRules) {
        insert.run({
          ...rule,
          product_id: productId,
          created_at: now,
          updated_at: now
        });
      }
    })();

    this.logSystemEvent("info", "support-block-rules", "replace", "Support block rules replaced for product.", {
      productId,
      ruleCount: normalizedRules.length
    });

    return this.listSupportBlockRelations({ product_id: productId });
  }

  getSupportBlockOptionsForProduct(productId, filters = {}) {
    const fixtureType = filters.fixture_type || filters.fixtureType || null;
    const activeBlocks = this.listSupportBlocks({
      status: "active",
      fixture_type: fixtureType || undefined
    });
    const relations = this.listSupportBlockRelations({
      product_id: productId,
      fixture_type: fixtureType || undefined
    });
    const relationMap = new Map(relations.map((relation) => [relation.support_block_id, relation]));
    const hasPreferredConfiguration = relations.some((relation) =>
      relation.compatibility_status === "recommended" || relation.compatibility_status === "allowed"
    );

    let options = activeBlocks.map((block) => ({
      ...block,
      relation: relationMap.get(block.id) || null
    }));

    if (hasPreferredConfiguration) {
      options = options.filter((option) =>
        option.relation &&
        (option.relation.compatibility_status === "recommended" ||
          option.relation.compatibility_status === "allowed")
      );
    }

    options.sort((left, right) => {
      const leftPriority = left.relation?.priority ?? -1;
      const rightPriority = right.relation?.priority ?? -1;
      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }

      return left.block_code.localeCompare(right.block_code, "en");
    });

    return {
      has_rules: relations.length > 0,
      has_preferred_configuration: hasPreferredConfiguration,
      options,
      relations
    };
  }

  resolveSinteringItems(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("At least one sintering item is required.");
    }

    return items.map((item) => {
      const productId = Number(item.product_id || item.productId);
      const inputSupportBlockId = Number(item.support_block_id || item.supportBlockId);
      const rawProduct = productId
        ? this.db.prepare("SELECT * FROM products WHERE id = ?").get(productId)
        : this.db
            .prepare(
              `
                SELECT p.*
                FROM products p
                LEFT JOIN product_masters pm ON pm.id = p.product_master_id
                WHERE p.part_no = ? OR pm.product_code = ?
                ORDER BY p.id
                LIMIT 1
              `
            )
            .get(
              String(item.part_no || item.partNo || "").trim(),
              String(item.part_no || item.partNo || "").trim()
            );
      const product = this.formatProductRow(rawProduct);

      if (!product) {
        throw new Error("Sintering item references an unknown product.");
      }

      const supportBlockId = inputSupportBlockId || product.support_fixture_id || null;
      const supportBlock = supportBlockId ? this.getSupportBlockById(supportBlockId) : null;
      const supportBlockOptions = this.getSupportBlockOptionsForProduct(product.id, {
        fixture_type: FIXTURE_TYPES.SUPPORT_BLOCK
      });
      const supportBlockRelation =
        supportBlockId && supportBlockOptions.relations.length
          ? supportBlockOptions.relations.find((relation) => relation.support_block_id === supportBlockId) || null
          : null;

      const quantity = Math.max(1, Math.round(toNumber(item.quantity, 1)));
      const unitHeight = toNumber(item.unit_height ?? item.unitHeight, product.product_height);
      const supportBlockHeight = toNumber(
        item.support_block_height ?? item.supportBlockHeight,
        (supportBlock?.height ?? product.support_block_unit_height) * product.support_stack_quantity
      );
      const trayCount = Math.max(1, Math.ceil(quantity / Math.max(1, product.tray_capacity)));
      let fixtureTotalHeight = 0;
      if (product.spec_fixtures && Array.isArray(product.spec_fixtures)) {
        fixtureTotalHeight = product.spec_fixtures.reduce((acc, f) => {
          // If the user provided a custom support block override for this batch item,
          // we exclude the default support blocks/isolates from the fixture list
          // so we don't double count.
          if (item.support_block_height !== undefined && (f.fixture_type === 'support_block' || f.fixture_type === 'isolate')) {
            return acc;
          }
          return acc + (f.height * (f.quantity || 1));
        }, 0);
      }
      
      const requiredHeight = unitHeight + fixtureTotalHeight + (item.support_block_height !== undefined ? supportBlockHeight : 0);

      return {
        product_id: product.id,
        part_no: product.part_no,
        part_name: product.part_name,
        product_code: product.product_code,
        product_name: product.product_name,
        spec_code: product.spec_code,
        spec_name: product.spec_name,
        quantity,
        unit_height: unitHeight,
        tray_count: trayCount,
        support_block_id: supportBlock?.id || null,
        support_block_code: supportBlock?.block_code || null,
        support_block_name: supportBlock?.block_name || null,
        support_block_relation: supportBlockRelation?.compatibility_status || null,
        support_block_priority: supportBlockRelation?.priority ?? 0,
        support_stack_quantity: product.support_stack_quantity,
        has_support_block_rules: supportBlockOptions.has_rules,
        has_preferred_support_rules: supportBlockOptions.has_preferred_configuration,
        support_block_height: supportBlockHeight,
        tray_capacity: product.tray_capacity,
        tray_height: product.tray_height,
        tray_fixture_code: product.tray_fixture_code,
        tray_fixture_name: product.tray_fixture_name,
        ceramic_tray_height: product.ceramic_tray_height,
        ceramic_tray_fixture_code: product.ceramic_tray_fixture_code,
        ceramic_tray_fixture_name: product.ceramic_tray_fixture_name,
        foot_height: product.foot_height,
        foot_fixture_code: product.foot_fixture_code,
        foot_fixture_name: product.foot_fixture_name,
        required_height: requiredHeight,
        can_mix_load: product.can_mix_load,
        preferred_furnace_type: product.preferred_furnace_type,
        notes: item.notes || null
      };
    });
  }

  buildLayerSuggestions(items, totalLayers, positionsPerLayer, mixCompatible) {
    const prepared = items
      .map((item) => ({
        item,
        remaining: item.tray_count,
        trayIndex: 1
      }))
      .sort((left, right) => right.item.required_height - left.item.required_height);

    const suggestions = [];
    const totalPositions = totalLayers * positionsPerLayer;
    let cursor = 0;

    for (let slotIndex = 0; slotIndex < totalPositions; slotIndex += 1) {
      const activeBuckets = prepared.filter((entry) => entry.remaining > 0);
      if (activeBuckets.length === 0) {
        break;
      }

      let selectedBucket = null;
      if (mixCompatible && activeBuckets.length > 1) {
        for (let offset = 0; offset < prepared.length; offset += 1) {
          const candidate = prepared[(cursor + offset) % prepared.length];
          if (candidate.remaining > 0) {
            selectedBucket = candidate;
            cursor = (cursor + offset + 1) % prepared.length;
            break;
          }
        }
      } else {
        selectedBucket = prepared.find((entry) => entry.remaining > 0) || null;
      }

      if (!selectedBucket) {
        break;
      }

      const layerNo = Math.floor(slotIndex / positionsPerLayer) + 1;
      const positionIndex = (slotIndex % positionsPerLayer) + 1;
      const positionLabel =
        positionIndex === 1
          ? "前"
          : positionIndex === 2
            ? "後"
            : `位 ${positionIndex}`;

      suggestions.push({
        layer_no: layerNo,
        position_index: positionIndex,
        position_label: positionLabel,
        part_no: selectedBucket.item.part_no,
        tray_index: selectedBucket.trayIndex,
        required_height: selectedBucket.item.required_height,
        support_block_code: selectedBucket.item.support_block_code,
        support_block_name: selectedBucket.item.support_block_name
      });

      selectedBucket.remaining -= 1;
      selectedBucket.trayIndex += 1;
    }

    return suggestions;
  }

  evaluateStructuredMachine(profile, items, options = {}) {
    const gapRule = profile.gap_adjust_rule || { maxExtraGap: 0 };
    const maxExtraGap = toNumber(gapRule.maxExtraGap, 0);
    const maxLayerHeight = profile.base_layer_gap + maxExtraGap;
    const positionsPerLayer = Math.max(1, Math.round(toNumber(profile.positions_per_layer, 2)));
    const totalCapacityPositions = profile.total_layers * positionsPerLayer;
    const uniqueProducts = new Set(items.map((item) => item.product_id));
    const mixCompatible = uniqueProducts.size <= 1 || items.every((item) => item.can_mix_load);
    const itemAnalysis = [];
    const conflicts = [];
    const warnings = [];
    const matchReasons = [];
    const layerSuggestions = [];
    let totalRequiredPositions = 0;
    let preferenceBoost = 0;

    for (const item of [...items].sort((left, right) => right.required_height - left.required_height)) {
      const heightFits = item.required_height <= maxLayerHeight;
      if (!heightFits) {
        conflicts.push(
          `${item.part_no} requires ${item.required_height.toFixed(1)} mm, exceeding the layer limit ${maxLayerHeight.toFixed(1)} mm.`
        );
      }

      if (item.support_block_relation === "restricted") {
        conflicts.push(`${item.part_no} is restricted from using support block ${item.support_block_code || item.support_block_name || "selected block"}.`);
      } else if (item.support_block_relation === "recommended") {
        preferenceBoost += 8 + item.support_block_priority;
        matchReasons.push(`${item.part_no} uses a recommended support block.`);
      } else if (item.support_block_relation === "allowed") {
        preferenceBoost += 4 + item.support_block_priority;
        matchReasons.push(`${item.part_no} uses an allowed support block.`);
      } else if (item.support_block_id && item.has_preferred_support_rules) {
        warnings.push(`${item.part_no} selected a support block outside its configured preferred list.`);
      } else if (!item.support_block_id && item.has_preferred_support_rules) {
        warnings.push(`${item.part_no} has configured support block rules; selecting one of the recommended blocks may improve consistency.`);
      }

      if (
        item.preferred_furnace_type &&
        (profile.machine_name?.includes(item.preferred_furnace_type) ||
          profile.machine_code?.includes(item.preferred_furnace_type))
      ) {
        preferenceBoost += 6;
        matchReasons.push(`${item.part_no} matches preferred equipment keyword ${item.preferred_furnace_type}.`);
      }

      totalRequiredPositions += item.tray_count;
      itemAnalysis.push({
        part_no: item.part_no,
        part_name: item.part_name,
        quantity: item.quantity,
        tray_count: item.tray_count,
        required_height: item.required_height,
        height_fits: heightFits,
        support_block_code: item.support_block_code,
        support_block_name: item.support_block_name,
        support_block_relation: item.support_block_relation,
        has_support_block_rules: item.has_support_block_rules
      });
    }

    if (uniqueProducts.size > 1 && !mixCompatible) {
      conflicts.push("Selected products are not all marked as mix-load compatible.");
    } else if (uniqueProducts.size > 1 && mixCompatible) {
      matchReasons.push("Products can be arranged using mixed-load round-robin front/back position suggestions.");
    }

    if (totalRequiredPositions > totalCapacityPositions) {
      conflicts.push(
        `Requires ${totalRequiredPositions} tray positions, but ${profile.machine_code} only has ${profile.total_layers} layers x ${positionsPerLayer} positions.`
      );
    }

    layerSuggestions.push(
      ...this.buildLayerSuggestions(items, profile.total_layers, positionsPerLayer, mixCompatible)
    );
    const estimatedLoadRate = Number(((totalRequiredPositions / totalCapacityPositions) * 100).toFixed(1));
    const loadTargetPenalty = Math.abs(Math.min(estimatedLoadRate, 100) - 90);
    const heightPenalty = itemAnalysis.some((item) => !item.height_fits) ? 40 : 0;
    const warningPenalty = warnings.length * 5;
    const recommendationScore =
      conflicts.length === 0
        ? Number(Math.max(0, 100 - loadTargetPenalty - heightPenalty - warningPenalty + preferenceBoost).toFixed(1))
        : 0;

    return {
      machine_id: profile.machine_id,
      machine_code: profile.machine_code,
      machine_name: profile.machine_name,
      total_layers: profile.total_layers,
      positions_per_layer: positionsPerLayer,
      total_capacity_positions: totalCapacityPositions,
      max_layer_height: maxLayerHeight,
      mix_compatible: mixCompatible,
      total_required_layers: Math.ceil(totalRequiredPositions / positionsPerLayer),
      total_required_positions: totalRequiredPositions,
      estimated_load_rate: estimatedLoadRate,
      feasible: conflicts.length === 0,
      conflicts,
      warnings,
      match_reasons: matchReasons,
      recommendation_score: recommendationScore,
      item_analysis: itemAnalysis,
      layer_suggestions: layerSuggestions,
      assumption:
        options.assumption ||
        "Initial version assumes each layer has front/back tray positions and uses occupied positions as load rate."
    };
  }

  calculateStructuredLayout(payload = {}, options = {}) {
    const items = this.resolveSinteringItems(payload.items);
    const profiles = this.listFurnaceProfiles({
      activeOnly: true,
      machineTypes: options.machineTypes || [MACHINE_TYPES.SINTERING_FURNACE]
    }).filter((profile) => profile.id);
    const results = profiles
      .map((profile) => this.evaluateStructuredMachine(profile, items, options))
      .sort((left, right) => {
        if (left.feasible !== right.feasible) {
          return left.feasible ? -1 : 1;
        }
        return right.recommendation_score - left.recommendation_score;
      });

    return {
      analyzed_at: this.now(),
      assumptions: options.assumptions || [
        "Each layer can hold front and back tray positions in the current release.",
        "Layer feasibility is driven by product height + tray + ceramic tray + foot + support block stack height.",
        "Mixed loads are treated as feasible when all selected products allow mixing.",
        "Support block rules boost or restrict recommendation scoring when configured."
      ],
      items,
      results
    };
  }

  calculateSinteringLayout(payload = {}) {
    return this.calculateStructuredLayout(payload, {
      machineTypes: [MACHINE_TYPES.SINTERING_FURNACE],
      assumptions: [
        "Each vacuum sintering layer can hold front and back tray positions in the current release.",
        "Layer feasibility is driven by product height + tray + ceramic tray + foot + support block stack height.",
        "Mixed loads use round-robin front/back position suggestions when all selected products allow mixing.",
        "Configured support block rules and preferred equipment keywords affect recommendation scoring."
      ],
      assumption:
        "Current vacuum sintering recommendation combines front/back position occupancy, fixture rules, and product preference matching."
    });
  }

  calculateVacuumLayout(payload = {}) {
    return this.calculateStructuredLayout(payload, {
      machineTypes: [MACHINE_TYPES.DEGREASING_VACUUM],
      assumptions: [
        "Each vacuum degreasing layer can hold front and back tray positions in the current release.",
        "Vacuum feasibility uses product height + tray + ceramic tray + foot + support block stack height against chamber layer height.",
        "If products all allow mixing, chamber position suggestions are distributed in round-robin order.",
        "Configured support block rules are applied to improve recommendation reliability."
      ],
      assumption:
        "Current vacuum degreasing recommendation combines front/back position occupancy, fixture rules, and product compatibility."
    });
  }

  createSinteringBatch(payload = {}) {
    const batchNo = String(payload.batch_no || payload.batchNo || "").trim();
    const plannedDate = payload.planned_date || payload.plannedDate;
    const operatorName = String(payload.operator_name || payload.operatorName || "").trim();
    if (!batchNo || !plannedDate || !operatorName) {
      throw new Error("Batch number, planned date, and operator name are required.");
    }

    const items = this.resolveSinteringItems(payload.items || []);
    const selectedFurnaceId = toOptionalInteger(payload.furnace_machine_id || payload.furnaceMachineId);
    if (!selectedFurnaceId) {
      throw new Error("請先選擇真空式燒結爐。");
    }
    const selectedFurnace = this.getMachineById(selectedFurnaceId);
    if (!selectedFurnace || selectedFurnace.machine_type !== MACHINE_TYPES.SINTERING_FURNACE) {
      throw new Error("請選擇有效的真空式燒結爐。");
    }
    if (selectedFurnace.status !== "active") {
      throw new Error("選取的真空式燒結爐目前未啟用。");
    }
    const layoutResult = payload.calculate_layout === false ? null : this.calculateSinteringLayout({ items });
    const chosenRecommendation = layoutResult?.results.find((result) => result.machine_id === selectedFurnaceId) || null;
    const estimatedLoadRate = chosenRecommendation?.estimated_load_rate ?? null;
    const status = SINTERING_BATCH_STATUSES.includes(payload.status) ? payload.status : "planned";
    const notes = String(payload.notes || "").trim() || null;
    const now = this.now();

    const batchId = this.db.transaction(() => {
      const batchResult = this.db
        .prepare(
          `
            INSERT INTO sintering_batches (
              furnace_machine_id,
              batch_no,
              planned_date,
              status,
              estimated_load_rate,
              actual_load_rate,
              operator_name,
              notes,
              created_at,
              updated_at
            ) VALUES (
              @furnace_machine_id,
              @batch_no,
              @planned_date,
              @status,
              @estimated_load_rate,
              @actual_load_rate,
              @operator_name,
              @notes,
              @created_at,
              @updated_at
            )
          `
        )
        .run({
          furnace_machine_id: selectedFurnaceId,
          batch_no: batchNo,
          planned_date: plannedDate,
          status,
          estimated_load_rate: estimatedLoadRate,
          actual_load_rate: payload.actual_load_rate ?? payload.actualLoadRate ?? null,
          operator_name: operatorName,
          notes,
          created_at: now,
          updated_at: now
        });

      const itemStmt = this.db.prepare(`
        INSERT INTO sintering_batch_items (
          sintering_batch_id,
          product_id,
          quantity,
          unit_height,
          tray_count,
          support_block_id,
          support_block_height,
          notes,
          created_at
        ) VALUES (
          @sintering_batch_id,
          @product_id,
          @quantity,
          @unit_height,
          @tray_count,
          @support_block_id,
          @support_block_height,
          @notes,
          @created_at
        )
      `);

      for (const item of items) {
        itemStmt.run({
          sintering_batch_id: batchResult.lastInsertRowid,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_height: item.unit_height,
          tray_count: item.tray_count,
          support_block_id: item.support_block_id,
          support_block_height: item.support_block_height,
          notes: item.notes,
          created_at: now
        });
      }

      if (chosenRecommendation) {
        this.saveLayoutPlan({
          sintering_batch_id: batchResult.lastInsertRowid,
          furnace_machine_id: chosenRecommendation.machine_id,
          plan_name: payload.plan_name || payload.planName || "Auto Draft Recommendation",
          layout_json: chosenRecommendation,
          estimated_load_rate: chosenRecommendation.estimated_load_rate,
          is_selected: 1
        });
      }

      this.logSystemEvent("info", "sintering", "batch-create", "Sintering batch created.", {
        batchId: batchResult.lastInsertRowid,
        selectedFurnaceId
      });

      return batchResult.lastInsertRowid;
    })();

    return this.getSinteringBatchById(batchId);
  }

  getSinteringBatchById(id) {
    const batch = this.db
      .prepare(
        `
          SELECT
            sb.*,
            m.machine_code AS furnace_machine_code,
            m.machine_name AS furnace_machine_name
          FROM sintering_batches sb
          LEFT JOIN machines m ON m.id = sb.furnace_machine_id
          WHERE sb.id = ?
        `
      )
      .get(id);

    if (!batch) {
      return null;
    }

    const items = this.db
      .prepare(
        `
          SELECT
            sbi.*,
            pm.product_code AS part_no,
            pm.product_name AS part_name,
            p.spec_code,
            p.spec_name
          FROM sintering_batch_items sbi
          JOIN products p ON p.id = sbi.product_id
          LEFT JOIN product_masters pm ON pm.id = p.product_master_id
          WHERE sbi.sintering_batch_id = ?
          ORDER BY sbi.id
        `
      )
      .all(id);

    return {
      ...batch,
      items
    };
  }

  listSinteringBatches(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.status) {
      conditions.push("sb.status = ?");
      params.push(filters.status);
    }

    if (filters.date_from || filters.dateFrom) {
      conditions.push("sb.planned_date >= ?");
      params.push(filters.date_from || filters.dateFrom);
    }

    if (filters.date_to || filters.dateTo) {
      conditions.push("sb.planned_date <= ?");
      params.push(filters.date_to || filters.dateTo);
    }

    if (filters.batch_no || filters.batchNo) {
      conditions.push("sb.batch_no LIKE ?");
      params.push(`%${filters.batch_no || filters.batchNo}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT
            sb.*,
            m.machine_code AS furnace_machine_code,
            m.machine_name AS furnace_machine_name,
            COUNT(sbi.id) AS item_count
          FROM sintering_batches sb
          LEFT JOIN machines m ON m.id = sb.furnace_machine_id
          LEFT JOIN sintering_batch_items sbi ON sbi.sintering_batch_id = sb.id
          ${whereClause}
          GROUP BY sb.id
          ORDER BY sb.planned_date DESC, sb.created_at DESC
        `
      )
      .all(...params);

    return rows.map((row) => ({
      ...row,
      estimated_load_rate: row.estimated_load_rate === null ? null : toNumber(row.estimated_load_rate, 0),
      actual_load_rate: row.actual_load_rate === null ? null : toNumber(row.actual_load_rate, 0)
    }));
  }

  createVacuumBatch(payload = {}) {
    const batchNo = String(payload.batch_no || payload.batchNo || "").trim();
    const plannedDate = payload.planned_date || payload.plannedDate;
    const operatorName = String(payload.operator_name || payload.operatorName || "").trim();
    if (!batchNo || !plannedDate || !operatorName) {
      throw new Error("Batch number, planned date, and operator name are required.");
    }

    const items = this.resolveSinteringItems(payload.items || []);
    const selectedMachineId = toOptionalInteger(payload.vacuum_machine_id || payload.vacuumMachineId);
    if (!selectedMachineId) {
      throw new Error("請先選擇真空式脫脂爐。");
    }
    const selectedMachine = this.getMachineById(selectedMachineId);
    if (!selectedMachine || selectedMachine.machine_type !== MACHINE_TYPES.DEGREASING_VACUUM) {
      throw new Error("請選擇有效的真空式脫脂爐。");
    }
    if (selectedMachine.status !== "active") {
      throw new Error("選取的真空式脫脂爐目前未啟用。");
    }
    const layoutResult = payload.calculate_layout === false ? null : this.calculateVacuumLayout({ items });
    const chosenRecommendation = layoutResult?.results.find((result) => result.machine_id === selectedMachineId) || null;
    const estimatedLoadRate = chosenRecommendation?.estimated_load_rate ?? null;
    const status = SINTERING_BATCH_STATUSES.includes(payload.status) ? payload.status : "planned";
    const notes = String(payload.notes || "").trim() || null;
    const now = this.now();

    const batchId = this.db.transaction(() => {
      const batchResult = this.db
        .prepare(
          `
            INSERT INTO vacuum_batches (
              vacuum_machine_id,
              batch_no,
              planned_date,
              status,
              estimated_load_rate,
              actual_load_rate,
              operator_name,
              notes,
              created_at,
              updated_at
            ) VALUES (
              @vacuum_machine_id,
              @batch_no,
              @planned_date,
              @status,
              @estimated_load_rate,
              @actual_load_rate,
              @operator_name,
              @notes,
              @created_at,
              @updated_at
            )
          `
        )
        .run({
          vacuum_machine_id: selectedMachineId,
          batch_no: batchNo,
          planned_date: plannedDate,
          status,
          estimated_load_rate: estimatedLoadRate,
          actual_load_rate: payload.actual_load_rate ?? payload.actualLoadRate ?? null,
          operator_name: operatorName,
          notes,
          created_at: now,
          updated_at: now
        });

      const itemStmt = this.db.prepare(`
        INSERT INTO vacuum_batch_items (
          vacuum_batch_id,
          product_id,
          quantity,
          unit_height,
          tray_count,
          support_block_id,
          support_block_height,
          notes,
          created_at
        ) VALUES (
          @vacuum_batch_id,
          @product_id,
          @quantity,
          @unit_height,
          @tray_count,
          @support_block_id,
          @support_block_height,
          @notes,
          @created_at
        )
      `);

      for (const item of items) {
        itemStmt.run({
          vacuum_batch_id: batchResult.lastInsertRowid,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_height: item.unit_height,
          tray_count: item.tray_count,
          support_block_id: item.support_block_id,
          support_block_height: item.support_block_height,
          notes: item.notes,
          created_at: now
        });
      }

      if (chosenRecommendation) {
        this.saveVacuumLayoutPlan({
          vacuum_batch_id: batchResult.lastInsertRowid,
          vacuum_machine_id: chosenRecommendation.machine_id,
          plan_name: payload.plan_name || payload.planName || "Auto Draft Recommendation",
          layout_json: chosenRecommendation,
          estimated_load_rate: chosenRecommendation.estimated_load_rate,
          is_selected: 1
        });
      }

      this.logSystemEvent("info", "vacuum", "batch-create", "Vacuum degreasing batch created.", {
        batchId: batchResult.lastInsertRowid,
        selectedMachineId
      });

      return batchResult.lastInsertRowid;
    })();

    return this.getVacuumBatchById(batchId);
  }

  getVacuumBatchById(id) {
    const batch = this.db
      .prepare(
        `
          SELECT
            vb.*,
            m.machine_code AS vacuum_machine_code,
            m.machine_name AS vacuum_machine_name
          FROM vacuum_batches vb
          LEFT JOIN machines m ON m.id = vb.vacuum_machine_id
          WHERE vb.id = ?
        `
      )
      .get(id);

    if (!batch) {
      return null;
    }

    const items = this.db
      .prepare(
        `
          SELECT
            vbi.*,
            pm.product_code AS part_no,
            pm.product_name AS part_name,
            p.spec_code,
            p.spec_name,
            sb.block_code AS support_block_code,
            sb.block_name AS support_block_name
          FROM vacuum_batch_items vbi
          JOIN products p ON p.id = vbi.product_id
          LEFT JOIN product_masters pm ON pm.id = p.product_master_id
          LEFT JOIN support_blocks sb ON sb.id = vbi.support_block_id
          WHERE vbi.vacuum_batch_id = ?
          ORDER BY vbi.id
        `
      )
      .all(id);

    return {
      ...batch,
      items
    };
  }

  listVacuumBatches(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.status) {
      conditions.push("vb.status = ?");
      params.push(filters.status);
    }

    if (filters.date_from || filters.dateFrom) {
      conditions.push("vb.planned_date >= ?");
      params.push(filters.date_from || filters.dateFrom);
    }

    if (filters.date_to || filters.dateTo) {
      conditions.push("vb.planned_date <= ?");
      params.push(filters.date_to || filters.dateTo);
    }

    if (filters.batch_no || filters.batchNo) {
      conditions.push("vb.batch_no LIKE ?");
      params.push(`%${filters.batch_no || filters.batchNo}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT
            vb.*,
            m.machine_code AS vacuum_machine_code,
            m.machine_name AS vacuum_machine_name,
            COUNT(vbi.id) AS item_count
          FROM vacuum_batches vb
          LEFT JOIN machines m ON m.id = vb.vacuum_machine_id
          LEFT JOIN vacuum_batch_items vbi ON vbi.vacuum_batch_id = vb.id
          ${whereClause}
          GROUP BY vb.id
          ORDER BY vb.planned_date DESC, vb.created_at DESC
        `
      )
      .all(...params);

    return rows.map((row) => ({
      ...row,
      estimated_load_rate: row.estimated_load_rate === null ? null : toNumber(row.estimated_load_rate, 0),
      actual_load_rate: row.actual_load_rate === null ? null : toNumber(row.actual_load_rate, 0)
    }));
  }

  saveVacuumLayoutPlan(payload = {}) {
    const batchId = Number(payload.vacuum_batch_id || payload.vacuumBatchId);
    const machineId = Number(payload.vacuum_machine_id || payload.vacuumMachineId);
    const planName = String(payload.plan_name || payload.planName || "").trim();
    if (!batchId || !machineId || !planName) {
      throw new Error("Vacuum batch, machine, and plan name are required.");
    }

    const now = this.now();
    const isSelected = toBoolean(payload.is_selected ?? payload.isSelected) ? 1 : 0;
    return this.db.transaction(() => {
      if (isSelected) {
        this.db
          .prepare("UPDATE vacuum_layout_plans SET is_selected = 0, updated_at = ? WHERE vacuum_batch_id = ?")
          .run(now, batchId);
      }

      const result = this.db
        .prepare(
          `
            INSERT INTO vacuum_layout_plans (
              vacuum_batch_id,
              vacuum_machine_id,
              plan_name,
              layout_json,
              estimated_load_rate,
              is_selected,
              created_at,
              updated_at
            ) VALUES (
              @vacuum_batch_id,
              @vacuum_machine_id,
              @plan_name,
              @layout_json,
              @estimated_load_rate,
              @is_selected,
              @created_at,
              @updated_at
            )
          `
        )
        .run({
          vacuum_batch_id: batchId,
          vacuum_machine_id: machineId,
          plan_name: planName,
          layout_json: this.stringify(payload.layout_json || payload.layoutJson || {}),
          estimated_load_rate: payload.estimated_load_rate ?? payload.estimatedLoadRate ?? null,
          is_selected: isSelected,
          created_at: now,
          updated_at: now
        });

      this.logSystemEvent("info", "vacuum", "layout-save", "Vacuum layout plan saved.", {
        layoutPlanId: result.lastInsertRowid,
        batchId
      });

      return this.getVacuumLayoutPlanById(result.lastInsertRowid);
    })();
  }

  getVacuumLayoutPlanById(id) {
    const row = this.db
      .prepare(
        `
          SELECT
            vlp.*,
            m.machine_code,
            m.machine_name
          FROM vacuum_layout_plans vlp
          JOIN machines m ON m.id = vlp.vacuum_machine_id
          WHERE vlp.id = ?
        `
      )
      .get(id);

    if (!row) {
      return null;
    }

    return {
      ...row,
      layout_json: this.parseJson(row.layout_json, {})
    };
  }

  listVacuumLayoutPlans(batchId) {
    const rows = this.db
      .prepare(
        `
          SELECT
            vlp.*,
            m.machine_code,
            m.machine_name
          FROM vacuum_layout_plans vlp
          JOIN machines m ON m.id = vlp.vacuum_machine_id
          WHERE vlp.vacuum_batch_id = ?
          ORDER BY vlp.is_selected DESC, vlp.created_at DESC
        `
      )
      .all(batchId);

    return rows.map((row) => ({
      ...row,
      layout_json: this.parseJson(row.layout_json, {})
    }));
  }

  saveLayoutPlan(payload = {}) {
    const batchId = Number(payload.sintering_batch_id || payload.sinteringBatchId);
    const furnaceMachineId = Number(payload.furnace_machine_id || payload.furnaceMachineId);
    const planName = String(payload.plan_name || payload.planName || "").trim();
    if (!batchId || !furnaceMachineId || !planName) {
      throw new Error("Batch, furnace, and plan name are required.");
    }

    const now = this.now();
    const isSelected = toBoolean(payload.is_selected ?? payload.isSelected) ? 1 : 0;
    return this.db.transaction(() => {
      if (isSelected) {
        this.db
          .prepare("UPDATE sintering_layout_plans SET is_selected = 0, updated_at = ? WHERE sintering_batch_id = ?")
          .run(now, batchId);
      }

      const result = this.db
        .prepare(
          `
            INSERT INTO sintering_layout_plans (
              sintering_batch_id,
              furnace_machine_id,
              plan_name,
              layout_json,
              estimated_load_rate,
              is_selected,
              created_at,
              updated_at
            ) VALUES (
              @sintering_batch_id,
              @furnace_machine_id,
              @plan_name,
              @layout_json,
              @estimated_load_rate,
              @is_selected,
              @created_at,
              @updated_at
            )
          `
        )
        .run({
          sintering_batch_id: batchId,
          furnace_machine_id: furnaceMachineId,
          plan_name: planName,
          layout_json: this.stringify(payload.layout_json || payload.layoutJson || {}),
          estimated_load_rate: payload.estimated_load_rate ?? payload.estimatedLoadRate ?? null,
          is_selected: isSelected,
          created_at: now,
          updated_at: now
        });

      this.logSystemEvent("info", "sintering", "layout-save", "Sintering layout plan saved.", {
        layoutPlanId: result.lastInsertRowid,
        batchId
      });

      return this.getLayoutPlanById(result.lastInsertRowid);
    })();
  }

  getLayoutPlanById(id) {
    const row = this.db
      .prepare(
        `
          SELECT
            slp.*,
            m.machine_code,
            m.machine_name
          FROM sintering_layout_plans slp
          JOIN machines m ON m.id = slp.furnace_machine_id
          WHERE slp.id = ?
        `
      )
      .get(id);

    if (!row) {
      return null;
    }

    return {
      ...row,
      layout_json: this.parseJson(row.layout_json, {})
    };
  }

  listLayoutPlans(batchId) {
    const rows = this.db
      .prepare(
        `
          SELECT
            slp.*,
            m.machine_code,
            m.machine_name
          FROM sintering_layout_plans slp
          JOIN machines m ON m.id = slp.furnace_machine_id
          WHERE slp.sintering_batch_id = ?
          ORDER BY slp.is_selected DESC, slp.created_at DESC
        `
      )
      .all(batchId);

    return rows.map((row) => ({
      ...row,
      layout_json: this.parseJson(row.layout_json, {})
    }));
  }

  getDashboardSummary() {
    const degreasingMachines = this.listMachines({
      machine_type: MACHINE_TYPES.DEGREASING_IMMERSION
    }).map((machine) => ({
      ...machine,
      usage_percent:
        machine.solvent_weight_limit > 0
          ? Number(
              ((machine.current_solvent_accum_weight / machine.solvent_weight_limit) * 100).toFixed(1)
            )
          : 0
    }));

    const solventAlerts = degreasingMachines.filter((machine) => machine.alert_state !== "normal");
    const nearThreshold = degreasingMachines.filter(
      (machine) => machine.alert_state === "warning" || machine.alert_state === "needs_change"
    );
    const furnaces = this.listFurnaceProfiles();
    const vacuumUnits = this.listFurnaceProfiles({
      machineTypes: [MACHINE_TYPES.DEGREASING_VACUUM]
    });
    const today = new Date().toISOString().slice(0, 10);
    const upcomingSintering = this.listSinteringBatches({ date_from: today }).slice(0, 6);
    const upcomingVacuum = this.listVacuumBatches({ date_from: today }).slice(0, 6);
    const recentDegreasing = this.listDegreasingBatches({ limit: 6 });
    const recentSolventChanges = this.listSolventChangeLogs({ limit: 6 });
    const loadAverage = this.db
      .prepare(
        `
          SELECT AVG(estimated_load_rate) AS avg_load_rate
          FROM sintering_batches
          WHERE estimated_load_rate IS NOT NULL
        `
      )
      .get();

    return {
      degreasing: {
        machines: degreasingMachines,
        solvent_alert_count: solventAlerts.length,
        near_threshold_count: nearThreshold.length
      },
      vacuum_units: vacuumUnits,
      furnaces,
      upcoming_vacuum: upcomingVacuum,
      upcoming_sintering: upcomingSintering,
      recent_degreasing: recentDegreasing,
      recent_solvent_changes: recentSolventChanges,
      average_estimated_load_rate: Number(toNumber(loadAverage?.avg_load_rate, 0).toFixed(1))
    };
  }

  listSystemLogs(filters = {}) {
    const limit = Math.min(Math.max(Math.round(toNumber(filters.limit, 100)), 1), 500);
    return this.db
      .prepare(
        `
          SELECT *
          FROM system_logs
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      )
      .all();
  }

  assertFixtureType(fixtureId, expectedType, fieldLabel) {
    if (!fixtureId) {
      return null;
    }

    const fixture = this.getSupportBlockById(fixtureId);
    if (!fixture) {
      throw new Error(`${fieldLabel} not found.`);
    }

    if (fixture.fixture_type !== expectedType) {
      throw new Error(`${fieldLabel} must use ${expectedType} fixture type.`);
    }

    return fixture;
  }

  buildProductValues(payload = {}) {
    const trayFixtureId = toOptionalInteger(payload.tray_fixture_id || payload.trayFixtureId);
    const supportFixtureId = toOptionalInteger(payload.support_fixture_id || payload.supportFixtureId);
    const ceramicTrayFixtureId = toOptionalInteger(
      payload.ceramic_tray_fixture_id || payload.ceramicTrayFixtureId
    );
    const footFixtureId = toOptionalInteger(payload.foot_fixture_id || payload.footFixtureId);

    const trayFixture = this.assertFixtureType(trayFixtureId, FIXTURE_TYPES.TRAY, "Tray fixture");
    const supportFixture = this.assertFixtureType(
      supportFixtureId,
      FIXTURE_TYPES.SUPPORT_BLOCK,
      "Support block fixture"
    );
    const ceramicTrayFixture = this.assertFixtureType(
      ceramicTrayFixtureId,
      FIXTURE_TYPES.CERAMIC_TRAY,
      "Ceramic tray fixture"
    );
    const footFixture = this.assertFixtureType(footFixtureId, FIXTURE_TYPES.FOOT, "Foot fixture");

    const supportStackQuantity = Math.max(
      1,
      Math.round(toNumber(payload.support_stack_quantity || payload.supportStackQuantity, 1))
    );
    if (supportFixture && supportStackQuantity > supportFixture.max_stack_count) {
      throw new Error("Support block stack quantity exceeds configured max stack count.");
    }

    return {
      product_height: requireNumberValue(payload, ["product_height", "productHeight"], "產品高度 (mm)", {
        min: 0
      }),
      tray_capacity: requireNumberValue(payload, ["tray_capacity", "trayCapacity"], "單盤容量 (pcs)", {
        min: 1,
        integer: true
      }),
      tray_height: trayFixture?.height ?? toNumber(payload.tray_height ?? payload.trayHeight, 0),
      support_block_height:
        (supportFixture?.height ?? toNumber(payload.support_block_height ?? payload.supportBlockHeight, 0)) *
        supportStackQuantity,
      tray_fixture_id: trayFixture?.id || null,
      support_fixture_id: supportFixture?.id || null,
      ceramic_tray_fixture_id: ceramicTrayFixture?.id || null,
      foot_fixture_id: footFixture?.id || null,
      support_stack_quantity: supportStackQuantity,
      can_mix_load: toBoolean(payload.can_mix_load ?? payload.canMixLoad) ? 1 : 0,
      preferred_furnace_type:
        String(payload.preferred_furnace_type || payload.preferredFurnaceType || "").trim() || null,
      notes: String(payload.notes || "").trim() || null
    };
  }

  buildProductMasterValues(payload = {}) {
    return {
      product_code: String(
        payload.product_code || payload.productCode || payload.part_no || payload.partNo || ""
      ).trim(),
      product_name: String(
        payload.product_name || payload.productName || payload.part_name || payload.partName || ""
      ).trim(),
      erp_item_id: String(payload.erp_item_id || payload.erpItemId || "").trim() || null,
      erp_item_code: String(payload.erp_item_code || payload.erpItemCode || "").trim() || null,
      revision: String(payload.revision || "").trim() || null,
      source_system: normalizeEnum(
        String(payload.source_system || payload.sourceSystem || "local").trim(),
        DATA_SOURCE_SYSTEMS,
        "local"
      ),
      sync_status: normalizeEnum(
        String(payload.sync_status || payload.syncStatus || "local_only").trim(),
        SYNC_STATUSES,
        "local_only"
      ),
      last_synced_at: payload.last_synced_at || payload.lastSyncedAt || null,
      notes: String(payload.notes || "").trim() || null
    };
  }

  ensureProductMasterForSpec(payload = {}) {
    const explicitMasterId = toOptionalInteger(payload.product_master_id || payload.productMasterId);
    if (explicitMasterId) {
      const master = this.getProductMasterById(explicitMasterId);
      if (!master) {
        throw new Error("Selected product master does not exist.");
      }

      return master;
    }

    const masterValues = this.buildProductMasterValues(payload);
    if (!masterValues.product_code || !masterValues.product_name) {
      throw new Error("Product master selection is required.");
    }

    const existingMaster = this.getProductMasterByCode(masterValues.product_code);
    if (existingMaster) {
      return existingMaster;
    }

    return this.createProductMaster(masterValues);
  }

  buildStoredProductPartNo(productCode, specCode) {
    const code = String(productCode || "").trim();
    const normalizedSpecCode = String(specCode || "DEFAULT").trim() || "DEFAULT";
    return normalizedSpecCode === "DEFAULT" ? code : `${code}::${normalizedSpecCode}`;
  }

  buildStoredProductPartName(productName, specName) {
    const name = String(productName || "").trim();
    const normalizedSpecName = String(specName || "預設製程規格").trim() || "預設製程規格";
    return normalizedSpecName === "預設製程規格" ? name : `${name} / ${normalizedSpecName}`;
  }

  syncProductSnapshotsForMaster(masterId) {
    const master = this.getProductMasterById(masterId);
    if (!master) {
      return;
    }

    const specs = this.db
      .prepare("SELECT id, spec_code, spec_name FROM products WHERE product_master_id = ?")
      .all(masterId);
    const update = this.db.prepare(`
      UPDATE products
      SET part_no = @part_no,
          part_name = @part_name,
          updated_at = @updated_at
      WHERE id = @id
    `);
    const now = this.now();

    for (const spec of specs) {
      update.run({
        id: spec.id,
        part_no: this.buildStoredProductPartNo(master.product_code, spec.spec_code),
        part_name: this.buildStoredProductPartName(master.product_name, spec.spec_name),
        updated_at: now
      });
    }
  }
}

module.exports = {
  DatabaseService,
  MACHINE_TYPES
};
