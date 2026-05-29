import { getAuthDebugStatus, getValidAccessToken } from "../mercadoLivreAuthService.js";
import { detectIdKind, normalizeMercadoLivreInput } from "./normalizeInput.js";

const requestTimeoutMs = Number(process.env.MELI_REQUEST_TIMEOUT_MS || 10000);
const maxRetries = Number(process.env.MELI_REQUEST_RETRIES || 2);

export async function fetchMercadoLivreData(input, options = {}) {
  const normalizedInput = typeof input === "object" && input?.originalInput ? input : await normalizeMercadoLivreInput(input);
  const trace = options.trace || createTrace(normalizedInput);
  const auth = await buildAuthContext();
  trace.auth = auth.debug;
  let merged = emptyPayload("none");

  const itemId = normalizedInput.itemId || (detectIdKind(normalizedInput.meliId) === "item" ? normalizedInput.meliId : null);
  if (itemId) {
    const item = await fetchApiItem(itemId, auth, trace);
    merged = mergePayloads(merged, item);
    if (!normalizedInput.catalogId && item?.catalogId) normalizedInput.catalogId = item.catalogId;
  }

  const catalogId = normalizedInput.catalogId || (detectIdKind(normalizedInput.meliId) === "catalog" ? normalizedInput.meliId : null);
  if (catalogId && needsMoreData(merged)) {
    merged = mergePayloads(merged, await fetchApiCatalog(catalogId, auth, trace));
    merged = mergePayloads(merged, await fetchCatalogItems(catalogId, auth, trace));
  }

  if (needsMoreData(merged)) {
    merged = mergePayloads(merged, await fetchSearchFallback(normalizedInput, merged, auth, trace));
  }

  const finalPayload = finalizePayload(merged, normalizedInput);
  finalPayload.officialAccessDenied = officialAccessDenied(trace);
  finalPayload.apiBlocked = finalPayload.officialAccessDenied;
  if (finalPayload.officialAccessDenied) {
    finalPayload.blockedReason = "Mercado Livre negou acesso oficial a este recurso.";
  }
  trace.parsedFields = summarizePayload(finalPayload);
  return options.withTrace ? { data: finalPayload, trace } : finalPayload;
}

function createTrace(normalizedInput) {
  return {
    normalizedInput,
    attempts: [],
    titleCandidates: [],
    imageCandidates: [],
    priceCandidates: [],
    htmlExtraction: null,
    parsedFields: null,
    auth: null,
    fallbackTriggers: []
  };
}

async function fetchApiItem(itemId, auth, trace) {
  const encodedId = encodeURIComponent(itemId);
  const [item, itemWithAttributes, description, pictures] = await Promise.all([
    fetchMeliResource(`items/${encodedId}`, auth, trace),
    fetchMeliResource(`items/${encodedId}?include_attributes=all`, auth, trace),
    fetchMeliResource(`items/${encodedId}/description`, auth, trace),
    fetchMeliResource(`items/${encodedId}/pictures`, auth, trace)
  ]);
  const itemData = item.ok ? item.data : itemWithAttributes.ok ? itemWithAttributes.data : null;
  if (!itemData && !description.ok && !pictures.ok) return null;
  const payload = fromApiItem(itemData || { id: itemId }, description.ok ? description.data : null, pictures.ok ? pictures.data : null);
  recordPayloadCandidates(trace, payload, `api/items/${itemId}`);
  return payload;
}

async function fetchApiCatalog(catalogId, auth, trace) {
  const product = await fetchMeliResource(`products/${encodeURIComponent(catalogId)}`, auth, trace);
  if (!product.ok) return null;
  const payload = fromApiCatalog(product.data);
  recordPayloadCandidates(trace, payload, `api/products/${catalogId}`);
  return payload;
}

async function fetchCatalogItems(catalogId, auth, trace) {
  const endpoints = [
    `products/${encodeURIComponent(catalogId)}/items`,
    `sites/MLB/search?catalog_product_id=${encodeURIComponent(catalogId)}`
  ];
  const responses = await Promise.all(endpoints.map((endpoint) => fetchMeliResource(endpoint, auth, trace)));
  const offers = responses.flatMap((response) => response.ok ? extractOffers(response.data).map(fromOffer).filter(Boolean) : []);
  const best = offers.filter((offer) => offer.price).sort((a, b) => Number(a.price) - Number(b.price))[0] || offers[0] || null;
  recordPayloadCandidates(trace, best, `api/catalog-items/${catalogId}`);
  return best ? { ...best, source: "catalog/items", confidence: confidence(best) } : null;
}

