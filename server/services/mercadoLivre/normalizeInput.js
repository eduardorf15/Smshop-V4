const requestTimeoutMs = Number(process.env.MELI_REQUEST_TIMEOUT_MS || 10000);

export async function normalizeMercadoLivreInput(input) {
  const originalInput = String(input || "").trim();
  const firstPass = extractMercadoLivreIds(originalInput);
  const cleanedInput = cleanMercadoLivreInput(originalInput);
  const normalized = {
    originalInput,
    cleanedInput,
    resolvedUrl: isHttpUrl(cleanedInput) ? cleanedInput : null,
    itemId: firstPass.itemId,
    catalogId: firstPass.catalogId,
    productId: firstPass.catalogId,
    catalogProductId: firstPass.catalogId,
    detectedType: firstPass.detectedType,
    slug: firstPass.slug,
    candidateIds: firstPass.candidateIds,
    warnings: []
  };

  if (shouldResolve(cleanedInput)) {
    const redirect = await resolveMercadoLivreRedirect(cleanedInput);
    normalized.warnings.push(...redirect.warnings);
    if (redirect.resolvedUrl) {
      normalized.resolvedUrl = cleanMercadoLivreInput(extractRedirectTarget(redirect.resolvedUrl) || redirect.resolvedUrl);
      mergeIds(normalized, extractMercadoLivreIds(normalized.resolvedUrl));
    }
  }

  mergeIds(normalized, extractMercadoLivreIds(cleanedInput));
  if (!normalized.itemId && !normalized.catalogId && normalized.resolvedUrl && isHttpUrl(normalized.resolvedUrl)) {
    const htmlIds = await extractIdsFromRemoteHtml(normalized.resolvedUrl);
    normalized.warnings.push(...htmlIds.warnings);
    mergeIds(normalized, htmlIds);
  }
  if (!normalized.slug && normalized.resolvedUrl) normalized.slug = extractSlug(normalized.resolvedUrl);
  finalize(normalized);
  return normalized;
}

async function extractIdsFromRemoteHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 SMShopImporter/2.0" },
      redirect: "follow",
      signal: controller.signal
    });
    const html = await response.text().catch(() => "");
    if (/\/social\//i.test(response.url || url)) {
      return { itemId: null, catalogId: null, candidateIds: [], warnings: response.ok ? [] : [`HTML de resolução HTTP ${response.status}`] };
    }
    const ids = extractExplicitIdsFromHtml(`${response.url || ""}\n${html}`);
    return { ...ids, warnings: response.ok ? [] : [`HTML de resolução HTTP ${response.status}`] };
  } catch (error) {
    return { itemId: null, catalogId: null, candidateIds: [], warnings: [`HTML de resolução falhou: ${error.message}`] };
  } finally {
    clearTimeout(timeout);
  }
}

