(function () {
  const config = window.EVSPEARE_CONFIG || window.BAZAARGO_CONFIG || {};

  function trimSlashes(value) {
    return String(value || "").replace(/^\/+|\/+$/g, "");
  }

  function endpointUrl(path) {
    if (!config.apiBaseUrl) return "";
    const base = String(config.apiBaseUrl).replace(/\/+$/g, "");
    const endpoint = trimSlashes(path);
    return `${base}/${endpoint}`;
  }

  function hasEndpoint(path) {
    return Boolean(config.apiBaseUrl && path);
  }

  async function request(path, options = {}) {
    const url = endpointUrl(path);
    if (!url) {
      throw new Error("API endpoint is not configured");
    }

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (config.authHeader) {
      headers.Authorization = config.authHeader;
    }

    if (!headers.Authorization) {
      try {
        const session = JSON.parse(localStorage.getItem("bazaarGo.session") || "null");
        if (session?.token) headers.Authorization = `Bearer ${session.token}`;
      } catch (error) {
        console.warn("Unable to read saved session", error);
      }
    }

    const response = await fetch(url, {
      ...options,
      headers,
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error(`API returned non-JSON response (${response.status})`);
    }

    if (!response.ok) {
      throw new Error(data.message || data.error || `Request failed with ${response.status}`);
    }

    return data;
  }

  function unwrapConnectionItem(item) {
    if (item && typeof item === "object") {
      if (item.node && typeof item.node === "object") return item.node;
      if (item.product && typeof item.product === "object") return item.product;
    }
    return item;
  }

  function asArray(payload, depth = 0) {
    if (Array.isArray(payload)) return payload.map(unwrapConnectionItem);
    if (!payload || typeof payload !== "object" || depth > 2) return [];

    const keys = ["products", "items", "data", "results", "records", "nodes"];
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key].map(unwrapConnectionItem);
    }

    if (Array.isArray(payload.edges)) return payload.edges.map(unwrapConnectionItem);

    for (const key of keys) {
      const nested = asArray(payload[key], depth + 1);
      if (nested.length) return nested;
    }

    return [];
  }

  function firstText(value, names = []) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    for (const name of names) {
      const item = value[name];
      if (typeof item === "string" && item.trim()) return item;
    }
    return "";
  }

  function firstImage(item) {
    const direct = firstText(item.image, ["src", "url", "image_url", "path"])
      || firstText(item.image_url)
      || firstText(item.imageUrl)
      || firstText(item.featured_image, ["src", "url"])
      || firstText(item.featuredImage, ["src", "url"]);
    if (direct) return direct;
    const imageRows = Array.isArray(item.images) ? item.images : asArray(item.images);
    if (imageRows[0]) {
      const image = typeof imageRows[0] === "object"
        ? imageRows[0].src || imageRows[0].url || imageRows[0].image || imageRows[0].path
        : imageRows[0];
      if (image) return image;
    }
    return "https://images.unsplash.com/photo-1607082350899-7e105aa886ae?auto=format&fit=crop&w=420&q=80";
  }

  function firstCategory(item) {
    if (typeof item.category === "string") return item.category;
    const categories = Array.isArray(item.categories) ? item.categories : asArray(item.categories);
    if (categories[0]) {
      return categories[0].name || categories[0].title || categories[0].slug || (typeof categories[0] === "string" ? categories[0] : "Deals");
    }
    return "Deals";
  }

  function firstPresent(item, names) {
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(item, name)) continue;
      const value = item[name];
      if (value !== null && value !== undefined && value !== "") return value;
    }
    return null;
  }

  function numericOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const match = String(value).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function firstNumeric(item, names) {
    return numericOrNull(firstPresent(item, names));
  }

  function productPrice(item, depth = 0) {
    const direct = firstNumeric(item, [
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
      const nestedDirect = firstNumeric(nested, [
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
        const variantPrice = firstNumeric(minVariant, ["amount", "price"]);
        if (variantPrice !== null) return variantPrice;
      }
    }

    if (depth < 1) {
      const variants = firstPresent(item, ["variants", "variations"]);
      const variantRows = Array.isArray(variants) ? variants : asArray(variants);
      if (variantRows[0]) {
        const variantPrice = productPrice(variantRows[0], depth + 1);
        if (variantPrice !== null) return variantPrice;
      }
    }

    return null;
  }

  function productMrp(item, fallbackPrice) {
    const direct = firstNumeric(item, [
      "mrp",
      "regular_price",
      "regularPrice",
      "compare_at_price",
      "compareAtPrice",
      "original_price",
      "originalPrice"
    ]);
    if (direct !== null) return direct;

    const nested = firstPresent(item, ["prices", "pricing", "price_range", "priceRange"]);
    if (nested && typeof nested === "object") {
      const nestedMrp = firstNumeric(nested, [
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
    }

    return fallbackPrice;
  }

  function stockStatus(item, quantity) {
    const raw = firstPresent(item, ["stock_status", "stockStatus", "stock", "availability", "in_stock", "inStock", "is_in_stock", "isInStock", "available"]);
    if (quantity !== null && quantity <= 0) return "out_of_stock";
    if (typeof raw === "boolean") return raw ? "available" : "out_of_stock";
    if (raw === 0 || raw === "0") return "out_of_stock";
    return raw || "available";
  }

  function normalizeProduct(item, index) {
    const price = productPrice(item) || 0;
    const mrp = productMrp(item, price) || price;
    const category = firstCategory(item);
    const tags = Array.isArray(item.tags)
      ? item.tags.map((tag) => tag.name || tag.title || tag)
      : [category];
    const quantity = numericOrNull(firstPresent(item, ["stockQuantity", "stock_quantity", "inventory", "available_stock", "availableStock", "quantity", "qty", "stock_count"]));

    return {
      id: String(item.id || item.product_id || item.sku || `remote-${index}`),
      sourceId: item.sourceId || item.source_id || item.product_id || item.productId || item.id || item.sku || null,
      sku: item.sku || item.product_sku || item.productSku || null,
      title: item.title || item.name || "Product",
      category,
      price: price || mrp || 0,
      mrp: mrp || price || 0,
      rating: Number(item.rating || item.average_rating || 4.1),
      reviews: Number(item.reviews || item.rating_count || item.review_count || 0),
      delivery: item.delivery || item.shipping_text || "Delivery available",
      tags: [...new Set(["Deals", category, ...tags].filter(Boolean))],
      image: firstImage(item),
      stock: stockStatus(item, quantity),
      stockQuantity: quantity
    };
  }

  async function fetchProducts() {
    const catalog = await fetchCatalog();
    return catalog.products;
  }

  async function fetchCatalog() {
    if (!hasEndpoint(config.productsEndpoint)) {
      return {
        source: "api_not_configured",
        products: []
      };
    }
    const payload = await request(config.productsEndpoint);
    const products = asArray(payload).map(normalizeProduct).filter((product) => product.price > 0);
    const catalog = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    return {
      ...catalog,
      products
    };
  }

  async function requestOtp(phone) {
    if (!hasEndpoint(config.otpRequestEndpoint)) {
      return { demo: true, message: "Demo OTP sent" };
    }

    return request(config.otpRequestEndpoint, {
      method: "POST",
      body: { phone }
    });
  }

  async function verifyOtp(phone, otp) {
    if (!hasEndpoint(config.otpVerifyEndpoint)) {
      if (config.demo?.enabled && otp === config.demo.otp) {
        return {
          token: `demo-token-${Date.now()}`,
          user: { id: phone, phone, name: "Customer" }
        };
      }
      throw new Error("Invalid OTP. Demo OTP is 123456.");
    }

    return request(config.otpVerifyEndpoint, {
      method: "POST",
      body: { phone, otp }
    });
  }

  async function createPaymentOrder(order) {
    if (!hasEndpoint(config.paymentCreateEndpoint)) {
      if (config.demo?.allowDemoPayment) {
        return {
          demo: true,
          gatewayOrderId: `demo_pay_${Date.now()}`,
          amount: order.amounts.total * 100,
          currency: config.currency || "INR"
        };
      }
      throw new Error("Payment create endpoint is not configured");
    }

    return request(config.paymentCreateEndpoint, {
      method: "POST",
      body: order
    });
  }

  async function verifyPayment(payment) {
    if (!hasEndpoint(config.paymentVerifyEndpoint)) {
      if (config.demo?.allowDemoPayment) return { verified: true, demo: true };
      throw new Error("Payment verify endpoint is not configured");
    }

    return request(config.paymentVerifyEndpoint, {
      method: "POST",
      body: payment
    });
  }

  async function pushOrder(order) {
    if (!hasEndpoint(config.ordersEndpoint)) {
      const key = "bazaarGo.pendingOrders";
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      existing.push(order);
      localStorage.setItem(key, JSON.stringify(existing));
      return { storedLocally: true, orderId: order.orderId };
    }

    return request(config.ordersEndpoint, {
      method: "POST",
      body: order
    });
  }

  async function fetchOrders() {
    if (!hasEndpoint(config.ordersEndpoint)) return { orders: [] };
    return request(config.ordersEndpoint);
  }

  async function cancelOrder(orderId, reason = "Customer requested cancellation") {
    if (!hasEndpoint(config.orderCancelEndpoint)) {
      throw new Error("Order cancel endpoint is not configured");
    }

    return request(config.orderCancelEndpoint, {
      method: "POST",
      body: { orderId, reason }
    });
  }

  window.BazaarGoApi = {
    config,
    fetchProducts,
    fetchCatalog,
    requestOtp,
    verifyOtp,
    createPaymentOrder,
    verifyPayment,
    pushOrder,
    fetchOrders,
    cancelOrder,
    hasEndpoint
  };
})();
