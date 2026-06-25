require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'img', 'uploads');
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || 'dk-admin-secret-2025-change-this';
const USER_TOKEN_SECRET = process.env.USER_TOKEN_SECRET || 'dk-user-secret-2025-change-this';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── UTILITIES ─────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
}

function hashPassword(value, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.pbkdf2Sync(String(value), salt, 120000, 64, 'sha512').toString('hex') };
}

function verifyPassword(value, record) {
  if (!record?.salt || !record?.hash) return false;
  const next = hashPassword(value, record.salt);
  try { return crypto.timingSafeEqual(Buffer.from(next.hash, 'hex'), Buffer.from(record.hash, 'hex')); }
  catch { return false; }
}

function createToken(payload, secret, expiresIn = 8 * 3600 * 1000) {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + expiresIn })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token?.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return Date.now() > payload.exp ? null : payload;
  } catch { return null; }
}

async function db(text, params = []) {
  const c = await pool.connect();
  try { const r = await c.query(text, params); return r.rows; }
  finally { c.release(); }
}
async function dbOne(text, params = []) { const r = await db(text, params); return r[0] ?? null; }

// ─── MIDDLEWARE ─────────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifyToken(token, ADMIN_TOKEN_SECRET);
  if (!session) return res.status(401).json({ success: false, message: 'Admin authentication required' });
  req.admin = session;
  next();
}

function requireUser(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifyToken(token, USER_TOKEN_SECRET);
  if (!session) return res.status(401).json({ success: false, message: 'Login required' });
  req.user = session;
  next();
}

function optionalUser(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  req.user = verifyToken(token, USER_TOKEN_SECRET);
  next();
}

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(ROOT));

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => { await fs.mkdir(UPLOAD_DIR, { recursive: true }); cb(null, UPLOAD_DIR); },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed'));
    cb(null, true);
  },
  limits: { fileSize: 8 * 1024 * 1024 }
});

// ─── HEALTH ─────────────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ success: true, message: 'DK Gaming Zone API running' });
});

// ─── ADMIN AUTH ──────────────────────────────────────────────────────────────────

app.get('/api/admin/status', async (req, res, next) => {
  try {
    const count = await dbOne('SELECT COUNT(*) AS total FROM admins');
    res.json({ success: true, setupRequired: Number(count.total) === 0 });
  } catch (e) { next(e); }
});

app.post('/api/admin/setup', async (req, res, next) => {
  try {
    const count = await dbOne('SELECT COUNT(*) AS total FROM admins');
    if (Number(count.total) > 0) return res.status(409).json({ success: false, message: 'Admin already configured' });
    const { name, email, password, recoveryQuestion, recoveryAnswer } = req.body;
    if (!name || !email || !password || password.length < 8)
      return res.status(422).json({ success: false, message: 'Name, email and password (min 8 chars) required' });
    const pass = hashPassword(password);
    const rec = recoveryAnswer ? hashPassword(String(recoveryAnswer).trim().toLowerCase()) : { salt: '', hash: '' };
    const admin = await dbOne(
      `INSERT INTO admins (name,email,password_salt,password_hash,recovery_question,recovery_salt,recovery_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,email,role`,
      [name.trim(), email.trim().toLowerCase(), pass.salt, pass.hash, recoveryQuestion || '', rec.salt, rec.hash]
    );
    res.status(201).json({ success: true, token: createToken({ id: admin.id, email: admin.email, role: admin.role, name: admin.name }, ADMIN_TOKEN_SECRET), admin });
  } catch (e) { next(e); }
});

app.post('/api/admin/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const admin = await dbOne('SELECT * FROM admins WHERE email=$1 AND is_active=TRUE LIMIT 1', [email]);
    if (!admin || !verifyPassword(req.body.password || '', { salt: admin.password_salt, hash: admin.password_hash }))
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    res.json({ success: true, token: createToken({ id: admin.id, email: admin.email, role: admin.role, name: admin.name }, ADMIN_TOKEN_SECRET), admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (e) { next(e); }
});

app.get('/api/admin/me', requireAdmin, async (req, res, next) => {
  try {
    const admin = await dbOne('SELECT id,name,email,role,created_at FROM admins WHERE id=$1', [req.admin.id]);
    res.json({ success: true, admin });
  } catch (e) { next(e); }
});

app.put('/api/admin/me', requireAdmin, async (req, res, next) => {
  try {
    const { name, email } = req.body;
    const admin = await dbOne(
      `UPDATE admins SET name=COALESCE($1,name), email=COALESCE($2,email) WHERE id=$3 RETURNING id,name,email,role`,
      [name || null, email ? email.trim().toLowerCase() : null, req.admin.id]
    );
    res.json({ success: true, admin });
  } catch (e) { next(e); }
});

app.put('/api/admin/password', requireAdmin, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8)
      return res.status(422).json({ success: false, message: 'New password must be at least 8 characters' });
    const admin = await dbOne('SELECT * FROM admins WHERE id=$1', [req.admin.id]);
    if (!verifyPassword(currentPassword || '', { salt: admin.password_salt, hash: admin.password_hash }))
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    const np = hashPassword(newPassword);
    await db('UPDATE admins SET password_salt=$1, password_hash=$2 WHERE id=$3', [np.salt, np.hash, req.admin.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (e) { next(e); }
});

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────────

app.get('/api/admin/dashboard', requireAdmin, async (req, res, next) => {
  try {
    const [orders, revenue, users, products, recentOrders, topProducts, lowStock] = await Promise.all([
      dbOne(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='pending') AS pending, COUNT(*) FILTER (WHERE status='delivered') AS delivered FROM orders`),
      dbOne(`SELECT COALESCE(SUM(total),0) AS total_revenue, COALESCE(SUM(CASE WHEN created_at > NOW()-INTERVAL '30 days' THEN total ELSE 0 END),0) AS monthly_revenue FROM orders WHERE status!='cancelled'`),
      dbOne(`SELECT COUNT(*) AS total FROM users`),
      dbOne(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active=TRUE) AS active FROM products`),
      db(`SELECT o.id,o.order_number,o.customer_name,o.total,o.status,o.created_at FROM orders o ORDER BY o.created_at DESC LIMIT 5`),
      db(`SELECT p.id,p.name,p.new_price,p.stock,COALESCE(SUM(oi.quantity),0) AS sold FROM products p LEFT JOIN order_items oi ON oi.product_id=p.id GROUP BY p.id ORDER BY sold DESC LIMIT 5`),
      db(`SELECT id,name,stock,low_stock_threshold FROM products WHERE stock <= low_stock_threshold AND is_active=TRUE ORDER BY stock ASC LIMIT 10`)
    ]);
    res.json({ success: true, stats: { orders, revenue, users, products }, recentOrders, topProducts, lowStock });
  } catch (e) { next(e); }
});

