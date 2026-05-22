import { affiliateButton, productCard, sectionHeader, skeletonGrid } from "./components.js";
import { getFavorites } from "./state.js";
import { setTitle, whatsappLink } from "./utils.js";

export async function renderHome(app, products) {
  setTitle("Home", "Curadoria de tecnologia, acessórios e achados para o dia a dia.");
  const categories = buildHomeCategories();
  const homeProducts = products.slice(0, 9);
  app.innerHTML = `
    <section class="hero reveal">
      <div class="hero-content">
        <span class="hero-label">CURADORIA PREMIUM</span>
        <h1>Os produtos que você<br />realmente vai querer usar.</h1>
        <p>Tecnologia, acessórios e gadgets escolhidos para deixar sua rotina mais prática, bonita e interessante.</p>
        <div class="hero-actions">
          <a class="primary-button primary-button--light" href="/produtos">Explorar produtos</a>
          <a class="secondary-button secondary-button--light" href="/ofertas">Ver ofertas</a>
        </div>
        <div class="hero-trust">
          <span>✓ Compra segura</span>
          <span>✓ Curadoria premium</span>
          <span>✓ Suporte dedicado</span>
        </div>
      </div>
    </section>

    <section class="rail-section home-products-section">
      ${sectionHeader("Produtos", "Achados selecionados para começar.", "Veja opções úteis, bonitas e fáceis de escolher logo na primeira visita.", `<a class="text-link" href="/produtos">Ver tudo</a>`)}
      <div class="home-product-grid">${homeProducts.map((product) => productCard(product, { compact: true })).join("")}</div>
      <div class="home-products-action">
        <a class="primary-button" href="/produtos">Ver todos os produtos</a>
      </div>
    </section>

    <section class="rail-section">
      ${sectionHeader("Destaques", "Achados que valem o clique.", "Produtos escolhidos pra facilitar sua rotina e valer o seu dinheiro.", `<a class="text-link" href="/produtos">Ver tudo</a>`)}
      <div class="home-rail product-rail product-rail--noir">${products.slice(0, 5).map((product) => productCard(product, { noir: true })).join("")}</div>
    </section>

    <section class="rail-section category-showcase-section">
      <div class="category-showcase-header reveal">
        <span class="eyebrow">Categorias</span>
      </div>
      <div class="category-showcase-grid category-rail">
        ${categories
          .map(
            (category) => `<a class="category-banner reveal" href="/produtos?category=${category.slug}" aria-label="Ver produtos de ${category.name}">
              <img class="category-image" src="${category.image}" alt="${category.name}" width="1032" height="1524" loading="eager" decoding="async" />
              <span class="category-pill">${category.name}</span>
            </a>`
          )
          .join("")}
      </div>
    </section>

    <section class="section split-section compact-how">
      <div class="brand-panel reveal">
        <span class="eyebrow">Como comprar</span>
        <h2>Do clique até a escolha.</h2>
      </div>
      <div class="process-grid">
        <article class="process-card reveal"><span>01</span><strong>Explore sem pressa</strong><p>Navegue pelos produtos e descubra o que realmente faz sentido pra você.</p></article>
        <article class="process-card reveal"><span>02</span><strong>Veja os detalhes</strong><p>Fotos, preço, avaliações e informações organizadas de forma simples.</p></article>
        <article class="process-card reveal"><span>03</span><strong>Salve os favoritos</strong><p>Compare opções e volte depois nos produtos que chamaram atenção.</p></article>
        <article class="process-card reveal"><span>04</span><strong>Escolha onde comprar</strong><p>A SMShop reúne os produtos. A compra acontece diretamente na loja anunciada.</p></article>
      </div>
    </section>

    <section class="cta-section reveal">
      <div>
        <span class="eyebrow">Ofertas e suporte</span>
        <h2>Receba os melhores achados da semana.</h2>
      </div>
      <div class="cta-actions">
        <a class="primary-button" href="${whatsappLink("Ola, quero entrar no grupo de ofertas da SMShop.")}" target="_blank" rel="noopener">Entrar no grupo</a>
        <button class="secondary-button" data-open-lead>Receber novidades</button>
      </div>
    </section>
  `;
}