async function fetchSearchFallback(normalizedInput, current, auth, trace) {
  const query = buildSearchQuery(normalizedInput, current);
  if (!query) return null;
  const endpoints = [
    `sites/MLB/search?q=${encodeURIComponent(query)}`,
    `sites/MLB/search?nickname=${encodeURIComponent(current?.seller?.nickname || query)}`
  ];
  const responses = await Promise.all(endpoints.map((endpoint) => fetchMeliResource(endpoint, auth, trace)));
  const offers = responses.flatMap((response) => response.ok ? extractOffers(response.data).map(fromOffer).filter(Boolean) : []);
  const best = offers
    .map((offer) => ({ offer, score: similarity(query, offer.title) + (offer.price ? 0.2 : 0) + (offer.images.length ? 0.1 : 0) }))
    .sort((a, b) => b.score - a.score)[0]?.offer || null;
  recordPayloadCandidates(trace, best, `api/search/${query}`);
  return best ? { ...best, source: "search", confidence: confidence(best) } : null;
}

async function fetchMeliResource(pathname, auth, trace, options = {}) {
  const url = `https://api.mercadolibre.com/${pathname}`;
  if (!auth.headers.Authorization && !options.diagnostic) {
    recordAttempt(trace, {
      layer: "api",
      method: "GET",
      url,
      status: 0,
      ok: false,
      authMode: "fallback",
      authorizationSent: false,
      details: "API oficial ignorada: Mercado Livre OAuth não conectado"
    });
    return { ok: false, status: 0, details: "OAuth Mercado Livre não conectado" };
  }

  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(url, { headers: auth.headers, signal: controller.signal });
      const { data, responseBody } = await readApiResponseBody(response);
      const attempt = {
        layer: options.diagnostic ? "api-diagnostic" : "api",
        method: "GET",
        url: sanitizeApiUrl(url),
        status: response.status,
        ok: response.ok,
        authMode: options.authMode || auth.debug.authMode,
        diagnosticMode: options.diagnosticMode || null,
        authorizationSent: Boolean(auth.headers.Authorization),
        authorizationScheme: auth.headers.Authorization ? "Bearer" : null,
        details: response.ok ? "ok" : summarizeApiError(data, response.status),
        responseBody
      };
      recordAttempt(trace, attempt);
      if (response.ok) return { ok: true, data };
      lastError = summarizeApiError(data, response.status);
      if (response.status === 403 && auth.accessToken && !options.diagnostic) {
        await runApi403Diagnostics(pathname, auth, trace, attempt);
      }
      if (![408, 429].includes(response.status) && response.status < 500) return { ok: false, status: response.status, details: lastError };
    } catch (error) {
      lastError = error.message;
      recordAttempt(trace, {
        layer: options.diagnostic ? "api-diagnostic" : "api",
        method: "GET",
        url: sanitizeApiUrl(url),
        status: 0,
        ok: false,
        authMode: options.authMode || auth.debug.authMode,
        diagnosticMode: options.diagnosticMode || null,
        authorizationSent: Boolean(auth.headers.Authorization),
        authorizationScheme: auth.headers.Authorization ? "Bearer" : null,
        details: error.message
      });
    } finally {
      clearTimeout(timeout);
    }
    await wait(200 * (attempt + 1));
  }
  return { ok: false, status: 0, details: lastError || "Falha de rede Mercado Livre" };
}

