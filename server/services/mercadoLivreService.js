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

export function getMeliId(product) {
  if (product.meliId) return normalizeMeliId(product.meliId);
  if (product.meliUrl) return extractMeliId(product.meliUrl);
  return null;
}

function extractMeliId(value) {
  const match = String(value).match(/\b(ML[A-Z]{1,2}-?\d{6,})\b/i);
  return match ? normalizeMeliId(match[1]) : null;
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
      console.log(`[ML SYNC] /products/${meliId} encontrado; buscando ofertas relacionadas.`);
      const offer = await findBestCatalogOffer(meliId, headers);
      console.log(`[ML SYNC] Oferta relacionada para ${meliId}: ${offer?.id || "nenhuma"}`);
      return normalizeMeliCatalogProduct(meliId, productResult.data, offer);
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
      const offer = await findBestCatalogOffer(meliId, headers);
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
  const response = await fetch(`https://api.mercadolibre.com/${pathname}`, {
    headers
  });
  const data = await response.json().catch(() => ({}));
  console.log(`[ML RESPONSE] GET /${pathname} status=${response.status}`);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      details: summarizeMeliError(data, response.status)
    };
  }

  return { ok: true, status: response.status, data };
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

function normalizeMeliCatalogProduct(meliId, product, offer = null) {
  const buyBoxWinner = product.buy_box_winner || {};
  const pictures = getPictures(product);
  const price = numberOrNull(product.price ?? buyBoxWinner.price ?? offer?.price);
  const oldPrice = numberOrNull(product.original_price ?? buyBoxWinner.original_price ?? offer?.original_price);
  const stock = Number(product.available_quantity || buyBoxWinner.available_quantity || offer?.available_quantity || 0);
  const status = product.status || buyBoxWinner.status || offer?.status || null;

  return {
    meliId,
    type: "catalog_product",
    title: product.name || product.title || null,
    price,
    oldPrice,
    currency: product.currency_id || buyBoxWinner.currency_id || offer?.currency_id || "BRL",
    heroImage: product.thumbnail || buyBoxWinner.thumbnail || offer?.thumbnail || pictures[0] || null,
    images: pictures,
    available: status === "active" || stock > 0,
    status,
    stock,
    soldQuantity: Number(product.sold_quantity || buyBoxWinner.sold_quantity || offer?.sold_quantity || 0),
    permalink: product.permalink || offer?.permalink || null,
    fetchedAt: new Date().toISOString(),
    syncStatus: price === null ? "partial" : "synced",
    sourceItemId: offer?.id || buyBoxWinner.item_id || null
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

async function findBestCatalogOffer(meliId, headers) {
  const encodedId = encodeURIComponent(meliId);
  console.log(`[ML SYNC] Buscando ofertas em /products/${meliId}/items e /sites/MLB/search`);
  const results = await Promise.allSettled([
    fetchMeliResource(`products/${encodedId}/items`, headers),
    fetchMeliResource(`sites/MLB/search?catalog_product_id=${encodedId}`, headers)
  ]);

  const offers = results
    .flatMap((result) => (result.status === "fulfilled" && result.value.ok ? extractOffers(result.value.data) : []))
    .filter((offer) => offer.status === "active" && numberOrNull(offer.price) !== null);

  if (!offers.length) {
    console.log(`[ML SYNC] Nenhuma oferta ativa com preco encontrada para ${meliId}`);
    return null;
  }

  const bestOffer = offers.sort((a, b) => {
    const aWinner = Number(Boolean(a.buy_box_winner));
    const bWinner = Number(Boolean(b.buy_box_winner));
    if (aWinner !== bWinner) return bWinner - aWinner;
    return Number(a.price) - Number(b.price);
  })[0];
  console.log(`[ML SYNC] Melhor oferta para ${meliId}: ${bestOffer.id || "sem-id"} preco=${bestOffer.price}`);
  return bestOffer;
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
