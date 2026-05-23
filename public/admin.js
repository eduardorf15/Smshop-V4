const tokenKey = "smshop:admin:token";

const state = {
  products: [],
  dashboard: null,
  analytics: null,
  syncReport: null,
  alerts: { total: 0, products: [], alerts: [] },
  filters: { search: "", category: "", status: "" },
  editing: null
};

const nodes = {
  loginView: document.querySelector("[data-login-view]"),
  dashboardView: document.querySelector("[data-dashboard-view]"),
  loginForm: document.querySelector("[data-login-form]"),
  loginStatus: document.querySelector("[data-login-status]"),
  status: document.querySelector("[data-status]"),
  kpis: document.querySelector("[data-kpis]"),
  alerts: document.querySelector("[data-alerts]"),
  alertCount: document.querySelector("[data-alert-count]"),
  products: document.querySelector("[data-products]"),
  editor: document.querySelector("[data-editor]"),
  editForm: document.querySelector("[data-edit-form]")
};

boot();

function boot() {
  bindEvents();
  if (getToken()) {
    showDashboard();
    refreshAll();
  }
}

function bindEvents() {
  nodes.loginForm.addEventListener("submit", onLogin);
  document.querySelector("[data-import-form]").addEventListener("submit", onImport);
  document.querySelector("[data-manual-form]").addEventListener("submit", onManualCreate);
  nodes.editForm.addEventListener("submit", onEditSave);
  document.querySelector("[data-edit-close]").addEventListener("click", closeEditor);
  document.querySelector("[data-edit-sync]").addEventListener("click", () => syncProduct(state.editing?.id));
  document.querySelector("[data-edit-delete]").addEventListener("click", () => deleteProduct(state.editing?.id));
  document.body.addEventListener("click", onActionClick);
  document.querySelectorAll("[data-filter]").forEach((field) => field.addEventListener("input", onFilter));
}

async function onLogin(event) {
  event.preventDefault();
  const password = new FormData(nodes.loginForm).get("password");
  setBusy(nodes.loginForm, true);
  setMessage(nodes.loginStatus, "Entrando...");

  try {
    const data = await apiFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password })
    }, { skipAuth: true });
    sessionStorage.setItem(tokenKey, data.token);
    nodes.loginForm.reset();
    showDashboard();
    await refreshAll();
    setMessage(nodes.status, "Login realizado.", "ok");
  } catch (error) {
    setMessage(nodes.loginStatus, error.message, "error");
  } finally {
    setBusy(nodes.loginForm, false);
  }
}

async function onImport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setBusy(form, true);
  setMessage(nodes.status, "Importando produto do Mercado Livre...");

  try {
    const payload = {
      input: text(data, "input"),
      affiliateUrl: text(data, "affiliateUrl"),
      category: text(data, "category") || "Tecnologia",
      tags: splitTags(text(data, "tags")),
      price: numberOrNull(text(data, "price")),
      featured: data.has("featured"),
      available: data.has("available")
    };
    if (payload.price === null) delete payload.price;
    const result = await apiFetch("/api/admin/import-mercadolivre", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    form.elements.category.value = "Tecnologia";
    form.elements.available.checked = true;
    await refreshAll();
    setMessage(nodes.status, `Produto publicado: ${result.product?.name || result.product?.id || "importado"}.`, "ok");
  } catch (error) {
    setMessage(nodes.status, error.message, "error");
  } finally {
    setBusy(form, false);
  }
}

async function onManualCreate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setBusy(form, true);
  setMessage(nodes.status, "Criando produto manual...");

  try {
    const images = mergeImages(text(data, "heroImage"), text(data, "images"));
    const result = await apiFetch("/api/admin/products/manual", {
      method: "POST",
      body: JSON.stringify({
        name: text(data, "name"),
        price: Number(text(data, "price")),
        affiliateUrl: text(data, "affiliateUrl"),
        category: text(data, "category") || "Tecnologia",
        images,
        description: text(data, "description"),
        tags: splitTags(text(data, "tags")),
        featured: data.has("featured"),
        available: data.has("available")
      })
    });
    form.reset();
    form.elements.category.value = "Tecnologia";
    form.elements.available.checked = true;
    await refreshAll();
    setMessage(nodes.status, `Produto manual criado: ${result.product?.name || "produto"}.`, "ok");
  } catch (error) {
    setMessage(nodes.status, error.message, "error");
  } finally {
    setBusy(form, false);
  }
}

