/* ════════════════════════════════════════════
   DK Gaming Zone — API Client
════════════════════════════════════════════ */

const API_BASE = '/api';
const SESSION_KEY = 'dk_session';
const USER_TOKEN_KEY = 'dk_user_token';
const ADMIN_TOKEN_KEY = 'dk_admin_token';

// ── Session ID (for guests) ─────────────────
function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) { id = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem(SESSION_KEY, id); }
  return id;
}

// ── Auth helpers ────────────────────────────
function getUserToken() { return localStorage.getItem(USER_TOKEN_KEY); }
function getAdminToken() { return localStorage.getItem(ADMIN_TOKEN_KEY); }
function setUserToken(t) { t ? localStorage.setItem(USER_TOKEN_KEY, t) : localStorage.removeItem(USER_TOKEN_KEY); }
function setAdminToken(t) { t ? localStorage.setItem(ADMIN_TOKEN_KEY, t) : localStorage.removeItem(ADMIN_TOKEN_KEY); }

function getUser() {
  const t = getUserToken();
  if (!t) return null;
  try { const p = JSON.parse(atob(t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'))); return Date.now() > p.exp ? null : p; } catch { return null; }
}

// ── Core fetch wrapper ──────────────────────
async function apiRequest(method, path, body = null, isAdmin = false) {
  const token = isAdmin ? getAdminToken() : getUserToken();
  const headers = { 'Content-Type': 'application/json', 'x-session-id': getSessionId() };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  const data = await res.json().catch(() => ({ success: false, message: 'Parse error' }));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

const api = {
  get:    (p, admin) => apiRequest('GET', p, null, admin),
  post:   (p, b, admin) => apiRequest('POST', p, b, admin),
  put:    (p, b, admin) => apiRequest('PUT', p, b, admin),
  delete: (p, admin) => apiRequest('DELETE', p, null, admin),
  patch:  (p, b, admin) => apiRequest('PATCH', p, b, admin),
};

// Upload with form data
async function apiUpload(path, formData, isAdmin = true) {
  const token = isAdmin ? getAdminToken() : getUserToken();
  const headers = { 'x-session-id': getSessionId() };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API_BASE + path, { method: 'POST', headers, body: formData });
  const data = await res.json().catch(() => ({ success: false, message: 'Upload error' }));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

// ── Toast notifications ─────────────────────
function showToast(type, title, message, duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', info: 'bi-info-circle-fill', warn: 'bi-exclamation-triangle-fill' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="bi ${icons[type] || icons.info} toast-icon"></i><div class="toast-body"><div class="toast-title">${title}</div>${message ? `<div class="toast-msg">${message}</div>` : ''}</div><button class="toast-close" onclick="this.closest('.toast').remove()">×</button>`;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }, duration);
}

// ── Cart count badge ────────────────────────
function updateCartBadge(count) {
  document.querySelectorAll('.cart-count').forEach(el => {
    el.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

function updateWishlistBadge(count) {
  document.querySelectorAll('.wishlist-count').forEach(el => {
    el.textContent = count > 0 ? count : '';
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

// ── Init header user ────────────────────────
async function initHeader() {
  const user = getUser();
  const loginBtn = document.getElementById('headerLoginBtn');
  const userBtn = document.getElementById('headerUserBtn');
  if (user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (userBtn) { userBtn.style.display = 'flex'; userBtn.title = user.name; const lbl = userBtn.querySelector('.action-label'); if (lbl) lbl.textContent = user.name.split(' ')[0]; }
  } else {
    if (loginBtn) loginBtn.style.display = 'flex';
    if (userBtn) userBtn.style.display = 'none';
  }
  // Load cart count
  try {
    const data = await api.get('/cart');
    const count = data.items?.reduce((s, i) => s + i.quantity, 0) || 0;
    updateCartBadge(count);
  } catch {}
  // Load wishlist count
  try {
    const data = await api.get('/wishlist');
    updateWishlistBadge(data.items?.length || 0);
  } catch {}
}

// ── Format price ────────────────────────────
function formatPrice(n) {
  return 'Rs. ' + Number(n).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

// ── Star HTML ───────────────────────────────
function starsHTML(rating, max = 5) {
  let html = '';
  for (let i = 1; i <= max; i++) {
    if (i <= Math.floor(rating)) html += '<i class="bi bi-star-fill"></i>';
    else if (i - 0.5 <= rating) html += '<i class="bi bi-star-half"></i>';
    else html += '<i class="bi bi-star"></i>';
  }
  return html;
}

// ── Product card HTML ───────────────────────
function productCardHTML(p) {
  const img = p.primaryImage || p.single_image || 'img/no-image.png';
  const hasDiscount = p.discount > 0;
  const inStock = p.stock > 0;
  return `
  <div class="product-card" data-id="${p.id}">
    <div class="product-img-wrap">
      <a href="product.html?id=${p.id}">
        <img src="${img}" alt="${p.name}" loading="lazy" onerror="this.src='img/no-image.png'">
      </a>
      <div class="product-badges">
        ${p.is_new ? '<span class="product-badge badge-new">New</span>' : ''}
        ${hasDiscount ? `<span class="product-badge badge-sale">${p.discount}% OFF</span>` : ''}
        ${p.stock <= p.low_stock_threshold && p.stock > 0 ? '<span class="product-badge badge-hot">Low Stock</span>' : ''}
      </div>
      <div class="product-actions">
        <button class="product-action-btn wishlist-toggle-btn" data-id="${p.id}" title="Add to Wishlist"><i class="bi bi-heart"></i></button>
        <a href="product.html?id=${p.id}" class="product-action-btn" title="Quick View"><i class="bi bi-eye"></i></a>
      </div>
    </div>
    <div class="product-body">
      ${p.brand ? `<div class="product-brand">${p.brand}</div>` : ''}
      <a href="product.html?id=${p.id}" class="product-name">${p.name}</a>
      <div class="product-rating">
        <div class="stars">${starsHTML(p.avgRating || 4.2)}</div>
        <span class="rating-count">(${p.reviewCount || 0})</span>
      </div>
      <div class="product-price">
        <span class="price-new">${formatPrice(p.new_price)}</span>
        ${hasDiscount ? `<span class="price-old">${formatPrice(p.old_price)}</span>` : ''}
        ${hasDiscount ? `<span class="price-discount">-${p.discount}%</span>` : ''}
      </div>
      <div class="product-stock ${inStock ? (p.stock <= p.low_stock_threshold ? 'stock-low' : 'stock-in') : 'stock-out'}">
        ${inStock ? (p.stock <= p.low_stock_threshold ? `Only ${p.stock} left!` : 'In Stock') : 'Out of Stock'}
      </div>
      <div class="product-footer">
        <button class="btn-add-cart ${!inStock ? 'disabled' : ''}" data-id="${p.id}" ${!inStock ? 'disabled' : ''}>
          <i class="bi bi-cart-plus"></i> ${inStock ? 'Add to Cart' : 'Out of Stock'}
        </button>
      </div>
    </div>
  </div>`;
}

// ── Cart operations ─────────────────────────
async function addToCart(productId, quantity = 1) {
  try {
    const data = await api.post('/cart/items', { product_id: productId, quantity });
    const count = data.items?.reduce((s, i) => s + i.quantity, 0) || 0;
    updateCartBadge(count);
    showToast('success', 'Added to Cart', 'Item added to your cart');
    return data;
  } catch (e) { showToast('error', 'Error', e.message); throw e; }
}

// ── Wishlist operations ──────────────────────
async function toggleWishlist(productId) {
  try {
    const list = await api.get('/wishlist');
    const inList = list.items?.some(i => i.product_id === Number(productId));
    if (inList) {
      await api.delete(`/wishlist/${productId}`);
      showToast('info', 'Removed from Wishlist', '');
    } else {
      await api.post('/wishlist', { product_id: productId });
      showToast('success', 'Added to Wishlist', '');
    }
    const updated = await api.get('/wishlist');
    updateWishlistBadge(updated.items?.length || 0);
    return !inList;
  } catch (e) { showToast('error', 'Error', e.message); }
}

// ── Bind product card events ─────────────────
function bindProductCards(container = document) {
  container.querySelectorAll('.btn-add-cart').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = btn.dataset.id;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try { await addToCart(id); btn.innerHTML = '<i class="bi bi-check-lg"></i> Added!'; btn.classList.add('added'); setTimeout(() => { btn.innerHTML = '<i class="bi bi-cart-plus"></i> Add to Cart'; btn.classList.remove('added'); btn.disabled = false; }, 1500); }
      catch { btn.innerHTML = '<i class="bi bi-cart-plus"></i> Add to Cart'; btn.disabled = false; }
    });
  });
  container.querySelectorAll('.wishlist-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const added = await toggleWishlist(btn.dataset.id);
      const icon = btn.querySelector('i');
      if (added) { icon.className = 'bi bi-heart-fill'; btn.classList.add('wishlisted'); }
      else { icon.className = 'bi bi-heart'; btn.classList.remove('wishlisted'); }
    });
  });
}

// ── Back to top ──────────────────────────────
function initBackToTop() {
  let btn = document.createElement('button');
  btn.className = 'back-to-top'; btn.innerHTML = '<i class="bi bi-arrow-up"></i>'; btn.title = 'Back to Top';
  document.body.appendChild(btn);
  window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 400));
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// Auto-init
document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initBackToTop();
  // Hero slider
  const slides = document.querySelectorAll('.hero-slide');
  if (slides.length > 1) {
    let cur = 0;
    const go = n => { slides[cur].classList.remove('active'); cur = (n + slides.length) % slides.length; slides[cur].classList.add('active'); document.querySelectorAll('.hero-dot').forEach((d,i) => d.classList.toggle('active', i === cur)); };
    const dots = document.querySelectorAll('.hero-dot');
    dots.forEach((d,i) => d.addEventListener('click', () => go(i)));
    document.querySelector('.hero-prev')?.addEventListener('click', () => go(cur - 1));
    document.querySelector('.hero-next')?.addEventListener('click', () => go(cur + 1));
    const timer = setInterval(() => go(cur + 1), 5000);
    slides[0].classList.add('active');
  } else if (slides.length === 1) slides[0].classList.add('active');
});

window.api = api; window.apiUpload = apiUpload; window.showToast = showToast;
window.formatPrice = formatPrice; window.starsHTML = starsHTML;
window.productCardHTML = productCardHTML; window.addToCart = addToCart;
window.toggleWishlist = toggleWishlist; window.bindProductCards = bindProductCards;
window.getUserToken = getUserToken; window.getAdminToken = getAdminToken;
window.setUserToken = setUserToken; window.setAdminToken = setAdminToken;
window.getUser = getUser; window.getSessionId = getSessionId;
window.updateCartBadge = updateCartBadge; window.updateWishlistBadge = updateWishlistBadge;
