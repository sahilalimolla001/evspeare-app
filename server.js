const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { URLSearchParams } = require("url");
const Razorpay = require("razorpay");
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
const fastDeliveryEstimateDays = 1;
const codMaxOrderAmount = 1000;
const pendingRazorpayOrders = new Map();
const rateLimitBuckets = new Map();
const maxRequestBodyBytes = Number(process.env.MAX_REQUEST_BODY_BYTES || 256 * 1024);
const playStorePackageName = process.env.PLAY_STORE_PACKAGE_NAME || "com.evspeare.shop";
let googleAccessTokenCache = null;
let fcmAccessTokenCache = null;
let websiteLoginCache = null;
let appVersionCache = null;

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
  applySecurityHeaders(res);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function playStoreCertificateFingerprints() {
  return String(process.env.PLAY_STORE_SHA256_CERT_FINGERPRINT || "")
    .split(",")
    .map((fingerprint) => fingerprint.trim())
    .filter(Boolean);
}

function sendAssetLinks(req, res) {
  if (req.method !== "GET") {
    send(res, 405, { message: "Method not allowed" });
    return;
  }

  const fingerprints = playStoreCertificateFingerprints();
  if (fingerprints.length) {
    send(
      res,
      200,
      [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: playStorePackageName,
            sha256_cert_fingerprints: fingerprints
          }
        }
      ],
      { "Cache-Control": "public, max-age=3600" }
    );
    return;
  }

  const filePath = path.join(rootDir, ".well-known", "assetlinks.json");
  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, {
        message: "Set PLAY_STORE_SHA256_CERT_FINGERPRINT or add .well-known/assetlinks.json"
      });
      return;
    }

    applySecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": mimeTypes[".json"],
      "Cache-Control": "public, max-age=3600"
    });
    res.end(data);
  });
}

function securityHeaders() {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' https://checkout.razorpay.com https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://nominatim.openstreetmap.org https://api.razorpay.com",
    "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com",
    "upgrade-insecure-requests"
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=(self)",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off"
  };
}

function applySecurityHeaders(res) {
  Object.entries(securityHeaders()).forEach(([key, value]) => {
    if (!res.hasHeader(key)) res.setHeader(key, value);
  });
}

function currentAppVersion() {
  const envVersion =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    process.env.COMMIT_SHA;

  if (envVersion) return String(envVersion).slice(0, 12);
  if (appVersionCache) return appVersionCache;

  const versionFiles = ["index.html", "app.js", "styles.css", "api.js", "manifest.webmanifest", "sw.js"];
  const signature = versionFiles
    .map((file) => {
      try {
        const stats = fs.statSync(path.join(rootDir, file));
        return `${file}:${stats.mtimeMs}:${stats.size}`;
      } catch (error) {
        return `${file}:missing`;
      }
    })
    .join("|");

  appVersionCache = crypto.createHash("sha256").update(signature).digest("hex").slice(0, 12);
  return appVersionCache;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      body += chunk;
      if (Buffer.byteLength(body) > maxRequestBodyBytes) {
        rejected = true;
        const error = new Error("Request body too large");
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      if (rejected) return;
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
        const invalid = new Error("Invalid request body");
        invalid.statusCode = 400;
        reject(invalid);
      }
    });
    req.on("error", reject);
  });
}

function getOrigin(req) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const forwardedProtocol = req.headers["x-forwarded-proto"];
  const host = forwardedHost;
  if (forwardedProtocol) {
    const protocol = String(forwardedProtocol).split(",")[0].trim();
    return `${protocol}://${host}`;
  }

  const protocol = req.socket?.encrypted ? "https" : "http";
  return `${protocol}://${host}`;
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function sameOriginRequest(req) {
  const originHeader = req.headers.origin || req.headers.referer || "";
  if (!originHeader) return true;
  try {
    const requestOrigin = new URL(getOrigin(req));
    const submittedOrigin = new URL(originHeader);
    return requestOrigin.host === submittedOrigin.host && requestOrigin.protocol === submittedOrigin.protocol;
  } catch (error) {
    return false;
  }
}

function rateLimitRule(req, pathname) {
  if (!pathname.startsWith("/api/")) return null;
  if (pathname.includes("/auth/") || pathname.includes("/payments/")) return { windowMs: 60 * 1000, max: 12, name: "sensitive" };
  if (pathname.includes("/orders") || pathname.includes("/support") || pathname.includes("/coupons")) return { windowMs: 60 * 1000, max: 30, name: "write" };
  if (req.method === "GET") return { windowMs: 60 * 1000, max: 180, name: "read" };
  return { windowMs: 60 * 1000, max: 60, name: "api" };
}

function enforceRateLimit(req, res, pathname) {
  const rule = rateLimitRule(req, pathname);
  if (!rule) return false;
  const now = Date.now();
  const key = `${rule.name}:${clientIp(req)}:${pathname}`;
  const current = rateLimitBuckets.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + rule.windowMs };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  if (rateLimitBuckets.size > 2000) {
    for (const [bucketKey, value] of rateLimitBuckets.entries()) {
      if (value.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
  }

  if (bucket.count <= rule.max) return false;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  send(res, 429, { message: "Too many requests. Please try again shortly." }, { "Retry-After": String(retryAfter) });
  return true;
}

function enforceRequestSecurity(req, res, pathname) {
  if (!["GET", "POST", "HEAD", "OPTIONS"].includes(req.method)) {
    send(res, 405, { message: "Method not allowed" });
    return true;
  }
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return true;
  }
  if (req.method !== "GET" && pathname.startsWith("/api/") && !sameOriginRequest(req)) {
    send(res, 403, { message: "Cross-origin request blocked" });
    return true;
  }
  return enforceRateLimit(req, res, pathname);
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

function validHttpEndpoint(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value).trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
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
  const validExplicitUrl = validHttpEndpoint(explicitUrl);

  if (validExplicitUrl) return validExplicitUrl;
  if (process.env.WAREHOUSE_ORDERS_URL) return "";
  const formLoginConfigured = Boolean(
    (process.env.WEBSITE_LOGIN_EMAIL || localConfig.websiteLoginEmail) &&
    (process.env.WEBSITE_LOGIN_PASSWORD || localConfig.websiteLoginPassword)
  );
  if (!formLoginConfigured) return "";

  const productsUrl = configuredWebsiteProductsUrl(req);
  if (!productsUrl) return "";

  try {
    return new URL("/add-order", new URL(productsUrl).origin).toString();
  } catch (error) {
    return "";
  }
}

