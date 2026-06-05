import { defaultCategoryName, officialCategories } from "../src/data/categories.js";

const state = {
  products: [],
  dashboard: {},
  analytics: null,
  mercadoLivre: null,
  alerts: { total: 0, products: [], alerts: [] },
  filters: { search: "", category: "", status: "" },
  editing: null,
  aiResult: null,
  aiContext: null
};

const nodes = {
  status: document.querySelector("[data-status]"),
  kpis: document.querySelector("[data-kpis]"),
  alerts: document.querySelector("[data-alerts]"),
  alertCount: document.querySelector("[data-alert-count]"),
  products: document.querySelector("[data-products]"),
  editor: document.querySelector("[data-editor]"),
  editForm: document.querySelector("[data-edit-form]"),
  importForm: document.querySelector("[data-import-form]"),
  manualForm: document.querySelector("[data-manual-form]"),
  aiProductSelect: document.querySelector("[data-ai-product-select]"),
  aiResult: document.querySelector("[data-ai-result]"),
  aiModalResult: document.querySelector("[data-ai-modal-result]"),
  mercadoLivreStatus: document.querySelector("[data-ml-status]"),
  mercadoLivreConnect: document.querySelector("[data-ml-connect]")
};

boot();

async function boot() {
  initCategorySelects();
  bindEvents();
  await Promise.all([loadDashboard(), loadProducts(), loadAlerts(), loadMercadoLivreStatus()]);
  renderDashboard();
  renderMercadoLivreStatus();
  renderAlerts();
  renderProducts();
  renderAnalytics();
  renderAiProductSelect();
  setMessage("Painel atualizado. Produtos prontos para venda.", "ok");
}

function bindEvents() {
  nodes.importForm.addEventListener("submit", onImport);
  nodes.manualForm.addEventListener("submit", onManualCreate);
  nodes.editForm.addEventListener("submit", onEditSave);
  document.querySelector("[data-edit-close]").addEventListener("click", closeEditor);
  document.querySelector("[data-edit-sync]").addEventListener("click", () => syncProduct(state.editing?.id));
  document.querySelector("[data-edit-delete]").addEventListener("click", () => deleteProduct(state.editing?.id));
  document.body.addEventListener("click", onActionClick);
  document.querySelectorAll("[data-filter]").forEach((field) => field.addEventListener("input", onFilter));
  nodes.editor.addEventListener("click", (event) => {
    if (event.target === nodes.editor) closeEditor();
  });
}

