import {
  finalizeMercadoLivreProduct,
  getProductById,
  listProducts,
  refreshProductsCache,
  syncProductsWithMercadoLivre
} from "../services/productService.js";
import { officialCategories } from "../../src/data/categories.js";

export async function getProducts(req, res, next) {
  try {
    const products = await listProducts();
    const { category, q, sort, featured, offers } = req.query;
    let filtered = [...products];

    if (category) {
      const categorySlug = String(category);
      filtered = filtered.filter((product) => product.categorySlug === categorySlug || product.productTypeSlug === categorySlug);
    }

    if (featured === "true") {
      filtered = filtered.filter((product) => product.featured);
    }

    if (offers === "true") {
      filtered = filtered.filter((product) => product.onOffer);
    }

    if (q) {
      const term = String(q).toLowerCase();
      filtered = filtered.filter((product) => {
        return `${product.name} ${product.category} ${product.productType} ${product.tags.join(" ")}`.toLowerCase().includes(term);
      });
    }

    filtered = await syncProductsWithMercadoLivre(filtered);

    filtered = filtered.map(finalizeMercadoLivreProduct);

    if (sort === "price-asc") filtered.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") filtered.sort((a, b) => b.price - a.price);
    if (sort === "discount") filtered.sort((a, b) => Number(b.onOffer) - Number(a.onOffer));
    if (sort === "rating") filtered.sort((a, b) => b.rating - a.rating);

    const tech001 = filtered.find((product) => product.id === "tech-001");
    if (tech001) {
      console.log(`[FINAL PRODUCT PRICE] ${JSON.stringify({ id: tech001.id, price: tech001.price })}`);
      console.log(`[FINAL PRODUCT SOURCE] ${JSON.stringify({ id: tech001.id, dataSource: tech001.dataSource })}`);
      console.log(`[FINAL PRODUCT STATUS] ${JSON.stringify({ id: tech001.id, syncStatus: tech001.syncStatus })}`);
      console.log(
        `[ML SYNC RESPONSE] ${JSON.stringify({
          id: tech001.id,
          meliId: tech001.meliId,
          dataSource: tech001.dataSource,
          syncStatus: tech001.syncStatus,
          price: tech001.price
        })}`
      );
      console.log(
        `[ML SYNC] Resposta final /api/products tech-001: meliId=${tech001.meliId || "null"} dataSource=${tech001.dataSource || "null"} syncStatus=${tech001.syncStatus || "null"} price=${tech001.price}`
      );
      if (tech001.dataSource === "mercadolivre") {
        console.log("[ML SYNC] Produto tech-001 sincronizado");
      } else {
        console.log("[ML SYNC] Fallback manual para tech-001 no res.json final.");
      }
    }

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.json({ ok: true, count: filtered.length, products: filtered });
  } catch (error) {
    next(error);
  }
}

export async function getProduct(req, res, next) {
  try {
    const product = await getProductById(req.params.id);
    if (!product) {
      res.status(404).json({ ok: false, message: "Produto não encontrado." });
      return;
    }
    res.json({ ok: true, product });
  } catch (error) {
    next(error);
  }
}

export async function refreshProductCache(req, res, next) {
  try {
    if (process.env.PRODUCT_CACHE_REFRESH_TOKEN && req.get("x-cache-token") !== process.env.PRODUCT_CACHE_REFRESH_TOKEN) {
      res.status(401).json({ ok: false, message: "Token inválido para atualizar cache." });
      return;
    }
    const result = await refreshProductsCache();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getProductSummary(_req, res, next) {
  try {
    const products = await listProducts();
    const categories = [...new Set([...officialCategories.map((category) => category.name), ...products.map((product) => product.category).filter(Boolean)])];
    const productTypes = [...new Set(products.map((product) => product.productType))];
    res.json({
      ok: true,
      total: products.length,
      categories,
      productTypes,
      offers: products.filter((product) => product.onOffer).length,
      featured: products.filter((product) => product.featured).length
    });
  } catch (error) {
    next(error);
  }
}
