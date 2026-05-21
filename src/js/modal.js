import { affiliateButton } from "./components.js";
import { isFavorite } from "./state.js";
import { money } from "./utils.js";

let products = [];
let activeProduct;
let activeIndex = 0;
let touchStartX = 0;

export function initModal(productList) {
  products = productList;
}

export function openProductModal(id) {
  activeProduct = products.find((product) => product.id === id);
  if (!activeProduct) return;
  activeIndex = 0;
  renderModal();
  const modal = document.querySelector("[data-modal]");
  if (!modal.open) modal.showModal();
  document.body.classList.add("modal-open");
}

export function closeProductModal() {
  const modal = document.querySelector("[data-modal]");
  if (modal.open) modal.close();
  document.body.classList.remove("modal-open");
}

export function renderModal() {
  if (!activeProduct) return;
  const image = activeProduct.images[activeIndex] || activeProduct.heroImage;
  document.querySelector("[data-modal-content]").innerHTML = `
    <div class="gallery-panel">
      <div class="gallery-main" data-zoom-area>
        <button class="gallery-nav gallery-nav--prev" data-gallery-prev aria-label="Foto anterior">‹</button>
        <img src="${image}" alt="${activeProduct.name}" data-zoom-image />
        <button class="gallery-nav gallery-nav--next" data-gallery-next aria-label="Próxima foto">›</button>
      </div>
      <div class="thumb-row">
        ${activeProduct.images
          .map(
            (src, index) => `<button class="${index === activeIndex ? "is-active" : ""}" data-thumb="${index}" aria-label="Imagem ${index + 1}">
              <img src="${src}" alt="" loading="lazy" />
            </button>`
          )
          .join("")}
      </div>
    </div>
    <div class="modal-details">
      <span class="eyebrow">${activeProduct.badge}</span>
      <h2>${activeProduct.name}</h2>
      <p>${activeProduct.description}</p>
      <div class="modal-price">
        <strong>${money(activeProduct.price)}</strong>
        ${activeProduct.onOffer ? "<em>Oferta selecionada</em>" : ""}
      </div>
      <div class="detail-list">
        <span>${activeProduct.rating} ★</span>
        <span>${activeProduct.reviews} avaliações</span>
        <span>${activeProduct.images.length} imagens</span>
      </div>
      <div class="modal-actions">
        ${affiliateButton(activeProduct)}
        <button class="secondary-button ${isFavorite(activeProduct.id) ? "is-active" : ""}" data-favorite-toggle="${activeProduct.id}">♡ Favorito</button>
      </div>
      <small>A compra acontece diretamente na loja anunciada. Os links podem levar para lojas externas.</small>
    </div>
  `;
}

export function handleModalClick(event) {
  if (event.target.closest("[data-gallery-prev]")) {
    previousImage();
    return;
  }

  if (event.target.closest("[data-gallery-next]")) {
    nextImage();
    return;
  }

  const thumb = event.target.closest("[data-thumb]");
  if (thumb) {
    activeIndex = Number(thumb.dataset.thumb);
    renderModal();
    return;
  }

  const zoomArea = event.target.closest("[data-zoom-area]");
  if (zoomArea) zoomArea.classList.toggle("is-zoomed");
}

export function handleModalTouchStart(event) {
  const modal = document.querySelector("[data-modal]");
  if (!modal.open) return;
  touchStartX = event.touches[0]?.clientX || 0;
}

export function handleModalTouchEnd(event) {
  const modal = document.querySelector("[data-modal]");
  if (!modal.open || !touchStartX) return;
  const touchEndX = event.changedTouches[0]?.clientX || 0;
  const delta = touchEndX - touchStartX;
  if (Math.abs(delta) > 45) {
    if (delta < 0) nextImage();
    else previousImage();
  }
  touchStartX = 0;
}

export function handleModalKey(event) {
  const modal = document.querySelector("[data-modal]");
  if (!modal.open || !activeProduct) return;

  if (event.key === "Escape") closeProductModal();
  if (event.key === "ArrowRight") nextImage();
  if (event.key === "ArrowLeft") previousImage();
}

function nextImage() {
  if (!activeProduct?.images.length) return;
  activeIndex = (activeIndex + 1) % activeProduct.images.length;
  renderModal();
}

function previousImage() {
  if (!activeProduct?.images.length) return;
  activeIndex = (activeIndex - 1 + activeProduct.images.length) % activeProduct.images.length;
  renderModal();
}