async function onEditSave(event) {
  event.preventDefault();
  if (!state.editing) return;

  const data = new FormData(nodes.editForm);
  setBusy(nodes.editForm, true);
  setMessage(nodes.status, `Salvando ${state.editing.id}...`);

  try {
    const oldPrice = numberOrNull(text(data, "oldPrice"));
    await apiFetch(`/api/admin/products/${encodeURIComponent(state.editing.id)}/manual-data`, {
      method: "PATCH",
      body: JSON.stringify({
        name: text(data, "name"),
        price: Number(text(data, "price")),
        oldPrice,
        affiliateUrl: text(data, "affiliateUrl"),
        category: text(data, "category"),
        tags: splitTags(text(data, "tags")),
        badge: text(data, "badge"),
        featured: data.has("featured"),
        available: data.has("available"),
        images: text(data, "images"),
        description: text(data, "description")
      })
    });
    closeEditor();
    await refreshAll();
    setMessage(nodes.status, "Produto atualizado e cache limpo.", "ok");
  } catch (error) {
    setMessage(nodes.status, error.message, "error");
  } finally {
    setBusy(nodes.editForm, false);
  }
}

async function onActionClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const row = button.closest("[data-id]");
  const id = row?.dataset.id || state.editing?.id || "";

  if (action === "logout") logout();
  if (action === "refresh") await refreshAll();
  if (action === "sync-all") await syncAll();
  if (action === "focus-import") document.querySelector("[data-import-form] input")?.focus();
  if (action === "edit") openEditor(findProduct(id));
  if (action === "sync") await syncProduct(id);
  if (action === "delete") await deleteProduct(id);
}

function onFilter(event) {
  state.filters[event.target.dataset.filter] = event.target.value;
  renderProducts();
}

async function refreshAll() {
  setMessage(nodes.status, "Carregando produtos, relatórios e alertas...");
  try {
    const [dashboardData, productsData, syncData, alertsData, analyticsData] = await Promise.all([
      apiFetch("/api/admin/dashboard"),
      apiFetch("/api/admin/products"),
      apiFetch("/api/admin/sync-report"),
      apiFetch("/api/admin/alerts"),
      apiFetch("/api/admin/analytics")
    ]);
    state.dashboard = dashboardData.dashboard || {};
    state.products = productsData.products || [];
    state.syncReport = syncData || {};
    state.alerts = alertsData.alerts || { total: 0, products: [], alerts: [] };
    state.analytics = analyticsData.analytics || state.dashboard.analytics || {};
    renderDashboard();
    renderAlerts();
    renderProducts();
    renderInsights();
    setMessage(nodes.status, "Dashboard atualizado.", "ok");
  } catch (error) {
    setMessage(nodes.status, error.message, "error");
  }
}

async function syncAll() {
  setMessage(nodes.status, "Sincronizando todos os produtos com Mercado Livre...");
  try {
    await apiFetch("/api/admin/products/refresh", { method: "POST" });
    await refreshAll();
    setMessage(nodes.status, "Sincronização concluída.", "ok");
  } catch (error) {
    setMessage(nodes.status, error.message, "error");
  }
}

async function syncProduct(id) {
  if (!id) return;
  setMessage(nodes.status, `Sincronizando ${id}...`);
  try {
    await apiFetch(`/api/admin/products/${encodeURIComponent(id)}/sync`, { method: "POST" });
    closeEditor();
    await refreshAll();
    setMessage(nodes.status, `Produto ${id} sincronizado.`, "ok");
  } catch (error) {
    setMessage(nodes.status, error.message, "error");
  }
}

