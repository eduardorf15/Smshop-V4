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
router.get(["/", "/produtos", "/categoria/tecnologia", "/favoritos", "/ofertas", "/contato", "/sobre", "/politica", "/termos", "/produto/:id"], (_req, res) => {
  res.sendFile(path.join(rootDir, "public", "index.html"));
});

export default router;
