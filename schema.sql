-- 家居储存管理 — D1 数据库建表
-- 在 Cloudflare Dashboard → D1 → 创建数据库后，在 Console 中执行
-- 或者: npx wrangler d1 execute home-storage-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS items (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT DEFAULT '家居用品',
    purchase_date TEXT DEFAULT '',
    price       REAL DEFAULT 0,
    expiry_date TEXT DEFAULT '',
    stock       INTEGER DEFAULT 1,
    location    TEXT DEFAULT '',
    status      TEXT DEFAULT '在库',
    remark      TEXT DEFAULT '',
    created_at  TEXT,
    updated_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);
