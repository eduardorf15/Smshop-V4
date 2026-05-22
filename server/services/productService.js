import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { affiliateLinks } from "../../src/data/affiliate-links.js";
import { productCatalog } from "../../src/data/product-catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const productRoot = path.join(rootDir, "imagens", "tecnologia");
const imageExt = new Set([".webp", ".png", ".jpg", ".jpeg", ".avif"]);
let cache;

export async function listProducts() {
  if (cache && process.env.NODE_ENV === "production") return cache;

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
      const price = catalog.price;
      const category = catalog.category;
      const categorySlug = catalog.categorySlug || slugify(category);
      const productType = catalog.productType || category;
      const productTypeSlug = slugify(productType);

      return {
        id: `tech-${folder}`,
        sku: folder,
        order: index + 1,
        name: catalog.name,
        category,
        categorySlug,
        productType,
        productTypeSlug,
        description: catalog.description,
        images,
        heroImage: images[0] || "/imagens/logo/logo.png",
        affiliateUrl: affiliateLinks[index] || null,
        price,
        oldPrice: null,
        discount: null,
        rating: Number((4.6 + ((index % 4) * 0.1)).toFixed(1)),
        reviews: 120 + index * 17,
        available: Boolean(images.length),
        onOffer: index < 8 || index % 4 === 0,
        featured: index < 10 || index % 6 === 0,
        badge: badgeFor(index),
        tags: [...new Set([...(catalog.categoryTags || []), productTypeSlug, ...catalog.tags])]
      };
    })
  );

  cache = products;
  return products;
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
