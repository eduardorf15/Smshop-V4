import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getValidAccessToken, readSavedToken } from "./mercadoLivreAuthService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const cacheDir = path.join(rootDir, ".cache");
const cacheFile = path.join(cacheDir, "meli-products.json");
const defaultTtlMs = 6 * 60 * 60 * 1000;
const ttlMs = Number(process.env.MELI_CACHE_TTL_MS || defaultTtlMs);
const requestTimeoutMs = Number(process.env.MELI_REQUEST_TIMEOUT_MS || 10000);
const maxRetries = Number(process.env.MELI_REQUEST_RETRIES || 2);

let memoryCache;

export async function getMercadoLivreData(products, options = {}) {
  const cache = await readCache();
  const nextCache = { ...cache };
  const now = Date.now();
  const updates = await Promise.all(
    products.map(async (product) => {
      const meliId = getMeliId(product);
      if (!meliId) return [product.id, null];

      console.log(`[ML SYNC] Buscando dados Mercado Livre para ${product.id} com meliId=${meliId}`);
      const cached = cache[meliId];
      const isFresh = cached?.fetchedAt && now - cached.fetchedAt < ttlMs;
      const cachedHasError = cached?.data?.syncStatus === "error";
      const cachedHasBadData = isBadMercadoLivreCacheData(cached?.data);
      if (isFresh && !cachedHasError && !cachedHasBadData && !options.force) {
        console.log(`[ML SYNC] Usando cache Mercado Livre para ${product.id} (${meliId})`);
        return [product.id, cached.data];
      }
      if (isFresh && cachedHasError) {
        console.log(`[ML SYNC] Ignorando cache de erro Mercado Livre para ${product.id} (${meliId})`);
      }
      if (isFresh && cachedHasBadData) {
        console.log(`[ML SYNC] Ignorando cache Mercado Livre ruim para ${product.id} (${meliId})`);
      }

      try {
        console.log(`[ML SYNC] Chamando API Mercado Livre para ${product.id} (${meliId})`);
        const normalizedInput = await normalizeMercadoLivreInput(product.sourceInput || product.meliUrl || meliId);
        const data = await fetchHybridMercadoLivreData({ ...normalizedInput, meliId: normalizedInput.meliId || meliId });
        nextCache[meliId] = { fetchedAt: now, data };
        return [product.id, data];
      } catch (error) {
        console.warn(`[SMShop] Mercado Livre indisponivel para ${meliId}: ${error.message}`);
        return [
          product.id,
          cached?.data || {
            meliId,
            syncStatus: "error",
            errorMessage: error.message,
            fetchedAt: new Date().toISOString()
          }
        ];
      }
    })
  );

  await writeCache(nextCache);
  return Object.fromEntries(updates);
}

function isBadMercadoLivreCacheData(data) {
  if (!data || data.syncStatus === "error") return false;
  const badTitle = data.title && !meaningfulText(data.title);
  const badImage = data.heroImage && !isUsefulMercadoLivreImage(data.heroImage);
  return Boolean(badTitle || badImage);
}

export async function refreshMercadoLivreCache(products) {
  memoryCache = null;
  const dataByProductId = await getMercadoLivreData(products, { force: true });
  return {
    updated: Object.values(dataByProductId).filter(Boolean).length,
    cacheFile
  };
}

export async function fetchMercadoLivreDataById(meliId, options = {}) {
  const normalizedMeliId = normalizeMeliId(meliId);
  const dataByProductId = await getMercadoLivreData([{ id: normalizedMeliId, meliId: normalizedMeliId }], options);
  return dataByProductId[normalizedMeliId] || null;
}

export async function fetchMercadoLivreDataByInput(input, options = {}) {
  const normalizedInput = await normalizeMercadoLivreInput(input);
  if (!normalizedInput.meliId) return null;
  if (!options.force) return fetchMercadoLivreDataById(normalizedInput.meliId, options);
  return fetchHybridMercadoLivreData(normalizedInput, options);
}

export async function debugMercadoLivreImport(input) {
  const normalizedInput = await normalizeMercadoLivreInput(input);
  const debug = createDebugTrace(input, normalizedInput);
  const data = normalizedInput.meliId ? await fetchHybridMercadoLivreData(normalizedInput, { debug }) : null;
  return {
    inputOriginal: String(input || ""),
    resolvedUrl: normalizedInput.resolvedUrl,
    detectedType: normalizedInput.meliType,
    itemId: normalizedInput.itemId,
    productId: normalizedInput.productId,
    meliId: normalizedInput.meliId,
    attempts: debug.attempts,
    title: data?.title || null,
    image: data?.heroImage || data?.images?.[0] || null,
    priceCandidates: debug.priceCandidates,
    chosenPrice: data?.price ?? null,
    chosenPriceSource: debug.chosenPriceSource || data?.syncMethod || null,
    reason: data?.price ? "Preço escolhido por fonte válida." : "Nenhum preço válido entre R$ 1 e R$ 50.000 foi encontrado.",
    syncMethod: data?.syncMethod || null,
    syncWarnings: data?.syncWarnings || []
  };
}

export function getMeliId(product) {
  if (product.meliId) return normalizeMeliId(product.meliId);
  if (product.meliUrl) return extractMeliId(product.meliUrl);
  return null;
}

function extractMeliId(value) {
  return extractMercadoLivreId(value);
}

export function extractMercadoLivreId(value) {
  const text = String(value || "");
  const itemQueryMatch = text.match(/[?&](?:wid|item_id)=(ML[A-Z]{1,2}-?\d{6,})\b/i);
  if (itemQueryMatch) return normalizeMeliId(itemQueryMatch[1]);

  const catalogMatch = text.match(/\/p\/(ML[A-Z]{1,2}-?\d{6,})\b/i);
  if (catalogMatch) return normalizeMeliId(catalogMatch[1]);

  const itemMatch = text.match(/\b(ML[A-Z]{1,2})-?(\d{6,})\b/i);
  if (itemMatch) return normalizeMeliId(`${itemMatch[1]}${itemMatch[2]}`);

  return null;
}

export async function resolveMercadoLivreIdFromInput(value) {
  const normalizedInput = await normalizeMercadoLivreInput(value);
  return normalizedInput.meliId;
}

export async function normalizeMercadoLivreInput(value) {
  const sourceInput = String(value || "").trim();
  const normalized = {
    sourceInput,
    resolvedUrl: null,
    itemId: null,
    productId: null,
    meliId: null,
    meliType: null,
    isCatalog: false
  };

  const direct = extractIdsFromText(sourceInput);
  Object.assign(normalized, direct);
  if (normalized.meliId) return normalized;

  if (!/^https?:\/\/(?:www\.)?meli\.la\//i.test(sourceInput)) return normalized;

  let currentUrl = sourceInput;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal
      });
      const location = response.headers.get("location");
      if (!location) {
        const resolvedByBody = await resolveShortUrlFromHtml(currentUrl);
        if (resolvedByBody.resolvedUrl) normalized.resolvedUrl = resolvedByBody.resolvedUrl;
        Object.assign(normalized, resolvedByBody.ids);
        break;
      }
      currentUrl = new URL(location, currentUrl).toString();
      normalized.resolvedUrl = currentUrl;
      Object.assign(normalized, extractIdsFromText(currentUrl));
      if (normalized.meliId) return normalized;
    } catch (error) {
      console.log(`[ML SYNC] Não foi possível resolver URL curta Mercado Livre: ${error.message}`);
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  return normalized;
}

async function resolveShortUrlFromHtml(url) {
  const empty = { resolvedUrl: null, ids: extractIdsFromText("") };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 SMShopImporter/1.0" },
      signal: controller.signal
    });
    const html = await response.text().catch(() => "");
    const resolvedUrl = response.url && response.url !== url ? response.url : null;
    const candidateUrl = resolvedUrl || getMetaRefreshUrl(html, url) || getCanonicalUrl(html);
    return {
      resolvedUrl: candidateUrl,
      ids: extractIdsFromText(`${candidateUrl || ""} ${html}`)
    };
  } catch (error) {
    console.log(`[ML SYNC] Não foi possível ler HTML da URL curta Mercado Livre: ${error.message}`);
    return empty;
  } finally {
    clearTimeout(timeout);
  }
}