export async function renderProducts(app, products, title = "Produtos") {
  const pageDescription =
    title === "Ofertas do dia"
      ? "Ofertas escolhidas pra quem gosta de comprar bem sem perder tempo procurando."
      : "Explore produtos organizados pra comparar preços, encontrar opções boas e decidir mais rápido.";
  const pageTitle = title === "Ofertas do dia" ? "Ofertas que valem a pena." : title;
  setTitle(pageTitle, "Produtos úteis, diferentes e bem escolhidos pela SMShop.");
  app.innerHTML = `
    <section class="page-hero reveal">
      <span class="eyebrow">Catálogo premium</span>
      <h1>${pageTitle}</h1>
      <p>${pageDescription}</p>
    </section>
    <section class="catalog-layout">
      <aside class="filters reveal">
        <button class="filter-close" data-filter-close aria-label="Fechar filtros">×</button>
        <span class="filters-title">Refinar</span>
        <div class="filter-accordion is-open">
          <button type="button" class="filter-accordion-title">Ordenar por</button>
          <div class="filter-accordion-body">
            <div class="custom-select" data-custom-select>
              <button type="button" data-sort-trigger data-sort-value="">Destaques</button>
              <div class="sort-menu" data-sort-menu>
                <button type="button" data-sort-option value="">Destaques</button>
                <button type="button" data-sort-option value="price-asc">Menor preço</button>
                <button type="button" data-sort-option value="price-desc">Maior preço</button>
                <button type="button" data-sort-option value="discount">Ofertas primeiro</button>
                <button type="button" data-sort-option value="rating">Melhor avaliação</button>
              </div>
            </div>
          </div>
        </div>
        <div class="filter-accordion is-open">
          <button type="button" class="filter-accordion-title">Buscar</button>
          <div class="filter-accordion-body">
            <label><input type="search" data-catalog-search placeholder="Fone, smart, casa..." /></label>
          </div>
        </div>
        <div class="filter-accordion"><button type="button" class="filter-accordion-title">Gênero</button><div class="filter-accordion-body"><a href="/produtos">Todos</a></div></div>
        <div class="filter-accordion"><button type="button" class="filter-accordion-title">Tipo de Produto</button><div class="filter-accordion-body"><a href="/produtos?category=audio">Fones</a><a href="/produtos?category=smartwatch">Smartwatch</a><a href="/produtos?category=energia">Carregadores</a><a href="/produtos?category=creator">Setup</a></div></div>
        <div class="filter-accordion"><button type="button" class="filter-accordion-title">Tamanho</button><div class="filter-accordion-body"><span>Compacto</span><span>Portátil</span><span>Setup</span></div></div>
        <div class="filter-accordion"><button type="button" class="filter-accordion-title">Preço</button><div class="filter-accordion-body"><button type="button" data-sort-option value="price-asc">Menor preço</button><button type="button" data-sort-option value="price-desc">Maior preço</button></div></div>
        <div class="filter-accordion"><button type="button" class="filter-accordion-title">Marca</button><div class="filter-accordion-body"><span>QCY</span><span>JBL</span><span>Basike</span><span>Amazfit</span></div></div>
        <div class="filter-accordion"><button type="button" class="filter-accordion-title">Cor</button><div class="filter-accordion-body"><span>Preto</span><span>Branco</span><span>Grafite</span></div></div>
        <div class="filter-accordion"><button type="button" class="filter-accordion-title">Ofertas</button><div class="filter-accordion-body"><a href="/ofertas">Ofertas do dia</a><a href="/favoritos">Meus favoritos</a></div></div>
      </aside>
      <div>
        <div class="catalog-bar">
          <span data-result-count>${products.length} produtos</span>
          <button class="filter-trigger" data-filter-open aria-label="Abrir filtros"><span aria-hidden="true">≛</span></button>
        </div>
        <div class="product-grid" data-catalog-grid>${products.map((product) => productCard(product)).join("")}</div>
      </div>
    </section>
  `;
}