async function runApi403Diagnostics(pathname, auth, trace, authorizedAttempt) {
  recordAttempt(trace, {
    layer: "api-diagnostic",
    method: "CHECK",
    url: authorizedAttempt.url,
    status: authorizedAttempt.status,
    ok: false,
    authMode: auth.debug.authMode,
    diagnosticMode: "authorized-comparison",
    authorizationSent: authorizedAttempt.authorizationSent,
    authorizationScheme: authorizedAttempt.authorizationScheme,
    details: authorizedAttempt.authorizationSent
      ? "Authorization header enviado como Bearer; resposta oficial foi 403."
      : "Authorization header nao enviado.",
    responseBody: authorizedAttempt.responseBody
  });

  await fetchMeliResource(pathname, { ...auth, headers: { Accept: "application/json" } }, trace, {
    diagnostic: true,
    diagnosticMode: "without-authorization",
    authMode: "anonymous"
  });

  const separator = pathname.includes("?") ? "&" : "?";
  await fetchMeliResource(`${pathname}${separator}access_token=${encodeURIComponent(auth.accessToken)}`, {
    ...auth,
    headers: { Accept: "application/json" }
  }, trace, {
    diagnostic: true,
    diagnosticMode: "query-access-token",
    authMode: "oauth-query"
  });
}

async function readApiResponseBody(response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return { data: {}, responseBody: null };
  try {
    const data = JSON.parse(raw);
    return { data, responseBody: data };
  } catch {
    return { data: {}, responseBody: raw };
  }
}

function sanitizeApiUrl(url) {
  return String(url || "").replace(/([?&]access_token=)[^&]+/i, "$1***");
}

function officialAccessDenied(trace) {
  const apiAttempts = (trace?.attempts || []).filter((attempt) => attempt.layer === "api");
  return apiAttempts.some((attempt) => attempt.status === 403);
}

function fromApiItem(item, descriptionData = null, picturesData = null) {
  if (!item) return null;
  const images = [...new Set([...getPictures(item), ...normalizePicturesEndpoint(picturesData)])];
  return {
    title: cleanText(item.title),
    description: cleanText(descriptionData?.plain_text || descriptionData?.text || ""),
    price: extractPrice(item),
    oldPrice: firstPositive([item.original_price, item.base_price]),
    images,
    thumbnail: item.secure_thumbnail || item.thumbnail || images[0] || null,
    permalink: item.permalink || null,
    seller: normalizeSeller(item.seller || item.seller_id),
    attributes: Array.isArray(item.attributes) ? item.attributes : [],
    source: item.title || extractPrice(item) || images.length ? "api:item" : "api:item-description",
    titleSource: item.title ? "api:item.title" : null,
    imageSource: images.length ? "api:item.pictures" : null,
    priceSource: extractPrice(item) ? "api:item.price" : null,
    confidence: 0.95,
    itemId: item.id || null,
    catalogId: item.catalog_product_id || null,
    available: item.status === "active" || Number(item.available_quantity || 0) > 0,
    status: item.status || null,
    stock: Number(item.available_quantity || 0),
    soldQuantity: Number(item.sold_quantity || 0),
    fetchedAt: new Date().toISOString()
  };
}

function normalizePicturesEndpoint(data) {
  if (!data) return [];
  if (Array.isArray(data)) return normalizeImages(data);
  if (Array.isArray(data.pictures)) return normalizeImages(data.pictures);
  return normalizeImages(data);
}

function fromApiCatalog(product) {
  if (!product) return null;
  const winner = product.buy_box_winner || {};
  const images = getPictures(product);
  return {
    title: cleanText(product.name || product.title),
    description: cleanText(product.short_description?.content || product.description || ""),
    price: firstPositive([extractPrice(product), extractPrice(winner)]),
    oldPrice: firstPositive([extractOldPrice(product), extractOldPrice(winner)]),
    images,
    thumbnail: product.thumbnail || winner.thumbnail || images[0] || null,
    permalink: product.permalink || winner.permalink || null,
    seller: normalizeSeller(winner.seller || winner.seller_id),
    attributes: Array.isArray(product.attributes) ? product.attributes : [],
    source: "api:catalog",
    titleSource: product.name || product.title ? "api:catalog.title" : null,
    imageSource: images.length || product.thumbnail || winner.thumbnail ? "api:catalog.pictures" : null,
    priceSource: firstPositive([extractPrice(product), extractPrice(winner)]) ? "api:catalog.price" : null,
    confidence: 0.9,
    catalogId: product.id || null,
    itemId: winner.item_id || winner.id || null,
    available: winner.status === "active" || Number(winner.available_quantity || product.available_quantity || 0) > 0,
    status: winner.status || product.status || null,
    stock: Number(winner.available_quantity || product.available_quantity || 0),
    soldQuantity: Number(winner.sold_quantity || product.sold_quantity || 0),
    fetchedAt: new Date().toISOString()
  };
}

