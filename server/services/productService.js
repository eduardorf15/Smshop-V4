import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { affiliateLinks } from "../../src/data/affiliate-links.js";
import { productCatalog } from "../../src/data/product-catalog.js";
import {
  getMercadoLivreData,
  getMeliId,
  refreshMercadoLivreCache,
  resolveMercadoLivreIdFromInput
} from "./mercadoLivreService.js";
import { normalizeMercadoLivreInput as normalizeMercadoLivreInputV2 } from "./mercadoLivre/normalizeInput.js";
import { fetchMercadoLivreData as fetchMercadoLivreDataV2 } from "./mercadoLivre/fetchMercadoLivreData.js";
import { buildImportedProduct as buildImportedProductV2 } from "./mercadoLivre/buildImportedProduct.js";

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

export async function importMercadoLivreProduct({ input, category = "Tecnologia", affiliateUrl, tags = [], featured = false, available = true, price = null }) {
  const normalizedInput = await normalizeMercadoLivreInputV2(input);
  if (!affiliateUrl) {
    throw createPublicError("affiliateUrl é obrigatório para importar produto.", 400);
  }

  const safeCategory = String(category || "Tecnologia");
  const safeTags = normalizeTags(tags);
  const manualPrice = price === null || price === undefined || price === "" ? null : validateOptionalNumber(price, "price", { allowNull: false });
  const { data: mercadoLivreData, trace } = await fetchMercadoLivreDataV2(normalizedInput, { withTrace: true });
  const meliId = normalizedInput.itemId || mercadoLivreData?.itemId || normalizedInput.catalogId || mercadoLivreData?.catalogId || normalizedInput.meliId || await resolveMercadoLivreIdFromInput(input);
  if (!meliId) {
    throw createPublicError("Informe uma URL ou ID válido do Mercado Livre.", 400);
  }
  const existingProducts = await buildManualProducts();
  const existingProduct = existingProducts.find((product) => product.meliId === meliId);

  const importedProducts = await readImportedProducts();
  const importedProduct = buildImportedProductV2({
    existingProduct,
    mercadoLivreData,
    normalizedInput,
    sourceInput: input,
    meliId,
    category: safeCategory,
    affiliateUrl,
    tags: safeTags,
    featured,
    available,
    manualPrice
  });
  importedProduct.importTrace = {
    normalizedInput,
    attempts: trace.attempts,
    parsedFields: trace.parsedFields,
    fallbackTriggers: importedProduct.dataQuality?.fallbackTriggers || []
  };
  const fallbackTriggers = importedProduct.dataQuality?.fallbackTriggers || [];
  if (fallbackTriggers.includes("title") && fallbackTriggers.includes("image") && fallbackTriggers.includes("price")) {
    const message = mercadoLivreData?.officialAccessDenied
      ? "Mercado Livre bloqueou dados automáticos deste produto. Use cadastro manual/IA."
      : "Não foi possível obter título e imagem reais do Mercado Livre. Use cadastro manual/IA para evitar publicar produto genérico.";
    console.log("[ML IMPORT BLOCKED]", JSON.stringify({ input, meliId, message, fallbackTriggers, officialAccessDenied: Boolean(mercadoLivreData?.officialAccessDenied) }));
    throw createPublicError(message, 422);
  }
  console.log("[ML PIPELINE INPUT]", JSON.stringify({ input, itemId: normalizedInput.itemId, catalogId: normalizedInput.catalogId, resolvedUrl: normalizedInput.resolvedUrl }));
  console.log("[ML PIPELINE FOUND]", JSON.stringify(trace.parsedFields));
  console.log("[ML FINAL PAYLOAD]", JSON.stringify(summarizeProductForLog(importedProduct)));
  const nextImportedProducts = upsertImportedProduct(importedProducts, importedProduct);

  await writeImportedProducts(nextImportedProducts);
  const savedProduct = nextImportedProducts.find((product) => product.id === importedProduct.id || (importedProduct.meliId && product.meliId === importedProduct.meliId)) || importedProduct;
  console.log("[ML SAVED PRODUCT]", JSON.stringify(summarizeProductForLog(savedProduct)));
  cache = null;
  cacheFetchedAt = 0;
  return {
    imported: !existingProduct,
    updated: Boolean(existingProduct),
    product: toRuntimeProduct(importedProduct, existingProduct)
  };
}

