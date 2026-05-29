import { Router } from "express";
import { getProduct, getProducts, getProductSummary, refreshProductCache } from "../controllers/productController.js";
import { receiveLead, receiveContact } from "../controllers/leadController.js";
import { getAnalyticsSummary, recordProductClick } from "../services/adminAnalyticsService.js";
import { getAdminAlerts } from "../services/adminAlertsService.js";
import { getAdminDashboard } from "../services/adminDashboardService.js";
import {
  createManualProduct,
  deleteAdminProduct,
  forceRefreshMercadoLivreProducts,
  getAdminProducts,
  getSyncReport,
  importMercadoLivreProduct,
  syncAdminProduct,
  updateProductManualData
} from "../services/productService.js";
import {
  exchangeCodeForToken,
  generateAuthorizationUrl,
  getConnectionStatus
} from "../services/mercadoLivreAuthService.js";
import { debugMercadoLivreImport, fetchMercadoLivreItemForTest } from "../services/mercadoLivreService.js";

const router = Router();

router.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "smshop-v4" });
});

router.get("/auth/mercadolivre", (_req, res, next) => {
  try {
    res.redirect(generateAuthorizationUrl());
  } catch (error) {
    next(error);
  }
});

router.get("/auth/mercadolivre/callback", async (req, res, next) => {
  try {
    const code = String(req.query.code || "");
    const token = await exchangeCodeForToken(code);
    res
      .status(200)
      .type("html")
      .send(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <title>Mercado Livre conectado</title>
  </head>
  <body>
    <h1>Mercado Livre conectado com sucesso.</h1>
    <p>Usuário: ${escapeHtml(String(token.userId || "não informado"))}</p>
    <p>Expira em: ${escapeHtml(token.expiresAt)}</p>
  </body>
</html>`);
  } catch (error) {
    next(error);
  }
});

router.get("/api/mercadolivre/status", async (_req, res, next) => {
  try {
    const status = await getConnectionStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

router.get("/api/mercadolivre/item/:meliId", async (req, res, next) => {
  try {
    const result = await fetchMercadoLivreItemForTest(req.params.meliId);
    res.status(result.ok ? 200 : 404).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/api/analytics/click", async (req, res, next) => {
  try {
    const result = await recordProductClick(req.body || {});
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get("/api/admin/dashboard", async (_req, res, next) => {
  try {
    const dashboard = await getAdminDashboard();
    res.json({ ok: true, dashboard });
  } catch (error) {
    next(error);
  }
});

router.get("/api/admin/products", async (_req, res, next) => {
  try {
    const products = await getAdminProducts();
    res.json({ ok: true, count: products.length, products });
  } catch (error) {
    next(error);
  }
});

router.get("/api/admin/debug-mercadolivre", async (req, res, next) => {
  try {
    const result = await debugMercadoLivreImport(req.query.input || "");
    res.json({ ok: true, debug: result });
  } catch (error) {
    next(error);
  }
});

router.post("/api/admin/import-mercadolivre", async (req, res, next) => {
  try {
    const result = await importMercadoLivreProduct(req.body || {});
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/api/admin/products/manual", async (req, res, next) => {
  try {
    const result = await createManualProduct(req.body || {});
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/api/admin/products/refresh", async (_req, res, next) => {
  try {
    const result = await forceRefreshMercadoLivreProducts();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.patch("/api/admin/products/:id/manual-data", async (req, res, next) => {
  try {
    const result = await updateProductManualData(req.params.id, req.body || {});
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/api/admin/products/:id/sync", async (req, res, next) => {
  try {
    const result = await syncAdminProduct(req.params.id);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.delete("/api/admin/products/:id", async (req, res, next) => {
  try {
    const result = await deleteAdminProduct(req.params.id);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get("/api/admin/sync-report", async (_req, res, next) => {
  try {
    const report = await getSyncReport();
    res.json({ ok: true, ...report });
  } catch (error) {
    next(error);
  }
});

router.get("/api/admin/alerts", async (_req, res, next) => {
  try {
    const alerts = await getAdminAlerts();
    res.json({ ok: true, alerts });
  } catch (error) {
    next(error);
  }
});

router.get("/api/admin/analytics", async (_req, res, next) => {
  try {
    const analytics = await getAnalyticsSummary();
    res.json({ ok: true, analytics });
  } catch (error) {
    next(error);
  }
});

router.get("/api/products", getProducts);
router.get("/api/products/summary", getProductSummary);
router.get("/api/products/:id", getProduct);
router.post("/api/products/cache/refresh", refreshProductCache);
router.post("/api/leads", receiveLead);
router.post("/api/contact", receiveContact);

export default router;

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char];
  });
}