async function deleteProduct(id) {
  if (!id) return;
  if (!window.confirm(`Excluir ou ocultar ${id} do catálogo público?`)) return;
  setMessage(nodes.status, `Removendo ${id}...`);
  try {
    await apiFetch(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
    closeEditor();
    await refreshAll();
    setMessage(nodes.status, `Produto ${id} removido da loja.`, "ok");
  } catch (error) {
    setMessage(nodes.status, error.message, "error");
  }
}

function renderDashboard() {
  const dashboard = state.dashboard || {};
  const analytics = state.analytics || dashboard.analytics || {};
  const lastProduct = dashboard.lastProductAdded?.name || dashboard.latestProducts?.[0]?.name || "Nenhum";
  const cards = [
    ["Total de produtos", dashboard.totalProducts],
    ["Produtos ativos", dashboard.activeProducts],
    ["Em destaque", dashboard.featuredProducts],
    ["Automáticos", dashboard.automaticProducts],
    ["Manuais", dashboard.manualProducts],
    ["Partial", dashboard.partialProducts],
    ["Com erro", dashboard.errorProducts],
    ["Total de cliques", analytics.totalClicks],
    ["Revisar preço", dashboard.needsPriceReviewProducts],
    ["Último produto", lastProduct],
    ["Último sync", formatDate(dashboard.lastSync)]
  ];

  nodes.kpis.innerHTML = cards.map(([label, value]) => `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? 0)}</strong>
    </article>
  `).join("");

  renderCategoryFilter();
}

function renderAlerts() {
  const products = state.alerts.products || [];
  nodes.alertCount.textContent = String(state.alerts.total || 0);
  nodes.alerts.innerHTML = products.length
    ? products.slice(0, 12).map((product) => `
      <article class="alert-card ${product.alerts.some((alert) => alert.severity === "high") ? "is-high" : ""}">
        <div>
          <strong>${escapeHtml(product.name || product.id)}</strong>
          <span>${escapeHtml(product.id)} · ${escapeHtml(product.syncStatus)} · ${escapeHtml(product.dataSource)}</span>
        </div>
        <ul>${product.alerts.map((alert) => `<li>${escapeHtml(alert.title)}</li>`).join("")}</ul>
        <button type="button" class="ghost" data-action="edit" data-id="${escapeHtml(product.id)}">Editar</button>
      </article>
    `).join("")
    : `<p class="empty">Nenhum alerta crítico agora.</p>`;
}

function renderProducts() {
  const products = filteredProducts();
  nodes.products.innerHTML = products.length
    ? products.map((product) => `
      <article class="product-row" data-id="${escapeHtml(product.id)}">
        <img src="${escapeAttr(product.heroImage || "/imagens/logo/logo.png")}" alt="${escapeAttr(product.name)}" loading="lazy" />
        <div class="product-main">
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.affiliateUrl || "Sem affiliateUrl")}</p>
          <div class="meta-row">
            <span>${escapeHtml(product.category || "Sem categoria")}</span>
            <span>${formatPrice(product.price)}</span>
            <span>${escapeHtml(product.dataSource || "manual")}</span>
            <span>${escapeHtml(product.syncStatus || "fallback")}</span>
            <span>${product.available === false ? "indisponível" : "ativo"}</span>
          </div>
        </div>
        <div class="row-actions">
          <button type="button" class="ghost" data-action="edit">Editar</button>
          <button type="button" class="ghost" data-action="sync">Sincronizar</button>
          <button type="button" class="danger" data-action="delete">Excluir</button>
        </div>
      </article>
    `).join("")
    : `<p class="empty">Nenhum produto encontrado.</p>`;
}

function renderInsights() {
  const analytics = state.analytics || {};
  renderList("[data-top-clicks]", analytics.topProducts || [], (item) => `
    <strong>${escapeHtml(item.productName || item.productId)}</strong>
    <span>${Number(item.clicks || 0)} cliques</span>
  `);
  renderList("[data-recent-clicks]", analytics.recentClicks || [], (item) => `
    <strong>${escapeHtml(item.productName || item.productId)}</strong>
    <span>${formatDate(item.clickedAt)}</span>
  `);

  const report = state.syncReport || {};
  const reportRows = [
    ["Com MLB ID", report.withMeliId],
    ["Synced", report.synced],
    ["Partial", report.partial],
    ["Fallback", report.fallback],
    ["Error", report.error]
  ];
  document.querySelector("[data-sync-report]").innerHTML = reportRows.map(([label, value]) => `
    <div class="mini-row"><strong>${escapeHtml(label)}</strong><span>${Number(value || 0)}</span></div>
  `).join("");
}

function renderList(selector, items, renderItem) {
  const node = document.querySelector(selector);
  node.innerHTML = items.length
    ? items.map((item) => `<div class="mini-row">${renderItem(item)}</div>`).join("")
    : `<p class="empty">Sem dados ainda.</p>`;
}

function renderCategoryFilter() {
  const select = document.querySelector("[data-filter='category']");
  const current = select.value;
  const categories = [...new Set(state.products.map((product) => product.category).filter(Boolean))].sort();
  select.innerHTML = `<option value="">Todas categorias</option>${categories.map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("")}`;
  select.value = current;
}

function openEditor(product) {
  if (!product) return;
  state.editing = product;
  nodes.editForm.elements.id.value = product.id || "";
  nodes.editForm.elements.name.value = product.name || "";
  nodes.editForm.elements.price.value = product.price ?? "";
  nodes.editForm.elements.oldPrice.value = product.oldPrice ?? "";
  nodes.editForm.elements.affiliateUrl.value = product.affiliateUrl || "";
  nodes.editForm.elements.category.value = product.category || "";
  nodes.editForm.elements.badge.value = product.badge || "";
  nodes.editForm.elements.tags.value = (product.tags || []).join(", ");
  nodes.editForm.elements.images.value = (product.images || []).join("\n");
  nodes.editForm.elements.description.value = product.description || "";
  nodes.editForm.elements.featured.checked = Boolean(product.featured);
  nodes.editForm.elements.available.checked = product.available !== false;
  document.querySelector("[data-edit-subtitle]").textContent = `${product.id} · ${product.meliId || "manual"}`;
  nodes.editor.showModal();
}

function closeEditor() {
  if (nodes.editor.open) nodes.editor.close();
  state.editing = null;
}

function filteredProducts() {
  const search = state.filters.search.toLowerCase();
  return state.products.filter((product) => {
    const haystack = `${product.id} ${product.name} ${product.category} ${product.affiliateUrl || ""} ${product.meliId || ""}`.toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (state.filters.category && product.category !== state.filters.category) return false;
    if (state.filters.status && product.syncStatus !== state.filters.status) return false;
    return true;
  });
}

async function apiFetch(url, options = {}, config = {}) {
  const token = getToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(!config.skipAuth && token ? { "x-admin-token": token } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    if (response.status === 401 && !config.skipAuth) logout();
    throw new Error(data.message || "Operação não concluída.");
  }
  return data;
}

function showDashboard() {
  nodes.loginView.hidden = true;
  nodes.dashboardView.hidden = false;
}

function logout() {
  sessionStorage.removeItem(tokenKey);
  nodes.dashboardView.hidden = true;
  nodes.loginView.hidden = false;
  state.products = [];
  state.dashboard = null;
  setMessage(nodes.loginStatus, "Sessão encerrada.");
}

function setBusy(form, busy) {
  form.querySelectorAll("button, input, select, textarea").forEach((field) => {
    field.disabled = busy;
  });
}

function setMessage(node, message, type = "") {
  node.textContent = message || "";
  node.className = `message ${type}`.trim();
}

function findProduct(id) {
  return state.products.find((product) => product.id === id || product.sku === id);
}

function getToken() {
  return sessionStorage.getItem(tokenKey) || "";
}

function text(formData, key) {
  return String(formData.get(key) || "").trim();
}

function splitTags(value) {
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function mergeImages(heroImage, images) {
  return [heroImage, ...String(images || "").split(/\n|,/)].map((image) => image.trim()).filter(Boolean);
}

function numberOrNull(value) {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "Sem preço";
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