export async function getAdminProducts() {
  const [products, importedProducts] = await Promise.all([listProducts(), readImportedProducts()]);
  const importedIds = new Set(importedProducts.map((product) => product.id).filter(Boolean));
  const importedMeliIds = new Set(importedProducts.map((product) => product.meliId).filter(Boolean));
  return products.map((product) => ({
    ...product,
    importedRecord: importedIds.has(product.id) || (product.meliId && importedMeliIds.has(product.meliId)),
    editable: true
  }));
}

export async function createManualProduct(payload = {}) {
  const updates = validateManualProductUpdates({
    ...payload,
    affiliateUrl: payload.affiliateUrl,
    price: payload.price,
    oldPrice: payload.oldPrice ?? null,
    available: payload.available ?? true,
    featured: payload.featured ?? false,
    category: payload.category || "Tecnologia",
    tags: payload.tags || []
  });
  const name = String(payload.name || "").trim();
  if (!name) throw createPublicError("Nome do produto é obrigatório.", 400);
  if (!updates.affiliateUrl) throw createPublicError("affiliateUrl é obrigatório.", 400);

  const importedProducts = await readImportedProducts();
  const id = uniqueImportedId(importedProducts, payload.id || slugify(name));
  const category = updates.category || "Tecnologia";
  const product = {
    id,
    sku: id,
    name,
    description: String(payload.description || name).trim(),
    productType: String(payload.productType || category).trim(),
    productTypeSlug: slugify(payload.productType || category),
    images: normalizeImageList(payload.images),
    heroImage: normalizeImageList(payload.images)[0] || "/imagens/logo/logo.png",
    badge: String(payload.badge || "Curadoria").trim(),
    onOffer: Boolean(payload.onOffer),
    importedManual: true,
    importedAt: new Date().toISOString(),
    ...updates
  };

  await writeImportedProducts(upsertImportedProduct(importedProducts, product));
  clearProductMemoryCache();
  return { product: (await getAdminProducts()).find((item) => item.id === id) || product };
}

export async function updateProductManualData(id, updates = {}) {
  const productId = String(id || "").trim();
  if (!productId) {
    throw createPublicError("ID do produto é obrigatório.", 400);
  }

  const allowedUpdates = validateManualProductUpdates(updates);
  if (!Object.keys(allowedUpdates).length) {
    throw createPublicError("Nenhum campo manual válido enviado para atualização.", 400);
  }

  const catalogProducts = await getCatalogProducts();
  const existingProduct = catalogProducts.find((product) => product.id === productId || product.sku === productId);
  if (!existingProduct) {
    throw createPublicError("Produto não encontrado.", 404);
  }

  const importedProducts = await readImportedProducts();
  const importedProduct = buildManualDataOverride(existingProduct, allowedUpdates);
  const nextImportedProducts = upsertImportedProduct(importedProducts, importedProduct);

  await writeImportedProducts(nextImportedProducts);
  cache = null;
  cacheFetchedAt = 0;

  const products = await listProducts();
  const updatedProduct = products.find((product) => product.id === existingProduct.id || product.sku === existingProduct.sku);

  return {
    storageFile: importedProductsFile,
    product: updatedProduct || {
      ...existingProduct,
      ...allowedUpdates
    }
  };
}

export async function deleteAdminProduct(id) {
  const productId = String(id || "").trim();
  if (!productId) throw createPublicError("ID do produto é obrigatório.", 400);

  const importedProducts = await readImportedProducts();
  const products = await getCatalogProducts();
  const existingProduct = products.find((product) => product.id === productId || product.sku === productId);
  if (!existingProduct) throw createPublicError("Produto não encontrado.", 404);

  const nextImportedProducts = importedProducts.filter((product) => product.id !== existingProduct.id && product.sku !== existingProduct.sku);
  const wasImported = nextImportedProducts.length !== importedProducts.length;

  if (!wasImported) {
    nextImportedProducts.push({
      id: existingProduct.id,
      sku: existingProduct.sku,
      meliId: existingProduct.meliId || null,
      adminDeleted: true,
      deletedAt: new Date().toISOString()
    });
  }

  await writeImportedProducts(nextImportedProducts);
  clearProductMemoryCache();
  return { deleted: true, id: existingProduct.id, hiddenBaseProduct: !wasImported };
}

export async function syncAdminProduct(id) {
  const products = await buildManualProducts();
  const product = products.find((item) => item.id === id || item.sku === id);
  if (!product) throw createPublicError("Produto não encontrado.", 404);
  if (!product.meliId) throw createPublicError("Produto sem meliId para sincronizar.", 400);

  const [syncedProduct] = await syncProductsWithMercadoLivre([product], { force: true });
  await persistSyncedImportedProduct(product, syncedProduct);
  clearProductMemoryCache();
  return { product: syncedProduct };
}

