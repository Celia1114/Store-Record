/**
 * 家居储存管理 — Cloudflare Pages Functions API (修复版)
 * 路由: /api/items 和 /api/health
 * 
 * 修复：
 * 1. SELECT 返回时 snake_case→camelCase 转换
 * 2. INSERT 加入 open_date 列
 * 3. Schema 加入 open_date 列
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  await ensureSchema(env);

  if (method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }));
  }

  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== env.API_KEY) {
    return cors(new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    ));
  }

  try {
    if (path === '/api/health' && method === 'GET') {
      const r = await env.DB.prepare('SELECT COUNT(*) as c FROM items').first();
      return cors(Response.json({ ok: true, count: r?.c || 0 }));
    }

    if (path === '/api/items' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY updated_at DESC').all();
      // 关键修复：snake_case → camelCase
      const mapped = results.map(row => ({
        id: row.id,
        name: row.name || '',
        category: row.category || '日用品',
        purchaseDate: row.purchase_date || '',
        openDate: row.open_date || '',
        expiryDate: row.expiry_date || '',
        price: row.price || 0,
        stock: row.stock || 1,
        status: row.status || '在库',
        remark: row.remark || '',
        createdAt: row.created_at || '',
        updated_at: row.updated_at || ''
      }));
      return cors(Response.json(mapped));
    }

    if (path === '/api/items' && method === 'POST') {
      const item = await request.json();
      const now = new Date().toISOString();
      const id = item.id || crypto.randomUUID();
      await env.DB.prepare(`
        INSERT OR REPLACE INTO items
        (id, name, category, purchase_date, open_date, expiry_date, price, stock, status, remark, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, item.name, item.category || '日用品',
        item.purchaseDate || '', item.openDate || '', item.expiryDate || '',
        item.price || 0, item.stock || 1,
        item.status || '在库', item.remark || '',
        item.createdAt || now, now
      ).run();
      return cors(Response.json({ id, updated_at: now }, { status: 201 }));
    }

    if (path === '/api/items' && method === 'PUT') {
      const body = await request.json();
      const items = body.items || [];
      const now = new Date().toISOString();
      const batch = [env.DB.prepare('DELETE FROM items')];
      for (const it of items) {
        batch.push(env.DB.prepare(`
          INSERT INTO items
          (id, name, category, purchase_date, open_date, expiry_date, price, stock, status, remark, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          it.id, it.name, it.category || '日用品',
          it.purchaseDate || '', it.openDate || '', it.expiryDate || '',
          it.price || 0, it.stock || 1,
          it.status || '在库', it.remark || '',
          it.createdAt || now, now
        ));
      }
      await env.DB.batch(batch);
      const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY updated_at DESC').all();
      const mapped = results.map(row => ({
        id: row.id, name: row.name || '', category: row.category || '日用品',
        purchaseDate: row.purchase_date || '', openDate: row.open_date || '',
        expiryDate: row.expiry_date || '', price: row.price || 0,
        stock: row.stock || 1, status: row.status || '在库', remark: row.remark || '',
        createdAt: row.created_at || '', updated_at: row.updated_at || ''
      }));
      return cors(Response.json({ items: mapped, count: mapped.length, synced_at: now }));
    }

    if (path === '/api/items' && method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return cors(Response.json({ error: 'Missing id' }, { status: 400 }));
      const { changes } = await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
      if (changes === 0) return cors(Response.json({ error: 'Not found' }, { status: 404 }));
      return cors(Response.json({ deleted: id }));
    }

    return cors(new Response('Not found', { status: 404 }));
  } catch (e) {
    return cors(new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    }));
  }
}

function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  return resp;
}

let _schema = false;
async function ensureSchema(env) {
  if (_schema) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT '日用品',
    purchase_date TEXT DEFAULT '', open_date TEXT DEFAULT '', expiry_date TEXT DEFAULT '',
    price REAL DEFAULT 0, stock INTEGER DEFAULT 1, status TEXT DEFAULT '在库',
    remark TEXT DEFAULT '', created_at TEXT, updated_at TEXT
  )`).run();

  // 兼容旧表：如果没有 open_date 列，补上
  try {
    await env.DB.prepare("ALTER TABLE items ADD COLUMN open_date TEXT DEFAULT ''").run();
  } catch (e) { /* 列已存在 */ }

  _schema = true;
}