function getMetaRefreshUrl(html, baseUrl) {
  const match = String(html || "").match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["'][^>]*>/i);
  if (!match) return null;
  try {
    return new URL(decodeHtml(match[1].trim()), baseUrl).toString();
  } catch {
    return null;
  }
}

function getCanonicalUrl(html) {
  const match = String(html || "").match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i) ||
    String(html || "").match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  return decodeHtml(match?.[1] || "") || null;
}

function extractIdsFromText(value) {
  const text = String(value || "");
  const result = {
    itemId: null,
    productId: null,
    meliId: null,
    meliType: null,
    isCatalog: false
  };

  const itemQueryMatch = text.match(/[?&](?:wid|item_id)=(ML[A-Z]{1,2}-?\d{6,})\b/i);
  const catalogMatch = text.match(/\/p\/(ML[A-Z]{1,2}-?\d{6,})\b/i);
  const itemPathMatch = text.match(/\/(ML[A-Z]{1,2})-?(\d{6,})\b/i);
  const directMatch = text.match(/\b(ML[A-Z]{1,2})-?(\d{6,})\b/i);

  if (itemQueryMatch) result.itemId = normalizeMeliId(itemQueryMatch[1]);
  if (catalogMatch) result.productId = normalizeMeliId(catalogMatch[1]);
  if (!result.itemId && itemPathMatch) result.itemId = normalizeMeliId(`${itemPathMatch[1]}${itemPathMatch[2]}`);
  if (!result.itemId && !result.productId && directMatch) {
    const id = normalizeMeliId(`${directMatch[1]}${directMatch[2]}`);
    if (detectMercadoLivreIdKind(id) === "item") result.itemId = id;
    else result.productId = id;
  }

  result.isCatalog = Boolean(result.productId);
  result.meliType = result.itemId ? "item" : result.productId ? "catalog_product" : null;
  result.meliId = result.itemId || result.productId || null;
  return result;
}

function normalizeMeliId(value) {
  return String(value).replace("-", "").toUpperCase();
}

async function fetchMeliItem(meliId) {
  const headers = await buildHeaders();
  const idKind = detectMercadoLivreIdKind(meliId);
  console.log(`[ML SYNC] ID ${meliId} detectado como ${idKind}; tentando endpoint /items/${meliId}`);
  const itemResult = await fetchMeliResource(`items/${encodeURIComponent(meliId)}`, headers);
  if (itemResult.ok) {
    console.log(`[ML SYNC] /items/${meliId} encontrado.`);
    return normalizeMeliItem(meliId, itemResult.data);
  }

  if (shouldUseManualFallbackForItemAccessDenied(itemResult, meliId)) {
    console.log(`[ML SYNC] /items/${meliId} retornou 403; usando fallback manual parcial sem tentar /products.`);
    return buildItemAccessDeniedFallback(meliId, itemResult);
  }

  if (shouldTryCatalogProduct(itemResult, meliId)) {
    console.log(`[ML SYNC] /items/${meliId} falhou (${itemResult.details}); tentando /products/${meliId}`);
    const productResult = await fetchMeliResource(`products/${encodeURIComponent(meliId)}`, headers);
    if (productResult.ok) {
      console.log(`[ML SYNC] /products/${meliId} encontrado; buscando preço/ofertas relacionadas.`);
      const resolvedPrice = await resolveMercadoLivrePrice(meliId, productResult.data, headers);
      return normalizeMeliCatalogProduct(meliId, productResult.data, resolvedPrice);
    }
    throw new Error(productResult.details || `HTTP ${productResult.status}`);
  }

  throw new Error(itemResult.details || `HTTP ${itemResult.status}`);
}

async function fetchHybridMercadoLivreData(inputInfo, options = {}) {
  const normalizedInput = {
    ...(inputInfo || {}),
    meliId: normalizeMeliId(inputInfo?.meliId || inputInfo?.itemId || inputInfo?.productId || "")
  };
  const debug = options.debug || null;
  const headers = await buildHeaders();
  const warnings = [];
  const candidates = buildPublicUrlCandidates(normalizedInput);
  let apiData = null;
  let apiError = "";

  if (normalizedInput.itemId || (normalizedInput.meliId && detectMercadoLivreIdKind(normalizedInput.meliId) === "item")) {
    const itemId = normalizedInput.itemId || normalizedInput.meliId;
    const itemResult = await fetchMeliResourceSafe(`items/${encodeURIComponent(itemId)}`, headers, debug);
    if (itemResult.ok) {
      const descriptionResult = await fetchMeliResourceSafe(`items/${encodeURIComponent(itemId)}/description`, headers, debug);
      apiData = withMethod(
        {
          ...normalizeMeliItem(itemId, itemResult.data),
          description: descriptionResult.ok ? descriptionResult.data?.plain_text || descriptionResult.data?.text || null : null
        },
        "API OK",
        normalizedInput
      );
      candidates.push(apiData.permalink);
      if (itemResult.data?.catalog_product_id) normalizedInput.productId = itemResult.data.catalog_product_id;
    } else {
      apiError = itemResult.details || `HTTP ${itemResult.status}`;
      warnings.push(`/items/${itemId}: ${apiError}`);
    }
  }

  const productId = normalizedInput.productId || (normalizedInput.meliId && detectMercadoLivreIdKind(normalizedInput.meliId) === "catalog_product" ? normalizedInput.meliId : null);
  if (productId && needsMoreData(apiData)) {
    const productResult = await fetchMeliResourceSafe(`products/${encodeURIComponent(productId)}`, headers, debug);
    if (productResult.ok) {
      const resolvedPrice = await resolveMercadoLivrePrice(productId, productResult.data, headers, debug);
      const catalogData = withMethod(normalizeMeliCatalogProduct(productId, productResult.data, resolvedPrice), "API OK", normalizedInput);
      apiData = mergeMercadoLivrePayload(apiData, catalogData);
      candidates.push(apiData.permalink, resolvedPrice?.permalink);
    } else {
      warnings.push(`/products/${productId}: ${productResult.details || `HTTP ${productResult.status}`}`);
    }
  }

  candidates.push(normalizedInput.resolvedUrl, normalizedInput.sourceInput);
  let mergedData = apiData;
  if (needsMoreData(mergedData)) {
    const htmlData = await fetchBestHtmlFallback(candidates, normalizedInput, debug);
    if (htmlData) {
      mergedData = mergeMercadoLivrePayload(mergedData, htmlData);
    }
  }

  if (needsMoreData(mergedData)) {
    const searchData = await fetchSearchFallback(mergedData?.title || normalizedInput.meliId || normalizedInput.sourceInput, headers, normalizedInput, debug);
    if (searchData) {
      mergedData = mergeMercadoLivrePayload(mergedData, searchData);
    }
  }

  if (needsMoreData(mergedData)) {
    const titleSearchData = await fetchAggressiveTitleSearchFallback(mergedData?.title || "", headers, normalizedInput, debug);
    if (titleSearchData) {
      mergedData = mergeMercadoLivrePayload(mergedData, titleSearchData);
    }
  }

  if (needsMoreData(mergedData)) {
    const publicSearchData = await fetchPublicSearchHtmlFallback(mergedData?.title || "", normalizedInput, debug);
    if (publicSearchData) {
      mergedData = mergeMercadoLivrePayload(mergedData, publicSearchData);
    }
  }

  if (!mergedData) {
    return buildManualReviewFallback(normalizedInput, warnings, apiError);
  }

  const finalWarnings = [...warnings, ...(mergedData.syncWarnings || [])];
  const finalized = finalizeHybridData(mergedData, normalizedInput, finalWarnings);
  if (debug && finalized.price) {
    debug.chosenPriceSource = finalized.syncMethod || "unknown";
  }
  return finalized;
}