export async function forceRefreshMercadoLivreProducts() {
  const products = await buildManualProducts();
  const productsWithMeliId = products.filter((product) => product.meliId);
  const result = await refreshMercadoLivreCache(productsWithMeliId);
  cache = null;
  cacheFetchedAt = 0;
  const syncedProducts = await listProducts();
  await Promise.all(
    productsWithMeliId.map((product) => {
      const syncedProduct = syncedProducts.find((item) => item.id === product.id || item.sku === product.sku || item.meliId === product.meliId);
      return syncedProduct ? persistSyncedImportedProduct(product, syncedProduct) : null;
    })
  );

  return {
    ...result,
    total: products.length,
    withMeliId: productsWithMeliId.length,
    refreshed: syncedProducts.filter((product) => product.meliId && product.syncStatus === "synced").length
  };
}

export function clearProductMemoryCache() {
  cache = null;
  cacheFetchedAt = 0;
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

      const fileImages = files.map((file) => `/imagens/tecnologia/${folder}/${file}`).filter(usefulImage);
      const storedImages = normalizeImageList(catalog.images).filter(usefulImage);
      const prefersStoredImages = Boolean(catalog.manualDataUpdatedAt || catalog.importedFromMercadoLivre || catalog.importedManual || !folderNames.has(folder));
      const images = prefersStoredImages && storedImages.length ? storedImages : fileImages.length ? fileImages : storedImages;
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
        name: meaningfulProductText(catalog.name) || `Produto ${id}`,
        category,
        categorySlug,
        productType,
        productTypeSlug,
        meliId,
        meliType: catalog.meliType || null,
        itemId: catalog.itemId || null,
        catalogProductId: catalog.catalogProductId || null,
        sourceInput: catalog.sourceInput || null,
        resolvedUrl: catalog.resolvedUrl || null,
        meliUrl: catalog.meliUrl || null,
        mercadoLivrePermalink: catalog.mercadoLivrePermalink || null,
        description: meaningfulProductText(catalog.description) || meaningfulProductText(catalog.name) || `Produto ${id}`,
        images,
        heroImage: usefulImage(catalog.heroImage) || images[0] || "/imagens/logo/logo.png",
        affiliateUrl,
        price,
        oldPrice: catalog.oldPrice ?? null,
        discount: catalog.discount ?? null,
        rating: Number((4.6 + ((index % 4) * 0.1)).toFixed(1)),
        reviews: 120 + index * 17,
        available: catalog.available ?? Boolean(images.length),
        onOffer: catalog.onOffer ?? (index < 8 || index % 4 === 0),
        featured: catalog.featured ?? (index < 10 || index % 6 === 0),
        badge: catalog.badge || badgeFor(index),
        tags: [...new Set([...(catalog.categoryTags || []), productTypeSlug, ...(catalog.tags || [])])],
        importedFromMercadoLivre: Boolean(catalog.importedFromMercadoLivre),
        importedManual: Boolean(catalog.importedManual),
        importedAt: catalog.importedAt || null,
        manualDataUpdatedAt: catalog.manualDataUpdatedAt || null,
        updatedAt: catalog.updatedAt || null,
        syncWarning: catalog.syncWarning || null,
        syncWarnings: catalog.syncWarnings || [],
        syncMethod: catalog.syncMethod || null,
        syncedAt: catalog.syncedAt || null,
        meliStatus: catalog.meliStatus || null,
        stock: catalog.stock ?? null,
        soldQuantity: catalog.soldQuantity ?? null,
        seller: catalog.seller || null,
        manualPriceOverride: Boolean(catalog.manualPriceOverride),
        dataSource: catalog.dataSource || "manual",
        syncStatus: catalog.syncStatus || "fallback"
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
    if (product.importedFromMercadoLivre && Number.isFinite(Number(product.price)) && Number(product.price) > 0) {
      return {
        ...product,
        dataSource: "mercadolivre-partial",
        syncStatus: "partial",
        syncWarning: mercadoLivreData.errorMessage || "Preco manual porque ML bloqueou API",
        syncError: mercadoLivreData.errorMessage || "Falha ao sincronizar com Mercado Livre"
      };
    }
    return {
      ...product,
      syncStatus: "error",
      syncError: mercadoLivreData.errorMessage || "Falha ao sincronizar com Mercado Livre"
    };
  }

  const hasManualOverride = Boolean(product.manualDataUpdatedAt);
  const mercadoLivreImages = normalizeImageList(mercadoLivreData.images).filter(usefulImage);
  const productImages = normalizeImageList(product.images).filter(usefulImage);
  const images = hasManualOverride && productImages.length ? productImages : mercadoLivreImages.length ? mercadoLivreImages : productImages;
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
  const hasManualPriceOverride = Boolean(product.manualPriceOverride || hasManualOverride) && positiveNumberOrNull(product.price) !== null;
  const price = hasManualPriceOverride ? positiveNumberOrNull(product.price) : hasMercadoLivrePrice ? mlPrice : positiveNumberOrNull(product.price);
  const rawMercadoLivreOldPrice = mercadoLivreData.oldPrice;
  const mlOldPrice = Number(rawMercadoLivreOldPrice);
  const oldPrice = Number.isFinite(mlOldPrice) && mlOldPrice > 0 ? mlOldPrice : product.oldPrice;
  const syncStatus = hasMercadoLivrePrice || hasManualPriceOverride ? "synced" : mercadoLivreData.syncStatus || "partial";
  const dataSource = hasManualPriceOverride && !hasMercadoLivrePrice ? "mercadolivre-partial" : buildMercadoLivreDataSource(mercadoLivreData.type, syncStatus);
  const discount = oldPrice && price ? Math.max(0, Math.round(((oldPrice - price) / oldPrice) * 100)) : product.discount;
  const heroImage = hasManualOverride
    ? usefulImage(product.heroImage) || images[0] || usefulImage(mercadoLivreData.heroImage) || "/imagens/logo/logo.png"
    : usefulImage(mercadoLivreData.heroImage) || images[0] || usefulImage(product.heroImage) || "/imagens/logo/logo.png";
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
  if (hasManualOverride) {
    console.log(`[PRODUCT PERSISTENCE] Mantendo edição manual em ${product.id} como prioridade sobre dados Mercado Livre.`);
  }
  if (!mercadoLivreImages.length && normalizeImageList(mercadoLivreData.images).length) {
    console.log(`[PRODUCT PERSISTENCE] Imagens Mercado Livre ignoradas em ${product.id} por fallback/logo/placeholder.`);
  }
  if (product.id === "tech-001" && dataSource.startsWith("mercadolivre")) {
    console.log("[ML SYNC] Produto tech-001 sincronizado");
  }

  const mergedProduct = {
    ...product,
    name: hasManualOverride
      ? meaningfulProductText(product.name) || meaningfulProductText(mercadoLivreData.title) || product.name
      : isReviewTitle(mercadoLivreData.title) ? product.name : meaningfulProductText(mercadoLivreData.title) || product.name,
    description: hasManualOverride
      ? meaningfulProductText(product.description) || meaningfulProductText(mercadoLivreData.description) || product.description
      : meaningfulProductText(mercadoLivreData.description) || product.description,
    price,
    oldPrice,
    discount,
    images,
    heroImage,
    available: mercadoLivreData.available ?? product.available,
    rating,
    reviews,
    meliType: mercadoLivreData.type || product.meliType || null,
    meliStatus: mercadoLivreData.status || product.meliStatus || null,
    itemId: mercadoLivreData.itemId || product.itemId || null,
    catalogProductId: mercadoLivreData.catalogProductId || product.catalogProductId || null,
    sourceInput: mercadoLivreData.sourceInput || product.sourceInput || null,
    resolvedUrl: mercadoLivreData.resolvedUrl || product.resolvedUrl || null,
    stock: mercadoLivreData.stock ?? product.stock ?? null,
    soldQuantity: mercadoLivreData.soldQuantity ?? product.soldQuantity ?? null,
    mercadoLivrePermalink: mercadoLivreData.permalink || product.mercadoLivrePermalink || product.resolvedUrl || null,
    seller: mercadoLivreData.seller || product.seller || null,
    syncedAt: mercadoLivreData.fetchedAt,
    dataSource,
    syncStatus,
    syncMethod: mercadoLivreData.syncMethod || (hasMercadoLivrePrice ? "API OK" : "API parcial"),
    syncWarnings: mercadoLivreData.syncWarnings || []
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

  if (!hasMercadoLivrePrice || ((product.manualDataUpdatedAt || product.manualPriceOverride) && positiveNumberOrNull(product.price) !== null)) return product;

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
    if (product.adminDeleted) {
      const key = getCatalogKey(product);
      productsByKey.delete(key);
      if (product.id) productsByKey.delete(`id:${product.id}`);
      if (product.sku) productsByKey.delete(`sku:${product.sku}`);
      return;
    }
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
  console.log(`[PRODUCT PERSISTENCE] imported-products.json salvo com ${products.length} produto(s).`);
}

