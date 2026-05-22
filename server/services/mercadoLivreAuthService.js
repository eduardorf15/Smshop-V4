import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const storageDir = path.join(rootDir, "server/storage");
const tokenFile = path.join(storageDir, "meli-tokens.json");
const authorizationUrl = "https://auth.mercadolivre.com.br/authorization";
const tokenUrl = "https://api.mercadolibre.com/oauth/token";
const refreshSkewMs = 60 * 1000;

let memoryToken;

export function generateAuthorizationUrl() {
  const { clientId, redirectUri } = getConfig();
  const url = new URL(authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

export async function exchangeCodeForToken(code) {
  if (!code) {
    throw createPublicError("Código de autorização não informado.", 400);
  }

  const { clientId, clientSecret, redirectUri } = getConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });

  const token = await requestToken(body);
  return saveToken(token);
}

export async function saveToken(tokenResponse) {
  const expiresIn = Number(tokenResponse.expires_in || 0);
  const savedAt = new Date();
  const token = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    tokenType: tokenResponse.token_type || "bearer",
    scope: tokenResponse.scope || null,
    userId: tokenResponse.user_id || null,
    expiresAt: new Date(savedAt.getTime() + expiresIn * 1000).toISOString(),
    savedAt: savedAt.toISOString()
  };

  if (!token.accessToken || !token.refreshToken) {
    throw createPublicError("Resposta OAuth do Mercado Livre não trouxe tokens válidos.", 502);
  }

  memoryToken = token;
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(tokenFile, JSON.stringify(token, null, 2), { mode: 0o600 });
  await fs.chmod(tokenFile, 0o600);
  return token;
}

export async function readSavedToken() {
  if (memoryToken) return memoryToken;

  try {
    const raw = await fs.readFile(tokenFile, "utf8");
    memoryToken = normalizeToken(JSON.parse(raw));
    return memoryToken;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function getConnectionStatus() {
  const token = await readSavedToken();
  if (!token) {
    return {
      connected: false,
      expiresAt: null
    };
  }

  return {
    connected: Boolean(token.accessToken || token.refreshToken),
    expiresAt: token.expiresAt || null,
    userId: token.userId || null
  };
}

export async function getValidAccessToken() {
  const token = await readSavedToken();
  if (!token?.accessToken && !token?.refreshToken) {
    throw createPublicError("Mercado Livre não conectado. Acesse /auth/mercadolivre para conectar primeiro.", 401);
  }

  if (token.accessToken && !isExpiredOrNearExpiry(token)) {
    return token.accessToken;
  }

  if (!token.refreshToken) {
    throw createPublicError("Access token do Mercado Livre expirado e refresh token não encontrado.", 401);
  }

  const refreshedToken = await refreshAccessToken(token.refreshToken);
  return refreshedToken.accessToken;
}

export async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    throw createPublicError("Refresh token do Mercado Livre não encontrado.", 401);
  }

  const { clientId, clientSecret } = getConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  });

  const token = await requestToken(body);
  return saveToken(token);
}

async function requestToken(body) {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || data.error_description || data.error || `HTTP ${response.status}`;
    throw createPublicError(`Falha ao autenticar com o Mercado Livre: ${message}`, response.status);
  }

  return data;
}

function getConfig() {
  const clientId = process.env.MELI_CLIENT_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;
  const redirectUri = process.env.MELI_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw createPublicError("Configuração OAuth do Mercado Livre incompleta no servidor.", 500);
  }

  return { clientId, clientSecret, redirectUri };
}

function isExpiredOrNearExpiry(token) {
  const expiresAt = Date.parse(token.expiresAt || "");
  if (!Number.isFinite(expiresAt)) return true;
  return Date.now() + refreshSkewMs >= expiresAt;
}

function normalizeToken(token) {
  if (!token) return null;
  const expiresIn = Number(token.expires_in || 0);
  const savedAt = token.savedAt || token.saved_at || new Date().toISOString();
  const savedAtTime = Date.parse(savedAt);
  const expiresAt =
    token.expiresAt ||
    token.expires_at ||
    (expiresIn && Number.isFinite(savedAtTime) ? new Date(savedAtTime + expiresIn * 1000).toISOString() : null);

  return {
    accessToken: token.accessToken || token.access_token || null,
    refreshToken: token.refreshToken || token.refresh_token || null,
    tokenType: token.tokenType || token.token_type || "bearer",
    scope: token.scope || null,
    userId: token.userId || token.user_id || null,
    expiresAt,
    savedAt
  };
}

function createPublicError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}
