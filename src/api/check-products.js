import { affiliateLinks } from "../data/affiliate-links.js";
import { productCatalog } from "../data/product-catalog.js";
import { listProducts } from "../../server/services/productService.js";

const products = await listProducts();
const missingLinks = products.filter((product) => !product.affiliateUrl);
const extraLinks = affiliateLinks.length - productCatalog.length;

console.log(`Produtos detectados: ${products.length}`);
console.log(`Produtos oficiais cadastrados: ${productCatalog.length}`);
console.log(`Links afiliados cadastrados: ${affiliateLinks.length}`);
console.log(`Produtos sem link afiliado: ${missingLinks.length}`);
console.log(`Links extras alem da lista oficial de produtos: ${Math.max(0, extraLinks)}`);

if (missingLinks.length) {
  console.log(missingLinks.map((product) => product.sku).join(", "));
}