async function persistSyncedImportedProduct(originalProduct, syncedProduct) {
  const importedProducts = await readImportedProducts();
  const index = importedProducts.findIndex((product) => product.id === originalProduct.id || product.sku === originalProduct.sku || (originalProduct.meliId && product.meliId === originalProduct.meliId));
  if (index === -1) return;
  const current = importedProducts[index];
  const preserveManual = Boolean(current.manualDataUpdatedAt || originalProduct.manualDataUpdatedAt);
  const currentImages = normalizeImageList(current.images).filter(usefulImage);
  const syncedImages = normalizeImageList(syncedProduct.images).filter(usefulImage);
  if (preserveManual) {
    console.log(`[PRODUCT PERSISTENCE] Sync preservou edição manual persistida em ${current.id || current.sku}.`);
  }
  const next = {
    ...current,
    name: preserveManual ? meaningfulProductText(current.name) || meaningfulProductText(syncedProduct.name) || current.name : meaningfulProductText(syncedProduct.name) || current.name,
    description: preserveManual ? meaningfulProductText(current.description) || meaningfulProductText(syncedProduct.description) || current.description : meaningfulProductText(syncedProduct.description) || current.description,
    price: (preserveManual || current.manualPriceOverride) && positiveNumberOrNull(current.price) !== null
      ? positiveNumberOrNull(current.price)
      : Number.isFinite(Number(syncedProduct.mercadoLivreParsedPrice)) && Number(syncedProduct.mercadoLivreParsedPrice) > 0
      ? Number(syncedProduct.mercadoLivreParsedPrice)
      : positiveNumberOrNull(current.price),
    oldPrice: syncedProduct.oldPrice ?? current.oldPrice ?? null,
    images: preserveManual && currentImages.length ? currentImages : syncedImages.length ? syncedImages : currentImages,
    heroImage: preserveManual
      ? usefulImage(current.heroImage) || currentImages[0] || usefulImage(syncedProduct.heroImage) || syncedImages[0] || "/imagens/logo/logo.png"
      : usefulImage(syncedProduct.heroImage) || syncedImages[0] || usefulImage(current.heroImage) || currentImages[0] || "/imagens/logo/logo.png",
    available: syncedProduct.available ?? current.available,
    mercadoLivrePermalink: syncedProduct.mercadoLivrePermalink || current.mercadoLivrePermalink || null,
    meliType: syncedProduct.meliType || current.meliType || null,
    meliStatus: syncedProduct.meliStatus || current.meliStatus || null,
    itemId: syncedProduct.itemId || current.itemId || null,
    catalogProductId: syncedProduct.catalogProductId || current.catalogProductId || null,
    sourceInput: syncedProduct.sourceInput || current.sourceInput || null,
    resolvedUrl: syncedProduct.resolvedUrl || current.resolvedUrl || null,
    stock: syncedProduct.stock ?? current.stock ?? null,
    soldQuantity: syncedProduct.soldQuantity ?? current.soldQuantity ?? null,
    seller: syncedProduct.seller || current.seller || null,
    dataSource: syncedProduct.dataSource || current.dataSource,
    syncStatus: syncedProduct.syncStatus || current.syncStatus,
    syncMethod: syncedProduct.syncMethod || current.syncMethod || null,
    syncWarnings: syncedProduct.syncWarnings || current.syncWarnings || [],
    syncWarning: syncedProduct.syncWarning || current.syncWarning || null,
    syncedAt: syncedProduct.syncedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    affiliateUrl: current.affiliateUrl,
    manualPriceOverride: Boolean(current.manualPriceOverride)
  };
  const nextProducts = [...importedProducts];
  nextProducts[index] = next;
  await writeImportedProducts(nextProducts);
}

