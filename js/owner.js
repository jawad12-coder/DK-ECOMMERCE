const tokenKey = 'dk_owner_token';
let ownerProducts = [];

const auth = {
  setupForm: document.getElementById('setupForm'),
  loginForm: document.getElementById('loginForm'),
  recoverForm: document.getElementById('recoverForm'),
  message: document.getElementById('authMessage'),
  question: document.getElementById('recoveryQuestionText')
};

function token() {
  return localStorage.getItem(tokenKey);
}

function setMessage(element, message, error = false) {
  element.textContent = message || '';
  element.style.color = error ? '#ff6b6b' : '#42f58d';
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  const body = options.body;

  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token()) {
    headers.Authorization = `Bearer ${token()}`;
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }

  return data;
}

function formJson(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function showAuth(mode, status = {}) {
  auth.setupForm.classList.toggle('hidden', mode !== 'setup');
  auth.loginForm.classList.toggle('hidden', mode !== 'login');
  auth.recoverForm.classList.toggle('hidden', mode !== 'recover');
  auth.question.textContent = status.recoveryQuestion ? `Question: ${status.recoveryQuestion}` : '';
}

function showDashboard(show) {
  document.getElementById('ownerAuth').classList.toggle('hidden', show);
  document.getElementById('ownerDashboard').classList.toggle('hidden', !show);
}

function money(value) {
  return `PKR ${Number(value || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}

function fillProductForm(product = {}) {
  const form = document.getElementById('productForm');
  form.elements.id.value = product.id || '';
  form.elements.name.value = product.name || '';
  form.elements.category.value = product.category || '';
  form.elements.oldPrice.value = product.price?.oldPrice || '';
  form.elements.newPrice.value = product.price?.newPrice || '';
  form.elements.description.value = product.description || '';
  form.elements.tags.value = (product.tags || []).join(', ');
  form.elements.specs.value = (product.specs || []).join('\n');
  form.elements.singleImage.value = product.img?.singleImage || '';
  form.elements.thumbs.value = (product.img?.thumbs || []).join('\n');
  window.scrollTo({ top: document.getElementById('products').offsetTop - 12, behavior: 'smooth' });
}

function productPayload(form) {
  const data = formJson(form);
  return {
    id: data.id,
    name: data.name,
    category: data.category,
    oldPrice: Number(data.oldPrice || data.newPrice || 0),
    newPrice: Number(data.newPrice || 0),
    description: data.description,
    tags: data.tags,
    specs: data.specs,
    singleImage: data.singleImage,
    thumbs: data.thumbs
  };
}

function renderProducts() {
  const list = document.getElementById('ownerProducts');
  list.innerHTML = ownerProducts.map((product) => `
    <article class="owner-product-row">
      <img src="${product.img?.singleImage || 'img/products/product1/1.png'}" alt="${product.name}">
      <div>
        <strong>${product.name}</strong>
        <span>${product.category || 'DK product'} - ${money(product.price?.newPrice)}</span>
        <span>${product.description || ''}</span>
      </div>
      <div class="owner-row-actions">
        <button class="btn btn-sm btn-primary edit-product" data-id="${product.id}">Edit</button>
        <button class="btn btn-sm btn-black delete-product" data-id="${product.id}">Delete</button>
      </div>
    </article>
  `).join('');

  list.querySelectorAll('.edit-product').forEach((button) => {
    button.addEventListener('click', () => {
      const product = ownerProducts.find((item) => item.id === Number(button.dataset.id));
      fillProductForm(product);
    });
  });

  list.querySelectorAll('.delete-product').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this product?')) return;
      await api(`/api/products/${button.dataset.id}`, { method: 'DELETE' });
      await loadProducts();
    });
  });
}

async function loadProducts() {
  const data = await api('/api/products');
  ownerProducts = data.products || [];
  renderProducts();
}

async function loadSettings() {
  const data = await api('/api/settings');
  const settings = data.settings;
  const form = document.getElementById('settingsForm');
  form.elements.taxRate.value = settings.taxRate || 0;
  form.elements.freeShippingMin.value = settings.freeShippingMin || 0;
  form.elements.localShippingFee.value = settings.localShippingFee || 0;
  form.elements.storePhone.value = settings.storePhone || '';
  form.elements.storeLocation.value = settings.storeLocation || '';
  form.elements.cod.checked = Boolean(settings.paymentMethods?.cod);
  form.elements.easypaisa.checked = Boolean(settings.paymentMethods?.easypaisa);
  form.elements.jazzcash.checked = Boolean(settings.paymentMethods?.jazzcash);
  form.elements.bankTransfer.checked = Boolean(settings.paymentMethods?.bankTransfer);
}

async function loadOrders() {
  const list = document.getElementById('ownerOrders');
  try {
    const data = await api('/api/orders');
    list.innerHTML = data.orders.length
      ? data.orders.map((order) => `
        <article class="owner-product-row">
          <div>
            <strong>${order.orderNumber}</strong>
            <span>${new Date(order.createdAt).toLocaleString()} - ${order.paymentMethod}</span>
            <span>${order.customer?.name || 'Customer'} - ${order.customer?.phone || ''}</span>
          </div>
          <div><strong>${money(order.total)}</strong><span>${order.status}</span></div>
        </article>
      `).join('')
      : '<p>No orders yet.</p>';
  } catch (error) {
    list.innerHTML = `<p>${error.message}</p>`;
  }
}

async function initDashboard() {
  showDashboard(true);
  await Promise.all([loadProducts(), loadSettings(), loadOrders()]);
}

async function init() {
  const status = await api('/api/owner/status');
  if (status.setupRequired) {
    showAuth('setup', status);
  } else if (token()) {
    try {
      await initDashboard();
    } catch {
      localStorage.removeItem(tokenKey);
      showAuth('login', status);
    }
  } else {
    showAuth('login', status);
  }
}

auth.setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/owner/setup', {
      method: 'POST',
      body: JSON.stringify(formJson(auth.setupForm))
    });
    localStorage.setItem(tokenKey, data.token);
    await initDashboard();
  } catch (error) {
    setMessage(auth.message, error.message, true);
  }
});

auth.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/owner/login', {
      method: 'POST',
      body: JSON.stringify(formJson(auth.loginForm))
    });
    localStorage.setItem(tokenKey, data.token);
    await initDashboard();
  } catch (error) {
    setMessage(auth.message, error.message, true);
  }
});

auth.recoverForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/owner/recover', {
      method: 'POST',
      body: JSON.stringify(formJson(auth.recoverForm))
    });
    localStorage.setItem(tokenKey, data.token);
    await initDashboard();
  } catch (error) {
    setMessage(auth.message, error.message, true);
  }
});

document.getElementById('showRecover').addEventListener('click', async () => {
  const status = await api('/api/owner/status');
  showAuth('recover', status);
});

document.getElementById('showLogin').addEventListener('click', async () => {
  const status = await api('/api/owner/status');
  showAuth('login', status);
});

document.getElementById('logoutOwner').addEventListener('click', async () => {
  localStorage.removeItem(tokenKey);
  const status = await api('/api/owner/status');
  showDashboard(false);
  showAuth('login', status);
});

document.getElementById('newProduct').addEventListener('click', () => fillProductForm({}));
document.getElementById('resetProduct').addEventListener('click', () => fillProductForm({}));

document.getElementById('productForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.id.value;
  const message = document.getElementById('productMessage');

  try {
    await api(id ? `/api/products/${id}` : '/api/products', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(productPayload(form))
    });
    setMessage(message, 'Product saved and public data updated.');
    fillProductForm({});
    await loadProducts();
  } catch (error) {
    setMessage(message, error.message, true);
  }
});

document.getElementById('imageUpload').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('image', file);
  const message = document.getElementById('productMessage');

  try {
    const data = await api('/api/upload', { method: 'POST', body: formData });
    const form = document.getElementById('productForm');
    form.elements.singleImage.value = data.image;
    form.elements.thumbs.value = [form.elements.thumbs.value, data.image].filter(Boolean).join('\n');
    setMessage(message, `Image uploaded: ${data.image}`);
  } catch (error) {
    setMessage(message, error.message, true);
  }
});

document.getElementById('settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('settingsMessage');
  const data = formJson(form);

  try {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        taxRate: Number(data.taxRate || 0),
        freeShippingMin: Number(data.freeShippingMin || 0),
        localShippingFee: Number(data.localShippingFee || 0),
        storePhone: data.storePhone,
        storeLocation: data.storeLocation,
        paymentMethods: {
          cod: form.elements.cod.checked,
          easypaisa: form.elements.easypaisa.checked,
          jazzcash: form.elements.jazzcash.checked,
          bankTransfer: form.elements.bankTransfer.checked
        }
      })
    });
    setMessage(message, 'Settings saved.');
  } catch (error) {
    setMessage(message, error.message, true);
  }
});

init();
