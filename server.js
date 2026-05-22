const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URLSearchParams } = require("url");
const database = require("./database");

const rootDir = __dirname;
const port = Number(process.env.PORT || 3000);
const fallbackPort = 3000;
const pendingPayuOrders = new Map();
let googleAccessTokenCache = null;

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
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

function publicConfig(req) {
  return {
    businessName: process.env.BUSINESS_NAME || "Ev Speare",
    currency: process.env.CURRENCY || "INR",
    apiBaseUrl: getOrigin(req),
    productsEndpoint: "/api/mobile/products",
    ordersEndpoint: "/api/mobile/orders",
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
  const timeoutMs = Number(process.env.OUTBOUND_FETCH_TIMEOUT_MS || 8000);
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

function publicDiagnostics(req) {
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
      productsUrlSet: Boolean(process.env.WEBSITE_PRODUCTS_URL),
      ordersUrlSet: Boolean(process.env.WEBSITE_ORDERS_URL),
      apiTokenSet: Boolean(process.env.WEBSITE_API_TOKEN),
      productsUrl: safeUrlSummary(process.env.WEBSITE_PRODUCTS_URL),
      ordersUrl: safeUrlSummary(process.env.WEBSITE_ORDERS_URL),
      productsUrlSelfReference: isSelfReference(req, process.env.WEBSITE_PRODUCTS_URL, "/api/mobile/products"),
      ordersUrlSelfReference: isSelfReference(req, process.env.WEBSITE_ORDERS_URL, "/api/mobile/orders")
    },
    warehouse: {
      ordersUrlSet: Boolean(process.env.WAREHOUSE_ORDERS_URL),
      trackingUrlSet: Boolean(process.env.WAREHOUSE_TRACKING_URL),
      apiTokenSet: Boolean(process.env.WAREHOUSE_API_TOKEN),
      ordersUrl: safeUrlSummary(process.env.WAREHOUSE_ORDERS_URL),
      trackingUrl: safeUrlSummary(process.env.WAREHOUSE_TRACKING_URL)
    },
    images: {
      googleStorageConfigured: googleStorageConfigured(),
      proxyAllowedHostsSet: Boolean(process.env.IMAGE_PROXY_ALLOWED_HOSTS)
    },
    database: database.status()
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

function websiteHeaders(extra = {}) {
  const headers = {
    Accept: "application/json",
    ...extra
  };
  if (process.env.WEBSITE_API_TOKEN) {
    headers.Authorization = process.env.WEBSITE_API_TOKEN;
  }
  return headers;
}

async function handleProducts(req, res) {
  try {
    const dbProducts = await database.fetchProducts();
    if (dbProducts) {
      return send(res, 200, {
        source: "database",
        products: dbProducts
      });
    }
  } catch (error) {
    console.error("Database product import failed", error);
    if (!process.env.WEBSITE_PRODUCTS_URL) {
      return send(res, 500, { message: error.message || "Database product import failed" });
    }
  }

  if (!process.env.WEBSITE_PRODUCTS_URL) {
    return send(res, 200, { products: [] });
  }

  if (isSelfReference(req, process.env.WEBSITE_PRODUCTS_URL, "/api/mobile/products")) {
    return send(res, 500, {
      message: "WEBSITE_PRODUCTS_URL points back to this app. Set DATABASE_URL or your real website products API URL."
    });
  }

  let response;
  let data;
  try {
    response = await fetchWithTimeout(process.env.WEBSITE_PRODUCTS_URL, {
      headers: websiteHeaders()
    });
    const text = await response.text();
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    return send(res, 502, {
      message: `Website product import failed: ${error.message}`
    });
  }

  if (!response.ok) {
    return send(res, response.status, { message: data.message || data.error || "Product sync failed" });
  }
  send(res, 200, data);
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

async function pushOrderToWebsite(order, req) {
  try {
    const dbResult = await database.insertOrder(order);
    if (dbResult) return dbResult;
  } catch (error) {
    console.error("Database order insert failed", error);
    if (!process.env.WEBSITE_ORDERS_URL) {
      throw error;
    }
  }

  if (!process.env.WEBSITE_ORDERS_URL) {
    const dataDir = path.join(rootDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(path.join(dataDir, "orders.jsonl"), `${JSON.stringify(order)}\n`);
    return { storedLocally: true, orderId: order.orderId };
  }

  if (req && isSelfReference(req, process.env.WEBSITE_ORDERS_URL, "/api/mobile/orders")) {
    throw new Error("WEBSITE_ORDERS_URL points back to this app. Set DATABASE_URL or your real website orders API URL.");
  }

  const response = await fetchWithTimeout(process.env.WEBSITE_ORDERS_URL, {
    method: "POST",
    headers: websiteHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(order)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message || data.error || "Website order push failed");
  }
  return data;
}

function trackingSteps(status) {
  const normalized = String(status || "placed").toLowerCase();
  const picked = ["picked", "packed", "shipped", "out_for_delivery", "delivered"].includes(normalized);
  const shipped = ["shipped", "out_for_delivery", "delivered"].includes(normalized);
  const out = ["out_for_delivery", "delivered"].includes(normalized);
  const delivered = normalized === "delivered";

  return [
    { key: "placed", label: "Order placed", done: true },
    { key: "picked", label: "Warehouse picked", done: picked },
    { key: "shipped", label: "Shipped", done: shipped },
    { key: "out_for_delivery", label: "Out for delivery", done: out },
    { key: "delivered", label: "Delivered", done: delivered }
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

async function fetchWarehouseTracking(orderId) {
  if (!process.env.WAREHOUSE_TRACKING_URL) return null;

  const url = new URL(process.env.WAREHOUSE_TRACKING_URL);
  url.searchParams.set("orderId", orderId);

  const headers = { Accept: "application/json" };
  if (process.env.WAREHOUSE_API_TOKEN) headers.Authorization = process.env.WAREHOUSE_API_TOKEN;

  const response = await fetchWithTimeout(url.toString(), { headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.message || data.error || "Warehouse tracking failed");
  return data;
}

async function persistAndPushOrder(order, req) {
  const result = await pushOrderToWebsite(order, req);
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

async function handleOrder(req, res) {
  const user = verifyToken(req);
  if (!user && process.env.ALLOW_UNAUTHENTICATED_ORDERS !== "true") {
    return send(res, 401, { message: "Login required" });
  }

  const order = await readBody(req);
  if (!Array.isArray(order.items) || !order.items.length) {
    return send(res, 400, { message: "Order items are required" });
  }

  const response = await persistAndPushOrder({
    ...order,
    verifiedCustomer: user || null
  }, req);
  send(res, 200, response);
}

async function handleCustomerOrders(req, res) {
  const user = verifyToken(req);
  if (!user) return send(res, 401, { message: "Login required" });

  const orders = (await database.fetchCustomerOrders(user.phone)) || [];
  const enriched = [];

  for (const order of orders) {
    let tracking = order.tracking || {
      status: order.status || "placed",
      label: order.status || "Order placed"
    };

    try {
      const warehouseTracking = await fetchWarehouseTracking(order.orderId);
      if (warehouseTracking) tracking = { ...tracking, ...warehouseTracking };
    } catch (error) {
      tracking = { ...tracking, error: error.message };
    }

    enriched.push({
      ...order,
      tracking: {
        ...tracking,
        steps: tracking.steps || trackingSteps(tracking.status || order.status)
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

async function handlePaymentCreate(req, res) {
  const user = verifyToken(req);
  if (!user && process.env.ALLOW_UNAUTHENTICATED_ORDERS !== "true") {
    return send(res, 401, { message: "Login required" });
  }

  const order = await readBody(req);
  if (!process.env.PAYU_KEY || !process.env.PAYU_SALT) {
    return send(res, 503, { message: "PayU env vars are missing" });
  }

  const origin = getOrigin(req);
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

  const order = {
    ...pendingOrder,
    payment: {
      method: "online",
      gateway: "payu",
      status: "paid",
      txnid: fields.txnid,
      mihpayid: fields.mihpayid,
      mode: fields.mode,
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

    if (req.method === "POST" && url.pathname === "/api/mobile/auth/request-otp") return handleRequestOtp(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/auth/verify-otp") return handleVerifyOtp(req, res);
    if (req.method === "GET" && url.pathname === "/api/mobile/products") return handleProducts(req, res);
    if (req.method === "GET" && url.pathname === "/api/mobile/images") return handleProductImage(req, res);
    if (req.method === "GET" && url.pathname === "/api/mobile/orders") return handleCustomerOrders(req, res);
    if (req.method === "POST" && url.pathname === "/api/mobile/orders") return handleOrder(req, res);
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
