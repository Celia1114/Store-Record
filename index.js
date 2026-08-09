/**
 * 家居储存管理 — Cloudflare Worker API
 * 
 * 部署: npx wrangler deploy
 * API:  GET  /api/items            → 获取所有物品
 *        POST /api/items            → 新增一个物品
 *        PUT  /api/items            → 批量替换 ( { items: [...] } )
 *        PUT  /api/items/:id        → 更新单个物品
 *        DELETE /api/items?id=xxx   → 删除物品
 * 
 * 鉴权: 请求头 x-api-key 必须与 Wrangler Secret API_KEY 一致
 * CORS: 允许所有来源（个人使用）
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ── CORS 预检 ──
    if (method === 'OPTIONS') {
      return corsHeaders(new Response(null, { status: 204 }));
    }

    // ── 鉴权 ──
    const apiKey = request.headers.get('x-api-key') || '';
    if (!apiKey || apiKey !== env.API_KEY) {
      return corsHeaders(new Response(
        JSON.stringify({ error: 'Unauthorized — check x-api-key header' }),
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

// ── 数据库操作 ──

async function listItems(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM items ORDER BY updated_at DESC'
  ).all();
  return json(results);
}

async function countItems(env) {
  const { results } = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM items'
  ).first();
  return results ? results.count : 0;
}

async function createItem(request, env) {
  const item = await request.json();
  const now = new Date().toISOString();
  const id = item.id || crypto.randomUUID();

  await env.DB.prepare(`
    INSERT OR REPLACE INTO items 
    (id, name, category, purchase_date, price, expiry_date, stock, location, status, remark, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, ?), ?)
  `).bind(
    id, item.name, item.category || '家居用品', item.purchaseDate || '',
    item.price || 0, item.expiryDate || '', item.stock || 1,
    item.location || '', item.status || '在库', item.remark || '',
    item.createdAt || now, // 保留原始创建时间
    now                    // 更新时间为现在
  ).run();

  return json({ id, updated_at: now }, 201);
}

async function updateItem(path, request, env) {
  const id = path.split('/api/items/')[1];
  const item = await request.json();
  const now = new Date().toISOString();

  // 逐字段更新，只更新提供的字段
  const fields = [];
  const values = [];

  if (item.name !== undefined)       { fields.push('name = ?');       values.push(item.name); }
  if (item.category !== undefined)   { fields.push('category = ?');   values.push(item.category); }
  if (item.purchaseDate !== undefined) { fields.push('purchase_date = ?'); values.push(item.purchaseDate); }
  if (item.price !== undefined)      { fields.push('price = ?');      values.push(item.price); }
  if (item.expiryDate !== undefined) { fields.push('expiry_date = ?'); values.push(item.expiryDate); }
  if (item.stock !== undefined)      { fields.push('stock = ?');      values.push(item.stock); }
  if (item.location !== undefined)   { fields.push('location = ?');   values.push(item.location); }
  if (item.status !== undefined)     { fields.push('status = ?');     values.push(item.status); }
  if (item.remark !== undefined)     { fields.push('remark = ?');     values.push(item.remark); }

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

  // 事务：先全删再全插
  const batch = [];
  batch.push(env.DB.prepare('DELETE FROM items'));

  for (const item of items) {
    batch.push(env.DB.prepare(`
      INSERT INTO items (id, name, category, purchase_date, price, expiry_date, stock, location, status, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item.id, item.name, item.category || '家居用品', item.purchaseDate || '',
      item.price || 0, item.expiryDate || '', item.stock || 1,
      item.location || '', item.status || '在库', item.remark || '',
      item.createdAt || now, now
    ));
  }

  await env.DB.batch(batch);

  // 返回更新后的全部数据
  const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY updated_at DESC').all();
  return json({ items: results, count: results.length, synced_at: now });
}

async function deleteItem(url, env) {
  const id = url.searchParams.get('id');
  if (!id) {
    return json({ error: 'Missing ?id= parameter' }, 400);
  }

  const { changes } = await env.DB.prepare(
    'DELETE FROM items WHERE id = ?'
  ).bind(id).run();

  if (changes === 0) {
    return json({ error: 'Item not found' }, 404);
  }

  return json({ deleted: id });
}