export async function fetchMercadoLivreItemForTest(meliId) {
  const accessToken = await getValidAccessToken();
  const headers = buildAuthorizedHeaders(accessToken);
  const itemResult = await fetchMeliResource(`items/${encodeURIComponent(meliId)}`, headers);
  if (itemResult.ok) {
    return {
      ok: true,
      type: "item",
      data: mapItemResponse(itemResult.data)
    };
  }

  if (shouldUseManualFallbackForItemAccessDenied(itemResult, meliId)) {
    return {
      ok: false,
      type: "item",
      message: "Preço indisponível pela API do Mercado Livre; usando preço manual",
      details: itemResult.details || `HTTP ${itemResult.status}`
    };
  }

  if (shouldTryCatalogProduct(itemResult, meliId)) {
    const productResult = await fetchMeliResource(`products/${encodeURIComponent(meliId)}`, headers);
    if (productResult.ok) {
      const offer = await resolveMercadoLivrePrice(meliId, productResult.data, headers);
      return {
        ok: true,
        type: "catalog_product",
        data: mapCatalogProductResponse(productResult.data, offer)
      };
    }

    return buildNotFoundResponse(productResult);
  }

  return buildNotFoundResponse(itemResult);
}

async function fetchMeliResource(pathname, headers, debug = null) {
  console.log(`[ML REQUEST] GET /${pathname} auth=${headers.Authorization ? "Bearer" : "public"}`);
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let timeout;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      const response = await fetch(`https://api.mercadolibre.com/${pathname}`, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await response.json().catch(() => ({}));
      console.log(`[ML RESPONSE] GET /${pathname} status=${response.status} attempt=${attempt + 1}`);
      recordAttempt(debug, {
        method: "GET",
        url: `https://api.mercadolibre.com/${pathname}`,
        layer: "api",
        status: response.status,
        ok: response.ok,
        details: response.ok ? "ok" : summarizeMeliError(data, response.status)
      });
      logRawMercadoLivreJson(pathname, data);

      if (!response.ok) {
        const result = {
          ok: false,
          status: response.status,
          details: summarizeMeliError(data, response.status)
        };
        if (!shouldRetryStatus(response.status) || attempt === maxRetries) return result;
        await waitForRetry(attempt);
        continue;
      }

      return { ok: true, status: response.status, data };
    } catch (error) {
      lastError = error;
      console.log(`[ML RESPONSE] GET /${pathname} error=${error.name || "Error"} attempt=${attempt + 1}`);
      recordAttempt(debug, {
        method: "GET",
        url: `https://api.mercadolibre.com/${pathname}`,
        layer: "api",
        status: 0,
        ok: false,
        details: error.message
      });
      if (attempt === maxRetries) break;
      await waitForRetry(attempt);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw new Error(`Falha de rede Mercado Livre em /${pathname}: ${lastError?.message || "erro desconhecido"}`);
}

async function fetchMeliResourceSafe(pathname, headers, debug = null) {
  try {
    const result = await fetchMeliResource(pathname, headers, debug);
    return result;
  } catch (error) {
    recordAttempt(debug, {
      method: "GET",
      url: `https://api.mercadolibre.com/${pathname}`,
      layer: "api",
      status: 0,
      ok: false,
      details: error.message
    });
    return {
      ok: false,
      status: 0,
      details: error.message
    };
  }
}

function withMethod(data, syncMethod, inputInfo) {
  if (!data) return null;
  return {
    ...data,
    sourceInput: inputInfo.sourceInput || null,
    resolvedUrl: inputInfo.resolvedUrl || null,
    itemId: inputInfo.itemId || (data.type === "item" ? data.meliId : data.sourceItemId) || null,
    catalogProductId: inputInfo.productId || data.catalogProductId || null,
    syncMethod,
    syncWarnings: data.syncWarnings || []
  };
}

function needsMoreData(data) {
  if (!data) return true;
  const hasTitle = Boolean(meaningfulText(data.title));
  const hasImage = Boolean(data.heroImage || data.images?.length);
  const hasPrice = Number.isFinite(Number(data.price)) && Number(data.price) > 0;
  return !hasTitle || !hasImage || !hasPrice;
}

function mergeMercadoLivrePayload(base, extra) {
  if (!base) return extra || null;
  if (!extra) return base;
  const basePrice = Number(base.price);
  const extraPrice = Number(extra.price);
  const images = extra.images?.length ? extra.images : base.images || [];
  const syncMethod = needsMoreData(base) && !needsMoreData(extra) ? extra.syncMethod : base.syncMethod || extra.syncMethod;
  return {
    ...base,
    ...extra,
    title: meaningfulText(base.title) || meaningfulText(extra.title) || base.title || extra.title || null,
    description: meaningfulText(base.description) || meaningfulText(extra.description) || base.description || extra.description || null,
    price: Number.isFinite(basePrice) && basePrice > 0 ? basePrice : Number.isFinite(extraPrice) && extraPrice > 0 ? extraPrice : null,
    oldPrice: base.oldPrice ?? extra.oldPrice ?? null,
    heroImage: base.heroImage || extra.heroImage || images[0] || null,
    images,
    permalink: base.permalink || extra.permalink || null,
    seller: base.seller || extra.seller || null,
    itemId: base.itemId || extra.itemId || null,
    catalogProductId: base.catalogProductId || extra.catalogProductId || null,
    sourceInput: base.sourceInput || extra.sourceInput || null,
    resolvedUrl: base.resolvedUrl || extra.resolvedUrl || null,
    syncMethod,
    syncWarnings: [...(base.syncWarnings || []), ...(extra.syncWarnings || [])]
  };
}

function meaningfulText(value) {
  const text = String(value || "").trim();
  if (!text || /^ML[A-Z]{1,2}\d{6,}$/i.test(text)) return "";
  if (/^(mercado\s*livre|mercadolivre|produto\s+mercado\s+livre)$/i.test(text)) return "";
  if (/^mercado\s*livre\s+brasil$/i.test(text)) return "";
  return text;
}

function buildPublicUrlCandidates(inputInfo) {
  const urls = [inputInfo.resolvedUrl, inputInfo.sourceInput].filter(Boolean);
  const itemId = inputInfo.itemId || (detectMercadoLivreIdKind(inputInfo.meliId) === "item" ? inputInfo.meliId : null);
  const productId = inputInfo.productId || (detectMercadoLivreIdKind(inputInfo.meliId) === "catalog_product" ? inputInfo.meliId : null);
  if (itemId) urls.push(`https://produto.mercadolivre.com.br/${itemId.replace(/^MLB/i, "MLB-")}`);
  if (productId) urls.push(`https://www.mercadolivre.com.br/p/${productId}`);
  return [...new Set(urls)];
}

function createDebugTrace(input, normalizedInput) {
  return {
    input: String(input || ""),
    normalizedInput,
    attempts: [],
    priceCandidates: [],
    chosenPriceSource: null
  };
}

function recordAttempt(debug, attempt) {
  if (!debug) return;
  debug.attempts.push({
    at: new Date().toISOString(),
    ...attempt
  });
}

function recordPriceCandidate(debug, candidate) {
  if (!debug) return;
  const price = normalizePriceCandidate(candidate.value);
  debug.priceCandidates.push({
    source: candidate.source,
    value: candidate.value,
    parsed: price,
    accepted: price !== null,
    reason: price === null ? candidate.reason || "fora do intervalo válido ou não numérico" : "válido"
  });
}

async function fetchBestHtmlFallback(candidates, inputInfo, debug = null) {
  const urls = [...new Set((candidates || []).filter((url) => /^https?:\/\//i.test(String(url || ""))))];
  for (const url of urls) {
    const data = await fetchHtmlFallback(url, inputInfo, debug);
    if (data && !needsMoreData(data)) return data;
    if (data) return data;
  }
  return null;
}

async function fetchHtmlFallback(url, inputInfo, debug = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 SMShopImporter/1.0"
      },
      redirect: "follow",
      signal: controller.signal
    });
    const html = await response.text();
    recordAttempt(debug, {
      method: "GET",
      url,
      finalUrl: response.url || url,
      layer: "html",
      status: response.status,
      ok: response.ok,
      details: response.ok ? `html ${html.length} bytes` : "html indisponível"
    });
    if (!response.ok || !html) return null;
    const parsed = parseMercadoLivreHtml(html, debug);
    if (!parsed.title && !parsed.heroImage && !parsed.price) return null;
    return withMethod(
      {
        meliId: inputInfo.meliId,
        type: inputInfo.meliType || "html",
        ...parsed,
        permalink: response.url || url,
        resolvedUrl: response.url || url,
        fetchedAt: new Date().toISOString(),
        syncStatus: parsed.price ? "synced" : "partial",
        syncWarnings: ["Dados complementados pelo HTML público do Mercado Livre"]
      },
      "Fallback HTML",
      { ...inputInfo, resolvedUrl: response.url || url }
    );
  } catch (error) {
    console.log(`[ML HTML] falha ao buscar ${url}: ${error.message}`);
    recordAttempt(debug, {
      method: "GET",
      url,
      layer: "html",
      status: 0,
      ok: false,
      details: error.message
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseMercadoLivreHtml(html, debug = null) {
  const jsonLd = extractJsonLdData(html);
  const scriptData = extractStructuredScriptData(html);
  const metaProductPrice = getMetaContent(html, "property", "product:price:amount");
  const metaItempropPrice = getMetaContent(html, "itemprop", "price");
  const twitterPrice = getMetaContent(html, "name", "twitter:data1");
  const visiblePrices = extractVisibleHtmlPrices(html);
  [
    ["json-ld offers.price", jsonLd.price],
    ["meta product:price:amount", metaProductPrice],
    ["meta itemprop=price", metaItempropPrice],
    ["twitter:data1", twitterPrice],
    ["scripts price/amount", scriptData.price],
    ...visiblePrices.map((value, index) => [`html visible price ${index + 1}`, value])
  ].forEach(([source, value]) => recordPriceCandidate(debug, { source, value }));
  const title = meaningfulText(cleanTitle(
    getMetaContent(html, "property", "og:title") ||
    getMetaContent(html, "name", "twitter:title") ||
    jsonLd.title ||
    scriptData.title ||
    getTagContent(html, "title")
  ));
  const description = cleanText(
    getMetaContent(html, "property", "og:description") ||
    getMetaContent(html, "name", "description") ||
    jsonLd.description ||
    scriptData.description ||
    ""
  );
  const price = firstReasonablePrice([
    jsonLd.price,
    metaProductPrice,
    metaItempropPrice,
    twitterPrice,
    scriptData.price,
    ...visiblePrices
  ]);
  const images = [
    getMetaContent(html, "property", "og:image"),
    getMetaContent(html, "name", "twitter:image"),
    ...normalizeHtmlImages(jsonLd.images),
    ...normalizeHtmlImages(scriptData.images)
  ].filter(isUsefulMercadoLivreImage);

  return {
    title,
    description,
    price,
    currency: getMetaContent(html, "property", "product:price:currency") || jsonLd.currency || scriptData.currency || "BRL",
    heroImage: images[0] || null,
    images: [...new Set(images)]
  };
}

function getMetaContent(html, attr, name) {
  const pattern = new RegExp(`<meta\\s+[^>]*${attr}=["']${escapeRegExp(name)}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const reversePattern = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${escapeRegExp(name)}["'][^>]*>`, "i");
  return decodeHtml((html.match(pattern) || html.match(reversePattern))?.[1] || "");
}

function getTagContent(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return decodeHtml(match?.[1] || "");
}

function extractJsonLdData(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(decodeHtml(block[1]).trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] || [])];
      const product = nodes.find((node) => /product/i.test(String(node?.["@type"] || ""))) || nodes[0];
      if (!product || typeof product !== "object") continue;
      const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers || {};
      return {
        title: product.name || null,
        description: product.description || null,
        price: offer.price || offer.lowPrice || null,
        currency: offer.priceCurrency || null,
        images: product.image || []
      };
    } catch {
      continue;
    }
  }
  return {};
}

