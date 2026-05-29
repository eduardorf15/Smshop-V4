import { getAdminProducts } from "./productService.js";

const manualPriceReviewAgeMs = Number(process.env.ADMIN_MANUAL_PRICE_REVIEW_DAYS || 7) * 24 * 60 * 60 * 1000;

export async function getAdminAlerts() {
  const products = await getAdminProducts();
  const alerts = [];

  products.forEach((product) => {
    if (product.syncStatus === "partial") {
      alerts.push(buildAlert(product, "partial", "Produto partial", "Preco ou dados incompletos no Mercado Livre."));
    }
    if (product.syncStatus === "error") {
      alerts.push(buildAlert(product, "error", "Erro de sync", product.syncError || "Falha ao sincronizar com Mercado Livre."));
    }
    if (product.dataSource === "manual" || product.importedManual) {
      alerts.push(buildAlert(product, "manual", "Produto manual", "Produto depende de dados preenchidos manualmente."));
    }
    if (!product.affiliateUrl) {
      alerts.push(buildAlert(product, "missing-affiliate", "Sem link afiliado", "Adicionar affiliateUrl antes de promover este item."));
    }
    if (!isValidPrice(product.price)) {
      alerts.push(buildAlert(product, "missing-price", "Sem preco", "Produto sem preco valido para exibicao."));
    }
    if (!hasValidImage(product)) {
      alerts.push(buildAlert(product, "missing-image", "Sem imagem", "Produto sem imagem real cadastrada."));
    }
    if (!String(product.description || "").trim()) {
      alerts.push(buildAlert(product, "missing-description", "Sem descricao", "Produto sem descricao publicada."));
    }
    if (isApiBlocked(product)) {
      alerts.push(buildAlert(product, "api-blocked", "API Mercado Livre bloqueada", "Mercado Livre bloqueou o acesso automatico a este produto. Use cadastro assistido por IA."));
    }
    if (hasOldManualPrice(product)) {
      alerts.push(buildAlert(product, "old-manual-price", "Revisar preco manual", "Preco manual antigo porque a API do Mercado Livre nao confirmou valor recente."));
    }
    if (needsPriceReview(product)) {
      alerts.push(buildAlert(product, "price-review", "Preco precisa revisao", "Produto com fallback, erro ou partial usando preco local."));
    }
    if (hasSuspiciousAffiliateUrl(product)) {
      alerts.push(buildAlert(product, "affiliate-warning", "Link afiliado possivelmente invalido", "Confira se o link informado e um link de compra/afiliado valido."));
    }
    if (product.syncWarning) {
      alerts.push(buildAlert(product, "sync-warning", "Preco manual porque ML bloqueou API", product.syncWarning));
    }
  });

  return {
    total: alerts.length,
    products: groupAlertsByProduct(alerts),
    alerts
  };
}

function buildAlert(product, type, title, message) {
  return {
    type,
    title,
    message,
    productId: product.id,
    productName: product.name,
    price: product.price ?? null,
    affiliateUrl: product.affiliateUrl || null,
    syncStatus: product.syncStatus || "fallback",
    dataSource: product.dataSource || "manual",
    severity: ["error", "missing-affiliate", "missing-price", "missing-image", "api-blocked"].includes(type) ? "high" : "medium"
  };
}

function groupAlertsByProduct(alerts) {
  const map = new Map();
  alerts.forEach((alert) => {
    const current = map.get(alert.productId) || {
      id: alert.productId,
      name: alert.productName,
      price: alert.price,
      affiliateUrl: alert.affiliateUrl,
      syncStatus: alert.syncStatus,
      dataSource: alert.dataSource,
      alerts: []
    };
    current.alerts.push({
      type: alert.type,
      title: alert.title,
      message: alert.message,
      severity: alert.severity
    });
    map.set(alert.productId, current);
  });
  return [...map.values()];
}

function isValidPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0;
}

function hasValidImage(product) {
  const images = [product.heroImage, ...(Array.isArray(product.images) ? product.images : [])]
    .map((image) => String(image || "").trim())
    .filter(Boolean);
  return images.some((image) => !/logo\/logo\.png|placeholder|favicon/i.test(image));
}

function isApiBlocked(product) {
  return product.syncStatus === "api-blocked" ||
    product.dataSource === "api-blocked" ||
    product.syncMethod === "api-blocked" ||
    /bloqueou|blocked|denied|403/i.test(String(product.syncWarning || ""));
}

function needsPriceReview(product) {
  if (!product.meliId) return false;
  return ["partial", "error", "fallback"].includes(product.syncStatus) || product.dataSource === "mercadolivre-partial";
}

function hasOldManualPrice(product) {
  if (!isValidPrice(product.price) || !needsPriceReview(product)) return false;
  const sourceDate = product.manualDataUpdatedAt || product.updatedAt || product.importedAt;
  if (!sourceDate) return true;
  const time = Date.parse(sourceDate);
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > manualPriceReviewAgeMs;
}

function hasSuspiciousAffiliateUrl(product) {
  if (!product.affiliateUrl) return false;
  let url;
  try {
    url = new URL(product.affiliateUrl);
  } catch {
    return true;
  }
  const host = url.hostname.replace(/^www\./, "");
  return !["meli.la", "mercadolivre.com.br", "mercadolibre.com", "mercadolivre.com"].some((domain) => host === domain || host.endsWith(`.${domain}`));
}
