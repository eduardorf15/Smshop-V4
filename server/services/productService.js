import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { affiliateLinks } from "../../src/data/affiliate-links.js";
import { productCatalog } from "../../src/data/product-catalog.js";
import { getMercadoLivreData, getMeliId, refreshMercadoLivreCache } from "./mercadoLivreService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const productRoot = path.join(rootDir, "imagens", "tecnologia");
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

async function buildManualProducts() {
  const folderNames = (await fs.readdir(productRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b))
    .filter((folder) => productCatalog.some((product) => product.sku === folder));

  const products = await Promise.all(
    folderNames.map(async (folder, index) => {
      const absoluteFolder = path.join(productRoot, folder);
      const files = (await fs.readdir(absoluteFolder, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && imageExt.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => entry.name)
        .sort((a, b) => naturalNumber(a) - naturalNumber(b));

      const images = files.map((file) => `/imagens/tecnologia/${folder}/${file}`);
      const catalog = productCatalog.find((product) => product.sku === folder);
      const affiliateUrl = catalog.affiliateUrl || affiliateLinks[index] || null;
      const price = catalog.price;
      const category = catalog.category;
      const categorySlug = catalog.categorySlug || slugify(category);
      const productType = catalog.productType || category;
      const productTypeSlug = slugify(productType);
      const id = catalog.id || `tech-${folder}`;
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
        onOffer: index < 8 || index % 4 === 0,
        featured: index < 10 || index % 6 === 0,
        badge: badgeFor(index),
        tags: [...new Set([...(catalog.categoryTags || []), productTypeSlug, ...catalog.tags])],
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
  const hasMercadoLivrePrice = mercadoLivreData.price !== null && mercadoLivreData.price !== undefined;
  const price = hasMercadoLivrePrice ? mercadoLivreData.price : product.price;
  const oldPrice = mercadoLivreData.oldPrice ?? product.oldPrice;
  const syncStatus = hasMercadoLivrePrice ? "synced" : mercadoLivreData.syncStatus || "partial";
  const dataSource = syncStatus === "synced" ? "mercadolivre" : "mercadolivre-partial";

  console.log(
    `[ML SYNC] Aplicando merge em ${product.id}: type=${mercadoLivreData.type || "unknown"} price=${hasMercadoLivrePrice ? mercadoLivreData.price : "fallback-manual"} dataSource=${dataSource} syncStatus=${syncStatus}`
  );
  if (product.id === "tech-001" && dataSource === "mercadolivre") {
    console.log("[ML SYNC] Produto tech-001 sincronizado");
  }

  const mergedProduct = {
    ...product,
    name: mercadoLivreData.title || product.name,
    price,
    oldPrice,
    discount: oldPrice && price ? Math.max(0, Math.round(((oldPrice - price) / oldPrice) * 100)) : product.discount,
    images,
    heroImage: mercadoLivreData.heroImage || images[0] || product.heroImage,
    available: mercadoLivreData.available ?? product.available,
    meliType: mercadoLivreData.type || null,
    meliStatus: mercadoLivreData.status || null,
    stock: mercadoLivreData.stock ?? product.stock ?? null,
    soldQuantity: mercadoLivreData.soldQuantity ?? product.soldQuantity ?? null,
    mercadoLivrePermalink: mercadoLivreData.permalink || null,
    syncedAt: mercadoLivreData.fetchedAt,
    dataSource,
    syncStatus
  };

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