function extractStructuredScriptData(html) {
  const scripts = [...String(html || "").matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => decodeHtml(match[1] || ""));
  const parsedObjects = [];

  for (const script of scripts) {
    const preloadedIndex = script.indexOf("__PRELOADED_STATE__");
    if (preloadedIndex !== -1) {
      const objectStart = script.indexOf("{", preloadedIndex);
      const jsonText = extractBalancedObject(script, objectStart);
      if (jsonText) {
        const parsed = parseLooseJson(jsonText);
        if (parsed) parsedObjects.push(parsed);
      }
    }

    const nextDataMatch = script.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      const parsed = parseLooseJson(nextDataMatch[1]);
      if (parsed) parsedObjects.push(parsed);
    }
  }

  const price = firstNumber([
    ...parsedObjects.map((item) => findMercadoLivrePrice(item)?.value),
    ...extractScriptPriceCandidates(scripts.join("\n"))
  ]);
  const images = [
    ...parsedObjects.flatMap((item) => findImageValues(item)),
    ...extractScriptImageCandidates(scripts.join("\n"))
  ];
  const title = parsedObjects.map((item) => findStringByKey(item, ["title", "name"])).find(Boolean) || "";
  const description = parsedObjects.map((item) => findStringByKey(item, ["description", "subtitle"])).find(Boolean) || "";
  const currency = parsedObjects.map((item) => findStringByKey(item, ["currency_id", "priceCurrency", "currency"])).find(Boolean) || "";

  return { title, description, price, currency, images };
}

function extractBalancedObject(text, startIndex) {
  if (startIndex < 0) return "";
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
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
    if (depth === 0) return text.slice(startIndex, index + 1);
  }
  return "";
}

function parseLooseJson(value) {
  try {
    return JSON.parse(String(value || "").trim());
  } catch {
    return null;
  }
}

function firstReasonablePrice(values) {
  for (const value of values) {
    const number = normalizePriceCandidate(value);
    if (number !== null) return number;
  }
  return null;
}

function normalizePriceCandidate(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  const normalizedText = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const number = Number(normalizedText.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number) || number < 1 || number > 50000) return null;
  return number;
}

function extractScriptPriceCandidates(text) {
  const values = [];
  const patterns = [
    /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi,
    /"amount"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi,
    /"value"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi,
    /"priceAmount"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi,
    /"itemPrice"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi,
    /"formatted_amount"\s*:\s*"R\$\s*([0-9.]+,[0-9]{2})"/gi,
    /"current_price"\s*:\s*\{\s*"amount"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi,
    /"sale_price"\s*:\s*\{\s*"amount"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi,
    /"price_tag"[\s\S]{0,240}?"amount"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi,
    /"buyBox"[\s\S]{0,500}?"price"[\s\S]{0,160}?"amount"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi,
    /"offers"[\s\S]{0,500}?"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) values.push(match[1]);
  }
  return values;
}

function extractScriptImageCandidates(text) {
  const images = [];
  for (const match of text.matchAll(/https?:\\?\/\\?\/[^"'\\\s]+(?:jpg|jpeg|png|webp)/gi)) {
    images.push(match[0].replaceAll("\\/", "/"));
  }
  return images.filter((image) => /mlstatic\.com/i.test(image));
}

function findStringByKey(value, keys) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKey(item, keys);
      if (found) return found;
    }
    return "";
  }
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return cleanText(value[key]);
  }
  for (const child of Object.values(value).slice(0, 80)) {
    const found = findStringByKey(child, keys);
    if (found) return found;
  }
  return "";
}

