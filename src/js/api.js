const productCache = new Map();

export async function fetchProducts(params = {}) {
  const search = new URLSearchParams(params);
  const key = search.toString() || "all";
  if (productCache.has(key)) return productCache.get(key);

  const response = await fetch(`/api/products${search.size ? `?${search}` : ""}`);
  if (!response.ok) throw new Error("Nao foi possivel carregar os produtos.");
  const data = await response.json();
  productCache.set(key, data.products);
  return data.products;
}

export async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Erro ao enviar dados.");
  return data;
}