// ─── CATEGORIES ──────────────────────────────────────────────────────────────────

app.get('/api/categories', async (req, res, next) => {
  try {
    const cats = await db(`SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id=c.id AND is_active=TRUE) AS product_count FROM categories c WHERE c.is_active=TRUE ORDER BY c.sort_order, c.name`);
    const subs = await db(`SELECT * FROM subcategories WHERE is_active=TRUE ORDER BY sort_order, name`);
    const result = cats.map(c => ({ ...c, subcategories: subs.filter(s => s.category_id === c.id) }));
    res.json({ success: true, categories: result });
  } catch (e) { next(e); }
});

app.get('/api/categories/all', requireAdmin, async (req, res, next) => {
  try {
    const cats = await db(`SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id=c.id) AS product_count FROM categories c ORDER BY c.sort_order, c.name`);
    const subs = await db(`SELECT * FROM subcategories ORDER BY sort_order, name`);
    res.json({ success: true, categories: cats.map(c => ({ ...c, subcategories: subs.filter(s => s.category_id === c.id) })) });
  } catch (e) { next(e); }
});

app.post('/api/categories', requireAdmin, async (req, res, next) => {
  try {
    const { name, icon, description, sort_order, image_url } = req.body;
    if (!name) return res.status(422).json({ success: false, message: 'Category name required' });
    const slug = slugify(name);
    const cat = await dbOne(`INSERT INTO categories (name,slug,icon,description,sort_order,image_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [name, slug, icon || 'bi-grid', description || '', Number(sort_order) || 0, image_url || '']);
    res.status(201).json({ success: true, category: cat });
  } catch (e) { next(e); }
});

app.put('/api/categories/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, icon, description, sort_order, image_url, is_active } = req.body;
    const slug = name ? slugify(name) : undefined;
    const cat = await dbOne(`UPDATE categories SET name=COALESCE($1,name), slug=COALESCE($2,slug), icon=COALESCE($3,icon), description=COALESCE($4,description), sort_order=COALESCE($5,sort_order), image_url=COALESCE($6,image_url), is_active=COALESCE($7,is_active) WHERE id=$8 RETURNING *`, [name, slug, icon, description, sort_order !== undefined ? Number(sort_order) : undefined, image_url, is_active !== undefined ? Boolean(is_active) : undefined, req.params.id]);
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });
    res.json({ success: true, category: cat });
  } catch (e) { next(e); }
});

app.delete('/api/categories/:id', requireAdmin, async (req, res, next) => {
  try {
    await db(`DELETE FROM categories WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ─── SUBCATEGORIES ───────────────────────────────────────────────────────────────

app.get('/api/subcategories', async (req, res, next) => {
  try {
    const where = req.query.category_id ? 'WHERE category_id=$1' : '';
    const params = req.query.category_id ? [req.query.category_id] : [];
    const subs = await db(`SELECT * FROM subcategories ${where} ORDER BY sort_order, name`, params);
    res.json({ success: true, subcategories: subs });
  } catch (e) { next(e); }
});

app.post('/api/subcategories', requireAdmin, async (req, res, next) => {
  try {
    const { category_id, name, description, sort_order } = req.body;
    if (!category_id || !name) return res.status(422).json({ success: false, message: 'category_id and name required' });
    const slug = slugify(name);
    const sub = await dbOne(`INSERT INTO subcategories (category_id,name,slug,description,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [category_id, name, slug, description || '', Number(sort_order) || 0]);
    res.status(201).json({ success: true, subcategory: sub });
  } catch (e) { next(e); }
});

app.put('/api/subcategories/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, description, sort_order, is_active } = req.body;
    const sub = await dbOne(`UPDATE subcategories SET name=COALESCE($1,name), slug=COALESCE($2,slug), description=COALESCE($3,description), sort_order=COALESCE($4,sort_order), is_active=COALESCE($5,is_active) WHERE id=$6 RETURNING *`, [name, name ? slugify(name) : undefined, description, sort_order !== undefined ? Number(sort_order) : undefined, is_active !== undefined ? Boolean(is_active) : undefined, req.params.id]);
    res.json({ success: true, subcategory: sub });
  } catch (e) { next(e); }
});

app.delete('/api/subcategories/:id', requireAdmin, async (req, res, next) => {
  try {
    await db(`DELETE FROM subcategories WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ─── PRODUCTS ────────────────────────────────────────────────────────────────────

async function enrichProducts(rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [images, specs] = await Promise.all([
    db(`SELECT * FROM product_images WHERE product_id=ANY($1) ORDER BY sort_order,id`, [ids]),
    db(`SELECT * FROM product_specifications WHERE product_id=ANY($1) ORDER BY sort_order`, [ids])
  ]);
  return rows.map(p => ({
    ...p,
    images: images.filter(i => i.product_id === p.id),
    specs: specs.filter(s => s.product_id === p.id),
    primaryImage: images.find(i => i.product_id === p.id && i.is_primary)?.image_url || images.find(i => i.product_id === p.id)?.image_url || p.single_image
  }));
}

app.get('/api/products', async (req, res, next) => {
  try {
    const { category, subcategory, featured, new: isNew, search, sort = 'newest', page = 1, limit = 20, min_price, max_price, brand } = req.query;
    let where = ['p.is_active=TRUE'];
    const params = [];
    let pi = 1;
    if (category) { where.push(`(c.slug=$${pi++} OR c.id::text=$${pi-1})`); params.push(category); }
    if (subcategory) { where.push(`(s.slug=$${pi++} OR s.id::text=$${pi-1})`); params.push(subcategory); }
    if (featured === 'true') { where.push('p.is_featured=TRUE'); }
    if (isNew === 'true') { where.push('p.is_new=TRUE'); }
    if (brand) { where.push(`LOWER(p.brand) LIKE LOWER($${pi++})`); params.push(`%${brand}%`); }
    if (search) { where.push(`(p.name ILIKE $${pi} OR p.description ILIKE $${pi} OR p.brand ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    if (min_price) { where.push(`p.new_price >= $${pi++}`); params.push(Number(min_price)); }
    if (max_price) { where.push(`p.new_price <= $${pi++}`); params.push(Number(max_price)); }

    const orderMap = { newest: 'p.created_at DESC', oldest: 'p.created_at ASC', price_asc: 'p.new_price ASC', price_desc: 'p.new_price DESC', name_asc: 'p.name ASC', discount: 'p.discount DESC' };
    const orderBy = orderMap[sort] || 'p.created_at DESC';
    const offset = (Number(page) - 1) * Number(limit);

    const baseQ = `FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN subcategories s ON s.id=p.subcategory_id WHERE ${where.join(' AND ')}`;
    const [countRow, rows] = await Promise.all([
      dbOne(`SELECT COUNT(*) AS total ${baseQ}`, params),
      db(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, s.name AS subcategory_name ${baseQ} ORDER BY ${orderBy} LIMIT $${pi++} OFFSET $${pi++}`, [...params, Number(limit), offset])
    ]);

    const products = await enrichProducts(rows);
    res.json({ success: true, products, total: Number(countRow.total), page: Number(page), limit: Number(limit), pages: Math.ceil(Number(countRow.total) / Number(limit)) });
  } catch (e) { next(e); }
});

app.get('/api/products/:idOrSlug', async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const isId = /^\d+$/.test(idOrSlug);
    const row = await dbOne(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, s.name AS subcategory_name FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN subcategories s ON s.id=p.subcategory_id WHERE ${isId ? 'p.id=$1' : 'p.slug=$1'}`, [isId ? Number(idOrSlug) : idOrSlug]);
    if (!row) return res.status(404).json({ success: false, message: 'Product not found' });
    const [enriched] = await enrichProducts([row]);
    const reviews = await db(`SELECT r.*, u.name AS user_display_name FROM reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.product_id=$1 AND r.is_approved=TRUE ORDER BY r.created_at DESC`, [enriched.id]);
    const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
    res.json({ success: true, product: { ...enriched, reviews, avgRating: Math.round(avgRating * 10) / 10, reviewCount: reviews.length } });
  } catch (e) { next(e); }
});

app.post('/api/products', requireAdmin, async (req, res, next) => {
  try {
    const { name, category_id, subcategory_id, brand, description, short_description, old_price, new_price, stock, low_stock_threshold, single_image, tags, is_featured, is_new, sku, weight_kg } = req.body;
    if (!name) return res.status(422).json({ success: false, message: 'Product name required' });
    const slug = slugify(name) + '-' + Date.now().toString(36);
    const oldP = Number(old_price) || 0, newP = Number(new_price) || 0;
    const discount = oldP > newP && oldP > 0 ? Math.round(((oldP - newP) / oldP) * 100) : 0;
    const product = await dbOne(
      `INSERT INTO products (name,slug,sku,category_id,subcategory_id,brand,description,short_description,old_price,new_price,discount,stock,low_stock_threshold,single_image,tags,is_featured,is_new,weight_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [name, slug, sku || null, category_id || null, subcategory_id || null, brand || '', description || '', short_description || '', oldP, newP, discount, Number(stock) || 0, Number(low_stock_threshold) || 5, single_image || '', JSON.stringify(Array.isArray(tags) ? tags : []), Boolean(is_featured), Boolean(is_new), weight_kg || null]
    );
    res.status(201).json({ success: true, product });
  } catch (e) { next(e); }
});

app.put('/api/products/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, category_id, subcategory_id, brand, description, short_description, old_price, new_price, stock, low_stock_threshold, single_image, tags, is_featured, is_new, is_active, sku, weight_kg } = req.body;
    const existing = await dbOne('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Product not found' });
    const oldP = old_price !== undefined ? Number(old_price) : Number(existing.old_price);
    const newP = new_price !== undefined ? Number(new_price) : Number(existing.new_price);
    const discount = oldP > newP && oldP > 0 ? Math.round(((oldP - newP) / oldP) * 100) : 0;
    const product = await dbOne(
      `UPDATE products SET name=COALESCE($1,name), sku=COALESCE($2,sku), category_id=COALESCE($3,category_id), subcategory_id=COALESCE($4,subcategory_id), brand=COALESCE($5,brand), description=COALESCE($6,description), short_description=COALESCE($7,short_description), old_price=$8, new_price=$9, discount=$10, stock=COALESCE($11,stock), low_stock_threshold=COALESCE($12,low_stock_threshold), single_image=COALESCE($13,single_image), tags=COALESCE($14,tags), is_featured=COALESCE($15,is_featured), is_new=COALESCE($16,is_new), is_active=COALESCE($17,is_active), weight_kg=COALESCE($18,weight_kg), updated_at=NOW() WHERE id=$19 RETURNING *`,
      [name, sku, category_id || null, subcategory_id || null, brand, description, short_description, oldP, newP, discount, stock !== undefined ? Number(stock) : undefined, low_stock_threshold !== undefined ? Number(low_stock_threshold) : undefined, single_image, tags !== undefined ? JSON.stringify(Array.isArray(tags) ? tags : []) : undefined, is_featured !== undefined ? Boolean(is_featured) : undefined, is_new !== undefined ? Boolean(is_new) : undefined, is_active !== undefined ? Boolean(is_active) : undefined, weight_kg || null, req.params.id]
    );
    res.json({ success: true, product });
  } catch (e) { next(e); }
});

app.delete('/api/products/:id', requireAdmin, async (req, res, next) => {
  try {
    await db('UPDATE products SET is_active=FALSE, updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// Product images
app.post('/api/products/:id/images', requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(422).json({ success: false, message: 'Image file required' });
    const imageUrl = 'img/uploads/' + req.file.filename;
    const isPrimary = req.body.is_primary === 'true';
    if (isPrimary) await db('UPDATE product_images SET is_primary=FALSE WHERE product_id=$1', [req.params.id]);
    const img = await dbOne(`INSERT INTO product_images (product_id,image_url,alt_text,is_primary,sort_order) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order),0)+1 FROM product_images WHERE product_id=$1)) RETURNING *`, [req.params.id, imageUrl, req.body.alt_text || '', isPrimary]);
    if (isPrimary) await db('UPDATE products SET single_image=$1 WHERE id=$2', [imageUrl, req.params.id]);
    res.status(201).json({ success: true, image: img });
  } catch (e) { next(e); }
});

app.post('/api/products/:id/images/url', requireAdmin, async (req, res, next) => {
  try {
    const { image_url, alt_text, is_primary } = req.body;
    if (!image_url) return res.status(422).json({ success: false, message: 'image_url required' });
    const isPrimary = Boolean(is_primary);
    if (isPrimary) await db('UPDATE product_images SET is_primary=FALSE WHERE product_id=$1', [req.params.id]);
    const img = await dbOne(`INSERT INTO product_images (product_id,image_url,alt_text,is_primary,sort_order) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order),0)+1 FROM product_images WHERE product_id=$1)) RETURNING *`, [req.params.id, image_url, alt_text || '', isPrimary]);
    if (isPrimary) await db('UPDATE products SET single_image=$1 WHERE id=$2', [image_url, req.params.id]);
    res.status(201).json({ success: true, image: img });
  } catch (e) { next(e); }
});

app.delete('/api/products/:id/images/:imgId', requireAdmin, async (req, res, next) => {
  try {
    await db('DELETE FROM product_images WHERE id=$1 AND product_id=$2', [req.params.imgId, req.params.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// Product specs
app.post('/api/products/:id/specs', requireAdmin, async (req, res, next) => {
  try {
    const { spec_key, spec_value, sort_order } = req.body;
    if (!spec_key || !spec_value) return res.status(422).json({ success: false, message: 'spec_key and spec_value required' });
    const spec = await dbOne(`INSERT INTO product_specifications (product_id,spec_key,spec_value,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`, [req.params.id, spec_key, spec_value, Number(sort_order) || 0]);
    res.status(201).json({ success: true, spec });
  } catch (e) { next(e); }
});

app.put('/api/products/:id/specs/:specId', requireAdmin, async (req, res, next) => {
  try {
    const { spec_key, spec_value, sort_order } = req.body;
    const spec = await dbOne(`UPDATE product_specifications SET spec_key=COALESCE($1,spec_key), spec_value=COALESCE($2,spec_value), sort_order=COALESCE($3,sort_order) WHERE id=$4 AND product_id=$5 RETURNING *`, [spec_key, spec_value, sort_order !== undefined ? Number(sort_order) : undefined, req.params.specId, req.params.id]);
    res.json({ success: true, spec });
  } catch (e) { next(e); }
});

app.delete('/api/products/:id/specs/:specId', requireAdmin, async (req, res, next) => {
  try {
    await db('DELETE FROM product_specifications WHERE id=$1 AND product_id=$2', [req.params.specId, req.params.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// Replace all specs at once
app.put('/api/products/:id/specs', requireAdmin, async (req, res, next) => {
  try {
    const { specs } = req.body;
    await db('DELETE FROM product_specifications WHERE product_id=$1', [req.params.id]);
    if (Array.isArray(specs) && specs.length) {
      for (const [i, s] of specs.entries()) {
        await db('INSERT INTO product_specifications (product_id,spec_key,spec_value,sort_order) VALUES ($1,$2,$3,$4)', [req.params.id, s.key || s.spec_key, s.value || s.spec_value, i]);
      }
    }
    const result = await db('SELECT * FROM product_specifications WHERE product_id=$1 ORDER BY sort_order', [req.params.id]);
    res.json({ success: true, specs: result });
  } catch (e) { next(e); }
});

// ─── USER AUTH ───────────────────────────────────────────────────────────────────

app.post('/api/users/register', async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password || password.length < 6)
      return res.status(422).json({ success: false, message: 'Name, email and password (min 6 chars) required' });
    const existing = await dbOne('SELECT id FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    if (existing) return res.status(409).json({ success: false, message: 'Email already registered' });
    const pass = hashPassword(password);
    const user = await dbOne(`INSERT INTO users (name,email,phone,password_salt,password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,phone`, [name.trim(), email.trim().toLowerCase(), phone || '', pass.salt, pass.hash]);
    res.status(201).json({ success: true, token: createToken({ id: user.id, email: user.email, name: user.name }, USER_TOKEN_SECRET, 30 * 24 * 3600 * 1000), user });
  } catch (e) { next(e); }
});

app.post('/api/users/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await dbOne('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);
    if (!user || !verifyPassword(req.body.password || '', { salt: user.password_salt, hash: user.password_hash }))
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    res.json({ success: true, token: createToken({ id: user.id, email: user.email, name: user.name }, USER_TOKEN_SECRET, 30 * 24 * 3600 * 1000), user: { id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, city: user.city } });
  } catch (e) { next(e); }
});

app.get('/api/users/me', requireUser, async (req, res, next) => {
  try {
    const user = await dbOne('SELECT id,name,email,phone,address,city,created_at FROM users WHERE id=$1', [req.user.id]);
    res.json({ success: true, user });
  } catch (e) { next(e); }
});

app.put('/api/users/me', requireUser, async (req, res, next) => {
  try {
    const { name, phone, address, city, password, newPassword } = req.body;
    const existing = await dbOne('SELECT * FROM users WHERE id=$1', [req.user.id]);
    let salt = existing.password_salt, hash = existing.password_hash;
    if (newPassword) {
      if (!password || !verifyPassword(password, { salt, hash })) return res.status(401).json({ success: false, message: 'Current password incorrect' });
      const np = hashPassword(newPassword); salt = np.salt; hash = np.hash;
    }
    const user = await dbOne(`UPDATE users SET name=COALESCE($1,name), phone=COALESCE($2,phone), address=COALESCE($3,address), city=COALESCE($4,city), password_salt=$5, password_hash=$6, updated_at=NOW() WHERE id=$7 RETURNING id,name,email,phone,address,city`, [name, phone, address, city, salt, hash, req.user.id]);
    res.json({ success: true, user });
  } catch (e) { next(e); }
});

// Admin user management
app.get('/api/users', requireAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let where = ''; const params = [];
    if (search) { where = 'WHERE name ILIKE $1 OR email ILIKE $1'; params.push(`%${search}%`); }
    const [count, users] = await Promise.all([
      dbOne(`SELECT COUNT(*) AS total FROM users ${where}`, params),
      db(`SELECT id,name,email,phone,city,is_active,created_at FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, Number(limit), offset])
    ]);
    res.json({ success: true, users, total: Number(count.total) });
  } catch (e) { next(e); }
});

app.put('/api/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const { is_active } = req.body;
    const user = await dbOne(`UPDATE users SET is_active=COALESCE($1,is_active), updated_at=NOW() WHERE id=$2 RETURNING id,name,email,is_active`, [is_active !== undefined ? Boolean(is_active) : undefined, req.params.id]);
    res.json({ success: true, user });
  } catch (e) { next(e); }
});

// ─── ORDERS ──────────────────────────────────────────────────────────────────────

app.get('/api/orders', requireAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let where = []; const params = []; let pi = 1;
    if (status) { where.push(`o.status=$${pi++}`); params.push(status); }
    if (search) { where.push(`(o.order_number ILIKE $${pi} OR o.customer_name ILIKE $${pi} OR o.customer_phone ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    const wClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [count, orders] = await Promise.all([
      dbOne(`SELECT COUNT(*) AS total FROM orders o ${wClause}`, params),
      db(`SELECT o.* FROM orders o ${wClause} ORDER BY o.created_at DESC LIMIT $${pi++} OFFSET $${pi}`, [...params, Number(limit), offset])
    ]);
    res.json({ success: true, orders, total: Number(count.total) });
  } catch (e) { next(e); }
});

app.get('/api/orders/my', requireUser, async (req, res, next) => {
  try {
    const orders = await db(`SELECT o.*, json_agg(json_build_object('id',oi.id,'product_name',oi.product_name,'quantity',oi.quantity,'unit_price',oi.unit_price,'line_total',oi.line_total,'product_image',oi.product_image)) AS items FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC`, [req.user.id]);
    res.json({ success: true, orders });
  } catch (e) { next(e); }
});

app.get('/api/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const order = await dbOne('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const items = await db('SELECT * FROM order_items WHERE order_id=$1', [order.id]);
    res.json({ success: true, order: { ...order, items } });
  } catch (e) { next(e); }
});

app.post('/api/orders', optionalUser, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settings = await dbOne(`SELECT setting_value FROM settings WHERE setting_key='store'`);
    const cfg = settings?.setting_value || {};
    const taxRate = Number(cfg.taxRate || 17) / 100;
    const freeShipMin = Number(cfg.freeShippingMin || 10000);
    const shipFee = Number(cfg.localShippingFee || 250);

    const { customer, items, paymentMethod, coupon_code, notes } = req.body;
    if (!customer?.name || !customer?.phone || !customer?.address) return res.status(422).json({ success: false, message: 'Customer name, phone and address required' });
    if (!items?.length) return res.status(422).json({ success: false, message: 'Order must have items' });

    let subtotal = 0, couponDiscount = 0, couponId = null;
    const orderItems = [];
    for (const item of items) {
      const product = await client.query('SELECT * FROM products WHERE id=$1 AND is_active=TRUE', [item.id]);
      if (!product.rows[0]) throw new Error(`Product not found: ${item.id}`);
      const qty = Number(item.quantity) || 1;
      const price = Number(product.rows[0].new_price);
      const lineTotal = price * qty;
      subtotal += lineTotal;
      orderItems.push({ product: product.rows[0], qty, price, lineTotal });
    }

    if (coupon_code) {
      const coupon = await client.query(`SELECT * FROM coupons WHERE code=UPPER($1) AND is_active=TRUE AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR uses_count < max_uses)`, [coupon_code]);
      if (coupon.rows[0] && subtotal >= Number(coupon.rows[0].min_order_amount)) {
        const c = coupon.rows[0];
        couponId = c.id;
        couponDiscount = c.discount_type === 'percentage' ? Math.round(subtotal * Number(c.discount_value) / 100) : Math.min(Number(c.discount_value), subtotal);
        await client.query('UPDATE coupons SET uses_count=uses_count+1 WHERE id=$1', [c.id]);
      }
    }

    const shipping = subtotal - couponDiscount >= freeShipMin ? 0 : shipFee;
    const tax = Math.round((subtotal - couponDiscount) * taxRate);
    const total = subtotal - couponDiscount + shipping + tax;
    const orderNumber = `DK-${Date.now()}`;

    const orderResult = await client.query(
      `INSERT INTO orders (order_number,user_id,customer_name,customer_email,customer_phone,customer_address,customer_city,payment_method,coupon_id,coupon_discount,subtotal,shipping,tax,total,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [orderNumber, req.user?.id || null, customer.name, customer.email || '', customer.phone, customer.address, customer.city || '', paymentMethod || 'cod', couponId, couponDiscount, subtotal, shipping, tax, total, notes || '']
    );
    const orderId = orderResult.rows[0].id;

    for (const oi of orderItems) {
      await client.query(`INSERT INTO order_items (order_id,product_id,product_name,product_image,quantity,unit_price,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [orderId, oi.product.id, oi.product.name, oi.product.single_image, oi.qty, oi.price, oi.lineTotal]);
      await client.query('UPDATE products SET stock=stock-$1 WHERE id=$2 AND stock >= $1', [oi.qty, oi.product.id]);
    }
    await client.query('COMMIT');

    if (req.user?.id) {
      const userCart = await dbOne('SELECT id FROM cart WHERE user_id=$1', [req.user.id]);
      if (userCart) await db('DELETE FROM cart_items WHERE cart_id=$1', [userCart.id]);
    }

    res.status(201).json({ success: true, order: { id: orderId, orderNumber, total, subtotal, couponDiscount, shipping, tax, paymentMethod: paymentMethod || 'cod', status: 'pending' } });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

app.put('/api/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const order = await dbOne(`UPDATE orders SET status=COALESCE($1,status), notes=COALESCE($2,notes), updated_at=NOW() WHERE id=$3 RETURNING *`, [status, notes, req.params.id]);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order });
  } catch (e) { next(e); }
});

// ─── CART ────────────────────────────────────────────────────────────────────────

async function getOrCreateCart(userId, sessionId) {
  if (userId) {
    let cart = await dbOne('SELECT * FROM cart WHERE user_id=$1', [userId]);
    if (!cart) cart = await dbOne('INSERT INTO cart (user_id) VALUES ($1) RETURNING *', [userId]);
    return cart;
  }
  if (sessionId) {
    let cart = await dbOne('SELECT * FROM cart WHERE session_id=$1', [sessionId]);
    if (!cart) cart = await dbOne('INSERT INTO cart (session_id) VALUES ($1) RETURNING *', [sessionId]);
    return cart;
  }
  return null;
}

async function getCartDetails(cartId) {
  const items = await db(`SELECT ci.*, p.name, p.slug, p.new_price, p.old_price, p.discount, p.stock, p.single_image, (SELECT image_url FROM product_images WHERE product_id=p.id AND is_primary=TRUE LIMIT 1) AS primary_image FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=$1`, [cartId]);
  return items;
}

app.get('/api/cart', optionalUser, async (req, res, next) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.session_id;
    const cart = await getOrCreateCart(req.user?.id, sessionId);
    if (!cart) return res.json({ success: true, items: [], cartId: null });
    const items = await getCartDetails(cart.id);
    res.json({ success: true, items, cartId: cart.id });
  } catch (e) { next(e); }
});

app.post('/api/cart/items', optionalUser, async (req, res, next) => {
  try {
    const { product_id, quantity = 1 } = req.body;
    const sessionId = req.headers['x-session-id'] || req.body.session_id;
    if (!product_id) return res.status(422).json({ success: false, message: 'product_id required' });
    const product = await dbOne('SELECT * FROM products WHERE id=$1 AND is_active=TRUE', [product_id]);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const cart = await getOrCreateCart(req.user?.id, sessionId);
    const existing = await dbOne('SELECT * FROM cart_items WHERE cart_id=$1 AND product_id=$2', [cart.id, product_id]);
    if (existing) {
      const newQty = Math.min(existing.quantity + Number(quantity), product.stock, 10);
      await db('UPDATE cart_items SET quantity=$1 WHERE id=$2', [newQty, existing.id]);
    } else {
      await db('INSERT INTO cart_items (cart_id,product_id,quantity) VALUES ($1,$2,$3)', [cart.id, product_id, Math.min(Number(quantity), product.stock, 10)]);
    }
    const items = await getCartDetails(cart.id);
    res.json({ success: true, items, cartId: cart.id });
  } catch (e) { next(e); }
});

app.put('/api/cart/items/:itemId', optionalUser, async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const sessionId = req.headers['x-session-id'] || req.body.session_id;
    const cart = await getOrCreateCart(req.user?.id, sessionId);
    if (Number(quantity) <= 0) {
      await db('DELETE FROM cart_items WHERE id=$1 AND cart_id=$2', [req.params.itemId, cart.id]);
    } else {
      await db('UPDATE cart_items SET quantity=$1 WHERE id=$2 AND cart_id=$3', [Math.min(Number(quantity), 10), req.params.itemId, cart.id]);
    }
    const items = await getCartDetails(cart.id);
    res.json({ success: true, items });
  } catch (e) { next(e); }
});

app.delete('/api/cart/items/:itemId', optionalUser, async (req, res, next) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.session_id;
    const cart = await getOrCreateCart(req.user?.id, sessionId);
    await db('DELETE FROM cart_items WHERE id=$1 AND cart_id=$2', [req.params.itemId, cart.id]);
    const items = await getCartDetails(cart.id);
    res.json({ success: true, items });
  } catch (e) { next(e); }
});

app.delete('/api/cart', optionalUser, async (req, res, next) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.session_id;
    const cart = await getOrCreateCart(req.user?.id, sessionId);
    if (cart) await db('DELETE FROM cart_items WHERE cart_id=$1', [cart.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ─── WISHLIST ─────────────────────────────────────────────────────────────────────

app.get('/api/wishlist', optionalUser, async (req, res, next) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.session_id;
    const where = req.user?.id ? 'w.user_id=$1' : 'w.session_id=$1';
    const param = req.user?.id || sessionId;
    if (!param) return res.json({ success: true, items: [] });
    const items = await db(`SELECT w.id, w.product_id, w.added_at, p.name, p.slug, p.new_price, p.old_price, p.discount, p.stock, p.single_image, (SELECT image_url FROM product_images WHERE product_id=p.id AND is_primary=TRUE LIMIT 1) AS primary_image FROM wishlist w JOIN products p ON p.id=w.product_id WHERE ${where}`, [param]);
    res.json({ success: true, items });
  } catch (e) { next(e); }
});

app.post('/api/wishlist', optionalUser, async (req, res, next) => {
  try {
    const { product_id } = req.body;
    const sessionId = req.headers['x-session-id'] || req.body.session_id;
    if (!product_id) return res.status(422).json({ success: false, message: 'product_id required' });
    if (req.user?.id) {
      await db(`INSERT INTO wishlist (user_id,product_id) VALUES ($1,$2) ON CONFLICT (user_id,product_id) DO NOTHING`, [req.user.id, product_id]);
    } else if (sessionId) {
      const exists = await dbOne('SELECT id FROM wishlist WHERE session_id=$1 AND product_id=$2', [sessionId, product_id]);
      if (!exists) await db('INSERT INTO wishlist (session_id,product_id) VALUES ($1,$2)', [sessionId, product_id]);
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

app.delete('/api/wishlist/:productId', optionalUser, async (req, res, next) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.session_id;
    if (req.user?.id) {
      await db('DELETE FROM wishlist WHERE user_id=$1 AND product_id=$2', [req.user.id, req.params.productId]);
    } else if (sessionId) {
      await db('DELETE FROM wishlist WHERE session_id=$1 AND product_id=$2', [sessionId, req.params.productId]);
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ─── COUPONS ──────────────────────────────────────────────────────────────────────

app.post('/api/coupons/apply', async (req, res, next) => {
  try {
    const { code, order_amount } = req.body;
    if (!code) return res.status(422).json({ success: false, message: 'Coupon code required' });
    const coupon = await dbOne(`SELECT * FROM coupons WHERE UPPER(code)=UPPER($1) AND is_active=TRUE AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR uses_count < max_uses)`, [code]);
    if (!coupon) return res.status(404).json({ success: false, message: 'Invalid or expired coupon code' });
    const amount = Number(order_amount) || 0;
    if (amount < Number(coupon.min_order_amount)) return res.status(422).json({ success: false, message: `Minimum order amount Rs.${coupon.min_order_amount.toLocaleString()} required` });
    const discount = coupon.discount_type === 'percentage' ? Math.round(amount * Number(coupon.discount_value) / 100) : Math.min(Number(coupon.discount_value), amount);
    res.json({ success: true, coupon: { id: coupon.id, code: coupon.code, description: coupon.description, discount_type: coupon.discount_type, discount_value: coupon.discount_value }, discount });
  } catch (e) { next(e); }
});

app.get('/api/coupons', requireAdmin, async (req, res, next) => {
  try {
    const coupons = await db('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json({ success: true, coupons });
  } catch (e) { next(e); }
});

app.post('/api/coupons', requireAdmin, async (req, res, next) => {
  try {
    const { code, description, discount_type, discount_value, min_order_amount, max_uses, expires_at } = req.body;
    if (!code || !discount_value) return res.status(422).json({ success: false, message: 'Code and discount_value required' });
    const coupon = await dbOne(`INSERT INTO coupons (code,description,discount_type,discount_value,min_order_amount,max_uses,expires_at) VALUES (UPPER($1),$2,$3,$4,$5,$6,$7) RETURNING *`, [code, description || '', discount_type || 'percentage', Number(discount_value), Number(min_order_amount) || 0, max_uses ? Number(max_uses) : null, expires_at || null]);
    res.status(201).json({ success: true, coupon });
  } catch (e) { next(e); }
});

app.put('/api/coupons/:id', requireAdmin, async (req, res, next) => {
  try {
    const { code, description, discount_type, discount_value, min_order_amount, max_uses, is_active, expires_at } = req.body;
    const coupon = await dbOne(`UPDATE coupons SET code=COALESCE($1,code), description=COALESCE($2,description), discount_type=COALESCE($3,discount_type), discount_value=COALESCE($4,discount_value), min_order_amount=COALESCE($5,min_order_amount), max_uses=COALESCE($6,max_uses), is_active=COALESCE($7,is_active), expires_at=COALESCE($8,expires_at) WHERE id=$9 RETURNING *`, [code ? code.toUpperCase() : undefined, description, discount_type, discount_value ? Number(discount_value) : undefined, min_order_amount ? Number(min_order_amount) : undefined, max_uses !== undefined ? (max_uses ? Number(max_uses) : null) : undefined, is_active !== undefined ? Boolean(is_active) : undefined, expires_at !== undefined ? (expires_at || null) : undefined, req.params.id]);
    res.json({ success: true, coupon });
  } catch (e) { next(e); }
});

app.delete('/api/coupons/:id', requireAdmin, async (req, res, next) => {
  try {
    await db('DELETE FROM coupons WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ─── REVIEWS ──────────────────────────────────────────────────────────────────────

app.get('/api/reviews', requireAdmin, async (req, res, next) => {
  try {
    const { approved } = req.query;
    let where = '';
    if (approved === 'true') where = 'WHERE r.is_approved=TRUE';
    if (approved === 'false') where = 'WHERE r.is_approved=FALSE';
    const reviews = await db(`SELECT r.*, p.name AS product_name FROM reviews r LEFT JOIN products p ON p.id=r.product_id ${where} ORDER BY r.created_at DESC`);
    res.json({ success: true, reviews });
  } catch (e) { next(e); }
});

app.get('/api/reviews/:productId', async (req, res, next) => {
  try {
    const reviews = await db(`SELECT r.id,r.reviewer_name,r.rating,r.title,r.body,r.created_at FROM reviews r WHERE r.product_id=$1 AND r.is_approved=TRUE ORDER BY r.created_at DESC`, [req.params.productId]);
    const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
    res.json({ success: true, reviews, avgRating: Math.round(avg * 10) / 10, total: reviews.length });
  } catch (e) { next(e); }
});

app.post('/api/reviews/:productId', optionalUser, async (req, res, next) => {
  try {
    const { reviewer_name, rating, title, body } = req.body;
    if (!reviewer_name || !rating) return res.status(422).json({ success: false, message: 'Name and rating required' });
    const review = await dbOne(`INSERT INTO reviews (product_id,user_id,reviewer_name,rating,title,body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,reviewer_name,rating,title,body,created_at`, [req.params.productId, req.user?.id || null, reviewer_name, Number(rating), title || '', body || '']);
    res.status(201).json({ success: true, review, message: 'Review submitted for approval' });
  } catch (e) { next(e); }
});

app.put('/api/reviews/:id', requireAdmin, async (req, res, next) => {
  try {
    const { is_approved } = req.body;
    const review = await dbOne('UPDATE reviews SET is_approved=$1 WHERE id=$2 RETURNING *', [Boolean(is_approved), req.params.id]);
    res.json({ success: true, review });
  } catch (e) { next(e); }
});

app.delete('/api/reviews/:id', requireAdmin, async (req, res, next) => {
  try {
    await db('DELETE FROM reviews WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ─── SETTINGS ────────────────────────────────────────────────────────────────────

app.get('/api/settings', async (req, res, next) => {
  try {
    const rows = await db('SELECT * FROM settings');
    const settings = {};
    rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    res.json({ success: true, settings });
  } catch (e) { next(e); }
});

app.put('/api/settings/:key', requireAdmin, async (req, res, next) => {
  try {
    const { key } = req.params;
    await db(`INSERT INTO settings (setting_key,setting_value) VALUES ($1,$2) ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=NOW()`, [key, JSON.stringify(req.body)]);
    res.json({ success: true, setting: { key, value: req.body } });
  } catch (e) { next(e); }
});

// ─── FILE UPLOAD ──────────────────────────────────────────────────────────────────

app.post('/api/upload', requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(422).json({ success: false, message: 'Image file required' });
    res.status(201).json({ success: true, url: 'img/uploads/' + req.file.filename, filename: req.file.filename });
  } catch (e) { next(e); }
});

app.post('/api/upload/multiple', requireAdmin, upload.array('images', 10), async (req, res, next) => {
  try {
    const files = req.files?.map(f => ({ url: 'img/uploads/' + f.filename, filename: f.filename })) || [];
    res.status(201).json({ success: true, files });
  } catch (e) { next(e); }
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Server error' });
});

// ─── START ───────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => console.log(`DK Gaming Zone running on port ${PORT}`));
pool.query('SELECT 1').then(() => console.log('PostgreSQL connected')).catch(e => console.error('DB Error:', e.message));
