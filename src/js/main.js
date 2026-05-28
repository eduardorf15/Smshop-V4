import { fetchProducts, postJson } from "./api.js";
import { productCard } from "./components.js";
import { closeProductModal, handleModalClick, handleModalKey, handleModalTouchEnd, handleModalTouchStart, initModal, openProductModal, renderModal } from "./modal.js";
import { renderAbout, renderContact, renderFavorites, renderHome, renderLoading, renderOffers, renderPolicy, renderProductDetail, renderProducts, renderTerms } from "./pages.js";
import { applyTheme, getFavorites, initTheme, toggleFavorite, toggleTheme } from "./state.js";
import { debounce, whatsappLink } from "./utils.js";
import { getOfficialCategoryBySlug, slugifyCategory } from "../data/categories.js";

const app = document.querySelector("#app");
let products = [];
let pageGalleryTouchStartX = 0;

initTheme();
boot();

async function boot() {
  bindShellEvents();
  renderLoading(app);
  try {
    products = (await fetchProducts()).map(normalizeProductCategory);
    initModal(products);
    await route();
    updateFavoriteCount();
    initReveal();
    preloadHeroImages();
  } catch (error) {
    app.innerHTML = `<section class="empty-state"><h1>Não foi possível carregar a SMShop.</h1><p>${error.message}</p></section>`;
  } finally {
    document.querySelector("[data-splash]")?.classList.add("is-hidden");
  }
}

async function route() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category");
  const routeCategorySlug = path.startsWith("/categoria/") ? decodeURIComponent(path.split("/").pop()) : "";
  const routeCategory = getOfficialCategoryBySlug(routeCategorySlug);
  const tag = params.get("tag");
  let visibleProducts = [...products];

  if (category) visibleProducts = visibleProducts.filter((product) => matchesCategory(product, category));
  if (routeCategorySlug) visibleProducts = visibleProducts.filter((product) => matchesCategory(product, routeCategorySlug));
  if (tag) visibleProducts = visibleProducts.filter((product) => product.tags.join(" ").toLowerCase().includes(tag.toLowerCase()));

  if (path.startsWith("/produto/")) renderProductDetail(app, products, decodeURIComponent(path.split("/").pop()));
  else if (path === "/produtos" || routeCategory) await renderProducts(app, visibleProducts, routeCategory?.name || "Produtos");
  else if (path === "/ofertas") await renderOffers(app, products);
  else if (path === "/favoritos") await renderFavorites(app, products);
  else if (path === "/contato") renderContact(app);
  else if (path === "/sobre") renderAbout(app);
  else if (path === "/politica") renderPolicy(app);
  else if (path === "/termos") renderTerms(app);
  else await renderHome(app, products);

  bindPageEvents();
  initReveal();
  app.focus({ preventScroll: true });
}

