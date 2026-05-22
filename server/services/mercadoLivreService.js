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
      if (isFresh && !cachedHasError && !options.force) {
        console.log(`[ML SYNC] Usando cache Mercado Livre para ${product.id} (${meliId})`);
        return [product.id, cached.data];
      }
      if (isFresh && cachedHasError) {
        console.log(`[ML SYNC] Ignorando cache de erro Mercado Livre para ${product.id} (${meliId})`);
      }

      try {
        console.log(`[ML SYNC] Chamando API Mercado Livre para ${product.id} (${meliId})`);
        const data = await fetchMeliItem(meliId);
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
  const catalogMatch = text.match(/\/p\/(ML[A-Z]{1,2}-?\d{6,})\b/i);
  if (catalogMatch) return normalizeMeliId(catalogMatch[1]);

  const itemMatch = text.match(/\b(ML[A-Z]{1,2})-?(\d{6,})\b/i);
  if (itemMatch) return normalizeMeliId(`${itemMatch[1]}${itemMatch[2]}`);

  return null;
}

function normalizeMeliId(value) {
  return String(value).replace("-", "").toUpperCase();
}

async function fetchMeliItem(meliId) {
  const headers = await buildHeaders();
  console.log(`[ML SYNC] Tentando endpoint /items/${meliId}`);
  const itemResult = await fetchMeliResource(`items/${encodeURIComponent(meliId)}`, headers);
  if (itemResult.ok) {
    console.log(`[ML SYNC] /items/${meliId} encontrado.`);
    return normalizeMeliItem(meliId, itemResult.data);
  }

  if (shouldTryCatalogProduct(itemResult)) {
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

  if (shouldTryCatalogProduct(itemResult)) {
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

async function fetchMeliResource(pathname, headers) {
  if (!headers.Authorization) {
    throw new Error(`Authorization Bearer ausente para Mercado Livre em /${pathname}`);
  }
  console.log(`[ML REQUEST] GET /${pathname} auth=Bearer`);
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
      if (attempt === maxRetries) break;
      await waitForRetry(attempt);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw new Error(`Falha de rede Mercado Livre em /${pathname}: ${lastError?.message || "erro desconhecido"}`);
}

function normalizeMeliItem(meliId, item) {
  const stock = Number(item.available_quantity || 0);
  const status = item.status || null;
  const price = numberOrNull(item.price);
  return {
    meliId,
    type: "item",
    title: item.title || null,
    price,
    oldPrice: numberOrNull(item.original_price),
    currency: item.currency_id || "BRL",
    heroImage: bestPicture(item),
    images: getPictures(item),
    available: status === "active" || stock > 0,
    status,
    stock,
    soldQuantity: Number(item.sold_quantity || 0),
    permalink: item.permalink || null,
    fetchedAt: new Date().toISOString(),
    syncStatus: price === null ? "partial" : "synced"
  };
}

function normalizeMeliCatalogProduct(meliId, product, resolvedPrice = null) {
  const buyBoxWinner = product.buy_box_winner || {};
  const pictures = getPictures(product);
  const price = numberOrNull(product.price ?? buyBoxWinner.price ?? resolvedPrice?.price);
  const oldPrice = numberOrNull(product.original_price ?? buyBoxWinner.original_price ?? resolvedPrice?.original_price);
  const stock = Number(product.available_quantity || buyBoxWinner.available_quantity || resolvedPrice?.available_quantity || 0);
  const status = product.status || buyBoxWinner.status || resolvedPrice?.status || null;
  const syncStatus = price === null ? "partial" : "synced";

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
    price: numberOrNull(item.price),
    original_price: numberOrNull(item.original_price),
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
    price: numberOrNull(product.price ?? buyBoxWinner.price ?? offer?.price),
    original_price: numberOrNull(product.original_price ?? buyBoxWinner.original_price ?? offer?.original_price),
    available_quantity: Number(product.available_quantity || buyBoxWinner.available_quantity || offer?.available_quantity || 0),
    thumbnail: product.thumbnail || buyBoxWinner.thumbnail || offer?.thumbnail || pictures[0] || null,
    pictures,
    permalink: product.permalink || offer?.permalink || null
  };
}

async function resolveMercadoLivrePrice(meliId, product, headers) {
  const candidates = [];
  const buyBoxWinner = normalizeOffer(product.buy_box_winner, "buy_box_winner");
  if (buyBoxWinner) candidates.push(buyBoxWinner);

  if (buyBoxWinner?.item_id || buyBoxWinner?.id) {
    const itemId = buyBoxWinner.item_id || buyBoxWinner.id;
    try {
      const itemResult = await fetchMeliResource(`items/${encodeURIComponent(itemId)}`, headers);
      if (itemResult.ok) {
        const itemOffer = normalizeOffer(itemResult.data, "buy_box_item");
        if (itemOffer) candidates.push(itemOffer);
      }
    } catch (error) {
      console.log(`[ML PRICE] falha ao detalhar item vencedor ${itemId}: ${error.message}`);
    }
  }

  const catalogOffers = await findCatalogOffers(meliId, headers);
  candidates.push(...catalogOffers);

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

async function findCatalogOffers(meliId, headers) {
  const encodedId = encodeURIComponent(meliId);
  console.log(`[ML SYNC] Buscando ofertas em /products/${meliId}/items e /sites/MLB/search`);
  const results = await Promise.allSettled([
    fetchMeliResource(`products/${encodedId}/items`, headers),
    fetchMeliResource(`sites/MLB/search?catalog_product_id=${encodedId}`, headers)
  ]);

  const offers = results.flatMap((result) => {
    if (result.status !== "fulfilled" || !result.value.ok) return [];
    return extractOffers(result.value.data).map((offer) => normalizeOffer(offer, "catalog_offer")).filter(Boolean);
  });

  const offersNeedingDetails = offers.filter((offer) => offer.item_id && numberOrNull(offer.price) === null);
  if (!offersNeedingDetails.length) return offers;

  console.log(`[ML PRICE] detalhando ${offersNeedingDetails.length} ofertas sem preço para ${meliId}`);
  const detailedResults = await Promise.allSettled(
    offersNeedingDetails.slice(0, 10).map((offer) => fetchMeliResource(`items/${encodeURIComponent(offer.item_id)}`, headers))
  );
  const detailedOffers = detailedResults
    .filter((result) => result.status === "fulfilled" && result.value.ok)
    .map((result) => normalizeOffer(result.value.data, "catalog_offer_item_detail"))
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

function shouldTryCatalogProduct(result) {
  if (result.status === 404) return true;
  if (result.status === 401 || result.status === 403) return /unauthorized|forbidden|policy/i.test(result.details || "");
  if (result.status !== 400) return false;
  return /invalid|type|item|id|not found/i.test(result.details || "");
}

function normalizeOffer(offer, source) {
  if (!offer || typeof offer !== "object") return null;
  const item = offer.item || offer;
  const seller = normalizeSeller(item.seller || item.seller_info || item.seller_address || item.seller_id || item.official_store_id);
  const price = numberOrNull(item.price ?? item.current_price ?? item.amount);
  const originalPrice = numberOrNull(item.original_price ?? item.regular_amount ?? item.base_price);
  const itemId = item.item_id || item.id || item.catalog_listing_id || null;

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
  if (!offer || numberOrNull(offer.price) === null) return false;
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
