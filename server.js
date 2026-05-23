const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { URLSearchParams } = require("url");
const database = require("./database");

const rootDir = __dirname;

function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) return;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

loadDotEnv();

const port = Number(process.env.PORT || 3000);
const fallbackPort = 3000;
const deliveryEstimateDays = 7;
const pendingPayuOrders = new Map();
let googleAccessTokenCache = null;
let websiteLoginCache = null;

function envFlag(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").toLowerCase());
}

function appDatabaseEnabled() {
  if (envFlag("DISABLE_DATABASE")) return false;
  return envFlag("ENABLE_DATABASE") || envFlag("USE_DATABASE");
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      const contentType = req.headers["content-type"] || "";
      try {
        if (contentType.includes("application/json")) {
          resolve(body ? JSON.parse(body) : {});
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          resolve(Object.fromEntries(new URLSearchParams(body)));
        } else {
          resolve(body ? JSON.parse(body) : {});
        }
      } catch (error) {
        reject(new Error("Invalid request body"));
      }
    });
    req.on("error", reject);
  });
}

function getOrigin(req) {
  const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host || "";
  const forwardedProtocol = req.headers["x-forwarded-proto"];
  const host = forwardedHost;
  if (forwardedProtocol) {
    const protocol = String(forwardedProtocol).split(",")[0].trim();
    return `${protocol}://${host}`;
  }

  const protocol = req.socket?.encrypted ? "https" : "http";
  return `${protocol}://${host}`;
}

function publicOrigin(req) {
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || "").replace(/\/+$/g, "");
  const requestOrigin = getOrigin(req);
  const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host || "";
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(forwardedHost));
  return publicBaseUrl && !isLocalHost ? publicBaseUrl : requestOrigin;
}

function localFrontendConfig(req) {
  try {
    const source = fs.readFileSync(path.join(rootDir, "config.js"), "utf8");
    const origin = getOrigin(req);
    const parsedOrigin = new URL(origin);
    const sandbox = {
      window: {
        location: {
          protocol: parsedOrigin.protocol,
          origin
        }
      },
      console: {
        log() {},
        warn() {},
        error() {}
      }
    };

    vm.runInNewContext(source, sandbox, {
      filename: "config.js",
      timeout: 100
    });

    return sandbox.window.EVSPEARE_CONFIG || sandbox.window.BAZAARGO_CONFIG || {};
  } catch (error) {
    console.warn("Unable to read config.js import settings", error.message);
    return {};
  }
}

function absoluteEndpoint(baseUrl, endpointPath) {
  try {
    return new URL(endpointPath || "/api/mobile/products", `${String(baseUrl).replace(/\/+$/g, "")}/`).toString();
  } catch (error) {
    return "";
  }
}

function productImportUrl(value, endpointPath) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if ((url.pathname === "/" || url.pathname === "") && !url.search && !url.hash) {
      return absoluteEndpoint(url.toString(), endpointPath);
    }
  } catch (error) {
    return String(value || "");
  }
  return String(value);
}

function productUrlCandidates(value) {
  const candidates = [value].filter(Boolean);
  try {
    const url = new URL(value);
    candidates.push(new URL("/api/products", url.origin).toString());
    candidates.push(new URL("/api/mobile/products", url.origin).toString());
  } catch (error) {
    return candidates;
  }
  return [...new Set(candidates)];
}

function setCookiesFromHeaders(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = headers.get("set-cookie");
  if (!value) return [];
  return value.split(/,(?=\s*[^;,\s]+=)/g);
}