function findImageValues(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => findImageValues(item));
  const direct = ["image", "images", "picture", "pictures", "thumbnail", "secure_thumbnail"]
    .flatMap((key) => normalizeHtmlImages(value[key]));
  const nested = Object.values(value).slice(0, 80).flatMap((item) => findImageValues(item));
  return [...direct, ...nested].filter((image) => /mlstatic\.com/i.test(image));
}

function normalizeHtmlImages(images) {
  if (!images) return [];
  if (Array.isArray(images)) return images.map((image) => typeof image === "string" ? image : image?.url).filter(Boolean);
  if (typeof images === "string") return [images];
  if (typeof images === "object" && images.url) return [images.url];
  return [];
}

function isUsefulMercadoLivreImage(image) {
  const url = String(image || "").trim();
  if (!url) return false;
  if (/logo|favicon|apple-touch-icon|placeholder/i.test(url)) return false;
  return /^https?:\/\//i.test(url) || url.startsWith("//");
}

function extractVisibleHtmlPrices(html) {
  const normalized = html.replace(/\s+/g, " ");
  const candidates = [];
  const priceFocused = normalized.match(/(?:data-testid|class|id)=["'][^"']*price[^"']*["'][^>]*>[^<]{0,80}R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:,[0-9]{2})?)/gi) || [];
  priceFocused.forEach((snippet) => {
    const match = snippet.match(/R\$\s*([0-9.]+,[0-9]{2}|[0-9]+)/i);
    if (match) candidates.push(match[1]);
  });
  for (const match of normalized.matchAll(/(?<!x\s)R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:,[0-9]{2})?)/gi)) {
    const before = normalized.slice(Math.max(0, match.index - 30), match.index).toLowerCase();
    const after = normalized.slice(match.index, match.index + 90).toLowerCase();
    if (/frete|envio|desconto|off|%/.test(before + after)) continue;
    if (/\d+\s*x\s*$/i.test(before)) continue;
    candidates.push(match[1]);
  }
  return candidates
    .map((value) => Number(String(value).replace(/\./g, "").replace(",", ".")))
    .filter((value, index, list) => normalizePriceCandidate(value) !== null && list.indexOf(value) === index);
}

function cleanTitle(value) {
  return cleanText(value).replace(/\s*\|\s*Mercado Livre.*$/i, "").replace(/\s*-\s*Mercado Livre.*$/i, "");
}