function configuredWarehouseCancelUrl(req) {
  const explicitUrl = validHttpEndpoint(
    process.env.WAREHOUSE_CANCEL_ORDER_URL || process.env.WAREHOUSE_ORDER_CANCEL_URL || ""
  );
  if (explicitUrl) return explicitUrl;
  if (!process.env.WAREHOUSE_API_TOKEN) return "";

  const productsUrl = process.env.WAREHOUSE_PRODUCTS_URL || configuredWebsiteProductsUrl(req);
  if (!productsUrl) return "";
  try {
    return new URL("/api/integrations/order-cancel", new URL(productsUrl).origin).toString();
  } catch (error) {
    return "";
  }
}

function configuredWarehouseCouponUrl(req) {
  const explicitUrl = validHttpEndpoint(process.env.WAREHOUSE_COUPON_VALIDATE_URL || process.env.WAREHOUSE_COUPON_URL || "");
  if (explicitUrl) return explicitUrl;
  if (!process.env.WAREHOUSE_API_TOKEN) return "";
  const baseUrl = process.env.WAREHOUSE_ORDERS_URL || process.env.WAREHOUSE_PRODUCTS_URL || configuredWebsiteProductsUrl(req);
  if (!baseUrl) return "";
  try {
    return new URL("/api/coupons/validate", new URL(baseUrl).origin).toString();
  } catch (error) {
    return "";
  }
}

function configuredSupportQueryUrl(req) {
  const explicitUrl = validHttpEndpoint(process.env.SUPPORT_QUERY_URL || "");
  if (explicitUrl) return explicitUrl;
  const baseUrl =
    process.env.WAREHOUSE_ORDERS_URL ||
    process.env.WAREHOUSE_PRODUCTS_URL ||
    process.env.WAREHOUSE_INVENTORY_URL ||
    configuredWebsiteOrdersUrl(req) ||
    configuredWebsiteProductsUrl(req);
  if (!baseUrl) return "";
  try {
    return new URL("/api/support-queries", new URL(baseUrl).origin).toString();
  } catch (error) {
    return "";
  }
}

function supportQueryToken() {
  return process.env.SUPPORT_QUERY_TOKEN || process.env.WAREHOUSE_API_TOKEN || "";
}