function extractExplicitIdsFromHtml(html) {
  const text = String(html || "");
  const itemMatches = [
    ...text.matchAll(/(?:item_id|wid|items-core)[:=/\\%]+(MLB-?\d{6,})/gi),
    ...text.matchAll(/produto\.mercadolivre\.com\.br\\?\/(MLB)-?(\d{6,})/gi),
    ...text.matchAll(/\/(MLB)-(\d{6,})/gi)
  ].map((match) => normalizeMeliId(match[2] ? `${match[1]}${match[2]}` : match[1]));
  const catalogMatches = [
    ...text.matchAll(/(?:catalog_product_id|product_id)["'\s:=\\%]+(MLB-?\d{3,})/gi),
    ...text.matchAll(/\/p\/(MLB-?\d{3,})/gi)
  ].map((match) => normalizeMeliId(match[1]));
  const itemId = itemMatches[0] || null;
  const catalogId = catalogMatches[0] || null;
  return {
    itemId,
    catalogId,
    detectedType: itemId ? "item" : catalogId ? "catalog" : "unknown",
    slug: null,
    candidateIds: [...new Set([itemId, catalogId, ...itemMatches, ...catalogMatches].filter(Boolean))]
  };
}

export function extractMercadoLivreId(input) {
  const ids = extractMercadoLivreIds(input);
  return ids.itemId || ids.catalogId || null;
}

export function normalizeMeliId(value) {
  const match = String(value || "").match(/\b(ML[A-Z]{1,2})-?(\d{3,})\b/i);
  return match ? `${match[1]}${match[2]}`.toUpperCase() : null;
}

export function cleanMercadoLivreInput(input) {
  const value = String(input || "").trim();
  if (!isHttpUrl(value)) return value.replace(/\s+/g, "");
  try {
    const url = new URL(value);
    const keepParams = new URLSearchParams();
    ["wid", "item_id"].forEach((key) => {
      const param = url.searchParams.get(key);
      if (param) keepParams.set(key, param);
    });
    url.hash = "";
    url.search = keepParams.toString();
    return url.toString();
  } catch {
    return value.split("#")[0].split("?")[0];
  }
}

export function extractMercadoLivreIds(input) {
  const text = String(input || "").trim();
  const result = {
    itemId: null,
    catalogId: null,
    detectedType: "unknown",
    slug: null,
    candidateIds: []
  };

  let url = null;
  if (isHttpUrl(text)) {
    try {
      url = new URL(text);
      const path = decodeURIComponent(url.pathname || "");
      result.slug = extractSlug(text);
      const queryId = url.searchParams.get("wid") || url.searchParams.get("item_id");
      if (queryId) result.itemId = normalizeMeliId(queryId);
      const catalogPath = path.match(/\/p\/(ML[A-Z]{1,2}-?\d{3,})\b/i);
      if (catalogPath) result.catalogId = normalizeMeliId(catalogPath[1]);
      const itemPath = path.match(/(?:^|\/)(ML[A-Z]{1,2})-?(\d{6,})\b/i);
      if (!result.itemId && itemPath && !catalogPath) result.itemId = normalizeMeliId(`${itemPath[1]}${itemPath[2]}`);
    } catch {
      url = null;
    }
  }

  const catalogText = text.match(/\/p\/(ML[A-Z]{1,2}-?\d{3,})\b/i);
  if (!result.catalogId && catalogText) result.catalogId = normalizeMeliId(catalogText[1]);

  const allIds = [...text.matchAll(/\b(ML[A-Z]{1,2})-?(\d{3,})\b/gi)].map((match) => normalizeMeliId(`${match[1]}${match[2]}`)).filter(Boolean);
  if (!result.itemId && !result.catalogId && allIds[0]) {
    if (detectIdKind(allIds[0]) === "item") result.itemId = allIds[0];
    else result.catalogId = allIds[0];
  }

  result.candidateIds = [...new Set([result.itemId, result.catalogId, ...allIds].filter(Boolean))];
  result.detectedType = result.itemId ? "item" : result.catalogId ? "catalog" : detectUrlType(url);
  return result;
}

export function detectIdKind(id) {
  const digits = String(id || "").replace(/\D/g, "");
  return digits.length >= 10 ? "item" : "catalog";
}

function mergeIds(target, ids) {
  if (!ids) return;
  if (!target.itemId && ids.itemId) target.itemId = ids.itemId;
  if (!target.catalogId && ids.catalogId) target.catalogId = ids.catalogId;
  if (!target.slug && ids.slug) target.slug = ids.slug;
  target.candidateIds = [...new Set([...(target.candidateIds || []), ...(ids.candidateIds || [])].filter(Boolean))];
}

function finalize(target) {
  target.productId = target.catalogId || null;
  target.catalogProductId = target.catalogId || null;
  target.meliId = target.itemId || target.catalogId || null;
  target.meliType = target.itemId ? "item" : target.catalogId ? "catalog_product" : null;
  target.detectedType = target.itemId ? "item" : target.catalogId ? "catalog" : target.detectedType || "unknown";
}

function shouldResolve(value) {
  if (!isHttpUrl(value)) return false;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    return host === "meli.la" || host.endsWith("mercadolivre.com.br") || host.endsWith("mercadolivre.com");
  } catch {
    return false;
  }
}

async function resolveMercadoLivreRedirect(inputUrl) {
  const warnings = [];
  let currentUrl = inputUrl;
  for (let index = 0; index < 6; index += 1) {
    const step = await requestRedirectStep(currentUrl, index === 0 ? "HEAD" : "GET");
    warnings.push(...step.warnings);
    if (!step.nextUrl || step.nextUrl === currentUrl) return { resolvedUrl: currentUrl, warnings };
    currentUrl = step.nextUrl;
  }
  warnings.push("Limite de redirects Mercado Livre atingido.");
  return { resolvedUrl: currentUrl, warnings };
}

async function requestRedirectStep(url, method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 SMShopImporter/2.0" },
      signal: controller.signal
    });
    const location = response.headers.get("location");
    if (location) return { nextUrl: new URL(location, url).toString(), warnings: [] };
    if (method === "HEAD" && response.status >= 400) return requestRedirectStep(url, "GET");
    return { nextUrl: response.url || url, warnings: response.ok ? [] : [`Redirect ${method} HTTP ${response.status}`] };
  } catch (error) {
    return { nextUrl: url, warnings: [`Redirect ${method} falhou: ${error.message}`] };
  } finally {
    clearTimeout(timeout);
  }
}

function extractRedirectTarget(value) {
  try {
    const url = new URL(value);
    const target = url.searchParams.get("go") || url.searchParams.get("url") || url.searchParams.get("u");
    return target && isHttpUrl(decodeURIComponent(target)) ? decodeURIComponent(target) : null;
  } catch {
    return null;
  }
}

function extractSlug(value) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname || "")
      .split("/")
      .filter(Boolean)
      .find((part) => !/^p$/i.test(part) && !/^ML[A-Z]{1,2}-?\d+/i.test(part) && !/^JM$/i.test(part)) || null;
  } catch {
    return null;
  }
}

function detectUrlType(url) {
  if (!url) return "unknown";
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host === "meli.la") return "short";
  if (host.startsWith("m.")) return "mobile";
  if (path.includes("/p/")) return "catalog";
  if (/\/ml[a-z]{1,2}-?\d+/.test(path)) return "item";
  return "url";
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}