function cleanText(value) {
  return decodeHtml(String(value || "")).replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchSearchFallback(query, headers, inputInfo, debug = null, method = "Fallback search") {
  const searchText = buildSearchQuery(query, inputInfo);
  if (!searchText) return null;
  const result = await fetchMeliResourceSafe(`sites/MLB/search?q=${encodeURIComponent(searchText)}`, headers, debug);
  if (!result.ok) return null;
  const offers = extractOffers(result.data).map((item) => normalizeOffer(item, "search_fallback")).filter(Boolean);
  offers.forEach((offer) => recordPriceCandidate(debug, { source: `${method}: ${searchText} / ${offer.title || offer.item_id || offer.id}`, value: offer.price }));
  const offer = chooseBestSearchOffer(offers, searchText) || offers.find(isValidOffer) || offers[0];
  if (!offer) return null;
  return withMethod(
    {
      meliId: inputInfo.meliId || offer.id || offer.item_id,
      type: "search",
      title: offer.title || null,
      price: extractMercadoLivrePrice(offer),
      oldPrice: extractOriginalPriceValue(offer),
      currency: offer.currency_id || "BRL",
      heroImage: offer.thumbnail || null,
      images: [offer.thumbnail].filter(Boolean),
      available: offer.status === "active" || Number(offer.available_quantity || 0) > 0,
      status: offer.status || null,
      stock: Number(offer.available_quantity || 0),
      soldQuantity: Number(offer.sold_quantity || 0),
      permalink: offer.permalink || null,
      itemId: offer.item_id || offer.id || null,
      catalogProductId: offer.catalog_product_id || inputInfo.productId || null,
      seller: offer.seller || null,
      fetchedAt: new Date().toISOString(),
      syncStatus: extractMercadoLivrePrice(offer) ? "synced" : "partial",
      syncWarnings: [`Dados complementados pela busca do Mercado Livre: ${searchText}`]
    },
    method,
    inputInfo
  );
}

async function fetchAggressiveTitleSearchFallback(title, headers, inputInfo, debug = null) {
  const queries = buildTitleSearchQueries(title);
  for (const query of queries) {
    const result = await fetchSearchFallback(query, headers, inputInfo, debug, query === title ? "ml-search-title" : "ml-search-keywords");
    if (result && result.price) return result;
    if (result && !needsMoreData(result)) return result;
  }
  return null;
}

async function fetchPublicSearchHtmlFallback(title, inputInfo, debug = null) {
  const queries = buildTitleSearchQueries(title);
  for (const query of queries) {
    const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(query).replace(/%20/g, "-")}`;
    const htmlData = await fetchHtmlFallback(url, inputInfo, debug);
    if (!htmlData?.price) continue;
    return {
      ...htmlData,
      syncMethod: query === title ? "html-search-title" : "html-search-keywords",
      syncWarnings: [`Preço complementado por busca pública Mercado Livre: ${query}`]
    };
  }
  return null;
}

function chooseBestSearchOffer(offers, searchText) {
  const validOffers = offers.filter(isValidOffer);
  if (!validOffers.length) return null;
  return validOffers
    .map((offer) => ({ offer, score: titleSimilarity(searchText, offer.title || "") + availabilityScore(offer) }))
    .sort((a, b) => b.score - a.score || Number(a.offer.price) - Number(b.offer.price))[0]?.offer || null;
}

function availabilityScore(offer) {
  if (offer.status === "active") return 0.15;
  if (Number(offer.available_quantity || 0) > 0) return 0.1;
  return 0;
}

function titleSimilarity(a, b) {
  const aTokens = new Set(tokenizeSearchText(a));
  const bTokens = new Set(tokenizeSearchText(b));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / Math.max(aTokens.size, bTokens.size);
}

function buildTitleSearchQueries(title) {
  const clean = cleanSearchTitle(title);
  if (!clean) return [];
  const tokens = tokenizeSearchText(clean);
  const brandModel = extractBrandModelTokens(tokens);
  const hasCadeira = tokens.includes("cadeira") && tokens.includes("rodas");
  const queries = [
    title,
    clean,
    hasCadeira ? ["cadeira", "rodas", ...brandModel].join(" ") : "",
    hasCadeira ? ["cadeira", "de", "rodas", ...[...brandModel].reverse()].join(" ") : "",
    hasCadeira ? ["cadeira", "rodas", "aco", "carbono", "120kg", ...brandModel.filter((token) => !/120/.test(token))].join(" ") : "",
    [...brandModel, ...tokens.filter((token) => ["cadeira", "rodas"].includes(token))].join(" ")
  ];
  return [...new Set(queries.map((query) => query.trim()).filter((query) => query.length >= 4))].slice(0, 8);
}

function cleanSearchTitle(value) {
  return removeAccents(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(de|da|do|das|dos|em|para|com|ate|até|kg|kilo|manual|dobravel|dobrável|produto|novo|original)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchText(value) {
  return removeAccents(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !["de", "da", "do", "das", "dos", "em", "para", "com", "ate"].includes(token));
}

function extractBrandModelTokens(tokens) {
  const modelTokens = tokens.filter((token) => /[a-z]+\d+|\d+[a-z]+|\d{2,}/i.test(token));
  const likelyBrand = tokens.filter((token) => ["dellamed", "d100"].includes(token) || token.length >= 6).slice(-2);
  return [...new Set([...modelTokens, ...likelyBrand])].slice(0, 4);
}

function removeAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function buildSearchQuery(query, inputInfo) {
  const text = meaningfulText(query) || meaningfulText(inputInfo.sourceInput);
  if (text && !/^https?:\/\//i.test(text)) return text.replace(/\bML[A-Z]{1,2}\d+\b/gi, "").trim() || inputInfo.meliId;
  try {
    const url = new URL(inputInfo.resolvedUrl || inputInfo.sourceInput || "");
    const slug = url.pathname.split("/").filter(Boolean).find((part) => !/^p$/i.test(part) && !/^ML/i.test(part));
    return slug ? slug.replace(/-/g, " ") : inputInfo.meliId;
  } catch {
    return inputInfo.meliId;
  }
}

function buildManualReviewFallback(inputInfo, warnings, errorMessage) {
  const meliId = inputInfo.meliId || extractMercadoLivreId(inputInfo.sourceInput) || "MLB";
  return {
    meliId,
    type: inputInfo.meliType || "manual",
    title: `Produto Mercado Livre ${meliId} — revisar título`,
    price: null,
    oldPrice: null,
    heroImage: null,
    images: [],
    available: null,
    status: null,
    stock: null,
    soldQuantity: null,
    permalink: inputInfo.resolvedUrl || null,
    sourceInput: inputInfo.sourceInput || null,
    resolvedUrl: inputInfo.resolvedUrl || null,
    itemId: inputInfo.itemId || null,
    catalogProductId: inputInfo.productId || null,
    fetchedAt: new Date().toISOString(),
    syncStatus: "partial",
    syncMethod: "Manual/revisar",
    syncWarnings: [...warnings, "preço não encontrado", "preço precisa ser preenchido manualmente", "Título, preço ou imagem não encontrados; revise manualmente"].filter(Boolean),
    syncWarning: errorMessage || "Dados insuficientes no Mercado Livre; revise manualmente",
    errorMessage
  };
}

function finalizeHybridData(data, inputInfo, warnings) {
  const hasTitle = Boolean(meaningfulText(data.title));
  const hasImage = Boolean(data.heroImage || data.images?.length);
  const hasPrice = Number.isFinite(Number(data.price)) && Number(data.price) > 0;
  const syncWarnings = [...new Set([
    ...warnings,
    !hasTitle ? "Título não encontrado, revise manualmente" : "",
    !hasImage ? "Imagem não encontrada, revise manualmente" : "",
    !hasPrice ? "Preço não encontrado; preço manual será usado quando informado" : ""
  ].filter(Boolean))];

  return {
    ...data,
    meliId: inputInfo.meliId || data.meliId,
    type: data.type || inputInfo.meliType || null,
    title: hasTitle ? data.title : `Produto Mercado Livre ${inputInfo.meliId || data.meliId} — revisar título`,
    heroImage: data.heroImage || data.images?.[0] || null,
    sourceInput: inputInfo.sourceInput || data.sourceInput || null,
    resolvedUrl: data.resolvedUrl || inputInfo.resolvedUrl || null,
    itemId: data.itemId || inputInfo.itemId || null,
    catalogProductId: data.catalogProductId || inputInfo.productId || null,
    fetchedAt: data.fetchedAt || new Date().toISOString(),
    syncStatus: hasTitle && hasImage && hasPrice ? "synced" : "partial",
    syncMethod: data.syncMethod || "API parcial",
    syncWarnings,
    syncWarning: syncWarnings[0] || null
  };
}

function normalizeMeliItem(meliId, item) {
  const stock = Number(item.available_quantity || 0);
  const status = item.status || null;
  const priceInfo = findMercadoLivrePrice(item);
  const price = extractMercadoLivrePrice(item);
  const oldPrice = extractOriginalPriceValue(item);
  const seller = normalizeSeller(item.seller || item.seller_info || item.seller_id);
  console.log(
    `[ML RAW PRICE] ${JSON.stringify({
      id: meliId,
      source: "item",
      price: item.price ?? null,
      original_price: item.original_price ?? null,
      sale_price: item.sale_price ?? null,
      installments: item.installments ?? null,
      variations: summarizeVariationPrices(item.variations)
    })}`
  );
  console.log(`[ML PRICE FIELD] ${JSON.stringify({ id: meliId, source: "item", field: priceInfo?.path || null })}`);
  console.log(`[ML PARSED PRICE] ${JSON.stringify({ id: meliId, source: "item", value: price, valid: price !== null })}`);
  return {
    meliId,
    type: "item",
    title: item.title || null,
    price,
    oldPrice,
    currency: item.currency_id || "BRL",
    heroImage: bestPicture(item),
    images: getPictures(item),
    available: status === "active" || stock > 0,
    status,
    stock,
    soldQuantity: Number(item.sold_quantity || 0),
    permalink: item.permalink || null,
    seller,
    category: item.category_id || null,
    catalogProductId: item.catalog_product_id || null,
    attributes: Array.isArray(item.attributes) ? item.attributes : [],
    fetchedAt: new Date().toISOString(),
    syncStatus: price === null ? "partial" : "synced"
  };
}

function normalizeMeliCatalogProduct(meliId, product, resolvedPrice = null) {
  const buyBoxWinner = product.buy_box_winner || {};
  const pictures = getPictures(product);
  const priceInfo = findFirstPriceInfo([
    findMercadoLivrePrice(product, "product"),
    findMercadoLivrePrice(buyBoxWinner, "buy_box_winner"),
    findMercadoLivrePrice(resolvedPrice, "resolvedPrice")
  ]);
  const price = priceInfo?.value ?? null;
  const oldPrice = firstNumber([
    extractOriginalPriceValue(product),
    extractOriginalPriceValue(buyBoxWinner),
    extractOriginalPriceValue(resolvedPrice)
  ]);
  const stock = Number(product.available_quantity || buyBoxWinner.available_quantity || resolvedPrice?.available_quantity || 0);
  const status = product.status || buyBoxWinner.status || resolvedPrice?.status || null;
  const syncStatus = price === null ? "partial" : "synced";
  console.log(
    `[ML RAW PRICE] ${JSON.stringify({
      id: meliId,
      source: "catalog_product",
      productPrice: product.price ?? null,
      productSalePrice: product.sale_price ?? null,
      buyBoxPrice: buyBoxWinner.price ?? null,
      buyBoxSalePrice: buyBoxWinner.sale_price ?? null,
      resolvedPrice: resolvedPrice?.price ?? null,
      resolvedSalePrice: resolvedPrice?.sale_price ?? null,
      installments: product.installments ?? buyBoxWinner.installments ?? resolvedPrice?.installments ?? null,
      variations: summarizeVariationPrices(product.variations)
    })}`
  );
  console.log(`[ML PRICE FIELD] ${JSON.stringify({ id: meliId, source: "catalog_product", field: priceInfo?.path || null })}`);
  console.log(`[ML PARSED PRICE] ${JSON.stringify({ id: meliId, source: "catalog_product", value: price, valid: price !== null })}`);

  return {
    meliId,
    type: "catalog_product",
    title: product.name || product.title || null,
    price,
    oldPrice,
    currency: product.currency_id || buyBoxWinner.currency_id || resolvedPrice?.currency_id || "BRL",
    heroImage: product.thumbnail || buyBoxWinner.thumbnail || resolvedPrice?.thumbnail || pictures[0] || null,
    images: pictures,
    available: status === "active" || stock > 0,
    status,
    stock,
    soldQuantity: Number(product.sold_quantity || buyBoxWinner.sold_quantity || resolvedPrice?.sold_quantity || 0),
    permalink: product.permalink || resolvedPrice?.permalink || null,
    category: product.domain_id || product.main_features?.[0]?.text || null,
    catalogProductId: product.id || meliId,
    attributes: Array.isArray(product.attributes) ? product.attributes : [],
    fetchedAt: new Date().toISOString(),
    syncStatus,
    sourceItemId: resolvedPrice?.item_id || resolvedPrice?.id || buyBoxWinner.item_id || null,
    seller: resolvedPrice?.seller || null
  };
}

function mapItemResponse(item) {
  return {
    id: item.id || null,
    title: item.title || null,
    price: extractMercadoLivrePrice(item),
    original_price: extractOriginalPriceValue(item),
    available_quantity: Number(item.available_quantity || 0),
    thumbnail: item.secure_thumbnail || item.thumbnail || null,
    pictures: Array.isArray(item.pictures) ? item.pictures.map((picture) => picture.secure_url || picture.url).filter(Boolean) : [],
    permalink: item.permalink || null
  };
}

function mapCatalogProductResponse(product, offer = null) {
  const buyBoxWinner = product.buy_box_winner || {};
  const pictures = Array.isArray(product.pictures)
    ? product.pictures.map((picture) => picture.secure_url || picture.url).filter(Boolean)
    : [];

  return {
    id: product.id || null,
    title: product.name || product.title || null,
    price: firstNumber([extractMercadoLivrePrice(product), extractMercadoLivrePrice(buyBoxWinner), extractMercadoLivrePrice(offer)]),
    original_price: firstNumber([extractOriginalPriceValue(product), extractOriginalPriceValue(buyBoxWinner), extractOriginalPriceValue(offer)]),
    available_quantity: Number(product.available_quantity || buyBoxWinner.available_quantity || offer?.available_quantity || 0),
    thumbnail: product.thumbnail || buyBoxWinner.thumbnail || offer?.thumbnail || pictures[0] || null,
    pictures,
    permalink: product.permalink || offer?.permalink || null
  };
}

async function resolveMercadoLivrePrice(meliId, product, headers, debug = null) {
  const candidates = [];
  const buyBoxWinner = normalizeOffer(product.buy_box_winner, "buy_box_winner");
  if (buyBoxWinner) candidates.push(buyBoxWinner);

  if (buyBoxWinner?.item_id || buyBoxWinner?.id) {
    const itemId = buyBoxWinner.item_id || buyBoxWinner.id;
    try {
      const itemResult = await fetchMeliResource(`items/${encodeURIComponent(itemId)}`, headers, debug);
      if (itemResult.ok) {
        logRawMercadoLivreJson(`${meliId}/buy_box_item/${itemId}`, itemResult.data);
        const itemOffer = normalizeOffer(itemResult.data, "buy_box_item");
        if (itemOffer) candidates.push(itemOffer);
      }
    } catch (error) {
      console.log(`[ML PRICE] falha ao detalhar item vencedor ${itemId}: ${error.message}`);
    }
  }

  const catalogOffers = await findCatalogOffers(meliId, headers, debug);
  candidates.push(...catalogOffers);
  candidates.forEach((offer) => recordPriceCandidate(debug, { source: `catalog/items ${offer.source || ""} ${offer.item_id || offer.id || ""}`.trim(), value: offer.price }));

  const activeOffers = candidates.filter((offer) => isValidOffer(offer));
  if (!activeOffers.length) {
    console.log(`[ML PRICE] fallback utilizado para ${meliId}: nenhum preço válido em ofertas ativas.`);
    return null;
  }

  const bestOffer = activeOffers.sort(compareOffers)[0];
  console.log(`[ML PRICE] preço encontrado para ${meliId}: ${bestOffer.price}`);
  console.log(`[ML PRICE] seller encontrado para ${meliId}: ${formatSellerLog(bestOffer.seller)}`);
  console.log(`[ML PRICE] permalink encontrado para ${meliId}: ${bestOffer.permalink || "null"}`);
  return bestOffer;
}

async function findCatalogOffers(meliId, headers, debug = null) {
  const encodedId = encodeURIComponent(meliId);
  console.log(`[ML SYNC] Buscando ofertas em /products/${meliId}/items e /sites/MLB/search`);
  const results = await Promise.allSettled([
    fetchMeliResource(`products/${encodedId}/items`, headers, debug),
    fetchMeliResource(`sites/MLB/search?catalog_product_id=${encodedId}`, headers, debug)
  ]);

  const offers = results.flatMap((result) => {
    if (result.status !== "fulfilled" || !result.value.ok) return [];
    return extractOffers(result.value.data).map((offer) => normalizeOffer(offer, "catalog_offer")).filter(Boolean);
  });

  const offersNeedingDetails = offers.filter((offer) => offer.item_id && extractMercadoLivrePrice(offer) === null);
  if (!offersNeedingDetails.length) return offers;

  console.log(`[ML PRICE] detalhando ${offersNeedingDetails.length} ofertas sem preço para ${meliId}`);
  const detailedResults = await Promise.allSettled(
    offersNeedingDetails.slice(0, 10).map((offer) => fetchMeliResource(`items/${encodeURIComponent(offer.item_id)}`, headers, debug))
  );
  const detailedOffers = detailedResults
    .filter((result) => result.status === "fulfilled" && result.value.ok)
    .map((result) => {
      const data = result.value.data;
      logRawMercadoLivreJson(`${meliId}/catalog_offer_item_detail/${data?.id || "unknown"}`, data);
      return normalizeOffer(data, "catalog_offer_item_detail");
    })
    .filter(Boolean);

  return [...offers, ...detailedOffers];
}

function extractOffers(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.sellers)) return data.sellers.map((seller) => seller.item || seller).filter(Boolean);
  return [];
}

function shouldTryCatalogProduct(result, meliId) {
  if (detectMercadoLivreIdKind(meliId) === "item") {
    console.log(`[ML SYNC] ${meliId} parece ser anúncio/item; não tentando /products/${meliId}.`);
    return false;
  }
  if (result.status === 404) return true;
  if (result.status === 401 || result.status === 403) return false;
  if (result.status !== 400) return false;
  return /invalid|type|item|id|not found/i.test(result.details || "");
}

function detectMercadoLivreIdKind(meliId) {
  const digits = String(meliId || "").replace(/\D/g, "");
  if (digits.length >= 10) return "item";
  return "catalog_product";
}

function shouldUseManualFallbackForItemAccessDenied(result, meliId) {
  if (detectMercadoLivreIdKind(meliId) !== "item") return false;
  return result.status === 403;
}

function buildItemAccessDeniedFallback(meliId, result) {
  return {
    meliId,
    type: "item",
    title: null,
    price: null,
    oldPrice: null,
    heroImage: null,
    images: [],
    available: null,
    status: null,
    stock: null,
    soldQuantity: null,
    permalink: null,
    seller: null,
    fetchedAt: new Date().toISOString(),
    syncStatus: "partial",
    syncWarning: "Preço indisponível pela API do Mercado Livre; usando preço manual",
    warningDetails: result.details || `HTTP ${result.status}`
  };
}

function normalizeOffer(offer, source) {
  if (!offer || typeof offer !== "object") return null;
  const item = offer.item || offer;
  const seller = normalizeSeller(item.seller || item.seller_info || item.seller_address || item.seller_id || item.official_store_id);
  const priceInfo = findMercadoLivrePrice(item);
  const price = extractMercadoLivrePrice(item);
  const originalPrice = extractOriginalPriceValue(item);
  const itemId = item.item_id || item.id || item.catalog_listing_id || null;
  console.log(
    `[ML RAW PRICE] ${JSON.stringify({
      id: itemId || "sem-id",
      source,
      price: item.price ?? null,
      current_price: item.current_price ?? null,
      sale_price: item.sale_price ?? null,
      amount: item.amount ?? null,
      installments: item.installments ?? null,
      variations: summarizeVariationPrices(item.variations)
    })}`
  );
  console.log(`[ML PARSED PRICE] ${JSON.stringify({ id: itemId || "sem-id", source, value: price, valid: price !== null })}`);
  console.log(`[ML PRICE FIELD] ${JSON.stringify({ id: itemId || "sem-id", source, field: priceInfo?.path || null })}`);

  return {
    ...item,
    id: itemId,
    item_id: itemId,
    source,
    price,
    original_price: originalPrice,
    available_quantity: Number(item.available_quantity || item.initial_quantity || 0),
    status: item.status || (item.available_quantity > 0 ? "active" : null),
    permalink: item.permalink || null,
    thumbnail: item.secure_thumbnail || item.thumbnail || null,
    seller,
    buy_box_winner: Boolean(item.buy_box_winner || source === "buy_box_winner" || source === "buy_box_item")
  };
}

function normalizeSeller(value) {
  if (!value && value !== 0) return null;
  if (typeof value === "object") {
    return {
      id: value.id || value.seller_id || null,
      nickname: value.nickname || value.name || null
    };
  }
  return { id: value, nickname: null };
}

function isValidOffer(offer) {
  if (!offer || extractMercadoLivrePrice(offer) === null) return false;
  if (offer.status && offer.status !== "active") return false;
  if (Number(offer.available_quantity || 0) <= 0 && offer.status !== "active") return false;
  return true;
}

function compareOffers(a, b) {
  const aWinner = Number(Boolean(a.buy_box_winner));
  const bWinner = Number(Boolean(b.buy_box_winner));
  if (aWinner !== bWinner) return bWinner - aWinner;
  return Number(a.price) - Number(b.price);
}

function formatSellerLog(seller) {
  if (!seller) return "null";
  return [seller.id, seller.nickname].filter(Boolean).join(" / ") || "null";
}

function shouldRetryStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function waitForRetry(attempt) {
  return new Promise((resolve) => {
    setTimeout(resolve, 250 * (attempt + 1));
  });
}

function buildNotFoundResponse(result) {
  return {
    ok: false,
    message: "Produto não encontrado no Mercado Livre",
    details: result.details || `HTTP ${result.status}`
  };
}

function summarizeMeliError(data, status) {
  const parts = [data.message, data.error, data.cause?.[0]?.message].filter(Boolean);
  return parts.length ? parts.join(" | ") : `HTTP ${status}`;
}

async function buildHeaders() {
  const headers = { Accept: "application/json" };
  const savedToken = await readSavedToken();
  const envAccessToken = process.env.MERCADO_LIVRE_ACCESS_TOKEN || process.env.MELI_ACCESS_TOKEN;

  if (savedToken?.accessToken || savedToken?.refreshToken) {
    const accessToken = await getValidAccessToken();
    headers.Authorization = `Bearer ${accessToken}`;
    console.log(`[TOKEN OK] Mercado Livre token carregado do storage userId=${savedToken.userId || "unknown"} expiresAt=${savedToken.expiresAt || "unknown"}`);
  } else if (envAccessToken) {
    headers.Authorization = `Bearer ${envAccessToken}`;
    console.log("[TOKEN OK] Mercado Livre token carregado do env");
  } else {
    console.log("[TOKEN OK] false - token Mercado Livre ausente no storage/env");
  }
  return headers;
}

function buildAuthorizedHeaders(accessToken) {
  if (!accessToken) throw new Error("Authorization Bearer ausente para Mercado Livre.");
  console.log("[TOKEN OK] Mercado Livre token carregado para chamada interna");
  return {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`
  };
}