function buildImportedProduct({ existingProduct, mercadoLivreData, mercadoLivreError, sourceInput, meliId, category, affiliateUrl, tags, featured, available, manualPrice }) {
  const id = existingProduct?.id || `meli-${meliId.toLowerCase()}`;
  const sku = existingProduct?.sku || `meli-${meliId}`;
  const preserveManual = Boolean(existingProduct?.manualDataUpdatedAt);
  const finalMercadoLivre = normalizeFinalMercadoLivreData(mercadoLivreData);
  const existingImages = normalizeImageList(existingProduct?.images).filter(usefulImage);
  const mercadoLivreImages = finalMercadoLivre.images;
  const title = preserveManual
    ? meaningfulProductText(existingProduct?.name) || finalMercadoLivre.title || fallbackTitle(meliId, "título manual/ML ausente")
    : finalMercadoLivre.title || meaningfulProductText(existingProduct?.name) || fallbackTitle(meliId, "título ML ausente");
  const productType = category || existingProduct?.productType || "Mercado Livre";
  const categorySlug = slugify(category);
  const hasMercadoLivrePrice = finalMercadoLivre.price !== null;
  const hasManualPrice = Number.isFinite(Number(manualPrice)) && Number(manualPrice) > 0;
  const hasImage = Boolean(finalMercadoLivre.heroImage || mercadoLivreImages.length || usefulImage(existingProduct?.heroImage) || existingImages.length);
  const syncStatus = hasImage && !/revisar título/i.test(title) ? "synced" : "partial";
  const syncWarnings = buildImportWarnings({ mercadoLivreData, mercadoLivreError, hasMercadoLivrePrice, hasManualPrice, hasImage, title });
  const description = preserveManual
    ? meaningfulProductText(existingProduct?.description) || finalMercadoLivre.description || title
    : finalMercadoLivre.description || meaningfulProductText(existingProduct?.description) || title;
  const images = preserveManual && existingImages.length ? existingImages : mercadoLivreImages.length ? mercadoLivreImages : existingImages;
  const heroImage = preserveManual
    ? usefulImage(existingProduct?.heroImage) || existingImages[0] || finalMercadoLivre.heroImage || mercadoLivreImages[0] || fallbackImage("imagem manual/ML ausente")
    : finalMercadoLivre.heroImage || mercadoLivreImages[0] || usefulImage(existingProduct?.heroImage) || existingImages[0] || fallbackImage("imagem ML ausente");
  const finalPrice = hasManualPrice ? Number(manualPrice) : finalMercadoLivre.price ?? positiveNumberOrNull(existingProduct?.price);

  return {
    id,
    sku,
    name: title,
    meliId,
    meliType: finalMercadoLivre.type || null,
    itemId: finalMercadoLivre.itemId || (finalMercadoLivre.type === "item" ? meliId : null),
    catalogProductId: finalMercadoLivre.catalogProductId || (finalMercadoLivre.type === "catalog_product" ? meliId : null),
    sourceInput: String(sourceInput || "").trim(),
    resolvedUrl: finalMercadoLivre.resolvedUrl || null,
    category,
    categorySlug,
    categoryTags: [categorySlug],
    productType,
    description,
    images,
    heroImage,
    tags: [...new Set(tags)],
    affiliateUrl,
    price: finalPrice,
    oldPrice: finalMercadoLivre.oldPrice ?? existingProduct?.oldPrice ?? null,
    available: Boolean(available ?? finalMercadoLivre.available ?? existingProduct?.available ?? true),
    badge: existingProduct?.badge || "Importado",
    rating: finalMercadoLivre.rating ?? existingProduct?.rating ?? null,
    reviews: finalMercadoLivre.reviews ?? finalMercadoLivre.soldQuantity ?? existingProduct?.reviews ?? null,
    mercadoLivrePermalink: finalMercadoLivre.permalink || existingProduct?.mercadoLivrePermalink || null,
    meliStatus: finalMercadoLivre.status || null,
    stock: finalMercadoLivre.stock ?? null,
    soldQuantity: finalMercadoLivre.soldQuantity ?? null,
    seller: finalMercadoLivre.seller || null,
    featured: Boolean(featured),
    importedFromMercadoLivre: true,
    importedAt: new Date().toISOString(),
    syncedAt: finalMercadoLivre.fetchedAt || new Date().toISOString(),
    dataSource: syncStatus === "synced" ? buildMercadoLivreDataSource(finalMercadoLivre.type, syncStatus) : "mercadolivre-partial",
    syncStatus,
    syncMethod: finalMercadoLivre.syncMethod || (syncStatus === "synced" ? "API OK" : "Manual/revisar"),
    syncWarnings,
    syncWarning: syncWarnings[0] || null,
    manualPriceOverride: hasManualPrice
  };
}

