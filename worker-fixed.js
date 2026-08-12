/**
 * 家居储存管理 — Cloudflare Worker API (修复版)
 *
 * 修复点：
 * 1. SQL 字段 purchase_date/expiry_date ↔ JS 字段 purchaseDate/expiryDate 互转
 * 2. 新增 open_date 列对应前端 openDate
 * 3. 移除已不用的 location 字段
 *
 * 部署: npx wrangler deploy
 * API:  GET  /api/items    → 获取所有物品（转 camelCase）
 *        POST /api/items    → 新增
 *        PUT  /api/items    → 批量替换
 *        PUT  /api/items/:id → 更新单个
 *        DELETE /api/items?id=xxx → 删除
 *
 * 鉴权: 请求头 x-api-key 必须与 Wrangler Secret API_KEY 一致
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    await ensureSchema(env);

    if (method === 'OPTIONS') {
      return corsHeaders(new Response(null, { status: 204 }));
    }

    const apiKey = request.headers.get('x-api-key') || '';
    if (!apiKey || apiKey !== env.API_KEY) {
      return corsHeaders(new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ));
    }

    try {
      let response;
      if (path === '/api/items' && method === 'GET') {
        response = await listItems(env);
      } else if (path === '/api/items' && method === 'POST') {
        response = await createItem(request, env);
      } else if (path === '/api/items' && method === 'PUT') {
        response = await bulkReplace(request, env);
      } else if (path.startsWith('/api/items/') && method === 'PUT') {
        response = await updateItem(path, request, env);
      } else if (path === '/api/items' && method === 'DELETE') {
        response = await deleteItem(url, env);
      } else if (path === '/api/health' && method === 'GET') {
        response = new Response(JSON.stringify({ ok: true, count: await countItems(env) }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        response = new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' }
        });
      }
      return corsHeaders(response);
    } catch (e) {
      return corsHeaders(new Response(
        JSON.stringify({ error: e.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      ));
    }
  }
};

function corsHeaders(response) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  return response;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ── 字段映射：SQL snake_case ↔ JS camelCase ──

// DB 行 → JS 对象
function rowToJs(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    purchaseDate: row.purchase_date || '',
    openDate: row.open_date || '',
    expiryDate: row.expiry_date || '',
    price: row.price,
    stock: row.stock,
    status: row.status,
    remark: row.remark,
    createdAt: row.created_at,
    updated_at: row.updated_at
  };
}

// JS 对象 → DB 行
function jsToRow(item) {
  return {
    id: item.id,
    name: item.name,
    category: item.category || '日用品',
    purchase_date: item.purchaseDate || '',
    open_date: item.openDate || '',
    expiry_date: item.expiryDate || '',
    price: item.price || 0,
    stock: item.stock || 1,
    status: item.status || '在库',
    remark: item.remark || '',
    created_at: item.createdAt
  };
}

// ── 数据库操作 ──

async function listItems(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM items ORDER BY updated_at DESC'
  ).all();
  return json(results.map(rowToJs));
}

async function countItems(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) as count FROM items').first();
  return row ? row.count : 0;
}

async function createItem(request, env) {
  const item = await request.json();
  const now = new Date().toISOString();
  const id = item.id || crypto.randomUUID();
  const r = jsToRow({ ...item, id, createdAt: item.createdAt || now });
  r.updated_at = now;

  await env.DB.prepare(`
    INSERT OR REPLACE INTO items
    (id, name, category, purchase_date, open_date, expiry_date, price, stock, status, remark, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    r.id, r.name, r.category, r.purchase_date, r.open_date, r.expiry_date,
    r.price, r.stock, r.status, r.remark, r.created_at, r.updated_at
  ).run();

  return json({ id, updated_at: now }, 201);
}

async function updateItem(path, request, env) {
  const id = path.split('/api/items/')[1];
  const item = await request.json();
  const now = new Date().toISOString();

  const fields = [];
  const values = [];

  if (item.name !== undefined)         { fields.push('name = ?');         values.push(item.name); }
  if (item.category !== undefined)     { fields.push('category = ?');     values.push(item.category); }
  if (item.purchaseDate !== undefined) { fields.push('purchase_date = ?'); values.push(item.purchaseDate); }
  if (item.openDate !== undefined)     { fields.push('open_date = ?');     values.push(item.openDate); }
  if (item.price !== undefined)        { fields.push('price = ?');        values.push(item.price); }
  if (item.expiryDate !== undefined)   { fields.push('expiry_date = ?');  values.push(item.expiryDate); }
  if (item.stock !== undefined)        { fields.push('stock = ?');        values.push(item.stock); }
  if (item.status !== undefined)       { fields.push('status = ?');       values.push(item.status); }
  if (item.remark !== undefined)       { fields.push('remark = ?');       values.push(item.remark); }

  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  if (fields.length === 1) {
    return json({ error: 'No fields to update' }, 400);
  }

  await env.DB.prepare(
    `UPDATE items SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return json({ id, updated_at: now });
}

async function bulkReplace(request, env) {
  const body = await request.json();
  const items = body.items || [];
  const now = new Date().toISOString();

  const batch = [];
  batch.push(env.DB.prepare('DELETE FROM items'));

  for (const item of items) {
    const r = jsToRow({ ...item, createdAt: item.createdAt || now });
    r.updated_at = now;
    batch.push(env.DB.prepare(`
      INSERT INTO items
      (id, name, category, purchase_date, open_date, expiry_date, price, stock, status, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      r.id, r.name, r.category, r.purchase_date, r.open_date, r.expiry_date,
      r.price, r.stock, r.status, r.remark, r.created_at, r.updated_at
    ));
  }

  await env.DB.batch(batch);

  const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY updated_at DESC').all();
  return json({ items: results.map(rowToJs), count: results.length, synced_at: now });
}

async function deleteItem(url, env) {
  const id = url.searchParams.get('id');
  if (!id) {
    return json({ error: 'Missing ?id=' }, 400);
  }

  const { changes } = await env.DB.prepare(
    'DELETE FROM items WHERE id = ?'
  ).bind(id).run();

  if (changes === 0) {
    return json({ error: 'Item not found' }, 404);
  }

  return json({ deleted: id });
}

// ── 自动建表 ──
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS items (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      category      TEXT DEFAULT '日用品',
      purchase_date TEXT DEFAULT '',
      open_date     TEXT DEFAULT '',
      expiry_date   TEXT DEFAULT '',
      price         REAL DEFAULT 0,
      stock         INTEGER DEFAULT 1,
      status        TEXT DEFAULT '在库',
      remark        TEXT DEFAULT '',
      created_at    TEXT,
      updated_at    TEXT
    )
  `).run();

  // 安全地添加 open_date 列（如果表已存在但缺这一列）
  try {
    await env.DB.prepare('ALTER TABLE items ADD COLUMN open_date TEXT DEFAULT \'\'').run();
  } catch (e) {
    // 列已存在，忽略错误
  }

  schemaReady = true;
}