async function refreshAll() {
  setMessage("Carregando painel emergencial...");
  try {
    await Promise.all([loadDashboard(), loadProducts(), loadAlerts(), loadMercadoLivreStatus()]);
    renderDashboard();
    renderMercadoLivreStatus();
    renderAlerts();
    renderProducts();
    renderAnalytics();
    renderAiProductSelect();
    setMessage("Painel atualizado. Produtos prontos para venda.", "ok");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function loadDashboard() {
  const dashboardData = await apiFetch("/api/admin/dashboard");
  const analyticsData = await apiFetch("/api/admin/analytics").catch(() => ({ analytics: null }));
  state.dashboard = dashboardData.dashboard || {};
  state.analytics = analyticsData.analytics || state.dashboard.analytics || null;
}

async function loadProducts() {
  const productsData = await apiFetch("/api/admin/products");
  state.products = productsData.products || [];
  initCategorySelects();
}

async function loadAlerts() {
  const alertsData = await apiFetch("/api/admin/alerts");
  state.alerts = alertsData.alerts || { total: 0, products: [], alerts: [] };
}

async function loadMercadoLivreStatus() {
  state.mercadoLivre = await apiFetch("/api/mercadolivre/status").catch((error) => ({
    connected: false,
    tokenValid: false,
    tokenExpired: false,
    message: error.message
  }));
}

async function onImport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearLocalMessage(form);
  const data = new FormData(form);
  const payload = {
    input: text(data, "input"),
    affiliateUrl: text(data, "affiliateUrl"),
    category: text(data, "category") || defaultCategoryName,
    tags: splitTags(text(data, "tags")),
    price: numberOrNull(text(data, "price")),
    featured: data.has("featured"),
    available: data.has("available")
  };
  if (payload.price === null) delete payload.price;

  setBusy(form, true);
  setMessage("Importando produto do Mercado Livre...");
  setLocalMessage(form, "Importando produto do Mercado Livre...", "warning");
  try {
    const result = await apiFetch("/api/admin/import-mercadolivre", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    resetFormDefaults(form);
    await refreshAll();
    const message = importResultMessage(result.product);
    setMessage(message, "ok");
    setLocalMessage(form, message, "ok");
  } catch (error) {
    const type = /bloqueou|use cadastro assistido|manual/i.test(error.message) ? "warning" : "error";
    setMessage(error.message, type);
    setLocalMessage(form, error.message, type);
  } finally {
    setBusy(form, false);
  }
}

async function onManualCreate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearLocalMessage(form);
  const data = new FormData(form);
  const payload = {
    name: text(data, "name"),
    price: numberOrNull(text(data, "price")),
    oldPrice: numberOrNull(text(data, "oldPrice")),
    affiliateUrl: text(data, "affiliateUrl"),
    category: text(data, "category") || defaultCategoryName,
    description: text(data, "description"),
    images: mergeImages(text(data, "heroImage"), text(data, "images")),
    tags: splitTags(text(data, "tags")),
    badge: text(data, "badge") || "Curadoria",
    sourceInput: text(data, "sourceInput"),
    mercadoLivrePermalink: text(data, "mercadoLivrePermalink"),
    meliId: text(data, "meliId"),
    assistedMode: text(data, "assistedMode"),
    aiEnhanced: text(data, "aiEnhanced") === "true",
    featured: data.has("featured"),
    available: data.has("available")
  };
  if (payload.oldPrice === null) delete payload.oldPrice;

  setBusy(form, true);
  setMessage("Cadastrando produto manual...");
  setLocalMessage(form, "Cadastrando produto manual...", "warning");
  try {
    const result = await apiFetch("/api/admin/products/manual", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    resetFormDefaults(form);
    await refreshAll();
    const message = `Produto cadastrado e publicado: ${result.product?.name || payload.name}.`;
    setMessage(message, "ok");
    setLocalMessage(form, message, "ok");
  } catch (error) {
    setMessage(error.message, "error");
    setLocalMessage(form, error.message, "error");
  } finally {
    setBusy(form, false);
  }
}

async function onEditSave(event) {
  event.preventDefault();
  if (!state.editing) return;
  clearLocalMessage(nodes.editForm);

  const data = new FormData(nodes.editForm);
  const oldPrice = numberOrNull(text(data, "oldPrice"));
  const payload = {
    name: text(data, "name"),
    price: numberOrNull(text(data, "price")),
    oldPrice,
    affiliateUrl: text(data, "affiliateUrl"),
    category: text(data, "category"),
    description: text(data, "description"),
    images: text(data, "images"),
    tags: splitTags(text(data, "tags")),
    badge: text(data, "badge"),
    featured: data.has("featured"),
    available: data.has("available")
  };

  setBusy(nodes.editForm, true);
  setMessage(`Salvando ${state.editing.id}...`);
  setLocalMessage(nodes.editForm, `Salvando ${state.editing.id}...`, "warning");
  try {
    await apiFetch(`/api/admin/products/${encodeURIComponent(state.editing.id)}/manual-data`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    closeEditor();
    await refreshAll();
    setMessage("Produto atualizado e publicado na loja.", "ok");
    setLocalMessage(nodes.editForm, "Produto atualizado e publicado na loja.", "ok");
  } catch (error) {
    setMessage(error.message, "error");
    setLocalMessage(nodes.editForm, error.message, "error");
  } finally {
    setBusy(nodes.editForm, false);
  }
}

async function onActionClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const id = button.closest("[data-id]")?.dataset.id || state.editing?.id || "";

  if (action === "refresh") await refreshAll();
  if (action === "sync-all") await syncAll();
  if (action === "focus-import") nodes.importForm.querySelector("input[name='input']")?.focus();
  if (action === "debug-ml") await debugMercadoLivre();
  if (action === "manual-from-link") createManualFromMercadoLivreLink();
  if (action === "ml-extract-field") await extractMercadoLivreField(button);
  if (action === "ai-description") await runAiAction("generate-description", button);
  if (action === "ai-copy") await runAiAction("generate-sales-copy", button);
  if (action === "ai-tags") await runAiAction("suggest-tags", button);
  if (action === "ai-review") await runAiAction("review-product", button);
  if (action === "ai-apply-description") applyAiDescription();
  if (action === "ai-apply-tags") applyAiTags();
  if (action === "edit") openEditor(findProduct(id));
  if (action === "sync") await syncProduct(id);
  if (action === "delete") await deleteProduct(id);
}

function createManualFromMercadoLivreLink() {
  const manualForm = nodes.manualForm;
  prepareManualFormFromImport();
  manualForm.elements.description.value = "";
  manualForm.elements.heroImage.value = "";
  manualForm.elements.images.value = "";
  manualForm.elements.name.placeholder = "Nome real do produto";
  manualForm.elements.price.placeholder = "Preço manual obrigatório";
  manualForm.elements.heroImage.placeholder = "Imagem real do produto";
  manualForm.scrollIntoView({ behavior: "smooth", block: "start" });
  manualForm.elements.name.focus();
  const message = "Cadastro manual preparado. A fonte de dados ficou separada do link afiliado.";
  setMessage(message, "ok");
  setLocalMessage(manualForm, message, "ok");
}

async function extractMercadoLivreField(button) {
  const field = button?.dataset.field || "";
  const sourceInput = nodes.importForm.elements.input?.value?.trim() || "";
  const affiliateUrl = nodes.importForm.elements.affiliateUrl?.value?.trim() || "";
  clearLocalMessage(nodes.importForm);

  if (!sourceInput) {
    setLocalMessage(nodes.importForm, "Informe a URL oficial, página do produto ou MLB ID para buscar dados.", "error");
    return;
  }

  prepareManualFormFromImport({ preserveExistingFields: true });
  const label = button.textContent;
  setButtonGroupBusy(button, true);
  button.textContent = "Buscando...";
  setLocalMessage(nodes.importForm, `${label} usando somente a fonte de dados...`, "warning");
  try {
    const response = await apiFetch("/api/admin/mercadolivre/extract-field", {
      method: "POST",
      body: JSON.stringify({ sourceInput, field })
    });
    const fields = response.fields || {};
    const applied = applyExtractedFields(fields, field);
    if (response.mercadoLivrePermalink && nodes.manualForm.elements.mercadoLivrePermalink) nodes.manualForm.elements.mercadoLivrePermalink.value = response.mercadoLivrePermalink;
    if (nodes.manualForm.elements.affiliateUrl) {
      nodes.manualForm.elements.affiliateUrl.value = affiliateUrl;
    }
    const message = field === "all" ? extractionSummary(fields) : fieldMessage(field, applied);
    const type = applied ? "ok" : "warning";
    setLocalMessage(nodes.importForm, message, type);
    setLocalMessage(nodes.manualForm, message, type);
  } catch (error) {
    setLocalMessage(nodes.importForm, error.message, "error");
  } finally {
    button.textContent = label;
    setButtonGroupBusy(button, false);
  }
}

function prepareManualFormFromImport({ preserveExistingFields = false } = {}) {
  const importForm = nodes.importForm;
  const manualForm = nodes.manualForm;
  const sourceInput = importForm.elements.input?.value?.trim() || "";
  const affiliateUrl = importForm.elements.affiliateUrl?.value?.trim() || "";
  const category = importForm.elements.category?.value || defaultCategoryName;
  const tags = importForm.elements.tags?.value?.trim();
  const meliId = extractMeliId(sourceInput);

  if (manualForm.elements.sourceInput) manualForm.elements.sourceInput.value = sourceInput;
  if (manualForm.elements.mercadoLivrePermalink && !preserveExistingFields) manualForm.elements.mercadoLivrePermalink.value = "";
  if (manualForm.elements.meliId) manualForm.elements.meliId.value = meliId;
  if (manualForm.elements.assistedMode) manualForm.elements.assistedMode.value = "true";
  if (manualForm.elements.aiEnhanced && !preserveExistingFields) manualForm.elements.aiEnhanced.value = "";
  manualForm.elements.affiliateUrl.value = affiliateUrl;
  manualForm.elements.category.value = category;
  if (!preserveExistingFields || !manualForm.elements.tags.value) manualForm.elements.tags.value = tags || "mercado livre, curadoria";
}

function applyExtractedFields(fields, requestedField) {
  const form = nodes.manualForm;
  let applied = false;
  if ((requestedField === "name" || requestedField === "all") && fields.name) {
    form.elements.name.value = fields.name;
    applied = true;
  }
  if ((requestedField === "price" || requestedField === "all") && fields.price) {
    form.elements.price.value = fields.price;
    applied = true;
  }
  if ((requestedField === "images" || requestedField === "all") && Array.isArray(fields.images) && fields.images.length) {
    form.elements.heroImage.value = fields.heroImage || fields.images[0] || "";
    form.elements.images.value = fields.images.slice(1).join("\n");
    applied = true;
  }
  if ((requestedField === "description" || requestedField === "all") && fields.description) {
    form.elements.description.value = fields.description;
    applied = true;
  }
  return applied;
}

function fieldMessage(field, applied) {
  if (applied && field === "name") return "Nome preenchido no cadastro manual.";
  if (applied && field === "price") return "Preço preenchido no cadastro manual.";
  if (applied && field === "images") return "Imagem principal e adicionais preenchidas no cadastro manual.";
  if (applied && field === "description") return "Descrição preenchida no cadastro manual.";
  return {
    name: "Nome não encontrado",
    price: "Preço não encontrado",
    images: "Nenhuma imagem encontrada",
    description: "Descrição não encontrada. Use IA."
  }[field] || "Dados não encontrados";
}

function extractionSummary(fields) {
  return [
    `Nome ${fields.name ? "✅" : "❌"}`,
    `Preço ${fields.price ? "✅" : "❌"}`,
    `Imagens ${Array.isArray(fields.images) && fields.images.length ? "✅" : "❌"}`,
    `Descrição ${fields.description ? "✅" : "❌"}`
  ].join(" | ");
}

function onFilter(event) {
  state.filters[event.target.dataset.filter] = event.target.value;
  renderProducts();
}

async function syncAll() {
  setMessage("Sincronizando produtos com Mercado Livre...");
  try {
    await apiFetch("/api/admin/products/refresh", { method: "POST" });
    await refreshAll();
    setMessage("Sincronização concluída.", "ok");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function syncProduct(id) {
  if (!id) return;
  setMessage(`Sincronizando ${id}...`);
  try {
    await apiFetch(`/api/admin/products/${encodeURIComponent(id)}/sync`, { method: "POST" });
    closeEditor();
    await refreshAll();
    setMessage(`Produto ${id} sincronizado.`, "ok");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function deleteProduct(id) {
  if (!id) return;
  if (!window.confirm(`Excluir ${id} do catálogo público?`)) return;

  setMessage(`Excluindo ${id}...`);
  try {
    await apiFetch(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
    closeEditor();
    await refreshAll();
    setMessage(`Produto ${id} removido da loja.`, "ok");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function debugMercadoLivre() {
  const input = nodes.importForm.elements.input?.value?.trim();
  clearLocalMessage(nodes.importForm);
  if (!input) {
    setMessage("Informe um link ou MLB ID para depurar.", "error");
    setLocalMessage(nodes.importForm, "Informe um link ou MLB ID para depurar.", "error");
    return;
  }
  setMessage("Executando debug Mercado Livre...");
  setLocalMessage(nodes.importForm, "Executando debug Mercado Livre...", "warning");
  try {
    const result = await apiFetch(`/api/admin/debug-mercadolivre?input=${encodeURIComponent(input)}`);
    const debug = result.debug || {};
    const accepted = (debug.priceCandidates || []).filter((candidate) => candidate.accepted);
    const rejected = (debug.priceCandidates || []).filter((candidate) => !candidate.accepted);
    console.log("[SMShop Debug ML]", debug);
    const message = `Debug ML: ${debug.title || debug.meliId || input}. Preço escolhido: ${formatPrice(debug.chosenPrice)}. Candidatos válidos: ${accepted.length}. Rejeitados: ${rejected.length}. ${debug.reason || ""}`;
    const type = debug.chosenPrice ? "ok" : "warning";
    setMessage(message, type);
    setLocalMessage(nodes.importForm, message, type);
  } catch (error) {
    setMessage(error.message, "error");
    setLocalMessage(nodes.importForm, error.message, "error");
  }
}

async function runAiAction(kind, button) {
  const context = getAiContext(button);
  const localTarget = messageTargetForAiContext(context);
  clearLocalMessage(localTarget);
  if (!context.product.name) {
    setMessage("Informe ou selecione um produto antes de usar a IA.", "error");
    setLocalMessage(localTarget, "Informe ou selecione um produto antes de usar a IA.", "error");
    return;
  }

  const endpoint = {
    "generate-description": "/api/admin/ai/generate-description",
    "generate-sales-copy": "/api/admin/ai/generate-sales-copy",
    "suggest-tags": "/api/admin/ai/suggest-tags",
    "review-product": "/api/admin/ai/review-product"
  }[kind];

  setButtonBusy(button, true);
  setMessage("Gerando com IA...");
  setLocalMessage(localTarget, "Gerando com IA...", "warning");
  try {
    const response = await apiFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({ product: context.product })
    });
    state.aiResult = { kind, result: response.result || {} };
    state.aiContext = context;
    renderAiResult(state.aiResult, context);
    applyImmediateAiResult(kind, context);
    markAiEnhanced(context);
    const message = aiSuccessMessage(kind, context);
    setMessage(message, "ok");
    setLocalMessage(localTarget, message, "ok");
  } catch (error) {
    setMessage(error.message, "error");
    setLocalMessage(localTarget, error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
}

function getAiContext(button) {
  if (button?.closest("[data-edit-form]")) {
    return { source: "edit", form: nodes.editForm, product: productFromEditForm() };
  }
  if (button?.closest("[data-manual-form]")) {
    return { source: "manual", form: nodes.manualForm, product: productFromManualForm() };
  }
  const selected = findProduct(nodes.aiProductSelect?.value);
  return { source: "assistant", form: nodes.editForm, product: selected || {} };
}

function productFromEditForm() {
  const data = new FormData(nodes.editForm);
  return {
    ...(state.editing || {}),
    id: text(data, "id") || state.editing?.id || "",
    name: text(data, "name"),
    price: numberOrNull(text(data, "price")),
    oldPrice: numberOrNull(text(data, "oldPrice")),
    affiliateUrl: text(data, "affiliateUrl"),
    category: text(data, "category"),
    description: text(data, "description"),
    images: text(data, "images"),
    tags: splitTags(text(data, "tags")),
    badge: text(data, "badge"),
    featured: data.has("featured"),
    available: data.has("available")
  };
}

function productFromManualForm() {
  const data = new FormData(nodes.manualForm);
  const images = mergeImages(text(data, "heroImage"), text(data, "images"));
  return {
    name: text(data, "name"),
    price: numberOrNull(text(data, "price")),
    oldPrice: numberOrNull(text(data, "oldPrice")),
    affiliateUrl: text(data, "affiliateUrl"),
    category: text(data, "category") || defaultCategoryName,
    description: text(data, "description"),
    images,
    heroImage: images[0] || "",
    sourceInput: text(data, "sourceInput"),
    mercadoLivrePermalink: text(data, "mercadoLivrePermalink"),
    meliId: text(data, "meliId"),
    tags: splitTags(text(data, "tags")),
    badge: text(data, "badge"),
    featured: data.has("featured"),
    available: data.has("available")
  };
}

function renderAiResult(aiResult, context = state.aiContext) {
  const value = JSON.stringify(aiResult.result, null, 2);
  if (context?.source === "edit" && nodes.aiModalResult) {
    nodes.aiModalResult.value = value;
  }
  if (nodes.aiResult) {
    nodes.aiResult.value = value;
  }
}

function applyImmediateAiResult(kind, context) {
  if (!["edit", "manual"].includes(context?.source)) return;
  const preferModal = context.source === "edit";
  if (kind === "generate-description") applyAiDescription({ preferModal, silent: true });
  if (kind === "suggest-tags") applyAiTags({ preferModal, silent: true });
}

function applyAiDescription(options = {}) {
  const result = getEditableAiResult(options);
  const description = result.fullDescription || result.shortDescription || "";
  if (!description) {
    setMessage("A IA não retornou descrição aplicável.", "error");
    setLocalMessage(getTargetFormForAiApply(), "A IA não retornou descrição aplicável.", "error");
    return;
  }
  const form = getTargetFormForAiApply();
  if (!form?.elements.description) {
    setMessage("Abra um produto ou use o cadastro manual para aplicar a descrição.", "error");
    setLocalMessage(form, "Abra um produto ou use o cadastro manual para aplicar a descrição.", "error");
    return;
  }
  form.elements.description.value = description;
  markAiEnhanced({ form });
  if (!options.silent) {
    const message = "Descrição aplicada no formulário. Revise e salve quando quiser.";
    setMessage(message, "ok");
    setLocalMessage(form, message, "ok");
  }
}

function applyAiTags(options = {}) {
  const result = getEditableAiResult(options);
  const tags = [
    ...(result.searchTags || []),
    ...(result.categoryTags || []),
    ...(result.commercialTags || [])
  ].filter(Boolean);
  if (!tags.length) {
    setMessage("A IA não retornou tags aplicáveis.", "error");
    setLocalMessage(getTargetFormForAiApply(), "A IA não retornou tags aplicáveis.", "error");
    return;
  }
  const form = getTargetFormForAiApply();
  if (!form?.elements.tags) {
    setMessage("Abra um produto ou use o cadastro manual para aplicar tags.", "error");
    setLocalMessage(form, "Abra um produto ou use o cadastro manual para aplicar tags.", "error");
    return;
  }
  form.elements.tags.value = [...new Set(tags)].join(", ");
  markAiEnhanced({ form });
  if (!options.silent) {
    const message = "Tags aplicadas no formulário. Revise e salve quando quiser.";
    setMessage(message, "ok");
    setLocalMessage(form, message, "ok");
  }
}

function markAiEnhanced(context = {}) {
  const form = context.form || getTargetFormForAiApply();
  if (form?.elements.aiEnhanced) form.elements.aiEnhanced.value = "true";
}

function extractMeliId(value) {
  const match = String(value || "").match(/\b(ML[A-Z]{1,2})-?(\d{3,})\b/i);
  return match ? `${match[1]}${match[2]}`.toUpperCase() : "";
}

function getTargetFormForAiApply() {
  if (state.aiContext?.source === "manual") return nodes.manualForm;
  if (nodes.editor.open) return nodes.editForm;
  if (state.aiContext?.source === "edit") return nodes.editForm;
  return nodes.manualForm;
}

function getEditableAiResult(options = {}) {
  const source = options.preferModal || nodes.editor.open ? nodes.aiModalResult?.value : nodes.aiResult?.value;
  try {
    return JSON.parse(source || "{}");
  } catch {
    return state.aiResult?.result || {};
  }
}

function setButtonBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
}

function setButtonGroupBusy(button, busy) {
  const group = button?.closest?.("[data-ml-field-actions]");
  if (!group) {
    setButtonBusy(button, busy);
    return;
  }
  group.querySelectorAll("button").forEach((item) => {
    item.disabled = busy;
  });
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "Sem preço";
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function renderDashboard() {
  const dashboard = state.dashboard || {};
  const cards = [
    ["Total", dashboard.totalProducts],
    ["Ativos", dashboard.activeProducts],
    ["Destaques", dashboard.featuredProducts],
    ["Manuais", dashboard.manualProducts],
    ["Automáticos", dashboard.automaticProducts],
    ["Parciais", dashboard.partialProducts],
    ["Com erro", dashboard.errorProducts],
    ["Revisar preço", dashboard.needsPriceReviewProducts]
  ];

  nodes.kpis.innerHTML = cards.map(([label, value]) => `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? 0)}</strong>
    </article>
  `).join("");

  renderCategoryFilter();
}

function renderMercadoLivreStatus() {
  const status = state.mercadoLivre || {};
  const connected = Boolean(status.connected && status.tokenValid);
  const expired = Boolean(status.connected && status.tokenExpired);
  if (nodes.mercadoLivreStatus) {
    nodes.mercadoLivreStatus.textContent = connected
      ? "Mercado Livre conectado ✅"
      : expired
      ? "Mercado Livre expirado"
      : "Mercado Livre desconectado";
    nodes.mercadoLivreStatus.classList.toggle("is-ok", connected);
    nodes.mercadoLivreStatus.classList.toggle("is-error", !connected);
  }
  if (nodes.mercadoLivreConnect) {
    nodes.mercadoLivreConnect.hidden = connected;
    nodes.mercadoLivreConnect.textContent = expired ? "Reconectar Mercado Livre" : "Conectar Mercado Livre";
  }
}

function renderAlerts() {
  const products = state.alerts.products || [];
  nodes.alertCount.textContent = String(state.alerts.total || 0);
  nodes.alerts.innerHTML = products.length
    ? products.slice(0, 16).map((product) => `
      <article class="alert-card ${product.alerts.some((alert) => alert.severity === "high") ? "is-high" : ""}">
        <div>
          <strong>${escapeHtml(product.name || product.id)}</strong>
          <span>${escapeHtml(product.id)} - ${escapeHtml(product.syncStatus)} - ${escapeHtml(product.dataSource)}</span>
        </div>
        <ul>${product.alerts.map((alert) => `<li>${escapeHtml(alert.title)}</li>`).join("")}</ul>
        <button type="button" class="ghost" data-action="edit" data-id="${escapeAttr(product.id)}">Editar</button>
      </article>
    `).join("")
    : `<p class="empty">Nenhum alerta crítico agora.</p>`;
}

function renderProducts() {
  const products = filteredProducts();
  nodes.products.innerHTML = products.length
    ? products.map((product) => `
      <article class="product-row" data-id="${escapeAttr(product.id)}">
        <img src="${escapeAttr(productImage(product))}" alt="${escapeAttr(product.name || product.id)}" loading="lazy" />
        <div class="product-main">
          <h3>${escapeHtml(product.name || product.id)}</h3>
          <p>${escapeHtml(product.affiliateUrl || "Sem link afiliado")}</p>
          <div class="meta-row">
            <span>${escapeHtml(product.category || "Sem categoria")}</span>
            <span>${formatPrice(product.price)}</span>
            <span>${escapeHtml(product.syncMethod || statusLabel(product))}</span>
            <span>${escapeHtml(product.syncStatus || "fallback")}</span>
            <span>${product.available === false ? "indisponível" : "ativo"}</span>
            ${product.featured ? "<span>destaque</span>" : ""}
          </div>
          ${renderProductWarnings(product)}
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

function productImage(product) {
  const images = [product?.heroImage, ...(Array.isArray(product?.images) ? product.images : [])]
    .map((image) => String(image || "").trim())
    .filter((image) => image && !/logo\/logo\.png|placeholder|favicon/i.test(image));
  return images[0] || product?.heroImage || "/imagens/logo/logo.png";
}

function renderAnalytics() {
  const analytics = state.analytics;
  if (!analytics) {
    const empty = `<p class="empty">Analytics ainda não disponível.</p>`;
    document.querySelector("[data-analytics-summary]").innerHTML = empty;
    document.querySelector("[data-top-clicks]").innerHTML = empty;
    document.querySelector("[data-recent-clicks]").innerHTML = empty;
    return;
  }

  document.querySelector("[data-analytics-summary]").innerHTML = `
    <div class="mini-row"><strong>Total de cliques</strong><span>${Number(analytics.totalClicks || 0)}</span></div>
  `;
  renderList("[data-top-clicks]", analytics.topProducts || [], (item) => `
    <strong>${escapeHtml(item.productName || item.productId)}</strong>
    <span>${Number(item.clicks || 0)} cliques</span>
  `);
  renderList("[data-recent-clicks]", analytics.recentClicks || [], (item) => `
    <strong>${escapeHtml(item.productName || item.productId)}</strong>
    <span>${formatDate(item.clickedAt)}</span>
  `);
}

function importResultMessage(product) {
  const name = product?.name || product?.id || "novo produto";
  const warnings = productWarnings(product);
  const genericFallback = /Produto Mercado Livre .*revisar título|^Mercado Livre$/i.test(name) || /logo\/logo\.png/i.test(product?.heroImage || "");
  if (genericFallback) {
    return `Dados do ML não encontrados — clique em Debug ML. ${warnings.slice(0, 2).join(" ")}`;
  }
  return warnings.length
    ? `Produto importado e publicado: ${name}. ${warnings.slice(0, 3).join(" ")}`
    : `Produto importado e publicado: ${name}.`;
}

function statusLabel(product) {
  if (product.dataSource === "mercadolivre-item") return "API OK";
  if (product.dataSource === "mercadolivre") return "API OK";
  if (product.dataSource === "mercadolivre-partial") return "API parcial";
  return product.dataSource || "manual";
}

function productWarnings(product) {
  return [
    ...(product?.syncWarnings || []),
    product?.syncWarning || ""
  ].filter(Boolean);
}

function renderProductWarnings(product) {
  const warnings = productWarnings(product);
  if (!hasValidPrice(product?.price)) warnings.unshift("preço precisa ser preenchido manualmente");
  return warnings.length
    ? `<p class="sync-note">${escapeHtml(warnings.slice(0, 2).join(" · "))}</p>`
    : "";
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
  const options = getKnownCategoryNames();
  select.innerHTML = `<option value="">Todas categorias</option>${options.map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("")}`;
  select.value = options.includes(current) ? current : "";
}

function renderAiProductSelect() {
  if (!nodes.aiProductSelect) return;
  const current = nodes.aiProductSelect.value;
  nodes.aiProductSelect.innerHTML = state.products.length
    ? state.products.map((product) => `<option value="${escapeAttr(product.id)}">${escapeHtml(product.name || product.id)}</option>`).join("")
    : `<option value="">Nenhum produto carregado</option>`;
  if (state.products.some((product) => product.id === current)) nodes.aiProductSelect.value = current;
}

function openEditor(product) {
  if (!product) return;
  state.editing = product;
  clearLocalMessage(nodes.editForm);
  renderCategoryOptions(nodes.editForm.elements.category, getKnownCategoryNames(), product.category || defaultCategoryName);
  nodes.editForm.elements.id.value = product.id || "";
  nodes.editForm.elements.name.value = product.name || "";
  nodes.editForm.elements.price.value = product.price ?? "";
  nodes.editForm.elements.oldPrice.value = product.oldPrice ?? "";
  nodes.editForm.elements.affiliateUrl.value = product.affiliateUrl || "";
  nodes.editForm.elements.category.value = product.category || defaultCategoryName;
  nodes.editForm.elements.description.value = product.description || "";
  nodes.editForm.elements.images.value = (product.images?.length ? product.images : [product.heroImage].filter(Boolean)).join("\n");
  nodes.editForm.elements.tags.value = (product.tags || []).join(", ");
  nodes.editForm.elements.badge.value = product.badge || "";
  nodes.editForm.elements.featured.checked = Boolean(product.featured);
  nodes.editForm.elements.available.checked = product.available !== false;
  if (nodes.aiModalResult) nodes.aiModalResult.value = "";
  document.querySelector("[data-edit-subtitle]").textContent = `${product.id} - ${product.meliId || "manual"}`;
  nodes.editor.showModal();
}

function closeEditor() {
  if (nodes.editor.open) nodes.editor.close();
  state.editing = null;
  if (nodes.aiModalResult) nodes.aiModalResult.value = "";
  clearLocalMessage(nodes.editForm);
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

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "Operação não concluída.");
  }
  return data;
}

function initCategorySelects() {
  document.querySelectorAll("select[name='category']").forEach((select) => {
    renderCategoryOptions(select, getKnownCategoryNames(), select.value || defaultCategoryName);
  });
}

function renderCategoryOptions(select, categories, selectedValue = defaultCategoryName) {
  const options = [...new Set([selectedValue, ...categories].filter(Boolean))];
  select.innerHTML = options.map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("");
  select.value = selectedValue;
}

function getKnownCategoryNames() {
  return [...new Set([
    ...officialCategories.map((category) => category.name),
    ...state.products.map((product) => product.category).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function resetFormDefaults(form) {
  form.elements.category.value = defaultCategoryName;
  if (form.elements.available) form.elements.available.checked = true;
  if (form.elements.featured) form.elements.featured.checked = false;
}

function setBusy(form, busy) {
  form.querySelectorAll("button, input, select, textarea").forEach((field) => {
    field.disabled = busy;
  });
}

function setMessage(message, type = "") {
  nodes.status.textContent = message || "";
  nodes.status.className = `message ${type}`.trim();
}

function setLocalMessage(target, message, type = "") {
  const node = getLocalMessageNode(target);
  if (!node) return;
  node.textContent = message || "";
  node.className = `local-message ${type}`.trim();
}

function clearLocalMessage(target) {
  const node = getLocalMessageNode(target);
  if (!node) return;
  node.textContent = "";
  node.className = "local-message";
}

function getLocalMessageNode(target) {
  const root = target?.closest?.("[data-import-form], [data-manual-form], [data-edit-form], [data-ai-panel]") || target;
  return root?.querySelector?.("[data-local-message]") || null;
}

function messageTargetForAiContext(context) {
  if (context?.source === "manual") return nodes.manualForm;
  if (context?.source === "edit") return nodes.editForm;
  return document.querySelector("[data-ai-panel]");
}

function aiSuccessMessage(kind, context) {
  if (context?.source === "manual" && kind === "generate-description") return "Descrição gerada e preenchida no cadastro manual.";
  if (context?.source === "manual" && kind === "suggest-tags") return "Tags geradas e preenchidas no cadastro manual.";
  if (context?.source === "edit" && kind === "generate-description") return "Descrição gerada e preenchida no modal de edição.";
  if (context?.source === "edit" && kind === "suggest-tags") return "Tags geradas e preenchidas no modal de edição.";
  if (kind === "generate-sales-copy") return "Texto de venda gerado. Revise o resultado da IA.";
  if (kind === "review-product") return "Revisão gerada. Confira as sugestões da IA.";
  return "IA concluiu. Revise o resultado antes de publicar.";
}

function findProduct(id) {
  return state.products.find((product) => product.id === id || product.sku === id);
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

function hasValidPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
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