function supportQueryAuthHeaders() {
  const token = supportQueryToken().trim();
  if (!token) return {};
  if (token.toLowerCase().startsWith("bearer ")) return { Authorization: token };
  return { "X-Integration-Key": token };
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
    pushRegisterEndpoint: "/api/mobile/push/register",
    otpRequestEndpoint: "/api/mobile/auth/request-otp",
    otpVerifyEndpoint: "/api/mobile/auth/verify-otp",
    profileEndpoint: "/api/mobile/profile",
    customerStateEndpoint: "/api/mobile/customer-state",
    couponEndpoint: "/api/mobile/coupons/apply",
    paymentCreateEndpoint: "/api/mobile/payments/create",
    paymentVerifyEndpoint: "/api/mobile/payments/verify",
    authHeader: "",
    paymentGateway: {
      provider: "razorpay",
      keyId: process.env.RAZORPAY_KEY_ID || "",
      checkoutScript: "https://checkout.razorpay.com/v1/checkout.js"
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
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(user.id || user.phone),
    phone: user.phone,
    name: user.name || "Customer",
    iat: now,
    exp: now + 24 * 60 * 60
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
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.exp && Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function signCodVerification(user) {
  const payload = {
    sub: String(user.id || user.phone),
    phone: phoneDigits(user.phone),
    purpose: "cod_verification",
    exp: Math.floor(Date.now() / 1000) + 10 * 60
  };
  const encoded = base64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyCodVerification(token, user, phone) {
  if (!token || !user || !token.includes(".")) return false;
  const [encoded, signature] = String(token).split(".");
  const expected = crypto.createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.purpose === "cod_verification" &&
      payload.sub === String(user.id || user.phone) &&
      payload.phone === phoneDigits(phone) &&
      payload.phone === phoneDigits(user.phone) &&
      Number(payload.exp) >= Math.floor(Date.now() / 1000);
  } catch (error) {
    return false;
  }
}

function customerProfilesPath() {
  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "customer-profiles.json");
}

function readCustomerProfiles() {
  try {
    return JSON.parse(fs.readFileSync(customerProfilesPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeCustomerProfiles(profiles) {
  fs.writeFileSync(customerProfilesPath(), JSON.stringify(profiles, null, 2));
}

function customerProfileKey(user) {
  return phoneDigits(user?.phone);
}

function customerStatePath() {
  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "customer-state.json");
}

function readCustomerState() {
  try {
    return JSON.parse(fs.readFileSync(customerStatePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeCustomerState(state) {
  fs.writeFileSync(customerStatePath(), JSON.stringify(state, null, 2));
}

function pushTokensPath() {
  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "push-tokens.json");
}

function readPushTokens() {
  try {
    const data = JSON.parse(fs.readFileSync(pushTokensPath(), "utf8"));
    return Array.isArray(data.tokens) ? data.tokens : [];
  } catch {
    return [];
  }
}

function writePushTokens(tokens) {
  fs.writeFileSync(pushTokensPath(), JSON.stringify({ tokens }, null, 2));
}

function pendingRazorpayDir() {
  const dir = path.join(rootDir, "data", "pending-razorpay");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function savePendingRazorpayOrder(gatewayOrderId, order) {
  pendingRazorpayOrders.set(gatewayOrderId, order);
  fs.writeFileSync(path.join(pendingRazorpayDir(), `${gatewayOrderId}.json`), JSON.stringify(order, null, 2));
}

function loadPendingRazorpayOrder(gatewayOrderId) {
  if (pendingRazorpayOrders.has(gatewayOrderId)) return pendingRazorpayOrders.get(gatewayOrderId);
  try {
    return JSON.parse(fs.readFileSync(path.join(pendingRazorpayDir(), `${gatewayOrderId}.json`), "utf8"));
  } catch (error) {
    return null;
  }
}

function deletePendingRazorpayOrder(gatewayOrderId) {
  pendingRazorpayOrders.delete(gatewayOrderId);
  try {
    fs.unlinkSync(path.join(pendingRazorpayDir(), `${gatewayOrderId}.json`));
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
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FCM_SERVICE_ACCOUNT_JSON || "";
  if (raw) {
    try {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
      }
      return {
        clientEmail: parsed.client_email,
        privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n"),
        tokenUri: parsed.token_uri || "https://oauth2.googleapis.com/token",
        projectId: parsed.project_id
      };
    } catch (error) {
      console.error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON", error.message);
    }
  }

  return {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    tokenUri: process.env.GOOGLE_TOKEN_URI || "https://oauth2.googleapis.com/token",
    projectId: process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.FCM_PROJECT_ID
  };
}

function googleStorageConfigured() {
  const account = googleServiceAccount();
  return Boolean(account.clientEmail && account.privateKey);
}

function fcmServiceAccount() {
  const account = googleServiceAccount();
  return {
    ...account,
    projectId: process.env.FCM_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || account.projectId
  };
}

function fcmConfigStatus() {
  const account = fcmServiceAccount();
  const tokens = readPushTokens();
  return {
    legacyServerKeySet: Boolean(process.env.FCM_SERVER_KEY),
    serviceAccountSet: Boolean(account.clientEmail && account.privateKey),
    projectIdSet: Boolean(account.projectId),
    registeredDevices: tokens.length,
    lastRegisteredAt: tokens[0]?.updatedAt || null
  };
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

async function fcmAccessToken() {
  if (fcmAccessTokenCache && fcmAccessTokenCache.expiresAt > Date.now() + 60000) {
    return fcmAccessTokenCache.token;
  }

  const account = fcmServiceAccount();
  if (!account.clientEmail || !account.privateKey) {
    throw new Error("Firebase service account is not configured for push notifications");
  }

  const now = Math.floor(Date.now() / 1000);
  const assertionBase = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson({
    iss: account.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
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
  if (!response.ok) throw new Error(data.error_description || data.error || "Firebase token request failed");

  fcmAccessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  };
  return fcmAccessTokenCache.token;
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
  const price = markedUpSellingPrice(productPrice(item) || 0);
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

function markedUpSellingPrice(price) {
  const value = Number(price || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1.2 * 100) / 100;
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
  const warehouseCancelUrl = configuredWarehouseCancelUrl(req);
  const configuredOrdersEnvUrl = validHttpEndpoint(process.env.WEBSITE_ORDERS_URL);
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
    razorpay: {
      configured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      keyIdSet: Boolean(process.env.RAZORPAY_KEY_ID),
      keySecretSet: Boolean(process.env.RAZORPAY_KEY_SECRET)
    },
    push: fcmConfigStatus(),
    website: {
      productsUrlSet: Boolean(websiteProductsUrl),
      productsUrlSource: process.env.WEBSITE_PRODUCTS_URL ? "env" : websiteProductsUrl ? "config.js" : null,
      ordersUrlSet: Boolean(websiteOrdersUrl),
      ordersUrlSource: configuredOrdersEnvUrl ? "env" : websiteOrdersUrl ? "derived" : null,
      ordersEnvUrlValid: !process.env.WEBSITE_ORDERS_URL || Boolean(configuredOrdersEnvUrl),
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
      cancelUrlSet: Boolean(warehouseCancelUrl),
      cancelUrlSource: process.env.WAREHOUSE_CANCEL_ORDER_URL || process.env.WAREHOUSE_ORDER_CANCEL_URL ? "env" : warehouseCancelUrl ? "derived" : null,
      trackingUrlSet: Boolean(process.env.WAREHOUSE_TRACKING_URL),
      apiTokenSet: Boolean(process.env.WAREHOUSE_API_TOKEN),
      productsUrl: safeUrlSummary(process.env.WAREHOUSE_PRODUCTS_URL),
      inventoryUrl: safeUrlSummary(process.env.WAREHOUSE_INVENTORY_URL),
      ordersUrl: safeUrlSummary(process.env.WAREHOUSE_ORDERS_URL),
      cancelUrl: safeUrlSummary(warehouseCancelUrl),
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

function quickCommerceConfig(req) {
  const localConfig = localFrontendConfig(req);
  const numberValue = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  return {
    ok: true,
    features: {
      expressDelivery: process.env.EXPRESS_DELIVERY_ENABLED !== "false",
      buyAgain: process.env.BUY_AGAIN_ENABLED !== "false",
      stockBadges: process.env.STOCK_BADGES_ENABLED !== "false",
      cod: process.env.COD_ENABLED !== "false",
      warehouseOrderPush: Boolean(process.env.WAREHOUSE_ORDERS_URL),
      websiteOrderPush: Boolean(configuredWebsiteOrdersUrl(req)),
    },
    delivery: {
      promiseText: process.env.EXPRESS_PROMISE_TEXT || "Fast fulfilment from live warehouse",
      expressRadiusKm: numberValue(process.env.EXPRESS_RADIUS_KM || localConfig.addressPincodeRadiusKm, 25),
      storePincode: process.env.STORE_PINCODE || localConfig.storePincode || "",
      standardDays: numberValue(process.env.STANDARD_DELIVERY_DAYS, deliveryEstimateDays),
    },
    payments: {
      codMaxAmount: numberValue(process.env.COD_MAX_AMOUNT, codMaxOrderAmount),
      onlineEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    },
    sync: {
      products: safeUrlSummary(configuredWebsiteProductsUrl(req) || process.env.WAREHOUSE_PRODUCTS_URL),
      orders: safeUrlSummary(configuredWebsiteOrdersUrl(req) || process.env.WAREHOUSE_ORDERS_URL),
      tracking: safeUrlSummary(process.env.WAREHOUSE_TRACKING_URL || process.env.WEBSITE_TRACKING_URL || process.env.WEBSITE_ORDER_TRACKING_URL),
    },
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
  const user = verifyToken(req);
  const to = phoneE164(body.phone);
  if (!to) return send(res, 400, { message: "Enter a valid 10 digit mobile number" });
  if (user && phoneDigits(body.phone) !== phoneDigits(user.phone)) {
    return send(res, 403, { message: "COD mobile must match login mobile" });
  }

  try {
    const verification = await twilioRequest("/Verifications", {
      To: to,
      Channel: (process.env.TWILIO_VERIFY_CHANNEL || "sms").toLowerCase()
    });
    return send(res, 200, {
      message: "OTP sent",
      sid: verification.sid,
      status: verification.status
    });
  } catch (error) {
    const status = error.message.includes("env vars") ? 503 : 502;
    return send(res, status, { message: error.message });
  }
}

async function handleVerifyOtp(req, res) {
  const body = await readBody(req);
  const existingUser = verifyToken(req);
  const to = phoneE164(body.phone);
  const code = String(body.otp || "").trim();
  if (!to || code.length < 4) return send(res, 400, { message: "Phone and OTP are required" });
  if (existingUser && phoneDigits(body.phone) !== phoneDigits(existingUser.phone)) {
    return send(res, 403, { message: "COD mobile must match login mobile" });
  }

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

  if (check.status !== "approved") return send(res, 401, { message: "Invalid OTP" });

  const phone = phoneDigits(body.phone);
  const inputProfile = body.profile && typeof body.profile === "object" ? body.profile : {};
  const profiles = readCustomerProfiles();
  const currentProfile = profiles[phone] || {};
  const profileName = String(inputProfile.name || body.name || existingUser?.name || currentProfile.name || "").trim() || "Customer";
  const pincode = String(inputProfile.pincode || currentProfile.pincode || "").replace(/\D/g, "").slice(0, 6);
  const profile = {
    ...currentProfile,
    phone,
    mobile: phone,
    name: profileName,
    address1: String(inputProfile.address1 || inputProfile.address || currentProfile.address1 || "").trim(),
    address2: String(inputProfile.address2 || currentProfile.address2 || "").trim(),
    area: String(inputProfile.area || currentProfile.area || "").trim(),
    city: String(inputProfile.city || currentProfile.city || "").trim(),
    state: String(inputProfile.state || currentProfile.state || "").trim(),
    region: String(inputProfile.region || currentProfile.region || "").trim(),
    pincode: pincode.length === 6 ? pincode : "",
    coordinates: inputProfile.coordinates && typeof inputProfile.coordinates === "object" ? {
      latitude: Number(inputProfile.coordinates.latitude),
      longitude: Number(inputProfile.coordinates.longitude),
      accuracy: Number(inputProfile.coordinates.accuracy) || null
    } : currentProfile.coordinates || null,
    mapLocation: String(inputProfile.mapLocation || inputProfile.map_location || currentProfile.mapLocation || "").trim(),
    updatedAt: indiaIso()
  };
  profiles[phone] = profile;
  writeCustomerProfiles(profiles);

  const user = { id: phone, phone, name: profile.name || profileName };
  return send(res, 200, {
    verified: true,
    token: signToken(user),
    user,
    profile,
    codVerificationToken: signCodVerification(user)
  });
}

async function handleCustomerProfile(req, res) {
  const user = verifyToken(req);
  if (!user) return send(res, 401, { message: "Login required" });
  const profiles = readCustomerProfiles();
  const profileKey = customerProfileKey(user);
  if (req.method === "GET") return send(res, 200, { profile: profiles[profileKey] || { phone: user.phone, name: user.name || "" } });

  const body = await readBody(req);
  const profile = {
    phone: user.phone,
    name: String(body.name || user.name || "").trim(),
    mobile: user.phone,
    pincode: String(body.pincode || "").replace(/\D/g, "").slice(0, 6),
    area: String(body.area || "").trim(),
    city: String(body.city || "").trim(),
    state: String(body.state || "").trim(),
    region: String(body.region || "").trim(),
    address1: String(body.address1 || body.address || "").trim(),
    address2: String(body.address2 || "").trim(),
    coordinates: body.coordinates && typeof body.coordinates === "object" ? {
      latitude: Number(body.coordinates.latitude),
      longitude: Number(body.coordinates.longitude),
      accuracy: Number(body.coordinates.accuracy) || null
    } : null,
    mapLocation: String(body.mapLocation || body.map_location || "").trim(),
    updatedAt: indiaIso()
  };
  profiles[profileKey] = profile;
  writeCustomerProfiles(profiles);
  return send(res, 200, { profile });
}

async function handleCustomerState(req, res) {
  const user = verifyToken(req);
  if (!user) return send(res, 401, { message: "Login required" });
  const phone = phoneDigits(user.phone);
  const states = readCustomerState();
  if (req.method === "GET") return send(res, 200, { state: states[phone] || null });

  const body = await readBody(req);
  const cart = Array.isArray(body.cart) ? body.cart.slice(0, 100) : [];
  const wishlist = Array.isArray(body.wishlist) ? body.wishlist.slice(0, 200) : [];
  const location = body.location && typeof body.location === "object" ? body.location : null;
  const addresses = Array.isArray(body.addresses) ? body.addresses.slice(0, 10) : [];
  const orders = Array.isArray(body.orders) ? body.orders.slice(0, 50) : [];
  states[phone] = {
    cart,
    wishlist,
    location,
    addresses,
    orders,
    updatedAt: indiaIso()
  };
  writeCustomerState(states);
  return send(res, 200, { state: states[phone] });
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
    createdAt: indiaIso()
  };

  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(path.join(dataDir, "support-queries.jsonl"), `${JSON.stringify(query)}\n`);

  let forwarded = false;
  let forwardError = "";
  const supportUrl = configuredSupportQueryUrl(req);
  if (supportUrl) {
    try {
      const response = await fetchWithTimeout(supportUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...supportQueryAuthHeaders()
        },
        body: JSON.stringify(query)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Support query forward failed with ${response.status}`);
      }
      forwarded = true;
    } catch (error) {
      forwardError = error.message || "Support query forward failed";
      console.warn("Support query saved locally but panel forward failed:", forwardError);
    }
  }

  send(res, 200, {
    submitted: true,
    forwarded,
    forwardPending: Boolean(supportUrl && !forwarded),
    id: query.id
  });
}

async function handlePushRegister(req, res) {
  const body = await readBody(req);
  const token = String(body.token || "").trim();
  if (token.length < 20) return send(res, 400, { message: "Push token is required" });

  const user = verifyToken(req);
  const tokens = readPushTokens();
  const record = {
    token,
    platform: String(body.platform || "android").trim(),
    phone: phoneDigits(body.phone || user?.phone || ""),
    appVersion: String(body.appVersion || "").trim(),
    updatedAt: indiaIso()
  };
  writePushTokens([record, ...tokens.filter((item) => item.token !== token)].slice(0, 5000));
  return send(res, 200, { ok: true, registered: true });
}

function pushAdminAuthorized(req) {
  const configured = String(process.env.PUSH_ADMIN_TOKEN || "").trim();
  if (!configured) return false;
  const header = String(req.headers.authorization || "");
  const supplied = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : String(req.headers["x-push-admin-token"] || "").trim();
  return Boolean(supplied && supplied === configured);
}

function notificationTargets(audience, pincode) {
  const tokens = readPushTokens();
  if (audience === "pincode" && pincode) {
    const states = readCustomerState();
    const phones = new Set(Object.entries(states)
      .filter(([, value]) => String(value?.location?.pincode || "") === pincode)
      .map(([phone]) => phoneDigits(phone)));
    return tokens.filter((item) => phones.has(phoneDigits(item.phone)));
  }
  return tokens;
}

async function sendFcmNotification(tokens, notification) {
  if (!tokens.length) {
    return {
      configured: true,
      sent: 0,
      failed: 0,
      message: "No registered mobile devices. Install the Firebase Messaging APK and login once so the phone can register its push token."
    };
  }

  const account = fcmServiceAccount();
  if (account.clientEmail && account.privateKey && account.projectId) {
    const accessToken = await fcmAccessToken();
    const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`;
    const results = await Promise.all(tokens.map(async (item) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: {
            token: item.token,
            notification: {
              title: notification.title,
              body: notification.message
            },
            data: {
              title: notification.title,
              message: notification.message,
              target: notification.target || "orders",
              audience: notification.audience || "all",
              pincode: notification.pincode || ""
            },
            android: {
              priority: notification.priority === "high" ? "HIGH" : "NORMAL"
            }
          }
        })
      });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, data };
    }));
    const sent = results.filter((item) => item.ok).length;
    return {
      configured: true,
      provider: "fcm-http-v1",
      sent,
      failed: results.length - sent,
      response: results.slice(0, 10).map((item) => item.data)
    };
  }

  const serverKey = String(process.env.FCM_SERVER_KEY || "").trim();
  if (!serverKey) return { configured: false, sent: 0, failed: tokens.length, message: "Firebase push is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON with project_id or FCM_SERVER_KEY." };

  const response = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      Authorization: `key=${serverKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      registration_ids: tokens.map((item) => item.token),
      priority: notification.priority === "high" ? "high" : "normal",
      notification: {
        title: notification.title,
        body: notification.message
      },
      data: {
        target: notification.target || "orders",
        audience: notification.audience || "all",
        pincode: notification.pincode || ""
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || "FCM send failed");
  return { configured: true, provider: "fcm-legacy", sent: Number(data.success || 0), failed: Number(data.failure || 0), response: data };
}

async function handlePushSend(req, res) {
  if (!pushAdminAuthorized(req)) return send(res, 401, { message: "Push admin token required" });
  const body = await readBody(req);
  const title = String(body.title || "").trim();
  const message = String(body.message || "").trim();
  if (!title || !message) return send(res, 400, { message: "Title and message are required" });

  const notification = {
    id: body.id || `PUSH-${Date.now()}`,
    title,
    message,
    audience: String(body.audience || "all").trim(),
    pincode: String(body.pincode || "").replace(/\D/g, "").slice(0, 6),
    target: String(body.target || "orders").trim(),
    priority: String(body.priority || "normal").trim(),
    createdAt: indiaIso()
  };
  const targets = notificationTargets(notification.audience, notification.pincode);
  const result = await sendFcmNotification(targets, notification).catch((error) => ({
    configured: Boolean(process.env.FCM_SERVER_KEY),
    sent: 0,
    failed: targets.length,
    message: error.message
  }));

  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(path.join(dataDir, "push-notifications.jsonl"), `${JSON.stringify({ ...notification, result })}\n`);
  return send(res, result.configured ? 200 : 503, {
    ok: result.configured && result.sent > 0,
    notification,
    targets: targets.length,
    result
  });
}

async function handleCouponApply(req, res) {
  const user = verifyToken(req);
  if (!user) return send(res, 401, { message: "Login required" });
  const body = await readBody(req);
  const code = String(body.code || "").trim().toUpperCase();
  const subtotal = Number(body.subtotal || 0);
  if (!code) return send(res, 400, { message: "Coupon code is required" });
  if (!subtotal || subtotal <= 0) return send(res, 400, { message: "Cart subtotal is required" });
  try {
    const result = await validateCouponWithWarehouse(req, {
      code,
      customerPhone: user.phone,
      subtotal
    });
    return send(res, 200, result);
  } catch (error) {
    return send(res, 400, { message: error.message || "Coupon could not be applied" });
  }
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

function orderCoupon(order) {
  const promotions = order?.promotions && typeof order.promotions === "object" ? order.promotions : {};
  const coupon = promotions.coupon && typeof promotions.coupon === "object" ? promotions.coupon : {};
  const code = String(coupon.code || promotions.couponCode || order?.couponCode || "").trim().toUpperCase();
  const discount = Number(coupon.discount || promotions.couponDiscount || order?.amounts?.couponDiscount || 0);
  return { code, discount: Number.isFinite(discount) ? Math.max(0, discount) : 0 };
}

function orderHasCoupon(order) {
  return Boolean(orderCoupon(order).code);
}

async function validateCouponWithWarehouse(req, { code, customerPhone, subtotal }) {
  const endpoint = configuredWarehouseCouponUrl(req);
  if (!endpoint) {
    throw new Error("Coupon service is not configured");
  }
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: warehouseHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code, customer_phone: customerPhone, subtotal })
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message || data.error || "Coupon is not valid");
  }
  return data;
}

async function validateOrderCoupon(order, req) {
  const coupon = orderCoupon(order);
  if (!coupon.code) return null;
  const subtotal = Number(order.amounts?.subtotal || 0);
  const phone = phoneDigits(order.customer?.phone || order.customer_phone || order.customerPhone || "");
  const result = await validateCouponWithWarehouse(req, {
    code: coupon.code,
    customerPhone: phone,
    subtotal
  });
  const expectedDiscount = Math.round(Number(result.coupon?.discount || 0));
  if (Math.abs(expectedDiscount - Math.round(coupon.discount || 0)) > 1) {
    throw new Error("Coupon discount amount changed. Apply coupon again.");
  }
  return result;
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
      if (isLoginRequiredError(error)) {
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
  const customer = order.customer || {};
  const customerLocation = customer.location && typeof customer.location === "object" ? customer.location : {};
  const mapLocation = customerLocation.mapLocation || customerLocation.map_location || "";
  const items = order.items && order.items.length ? order.items : [];
  if (!items.length) throw new Error("Order has no items to push");

  const cookie = await websiteLoginCookie(req, endpointUrl);
  if (!cookie) throw new Error("Website login credentials are required for order push");

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

  const submittedItems = items.map((item) => ({
    product_id: String(item.productId || item.sourceId || item.appProductId || item.id || ""),
    quantity: Math.max(1, Number(item.quantity || 1))
  }));
  const body = new URLSearchParams({
    _csrf_token: csrfToken,
    order_number: order.orderId,
    customer_name: customer.name || "Customer",
    customer_phone: customer.phone || "",
    product_id: submittedItems[0].product_id,
    quantity: String(submittedItems[0].quantity),
    items_json: JSON.stringify(submittedItems),
    priority: "normal",
    assigned_to_id: "",
    customer_address: [
      customer.address || "",
      `Mobile order: ${order.orderId}`,
      `Items: ${items.map((item) => item.title || item.productId || "").filter(Boolean).join(", ")}`,
      `Payment: ${order.payment?.method || "cod"} / ${order.payment?.status || "pending"}`,
      `Amount: ${order.amounts?.currency || "INR"} ${order.amounts?.total || ""}`,
      mapLocation ? `Map location: ${mapLocation}` : ""
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
    throw new Error(`Website order form rejected order ${order.orderId}${sample ? `: ${sample}` : ""}`);
  }

  return {
    mode: "warehouse_form",
    endpoint: safeUrlSummary(endpointUrl),
    submitted: 1,
    submissions: [{
      orderNumber: order.orderId,
      itemCount: items.length,
      status: response.status
    }]
  };
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function indiaDate(date = new Date()) {
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
}

function indiaIso(date = new Date()) {
  return `${indiaDate(date).toISOString().slice(0, 19)}+05:30`;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function orderCreatedDate(order) {
  return validDate(order.createdAt || order.created_at || order.orderDate || order.date || order.created) || new Date();
}

function isFastDeliveryOrder(order = {}) {
  const mode = String(order.delivery?.mode || order.deliveryMode || order.delivery_mode || "").toLowerCase();
  const label = String(order.delivery?.label || order.deliveryLabel || order.delivery_label || "").toLowerCase();
  const automation = String(order.delivery?.automation || "").toLowerCase();
  return mode === "fast" || label.includes("fast") || automation.includes("express");
}

function orderDeliveryEstimateDays(order = {}, tracking = {}) {
  if (isFastDeliveryOrder(order)) return fastDeliveryEstimateDays;
  const rawDays = Number(order.deliveryEstimate?.days || tracking.estimatedDays || order.delivery?.days || order.delivery?.estimateDays);
  if (Number.isFinite(rawDays) && rawDays > 0) return rawDays;
  return deliveryEstimateDays;
}

function orderEstimatedDeliveryDate(order, tracking = {}) {
  const createdAt = orderCreatedDate(order);
  if (isFastDeliveryOrder(order)) return addDays(createdAt, fastDeliveryEstimateDays);
  return validDate(
    order.estimatedDeliveryAt ||
      order.estimatedDeliveryDate ||
      order.deliveryDate ||
      order.eta ||
      order.deliveryEstimate?.estimatedDeliveryAt ||
      tracking.estimatedDeliveryAt ||
      tracking.estimatedDeliveryDate ||
      tracking.eta
  ) || addDays(createdAt, orderDeliveryEstimateDays(order, tracking));
}

function trackingStage(status) {
  const normalized = String(status || "placed").toLowerCase().replace(/[\s-]+/g, "_");
  if (/delivered|complete/.test(normalized)) return "delivered";
  if (/out_for_delivery|in_transit|transit|on_the_way/.test(normalized)) return "in_transit";
  if (/shipped|dispatch|ready_to_ship/.test(normalized)) return "shipped";
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
      date: indiaIso(createdAt)
    },
    {
      key: "shipped",
      label: "Shipped",
      done: activeIndex >= 1,
      date: indiaIso(firstDate(tracking.shippedAt, tracking.shipped_at, order.shippedAt, order.shipped_at) || addDays(createdAt, 2))
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
      ) || addDays(createdAt, 4))
    },
    {
      key: "delivered",
      label: "Delivered",
      done: activeIndex >= 3,
      date: indiaIso(firstDate(tracking.deliveredAt, tracking.delivered_at, order.deliveredAt, order.delivered_at) || estimatedAt)
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

async function postWarehouseOrderCancel(req, endpoint, body) {
  if (!endpoint) return null;
  try {
    return await postOrderCancel(endpoint, warehouseHeaders(), body, "Warehouse cancel request");
  } catch (error) {
    if (!/invalid integration key|unauthorized|login required/i.test(error.message || "")) throw error;
    const cookie = await websiteLoginCookie(req, endpoint);
    if (!cookie) throw error;
    return postOrderCancel(
      endpoint,
      { Accept: "application/json", Cookie: cookie },
      body,
      "Warehouse cancel request"
    );
  }
}

function orderItemsForRequest(order = {}) {
  const rows = Array.isArray(order.items) && order.items.length
    ? order.items
    : arrayFromPayload(order, ["items", "products", "lineItems", "line_items", "orderItems", "order_items"]);

  return rows.map((item, index) => {
    const product = item.product && typeof item.product === "object" ? item.product : {};
    const price = numericValue(firstPresent(item, ["price", "sellingPrice", "selling_price", "amount", "unitPrice", "unit_price", "rate"])) || 0;
    const quantity = numericValue(firstPresent(item, ["quantity", "qty", "count"])) || 1;
    const ean = firstPresent(item, ["ean", "EAN", "barcode", "barCode", "bar_code", "upc", "isbn", "sku", "productSku", "product_sku"]) ||
      firstPresent(product, ["ean", "EAN", "barcode", "sku"]);
    const productId = firstPresent(item, ["productId", "product_id", "sourceId", "source_id", "appProductId", "app_product_id", "id", "sku"]) || "";
    const sku = firstPresent(item, ["sku", "productSku", "product_sku"]) || firstPresent(product, ["sku"]) || "";
    const title = firstPresent(item, ["title", "name", "productName", "product_name"]) || firstPresent(product, ["title", "name", "productName", "product_name"]) || `Item ${index + 1}`;

    return {
      productId,
      product_id: productId,
      sourceId: productId,
      appProductId: firstPresent(item, ["appProductId", "app_product_id", "id"]) || "",
      title,
      name: title,
      productName: title,
      product: title,
      sku,
      product_sku: sku,
      ean: ean ? String(ean) : "",
      barcode: ean ? String(ean) : "",
      price,
      quantity,
      expected_quantity: quantity,
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
  const payment = order.payment || {
    method: order.paymentMethod || "",
    status: order.paymentStatus || ""
  };
  const amounts = orderAmountsForRequest(order);
  const gateway = String(payment.gateway || "").toLowerCase();
  const method = String(payment.method || "").toLowerCase();
  const paymentStatus = String(payment.status || order.paymentStatus || "").toLowerCase();
  const gatewayPaymentId = payment.paymentId || payment.mihpayid || payment.gatewayPaymentId || "";
  const refundEligible = type === "cancel" && gateway === "razorpay" && method === "online" && ["paid", "captured", "success"].includes(paymentStatus) && Boolean(gatewayPaymentId);

  return {
    requestId: `${type.toUpperCase()}-${Date.now()}`,
    return_id: type === "return" ? `${orderId}-${Date.now()}` : undefined,
    return_number: type === "return" ? `RET-${orderId}-${Date.now()}` : undefined,
    requestType: type,
    orderId,
    order_id: orderId,
    website_order_id: orderId,
    external_order_id: orderId,
    awbNumber,
    awb: awbNumber,
    status: `${type}_requested`,
    reason: details.reason || "",
    note: details.note || details.details || "",
    notes: details.note || details.details || "",
    return_reason: type === "return" ? details.reason || "" : undefined,
    source: "mobile_app",
    requestedAt: indiaIso(),
    deliveredAt: deliveredAt ? indiaIso(deliveredAt) : "",
    customer: orderCustomerForRequest(order, user),
    items,
    itemCount: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    amounts,
    payment,
    refund: refundEligible
      ? {
          eligible: true,
          gateway,
          status: "approval_required",
          amount: amounts.total,
          currency: amounts.currency,
          gatewayPaymentId,
          paymentId: gatewayPaymentId,
          gatewayOrderId: payment.gatewayOrderId || "",
          reason: details.reason || "Customer requested cancellation"
        }
      : {
          eligible: false,
          reason: type === "cancel" ? "Order is not an eligible paid online order" : ""
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
  if (stage === "in_transit" || stage === "delivered") {
    return send(res, 409, { message: "Cancel unavailable after order is in transit" });
  }

  const cancelBody = buildOrderActionRequest("cancel", order, user, { reason }, tracking);
  appendOrderActionRequest("cancel", cancelBody);
  const results = {};

  try {
    const websiteCancelUrl = process.env.WEBSITE_CANCEL_ORDER_URL || process.env.WEBSITE_ORDER_CANCEL_URL || "";
    const warehouseCancelUrl = configuredWarehouseCancelUrl(req);
    const websiteCancelHeaders = websiteCancelUrl ? await websiteRequestHeaders(req, websiteCancelUrl) : {};

    const [website, warehouse] = await Promise.all([
      postOrderCancel(websiteCancelUrl, websiteCancelHeaders, cancelBody, "Website cancel request"),
      postWarehouseOrderCancel(req, warehouseCancelUrl, cancelBody)
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
  returnBody.returnAvailableUntil = indiaIso(returnAvailableUntil);
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
    if (!warehouse && orderHasCoupon(order)) {
      throw new Error("Warehouse order API is required to redeem coupon");
    }
    return {
      ...result,
      warehousePushed: Boolean(warehouse),
      warehouse
    };
  } catch (error) {
    console.error("Warehouse order push failed", error);
    if (orderHasCoupon(order)) {
      throw error;
    }
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

  let order = await readBody(req);
  if (!Array.isArray(order.items) || !order.items.length) {
    return send(res, 400, { message: "Order items are required" });
  }

  const submittedPayment = order.payment || {};
  if (submittedPayment.method === "cod") {
    if (!user || !verifyCodVerification(order.codVerificationToken, user, order.customer?.phone)) {
      return send(res, 401, { message: "OTP verification is required for COD order" });
    }
    const { codVerificationToken, ...verifiedCodOrder } = order;
    order = verifiedCodOrder;
  }
  if (String(submittedPayment.gateway || "").toLowerCase() === "razorpay" && submittedPayment.method === "online") {
    const gatewayOrderId = String(submittedPayment.gatewayOrderId || "").trim();
    const pendingOrder = loadPendingRazorpayOrder(gatewayOrderId);
    const paymentMatches = pendingOrder &&
      pendingOrder.orderId === order.orderId &&
      pendingOrder.payment?.status === "paid" &&
      pendingOrder.payment?.paymentId === submittedPayment.paymentId;
    if (!paymentMatches) {
      return send(res, 400, { message: "Verified Razorpay payment is required for this online order" });
    }
    order = pendingOrder;
  }

  try {
    await validateOrderCoupon(order, req);
  } catch (error) {
    return send(res, 400, { message: error.message || "Coupon is not valid" });
  }

  const inventoryError = await validateOrderInventory(order, req);
  if (inventoryError) {
    return send(res, 409, { message: inventoryError });
  }

  const createdAt = orderCreatedDate(order);
  const estimateDays = orderDeliveryEstimateDays(order);
  const estimatedDeliveryAt = isFastDeliveryOrder(order) ? addDays(createdAt, estimateDays) : orderEstimatedDeliveryDate(order);
  const response = await persistAndPushOrder({
    ...order,
    createdAt: indiaIso(validDate(order.createdAt) || createdAt),
    estimatedDeliveryAt: indiaIso(estimatedDeliveryAt),
    delivery: {
      ...(order.delivery || {}),
      mode: isFastDeliveryOrder(order) ? "fast" : (order.delivery?.mode || "free"),
      label: isFastDeliveryOrder(order) ? "Fast delivery" : (order.delivery?.label || "Standard delivery"),
      days: estimateDays,
      estimatedDays: isFastDeliveryOrder(order) ? "1 day delivery" : (order.delivery?.estimatedDays || "6-7 days"),
      automation: isFastDeliveryOrder(order) ? "express_zone_selected" : (order.delivery?.automation || "standard_auto_selected")
    },
    deliveryEstimate: {
      days: estimateDays,
      estimatedDeliveryAt: indiaIso(estimatedDeliveryAt)
    },
    verifiedCustomer: user || null
  }, req);
  if (String(order.payment?.gateway || "").toLowerCase() === "razorpay" && order.payment?.gatewayOrderId) {
    deletePendingRazorpayOrder(order.payment.gatewayOrderId);
  }
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
    const estimateDays = orderDeliveryEstimateDays(order, tracking);
    const status = tracking.status || order.status || "placed";

    enriched.push({
      ...order,
      estimatedDeliveryAt: indiaIso(estimatedAt),
      deliveryEstimate: {
        ...(order.deliveryEstimate || {}),
        days: estimateDays,
        estimatedDeliveryAt: indiaIso(estimatedAt)
      },
      tracking: {
        ...tracking,
        awbNumber: tracking.awbNumber || trackingAwbNumber(tracking) || trackingAwbNumber(order) || "",
        estimatedDays: estimateDays,
        estimatedDeliveryAt: indiaIso(estimatedAt),
        steps: tracking.steps || trackingSteps(status, order, tracking)
      }
    });
  }

  send(res, 200, { orders: enriched });
}

function secureHashEquals(expected, received) {
  const left = Buffer.from(String(expected || "").toLowerCase(), "utf8");
  const right = Buffer.from(String(received || "").toLowerCase(), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function razorpayAmount(value) {
  const amount = Math.round(Number(value || 0) * 100);
  if (!Number.isSafeInteger(amount) || amount < 100) {
    const error = new Error("Minimum payment amount is 100 paise");
    error.statusCode = 400;
    throw error;
  }
  return amount;
}

function razorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay env vars are missing");
  return { keyId, keySecret };
}

function razorpayClient() {
  const { keyId, keySecret } = razorpayCredentials();
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function razorpayStatusCode(error) {
  const status = Number(error?.statusCode || error?.status_code || error?.status || 0);
  if (status === 401 || status === 403) return 401;
  if (status >= 400 && status < 500) return status;
  if (/auth|key|credential/i.test(String(error?.message || ""))) return 401;
  return 500;
}

async function razorpayRequest(pathname, options = {}) {
  const { keyId, keySecret } = razorpayCredentials();
  const response = await fetchWithTimeout(`https://api.razorpay.com/v1${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Razorpay returned non-JSON response: ${text.slice(0, 120)}`);
  }
  if (!response.ok) {
    const error = new Error(data.error?.description || data.error?.reason || data.message || `Razorpay API failed with ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function handlePaymentCreate(req, res) {
  const user = verifyToken(req);
  if (!user && process.env.ALLOW_UNAUTHENTICATED_ORDERS !== "true") {
    return send(res, 401, { message: "Login required" });
  }

  const order = await readBody(req);
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return send(res, 401, { message: "Razorpay credentials are not configured" });
  }

  const inventoryError = await validateOrderInventory(order, req);
  if (inventoryError) {
    return send(res, 409, { message: inventoryError });
  }

  try {
    await validateOrderCoupon(order, req);
  } catch (error) {
    return send(res, 400, { message: error.message || "Coupon is not valid" });
  }

  let gatewayOrder;
  let amount;
  let currency;
  let orderId;
  try {
    amount = razorpayAmount(order.amounts?.total);
    currency = String(order.amounts?.currency || process.env.CURRENCY || "INR").toUpperCase();
    orderId = String(order.orderId || `EV${Date.now()}`);
    gatewayOrder = await razorpayClient().orders.create({
      amount,
      currency,
      receipt: orderId.slice(0, 40),
      notes: {
        app_order_id: orderId.slice(0, 256),
        customer_phone: phoneDigits(order.customer?.phone)
      }
    });
  } catch (error) {
    return send(res, razorpayStatusCode(error), { message: error.message || "Razorpay order API failed" });
  }

  savePendingRazorpayOrder(gatewayOrder.id, {
    ...order,
    orderId,
    payment: {
      method: "online",
      gateway: "razorpay",
      status: "initiated",
      gatewayOrderId: gatewayOrder.id
    },
    status: "payment_initiated",
    verifiedCustomer: user || null
  });

  send(res, 200, {
    ok: true,
    gateway: "razorpay",
    order_id: gatewayOrder.id,
    gatewayOrderId: gatewayOrder.id,
    amount: gatewayOrder.amount,
    currency: gatewayOrder.currency
  });
}

async function handlePaymentVerify(req, res) {
  const body = await readBody(req);
  const gatewayOrderId = String(body.gatewayOrderId || body.razorpay_order_id || "").trim();
  const paymentId = String(body.razorpay_payment_id || "").trim();
  const signature = String(body.razorpay_signature || "").trim();
  const pendingOrder = loadPendingRazorpayOrder(gatewayOrderId);
  if (!gatewayOrderId || !paymentId || !signature || !pendingOrder) {
    return send(res, 400, { verified: false, message: "Razorpay payment details are missing or expired" });
  }
  if (!process.env.RAZORPAY_KEY_SECRET) {
    return send(res, 401, { verified: false, message: "Razorpay credentials are not configured" });
  }
  if (body.orderId && String(body.orderId) !== String(pendingOrder.orderId)) {
    return send(res, 400, { verified: false, message: "Order does not match payment request" });
  }

  const expected = crypto
    .createHmac("sha256", razorpayCredentials().keySecret)
    .update(`${gatewayOrderId}|${paymentId}`)
    .digest("hex");
  const signatureVerified = secureHashEquals(expected, signature);
  if (!signatureVerified) return send(res, 400, { verified: false, signatureVerified: false });

  try {
    const payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
    const amountMatches = Number(payment.amount) === razorpayAmount(pendingOrder.amounts?.total);
    const orderMatches = String(payment.order_id || "") === gatewayOrderId;
    const captured = String(payment.status || "").toLowerCase() === "captured";
    if (!amountMatches || !orderMatches || !captured) {
      return send(res, 400, {
        verified: false,
        signatureVerified: true,
        gatewayVerified: false,
        message: captured ? "Payment details do not match this order" : "Payment has not been captured"
      });
    }
    savePendingRazorpayOrder(gatewayOrderId, {
      ...pendingOrder,
      payment: {
        method: "online",
        gateway: "razorpay",
        status: "paid",
        gatewayOrderId,
        paymentId,
        signature,
        captured: true,
        verified: true
      },
      status: "paid"
    });
    return send(res, 200, {
      ok: true,
      verified: true,
      signatureVerified: true,
      gatewayVerified: true,
      paymentStatus: payment.status,
      payment_id: paymentId,
      order_id: gatewayOrderId
    });
  } catch (error) {
    return send(res, razorpayStatusCode(error), {
      verified: false,
      signatureVerified: true,
      gatewayVerified: false,
      message: error.message
    });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/config.js") {
    applySecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    const config = JSON.stringify(publicConfig(req), null, 2);
    res.end(`window.EVSPEARE_CONFIG = ${config};\nwindow.BAZAARGO_CONFIG = window.EVSPEARE_CONFIG;\n`);
    return;
  }

  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch (error) {
    send(res, 400, { message: "Invalid path" });
    return;
  }
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(rootDir, safePath);
  const relativePath = path.relative(rootDir, filePath);
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || baseName.startsWith(".") || (ext && !mimeTypes[ext])) {
    send(res, 403, { message: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(rootDir, "index.html"), (indexError, indexData) => {
        if (indexError) send(res, 404, { message: "Not found" });
        else {
          applySecurityHeaders(res);
          res.writeHead(200, { "Content-Type": mimeTypes[".html"], "Cache-Control": "no-store" });
          res.end(indexData);
        }
      });
      return;
    }

    const isServiceWorker = path.basename(filePath).toLowerCase() === "sw.js";
    applySecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" || isServiceWorker ? "no-store" : "public, max-age=300",
      ...(isServiceWorker ? { "Service-Worker-Allowed": "/" } : {})
    });
    res.end(data);
  });
}

async function router(req, res) {
  try {
    applySecurityHeaders(res);
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (enforceRequestSecurity(req, res, url.pathname)) return;

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: "ev-speare",
        time: indiaIso()
      });
    }

    if (req.method === "GET" && url.pathname === "/app-version") {
      return send(res, 200, {
        version: currentAppVersion(),
        checkedAt: indiaIso()
      });
    }

    if (url.pathname === "/.well-known/assetlinks.json") return sendAssetLinks(req, res);

    if (req.method === "GET" && url.pathname === "/api/mobile/diagnostics") {
      return send(res, 200, publicDiagnostics(req));
    }

    if (req.method === "GET" && url.pathname === "/api/mobile/quick-commerce-config") {
      return send(res, 200, quickCommerceConfig(req));
    }

    if (req.method === "GET" && url.pathname === "/api/mobile/inventory-diagnostics") {
      if (!envFlag("ENABLE_PUBLIC_DIAGNOSTICS")) {
        return send(res, 404, { message: "Not found" });
      }
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
    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/mobile/profile") return handleCustomerProfile(req, res);
    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/mobile/customer-state") return handleCustomerState(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/support") return handleSupportQuery(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/push/register") return handlePushRegister(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/push/send") return handlePushSend(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/coupons/apply") return handleCouponApply(req, res);
    if (req.method === "GET" && url.pathname === "/api/mobile/products") return handleProducts(req, res);
    if (req.method === "GET" && url.pathname === "/api/mobile/images") return handleProductImage(req, res);
    if (req.method === "GET" && url.pathname === "/api/mobile/orders") return handleCustomerOrders(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/orders") return handleOrder(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/orders/cancel") return handleOrderCancel(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/orders/return") return handleOrderReturn(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/payments/create") return handlePaymentCreate(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/payments/verify") return handlePaymentVerify(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    send(res, 405, { message: "Method not allowed" });
  } catch (error) {
    console.error(error);
    send(res, error.statusCode || 500, { message: error.message || "Server error" });
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
