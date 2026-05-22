import { getProductById, listProducts, refreshProductsCache } from "../services/productService.js";

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

    if (sort === "price-asc") filtered.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") filtered.sort((a, b) => b.price - a.price);
    if (sort === "discount") filtered.sort((a, b) => Number(b.onOffer) - Number(a.onOffer));
    if (sort === "rating") filtered.sort((a, b) => b.rating - a.rating);

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
    const categories = [...new Set(products.map((product) => product.category))];
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