function fromOffer(offer) {
  const item = offer?.item || offer;
  if (!item || typeof item !== "object") return null;
  const images = normalizeImages([item.secure_thumbnail, item.thumbnail, ...(item.pictures || [])]);
  return {
    title: cleanText(item.title || item.name),
    description: cleanText(item.description || ""),
    price: extractPrice(item),
    oldPrice: extractOldPrice(item),
    images,
    thumbnail: images[0] || null,
    permalink: item.permalink || null,
    seller: normalizeSeller(item.seller || item.seller_id),
    attributes: Array.isArray(item.attributes) ? item.attributes : [],
    source: item.source || "offer",
    titleSource: item.title || item.name ? `${item.source || "offer"}.title` : null,
    imageSource: images.length ? `${item.source || "offer"}.thumbnail` : null,
    priceSource: extractPrice(item) ? `${item.source || "offer"}.price` : null,
    confidence: 0.75,
    itemId: item.item_id || item.id || null,
    catalogId: item.catalog_product_id || null,
    available: item.status === "active" || Number(item.available_quantity || 0) > 0,
    status: item.status || null,
    stock: Number(item.available_quantity || 0),
    soldQuantity: Number(item.sold_quantity || 0),
    fetchedAt: new Date().toISOString()
  };
}

function mergePayloads(base, extra) {
  if (!extra) return base;
  if (!base || base.source === "none") return normalizePayload(extra);
  const a = normalizePayload(base);
  const b = normalizePayload(extra);
  return {
    title: cleanTitle(a.title) || cleanTitle(b.title),
    description: cleanText(a.description) || cleanText(b.description),
    price: a.price || b.price || null,
    oldPrice: a.oldPrice || b.oldPrice || null,
    images: a.images.length ? a.images : b.images,
    thumbnail: isValidImage(a.thumbnail) ? a.thumbnail : b.thumbnail,
    permalink: a.permalink || b.permalink || null,
    seller: a.seller || b.seller || null,
    attributes: a.attributes.length ? a.attributes : b.attributes,
    source: [a.source, b.source].filter(Boolean).join("+"),
    titleSource: cleanTitle(a.title) ? a.titleSource : b.titleSource,
    imageSource: a.images.length || isValidImage(a.thumbnail) ? a.imageSource : b.imageSource,
    priceSource: a.price ? a.priceSource : b.priceSource,
    confidence: Math.max(Number(a.confidence || 0), Number(b.confidence || 0)),
    itemId: a.itemId || b.itemId || null,
    catalogId: a.catalogId || b.catalogId || null,
    available: a.available ?? b.available ?? null,
    status: a.status || b.status || null,
    stock: a.stock ?? b.stock ?? null,
    soldQuantity: a.soldQuantity ?? b.soldQuantity ?? null,
    fetchedAt: a.fetchedAt || b.fetchedAt || new Date().toISOString()
  };
}

function finalizePayload(payload, normalizedInput) {
  const normalized = normalizePayload(payload);
  normalized.thumbnail = normalized.thumbnail || normalized.images[0] || null;
  normalized.permalink = normalized.permalink || normalizedInput.resolvedUrl || (normalizedInput.itemId ? `https://produto.mercadolivre.com.br/${normalizedInput.itemId.replace(/^MLB/i, "MLB-")}` : null);
  normalized.itemId = normalized.itemId || normalizedInput.itemId || null;
  normalized.catalogId = normalized.catalogId || normalizedInput.catalogId || null;
  normalized.catalogProductId = normalized.catalogId;
  normalized.type = normalized.itemId ? "item" : normalized.catalogId ? "catalog_product" : "unknown";
  normalized.resolvedUrl = normalizedInput.resolvedUrl || normalized.permalink || null;
  normalized.sourceInput = normalizedInput.originalInput;
  normalized.syncStatus = normalized.title && normalized.images.length && normalized.price ? "synced" : "partial";
  normalized.syncMethod = normalized.source && normalized.source !== "none" ? "official-api" : "api-blocked";
  return normalized;
}

