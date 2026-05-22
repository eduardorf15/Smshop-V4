import crypto from "node:crypto";

const tokenTtlMs = 12 * 60 * 60 * 1000;

export function loginAdmin(password) {
  const adminPassword = getAdminPassword();
  if (!adminPassword) {
    throw createPublicError("ADMIN_PASSWORD não configurado no servidor.", 500);
  }
  if (String(password || "") !== adminPassword) {
    throw createPublicError("Senha administrativa inválida.", 401);
  }

  const expiresAt = Date.now() + tokenTtlMs;
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString("base64url");
  const signature = signPayload(payload, adminPassword);
  return {
    token: `${payload}.${signature}`,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

export function requireAdminAuth(req, _res, next) {
  try {
    const adminPassword = getAdminPassword();
    if (!adminPassword) {
      throw createPublicError("ADMIN_PASSWORD não configurado no servidor.", 500);
    }

    const token = getBearerToken(req);
    if (!token || !isValidToken(token, adminPassword)) {
      throw createPublicError("Acesso administrativo não autorizado.", 401);
    }

    next();
  } catch (error) {
    next(error);
  }
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return String(req.headers["x-admin-token"] || "").trim();
}

function isValidToken(token, adminPassword) {
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return false;
  const expectedSignature = signPayload(payload, adminPassword);
  if (!safeEqual(signature, expectedSignature)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function signPayload(payload, adminPassword) {
  return crypto.createHmac("sha256", adminPassword).update(payload).digest("base64url");
}

function safeEqual(value, expected) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  if (valueBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || "";
}

function createPublicError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}