function bindShellEvents() {
  document.body.addEventListener("click", handleFavoriteClick, true);
  document.body.addEventListener("click", async (event) => {
    const link = event.target.closest("a[href^='/']");
    if (link && !event.metaKey && !event.ctrlKey && link.target !== "_blank") {
      event.preventDefault();
      history.pushState({}, "", link.getAttribute("href"));
      await route();
      closeMobileMenu();
      closeFilters();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const openButton = event.target.closest("[data-open-product]");
    if (openButton) openProductModal(openButton.dataset.openProduct);

    const pageThumb = event.target.closest("[data-page-thumb]");
    if (pageThumb) setPageGalleryImage(Number(pageThumb.dataset.pageThumb));

    if (event.target.closest("[data-page-gallery-prev]")) changePageGalleryImage(-1);
    if (event.target.closest("[data-page-gallery-next]")) changePageGalleryImage(1);

    if (event.target.closest("[data-page-gallery-image]")) {
      event.target.closest("[data-page-gallery]")?.classList.toggle("is-zoomed");
    }

    if (event.target.closest("[data-open-lead]")) openLeadPopup();

    const affiliateClick = event.target.closest("[data-affiliate-click]");
    if (affiliateClick) recordAffiliateClick(affiliateClick);
  });

  window.addEventListener("popstate", route);
  window.addEventListener("favorites:change", updateFavoriteCount);
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", toggleTheme);
  document.querySelector("[data-menu-toggle]")?.addEventListener("click", toggleMobileMenu);
  document.querySelector("[data-category-toggle]")?.addEventListener("click", toggleCategoryMenu);
  document.querySelector("[data-ui-scrim]")?.addEventListener("click", () => {
    closeMobileMenu();
    closeFilters();
  });
  document.querySelector("[data-modal-close]")?.addEventListener("click", closeProductModal);
  const modal = document.querySelector("[data-modal]");
  modal?.addEventListener("click", (event) => {
    if (event.target.matches("[data-modal]")) closeProductModal();
    handleModalClick(event);
  });
  modal?.addEventListener("touchstart", handleModalTouchStart, { passive: true });
  modal?.addEventListener("touchend", handleModalTouchEnd, { passive: true });
  document.addEventListener("keydown", handleModalKey);
  document.querySelector("[data-whatsapp]")?.addEventListener("click", () => window.open(whatsappLink(), "_blank", "noopener"));
  bindSearch();
  bindLeadPopup();
}

function recordAffiliateClick(link) {
  const payload = JSON.stringify({
    productId: link.dataset.affiliateClick,
    productName: link.dataset.productName || ""
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/analytics/click", new Blob([payload], { type: "application/json" }));
    return;
  }

  fetch("/api/analytics/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

async function handleFavoriteClick(event) {
  const favoriteButton = event.target.closest("[data-favorite-toggle]");
  if (!favoriteButton) return;
  event.preventDefault();
  event.stopPropagation();
  toggleFavorite(favoriteButton.dataset.favoriteToggle);
  syncFavoriteButtons();
  renderModal();
  if (window.location.pathname === "/favoritos") await renderFavorites(app, products);
}

function bindPageEvents() {
  const search = document.querySelector("[data-catalog-search]");
  const sortTrigger = document.querySelector("[data-sort-trigger]");
  if (search || sortTrigger) {
    const update = debounce(() => {
      const term = (search?.value || "").toLowerCase();
      let list = products.filter((product) => `${product.name} ${product.category} ${product.productType || ""} ${product.tags.join(" ")}`.toLowerCase().includes(term));
      const params = new URLSearchParams(window.location.search);
      const category = params.get("category");
      const tag = params.get("tag");
      if (category) list = list.filter((product) => matchesCategory(product, category));
      if (tag) list = list.filter((product) => product.tags.join(" ").toLowerCase().includes(tag.toLowerCase()));
      list = sortProducts(list, sortTrigger?.dataset.sortValue || "");
      document.querySelector("[data-catalog-grid]").innerHTML = list.map((product) => productCard(product)).join("");
      document.querySelector("[data-result-count]").textContent = `${list.length} produtos`;
      syncFavoriteButtons();
    }, 180);
    search?.addEventListener("input", update);
    sortTrigger?.addEventListener("click", () => document.querySelector("[data-sort-menu]")?.classList.toggle("is-open"));
    document.querySelectorAll("[data-sort-option]").forEach((option) => {
      option.addEventListener("click", () => {
        sortTrigger.dataset.sortValue = option.value;
        sortTrigger.textContent = option.textContent;
        document.querySelector("[data-sort-menu]")?.classList.remove("is-open");
        update();
      });
    });
    document.querySelectorAll(".filter-accordion-title").forEach((button) => {
      button.addEventListener("click", () => {
        button.closest(".filter-accordion")?.classList.toggle("is-open");
      });
    });
  }

  const contactForm = document.querySelector("[data-contact-form]");
  contactForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = contactForm.querySelector("[data-contact-message]");
    try {
      const payload = Object.fromEntries(new FormData(contactForm));
      const data = await postJson("/api/contact", payload);
      message.textContent = data.message;
      contactForm.reset();
    } catch (error) {
      message.textContent = error.message;
    }
  });

  document.querySelector("[data-filter-open]")?.addEventListener("click", openFilters);
  document.querySelector("[data-filter-close]")?.addEventListener("click", closeFilters);
  const pageGallery = document.querySelector("[data-page-gallery]");
  pageGallery?.addEventListener("touchstart", (event) => {
    pageGalleryTouchStartX = event.touches[0]?.clientX || 0;
  }, { passive: true });
  pageGallery?.addEventListener("touchend", (event) => {
    const endX = event.changedTouches[0]?.clientX || 0;
    const delta = endX - pageGalleryTouchStartX;
    if (Math.abs(delta) > 45) changePageGalleryImage(delta < 0 ? 1 : -1);
    pageGalleryTouchStartX = 0;
  }, { passive: true });
}

function bindSearch() {
  const overlay = document.querySelector("[data-search-overlay]");
  const input = document.querySelector("[data-global-search]");
  const results = document.querySelector("[data-search-results]");
  document.querySelector("[data-search-open]")?.addEventListener("click", () => {
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    input.focus();
  });
  document.querySelector("[data-search-close]")?.addEventListener("click", () => closeSearch());
  input?.addEventListener(
    "input",
    debounce(() => {
      const term = input.value.toLowerCase();
      const matches = products.filter((product) => `${product.name} ${product.category} ${product.productType || ""} ${product.tags.join(" ")}`.toLowerCase().includes(term)).slice(0, 6);
      results.innerHTML = matches.map((product) => productCard(product, { compact: true })).join("");
    }, 180)
  );
}

function bindLeadPopup() {
  const popup = document.querySelector("[data-lead-popup]");
  const form = document.querySelector("[data-lead-form]");
  document.querySelector("[data-lead-close]")?.addEventListener("click", () => popup.close());
  setTimeout(() => {
    if (!sessionStorage.getItem("smshop:v4:lead-shown") && !popup.open) {
      popup.showModal();
      sessionStorage.setItem("smshop:v4:lead-shown", "true");
    }
  }, 6000);
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("[data-lead-message]");
    try {
      const data = await postJson("/api/leads", Object.fromEntries(new FormData(form)));
      message.textContent = data.message;
      form.reset();
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

function openLeadPopup() {
  const popup = document.querySelector("[data-lead-popup]");
  if (!popup.open) popup.showModal();
}

function closeSearch() {
  const overlay = document.querySelector("[data-search-overlay]");
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
}

function sortProducts(list, sort) {
  const sorted = [...list];
  if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
  if (sort === "discount") sorted.sort((a, b) => Number(b.onOffer) - Number(a.onOffer));
  if (sort === "rating") sorted.sort((a, b) => b.rating - a.rating);
  return sorted;
}

function matchesCategory(product, categorySlug) {
  return product.categorySlug === categorySlug || product.productTypeSlug === categorySlug || product.tags.includes(categorySlug);
}

function normalizeProductCategory(product) {
  const legacyTypes = new Set(["audio", "energia", "smartwatch", "creator"]);
  const incomingCategorySlug = product.categorySlug || slugify(product.category || "");
  const isLegacyCategory = legacyTypes.has(incomingCategorySlug);
  const category = isLegacyCategory ? "Tecnologia" : product.category || "Tecnologia";
  const categorySlug = isLegacyCategory || !product.categorySlug ? "tecnologia" : product.categorySlug;
  const productType = product.productType || (isLegacyCategory ? product.category : "");
  const productTypeSlug = product.productTypeSlug || (productType ? slugifyCategory(productType) : "");
  const tags = new Set([categorySlug, productTypeSlug, ...(product.tags || [])].filter(Boolean));

  return {
    ...product,
    category,
    categorySlug,
    productType,
    productTypeSlug,
    tags: [...tags]
  };
}

function setPageGalleryImage(index) {
  const gallery = document.querySelector("[data-page-gallery]");
  const image = document.querySelector("[data-page-gallery-image]");
  const product = products.find((item) => item.id === gallery?.dataset.galleryProduct);
  if (!gallery || !image || !product?.images.length) return;
  const safeIndex = (index + product.images.length) % product.images.length;
  image.src = product.images[safeIndex];
  image.dataset.currentIndex = String(safeIndex);
  gallery.classList.remove("is-zoomed");
  document.querySelectorAll("[data-page-thumb]").forEach((thumb) => {
    thumb.classList.toggle("is-active", Number(thumb.dataset.pageThumb) === safeIndex);
  });
}

function changePageGalleryImage(direction) {
  const image = document.querySelector("[data-page-gallery-image]");
  if (!image) return;
  setPageGalleryImage(Number(image.dataset.currentIndex || 0) + direction);
}

function updateFavoriteCount() {
  document.querySelector("[data-favorite-count]").textContent = getFavorites().length;
}

function syncFavoriteButtons() {
  const favorites = new Set(getFavorites());
  document.querySelectorAll("[data-favorite-toggle]").forEach((button) => {
    button.classList.toggle("is-active", favorites.has(button.dataset.favoriteToggle));
  });
}

function toggleMobileMenu() {
  const drawer = document.querySelector("[data-mobile-drawer]");
  const isOpen = drawer.classList.toggle("is-open");
  drawer.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("drawer-open", isOpen);
  document.querySelector("[data-ui-scrim]")?.classList.toggle("is-open", isOpen);
}

function closeMobileMenu() {
  const drawer = document.querySelector("[data-mobile-drawer]");
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
  if (!document.body.classList.contains("filters-open")) {
    document.querySelector("[data-ui-scrim]")?.classList.remove("is-open");
  }
}

function openFilters() {
  document.body.classList.add("filters-open");
  document.querySelector("[data-ui-scrim]")?.classList.add("is-open");
}

function closeFilters() {
  document.body.classList.remove("filters-open");
  if (!document.body.classList.contains("drawer-open")) {
    document.querySelector("[data-ui-scrim]")?.classList.remove("is-open");
  }
}

function toggleCategoryMenu(event) {
  event.stopPropagation();
  const button = document.querySelector("[data-category-toggle]");
  const menu = document.querySelector("[data-category-menu]");
  const isOpen = menu.classList.toggle("is-open");
  button.setAttribute("aria-expanded", String(isOpen));
}

document.addEventListener("click", (event) => {
  if (event.target.closest(".nav-dropdown")) return;
  const button = document.querySelector("[data-category-toggle]");
  const menu = document.querySelector("[data-category-menu]");
  menu?.classList.remove("is-open");
  button?.setAttribute("aria-expanded", "false");
});

function initReveal() {
  const elements = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add("is-visible");
      });
    },
    { threshold: 0.12 }
  );
  elements.forEach((element) => observer.observe(element));
}

function preloadHeroImages() {
  products.slice(0, 4).forEach((product) => {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = product.heroImage;
    document.head.appendChild(link);
  });
}
