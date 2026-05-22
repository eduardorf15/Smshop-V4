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

      const cached = cache[meliId];
      const isFresh = cached?.fetchedAt && now - cached.fetchedAt < ttlMs;
      if (isFresh && !options.force) return [product.id, cached.data];

      try {
        const data = await fetchMeliItem(meliId);
        nextCache[meliId] = { fetchedAt: now, data };
        return [product.id, data];
      } catch (error) {
        console.warn(`[SMShop] Mercado Livre indisponivel para ${meliId}: ${error.message}`);
        return [product.id, cached?.data || null];
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
  const itemResult = await fetchMeliResource("items", meliId, headers);
  if (itemResult.ok) return normalizeMeliItem(meliId, itemResult.data);

  if (shouldTryCatalogProduct(itemResult)) {
    const productResult = await fetchMeliResource("products", meliId, headers);
    if (productResult.ok) return normalizeMeliCatalogProduct(meliId, productResult.data);
    throw new Error(productResult.details || `HTTP ${productResult.status}`);
  }

  throw new Error(itemResult.details || `HTTP ${itemResult.status}`);
}

export async function fetchMercadoLivreItemForTest(meliId) {
  const accessToken = await getValidAccessToken();
  const headers = buildAuthorizedHeaders(accessToken);
  const itemResult = await fetchMeliResource("items", meliId, headers);
  if (itemResult.ok) {
    return {
      ok: true,
      type: "item",
      data: mapItemResponse(itemResult.data)
    };
  }

  if (shouldTryCatalogProduct(itemResult)) {
    const productResult = await fetchMeliResource("products", meliId, headers);
    if (productResult.ok) {
      return {
        ok: true,
        type: "catalog_product",
        data: mapCatalogProductResponse(productResult.data)
      };
    }

    return buildNotFoundResponse(productResult);
  }

  return buildNotFoundResponse(itemResult);
}

async function fetchMeliResource(resource, meliId, headers) {
  const response = await fetch(`https://api.mercadolibre.com/${resource}/${encodeURIComponent(meliId)}`, {
    headers
  });
  const data = await response.json().catch(() => ({}));

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
  return {
    meliId,
    type: "item",
    title: item.title || null,
    price: numberOrNull(item.price),
    oldPrice: numberOrNull(item.original_price),
    currency: item.currency_id || "BRL",
    heroImage: bestPicture(item),
    images: getPictures(item),
    available: item.status === "active" && Number(item.available_quantity || 0) > 0,
    status: item.status || null,
    stock: Number(item.available_quantity || 0),
    soldQuantity: Number(item.sold_quantity || 0),
    permalink: item.permalink || null,
    fetchedAt: new Date().toISOString()
  };
}

function normalizeMeliCatalogProduct(meliId, product) {
  const buyBoxWinner = product.buy_box_winner || {};
  const pictures = getPictures(product);
  const stock = Number(product.available_quantity || buyBoxWinner.available_quantity || 0);
  const status = product.status || buyBoxWinner.status || null;

  return {
    meliId,
    type: "catalog_product",
    title: product.name || product.title || null,
    price: numberOrNull(product.price ?? buyBoxWinner.price),
    oldPrice: numberOrNull(product.original_price ?? buyBoxWinner.original_price),
    currency: product.currency_id || buyBoxWinner.currency_id || "BRL",
    heroImage: product.thumbnail || buyBoxWinner.thumbnail || pictures[0] || null,
    images: pictures,
    available: status ? status === "active" : stock > 0,
    status,
    stock,
    soldQuantity: Number(product.sold_quantity || buyBoxWinner.sold_quantity || 0),
    permalink: product.permalink || null,
    fetchedAt: new Date().toISOString()
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

function mapCatalogProductResponse(product) {
  const buyBoxWinner = product.buy_box_winner || {};
  const pictures = Array.isArray(product.pictures)
    ? product.pictures.map((picture) => picture.secure_url || picture.url).filter(Boolean)
    : [];

  return {
    id: product.id || null,
    title: product.name || product.title || null,
    price: numberOrNull(product.price || buyBoxWinner.price),
    original_price: numberOrNull(product.original_price || buyBoxWinner.original_price),
    available_quantity: Number(product.available_quantity || buyBoxWinner.available_quantity || 0),
    thumbnail: product.thumbnail || buyBoxWinner.thumbnail || pictures[0] || null,
    pictures,
    permalink: product.permalink || null
  };
}

function shouldTryCatalogProduct(result) {
  if (result.status === 404) return true;
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
  if (savedToken?.refreshToken) {
    headers.Authorization = `Bearer ${await getValidAccessToken()}`;
  } else if (process.env.MERCADO_LIVRE_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.MERCADO_LIVRE_ACCESS_TOKEN}`;
  }
  return headers;
}

function buildAuthorizedHeaders(accessToken) {
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
