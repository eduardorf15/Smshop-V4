import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { getRobots, getSitemap } from "../controllers/seoController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const router = Router();

router.get("/robots.txt", getRobots);
router.get("/sitemap.xml", getSitemap);
router.get("/admin", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(rootDir, "public", "admin.html"));
});
router.get(["/", "/produtos", "/categoria/:slug", "/favoritos", "/ofertas", "/contato", "/sobre", "/politica", "/termos", "/produto/:id"], (_req, res) => {
  res.sendFile(path.join(rootDir, "public", "index.html"));
});

export default router;
