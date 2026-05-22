import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { affiliateLinks } from "../../src/data/affiliate-links.js";
import { productCatalog } from "../../src/data/product-catalog.js";
import {
  extractMercadoLivreId,
  fetchMercadoLivreDataById,
  getMercadoLivreData,
  getMeliId,
  refreshMercadoLivreCache
} from "./mercadoLivreService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const productRoot = path.join(rootDir, "imagens", "tecnologia");
const importedProductsFile = path.join(rootDir, "src/data/imported-products.json");
const imageExt = new Set([".webp", ".png", ".jpg", ".jpeg", ".avif"]);
const productCacheTtlMs = Number(process.env.PRODUCT_CACHE_TTL_MS || process.env.MELI_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const productMeliIds = {
  "tech-001": "MLB66266661"
};
let cache;
let cacheFetchedAt = 0;

export async function listProducts() {
  if (cache && Date.now() - cacheFetchedAt < productCacheTtlMs) {
    const cachedTech001 = cache.find((product) => product.id === "tech-001");
    console.log(
      `[ML SYNC] listProducts usando cache em memoria: tech-001 meliId=${cachedTech001?.meliId || "null"} dataSource=${cachedTech001?.dataSource || "null"}`
    );
    return cache;
  }

  const products = await buildManualProducts();
  const tech001 = products.find((product) => product.id === "tech-001");
  console.log(
    `[ML SYNC] tech-001 veio do catalogo: meliId=${tech001?.meliId || "null"} dataSource=${tech001?.dataSource || "null"}`
  );
  const mergedProducts = await syncProductsWithMercadoLivre(products);

  cache = mergedProducts;
  cacheFetchedAt = Date.now();
  return mergedProducts;
}

export async function syncProductsWithMercadoLivre(products, options = {}) {
  const productsWithMeliId = products.filter((product) => product.meliId);
  if (!productsWithMeliId.length) {
    console.log("[ML SYNC] Nenhum produto com meliId detectado; usando catalogo manual.");
    return products;
  }

  productsWithMeliId.forEach((product) => {
    console.log(`[ML SYNC] Detectado meliId ${product.meliId} em ${product.id}`);
  });

  const mercadoLivreData = await getMercadoLivreData(productsWithMeliId, options);
  return products.map((product) => {
    if (!product.meliId) {
      return product;
    }
    if (product.id === "tech-001") {
      console.log(
        `[ML SYNC BEFORE] ${JSON.stringify({
          id: product.id,
          meliId: product.meliId,
          dataSource: product.dataSource,
          syncStatus: product.syncStatus,
          price: product.price
        })}`
      );
    }
    return mergeProductData(product, mercadoLivreData[product.id]);
  });
}

export async function getProductById(id) {
  const products = await listProducts();
  const product = products.find((item) => item.id === id || item.sku === id);
  if (!product?.meliId || product.dataSource !== "manual") return product;
  const [syncedProduct] = await syncProductsWithMercadoLivre([product]);
  return syncedProduct;
}

export async function refreshProductsCache() {
  const products = await buildManualProducts();
  const result = await refreshMercadoLivreCache(products);
  cache = null;
  cacheFetchedAt = 0;
  await listProducts();
  return result;
}

export async function importMercadoLivreProduct({ input, category = "Tecnologia", affiliateUrl, tags = [], featured = false }) {
  const meliId = extractMercadoLivreId(input);
  if (!meliId) {
    throw createPublicError("Informe uma URL ou ID válido do Mercado Livre.", 400);
  }

  if (!affiliateUrl) {
    throw createPublicError("affiliateUrl é obrigatório para importar produto.", 400);
  }

  const safeCategory = String(category || "Tecnologia");
  const safeTags = normalizeTags(tags);
  const existingProducts = await buildManualProducts();
  const existingProduct = existingProducts.find((product) => product.meliId === meliId);
  const mercadoLivreData = await fetchMercadoLivreDataById(meliId, { force: true });
  if (mercadoLivreData?.syncStatus === "error") {
    throw createPublicError(`Falha ao buscar produto no Mercado Livre: ${mercadoLivreData.errorMessage || "erro desconhecido"}`, 502);
  }

  const importedProducts = await readImportedProducts();
  const importedProduct = buildImportedProduct({
    existingProduct,
    mercadoLivreData,
    meliId,
    category: safeCategory,
    affiliateUrl,
    tags: safeTags,
    featured
  });
  const nextImportedProducts = upsertImportedProduct(importedProducts, importedProduct);

  await writeImportedProducts(nextImportedProducts);
  cache = null;
  cacheFetchedAt = 0;

  const [syncedProduct] = await syncProductsWithMercadoLivre([toRuntimeProduct(importedProduct, existingProduct)], { force: true });
  return {
    imported: !existingProduct,
    updated: Boolean(existingProduct),
    product: syncedProduct
  };
}

export async function forceRefreshMercadoLivreProducts() {
  const products = await buildManualProducts();
  const productsWithMeliId = products.filter((product) => product.meliId);
  const result = await refreshMercadoLivreCache(productsWithMeliId);
  cache = null;
  cacheFetchedAt = 0;
  const syncedProducts = await listProducts();

  return {
    ...result,
    total: products.length,
    withMeliId: productsWithMeliId.length,
    refreshed: syncedProducts.filter((product) => product.meliId && product.syncStatus === "synced").length
  };
}

export async function getSyncReport() {
  const products = await listProducts();
  const report = {
    total: products.length,
    withMeliId: products.filter((product) => product.meliId).length,
    synced: 0,
    partial: 0,
    fallback: 0,
    error: 0
  };

  products.forEach((product) => {
    if (product.syncStatus === "synced") report.synced += 1;
    else if (product.syncStatus === "partial") report.partial += 1;
    else if (product.syncStatus === "error") report.error += 1;
    else report.fallback += 1;
  });

  return report;
}

async function buildManualProducts() {
  const catalogProducts = await getCatalogProducts();
  const folderNames = new Set(
    (await fs.readdir(productRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d+$/.test(name))
  );

  const products = await Promise.all(
    catalogProducts.map(async (catalog, index) => {
      const folder = catalog.sku;
      const absoluteFolder = path.join(productRoot, folder);
      const files = folderNames.has(folder)
        ? (await fs.readdir(absoluteFolder, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && imageExt.has(path.extname(entry.name).toLowerCase()))
            .map((entry) => entry.name)
            .sort((a, b) => naturalNumber(a) - naturalNumber(b))
        : [];

      const images = files.map((file) => `/imagens/tecnologia/${folder}/${file}`);
      const affiliateUrl = catalog.affiliateUrl || affiliateLinks[index] || null;
      const price = catalog.price;
      const category = catalog.category;
      const categorySlug = catalog.categorySlug || slugify(category);
      const productType = catalog.productType || category;
      const productTypeSlug = slugify(productType);
      const id = catalog.id || (/^\d+$/.test(folder) ? `tech-${folder}` : `meli-${getMeliId(catalog) || folder}`);
      const meliId = productMeliIds[id] || getMeliId(catalog);
      if (!affiliateUrl) console.warn(`[SMShop] Produto ${folder} sem link afiliado cadastrado.`);

      const product = {
        id,
        sku: folder,
        order: index + 1,
        name: catalog.name,
        category,
        categorySlug,
        productType,
        productTypeSlug,
        meliId,
        meliUrl: catalog.meliUrl || null,
        description: catalog.description,
        images,
        heroImage: images[0] || "/imagens/logo/logo.png",
        affiliateUrl,
        price,
        oldPrice: null,
        discount: null,
        rating: Number((4.6 + ((index % 4) * 0.1)).toFixed(1)),
        reviews: 120 + index * 17,
        available: Boolean(images.length),
        onOffer: catalog.onOffer ?? (index < 8 || index % 4 === 0),
        featured: catalog.featured ?? (index < 10 || index % 6 === 0),
        badge: badgeFor(index),
        tags: [...new Set([...(catalog.categoryTags || []), productTypeSlug, ...(catalog.tags || [])])],
        dataSource: "manual",
        syncStatus: "fallback"
      };

      if (product.id === "tech-001" || product.meliId) {
        console.log(`[ML SYNC] Produto base ${product.id}: meliId=${product.meliId || "null"} dataSource=${product.dataSource}`);
      }

      return product;
    })
  );

  return products;
}

function mergeProductData(product, mercadoLivreData) {
  if (!mercadoLivreData) {
    console.log(`[ML SYNC] Fallback manual para ${product.id}: dados Mercado Livre ausentes.`);
    return { ...product, syncStatus: "fallback" };
  }
  if (mercadoLivreData.syncStatus === "error") {
    console.log(`[ML SYNC] Fallback manual para ${product.id}: erro Mercado Livre: ${mercadoLivreData.errorMessage || "erro desconhecido"}`);
    return {
      ...product,
      syncStatus: "error",
      syncError: mercadoLivreData.errorMessage || "Falha ao sincronizar com Mercado Livre"
    };
  }

  const images = mercadoLivreData.images?.length ? mercadoLivreData.images : product.images;
  const rawMercadoLivrePrice = firstDefined([
    mercadoLivreData.price,
    mercadoLivreData.rawPrice,
    mercadoLivreData.sale_price,
    mercadoLivreData.salePrice,
    mercadoLivreData.current_price,
    mercadoLivreData.currentPrice,
    mercadoLivreData.installments?.amount,
    mercadoLivreData.installments?.total_amount
  ]);
  const mlPrice = Number(rawMercadoLivrePrice);
  const hasMercadoLivrePrice = Number.isFinite(mlPrice) && mlPrice > 0;
  const price = hasMercadoLivrePrice ? mlPrice : product.price;
  const rawMercadoLivreOldPrice = mercadoLivreData.oldPrice;
  const mlOldPrice = Number(rawMercadoLivreOldPrice);
  const oldPrice = Number.isFinite(mlOldPrice) && mlOldPrice > 0 ? mlOldPrice : product.oldPrice;
  const syncStatus = hasMercadoLivrePrice ? "synced" : mercadoLivreData.syncStatus || "partial";
  const dataSource = buildMercadoLivreDataSource(mercadoLivreData.type, syncStatus);
  const discount = oldPrice && price ? Math.max(0, Math.round(((oldPrice - price) / oldPrice) * 100)) : product.discount;
  const heroImage = mercadoLivreData.heroImage || images[0] || product.heroImage;
  const rating = mercadoLivreData.rating ?? product.rating;
  const reviews = mercadoLivreData.reviews ?? mercadoLivreData.soldQuantity ?? product.reviews;

  console.log(
    `[ML PRICE BEFORE] ${JSON.stringify({
      id: product.id,
      localPrice: product.price,
      mercadoLivrePrice: rawMercadoLivrePrice ?? null,
      localOldPrice: product.oldPrice ?? null,
      mercadoLivreOldPrice: rawMercadoLivreOldPrice ?? null
    })}`
  );
  console.log(`[ML RAW PRICE] ${JSON.stringify({ id: product.id, value: rawMercadoLivrePrice ?? null, type: typeof rawMercadoLivrePrice })}`);
  console.log(`[ML PARSED PRICE] ${JSON.stringify({ id: product.id, value: mlPrice, valid: hasMercadoLivrePrice })}`);

  console.log(
    `[ML SYNC] Aplicando merge em ${product.id}: type=${mercadoLivreData.type || "unknown"} price=${hasMercadoLivrePrice ? mlPrice : "fallback-manual"} dataSource=${dataSource} syncStatus=${syncStatus}`
  );
  if (product.id === "tech-001" && dataSource.startsWith("mercadolivre")) {
    console.log("[ML SYNC] Produto tech-001 sincronizado");
  }

  const mergedProduct = {
    ...product,
    name: mercadoLivreData.title || product.name,
    price,
    oldPrice,
    discount,
    images,
    heroImage,
    available: mercadoLivreData.available ?? product.available,
    rating,
    reviews,
    meliType: mercadoLivreData.type || null,
    meliStatus: mercadoLivreData.status || null,
    stock: mercadoLivreData.stock ?? product.stock ?? null,
    soldQuantity: mercadoLivreData.soldQuantity ?? product.soldQuantity ?? null,
    mercadoLivrePermalink: mercadoLivreData.permalink || null,
    seller: mercadoLivreData.seller || product.seller || null,
    syncedAt: mercadoLivreData.fetchedAt,
    dataSource,
    syncStatus
  };

  if (mercadoLivreData.syncWarning) {
    mergedProduct.syncWarning = mercadoLivreData.syncWarning;
  }

  if (rawMercadoLivrePrice !== null && rawMercadoLivrePrice !== undefined) {
    mergedProduct.mercadoLivreRawPrice = rawMercadoLivrePrice;
  }
  if (hasMercadoLivrePrice) {
    mergedProduct.mercadoLivreParsedPrice = mlPrice;
  }

  console.log(
    `[ML PRICE AFTER] ${JSON.stringify({
      id: mergedProduct.id,
      price: mergedProduct.price,
      oldPrice: mergedProduct.oldPrice,
      discount: mergedProduct.discount,
      dataSource: mergedProduct.dataSource,
      syncStatus: mergedProduct.syncStatus
    })}`
  );
  console.log(`[ML FINAL PRICE] ${JSON.stringify({ id: mergedProduct.id, price: mergedProduct.price, source: hasMercadoLivrePrice ? "mercadolivre" : "manual-fallback" })}`);
  console.log(`[ML STATUS] ${JSON.stringify({ id: mergedProduct.id, dataSource: mergedProduct.dataSource, syncStatus: mergedProduct.syncStatus })}`);

  if (hasMercadoLivrePrice) {
    console.log(`[ML MERGE SUCCESS] ${product.id} price=${price} oldPrice=${oldPrice ?? "null"} source=${dataSource}`);
  }

  if (product.id === "tech-001") {
    console.log(
      `[ML SYNC AFTER] ${JSON.stringify({
        id: mergedProduct.id,
        meliId: mergedProduct.meliId,
        dataSource: mergedProduct.dataSource,
        syncStatus: mergedProduct.syncStatus,
        price: mergedProduct.price
      })}`
    );
  }

  return mergedProduct;
}

function buildMercadoLivreDataSource(type, syncStatus) {
  if (syncStatus !== "synced") return "mercadolivre-partial";
  if (type === "item") return "mercadolivre-item";
  if (type === "catalog_product") return "mercadolivre";
  return "mercadolivre";
}

function naturalNumber(filename) {
  const match = filename.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function badgeFor(index) {
  if (index < 2) return "Destaque";
  if (index < 5) return "Studio";
  if (index < 16) return "Energia";
  if (index % 5 === 0) return "Oferta";
  return "Curadoria";
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function finalizeMercadoLivreProduct(product) {
  const rawMercadoLivrePrice = firstDefined([
    product.mercadoLivreParsedPrice,
    product.mercadoLivreRawPrice,
    product.mlPrice,
    product.meliPrice,
    product.mercadoLivrePrice
  ]);
  const parsedMercadoLivrePrice = Number(rawMercadoLivrePrice);
  const hasMercadoLivrePrice = Number.isFinite(parsedMercadoLivrePrice) && parsedMercadoLivrePrice > 0;

  if (product.id === "tech-001") {
    console.log(
      `[FINAL PRODUCT PRICE] ${JSON.stringify({
        id: product.id,
        currentPrice: product.price,
        rawMercadoLivrePrice: rawMercadoLivrePrice ?? null,
        parsedMercadoLivrePrice,
        hasMercadoLivrePrice
      })}`
    );
    console.log(`[FINAL PRODUCT SOURCE] ${JSON.stringify({ id: product.id, dataSource: product.dataSource })}`);
    console.log(`[FINAL PRODUCT STATUS] ${JSON.stringify({ id: product.id, syncStatus: product.syncStatus })}`);
  }

  if (!hasMercadoLivrePrice) return product;

  return {
    ...product,
    price: parsedMercadoLivrePrice,
    dataSource: product.meliType === "item" ? "mercadolivre-item" : "mercadolivre",
    syncStatus: "synced"
  };
}

function firstDefined(values) {
  return values.find((value) => value !== null && value !== undefined);
}

async function getCatalogProducts() {
  const importedProducts = await readImportedProducts();
  const productsByKey = new Map();

  productCatalog.forEach((product, index) => {
    const key = getCatalogKey(product);
    productsByKey.set(key, { ...product, order: product.order || index + 1 });
  });

  importedProducts.forEach((product, index) => {
    const key = getCatalogKey(product);
    const existing = productsByKey.get(key);
    if (existing) {
      productsByKey.set(key, {
        ...existing,
        ...product,
        id: existing.id || product.id,
        sku: existing.sku || product.sku,
        meliId: product.meliId || existing.meliId,
        affiliateUrl: product.affiliateUrl || existing.affiliateUrl,
        tags: [...new Set([...(existing.tags || []), ...(product.tags || [])])],
        categoryTags: [...new Set([...(existing.categoryTags || []), ...(product.categoryTags || [])])]
      });
    } else {
      productsByKey.set(key, { ...product, order: product.order || productCatalog.length + index + 1 });
    }
  });

  return [...productsByKey.values()].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function getCatalogKey(product) {
  return product.meliId ? `meli:${getMeliId(product)}` : `sku:${product.sku}`;
}

async function readImportedProducts() {
  try {
    const raw = await fs.readFile(importedProductsFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.products) ? parsed.products : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeImportedProducts(products) {
  await fs.mkdir(path.dirname(importedProductsFile), { recursive: true });
  await fs.writeFile(importedProductsFile, `${JSON.stringify({ products }, null, 2)}\n`);
}

function buildImportedProduct({ existingProduct, mercadoLivreData, meliId, category, affiliateUrl, tags, featured }) {
  const id = existingProduct?.id || `meli-${meliId.toLowerCase()}`;
  const sku = existingProduct?.sku || `meli-${meliId}`;
  const title = mercadoLivreData?.title || existingProduct?.name || meliId;
  const productType = category || existingProduct?.productType || "Mercado Livre";
  const categorySlug = slugify(category);

  return {
    id,
    sku,
    name: title,
    meliId,
    category,
    categorySlug,
    categoryTags: [categorySlug],
    productType,
    description: existingProduct?.description || title,
    tags: [...new Set(tags)],
    affiliateUrl,
    price: mercadoLivreData?.price ?? existingProduct?.price ?? null,
    oldPrice: mercadoLivreData?.oldPrice ?? existingProduct?.oldPrice ?? null,
    featured: Boolean(featured),
    importedFromMercadoLivre: true,
    importedAt: new Date().toISOString()
  };
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof tags === "string") return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function upsertImportedProduct(products, product) {
  const index = products.findIndex((item) => item.meliId === product.meliId || item.id === product.id);
  if (index === -1) return [...products, product];
  const nextProducts = [...products];
  nextProducts[index] = { ...nextProducts[index], ...product, updatedAt: new Date().toISOString() };
  return nextProducts;
}

function toRuntimeProduct(importedProduct, existingProduct) {
  return {
    ...(existingProduct || {}),
    ...importedProduct,
    images: existingProduct?.images || [],
    heroImage: existingProduct?.heroImage || "/imagens/logo/logo.png",
    available: existingProduct?.available ?? false,
    dataSource: "manual",
    syncStatus: "fallback"
  };
}

function createPublicError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}
