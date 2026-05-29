const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const openAiUrl = "https://api.openai.com/v1/responses";

export async function generateProductDescription(payload = {}) {
  return runAiTask("generate-description", payload, {
    shortDescription: "string",
    fullDescription: "string",
    benefits: ["string"]
  });
}

export async function generateSalesCopy(payload = {}) {
  return runAiTask("generate-sales-copy", payload, {
    whatsappCaption: "string",
    instagramCaption: "string",
    shortCta: "string",
    friendlyOfferText: "string"
  });
}

export async function suggestProductTags(payload = {}) {
  return runAiTask("suggest-tags", payload, {
    searchTags: ["string"],
    categoryTags: ["string"],
    commercialTags: ["string"]
  });
}

export async function reviewProductWithAi(payload = {}) {
  return runAiTask("review-product", payload, {
    score: "number 0-10",
    problems: ["string"],
    suggestions: ["string"],
    missingFields: ["string"]
  });
}

async function runAiTask(task, payload, expectedShape) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw createPublicError("OPENAI_API_KEY não configurada. Configure a variável no .env da VPS para usar o Assistente IA.", 503);
  }

  const body = {
    model: defaultModel,
    input: [
      {
        role: "system",
        content: buildSystemPrompt()
      },
      {
        role: "user",
        content: JSON.stringify({
          task,
          expectedShape,
          product: sanitizeProductPayload(payload)
        })
      }
    ],
    temperature: 0.35,
    max_output_tokens: 1200
  };

  let response;
  try {
    response = await fetch(openAiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw createPublicError(`Não foi possível conectar à OpenAI: ${error.message}`, 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createPublicError(data.error?.message || "OpenAI não concluiu a solicitação.", response.status || 502);
  }

  const text = extractResponseText(data);
  const parsed = parseJsonObject(text);
  if (!parsed) {
    throw createPublicError("A IA respondeu em formato inesperado. Tente novamente.", 502);
  }

  return normalizeAiResult(task, parsed);
}

function buildSystemPrompt() {
  return [
    "Você é o assistente de catálogo da SMShop, uma loja afiliada brasileira.",
    "Responda sempre em JSON puro, sem markdown.",
    "Escreva em português do Brasil, com tom claro, vendedor, responsável e confiável.",
    "Não prometa cura, resultado médico, certificação, garantia, frete, desconto ou prazo que não esteja nos dados.",
    "Para produtos de idosos, mobilidade, saúde ou cuidados pessoais, use tom cuidadoso e evite alegações médicas perigosas.",
    "Se faltar informação, seja honesto e sugira melhoria sem inventar dados.",
    "Mantenha textos prontos para edição humana antes de publicar."
  ].join("\n");
}

function sanitizeProductPayload(payload = {}) {
  const product = payload.product && typeof payload.product === "object" ? payload.product : payload;
  return {
    id: stringOrNull(product.id),
    name: stringOrNull(product.name || product.title),
    category: stringOrNull(product.category),
    price: numberOrNull(product.price),
    currentDescription: stringOrNull(product.description || product.currentDescription),
    tags: normalizeStringList(product.tags),
    images: normalizeStringList(product.images).slice(0, 8),
    heroImage: stringOrNull(product.heroImage),
    mercadoLivre: {
      meliId: stringOrNull(product.meliId),
      meliType: stringOrNull(product.meliType),
      status: stringOrNull(product.meliStatus || product.status),
      permalink: stringOrNull(product.mercadoLivrePermalink),
      syncMethod: stringOrNull(product.syncMethod),
      syncWarnings: normalizeStringList(product.syncWarnings)
    },
    affiliateUrlPresent: Boolean(product.affiliateUrl),
    available: product.available !== false
  };
}

function normalizeAiResult(task, parsed) {
  if (task === "generate-description") {
    return {
      shortDescription: cleanText(parsed.shortDescription || parsed.descricaoCurta || ""),
      fullDescription: cleanText(parsed.fullDescription || parsed.descricaoCompleta || ""),
      benefits: normalizeStringList(parsed.benefits || parsed.beneficios).slice(0, 5)
    };
  }
  if (task === "generate-sales-copy") {
    return {
      whatsappCaption: cleanText(parsed.whatsappCaption || parsed.legendaWhatsApp || ""),
      instagramCaption: cleanText(parsed.instagramCaption || parsed.legendaInstagram || ""),
      shortCta: cleanText(parsed.shortCta || parsed.ctaCurto || ""),
      friendlyOfferText: cleanText(parsed.friendlyOfferText || parsed.textoOferta || "")
    };
  }
  if (task === "suggest-tags") {
    return {
      searchTags: normalizeStringList(parsed.searchTags || parsed.tagsBusca).slice(0, 12),
      categoryTags: normalizeStringList(parsed.categoryTags || parsed.tagsCategoria).slice(0, 8),
      commercialTags: normalizeStringList(parsed.commercialTags || parsed.tagsComerciais).slice(0, 8)
    };
  }
  return {
    score: clampScore(parsed.score ?? parsed.nota),
    problems: normalizeStringList(parsed.problems || parsed.problemas),
    suggestions: normalizeStringList(parsed.suggestions || parsed.sugestoes),
    missingFields: normalizeStringList(parsed.missingFields || parsed.camposFaltando)
  };
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n");
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  if (typeof value === "string") return value.split(/,|\n/).map(cleanText).filter(Boolean);
  return [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stringOrNull(value) {
  const text = cleanText(value);
  return text || null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(10, Number(number.toFixed(1))));
}

function createPublicError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}
