/**
 * 家居储存管理 — Cloudflare Pages Functions API
 * 路由: /api/items 和 /api/health
 * 和 index.html 共用一个 pages.dev 域名，手机网络也能访问
 *
 * 鉴权: 请求头 x-api-key 必须与 API_KEY 密匙一致
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 自动建表（首次请求）
  await ensureSchema(env);

  // CORS 预检
  if (method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }));
  }

  // 鉴权
  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== env.API_KEY) {
    return cors(new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    ));
  }

  try {
    if (path === '/api/health' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT COUNT(*) as c FROM items').first();
      return cors(Response.json({ ok: true, count: results?.c || 0 }));
    }

    if (path === '/api/items' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY updated_at DESC').all();
      return cors(Response.json(results));
    }

    if (path === '/api/items' && method === 'POST') {
      const item = await request.json();
      const now = new Date().toISOString();
      const id = item.id || crypto.randomUUID();
      await env.DB.prepare(`
        INSERT OR REPLACE INTO items (id,name,category,purchase_date,price,expiry_date,stock,location,status,remark,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,COALESCE(?,?),?)
      `).bind(id, item.name, item.category||'家居用品', item.purchaseDate||'',
        item.price||0, item.expiryDate||'', item.stock||1,
        item.location||'', item.status||'在库', item.remark||'',
        item.createdAt||now, now).run();
      return cors(Response.json({ id, updated_at: now }, { status: 201 }));
    }

    if (path === '/api/items' && method === 'PUT') {
      const { items } = await request.json();
      const now = new Date().toISOString();
      const batch = [env.DB.prepare('DELETE FROM items')];
      for (const it of (items||[])) {
        batch.push(env.DB.prepare(`
          INSERT INTO items (id,name,category,purchase_date,price,expiry_date,stock,location,status,remark,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(it.id, it.name, it.category||'家居用品', it.purchaseDate||'',
          it.price||0, it.expiryDate||'', it.stock||1,
          it.location||'', it.status||'在库', it.remark||'',
          it.createdAt||now, now));
      }
      await env.DB.batch(batch);
      const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY updated_at DESC').all();
      return cors(Response.json({ items: results, count: results.length, synced_at: now }));
    }

    if (path === '/api/items' && method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return cors(Response.json({ error: 'Missing id' }, { status: 400 }));
      const { changes } = await env.DB.prepare('DELETE FROM items WHERE id=?').bind(id).run();
      if (changes===0) return cors(Response.json({ error: 'Not found' }, { status: 404 }));
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
  resp.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type,x-api-key');
  return resp;
}

let _schema = false;
async function ensureSchema(env) {
  if (_schema) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT '家居用品',
    purchase_date TEXT DEFAULT '', price REAL DEFAULT 0, expiry_date TEXT DEFAULT '',
    stock INTEGER DEFAULT 1, location TEXT DEFAULT '', status TEXT DEFAULT '在库',
    remark TEXT DEFAULT '', created_at TEXT, updated_at TEXT
  )`).run();
  _schema = true;
}