function normalizePayload(payload) {
  return {
    title: cleanTitle(payload?.title),
    description: cleanText(payload?.description),
    price: parsePrice(payload?.price),
    oldPrice: parsePrice(payload?.oldPrice),
    images: [...new Set(normalizeImages(payload?.images).filter(isValidImage))],
    thumbnail: absolutizeImage(payload?.thumbnail),
    permalink: cleanText(payload?.permalink),
    seller: payload?.seller || null,
    attributes: Array.isArray(payload?.attributes) ? payload.attributes : [],
    source: payload?.source || "",
    titleSource: payload?.titleSource || (payload?.title ? payload?.source : null),
    imageSource: payload?.imageSource || (payload?.images?.length || payload?.thumbnail ? payload?.source : null),
    priceSource: payload?.priceSource || (payload?.price ? payload?.source : null),
    confidence: Number(payload?.confidence || 0),
    itemId: payload?.itemId || null,
    catalogId: payload?.catalogId || payload?.catalogProductId || null,
    available: payload?.available,
    status: payload?.status || null,
    stock: payload?.stock,
    soldQuantity: payload?.soldQuantity,
    fetchedAt: payload?.fetchedAt || new Date().toISOString()
  };
}

function needsMoreData(payload) {
  const data = normalizePayload(payload);
  return !data.title || !data.images.length || !data.price;
}

function emptyPayload(source) {
  return { source, title: "", description: "", price: null, oldPrice: null, images: [], thumbnail: null, permalink: null, seller: null, attributes: [], confidence: 0 };
}

function buildSearchQuery(input, current) {
  return cleanTitle(current.title) || cleanText(input.slug).replace(/-/g, " ") || input.itemId || input.catalogId || "";
}

function meta($, attr, value) {
  return $(`meta[${attr}='${value}']`).attr("content") || $(`meta[${attr}="${value}"]`).attr("content") || "";
}

function extractNextData($) {
  const raw = $("script#__NEXT_DATA__").first().contents().text();
  return raw ? parseJsonCandidates(raw) : [];
}

function extractAssignedJson(text, marker) {
  const index = String(text || "").indexOf(marker);
  if (index < 0) return [];
  const start = text.indexOf("{", index);
  const json = extractBalancedObject(text, start);
  return json ? parseJsonCandidates(json) : [];
}

function extractBalancedObject(text, start) {
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return "";
}

function parseJsonCandidates(raw) {
  try {
    const parsed = JSON.parse(String(raw || "").trim());
    return Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [])];
  } catch {
    return [];
  }
}

function findProductNode(nodes) {
  return nodes.find((node) => String(node?.["@type"] || "").toLowerCase().includes("product")) || nodes.find((node) => node?.offers || node?.image || node?.name) || null;
}

function collectScriptValues(objects, text) {
  return {
    title: findString(objects, ["title", "name"]),
    description: findString(objects, ["description", "subtitle"]),
    price: firstPositive([findPrice(objects), ...extractScriptPrices(text)]),
    images: [...new Set([...findImages(objects), ...extractScriptImages(text)])]
  };
}

function extractSocialPolycardPayload(objects) {
  const cards = findArraysByKey(objects, "polycards").flat().filter((card) => card?.metadata?.id);
  for (const card of cards) {
    const title = findComponent(card, "title")?.title?.text || "";
    const priceComponent = findComponent(card, "price")?.price || {};
    const price = parsePrice(priceComponent.current_price?.value || priceComponent.value || priceComponent.previous_price?.value);
    const oldPrice = parsePrice(priceComponent.previous_price?.value);
    const imageIds = card.pictures?.pictures?.map((picture) => picture.id).filter(Boolean) || [];
    const images = imageIds.map((id) => `https://http2.mlstatic.com/D_NQ_NP_${id}-O.webp`).filter(isValidImage);
    if (!cleanTitle(title) || !images.length) continue;
    const metadata = card.metadata || {};
    return {
      title: cleanTitle(title),
      description: cleanTitle(title),
      price,
      oldPrice,
      images,
      thumbnail: images[0] || null,
      permalink: buildSocialCardUrl(metadata),
      seller: null,
      attributes: [],
      itemId: metadata.id || null,
      catalogId: metadata.product_id || null,
      titleSource: "social polycard title",
      imageSource: "social polycard image",
      priceSource: "social polycard price",
      available: true,
      fetchedAt: new Date().toISOString()
    };
  }
  return null;
}

function findComponent(card, type) {
  return (card.components || []).find((component) => component.type === type || component.id === type) || null;
}

