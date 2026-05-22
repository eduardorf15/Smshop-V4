import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const response = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(meliId)}`, {
    headers: buildHeaders()
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const item = await response.json();

  return {
    meliId,
    title: item.title || null,
    price: numberOrNull(item.price),
    oldPrice: numberOrNull(item.original_price),
    currency: item.currency_id || "BRL",
    heroImage: bestPicture(item),
    images: Array.isArray(item.pictures) ? item.pictures.map((picture) => picture.secure_url || picture.url).filter(Boolean) : [],
    available: item.status === "active" && Number(item.available_quantity || 0) > 0,
    stock: Number(item.available_quantity || 0),
    soldQuantity: Number(item.sold_quantity || 0),
    permalink: item.permalink || null,
    fetchedAt: new Date().toISOString()
  };
}

function buildHeaders() {
  const headers = { Accept: "application/json" };
  if (process.env.MERCADO_LIVRE_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.MERCADO_LIVRE_ACCESS_TOKEN}`;
  }
  return headers;
}

function bestPicture(item) {
  if (Array.isArray(item.pictures) && item.pictures[0]) {
    return item.pictures[0].secure_url || item.pictures[0].url || null;
  }
  return item.secure_thumbnail || item.thumbnail || null;
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