export function renderProductDetail(app, products, id) {
  const product = products.find((item) => item.id === id);
  if (!product) {
    app.innerHTML = emptyState("Produto não encontrado", "Volte para o catálogo e escolha outro item da curadoria.");
    return;
  }

  setTitle(product.name, product.description);
  const related = getRelatedProducts(products, product);
  app.innerHTML = `
    <section class="product-page">
      <div class="product-showcase reveal">
        <div class="product-showcase-media" data-page-gallery data-gallery-product="${product.id}">
          <button class="page-gallery-nav page-gallery-prev" data-page-gallery-prev aria-label="Imagem anterior">‹</button>
          <img src="${product.heroImage}" alt="${product.name}" data-page-gallery-image data-current-index="0" />
          <button class="page-gallery-nav page-gallery-next" data-page-gallery-next aria-label="Próxima imagem">›</button>
        </div>
        <aside class="product-buybox">
          <span class="eyebrow">${product.badge}</span>
          <h1>${product.name}</h1>
          <p>${product.description}</p>
          <strong class="product-page-price">${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.price)}</strong>
          <div class="product-page-actions">
            ${affiliateButton(product, "Comprar agora")}
            <button class="secondary-button" data-favorite-toggle="${product.id}">♡ Favorito</button>
          </div>
          <small>A compra acontece diretamente na loja anunciada.</small>
        </aside>
      </div>

      <div class="product-gallery-strip reveal">
        ${product.images
          .slice(0, 8)
          .map((src, index) => `<button class="${index === 0 ? "is-active" : ""}" data-page-thumb="${index}" aria-label="Ver imagem ${index + 1}"><img src="${src}" alt="${product.name}" loading="lazy" /></button>`)
          .join("")}
      </div>

      <section class="product-story reveal">
        <span class="eyebrow">Detalhes</span>
        <h2>Escolhido pra quem usa de verdade.</h2>
        <p>Um produto pensado pra rotina real: útil, bonito e fácil de encaixar no dia a dia.</p>
      </section>

      <section class="rail-section related-section">
        ${sectionHeader("Produtos parecidos", "Você também pode gostar.", "Outras escolhas parecidas pra continuar explorando.")}
        <div class="home-rail product-rail product-rail--noir">${related.map((item) => productCard(item, { noir: true })).join("")}</div>
      </section>
    </section>
  `;
}

export async function renderOffers(app, products) {
  await renderProducts(app, products.filter((product) => product.onOffer), "Ofertas do dia");
}

export async function renderFavorites(app, products) {
  const favoriteIds = getFavorites();
  const favorites = products.filter((product) => favoriteIds.includes(product.id));
  setTitle("Favoritos", "Produtos salvos na sua seleção.");
  app.innerHTML = `
    <section class="page-hero reveal">
      <span class="eyebrow">Favoritos</span>
      <h1>Os achados que chamaram sua atenção.</h1>
      <p>Salve produtos interessantes e volte quando quiser comparar com calma.</p>
    </section>
    ${favorites.length ? `<div class="product-grid">${favorites.map((product) => productCard(product)).join("")}</div>` : emptyState("Nenhum favorito ainda", "Toque no coração dos produtos para montar sua lista.")}
  `;
}

export function renderContact(app) {
  setTitle("Contato", "Fala com a gente por WhatsApp ou email.");
  app.innerHTML = `
    <section class="page-hero reveal">
      <span class="eyebrow">Contato</span>
      <h1>Fala com a gente.</h1>
      <p>Dúvidas, sugestões ou produtos interessantes pra indicar? A SMShop responde direto.</p>
    </section>
    <section class="contact-grid">
      <div class="brand-panel reveal">
        <h2>Contato</h2>
        <p>WhatsApp: <a href="${whatsappLink()}" target="_blank" rel="noopener">5511969940100</a></p>
        <p>Email: <a href="mailto:contatossmshop@gmail.com">contatossmshop@gmail.com</a></p>
        <a class="primary-button" href="${whatsappLink("Ola, preciso de suporte da SMShop.")}" target="_blank" rel="noopener">Chamar no WhatsApp</a>
      </div>
      <form class="contact-form reveal" data-contact-form>
        <label>Nome<input name="name" required placeholder="Seu nome" /></label>
        <label>Email<input name="email" type="email" required placeholder="seuemail@exemplo.com" /></label>
        <label>Mensagem<textarea name="message" required placeholder="Como podemos ajudar?"></textarea></label>
        <button class="primary-button" type="submit">Enviar mensagem</button>
        <small data-contact-message></small>
      </form>
    </section>
  `;
}