function buildSocialCardUrl(metadata) {
  const base = metadata.url ? `https://${String(metadata.url).replace(/^https?:\/\//, "")}` : "";
  return `${base}${metadata.url_params || ""}${metadata.url_fragments || ""}` || null;
}

function findArraysByKey(value, key) {
  if (Array.isArray(value)) return value.flatMap((item) => findArraysByKey(item, key));
  if (!value || typeof value !== "object") return [];
  const direct = Array.isArray(value[key]) ? [value[key]] : [];
  return [...direct, ...Object.values(value).slice(0, 160).flatMap((child) => findArraysByKey(child, key))];
}

function findString(value, keys) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys);
      if (found) return found;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    if (typeof value[key] === "string" && cleanText(value[key])) return cleanText(value[key]);
  }
  for (const child of Object.values(value).slice(0, 120)) {
    const found = findString(child, keys);
    if (found) return found;
  }
  return "";
}

function findImages(value) {
  if (Array.isArray(value)) return value.flatMap(findImages);
  if (!value || typeof value !== "object") return [];
  const direct = ["image", "images", "picture", "pictures", "thumbnail", "secure_thumbnail"]
    .flatMap((key) => normalizeImages(value[key]));
  return [...direct, ...Object.values(value).slice(0, 120).flatMap(findImages)].filter((image) => /mlstatic\.com/i.test(image));
}

function findPrice(value) {
  if (Array.isArray(value)) return firstPositive(value.map(findPrice));
  if (!value || typeof value !== "object") return null;
  const direct = firstPositive([
    value.price,
    value.amount,
    value.current_price?.amount,
    value.sale_price?.amount,
    value.offers?.price,
    value.offers?.lowPrice,
    value.buy_box_winner?.price,
    value.buy_box_winner?.sale_price?.amount
  ]);
  if (direct) return direct;
  return firstPositive(Object.values(value).slice(0, 120).map(findPrice));
}

function extractScriptPrices(text) {
  const values = [];
  const patterns = [
    /"price"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/gi,
    /"amount"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/gi,
    /"priceAmount"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/gi,
    /"itemPrice"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/gi,
    /"formatted_amount"\s*:\s*"R\$\s*([0-9.]+,[0-9]{2})"/gi,
    /"price_tag"[\s\S]{0,240}?"amount"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/gi,
    /"current_price"[\s\S]{0,180}?"value"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/gi,
    /"current_price"[\s\S]{0,180}?"amount"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/gi,
    /"offers"[\s\S]{0,500}?"price"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/gi
  ];
  patterns.forEach((pattern) => {
    for (const match of String(text || "").matchAll(pattern)) values.push(match[1]);
  });
  return values.map(parsePrice).filter(Boolean);
}

function extractScriptImages(text) {
  return [...String(text || "").matchAll(/https?:\\?\/\\?\/[^"'\\\s]+(?:jpg|jpeg|png|webp)/gi)]
    .map((match) => absolutizeImage(match[0]))
    .filter((image) => /mlstatic\.com/i.test(image));
}

function extractVisiblePrices($) {
  const text = $("body").text().replace(/\s+/g, " ");
  return [...text.matchAll(/R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:,[0-9]{2})?)/g)]
    .map((match) => match[1])
    .slice(0, 20);
}

function getPictures(item) {
  return normalizeImages([item.secure_thumbnail, item.thumbnail, ...(Array.isArray(item.pictures) ? item.pictures : [])]);
}

function normalizeImages(images) {
  if (!images) return [];
  if (typeof images === "string") return [absolutizeImage(images)];
  if (Array.isArray(images)) return images.flatMap(normalizeImages);
  if (typeof images === "object") return normalizeImages(images.secure_url || images.url || images.src);
  return [];
}

function absolutizeImage(value) {
  const image = String(value || "").trim().replaceAll("\\/", "/");
  if (image.startsWith("//")) return `https:${image}`;
  return image;
}

function isValidImage(value) {
  const image = absolutizeImage(value);
  return /^https?:\/\//i.test(image) && !/logo|favicon|apple-touch-icon|placeholder/i.test(image);
}

function extractOffers(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.sellers)) return data.sellers.map((seller) => seller.item || seller).filter(Boolean);
  return [];
}

