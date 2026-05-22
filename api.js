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
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(data.message || data.error || `Request failed with ${response.status}`);
    }

    return data;
  }

  function asArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.products)) return payload.products;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.data)) return payload.data;
    return [];
  }

  function firstImage(item) {
    if (typeof item.image === "string") return item.image;
    if (typeof item.image_url === "string") return item.image_url;
    if (Array.isArray(item.images) && item.images[0]) {
      return item.images[0].src || item.images[0].url || item.images[0];
    }
    return "https://images.unsplash.com/photo-1607082350899-7e105aa886ae?auto=format&fit=crop&w=420&q=80";
  }

  function firstCategory(item) {
    if (typeof item.category === "string") return item.category;
    if (Array.isArray(item.categories) && item.categories[0]) {
      return item.categories[0].name || item.categories[0].title || item.categories[0];
    }
    return "Deals";
  }

  function normalizeProduct(item, index) {
    const price = Number(item.price || item.sale_price || item.selling_price || item.final_price || 0);
    const mrp = Number(item.mrp || item.regular_price || item.compare_at_price || item.original_price || price);
    const category = firstCategory(item);
    const tags = Array.isArray(item.tags)
      ? item.tags.map((tag) => tag.name || tag.title || tag)
      : [category];

    return {
      id: String(item.id || item.product_id || item.sku || `remote-${index}`),
      sourceId: item.id || item.product_id || item.sku || null,
      title: item.title || item.name || "Product",
      category,
      price: price || mrp || 0,
      mrp: mrp || price || 0,
      rating: Number(item.rating || item.average_rating || 4.1),
      reviews: Number(item.reviews || item.rating_count || item.review_count || 0),
      delivery: item.delivery || item.shipping_text || "Delivery available",
      tags: [...new Set(["Deals", category, ...tags].filter(Boolean))],
      image: firstImage(item),
      stock: item.stock_status || item.in_stock || item.stock || "available"
    };
  }

  async function fetchProducts() {
    if (!hasEndpoint(config.productsEndpoint)) return [];
    const payload = await request(config.productsEndpoint);
    return asArray(payload).map(normalizeProduct).filter((product) => product.price > 0);
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

  window.BazaarGoApi = {
    config,
    fetchProducts,
    requestOtp,
    verifyOtp,
    createPaymentOrder,
    verifyPayment,
    pushOrder,
    fetchOrders,
    hasEndpoint
  };
})();
