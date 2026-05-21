import { Router } from "express";
import { getProducts, getProductSummary } from "../controllers/productController.js";
import { receiveLead, receiveContact } from "../controllers/leadController.js";

const router = Router();

router.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "smshop-v4" });
});

router.get("/api/products", getProducts);
router.get("/api/products/summary", getProductSummary);
router.post("/api/leads", receiveLead);
router.post("/api/contact", receiveContact);

export default router;