export function renderAbout(app) {
  setTitle("Sobre", "Conheça a marca premium SMShop.");
  app.innerHTML = `
    <section class="page-hero reveal">
      <span class="eyebrow">Sobre</span>
      <h1>A SMShop nasceu da vontade de encontrar produtos melhores.</h1>
      <p>A SMShop nasceu pra reunir produtos que realmente valem a pena em um só lugar.</p>
    </section>
    <section class="about-values reveal">
      <article class="about-value-card">
        <span aria-hidden="true">◇</span>
        <h2>Missão</h2>
        <p>Encontrar produtos úteis, interessantes e com bom visual para o dia a dia.</p>
      </article>
      <article class="about-value-card">
        <span aria-hidden="true">○</span>
        <h2>Visão</h2>
        <p>Transformar a descoberta de produtos em algo mais simples, leve e inspirador.</p>
      </article>
      <article class="about-value-card">
        <span aria-hidden="true">✦</span>
        <h2>Valores</h2>
        <p>Curadoria, clareza, praticidade e experiência visual.</p>
      </article>
    </section>
  `;
}

export function renderPolicy(app) {
  setTitle("Política de Privacidade", "Política de privacidade da SMShop.");
  app.innerHTML = contentPage("Política de Privacidade", "A SMShop coleta apenas dados necessários para atendimento, captura de leads e melhoria da navegação. Emails enviados em formulários podem ser usados para comunicação sobre achados e novidades, sempre com possibilidade de descadastro. Links externos seguem as políticas das lojas anunciadas.");
}

export function renderTerms(app) {
  setTitle("Termos", "Termos de uso da SMShop.");
  app.innerHTML = contentPage("Termos de Uso", "A SMShop atua como vitrine independente de produtos. Preços, disponibilidade, frete e condições finais são definidos pela loja anunciada no momento da compra. Os links podem levar para lojas externas.");
}

export function renderLoading(app) {
  app.innerHTML = `<section class="page-hero">${skeletonGrid(3)}</section>`;
}

function buildHomeCategories() {
  return [
    { name: "Tecnologia", slug: "tecnologia", image: "/fotosCategoria/tecnologia.png" },
    { name: "Beleza e estética", slug: "beleza-estetica", image: "/fotosCategoria/beleza.png" },
    { name: "Fitness e saúde", slug: "fitness", image: "/fotosCategoria/fitness.png" },
    { name: "Moda", slug: "moda", image: "/fotosCategoria/moda.png" },
    { name: "Casa", slug: "casa", image: "/fotosCategoria/casa.png" },
    { name: "Pets", slug: "pets", image: "/fotosCategoria/pets.png" },
    { name: "Infantil", slug: "infantil", image: "/fotosCategoria/infantil.png" }
  ];
}

function getRelatedProducts(products, product) {
  return products
    .filter((item) => item.id !== product.id)
    .map((item) => ({
      item,
      score:
        (item.productType && item.productType === product.productType ? 100 : item.category === product.category ? 40 : 0) +
        item.tags.filter((tag) => product.tags.includes(tag)).length * 24 -
        Math.abs(item.price - product.price) / 10
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ item }) => item);
}

function emptyState(title, text) {
  return `<div class="empty-state reveal"><h2>${title}</h2><p>${text}</p><a class="primary-button" href="/produtos">Explorar produtos</a></div>`;
}

function contentPage(title, text) {
  return `
    <section class="page-hero reveal">
      <span class="eyebrow">SMShop</span>
      <h1>${title}</h1>
      <p>${text}</p>
    </section>
    <section class="brand-panel prose reveal">
      <p>${text}</p>
      <p>Contato oficial: <a href="mailto:contatossmshop@gmail.com">contatossmshop@gmail.com</a>.</p>
    </section>
  `;
}
