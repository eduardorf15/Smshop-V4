import { isFavorite } from "./state.js";
import { money } from "./utils.js";

export function productCard(product, options = {}) {
  const compact = options.compact ? " product-card--compact" : "";
  const noir = options.noir ? " product-card--noir" : "";
  return `
    <article class="product-card${compact}${noir}" data-product-card data-product-id="${product.id}">
      <a class="product-media" href="/produto/${product.id}" aria-label="Abrir detalhes de ${escapeHtml(product.name)}">
        <img src="${product.heroImage}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" />
      </a>
      <div class="product-info">
        <div class="product-meta">
          <span>${product.badge}</span>
          <button class="favorite-button ${isFavorite(product.id) ? "is-active" : ""}" data-favorite-toggle="${product.id}" aria-label="Favoritar ${escapeHtml(product.name)}">♡</button>
        </div>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.description)}</p>
        <div class="price-row">
          <strong>${money(product.price)}</strong>
          ${product.onOffer ? "<em>Oferta</em>" : ""}
        </div>
        <div class="card-actions">
          ${affiliateButton(product, "Comprar")}
          <a class="text-button" href="/produto/${product.id}">Detalhes</a>
        </div>
      </div>
    </article>
  `;
}

export function affiliateButton(product, label = "Comprar oferta") {
  if (!product.affiliateUrl) {
    console.warn(`[SMShop] Produto sem link afiliado: ${product.id || product.name}`);
    return `<button class="primary-button" type="button" disabled aria-disabled="true" title="Link afiliado indisponível">Indisponível</button>`;
  }
  return `<a class="primary-button" href="${product.affiliateUrl}" target="_blank" rel="nofollow sponsored noopener">${label}</a>`;
}

export function sectionHeader(label, title, text, action = "") {
  return `
    <div class="section-header reveal">
      <span class="eyebrow">${label}</span>
      <h2>${title}</h2>
      <p>${text}</p>
      ${action}
    </div>
  `;
}

export function skeletonGrid(count = 6) {
  return `<div class="product-grid">${Array.from({ length: count }).map(() => `<div class="skeleton-card"></div>`).join("")}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
