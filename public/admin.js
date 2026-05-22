const tokenKey = "smshopAdminToken";
const state = {
  products: [],
  syncReport: null,
  editingId: null
};

const loginPanel = document.querySelector("[data-login-panel]");
const dashboard = document.querySelector("[data-dashboard]");
const statusBar = document.querySelector("[data-status]");
const productsList = document.querySelector("[data-products-list]");
const loginForm = document.querySelector("[data-login-form]");
const importForm = document.querySelector("[data-import-form]");
const editForm = document.querySelector("[data-edit-form]");
const editId = document.querySelector("[data-edit-id]");

loginForm.addEventListener("submit", handleLogin);
importForm.addEventListener("submit", handleImport);
editForm.addEventListener("submit", handleEditSave);
document.querySelector("[data-refresh]").addEventListener("click", loadDashboardData);
document.querySelector("[data-logout]").addEventListener("click", logout);
document.querySelector("[data-cancel-edit]").addEventListener("click", closeEdit);

if (getToken()) {
  showDashboard();
  loadDashboardData();
}

async function handleLogin(event) {
  event.preventDefault();
  setBusy(loginForm, true);
  try {
    const password = new FormData(loginForm).get("password");
    const data = await apiFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    sessionStorage.setItem(tokenKey, data.token);
    loginForm.reset();
    showDashboard();
    await loadDashboardData();
    setStatus("Login realizado.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(loginForm, false);
  }
}

async function handleImport(event) {
  event.preventDefault();
  setBusy(importForm, true);
  try {
    const form = new FormData(importForm);
    const price = form.get("price");
    const payload = {
      input: String(form.get("input") || "").trim(),
      affiliateUrl: String(form.get("affiliateUrl") || "").trim(),
      category: String(form.get("category") || "Tecnologia").trim(),
      tags: splitTags(form.get("tags")),
      featured: Boolean(form.get("featured"))
    };
    if (price !== null && String(price).trim() !== "") payload.price = Number(price);

    const data = await apiFetch("/api/admin/import-mercadolivre", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    importForm.reset();
    importForm.elements.category.value = "Tecnologia";
    await loadProducts();
    setStatus(`Produto ${data.product?.name || "importado"} salvo.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(importForm, false);
  }
}

async function handleEditSave(event) {
  event.preventDefault();
  if (!state.editingId) return;

  setBusy(editForm, true);
  try {
    const form = new FormData(editForm);
    const oldPriceValue = String(form.get("oldPrice") || "").trim();
    const payload = {
      affiliateUrl: String(form.get("affiliateUrl") || "").trim(),
      price: Number(form.get("price")),
      oldPrice: oldPriceValue ? Number(oldPriceValue) : null,
      available: Boolean(form.get("available")),
      featured: Boolean(form.get("featured")),
      category: String(form.get("category") || "").trim(),
      tags: splitTags(form.get("tags"))
    };

    const data = await apiFetch(`/api/admin/products/${encodeURIComponent(state.editingId)}/manual-data`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    await loadProducts();
    openEdit(data.product);
    setStatus(`Produto ${data.product?.id || state.editingId} atualizado.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(editForm, false);
  }
}

async function loadProducts() {
  setStatus("Carregando produtos...");
  const data = await apiFetch("/api/products");
  state.products = Array.isArray(data.products) ? data.products : [];
  renderProducts();
  setStatus(`${state.products.length} produtos carregados.`, "ok");
}

async function loadDashboardData() {
  await loadProducts();
  await loadSyncReport();
}

async function loadSyncReport() {
  const report = await apiFetch("/api/admin/sync-report");
  state.syncReport = report;
  setStatus(
    `${state.products.length} produtos carregados. Sync: ${report.synced || 0} sincronizados, ${report.partial || 0} parciais, ${report.error || 0} com erro.`,
    "ok"
  );
}

function renderProducts() {
  productsList.innerHTML = "";
  state.products.forEach((product) => {
    const row = document.createElement("article");
    row.className = "product-row";
    row.innerHTML = `
      <div>
        <h3>${escapeHtml(product.name || product.id)}</h3>
        <div class="product-meta">
          <span>${escapeHtml(product.category || "Sem categoria")}</span>
          <span class="product-price">${formatPrice(product.price)}</span>
          <span>${escapeHtml(product.syncStatus || "sem status")}</span>
          <span>${escapeHtml(product.dataSource || "manual")}</span>
        </div>
      </div>
      <button type="button">Editar</button>
    `;
    row.querySelector("button").addEventListener("click", () => openEdit(product));
    productsList.append(row);
  });
}

function openEdit(product) {
  if (!product) return;
  state.editingId = product.id;
  editId.textContent = product.id;
  editForm.hidden = false;
  editForm.elements.affiliateUrl.value = product.affiliateUrl || "";
  editForm.elements.price.value = product.price ?? "";
  editForm.elements.oldPrice.value = product.oldPrice ?? "";
  editForm.elements.category.value = product.category || "";
  editForm.elements.tags.value = Array.isArray(product.tags) ? product.tags.join(", ") : "";
  editForm.elements.available.checked = Boolean(product.available);
  editForm.elements.featured.checked = Boolean(product.featured);
  editForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEdit() {
  state.editingId = null;
  editForm.hidden = true;
  editForm.reset();
}

function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
}

function logout() {
  sessionStorage.removeItem(tokenKey);
  state.products = [];
  state.editingId = null;
  dashboard.hidden = true;
  loginPanel.hidden = false;
  closeEdit();
  setStatus("Sessão encerrada.");
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    if (response.status === 401) sessionStorage.removeItem(tokenKey);
    throw new Error(data.message || "Não foi possível concluir a operação.");
  }
  return data;
}

function getToken() {
  return sessionStorage.getItem(tokenKey) || "";
}

function setStatus(message, type = "") {
  statusBar.textContent = message;
  statusBar.classList.toggle("is-ok", type === "ok");
  statusBar.classList.toggle("is-error", type === "error");
}

function setBusy(form, busy) {
  form.querySelectorAll("button, input").forEach((field) => {
    field.disabled = busy;
  });
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Sem preço";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char];
  });
}
