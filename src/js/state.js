const favoriteKey = "smshop:v4:favorites";
const themeKey = "smshop:v4:theme";

export function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(favoriteKey) || "[]");
  } catch {
    return [];
  }
}

export function isFavorite(id) {
  return getFavorites().includes(id);
}

export function toggleFavorite(id) {
  const favorites = new Set(getFavorites());
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  const next = [...favorites];
  localStorage.setItem(favoriteKey, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("favorites:change", { detail: next }));
  return next;
}

export function applyTheme(theme) {
  const safeTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = safeTheme;
  localStorage.setItem(themeKey, safeTheme);
}

export function initTheme() {
  applyTheme("dark");
}

export function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
}