function cookieHeaderFromSetCookies(setCookies) {
  const pairs = new Map();
  setCookies.forEach((cookie) => {
    const pair = String(cookie || "").split(";")[0].trim();
    const eqIndex = pair.indexOf("=");
    if (eqIndex > 0) pairs.set(pair.slice(0, eqIndex), pair.slice(eqIndex + 1));
  });
  return Array.from(pairs.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function mergeCookieHeaders(...cookieHeaders) {
  return cookieHeaderFromSetCookies(
    cookieHeaders
      .filter(Boolean)
      .flatMap((header) => String(header).split(/;\s*(?=[^;=\s]+=)/g))
  );
}

function csrfTokenFromHtml(html) {
  const match = String(html || "").match(/name=["']_csrf_token["'][^>]*value=["']([^"']+)/i)
    || String(html || "").match(/value=["']([^"']+)["'][^>]*name=["']_csrf_token["']/i);
  return match ? match[1] : "";
}

function websiteLoginSettings(req, endpointUrl) {
  const localConfig = localFrontendConfig(req);
  const origin = (() => {
    try {
      return new URL(endpointUrl).origin;
    } catch (error) {
      return "";
    }
  })();

  return {
    email: process.env.WEBSITE_LOGIN_EMAIL || localConfig.websiteLoginEmail || "",
    password: process.env.WEBSITE_LOGIN_PASSWORD || localConfig.websiteLoginPassword || "",
    loginUrl: process.env.WEBSITE_LOGIN_URL || localConfig.websiteLoginUrl || (origin ? `${origin}/login` : "")
  };
}

async function websiteLoginCookie(req, endpointUrl) {
  const settings = websiteLoginSettings(req, endpointUrl);
  if (!settings.email || !settings.password || !settings.loginUrl) return "";

  const cacheKey = `${settings.loginUrl}|${settings.email}`;
  if (websiteLoginCache?.cacheKey === cacheKey && websiteLoginCache.expiresAt > Date.now()) {
    return websiteLoginCache.cookie;
  }

  const loginPage = await fetchWithTimeout(settings.loginUrl, {
    headers: { Accept: "text/html,application/xhtml+xml" }
  });
  const loginHtml = await loginPage.text();
  const csrfToken = csrfTokenFromHtml(loginHtml);
  const loginCookies = cookieHeaderFromSetCookies(setCookiesFromHeaders(loginPage.headers));
  if (!loginPage.ok) {
    throw new Error(`Website login page failed with ${loginPage.status}`);
  }
  if (!csrfToken) {
    throw new Error("Website login form CSRF token was not found");
  }

  const body = new URLSearchParams({
    _csrf_token: csrfToken,
    email: settings.email,
    password: settings.password
  });

  const loginResponse = await fetchWithTimeout(settings.loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "text/html,application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: loginCookies
    },
    body
  });
  const responseCookies = cookieHeaderFromSetCookies(setCookiesFromHeaders(loginResponse.headers));
  const cookie = mergeCookieHeaders(loginCookies, responseCookies);

  if (![200, 302, 303].includes(loginResponse.status) || !cookie) {
    throw new Error(`Website login failed with ${loginResponse.status}`);
  }

  const loginText = loginResponse.status === 200 ? await loginResponse.text() : "";
  if (/name=["']password["']|Login required|Invalid/i.test(loginText)) {
    throw new Error("Website login failed. Check websiteLoginEmail/websiteLoginPassword.");
  }

  websiteLoginCache = {
    cacheKey,
    cookie,
    expiresAt: Date.now() + 20 * 60 * 1000
  };

  return cookie;
}

function isMissingRemoteEndpoint(error) {
  return /\b404\b|not found/i.test(error.message || "");
}

function isLoginRequiredError(error) {
  return /\b401\b|unauthorized|login required/i.test(error.message || "");
}

async function fetchWebsiteJsonWithAuth(req, endpointUrl, label) {
  try {
    return await fetchRemoteJson(
      endpointUrl,
      websiteHeaders({}, req),
      label
    );
  } catch (error) {
    if (!isLoginRequiredError(error)) throw error;

    const cookie = await websiteLoginCookie(req, endpointUrl);
    if (!cookie) throw error;

    return fetchRemoteJson(
      endpointUrl,
      {
        Accept: "application/json",
        Cookie: cookie
      },
      label
    );
  }
}

function configuredWebsiteProductsUrl(req) {
  const localConfig = localFrontendConfig(req);
  const explicitUrl = process.env.WEBSITE_PRODUCTS_URL
    || localConfig.websiteProductsUrl
    || localConfig.productImportUrl
    || "";

  if (explicitUrl) return productImportUrl(explicitUrl, localConfig.productsEndpoint);

  const localApiBaseUrl = String(localConfig.apiBaseUrl || "");
  if (!/^https?:\/\//i.test(localApiBaseUrl)) return "";

  try {
    const localApiBase = new URL(localApiBaseUrl);
    const appOrigin = new URL(getOrigin(req));
    if (localApiBase.host === appOrigin.host) return "";
  } catch (error) {
    return "";
  }

  return absoluteEndpoint(localApiBaseUrl, localConfig.productsEndpoint);
}

function configuredWebsiteOrdersUrl(req) {
  const localConfig = localFrontendConfig(req);
  const explicitUrl = process.env.WEBSITE_ORDERS_URL
    || localConfig.websiteOrdersUrl
    || "";

  if (explicitUrl) return explicitUrl;

  const productsUrl = configuredWebsiteProductsUrl(req);
  if (!productsUrl) return "";

  try {
    return new URL("/add-order", new URL(productsUrl).origin).toString();
  } catch (error) {
    return "";
  }
}

function publicConfig(req) {
  const websiteProductsUrl = configuredWebsiteProductsUrl(req);
  const websiteOrdersUrl = configuredWebsiteOrdersUrl(req);
  const defaultPincodeCoordinates = { 700136: { lat: 22.637112, lng: 88.454125 } };
  const fastDeliveryPincodes = String(process.env.FAST_DELIVERY_PINCODES || "700136")
    .split(",")
    .map((value) => value.replace(/\D/g, "").slice(0, 6))
    .filter((value) => value.length === 6);
  const pincodeCoordinates = (() => {
    try {
      return process.env.PINCODE_COORDINATES_JSON ? JSON.parse(process.env.PINCODE_COORDINATES_JSON) : defaultPincodeCoordinates;
    } catch (error) {
      return defaultPincodeCoordinates;
    }
  })();
  return {
    businessName: process.env.BUSINESS_NAME || "Ev Speare",
    currency: process.env.CURRENCY || "INR",
    apiBaseUrl: getOrigin(req),
    websiteProductsUrl,
    websiteOrdersUrl,
    storePincode: String(process.env.STORE_PINCODE || "700136").replace(/\D/g, "").slice(0, 6),
    storeLatitude: process.env.STORE_LATITUDE || "22.637112",
    storeLongitude: process.env.STORE_LONGITUDE || "88.454125",
    fastDeliveryRadiusKm: Number(process.env.FAST_DELIVERY_RADIUS_KM || 20),
    addressPincodeRadiusKm: Number(process.env.ADDRESS_PINCODE_RADIUS_KM || 25),
    fastDeliveryPincodes,
    pincodeCoordinates,
    productsEndpoint: "/api/mobile/products",
    ordersEndpoint: "/api/mobile/orders",
    orderCancelEndpoint: "/api/mobile/orders/cancel",
    orderReturnEndpoint: "/api/mobile/orders/return",
    supportEndpoint: "/api/mobile/support",
    otpRequestEndpoint: "/api/mobile/auth/request-otp",
    otpVerifyEndpoint: "/api/mobile/auth/verify-otp",
    paymentCreateEndpoint: "/api/mobile/payments/create",
    paymentVerifyEndpoint: "/api/mobile/payments/verify",
    authHeader: "",
    paymentGateway: {
      provider: "payu",
      keyId: process.env.PAYU_KEY || "",
      checkoutScript: ""
    },
    demo: {
      enabled: false,
      otp: "",
      allowDemoPayment: false
    }
  };
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionSecret() {
  return process.env.SESSION_SECRET || "change-this-session-secret-on-railway";
}

function signToken(user) {
  const payload = {
    sub: String(user.id || user.phone),
    phone: user.phone,
    name: user.name || "Customer",
    iat: Math.floor(Date.now() / 1000)
  };
  const encoded = base64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !token.includes(".")) return null;

  const [encoded, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
}

function pendingDir() {
  const dir = path.join(rootDir, "data", "pending-payu");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function savePendingPayuOrder(txnid, order) {
  pendingPayuOrders.set(txnid, order);
  fs.writeFileSync(path.join(pendingDir(), `${txnid}.json`), JSON.stringify(order, null, 2));
}

function loadPendingPayuOrder(txnid) {
  if (pendingPayuOrders.has(txnid)) return pendingPayuOrders.get(txnid);
  try {
    const filePath = path.join(pendingDir(), `${txnid}.json`);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function deletePendingPayuOrder(txnid) {
  pendingPayuOrders.delete(txnid);
  try {
    fs.unlinkSync(path.join(pendingDir(), `${txnid}.json`));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(error);
  }
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function phoneE164(value) {
  const digits = phoneDigits(value);
  if (digits.length !== 10) return "";
  return `+91${digits}`;
}

function twilioConfigStatus() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID || "";
  const channel = (process.env.TWILIO_VERIFY_CHANNEL || "sms").toLowerCase();

  return {
    configured: Boolean(accountSid && authToken && serviceSid),
    accountSidSet: Boolean(accountSid),
    authTokenSet: Boolean(authToken),
    serviceSidSet: Boolean(serviceSid),
    accountSidLooksValid: accountSid.startsWith("AC"),
    serviceSidLooksValid: serviceSid.startsWith("VA"),
    channel
  };
}

function safeUrlSummary(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return {
      host: url.host,
      path: url.pathname
    };
  } catch (error) {
    return {
      invalid: true
    };
  }
}

function allowedImageHost(hostname) {
  const allowed = (process.env.IMAGE_PROXY_ALLOWED_HOSTS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return (
    hostname === "storage.googleapis.com" ||
    hostname === "firebasestorage.googleapis.com" ||
    hostname.endsWith(".storage.googleapis.com") ||
    allowed.includes(hostname.toLowerCase())
  );
}

function parseGcsSource(src) {
  const value = String(src || "");
  if (value.startsWith("gs://")) {
    const withoutScheme = value.slice(5);
    const slashIndex = withoutScheme.indexOf("/");
    if (slashIndex <= 0) return null;
    return {
      bucket: withoutScheme.slice(0, slashIndex),
      object: withoutScheme.slice(slashIndex + 1),
      publicUrl: `https://storage.googleapis.com/${withoutScheme}`
    };
  }

  try {
    const url = new URL(value);
    if (url.hostname === "storage.googleapis.com") {
      const parts = url.pathname.replace(/^\/+/, "").split("/");
      const bucket = parts.shift();
      if (!bucket || !parts.length) return null;
      return {
        bucket,
        object: decodeURIComponent(parts.join("/")),
        publicUrl: url.toString()
      };
    }

    if (url.hostname.endsWith(".storage.googleapis.com")) {
      return {
        bucket: url.hostname.replace(".storage.googleapis.com", ""),
        object: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
        publicUrl: url.toString()
      };
    }

    if (url.hostname === "firebasestorage.googleapis.com") {
      const match = url.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (!match) return null;
      return {
        bucket: decodeURIComponent(match[1]),
        object: decodeURIComponent(match[2]),
        publicUrl: url.toString()
      };
    }
  } catch (error) {
    return null;
  }

  return null;
}

function gcsPublicCandidates(gcs) {
  if (!gcs) return [];
  const encodedObject = gcs.object
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const firebaseObject = encodeURIComponent(gcs.object);

  return [
    gcs.publicUrl,
    `https://${gcs.bucket}.storage.googleapis.com/${encodedObject}`,
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(gcs.bucket)}/o/${firebaseObject}?alt=media`
  ];
}

function googleServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        clientEmail: parsed.client_email,
        privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n"),
        tokenUri: parsed.token_uri || "https://oauth2.googleapis.com/token"
      };
    } catch (error) {
      console.error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON", error.message);
    }
  }

  return {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    tokenUri: process.env.GOOGLE_TOKEN_URI || "https://oauth2.googleapis.com/token"
  };
}

function googleStorageConfigured() {
  const account = googleServiceAccount();
  return Boolean(account.clientEmail && account.privateKey);
}

async function googleAccessToken() {
  if (googleAccessTokenCache && googleAccessTokenCache.expiresAt > Date.now() + 60000) {
    return googleAccessTokenCache.token;
  }

  const account = googleServiceAccount();
  if (!account.clientEmail || !account.privateKey) {
    throw new Error("Google service account is not configured for private warehouse images");
  }

  const now = Math.floor(Date.now() / 1000);
  const assertionBase = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson({
    iss: account.clientEmail,
    scope: "https://www.googleapis.com/auth/devstorage.read_only",
    aud: account.tokenUri,
    iat: now,
    exp: now + 3600
  })}`;
  const signature = crypto.createSign("RSA-SHA256").update(assertionBase).sign(account.privateKey).toString("base64url");
  const assertion = `${assertionBase}.${signature}`;

  const response = await fetch(account.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || "Google token request failed");

  googleAccessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  };
  return googleAccessTokenCache.token;
}

function placeholderSvg(message = "Image unavailable") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
    <rect width="640" height="480" fill="#eef4ff"/>
    <circle cx="320" cy="210" r="92" fill="#2874f0" opacity=".14"/>
    <path d="M205 285h230l36 55H169l36-55Z" fill="#172033" opacity=".9"/>
    <path d="M232 164h176l46 100H186l46-100Z" fill="#2874f0"/>
    <path d="M242 190h156l24 50H218l24-50Z" fill="#ffffff" opacity=".9"/>
    <text x="320" y="390" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#172033">Ev Speare</text>
    <text x="320" y="425" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#627086">${message}</text>
  </svg>`;
}

function isSelfReference(req, value, endpointPath) {
  if (!value) return false;
  try {
    const target = new URL(value);
    const origin = new URL(getOrigin(req));
    return target.host === origin.host && target.pathname === endpointPath;
  } catch (error) {
    return false;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number(process.env.OUTBOUND_FETCH_TIMEOUT_MS || 20000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function firstPresent(item, names) {
  for (const name of names) {
    if (!item || !Object.prototype.hasOwnProperty.call(item, name)) continue;
    const value = item[name];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? null : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const match = String(value).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function unwrapConnectionItem(item) {
  if (item && typeof item === "object") {
    if (item.node && typeof item.node === "object") return item.node;
    if (item.product && typeof item.product === "object") return item.product;
  }
  return item;
}

function arrayFromPayload(payload, keys = ["products", "items", "data", "results", "records", "nodes"], depth = 0) {
  if (Array.isArray(payload)) return payload.map(unwrapConnectionItem);
  if (!payload || typeof payload !== "object" || depth > 2) return [];

  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key].map(unwrapConnectionItem);
  }

  if (Array.isArray(payload.edges)) {
    return payload.edges.map(unwrapConnectionItem);
  }

  for (const key of keys) {
    const nested = arrayFromPayload(payload[key], keys, depth + 1);
    if (nested.length) return nested;
  }

  return [];
}

function imageBaseUrl(endpointUrl) {
  if (process.env.IMAGE_BASE_URL) return process.env.IMAGE_BASE_URL;
  try {
    return new URL(endpointUrl).origin;
  } catch (error) {
    return "";
  }
}

function publicProductImageUrl(value, endpointUrl = "") {
  const image = String(value || "").trim();
  if (!image) return "";

  if (image.startsWith("gs://")) {
    return `/api/mobile/images?src=${encodeURIComponent(image)}`;
  }

  try {
    const url = new URL(image);
    if (
      url.hostname === "storage.googleapis.com" ||
      url.hostname === "firebasestorage.googleapis.com" ||
      url.hostname.endsWith(".storage.googleapis.com")
    ) {
      return `/api/mobile/images?src=${encodeURIComponent(image)}`;
    }
    return url.toString();
  } catch (error) {
    const base = imageBaseUrl(endpointUrl);
    if (base) {
      try {
        return new URL(image, `${base.replace(/\/+$/g, "")}/`).toString();
      } catch (innerError) {
        return image;
      }
    }
  }

  return image;
}

function firstProductImage(item, endpointUrl) {
  const direct = firstPresent(item, [
    "image",
    "image_url",
    "imageUrl",
    "photo",
    "thumbnail",
    "thumbnail_url",
    "thumbnailUrl",
    "featured_image",
    "featuredImage",
    "main_image",
    "mainImage",
    "product_image",
    "productImage",
    "featuredImage"
  ]);
  if (direct) {
    const image = typeof direct === "object"
      ? firstPresent(direct, ["src", "url", "image", "image_url", "path"])
      : direct;
    if (image) return publicProductImageUrl(image, endpointUrl);
  }

  const images = firstPresent(item, ["images", "gallery", "photos", "media"]);
  const imageRows = Array.isArray(images) ? images : arrayFromPayload(images, ["images", "items", "data", "nodes"]);
  if (imageRows[0]) {
    const first = typeof imageRows[0] === "object"
      ? firstPresent(imageRows[0], ["src", "url", "image", "image_url", "path"])
      : imageRows[0];
    if (first) return publicProductImageUrl(first, endpointUrl);
  }

  return "https://images.unsplash.com/photo-1607082350899-7e105aa886ae?auto=format&fit=crop&w=420&q=80";
}

function firstProductCategory(item) {
  const direct = firstPresent(item, ["category", "category_name", "categoryName", "product_category", "productCategory"]);
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object") return direct.name || direct.title || "Deals";

  const categories = firstPresent(item, ["categories", "collections"]);
  const categoryRows = Array.isArray(categories) ? categories : arrayFromPayload(categories, ["categories", "items", "data", "nodes"]);
  if (categoryRows[0]) {
    return categoryRows[0].name || categoryRows[0].title || categoryRows[0].slug || (typeof categoryRows[0] === "string" ? categoryRows[0] : "Deals");
  }

  return "Deals";
}

function firstNumericValue(item, names) {
  return numericValue(firstPresent(item, names));
}

function productPrice(item, depth = 0) {
  const direct = firstNumericValue(item, [
    "price",
    "sale_price",
    "salePrice",
    "selling_price",
    "sellingPrice",
    "final_price",
    "finalPrice",
    "amount",
    "display_price",
    "displayPrice",
    "price_html",
    "priceHtml"
  ]);
  if (direct !== null) return direct;

  const nested = firstPresent(item, ["prices", "pricing", "price_range", "priceRange"]);
  if (nested && typeof nested === "object") {
    const nestedDirect = firstNumericValue(nested, [
      "price",
      "sale_price",
      "salePrice",
      "selling_price",
      "sellingPrice",
      "final_price",
      "finalPrice",
      "amount",
      "min_price",
      "minPrice",
      "regular_price",
      "regularPrice"
    ]);
    if (nestedDirect !== null) return nestedDirect;

    const minVariant = firstPresent(nested, ["minVariantPrice", "min_variant_price"]);
    if (minVariant && typeof minVariant === "object") {
      const variantPrice = firstNumericValue(minVariant, ["amount", "price"]);
      if (variantPrice !== null) return variantPrice;
    }
  }

  if (depth < 1) {
    const variants = firstPresent(item, ["variants", "variations"]);
    const variantRows = Array.isArray(variants)
      ? variants
      : arrayFromPayload(variants, ["variants", "items", "data", "nodes"]);
    if (variantRows[0]) return productPrice(variantRows[0], depth + 1);
  }

  return null;
}

function productMrp(item, fallbackPrice) {
  const direct = firstNumericValue(item, [
    "mrp",
    "regular_price",
    "regularPrice",
    "compare_at_price",
    "compareAtPrice",
    "original_price",
    "originalPrice"
  ]);
  if (direct !== null) return direct;

  const nested = firstPresent(item, ["prices", "pricing", "price_range", "priceRange", "compareAtPriceRange", "compare_at_price_range"]);
  if (nested && typeof nested === "object") {
    const nestedMrp = firstNumericValue(nested, [
      "mrp",
      "regular_price",
      "regularPrice",
      "compare_at_price",
      "compareAtPrice",
      "original_price",
      "originalPrice",
      "max_price",
      "maxPrice"
    ]);
    if (nestedMrp !== null) return nestedMrp;

    const maxVariant = firstPresent(nested, ["maxVariantPrice", "max_variant_price"]);
    if (maxVariant && typeof maxVariant === "object") {
      const variantMrp = firstNumericValue(maxVariant, ["amount", "price"]);
      if (variantMrp !== null) return variantMrp;
    }
  }

  return fallbackPrice;
}

function stockStatusFromItem(item, quantity) {
  const statusValue = firstPresent(item, [
    "stock_status",
    "stockStatus",
    "availability",
    "status",
    "stock",
    "in_stock",
    "inStock",
    "is_in_stock",
    "isInStock",
    "available"
  ]);

  if (quantity !== null && quantity <= 0) return "out_of_stock";
  if (typeof statusValue === "boolean") return statusValue ? "available" : "out_of_stock";
  if (statusValue === 0 || statusValue === "0") return "out_of_stock";

  const normalized = String(statusValue || "").toLowerCase();
  if (["out_of_stock", "out of stock", "sold_out", "sold out", "unavailable", "inactive", "disabled"].includes(normalized)) {
    return "out_of_stock";
  }
  return statusValue || "available";
}

function normalizeRemoteProduct(item, index, endpointUrl, source) {
  const id = firstPresent(item, ["id", "product_id", "productId", "sku", "product_sku", "productSku", "code"]);
  const sourceId = firstPresent(item, ["product_id", "productId", "id", "sku", "product_sku", "productSku", "code"]);
  const sku = firstPresent(item, ["sku", "product_sku", "productSku", "code"]);
  const price = productPrice(item) || 0;
  const mrp = productMrp(item, price) || price;
  const quantity = numericValue(firstPresent(item, [
    "stock_quantity",
    "stockQuantity",
    "inventory",
    "inventory_qty",
    "inventoryQty",
    "inventory_quantity",
    "inventoryQuantity",
    "available_quantity",
    "availableQuantity",
    "available_stock",
    "availableStock",
    "warehouse_stock",
    "warehouseStock",
    "warehouse_inventory",
    "warehouseInventory",
    "current_stock",
    "currentStock",
    "qty",
    "quantity",
    "on_hand",
    "onHand"
  ]));
  const category = firstProductCategory(item);
  const rawTags = firstPresent(item, ["tags", "labels"]);
  const tags = Array.isArray(rawTags)
    ? rawTags.map((tag) => tag.name || tag.title || tag).filter(Boolean)
    : [];

  return {
    id: String(id || `${source}-${index}`),
    sourceId: sourceId === null || sourceId === undefined ? null : sourceId,
    sku: sku === null || sku === undefined ? null : String(sku),
    ean: firstPresent(item, ["ean", "EAN", "barcode", "bar_code", "upc", "isbn"]) || sku || null,
    title: firstPresent(item, ["title", "name", "product_name", "productName"]) || "Product",
    category,
    price: price || mrp || 0,
    mrp: mrp || price || 0,
    rating: numericValue(firstPresent(item, ["rating", "average_rating", "averageRating"])) || 4.1,
    reviews: numericValue(firstPresent(item, ["reviews", "rating_count", "ratingCount", "review_count", "reviewCount"])) || 0,
    delivery: firstPresent(item, ["delivery", "shipping_text", "shippingText"]) || "Delivery available",
    tags: [...new Set(["Deals", category, ...tags].filter(Boolean))],
    image: firstProductImage(item, endpointUrl),
    stock: stockStatusFromItem(item, quantity),
    stockQuantity: quantity,
    source
  };
}

async function fetchRemoteJson(endpointUrl, headers, label) {
  const response = await fetchWithTimeout(endpointUrl, { headers });
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    const contentType = response.headers.get("content-type") || "unknown content type";
    const sample = text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    throw new Error(`${label} must return JSON data. Got ${contentType}${sample ? `: ${sample}` : ""}`);
  }

  if (!response.ok) {
    throw new Error(data.message || data.error || `${label} failed with ${response.status}`);
  }

  return data;
}

function publicDiagnostics(req) {
  const websiteProductsUrl = configuredWebsiteProductsUrl(req);
  const websiteOrdersUrl = configuredWebsiteOrdersUrl(req);
  const localConfig = localFrontendConfig(req);
  const websiteCredentialSet = Boolean(
    process.env.WEBSITE_API_TOKEN ||
    process.env.WEBSITE_COOKIE ||
    localConfig.websiteAuthHeader ||
    localConfig.websiteCookie
  );
  const websiteLoginSet = Boolean(
    (process.env.WEBSITE_LOGIN_EMAIL || localConfig.websiteLoginEmail) &&
    (process.env.WEBSITE_LOGIN_PASSWORD || localConfig.websiteLoginPassword)
  );
  return {
    ok: true,
    service: "ev-speare",
    twilio: twilioConfigStatus(),
    payu: {
      configured: Boolean(process.env.PAYU_KEY && process.env.PAYU_SALT),
      keySet: Boolean(process.env.PAYU_KEY),
      saltSet: Boolean(process.env.PAYU_SALT),
      env: process.env.PAYU_ENV || "test"
    },
    website: {
      productsUrlSet: Boolean(websiteProductsUrl),
      productsUrlSource: process.env.WEBSITE_PRODUCTS_URL ? "env" : websiteProductsUrl ? "config.js" : null,
      ordersUrlSet: Boolean(websiteOrdersUrl),
      ordersUrlSource: process.env.WEBSITE_ORDERS_URL ? "env" : websiteOrdersUrl ? "derived" : null,
      trackingUrlSet: Boolean(process.env.WEBSITE_TRACKING_URL || process.env.WEBSITE_ORDER_TRACKING_URL),
      apiTokenSet: websiteCredentialSet,
      loginCredentialsSet: websiteLoginSet,
      productsUrl: safeUrlSummary(websiteProductsUrl),
      ordersUrl: safeUrlSummary(websiteOrdersUrl),
      trackingUrl: safeUrlSummary(process.env.WEBSITE_TRACKING_URL || process.env.WEBSITE_ORDER_TRACKING_URL),
      productsUrlSelfReference: isSelfReference(req, websiteProductsUrl, "/api/mobile/products"),
      ordersUrlSelfReference: isSelfReference(req, websiteOrdersUrl, "/api/mobile/orders")
    },
    warehouse: {
      productsUrlSet: Boolean(process.env.WAREHOUSE_PRODUCTS_URL),
      inventoryUrlSet: Boolean(process.env.WAREHOUSE_INVENTORY_URL),
      ordersUrlSet: Boolean(process.env.WAREHOUSE_ORDERS_URL),
      trackingUrlSet: Boolean(process.env.WAREHOUSE_TRACKING_URL),
      apiTokenSet: Boolean(process.env.WAREHOUSE_API_TOKEN),
      productsUrl: safeUrlSummary(process.env.WAREHOUSE_PRODUCTS_URL),
      inventoryUrl: safeUrlSummary(process.env.WAREHOUSE_INVENTORY_URL),
      ordersUrl: safeUrlSummary(process.env.WAREHOUSE_ORDERS_URL),
      trackingUrl: safeUrlSummary(process.env.WAREHOUSE_TRACKING_URL),
      productsUrlSelfReference: isSelfReference(req, process.env.WAREHOUSE_PRODUCTS_URL, "/api/mobile/products")
    },
    images: {
      googleStorageConfigured: googleStorageConfigured(),
      proxyAllowedHostsSet: Boolean(process.env.IMAGE_PROXY_ALLOWED_HOSTS)
    },
    database: {
      ...database.status(),
      enabledForApp: appDatabaseEnabled()
    }
  };
}

async function twilioRequest(pathname, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!accountSid || !authToken || !serviceSid) {
    throw new Error("Twilio Verify env vars are missing");
  }

  const response = await fetch(`https://verify.twilio.com/v2/Services/${serviceSid}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Twilio Verify request failed", {
      status: response.status,
      code: data.code,
      message: data.message,
      moreInfo: data.more_info
    });
    const code = data.code ? `Twilio ${data.code}: ` : "";
    throw new Error(`${code}${data.message || data.more_info || "Twilio request failed"}`);
  }
  return data;
}

async function handleRequestOtp(req, res) {
  const body = await readBody(req);
  const to = phoneE164(body.phone);
  if (!to) return send(res, 400, { message: "Enter a valid 10 digit mobile number" });

  try {
    const verification = await twilioRequest("/Verifications", {
      To: to,
      Channel: (process.env.TWILIO_VERIFY_CHANNEL || "sms").toLowerCase()
    });

    send(res, 200, {
      message: "OTP sent",
      sid: verification.sid,
      status: verification.status
    });
  } catch (error) {
    const status = error.message.includes("env vars") ? 503 : 502;
    send(res, status, { message: error.message });
  }
}

async function handleVerifyOtp(req, res) {
  const body = await readBody(req);
  const to = phoneE164(body.phone);
  const code = String(body.otp || "").trim();
  if (!to || code.length < 4) return send(res, 400, { message: "Phone and OTP are required" });

  let check;
  try {
    check = await twilioRequest("/VerificationCheck", {
      To: to,
      Code: code
    });
  } catch (error) {
    const status = error.message.includes("env vars") ? 503 : 502;
    return send(res, status, { message: error.message });
  }

  if (check.status !== "approved") {
    return send(res, 401, { message: "Invalid OTP" });
  }

  const phone = phoneDigits(body.phone);
  const user = { id: phone, phone, name: body.name || "Customer" };
  send(res, 200, {
    token: signToken(user),
    user
  });
}

async function handleSupportQuery(req, res) {
  const user = verifyToken(req);
  const body = await readBody(req);
  const name = String(body.name || user?.name || "").trim();
  const phone = phoneDigits(body.phone || user?.phone || "");
  const message = String(body.message || "").trim();

  if (!name) return send(res, 400, { message: "Name is required" });
  if (phone.length !== 10) return send(res, 400, { message: "Valid mobile number is required" });
  if (message.length < 5) return send(res, 400, { message: "Query message is required" });

  const query = {
    id: `SUP-${Date.now()}`,
    name,
    phone,
    message,
    source: body.source || "mobile_app",
    user: user || null,
    createdAt: new Date().toISOString()
  };

  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(path.join(dataDir, "support-queries.jsonl"), `${JSON.stringify(query)}\n`);

  if (process.env.SUPPORT_QUERY_URL) {
    const response = await fetchWithTimeout(process.env.SUPPORT_QUERY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(process.env.SUPPORT_QUERY_TOKEN ? { Authorization: process.env.SUPPORT_QUERY_TOKEN } : {})
      },
      body: JSON.stringify(query)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Support query forward failed with ${response.status}`);
    }
  }

  send(res, 200, {
    submitted: true,
    id: query.id
  });
}

function websiteHeaders(extra = {}, req = null) {
  const localConfig = req ? localFrontendConfig(req) : {};
  const headers = {
    Accept: "application/json",
    ...extra
  };
  const authHeader = process.env.WEBSITE_API_TOKEN || localConfig.websiteAuthHeader || "";
  const cookie = process.env.WEBSITE_COOKIE || localConfig.websiteCookie || "";
  if (authHeader) {
    headers.Authorization = authHeader;
  }
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
}

async function websiteRequestHeaders(req, endpointUrl, extra = {}) {
  const headers = websiteHeaders(extra, req);
  if (headers.Authorization || headers.Cookie) return headers;

  const cookie = await websiteLoginCookie(req, endpointUrl);
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function warehouseHeaders(extra = {}) {
  const headers = {
    Accept: "application/json",
    ...extra
  };
  if (process.env.WAREHOUSE_API_TOKEN) {
    headers.Authorization = process.env.WAREHOUSE_API_TOKEN;
  }
  return headers;
}

function inventoryKeys(row) {
  const keys = [
    firstPresent(row, ["product_id", "productId"]),
    firstPresent(row, ["product", "item_id", "itemId"]),
    firstPresent(row, ["sku", "product_sku", "productSku"]),
    firstPresent(row, ["variant_id", "variantId"])
  ].filter((value) => value !== null && value !== undefined && value !== "");

  if (!keys.length) {
    const id = firstPresent(row, ["id"]);
    if (id !== null && id !== undefined && id !== "") keys.push(id);
  }

  return [...new Set(keys.map((key) => String(key)))];
}

function inventoryQuantity(row) {
  return numericValue(firstPresent(row, [
    "stock_quantity",
    "stockQuantity",
    "inventory",
    "inventory_qty",
    "inventoryQty",
    "inventory_quantity",
    "inventoryQuantity",
    "available_quantity",
    "availableQuantity",
    "available_stock",
    "availableStock",
    "warehouse_stock",
    "warehouseStock",
    "warehouse_inventory",
    "warehouseInventory",
    "current_stock",
    "currentStock",
    "stock_count",
    "stockCount",
    "qty",
    "quantity",
    "stock",
    "on_hand",
    "onHand"
  ]));
}

async function mergeWarehouseInventory(products, req) {
  if (!process.env.WAREHOUSE_INVENTORY_URL || !products.length) return products;

  if (req && isSelfReference(req, process.env.WAREHOUSE_INVENTORY_URL, "/api/mobile/products")) {
    throw new Error("WAREHOUSE_INVENTORY_URL points back to this app. Set your real warehouse inventory API URL.");
  }

  const data = await fetchRemoteJson(
    process.env.WAREHOUSE_INVENTORY_URL,
    warehouseHeaders(),
    "Warehouse inventory import"
  );
  const rows = arrayFromPayload(data, ["inventory", "stocks", "stock", "items", "products", "data"]);
  const inventory = new Map();

  rows.forEach((row) => {
    const quantity = inventoryQuantity(row);
    const status = stockStatusFromItem(row, quantity);
    inventoryKeys(row).forEach((key) => {
      const existing = inventory.get(key);
      inventory.set(key, {
        quantity: quantity === null
          ? existing?.quantity ?? null
          : Number(existing?.quantity || 0) + quantity,
        status
      });
    });
  });

  return products.map((product) => {
    const keys = [product.sourceId, product.id, product.sku]
      .filter((value) => value !== null && value !== undefined && value !== "")
      .map((value) => String(value));
    const match = keys.map((key) => inventory.get(key)).find(Boolean);
    if (!match) return product;

    return {
      ...product,
      stockQuantity: match.quantity,
      stock: match.quantity !== null && match.quantity <= 0 ? "out_of_stock" : match.status || product.stock
    };
  });
}

async function fetchWarehouseProducts(req) {
  if (!process.env.WAREHOUSE_PRODUCTS_URL) return null;

  if (isSelfReference(req, process.env.WAREHOUSE_PRODUCTS_URL, "/api/mobile/products")) {
    throw new Error("WAREHOUSE_PRODUCTS_URL points back to this app. Set your real warehouse products API URL.");
  }

  const data = await fetchRemoteJson(
    process.env.WAREHOUSE_PRODUCTS_URL,
    warehouseHeaders(),
    "Warehouse product import"
  );
  const rows = arrayFromPayload(data, ["products", "items", "data", "results", "records", "nodes"]);
  const products = rows
    .map((item, index) => normalizeRemoteProduct(item, index, process.env.WAREHOUSE_PRODUCTS_URL, "warehouse"))
    .filter((product) => product.price > 0);

  if (rows.length && !products.length) {
    throw new Error("Warehouse product import returned rows, but no product had a readable price field.");
  }

  return mergeWarehouseInventory(products, req);
}

async function fetchWebsiteProducts(req) {
  const websiteProductsUrl = configuredWebsiteProductsUrl(req);
  if (!websiteProductsUrl) return null;

  if (isSelfReference(req, websiteProductsUrl, "/api/mobile/products")) {
    throw new Error("Website product import URL points back to this app. Set websiteProductsUrl in config.js or WEBSITE_PRODUCTS_URL in env to your real website products API URL.");
  }

  let data = null;
  let endpointUrl = websiteProductsUrl;
  let missingEndpointError = null;
  for (const candidate of productUrlCandidates(websiteProductsUrl)) {
    try {
      data = await fetchWebsiteJsonWithAuth(req, candidate, "Website product import");
      endpointUrl = candidate;
      break;
    } catch (error) {
      if (isMissingRemoteEndpoint(error)) {
        missingEndpointError = error;
        continue;
      }
      throw error;
    }
  }

  if (!data) {
    throw missingEndpointError || new Error("Website product import endpoint was not found");
  }

  const rows = arrayFromPayload(data, ["products", "items", "data", "results", "records", "nodes"]);
  const products = rows
    .map((item, index) => normalizeRemoteProduct(item, index, endpointUrl, "website"))
    .filter((product) => product.price > 0);

  if (rows.length && !products.length) {
    throw new Error("Website product import returned rows, but no product had a readable price field.");
  }

  return products;
}

async function fetchCatalogProducts(req) {
  const errors = [];
  let websiteConfigured = false;
  const websiteProductsUrl = configuredWebsiteProductsUrl(req);

  if (websiteProductsUrl) {
    websiteConfigured = true;
    try {
      const products = await fetchWebsiteProducts(req);
      return { source: "website", products: products || [] };
    } catch (error) {
      console.error("Website product import failed", error);
      errors.push(`Website: ${error.message}`);
    }
  }

  if (websiteConfigured && errors.length) {
    throw new Error(errors[0]);
  }

  if (process.env.WAREHOUSE_PRODUCTS_URL) {
    try {
      const products = await fetchWarehouseProducts(req);
      if (products && products.length) return { source: "warehouse", products };
    } catch (error) {
      console.error("Warehouse product import failed", error);
      errors.push(`Warehouse: ${error.message}`);
    }
  }

  if (appDatabaseEnabled()) {
    try {
      const dbProducts = await database.fetchProducts();
      if (dbProducts && dbProducts.length) {
        return {
          source: "database",
          products: dbProducts
        };
      }
    } catch (error) {
      console.error("Database product import failed", error);
      errors.push(`Database: ${error.message}`);
    }
  }

  if (errors.length && (process.env.WAREHOUSE_PRODUCTS_URL || websiteProductsUrl || appDatabaseEnabled())) {
    throw new Error(errors[0]);
  }

  return { source: "website_not_configured", products: [] };
}

async function warehouseInventoryDiagnostics(req) {
  const warehouse = {
    productsUrlSet: Boolean(process.env.WAREHOUSE_PRODUCTS_URL),
    inventoryUrlSet: Boolean(process.env.WAREHOUSE_INVENTORY_URL),
    productsUrl: safeUrlSummary(process.env.WAREHOUSE_PRODUCTS_URL),
    inventoryUrl: safeUrlSummary(process.env.WAREHOUSE_INVENTORY_URL)
  };

  if (process.env.WAREHOUSE_PRODUCTS_URL) {
    try {
      const products = await fetchWarehouseProducts(req);
      warehouse.productCount = products ? products.length : 0;
      warehouse.productSample = (products || []).slice(0, 5).map((product) => ({
        id: product.id,
        sourceId: product.sourceId,
        sku: product.sku,
        title: product.title,
        stock: product.stock,
        stockQuantity: product.stockQuantity
      }));
    } catch (error) {
      warehouse.productsError = error.message;
    }
  }

  if (process.env.WAREHOUSE_INVENTORY_URL) {
    try {
      const data = await fetchRemoteJson(
        process.env.WAREHOUSE_INVENTORY_URL,
        warehouseHeaders(),
        "Warehouse inventory import"
      );
      const rows = arrayFromPayload(data, ["inventory", "stocks", "stock", "items", "products", "data"]);
      warehouse.inventoryCount = rows.length;
      warehouse.inventorySample = rows.slice(0, 10).map((row) => ({
        keys: inventoryKeys(row),
        stockQuantity: inventoryQuantity(row),
        stock: stockStatusFromItem(row, inventoryQuantity(row))
      }));
    } catch (error) {
      warehouse.inventoryError = error.message;
    }
  }

  return warehouse;
}

async function handleProducts(req, res) {
  try {
    const catalog = await fetchCatalogProducts(req);
    return send(res, 200, catalog);
  } catch (error) {
    return send(res, 502, {
      message: `Product import failed: ${error.message}`
    });
  }
}

async function handleProductImage(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const src = url.searchParams.get("src") || "";
  if (!src) {
    send(res, 400, { message: "Image source is required" });
    return;
  }

  let directUrl = src;
  const gcs = parseGcsSource(src);

  try {
    if (!gcs) {
      const parsed = new URL(src);
      if (!allowedImageHost(parsed.hostname)) {
        return send(res, 403, { message: "Image host is not allowed" });
      }
      directUrl = parsed.toString();
    } else {
      directUrl = gcs.publicUrl;
    }

    let response;

    for (const candidate of gcs ? gcsPublicCandidates(gcs) : [directUrl]) {
      response = await fetchWithTimeout(candidate, {
        headers: { Accept: "image/*,*/*;q=0.8" }
      });
      if (response.ok) break;
    }

    if (!response.ok && gcs && googleStorageConfigured()) {
      const token = await googleAccessToken();
      const mediaUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(gcs.bucket)}/o/${encodeURIComponent(gcs.object)}?alt=media`;
      response = await fetchWithTimeout(mediaUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "image/*,*/*;q=0.8"
        }
      });
    }

    if (!response.ok) {
      throw new Error(`Image fetch failed with ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600"
    });
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error("Product image proxy failed", error.message);
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=120"
    });
    res.end(placeholderSvg("Warehouse image locked"));
  }
}

async function storeOrderAndPushWebsite(order, req) {
  const result = {
    orderId: order.orderId
  };
  const websiteOrdersUrl = configuredWebsiteOrdersUrl(req);

  if (appDatabaseEnabled()) {
    try {
      const dbResult = await database.insertOrder(order);
      if (dbResult) Object.assign(result, dbResult);
    } catch (error) {
      console.error("Database order insert failed", error);
      if (!websiteOrdersUrl) {
        throw error;
      }
      result.databaseError = error.message;
    }
  }

  if (!websiteOrdersUrl) {
    if (!result.storedInDatabase && process.env.DISABLE_LOCAL_ORDER_STORE !== "true") {
      const dataDir = path.join(rootDir, "data");
      fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(path.join(dataDir, "orders.jsonl"), `${JSON.stringify(order)}\n`);
      result.storedLocally = true;
    }
    return result;
  }

  if (req && isSelfReference(req, websiteOrdersUrl, "/api/mobile/orders")) {
    throw new Error("WEBSITE_ORDERS_URL points back to this app. Set DATABASE_URL or your real website orders API URL.");
  }

  if (isWebsiteOrderFormUrl(websiteOrdersUrl)) {
    return {
      ...result,
      websitePushed: true,
      website: await pushOrderToWebsiteForm(order, req, websiteOrdersUrl)
    };
  }

  const response = await fetchWithTimeout(websiteOrdersUrl, {
    method: "POST",
    headers: websiteHeaders({ "Content-Type": "application/json" }, req),
    body: JSON.stringify(order)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message || data.error || "Website order push failed");
  }
  return {
    ...result,
    websitePushed: true,
    website: data
  };
}

function isWebsiteOrderFormUrl(value) {
  try {
    const url = new URL(value);
    return !url.pathname.startsWith("/api/") || url.pathname === "/add-order";
  } catch (error) {
    return false;
  }
}

async function pushOrderToWebsiteForm(order, req, endpointUrl) {
  const submissions = [];
  const customer = order.customer || {};
  const items = order.items && order.items.length ? order.items : [];
  if (!items.length) throw new Error("Order has no items to push");

  const cookie = await websiteLoginCookie(req, endpointUrl);
  if (!cookie) throw new Error("Website login credentials are required for order push");

  for (const [index, item] of items.entries()) {
    const formResponse = await fetchWithTimeout(endpointUrl, {
      headers: {
        Accept: "text/html",
        Cookie: cookie
      }
    });
    const formHtml = await formResponse.text();
    if (!formResponse.ok) throw new Error(`Website order form failed with ${formResponse.status}`);

    const csrfToken = csrfTokenFromHtml(formHtml);
    if (!csrfToken) throw new Error("Website order form CSRF token was not found");

    const orderNumber = items.length > 1 ? `${order.orderId}-${index + 1}` : order.orderId;
    const body = new URLSearchParams({
      _csrf_token: csrfToken,
      order_number: orderNumber,
      customer_name: customer.name || "Customer",
      customer_phone: customer.phone || "",
      product_id: String(item.productId || item.sourceId || item.appProductId || item.id || ""),
      quantity: String(Math.max(1, Number(item.quantity || 1))),
      priority: "normal",
      assigned_to_id: "",
      customer_address: [
        customer.address || "",
        `Mobile order: ${order.orderId}`,
        `Item: ${item.title || item.productId || ""}`,
        `Payment: ${order.payment?.method || "cod"} / ${order.payment?.status || "pending"}`,
        `Amount: ${order.amounts?.currency || "INR"} ${order.amounts?.total || ""}`
      ].filter(Boolean).join("\n")
    });

    const response = await fetchWithTimeout(endpointUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie
      },
      body
    });
    const text = await response.text();
    if (![200, 302, 303].includes(response.status)) {
      const sample = text.replace(/\s+/g, " ").trim().slice(0, 180);
      throw new Error(`Website order form failed with ${response.status}${sample ? `: ${sample}` : ""}`);
    }
    if (response.status === 200 && /alert-danger|invalid|required|not found/i.test(text)) {
      const sample = text.replace(/\s+/g, " ").trim().slice(0, 180);
      throw new Error(`Website order form rejected item ${item.title || item.productId || index + 1}${sample ? `: ${sample}` : ""}`);
    }

    submissions.push({
      orderNumber,
      productId: String(item.productId || item.sourceId || item.appProductId || item.id || ""),
      quantity: Number(item.quantity || 1),
      status: response.status
    });
  }

  return {
    mode: "warehouse_form",
    endpoint: safeUrlSummary(endpointUrl),
    submitted: submissions.length,
    submissions
  };
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function orderCreatedDate(order) {
  return validDate(order.createdAt || order.created_at || order.orderDate || order.date || order.created) || new Date();
}

function orderEstimatedDeliveryDate(order, tracking = {}) {
  const createdAt = orderCreatedDate(order);
  return validDate(
    order.estimatedDeliveryAt ||
      order.estimatedDeliveryDate ||
      order.deliveryDate ||
      order.eta ||
      order.deliveryEstimate?.estimatedDeliveryAt ||
      tracking.estimatedDeliveryAt ||
      tracking.estimatedDeliveryDate ||
      tracking.eta
  ) || addDays(createdAt, deliveryEstimateDays);
}

function trackingStage(status) {
  const normalized = String(status || "placed").toLowerCase().replace(/[\s-]+/g, "_");
  if (/delivered|complete/.test(normalized)) return "delivered";
  if (/out_for_delivery|in_transit|transit|dispatch|on_the_way/.test(normalized)) return "in_transit";
  if (/shipped|picked|packed|ready_to_ship|warehouse_picked/.test(normalized)) return "shipped";
  return "placed";
}

function orderTrackingId(order = {}) {
  const direct = firstPresent(order, [
    "orderId",
    "order_id",
    "orderNumber",
    "order_number",
    "number",
    "id",
    "reference",
    "referenceId",
    "txnid"
  ]);
  if (direct) return direct;

  const nested = firstPresent(order, ["order", "details", "payload"]);
  if (nested && typeof nested === "object") return orderTrackingId(nested);
  return null;
}

function trackingAwbNumber(source = {}) {
  const sources = [
    source,
    source.tracking,
    source.shipment,
    source.delivery,
    source.fulfillment,
    source.courier,
    source.logistics
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));

  for (const item of sources) {
    const value = firstPresent(item, [
      "awb",
      "awbNo",
      "awb_no",
      "awbNumber",
      "awb_number",
      "airwayBill",
      "airway_bill",
      "waybill",
      "waybillNo",
      "waybill_no",
      "waybillNumber",
      "waybill_number",
      "trackingNumber",
      "tracking_number",
      "trackingId",
      "tracking_id",
      "consignmentNo",
      "consignment_no",
      "consignmentNumber",
      "consignment_number"
    ]);
    if (value) return String(value).trim();
  }

  return "";
}

function normalizeTrackingStep(step = {}) {
  const status = firstPresent(step, ["status", "key", "stage", "state", "name", "label", "title"]);
  const label = firstPresent(step, ["label", "title", "name", "status", "stage"]) || "Order update";
  const activity = firstPresent(step, [
    "activity",
    "message",
    "description",
    "event",
    "eventDescription",
    "event_description",
    "statusDescription",
    "status_description",
    "scan",
    "remarks",
    "remark",
    "details"
  ]) || label;
  return {
    key: trackingStage(status),
    label,
    activity,
    status: status || "",
    location: firstPresent(step, [
      "location",
      "scanLocation",
      "scan_location",
      "city",
      "hub",
      "facility",
      "branch",
      "place",
      "currentLocation",
      "current_location"
    ]) || "",
    done: firstPresent(step, ["done", "completed", "isDone", "is_done", "success"]) === false ? false : Boolean(
      firstPresent(step, ["done", "completed", "isDone", "is_done", "completedAt", "completed_at", "date", "updatedAt", "updated_at"])
    ),
    date: firstPresent(step, ["date", "createdAt", "created_at", "completedAt", "completed_at", "updatedAt", "updated_at", "time", "timestamp"]) || ""
  };
}

function trackingStepsFromPayload(source = {}) {
  const rawSteps = firstPresent(source, ["steps", "events", "history", "timeline", "updates", "trackingUpdates"]);
  if (!Array.isArray(rawSteps)) return null;
  return rawSteps.map(normalizeTrackingStep).filter((step) => step.label || step.status);
}

function normalizeWarehouseTracking(payload, orderId, awbNumber = "") {
  if (!payload || typeof payload !== "object") return null;

  const rows = arrayFromPayload(payload, ["orders", "items", "data", "results", "records", "tracking"]);
  let source = payload;
  if (rows.length) {
    const normalizedId = String(orderId || "").toLowerCase();
    const normalizedAwb = String(awbNumber || "").toLowerCase();
    source = rows.find((row) => {
      const rowId = orderTrackingId(row);
      const rowAwb = trackingAwbNumber(row);
      return (rowId && String(rowId).toLowerCase() === normalizedId) ||
        (rowAwb && String(rowAwb).toLowerCase() === normalizedAwb);
    }) || rows[0];
  }

  const nested = firstPresent(source, ["tracking", "shipment", "delivery", "fulfillment"]);
  const tracking = nested && typeof nested === "object" && !Array.isArray(nested)
    ? { ...source, ...nested }
    : source;
  const status = firstPresent(tracking, [
    "status",
    "trackingStatus",
    "tracking_status",
    "orderStatus",
    "order_status",
    "shipmentStatus",
    "shipment_status",
    "deliveryStatus",
    "delivery_status",
    "fulfillmentStatus",
    "fulfillment_status",
    "stage",
    "state"
  ]);
  const label = firstPresent(tracking, ["label", "statusLabel", "status_label", "message", "description", "title"]) || status;
  const steps = trackingStepsFromPayload(tracking);
  const resolvedAwbNumber = trackingAwbNumber(tracking) || trackingAwbNumber(source) || awbNumber;

  return {
    ...tracking,
    ...(status ? { status } : {}),
    ...(label ? { label } : {}),
    ...(resolvedAwbNumber ? { awbNumber: resolvedAwbNumber } : {}),
    ...(steps?.length ? { steps, timeline: steps } : {})
  };
}

function firstDate(...values) {
  for (const value of values) {
    const date = validDate(value);
    if (date) return date;
  }
  return null;
}

function trackingSteps(status, order = {}, tracking = {}) {
  const createdAt = orderCreatedDate(order);
  const estimatedAt = orderEstimatedDeliveryDate(order, tracking);
  const active = trackingStage(status);
  const stageIndex = {
    placed: 0,
    shipped: 1,
    in_transit: 2,
    delivered: 3
  };
  const activeIndex = stageIndex[active] || 0;

  return [
    {
      key: "placed",
      label: "Order Placed",
      done: true,
      date: createdAt.toISOString()
    },
    {
      key: "shipped",
      label: "Shipped",
      done: activeIndex >= 1,
      date: (firstDate(tracking.shippedAt, tracking.shipped_at, order.shippedAt, order.shipped_at) || addDays(createdAt, 2)).toISOString()
    },
    {
      key: "in_transit",
      label: "In Transit",
      done: activeIndex >= 2,
      date: (firstDate(
        tracking.inTransitAt,
        tracking.in_transit_at,
        tracking.outForDeliveryAt,
        tracking.out_for_delivery_at,
        order.inTransitAt,
        order.in_transit_at,
        order.outForDeliveryAt,
        order.out_for_delivery_at
      ) || addDays(createdAt, 4)).toISOString()
    },
    {
      key: "delivered",
      label: "Delivered",
      done: activeIndex >= 3,
      date: (firstDate(tracking.deliveredAt, tracking.delivered_at, order.deliveredAt, order.delivered_at) || estimatedAt).toISOString()
    }
  ];
}

async function pushOrderToWarehouse(order) {
  if (!process.env.WAREHOUSE_ORDERS_URL) return null;

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (process.env.WAREHOUSE_API_TOKEN) headers.Authorization = process.env.WAREHOUSE_API_TOKEN;

  const response = await fetchWithTimeout(process.env.WAREHOUSE_ORDERS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(order)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.message || data.error || "Warehouse order push failed");
  return data;
}

async function fetchTrackingFromEndpoint(endpoint, headers, order, label) {
  const orderId = orderTrackingId(order);
  const awbNumber = trackingAwbNumber(order);
  if (!orderId && !awbNumber) return null;

  const encodedId = encodeURIComponent(String(orderId || ""));
  const encodedAwb = encodeURIComponent(String(awbNumber || ""));
  const resolvedEndpoint = endpoint
    .replace(/\{orderId\}/g, encodedId)
    .replace(/:orderId\b/g, encodedId)
    .replace(/\{awb\}/g, encodedAwb)
    .replace(/:awb\b/g, encodedAwb);
  const url = new URL(resolvedEndpoint);
  if (orderId) {
    url.searchParams.set("orderId", orderId);
    url.searchParams.set("order_id", orderId);
  }
  if (awbNumber) {
    url.searchParams.set("awb", awbNumber);
    url.searchParams.set("awb_number", awbNumber);
  }

  const response = await fetchWithTimeout(url.toString(), { headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.message || data.error || `${label} failed`);
  return normalizeWarehouseTracking(data, orderId, awbNumber);
}

async function fetchWebsiteTracking(req, order) {
  const endpoint = process.env.WEBSITE_TRACKING_URL || process.env.WEBSITE_ORDER_TRACKING_URL || "";
  if (!endpoint) return null;
  if (req && isSelfReference(req, endpoint, "/api/mobile/orders")) return null;

  const headers = await websiteRequestHeaders(req, endpoint);
  return fetchTrackingFromEndpoint(endpoint, headers, order, "Website tracking");
}

async function fetchWarehouseTracking(order) {
  if (!process.env.WAREHOUSE_TRACKING_URL) return null;
  return fetchTrackingFromEndpoint(process.env.WAREHOUSE_TRACKING_URL, warehouseHeaders(), order, "Warehouse tracking");
}

async function fetchLiveTracking(req, order) {
  const merged = {};
  const errors = [];

  try {
    const websiteTracking = await fetchWebsiteTracking(req, order);
    if (websiteTracking) Object.assign(merged, websiteTracking);
  } catch (error) {
    errors.push(error.message);
  }

  try {
    const warehouseTracking = await fetchWarehouseTracking(order);
    if (warehouseTracking) Object.assign(merged, warehouseTracking);
  } catch (error) {
    errors.push(error.message);
  }

  return {
    tracking: Object.keys(merged).length ? merged : null,
    error: errors.filter(Boolean).join("; ")
  };
}

async function fetchWebsiteCustomerOrders(req, phone) {
  const endpoint = process.env.WEBSITE_CUSTOMER_ORDERS_URL || process.env.WEBSITE_ORDERS_URL;
  if (!endpoint) return [];
  if (req && isSelfReference(req, endpoint, "/api/mobile/orders")) return [];

  const url = new URL(endpoint);
  url.searchParams.set("phone", phone);

  const data = await fetchRemoteJson(
    url.toString(),
    websiteHeaders({}, req),
    "Website orders import"
  );

  return arrayFromPayload(data, ["orders", "items", "data"]);
}

async function postOrderCancel(endpoint, headers, body, label) {
  if (!endpoint) return null;

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { raw: text };
  }
  if (!response.ok) throw new Error(data.message || data.error || `${label} failed`);
  return data;
}

function orderItemsForRequest(order = {}) {
  const rows = Array.isArray(order.items) && order.items.length
    ? order.items
    : arrayFromPayload(order, ["items", "products", "lineItems", "line_items", "orderItems", "order_items"]);

  return rows.map((item, index) => {
    const price = numericValue(firstPresent(item, ["price", "sellingPrice", "selling_price", "amount", "unitPrice", "unit_price", "rate"])) || 0;
    const quantity = numericValue(firstPresent(item, ["quantity", "qty", "count"])) || 1;
    const ean = firstPresent(item, ["ean", "EAN", "barcode", "barCode", "bar_code", "upc", "isbn", "sku", "productSku", "product_sku"]);

    return {
      productId: firstPresent(item, ["productId", "product_id", "sourceId", "source_id", "appProductId", "app_product_id", "id", "sku"]) || "",
      appProductId: firstPresent(item, ["appProductId", "app_product_id", "id"]) || "",
      title: firstPresent(item, ["title", "name", "productName", "product_name"]) || `Item ${index + 1}`,
      sku: firstPresent(item, ["sku", "productSku", "product_sku"]) || "",
      ean: ean ? String(ean) : "",
      price,
      quantity,
      total: numericValue(firstPresent(item, ["total", "lineTotal", "line_total", "amountTotal", "amount_total"])) || price * quantity
    };
  });
}

function orderCustomerForRequest(order = {}, user = null) {
  const customer = firstPresent(order, ["customer", "billing", "shipping", "user"]) || {};
  const addressParts = customer.addressParts || customer.location || {};
  const address = firstPresent(customer, ["address", "fullAddress", "full_address", "customerAddress", "customer_address"]) || [
    addressParts.address1,
    addressParts.address2,
    addressParts.city,
    addressParts.state,
    addressParts.pincode
  ].filter(Boolean).join(", ");

  return {
    id: firstPresent(customer, ["id", "customerId", "customer_id"]) || user?.id || "",
    name: firstPresent(customer, ["name", "customerName", "customer_name", "fullName", "full_name"]) || user?.name || "Customer",
    phone: phoneDigits(firstPresent(customer, ["phone", "mobile", "customerPhone", "customer_phone"]) || user?.phone || ""),
    address,
    location: customer.location || null
  };
}

function orderAmountsForRequest(order = {}) {
  const amounts = order.amounts || {};
  const items = orderItemsForRequest(order);
  const subtotal = numericValue(firstPresent(amounts, ["subtotal", "subTotal", "itemsTotal", "items_total"])) ||
    items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const delivery = numericValue(firstPresent(amounts, ["delivery", "deliveryFee", "delivery_fee", "shipping", "shippingFee", "shipping_fee"])) ||
    numericValue(order.delivery?.fee) ||
    0;
  const platformFee = numericValue(firstPresent(amounts, ["platformFee", "platform_fee", "serviceFee", "service_fee"])) || 0;
  const total = numericValue(firstPresent(amounts, ["total", "grandTotal", "grand_total", "amountTotal", "amount_total"])) ||
    numericValue(order.amountTotal) ||
    subtotal + delivery + platformFee;

  return {
    currency: amounts.currency || order.currency || "INR",
    subtotal,
    delivery,
    platformFee,
    total
  };
}

function orderDeliveredAt(order = {}, tracking = {}) {
  const direct = firstDate(
    tracking.deliveredAt,
    tracking.delivered_at,
    tracking.deliveryDate,
    tracking.delivery_date,
    order.deliveredAt,
    order.delivered_at,
    order.deliveryDate,
    order.delivery_date,
    order.delivery?.deliveredAt,
    order.delivery?.delivered_at
  );
  if (direct) return direct;

  const steps = [
    ...(Array.isArray(tracking.steps) ? tracking.steps : []),
    ...(Array.isArray(tracking.timeline) ? tracking.timeline : []),
    ...(Array.isArray(order.tracking?.steps) ? order.tracking.steps : [])
  ];
  const deliveredStep = steps.find((step) => trackingStage(firstPresent(step, ["key", "status", "stage", "label", "title"])) === "delivered");
  return firstDate(
    deliveredStep?.date,
    deliveredStep?.createdAt,
    deliveredStep?.created_at,
    deliveredStep?.completedAt,
    deliveredStep?.completed_at,
    deliveredStep?.updatedAt,
    deliveredStep?.updated_at,
    tracking.updatedAt,
    tracking.updated_at,
    order.updatedAt,
    order.updated_at
  );
}

function buildOrderActionRequest(type, order, user, details = {}, tracking = {}) {
  const orderId = String(orderTrackingId(order) || details.orderId || "").trim();
  const awbNumber = tracking.awbNumber || trackingAwbNumber(tracking) || trackingAwbNumber(order) || "";
  const items = orderItemsForRequest(order);
  const deliveredAt = orderDeliveredAt(order, tracking);

  return {
    requestId: `${type.toUpperCase()}-${Date.now()}`,
    requestType: type,
    orderId,
    order_id: orderId,
    awbNumber,
    awb: awbNumber,
    status: `${type}_requested`,
    reason: details.reason || "",
    note: details.note || details.details || "",
    source: "mobile_app",
    requestedAt: new Date().toISOString(),
    deliveredAt: deliveredAt ? deliveredAt.toISOString() : "",
    customer: orderCustomerForRequest(order, user),
    items,
    itemCount: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    amounts: orderAmountsForRequest(order),
    payment: order.payment || {
      method: order.paymentMethod || "",
      status: order.paymentStatus || ""
    },
    delivery: order.delivery || null,
    tracking: {
      ...tracking,
      awbNumber
    },
    orderSnapshot: order
  };
}

function appendOrderActionRequest(type, payload) {
  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(path.join(dataDir, `order-${type}-requests.jsonl`), `${JSON.stringify(payload)}\n`);
}

async function handleOrderCancel(req, res) {
  const user = verifyToken(req);
  if (!user) return send(res, 401, { message: "Login required" });

  const body = await readBody(req);
  const orderId = String(body.orderId || body.order_id || "").trim();
  const reason = String(body.reason || "Customer requested cancellation").trim();
  if (!orderId) return send(res, 400, { message: "Order id is required" });

  let orders = [];
  try {
    orders = await fetchWebsiteCustomerOrders(req, user.phone);
  } catch (error) {
    console.error("Website orders import failed before cancel", error.message);
  }

  if (!orders.length && appDatabaseEnabled()) {
    orders = (await database.fetchCustomerOrders(user.phone)) || [];
  }

  let order = orders.find((item) => String(orderTrackingId(item) || "") === orderId);
  if (!order && body.order && String(orderTrackingId(body.order) || "") === orderId) {
    order = body.order;
  }
  if (!order) return send(res, 404, { message: "Order not found" });

  let tracking = order.tracking || { status: order.status || "placed" };
  const liveTracking = await fetchLiveTracking(req, order);
  if (liveTracking.tracking) tracking = { ...tracking, ...liveTracking.tracking };
  if (liveTracking.error) tracking = { ...tracking, error: liveTracking.error };

  const stage = trackingStage([
    tracking.status,
    tracking.label,
    order.status,
    order.fulfillmentStatus,
    order.shippingStatus
  ].filter(Boolean).join(" "));
  if (stage !== "placed") {
    return send(res, 409, { message: "Cancel unavailable after order is shipped or out for delivery" });
  }

  const cancelBody = buildOrderActionRequest("cancel", order, user, { reason }, tracking);
  appendOrderActionRequest("cancel", cancelBody);
  const results = {};

  try {
    const websiteCancelUrl = process.env.WEBSITE_CANCEL_ORDER_URL || process.env.WEBSITE_ORDER_CANCEL_URL || "";
    const warehouseCancelUrl = process.env.WAREHOUSE_CANCEL_ORDER_URL || process.env.WAREHOUSE_ORDER_CANCEL_URL || "";
    const websiteCancelHeaders = websiteCancelUrl ? await websiteRequestHeaders(req, websiteCancelUrl) : {};

    const [website, warehouse] = await Promise.all([
      postOrderCancel(websiteCancelUrl, websiteCancelHeaders, cancelBody, "Website cancel request"),
      postOrderCancel(warehouseCancelUrl, warehouseHeaders(), cancelBody, "Warehouse cancel request")
    ]);
    if (website) results.website = website;
    if (warehouse) results.warehouse = warehouse;
  } catch (error) {
    return send(res, 502, { message: error.message });
  }

  let databaseResult = null;
  if (appDatabaseEnabled()) {
    try {
      databaseResult = await database.updateOrderStatus(orderId, "cancel_requested");
    } catch (error) {
      console.error("Database cancel status update failed", error.message);
    }
  }

  send(res, 200, {
    cancelled: true,
    orderId,
    status: "cancel_requested",
    localOnly: !results.website && !results.warehouse,
    database: databaseResult,
    ...results
  });
}

async function handleOrderReturn(req, res) {
  const user = verifyToken(req);
  if (!user) return send(res, 401, { message: "Login required" });

  const body = await readBody(req);
  const orderId = String(body.orderId || body.order_id || "").trim();
  const reason = String(body.reason || "").trim();
  const note = String(body.note || body.details || "").trim();
  if (!orderId) return send(res, 400, { message: "Order id is required" });
  if (reason.length < 3) return send(res, 400, { message: "Return reason is required" });

  let orders = [];
  try {
    orders = await fetchWebsiteCustomerOrders(req, user.phone);
  } catch (error) {
    console.error("Website orders import failed before return", error.message);
  }

  if (!orders.length && appDatabaseEnabled()) {
    orders = (await database.fetchCustomerOrders(user.phone)) || [];
  }

  let order = orders.find((item) => String(orderTrackingId(item) || "") === orderId);
  if (!order && body.order && String(orderTrackingId(body.order) || "") === orderId) {
    order = body.order;
  }
  if (!order) return send(res, 404, { message: "Order not found" });

  let tracking = order.tracking || { status: order.status || "placed" };
  const liveTracking = await fetchLiveTracking(req, order);
  if (liveTracking.tracking) tracking = { ...tracking, ...liveTracking.tracking };
  if (liveTracking.error) tracking = { ...tracking, error: liveTracking.error };

  const deliveredStep = [
    ...(Array.isArray(tracking.steps) ? tracking.steps : []),
    ...(Array.isArray(tracking.timeline) ? tracking.timeline : []),
    ...(Array.isArray(order.tracking?.steps) ? order.tracking.steps : [])
  ].some((step) => {
    if (step.done === false || step.completed === false || step.isDone === false || step.is_done === false) return false;
    return trackingStage(firstPresent(step, ["key", "status", "stage", "label", "title"])) === "delivered";
  });
  const stage = trackingStage([
    tracking.status,
    tracking.label,
    order.status,
    order.fulfillmentStatus,
    order.shippingStatus
  ].filter(Boolean).join(" "));
  if (stage !== "delivered" && !deliveredStep) {
    return send(res, 409, { message: "Return is available only after delivery" });
  }

  const deliveredAt = orderDeliveredAt(order, tracking) || new Date();
  const returnAvailableUntil = addDays(deliveredAt, 7);
  if (Date.now() > returnAvailableUntil.getTime()) {
    return send(res, 409, { message: "Return window expired after 7 days" });
  }

  const returnBody = buildOrderActionRequest("return", order, user, { reason, note }, tracking);
  returnBody.returnWindowDays = 7;
  returnBody.returnAvailableUntil = returnAvailableUntil.toISOString();
  appendOrderActionRequest("return", returnBody);
  const results = {};

  try {
    const websiteReturnUrl = process.env.WEBSITE_RETURN_ORDER_URL || process.env.WEBSITE_ORDER_RETURN_URL || "";
    const warehouseReturnUrl = process.env.WAREHOUSE_RETURN_ORDER_URL || process.env.WAREHOUSE_ORDER_RETURN_URL || "";
    const websiteReturnHeaders = websiteReturnUrl ? await websiteRequestHeaders(req, websiteReturnUrl) : {};

    const [website, warehouse] = await Promise.all([
      postOrderCancel(websiteReturnUrl, websiteReturnHeaders, returnBody, "Website return request"),
      postOrderCancel(warehouseReturnUrl, warehouseHeaders(), returnBody, "Warehouse return request")
    ]);
    if (website) results.website = website;
    if (warehouse) results.warehouse = warehouse;
  } catch (error) {
    return send(res, 502, { message: error.message });
  }

  let databaseResult = null;
  if (appDatabaseEnabled()) {
    try {
      databaseResult = await database.updateOrderStatus(orderId, "return_requested");
    } catch (error) {
      console.error("Database return status update failed", error.message);
    }
  }

  send(res, 200, {
    returnRequested: true,
    orderId,
    status: "return_requested",
    reason,
    localOnly: !results.website && !results.warehouse,
    database: databaseResult,
    ...results
  });
}

async function persistAndPushOrder(order, req) {
  const result = await storeOrderAndPushWebsite(order, req);
  try {
    const warehouse = await pushOrderToWarehouse(order);
    return {
      ...result,
      warehousePushed: Boolean(warehouse),
      warehouse
    };
  } catch (error) {
    console.error("Warehouse order push failed", error);
    return {
      ...result,
      warehousePushed: false,
      warehouseError: error.message
    };
  }
}

async function validateOrderInventory(order, req) {
  try {
    const catalog = await fetchCatalogProducts(req);
    const products = catalog.products || [];
    if (!products.length) return null;

    const byId = new Map();
    products.forEach((product) => {
      byId.set(String(product.id), product);
      if (product.sourceId !== null && product.sourceId !== undefined) byId.set(String(product.sourceId), product);
      if (product.sku !== null && product.sku !== undefined) byId.set(String(product.sku), product);
    });

    for (const item of order.items || []) {
      const product = byId.get(String(item.productId)) || byId.get(String(item.appProductId));
      if (!product) continue;

      const quantity = Number(product.stockQuantity);
      const status = String(product.stock || "").toLowerCase();
      if (Number.isFinite(quantity) && quantity <= 0) {
        return `${product.title} is out of stock`;
      }
      if (["out_of_stock", "out of stock", "sold_out", "sold out", "unavailable"].includes(status)) {
        return `${product.title} is out of stock`;
      }
      if (Number.isFinite(quantity) && Number(item.quantity || 0) > quantity) {
        return `Only ${quantity} ${product.title} available in warehouse`;
      }
    }
  } catch (error) {
    console.error("Inventory validation skipped", error.message);
    if (configuredWebsiteProductsUrl(req) || process.env.WAREHOUSE_PRODUCTS_URL || process.env.WAREHOUSE_INVENTORY_URL || appDatabaseEnabled()) {
      return "Warehouse inventory is not available right now. Please try again.";
    }
  }

  return null;
}

async function handleOrder(req, res) {
  const user = verifyToken(req);
  if (!user && process.env.ALLOW_UNAUTHENTICATED_ORDERS !== "true") {
    return send(res, 401, { message: "Login required" });
  }

  const order = await readBody(req);
  if (!Array.isArray(order.items) || !order.items.length) {
    return send(res, 400, { message: "Order items are required" });
  }

  const inventoryError = await validateOrderInventory(order, req);
  if (inventoryError) {
    return send(res, 409, { message: inventoryError });
  }

  const createdAt = orderCreatedDate(order);
  const estimatedDeliveryAt = orderEstimatedDeliveryDate(order);
  const response = await persistAndPushOrder({
    ...order,
    createdAt: (validDate(order.createdAt) || createdAt).toISOString(),
    estimatedDeliveryAt: estimatedDeliveryAt.toISOString(),
    deliveryEstimate: {
      days: order.deliveryEstimate?.days || deliveryEstimateDays,
      estimatedDeliveryAt: estimatedDeliveryAt.toISOString()
    },
    verifiedCustomer: user || null
  }, req);
  send(res, 200, response);
}

async function handleCustomerOrders(req, res) {
  const user = verifyToken(req);
  if (!user) return send(res, 401, { message: "Login required" });

  let orders = [];
  try {
    orders = await fetchWebsiteCustomerOrders(req, user.phone);
  } catch (error) {
    console.error("Website orders import failed", error.message);
  }

  if (!orders.length && appDatabaseEnabled()) {
    orders = (await database.fetchCustomerOrders(user.phone)) || [];
  }

  const enriched = [];

  for (const order of orders) {
    let tracking = order.tracking || {
      status: order.status || "placed",
      label: order.status || "Order placed"
    };

    const liveTracking = await fetchLiveTracking(req, order);
    if (liveTracking.tracking) tracking = { ...tracking, ...liveTracking.tracking };
    if (liveTracking.error) tracking = { ...tracking, error: liveTracking.error };

    const estimatedAt = orderEstimatedDeliveryDate(order, tracking);
    const status = tracking.status || order.status || "placed";

    enriched.push({
      ...order,
      estimatedDeliveryAt: estimatedAt.toISOString(),
      deliveryEstimate: {
        ...(order.deliveryEstimate || {}),
        days: order.deliveryEstimate?.days || tracking.estimatedDays || deliveryEstimateDays,
        estimatedDeliveryAt: estimatedAt.toISOString()
      },
      tracking: {
        ...tracking,
        awbNumber: tracking.awbNumber || trackingAwbNumber(tracking) || trackingAwbNumber(order) || "",
        estimatedDays: tracking.estimatedDays || deliveryEstimateDays,
        estimatedDeliveryAt: estimatedAt.toISOString(),
        steps: tracking.steps || trackingSteps(status, order, tracking)
      }
    });
  }

  send(res, 200, { orders: enriched });
}

function payuAmount(value) {
  return (Number(value || 0)).toFixed(2);
}

function payuHash(fields) {
  const salt = process.env.PAYU_SALT;
  if (!salt) throw new Error("PAYU_SALT is missing");
  const hashString = [
    fields.key,
    fields.txnid,
    fields.amount,
    fields.productinfo,
    fields.firstname,
    fields.email,
    fields.udf1 || "",
    fields.udf2 || "",
    fields.udf3 || "",
    fields.udf4 || "",
    fields.udf5 || ""
  ].join("|") + "||||||" + salt;
  return crypto.createHash("sha512").update(hashString).digest("hex").toLowerCase();
}

function payuReverseHash(fields) {
  const salt = process.env.PAYU_SALT;
  const hashString = [
    salt,
    fields.status || "",
    "",
    "",
    "",
    "",
    "",
    fields.udf5 || "",
    fields.udf4 || "",
    fields.udf3 || "",
    fields.udf2 || "",
    fields.udf1 || "",
    fields.email || "",
    fields.firstname || "",
    fields.productinfo || "",
    fields.amount || "",
    fields.txnid || "",
    fields.key || ""
  ].join("|");
  return crypto.createHash("sha512").update(hashString).digest("hex").toLowerCase();
}

function payuUrl() {
  if (process.env.PAYU_ENV === "production") return "https://secure.payu.in/_payment";
  return "https://test.payu.in/_payment";
}

function payuPostServiceUrl() {
  if (process.env.PAYU_ENV === "production") return "https://secure.payu.in/merchant/postservice.php?form=2";
  return "https://test.payu.in/merchant/postservice.php?form=2";
}

function payuCommandHash(command, var1) {
  const key = process.env.PAYU_KEY;
  const salt = process.env.PAYU_SALT;
  if (!key || !salt) throw new Error("PAYU_KEY or PAYU_SALT is missing");
  return crypto.createHash("sha512").update([key, command, var1, salt].join("|")).digest("hex").toLowerCase();
}

async function payuPostCommand(command, var1) {
  const body = new URLSearchParams({
    key: process.env.PAYU_KEY,
    command,
    var1,
    hash: payuCommandHash(command, var1)
  });
  const response = await fetchWithTimeout(payuPostServiceUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`PayU verify API returned non-JSON response: ${text.slice(0, 120)}`);
  }

  if (!response.ok) {
    throw new Error(data.msg || data.message || data.error || `PayU verify API failed with ${response.status}`);
  }

  return data;
}

function payuTransactionFromVerification(data, fields) {
  const details = data?.transaction_details || data?.transactionDetails || data?.details || data?.data;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return details[fields.txnid] || details[fields.mihpayid] || Object.values(details)[0] || details;
  }
  return data;
}

function payuVerificationSucceeded(data, fields) {
  if (!data || typeof data !== "object") return false;
  const transaction = payuTransactionFromVerification(data, fields);
  const status = String(transaction?.status || data.status || "").toLowerCase();
  const unmapped = String(transaction?.unmappedstatus || transaction?.unmapped_status || "").toLowerCase();
  const paymentId = String(transaction?.mihpayid || transaction?.payuMoneyId || fields.mihpayid || "");
  return (
    (data.status === 1 || data.status === "1" || status === "success") &&
    (status === "success" || unmapped === "captured" || unmapped === "auth" || Boolean(paymentId))
  );
}

async function verifyPayuTransaction(fields) {
  const attempts = [];
  if (fields.txnid) attempts.push(["verify_payment", fields.txnid]);
  if (fields.mihpayid) attempts.push(["check_payment", fields.mihpayid]);

  let lastError = null;
  for (const [command, var1] of attempts) {
    try {
      const data = await payuPostCommand(command, var1);
      if (payuVerificationSucceeded(data, fields)) {
        return {
          verified: true,
          command,
          data,
          transaction: payuTransactionFromVerification(data, fields)
        };
      }
      lastError = new Error(data.msg || data.message || `PayU ${command} did not confirm payment`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("PayU transaction verification failed");
}

async function handlePaymentCreate(req, res) {
  const user = verifyToken(req);
  if (!user && process.env.ALLOW_UNAUTHENTICATED_ORDERS !== "true") {
    return send(res, 401, { message: "Login required" });
  }

  const order = await readBody(req);
  if (!process.env.PAYU_KEY || !process.env.PAYU_SALT) {
    return send(res, 503, { message: "PayU env vars are missing" });
  }

  const inventoryError = await validateOrderInventory(order, req);
  if (inventoryError) {
    return send(res, 409, { message: inventoryError });
  }

  const origin = publicOrigin(req);
  const txnid = `EV${Date.now()}${crypto.randomBytes(3).toString("hex")}`;
  const fields = {
    key: process.env.PAYU_KEY,
    txnid,
    amount: payuAmount(order.amounts?.total),
    productinfo: `Ev Speare Order ${order.orderId || txnid}`,
    firstname: order.customer?.name || "Customer",
    email: order.customer?.email || process.env.DEFAULT_CUSTOMER_EMAIL || "customer@example.com",
    phone: phoneDigits(order.customer?.phone),
    surl: `${origin}/payment/payu/success`,
    furl: `${origin}/payment/payu/failure`,
    udf1: order.orderId || "",
    udf2: order.customer?.phone || "",
    udf3: "mobile_pwa",
    udf4: "",
    udf5: ""
  };
  fields.hash = payuHash(fields);

  savePendingPayuOrder(txnid, {
    ...order,
    orderId: order.orderId || txnid,
    payment: {
      method: "online",
      gateway: "payu",
      status: "initiated",
      txnid
    },
    status: "payment_initiated",
    verifiedCustomer: user || null
  });

  send(res, 200, {
    gateway: "payu",
    redirect: true,
    method: "POST",
    action: payuUrl(),
    fields
  });
}

async function handlePaymentVerify(req, res) {
  const body = await readBody(req);
  const expected = payuReverseHash(body);
  const verified = Boolean(body.hash && expected === String(body.hash).toLowerCase());
  send(res, verified ? 200 : 400, { verified });
}

async function handlePayuCallback(req, res, success) {
  const fields = await readBody(req);
  const expected = payuReverseHash(fields);
  const verified = Boolean(fields.hash && expected === String(fields.hash).toLowerCase());
  const pendingOrder = loadPendingPayuOrder(fields.txnid);

  if (!verified || !success || fields.status !== "success" || !pendingOrder) {
    return sendHtml(
      res,
      paymentResultHtml("Payment failed", "Your payment could not be verified.", "/?payment=failure"),
      400
    );
  }

  let payuVerification;
  try {
    payuVerification = await verifyPayuTransaction(fields);
  } catch (error) {
    console.error("PayU verify API failed", error.message);
    return sendHtml(
      res,
      paymentResultHtml("Payment failed", "PayU could not confirm this transaction.", "/?payment=failure"),
      400
    );
  }

  const order = {
    ...pendingOrder,
    payment: {
      method: "online",
      gateway: "payu",
      status: "paid",
      txnid: fields.txnid,
      mihpayid: fields.mihpayid || payuVerification.transaction?.mihpayid,
      mode: fields.mode || payuVerification.transaction?.mode,
      verifyCommand: payuVerification.command,
      verified: true
    },
    status: "paid"
  };

  try {
    await persistAndPushOrder(order, req);
    deletePendingPayuOrder(fields.txnid);
    return sendHtml(
      res,
      paymentResultHtml("Payment successful", "Your order has been placed.", `/?payment=success&orderId=${encodeURIComponent(order.orderId)}`)
    );
  } catch (error) {
    return sendHtml(
      res,
      paymentResultHtml("Payment captured", "Payment succeeded, but order push failed. Check Railway logs.", "/?payment=order-push-failed"),
      500
    );
  }
}

function paymentResultHtml(title, message, redirectPath) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta http-equiv="refresh" content="3;url=${redirectPath}" />
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui;background:#f2f5f9;color:#172033}
      main{width:min(92vw,420px);background:white;border-radius:14px;padding:24px;box-shadow:0 10px 30px rgba(20,32,55,.14)}
      h1{margin:0 0 8px;font-size:1.4rem}p{margin:0 0 18px;color:#627086}a{color:#2874f0;font-weight:800}
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
      <a href="${redirectPath}">Back to app</a>
    </main>
  </body>
</html>`;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/config.js") {
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    const config = JSON.stringify(publicConfig(req), null, 2);
    res.end(`window.EVSPEARE_CONFIG = ${config};\nwindow.BAZAARGO_CONFIG = window.EVSPEARE_CONFIG;\n`);
    return;
  }

  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(rootDir, safePath);
  if (!filePath.startsWith(rootDir)) {
    send(res, 403, { message: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(rootDir, "index.html"), (indexError, indexData) => {
        if (indexError) send(res, 404, { message: "Not found" });
        else {
          res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
          res.end(indexData);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    res.end(data);
  });
}

async function router(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: "ev-speare",
        time: new Date().toISOString()
      });
    }

    if (req.method === "GET" && url.pathname === "/api/mobile/diagnostics") {
      return send(res, 200, publicDiagnostics(req));
    }

    if (req.method === "GET" && url.pathname === "/api/mobile/inventory-diagnostics") {
      const [db, warehouse] = await Promise.all([
        appDatabaseEnabled()
          ? database.inventoryDiagnostics().catch((error) => ({ error: error.message }))
          : Promise.resolve({ configured: database.status().configured, enabledForApp: false }),
        warehouseInventoryDiagnostics(req)
      ]);
      return send(res, 200, { database: db, warehouse });
    }

    if (req.method === "POST" && url.pathname === "/api/mobile/auth/request-otp") return handleRequestOtp(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/auth/verify-otp") return handleVerifyOtp(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/support") return handleSupportQuery(req, res);
    if (req.method === "GET" && url.pathname === "/api/mobile/products") return handleProducts(req, res);
    if (req.method === "GET" && url.pathname === "/api/mobile/images") return handleProductImage(req, res);
    if (req.method === "GET" && url.pathname === "/api/mobile/orders") return handleCustomerOrders(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/orders") return handleOrder(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/orders/cancel") return handleOrderCancel(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/orders/return") return handleOrderReturn(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/payments/create") return handlePaymentCreate(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/payments/verify") return handlePaymentVerify(req, res);
    if (req.method === "POST" && url.pathname === "/payment/payu/success") return handlePayuCallback(req, res, true);
    if (req.method === "POST" && url.pathname === "/payment/payu/failure") return handlePayuCallback(req, res, false);

    if (req.method === "GET") return serveStatic(req, res);
    send(res, 405, { message: "Method not allowed" });
  } catch (error) {
    console.error(error);
    send(res, 500, { message: error.message || "Server error" });
  }
}

function startServer(listenPort, label) {
  const server = http.createServer(router);
  server.on("error", (error) => {
    console.error(`Unable to bind ${label} port ${listenPort}:`, error.message);
  });
  server.listen(listenPort, "0.0.0.0", () => {
    console.log(`Ev Speare app running on 0.0.0.0:${listenPort} (${label})`);
  });
}

startServer(port, "primary");
if (port !== fallbackPort) {
  startServer(fallbackPort, "fallback");
}
