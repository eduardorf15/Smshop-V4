import "dotenv/config";
import path from "path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import apiRoutes from "./routes/apiRoutes.js";
import pageRoutes from "./routes/pageRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(compression());
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  "/src",
  express.static(path.join(rootDir, "src"), {
    maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
    etag: true
  })
);
app.use(
  "/public",
  express.static(path.join(rootDir, "public"), {
    maxAge: process.env.NODE_ENV === "production" ? "30d" : 0,
    immutable: process.env.NODE_ENV === "production"
  })
);
app.use(
  "/imagens",
  express.static(path.join(rootDir, "imagens"), {
    maxAge: process.env.NODE_ENV === "production" ? "30d" : 0,
    immutable: process.env.NODE_ENV === "production"
  })
);
app.use(
  "/referencias",
  express.static(path.join(rootDir, "referencias"), {
    maxAge: "30d",
    immutable: true
  })
);
app.use(
  "/banner",
  express.static(path.join(rootDir, "banner"), {
    maxAge: process.env.NODE_ENV === "production" ? "30d" : 0,
    immutable: process.env.NODE_ENV === "production"
  })
);
app.use("/fotosCategoria", express.static(path.join(process.cwd(), "fotosCategoria")));

app.use(apiRoutes);
app.use(pageRoutes);

app.use((error, req, res, _next) => {
  console.error(error);
  const statusCode = Number(error.statusCode || 500);
  res.status(statusCode).json({
    ok: false,
    message: error.publicMessage || "Erro interno ao processar a solicitação."
  });
});

app.listen(port, () => {
  console.log(`SMShop V4 rodando em http://localhost:${port}`);
});