function buildImportWarnings({ mercadoLivreData, mercadoLivreError, hasMercadoLivrePrice, hasManualPrice, hasImage, title }) {
  return [...new Set([
    ...(mercadoLivreData?.syncWarnings || []),
    mercadoLivreError,
    hasMercadoLivrePrice ? priceSourceMessage(mercadoLivreData?.syncMethod) : "",
    !hasMercadoLivrePrice && hasManualPrice ? "Preço manual usado" : "",
    !hasMercadoLivrePrice && !hasManualPrice ? "preço não encontrado" : "",
    !hasMercadoLivrePrice && !hasManualPrice ? "preço precisa ser preenchido manualmente" : "",
    !hasImage ? "Imagem não encontrada, revise manualmente" : "",
    /revisar título/i.test(title) ? "Título não encontrado, revise manualmente" : ""
  ].filter(Boolean))];
}

function normalizeFinalMercadoLivreData(data) {
  const title = isReviewTitle(data?.title) ? "" : meaningfulProductText(data?.title || data?.name);
  const description = meaningfulProductText(data?.description || data?.summary) || title;
  const images = [...new Set([
    usefulImage(data?.heroImage),
    ...normalizeImageList(data?.images).filter(usefulImage),
    usefulImage(data?.thumbnail)
  ].filter(Boolean))];
  const price = positiveNumberOrNull(firstDefined([
    data?.price,
    data?.chosenPrice,
    data?.mercadoLivreParsedPrice,
    data?.rawPrice,
    data?.sale_price,
    data?.salePrice,
    data?.current_price,
    data?.currentPrice
  ]));
  if (!title && data) console.log("[ML FALLBACK TRIGGERED]", "título final ML ausente ou genérico");
  if (!images.length && data) console.log("[ML FALLBACK TRIGGERED]", "imagem final ML ausente ou inválida");
  if (price === null && data) console.log("[ML FALLBACK TRIGGERED]", "preço final ML ausente");
  return {
    title,
    description,
    images,
    heroImage: images[0] || "",
    price,
    oldPrice: positiveNumberOrNull(data?.oldPrice),
    type: data?.type || null,
    itemId: data?.itemId || null,
    catalogProductId: data?.catalogProductId || null,
    resolvedUrl: data?.resolvedUrl || null,
    permalink: data?.permalink || null,
    available: data?.available,
    status: data?.status || null,
    stock: data?.stock,
    soldQuantity: data?.soldQuantity,
    seller: data?.seller || null,
    rating: data?.rating,
    reviews: data?.reviews,
    fetchedAt: data?.fetchedAt || null,
    syncMethod: data?.syncMethod || null
  };
}

