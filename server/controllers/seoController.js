import { listProducts } from "../services/productService.js";
import { officialCategories } from "../../src/data/categories.js";

const routes = ["/", "/produtos", ...officialCategories.map((category) => `/categoria/${category.slug}`), "/favoritos", "/ofertas", "/contato", "/sobre", "/politica", "/termos"];

export function getRobots(req, res) {
  const siteUrl = getSiteUrl(req);
  res.type("text/plain").send(`User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`);
}

export async function getSitemap(req, res, next) {
  try {
    const siteUrl = getSiteUrl(req);
    const products = await listProducts();
    const urls = [
      ...routes.map((route) => `${siteUrl}${route}`),
      ...products.map((product) => `${siteUrl}/produto/${product.id}`)
    ];

    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${url}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`
  )
  .join("\n")}
</urlset>`);
  } catch (error) {
    next(error);
  }
}

function getSiteUrl(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}
