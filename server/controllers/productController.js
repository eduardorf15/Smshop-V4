import { listProducts } from "../services/productService.js";

export async function getProducts(req, res, next) {
  try {
    const products = await listProducts();
    const { category, q, sort, featured, offers } = req.query;
    let filtered = [...products];

    if (category) {
      filtered = filtered.filter((product) => product.categorySlug === String(category));
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
        return `${product.name} ${product.category} ${product.tags.join(" ")}`.toLowerCase().includes(term);
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

export async function getProductSummary(_req, res, next) {
  try {
    const products = await listProducts();
    const categories = [...new Set(products.map((product) => product.category))];
    res.json({
      ok: true,
      total: products.length,
      categories,
      offers: products.filter((product) => product.onOffer).length,
      featured: products.filter((product) => product.featured).length
    });
  } catch (error) {
    next(error);
  }
}
