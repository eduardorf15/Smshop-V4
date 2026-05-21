export function money(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

export function debounce(callback, wait = 220) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), wait);
  };
}

export function setTitle(title, description) {
  document.title = `${title} | SMShop`;
  const meta = document.querySelector("meta[name='description']");
  if (meta && description) meta.setAttribute("content", description);
}

export function whatsappLink(text = "Ola, quero ajuda com uma oferta da SMShop.") {
  return `https://wa.me/5511969940100?text=${encodeURIComponent(text)}`;
}
