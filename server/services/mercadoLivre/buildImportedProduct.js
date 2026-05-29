export function buildImportedProduct({
  existingProduct = null,
  mercadoLivreData = null,
  normalizedInput = null,
  sourceInput = "",
  meliId = "",
  category = "Tecnologia",
  affiliateUrl = "",
  tags = [],
  featured = false,
  available = true,
  manualPrice = null
} = {}) {
  const data = normalizeFoundData(mercadoLivreData);
  const preserveManual = Boolean(existingProduct?.manualDataUpdatedAt);
  const id = existingProduct?.id || `meli-${String(meliId || data.itemId || data.catalogId || Date.now()).toLowerCase()}`;
  const sku = existingProduct?.sku || `meli-${meliId || data.itemId || data.catalogId || "produto"}`;
  const manualImages = normalizeImages(existingProduct?.images).filter(isValidImage);
  const mlImages = data.images.filter(isValidImage);
  const images = preserveManual && manualImages.length ? manualImages : mlImages.length ? mlImages : manualImages;
  const title = preserveManual
    ? meaningfulText(existingProduct?.name) || data.title || fallbackTitle(meliId)
    : data.title || meaningfulText(existingProduct?.name) || fallbackTitle(meliId);
  const description = preserveManual
    ? meaningfulText(existingProduct?.description) || data.description || title
    : data.description || meaningfulText(existingProduct?.description) || title;
  const price = positiveNumber(manualPrice) || data.price || positiveNumber(existingProduct?.price);
  const heroImage = preserveManual
    ? validImage(existingProduct?.heroImage) || manualImages[0] || data.heroImage || images[0] || fallbackImage()
    : data.heroImage || images[0] || validImage(existingProduct?.heroImage) || manualImages[0] || fallbackImage();
  const categorySlug = slugify(category || existingProduct?.category || "Tecnologia");
  const syncStatus = data.title && images.length && price ? "synced" : "partial";
  const fallbackTriggers = [
    data.title ? "" : "title",
    images.length ? "" : "image",
    price ? "" : "price"
  ].filter(Boolean);

  const product = {
    id,
    sku,
    name: title,
    description,
    price,
    oldPrice: data.oldPrice ?? existingProduct?.oldPrice ?? null,
    images,
    heroImage,
    affiliateUrl,
    category,
    categorySlug,
    categoryTags: [categorySlug],
    productType: category || existingProduct?.productType || "Tecnologia",
    productTypeSlug: slugify(category || existingProduct?.productType || "Tecnologia"),
    badge: existingProduct?.badge || "Importado",
    tags: [...new Set(normalizeTags(tags))],
    syncStatus,
    dataSource: syncStatus === "synced" ? dataSource(data.source, data.type) : "mercadolivre-partial",
    meliId,
    meliType: data.type || normalizedInput?.meliType || null,
    itemId: data.itemId || normalizedInput?.itemId || (data.type === "item" ? meliId : null),
    catalogProductId: data.catalogId || normalizedInput?.catalogId || (data.type === "catalog_product" ? meliId : null),
    sourceInput: String(sourceInput || normalizedInput?.originalInput || "").trim(),
    resolvedUrl: data.resolvedUrl || normalizedInput?.resolvedUrl || null,
    mercadoLivrePermalink: data.permalink || data.resolvedUrl || normalizedInput?.resolvedUrl || null,
    seller: data.seller || null,
    attributes: data.attributes || [],
    available: Boolean(available ?? data.available ?? existingProduct?.available ?? true),
    featured: Boolean(featured),
    importedFromMercadoLivre: true,
    importedAt: existingProduct?.importedAt || new Date().toISOString(),
    syncedAt: data.fetchedAt || new Date().toISOString(),
    syncMethod: data.syncMethod || data.source || "mercadolivre-pipeline",
    titleSource: data.titleSource || null,
    imageSource: data.imageSource || null,
    priceSource: data.priceSource || null,
    syncWarnings: buildWarnings(fallbackTriggers, data),
    manualPriceOverride: Boolean(positiveNumber(manualPrice)),
    dataQuality: {
      confidence: data.confidence,
      source: data.source,
      fallbackTriggers
    }
  };

  if (product.syncWarnings.length) product.syncWarning = product.syncWarnings[0];
  if (data.price) {
    product.mercadoLivreRawPrice = data.price;
    product.mercadoLivreParsedPrice = data.price;
  }
  return product;
}

export function normalizeFoundData(data) {
  const images = [
    validImage(data?.thumbnail),
    ...normalizeImages(data?.images),
    validImage(data?.heroImage)
  ].filter(Boolean);
  const uniqueImages = [...new Set(images)].filter(isValidImage);
  const price = positiveNumber(data?.price);
  return {
    title: meaningfulText(data?.title || data?.name),
    description: meaningfulText(data?.description || data?.summary),
    price,
    oldPrice: positiveNumber(data?.oldPrice),
    images: uniqueImages,
    heroImage: uniqueImages[0] || "",
    permalink: data?.permalink || null,
    resolvedUrl: data?.resolvedUrl || null,
    seller: data?.seller || null,
    attributes: Array.isArray(data?.attributes) ? data.attributes : [],
    source: data?.source || data?.syncMethod || "mercadolivre",
    syncMethod: data?.syncMethod || data?.source || null,
    titleSource: data?.titleSource || null,
    imageSource: data?.imageSource || null,
    priceSource: data?.priceSource || null,
    confidence: Number(data?.confidence || 0),
    type: data?.type || null,
    itemId: data?.itemId || null,
    catalogId: data?.catalogId || data?.catalogProductId || null,
    available: data?.available,
    fetchedAt: data?.fetchedAt || null
  };
}

export function isValidImage(value) {
  const image = String(value || "").trim();
  return /^https?:\/\//i.test(image) && !/logo\/logo\.png|placeholder|favicon|apple-touch-icon/i.test(image);
}

export function meaningfulText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^Produto Mercado Livre .*revisar/i.test(text)) return "";
  if (/^(mercado\s*livre|mercadolivre|produto\s+mercado\s+livre|mercado\s*livre\s+brasil)$/i.test(text)) return "";
  return text;
}

function normalizeImages(images) {
  if (!images) return [];
  if (typeof images === "string") return images.split(/\n|,/).map((image) => image.trim()).filter(Boolean);
  if (Array.isArray(images)) return images.flatMap(normalizeImages);
  if (typeof images === "object") return normalizeImages(images.secure_url || images.url || images.src);
  return [];
}

function validImage(value) {
  return isValidImage(value) ? String(value).trim() : "";
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function fallbackTitle(meliId) {
  return meliId ? `Produto Mercado Livre ${meliId} - revisar título` : "Mercado Livre";
}

function fallbackImage() {
  return "/imagens/logo/logo.png";
}

function buildWarnings(fallbackTriggers, data) {
  const warnings = [];
  if (data.price) warnings.push(`Preço puxado de ${data.source}`);
  if (fallbackTriggers.includes("title")) warnings.push("Título não encontrado, revise manualmente");
  if (fallbackTriggers.includes("image")) warnings.push("Imagem não encontrada, revise manualmente");
  if (fallbackTriggers.includes("price")) warnings.push("Preço não encontrado, não salvando preço 0");
  return warnings;
}

function dataSource(source, type) {
  if (type === "item" || /item/i.test(source || "")) return "mercadolivre-item";
  if (type === "catalog_product" || /catalog/i.test(source || "")) return "mercadolivre";
  if (/html/i.test(source || "")) return "mercadolivre-html";
  if (/search/i.test(source || "")) return "mercadolivre-search";
  return "mercadolivre";
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof tags === "string") return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
