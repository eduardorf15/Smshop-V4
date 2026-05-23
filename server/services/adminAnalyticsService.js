import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const analyticsFile = path.join(rootDir, "src/data/admin-analytics.json");

export async function recordProductClick({ productId, productName }) {
  const id = String(productId || "").trim();
  if (!id) return { recorded: false };

  const analytics = await readAnalytics();
  const now = new Date().toISOString();
  const product = analytics.products[id] || {
    productId: id,
    productName: productName || id,
    clicks: 0,
    firstClickAt: now,
    lastClickAt: null
  };

  product.productName = productName || product.productName || id;
  product.clicks += 1;
  product.lastClickAt = now;
  analytics.products[id] = product;
  analytics.clicks.unshift({ productId: id, productName: product.productName, clickedAt: now });
  analytics.clicks = analytics.clicks.slice(0, 500);

  await writeAnalytics(analytics);
  return { recorded: true };
}

export async function getAnalyticsSummary() {
  const analytics = await readAnalytics();
  const products = Object.values(analytics.products).sort((a, b) => b.clicks - a.clicks);
  return {
    totalClicks: products.reduce((total, product) => total + Number(product.clicks || 0), 0),
    clicksByProduct: products,
    topProducts: products.slice(0, 10),
    recentClicks: analytics.clicks.slice(0, 20)
  };
}

async function readAnalytics() {
  try {
    const parsed = JSON.parse(await fs.readFile(analyticsFile, "utf8"));
    return {
      products: parsed.products && typeof parsed.products === "object" ? parsed.products : {},
      clicks: Array.isArray(parsed.clicks) ? parsed.clicks : []
    };
  } catch (error) {
    if (error.code === "ENOENT") return { products: {}, clicks: [] };
    throw error;
  }
}

async function writeAnalytics(analytics) {
  await fs.mkdir(path.dirname(analyticsFile), { recursive: true });
  await fs.writeFile(analyticsFile, `${JSON.stringify(analytics, null, 2)}\n`);
}