function extractPrice(data) {
  return firstPositive([
    data?.price,
    data?.current_price,
    data?.current_price?.amount,
    data?.amount,
    data?.sale_price?.amount,
    data?.installments?.amount,
    data?.buy_box_winner?.price,
    data?.buy_box_winner?.sale_price?.amount
  ]);
}

function extractOldPrice(data) {
  return firstPositive([data?.original_price, data?.base_price, data?.sale_price?.regular_amount]);
}

function parsePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 1 && value <= 50000 ? value : null;
  const text = String(value).trim();
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const number = Number(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number >= 1 && number <= 50000 ? number : null;
}

function firstPositive(values) {
  for (const value of values.flat()) {
    const number = parsePrice(value);
    if (number) return number;
  }
  return null;
}

function cleanTitle(value) {
  const text = cleanText(value)
    .replace(/\s*\|\s*Mercado Livre.*$/i, "")
    .replace(/\s*-\s*Mercado Livre.*$/i, "");
  if (/^(mercado\s*livre|mercadolivre|produto\s+mercado\s+livre|mercado\s*livre\s+brasil)$/i.test(text)) return "";
  if (/^ML[A-Z]{1,2}\d{3,}$/i.test(text)) return "";
  return text;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSeller(value) {
  if (!value && value !== 0) return null;
  if (typeof value === "object") return { id: value.id || value.seller_id || null, nickname: value.nickname || value.name || null };
  return { id: value, nickname: null };
}

function confidence(payload) {
  return Number(((payload.title ? 0.35 : 0) + (payload.images?.length ? 0.3 : 0) + (payload.price ? 0.3 : 0) + (payload.description ? 0.05 : 0)).toFixed(2));
}

function recordAttempt(trace, attempt) {
  trace?.attempts?.push({ at: new Date().toISOString(), ...attempt });
}

function recordCandidate(trace, key, item, accepted) {
  if (!trace) return;
  const parsed = key === "priceCandidates" ? parsePrice(item.value) : undefined;
  trace[key].push({ source: item.source, value: item.value || null, parsed, accepted, reason: accepted ? "válido" : "vazio, genérico ou inválido" });
}

function recordPayloadCandidates(trace, payload, source) {
  if (!trace || !payload) return;
  recordCandidate(trace, "titleCandidates", candidate(source, payload.title), Boolean(cleanTitle(payload.title)));
  normalizeImages(payload.images).forEach((image, index) => recordCandidate(trace, "imageCandidates", candidate(`${source} image ${index + 1}`, image), isValidImage(image)));
  recordCandidate(trace, "priceCandidates", candidate(source, payload.price), parsePrice(payload.price) !== null);
}

function summarizePayload(payload) {
  return {
    title: payload.title || null,
    description: payload.description || null,
    price: payload.price ?? null,
    oldPrice: payload.oldPrice ?? null,
    images: payload.images || [],
    thumbnail: payload.thumbnail || null,
    permalink: payload.permalink || null,
    source: payload.source || null,
    syncMethod: payload.syncMethod || null,
    titleSource: payload.titleSource || null,
    imageSource: payload.imageSource || null,
    priceSource: payload.priceSource || null,
    confidence: payload.confidence || 0
  };
}

function candidate(source, value) {
  return { source, value: value || "" };
}

function summarizeApiError(data, status) {
  return [data?.message, data?.error, data?.cause?.[0]?.message].filter(Boolean).join(" | ") || `HTTP ${status}`;
}

async function buildAuthContext() {
  const debug = await getAuthDebugStatus();
  const headers = { Accept: "application/json" };
  if (!debug.connected) return { headers, debug };

  try {
    const accessToken = await getValidAccessToken();
    headers.Authorization = `Bearer ${accessToken}`;
    const refreshedDebug = await getAuthDebugStatus();
    return {
      headers,
      accessToken,
      debug: {
        ...refreshedDebug,
        authMode: "oauth"
      }
    };
  } catch (error) {
    return {
      headers,
      debug: {
        ...debug,
        authMode: "fallback",
        tokenError: error.message
      }
    };
  }
}

function similarity(a, b) {
  const left = tokenize(a);
  const right = tokenize(b);
  if (!left.size || !right.size) return 0;
  return [...left].filter((token) => right.has(token)).length / Math.max(left.size, right.size);
}

function tokenize(value) {
  return new Set(cleanText(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2));
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
