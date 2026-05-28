import { getAnalyticsSummary } from "./adminAnalyticsService.js";
import { getAdminAlerts } from "./adminAlertsService.js";
import { getAdminProducts, getSyncReport } from "./productService.js";
import { officialCategories } from "../../src/data/categories.js";

export async function getAdminDashboard() {
  const [products, syncReport, analytics, alerts] = await Promise.all([getAdminProducts(), getSyncReport(), getAnalyticsSummary(), getAdminAlerts()]);
  const imported = products.filter((product) => product.importedFromMercadoLivre || product.importedManual || product.importedRecord);
  const automatic = products.filter((product) => product.meliId);
  const manual = products.filter((product) => !product.meliId || product.importedManual || product.dataSource === "manual");
  const active = products.filter((product) => product.available !== false);
  const featured = products.filter((product) => product.featured);
  const needsPriceReview = products.filter((product) => {
    return product.meliId && ["partial", "error", "fallback"].includes(product.syncStatus);
  });
  const lastSync = products
    .map((product) => product.syncedAt || product.updatedAt || product.importedAt || product.manualDataUpdatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const lastProductAdded = [...products]
    .sort((a, b) => String(b.importedAt || b.manualDataUpdatedAt || b.updatedAt || "").localeCompare(String(a.importedAt || a.manualDataUpdatedAt || a.updatedAt || "")))
    .at(0) || null;

  return {
    totalProducts: products.length,
    importedProducts: imported.length,
    automaticProducts: automatic.length,
    manualProducts: manual.length,
    activeProducts: active.length,
    featuredProducts: featured.length,
    errorProducts: products.filter((product) => product.syncStatus === "error").length,
    partialProducts: products.filter((product) => product.syncStatus === "partial").length,
    fallbackProducts: products.filter((product) => product.syncStatus === "fallback").length,
    officialCategories: officialCategories.length,
    categories: officialCategories.map((category) => ({
      ...category,
      products: products.filter((product) => product.categorySlug === category.slug).length
    })),
    needsPriceReviewProducts: needsPriceReview.length,
    lastProductAdded,
    lastSync,
    syncReport,
    analytics,
    alerts,
    latestProducts: [...products]
      .sort((a, b) => String(b.importedAt || b.updatedAt || b.manualDataUpdatedAt || "").localeCompare(String(a.importedAt || a.updatedAt || a.manualDataUpdatedAt || "")))
      .slice(0, 6)
  };
}