function fallbackTitle(meliId, reason) {
  console.log("[ML FALLBACK TRIGGERED]", reason);
  return `Produto Mercado Livre ${meliId} — revisar título`;
}

function fallbackImage(reason) {
  console.log("[ML FALLBACK TRIGGERED]", reason);
  return "/imagens/logo/logo.png";
}

function summarizeProductForLog(product) {
  return {
    id: product?.id,
    meliId: product?.meliId,
    meliType: product?.meliType,
    itemId: product?.itemId,
    catalogProductId: product?.catalogProductId,
    name: product?.name,
    description: product?.description,
    price: product?.price ?? null,
    heroImage: product?.heroImage,
    images: product?.images,
    mercadoLivrePermalink: product?.mercadoLivrePermalink,
    affiliateUrl: product?.affiliateUrl,
    dataSource: product?.dataSource,
    syncStatus: product?.syncStatus,
    syncMethod: product?.syncMethod,
    syncWarnings: product?.syncWarnings
  };
}

function priceSourceMessage(syncMethod) {
  if (syncMethod === "Fallback HTML") return "Preço puxado do HTML";
  if (syncMethod === "Fallback search") return "Preço puxado da busca";
  if (syncMethod === "API OK" || syncMethod === "API parcial") return "Preço puxado da API";
  return "";
}

function isReviewTitle(value) {
  return /Produto Mercado Livre .*revisar título/i.test(String(value || ""));
}

function meaningfulProductText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (isReviewTitle(text)) return "";
  if (/^(mercado\s*livre|mercadolivre|produto\s+mercado\s+livre)$/i.test(text)) return "";
  if (/^mercado\s*livre\s+brasil$/i.test(text)) return "";
  return text;
}