function bestPicture(item) {
  if (Array.isArray(item.pictures) && item.pictures[0]) {
    return item.pictures[0].secure_url || item.pictures[0].url || null;
  }
  return item.secure_thumbnail || item.thumbnail || null;
}

function getPictures(item) {
  return Array.isArray(item.pictures) ? item.pictures.map((picture) => picture.secure_url || picture.url).filter(Boolean) : [];
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractPriceValue(value) {
  return extractMercadoLivrePrice(value);
}

function extractMercadoLivrePrice(data) {
  return findMercadoLivrePrice(data)?.value ?? null;
}

function findMercadoLivrePrice(data, prefix = "") {
  if (data === null || data === undefined) return null;
  if (typeof data !== "object") {
    const value = numberOrNull(data);
    return value !== null && value > 0 ? { value, path: prefix || "value" } : null;
  }

  const candidates = [
    ["price", data.price],
    ["current_price", data.current_price],
    ["current_price.amount", data.current_price?.amount],
    ["amount", data.amount],
    ["sale_price.amount", data.sale_price?.amount],
    ["sale_price.regular_amount", data.sale_price?.regular_amount],
    ["sale_price", typeof data.sale_price === "object" ? null : data.sale_price],
    ["installments.amount", data.installments?.amount],
    ["installments.total_amount", data.installments?.total_amount],
    ["shipping.price", data.shipping?.price],
    ["buy_box_winner.price", data.buy_box_winner?.price],
    ["buy_box_winner.current_price", data.buy_box_winner?.current_price],
    ["buy_box_winner.current_price.amount", data.buy_box_winner?.current_price?.amount],
    ["buy_box_winner.sale_price.amount", data.buy_box_winner?.sale_price?.amount],
    ["buy_box_winner.sale_price.regular_amount", data.buy_box_winner?.sale_price?.regular_amount],
    ["buy_box_winner.installments.amount", data.buy_box_winner?.installments?.amount],
    ["deals.price", data.deals?.price],
    ["deals.current_price", data.deals?.current_price],
    ["deals.current_price.amount", data.deals?.current_price?.amount],
    ["deals.sale_price.amount", data.deals?.sale_price?.amount],
    ["deals.installments.amount", data.deals?.installments?.amount],
    ["deals.0.price", data.deals?.[0]?.price],
    ["deals.0.current_price", data.deals?.[0]?.current_price],
    ["deals.0.current_price.amount", data.deals?.[0]?.current_price?.amount],
    ["deals.0.sale_price.amount", data.deals?.[0]?.sale_price?.amount],
    ["deals.0.installments.amount", data.deals?.[0]?.installments?.amount],
    ["prices.prices.standard.amount", data.prices?.prices?.find((price) => price?.type === "standard")?.amount],
    ["prices.prices.0.amount", data.prices?.prices?.[0]?.amount]
  ];

  for (const [path, rawValue] of candidates) {
    const value = numberOrNull(rawValue);
    if (value !== null && value > 0) return { value, path: withPrefix(prefix, path) };
  }

  if (Array.isArray(data.variations)) {
    for (let index = 0; index < data.variations.length; index += 1) {
      const result = findMercadoLivrePrice(data.variations[index], withPrefix(prefix, `variations.${index}`));
      if (result) return result;
    }
  }

  return null;
}

function findFirstPriceInfo(results) {
  return results.find((result) => result?.value !== null && result?.value !== undefined) || null;
}

function withPrefix(prefix, path) {
  return prefix ? `${prefix}.${path}` : path;
}

function logRawMercadoLivreJson(pathname, data) {
  const id = data?.id || data?.product_id || data?.catalog_product_id || "";
  if (pathname.includes("MLB66266661") || id === "MLB66266661") {
    console.log(`[ML RAW API JSON] GET /${pathname} ${JSON.stringify(data)}`);
  }
}

function extractOriginalPriceValue(value) {
  if (!value || typeof value !== "object") return null;

  return firstNumber([
    value.original_price,
    value.regular_amount,
    value.base_price,
    value.sale_price?.regular_amount,
    value.sale_price?.metadata?.campaign_discount_percentage ? value.price : null,
    value.prices?.prices?.find((price) => price?.type === "regular")?.amount
  ]);
}

function firstNumber(values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null && number > 0) return number;
  }
  return null;
}

function summarizeVariationPrices(variations) {
  if (!Array.isArray(variations)) return null;
  return variations.slice(0, 5).map((variation) => ({
    id: variation.id || null,
    price: variation.price ?? null,
    sale_price: variation.sale_price ?? null,
    installments: variation.installments ?? null
  }));
}

async function readCache() {
  if (memoryCache) return memoryCache;
  try {
    memoryCache = JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

async function writeCache(cache) {
  memoryCache = cache;
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2));
}