function usefulImage(value) {
  const image = String(value || "").trim();
  if (!image || /logo\/logo\.png|placeholder|favicon/i.test(image)) return "";
  return image;
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function buildManualDataOverride(existingProduct, updates) {
  console.log(`[PRODUCT PERSISTENCE] Salvando edição manual de ${existingProduct.id || existingProduct.sku}: ${Object.keys(updates).join(", ")}`);
  const override = {
    id: existingProduct.id,
    sku: existingProduct.sku,
    manualDataUpdatedAt: new Date().toISOString(),
    ...updates
  };

  if (existingProduct.meliId) override.meliId = existingProduct.meliId;
  return override;
}

function validateManualProductUpdates(updates) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw createPublicError("Body inválido para atualização manual.", 400);
  }

  const allowed = {};
  if (Object.prototype.hasOwnProperty.call(updates, "affiliateUrl")) {
    allowed.affiliateUrl = validateAffiliateUrl(updates.affiliateUrl);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "price")) {
    allowed.price = validateOptionalNumber(updates.price, "price", { allowNull: false });
  }
  if (Object.prototype.hasOwnProperty.call(updates, "oldPrice")) {
    allowed.oldPrice = validateOptionalNumber(updates.oldPrice, "oldPrice", { allowNull: true });
  }
  if (Object.prototype.hasOwnProperty.call(updates, "available")) {
    if (typeof updates.available !== "boolean") {
      throw createPublicError("available deve ser booleano.", 400);
    }
    allowed.available = updates.available;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "featured")) {
    if (typeof updates.featured !== "boolean") {
      throw createPublicError("featured deve ser booleano.", 400);
    }
    allowed.featured = updates.featured;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "category")) {
    const category = String(updates.category || "").trim();
    if (!category) throw createPublicError("category não pode ficar vazio.", 400);
    allowed.category = category;
    allowed.categorySlug = slugify(category);
    allowed.categoryTags = [allowed.categorySlug];
  }
  if (Object.prototype.hasOwnProperty.call(updates, "tags")) {
    allowed.tags = normalizeTags(updates.tags);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    const name = String(updates.name || "").trim();
    if (!name) throw createPublicError("name não pode ficar vazio.", 400);
    allowed.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "description")) {
    allowed.description = String(updates.description || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "badge")) {
    allowed.badge = String(updates.badge || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, "images")) {
    allowed.images = normalizeImageList(updates.images);
    allowed.heroImage = allowed.images[0] || "/imagens/logo/logo.png";
  }

  return allowed;
}

function validateAffiliateUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw createPublicError("affiliateUrl deve ser uma URL válida.", 400);
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw createPublicError("affiliateUrl deve ser uma URL válida.", 400);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw createPublicError("affiliateUrl deve usar http ou https.", 400);
  }

  return url.toString();
}

function validateOptionalNumber(value, field, { allowNull }) {
  if (value === null && allowNull) return null;
  if (value === null || value === "") {
    if (allowNull) return null;
    throw createPublicError(`${field} deve ser um número válido.`, 400);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (field === "price" && number <= 0)) {
    throw createPublicError(`${field} deve ser um número válido.`, 400);
  }
  return number;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof tags === "string") return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function normalizeImageList(images) {
  if (Array.isArray(images)) return images.map((image) => String(image).trim()).filter(Boolean);
  if (typeof images === "string") return images.split("\n").flatMap((line) => line.split(",")).map((image) => image.trim()).filter(Boolean);
  return [];
}

function uniqueImportedId(products, seed) {
  const base = `admin-${slugify(seed || "produto")}`.replace(/-+$/g, "") || "admin-produto";
  const existing = new Set(products.map((product) => product.id));
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function upsertImportedProduct(products, product) {
  const index = products.findIndex((item) => {
    if (product.meliId && item.meliId === product.meliId) return true;
    return item.id === product.id;
  });
  if (index === -1) return [...products, product];
  const nextProducts = [...products];
  nextProducts[index] = { ...nextProducts[index], ...product, updatedAt: new Date().toISOString() };
  return nextProducts;
}

function toRuntimeProduct(importedProduct, existingProduct) {
  const importedImages = normalizeImageList(importedProduct.images).filter(usefulImage);
  const existingImages = normalizeImageList(existingProduct?.images).filter(usefulImage);
  return {
    ...(existingProduct || {}),
    ...importedProduct,
    images: importedImages.length ? importedImages : existingImages,
    heroImage: usefulImage(importedProduct.heroImage) || importedImages[0] || usefulImage(existingProduct?.heroImage) || existingImages[0] || "/imagens/logo/logo.png",
    available: importedProduct.available ?? existingProduct?.available ?? true,
    dataSource: importedProduct.dataSource || "manual",
    syncStatus: importedProduct.syncStatus || "fallback"
  };
}

function createPublicError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}
