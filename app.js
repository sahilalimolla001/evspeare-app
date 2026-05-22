const storageKeys = {
  session: "bazaarGo.session",
  cart: "bazaarGo.cart",
  wishlist: "bazaarGo.wishlist"
};

const fallbackProducts = [
  {
    id: "phone-edge",
    sourceId: "phone-edge",
    title: "Nova Edge 5G, 128 GB, AMOLED Display",
    category: "Mobiles",
    price: 18999,
    mrp: 24999,
    rating: 4.4,
    reviews: 4821,
    delivery: "Free delivery by tomorrow",
    tags: ["Deals", "Mobiles"],
    image: "https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=420&q=80"
  },
  {
    id: "headphones-pro",
    sourceId: "headphones-pro",
    title: "BassPro Wireless ANC Headphones",
    category: "Mobiles",
    price: 2499,
    mrp: 5999,
    rating: 4.2,
    reviews: 9810,
    delivery: "Free delivery in 2 days",
    tags: ["Deals", "Mobiles"],
    image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=420&q=80"
  },
  {
    id: "sneakers-run",
    sourceId: "sneakers-run",
    title: "StreetRun Lightweight Sneakers",
    category: "Fashion",
    price: 1299,
    mrp: 2999,
    rating: 4.1,
    reviews: 2109,
    delivery: "Exchange available",
    tags: ["Fashion", "Deals"],
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=420&q=80"
  },
  {
    id: "kurta-set",
    sourceId: "kurta-set",
    title: "Cotton Festive Kurta Set",
    category: "Fashion",
    price: 899,
    mrp: 1999,
    rating: 4.3,
    reviews: 1204,
    delivery: "Free delivery by Monday",
    tags: ["Fashion"],
    image: "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=420&q=80"
  },
  {
    id: "mixer-grind",
    sourceId: "mixer-grind",
    title: "TurboMix 750W Mixer Grinder",
    category: "Appliances",
    price: 2199,
    mrp: 4099,
    rating: 4,
    reviews: 642,
    delivery: "Installation support included",
    tags: ["Appliances", "Deals"],
    image: "https://images.unsplash.com/photo-1570222094114-d054a817e56b?auto=format&fit=crop&w=420&q=80"
  },
  {
    id: "air-fryer",
    sourceId: "air-fryer",
    title: "CrispAir 4L Digital Air Fryer",
    category: "Appliances",
    price: 4999,
    mrp: 8999,
    rating: 4.5,
    reviews: 3156,
    delivery: "No-cost EMI available",
    tags: ["Appliances"],
    image: "https://images.unsplash.com/photo-1647606694336-3fb8b99394a1?auto=format&fit=crop&w=420&q=80"
  },
  {
    id: "grocery-pack",
    sourceId: "grocery-pack",
    title: "Monthly Grocery Saver Pack",
    category: "Grocery",
    price: 1499,
    mrp: 2050,
    rating: 4.6,
    reviews: 759,
    delivery: "Fresh delivery today",
    tags: ["Grocery", "Deals"],
    image: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=420&q=80"
  },
  {
    id: "skin-care",
    sourceId: "skin-care",
    title: "GlowCare Daily Skincare Combo",
    category: "Beauty",
    price: 699,
    mrp: 1399,
    rating: 4.3,
    reviews: 4420,
    delivery: "Free delivery in 2 days",
    tags: ["Beauty"],
    image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=420&q=80"
  },
  {
    id: "lamp-home",
    sourceId: "lamp-home",
    title: "WarmGlow Bedside Table Lamp",
    category: "Home",
    price: 1199,
    mrp: 2499,
    rating: 4.2,
    reviews: 534,
    delivery: "Free delivery by Sunday",
    tags: ["Home"],
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=420&q=80"
  },
  {
    id: "backpack",
    sourceId: "backpack",
    title: "OfficeMate Waterproof Laptop Backpack",
    category: "Fashion",
    price: 999,
    mrp: 2199,
    rating: 4.4,
    reviews: 8088,
    delivery: "Flip-safe replacement",
    tags: ["Fashion", "Deals"],
    image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=420&q=80"
  }
];

const fallbackCategoryImages = {
  Mobiles: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=160&q=80",
  Fashion: "https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=160&q=80",
  Appliances: "https://images.unsplash.com/photo-1581090464777-f3220bbe1b8b?auto=format&fit=crop&w=160&q=80",
  Grocery: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=160&q=80",
  Beauty: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=160&q=80",
  Home: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=160&q=80",
  Deals: "https://images.unsplash.com/photo-1607082350899-7e105aa886ae?auto=format&fit=crop&w=160&q=80"
};

let products = [...fallbackProducts];
let categories = buildCategories(products);

const api = window.BazaarGoApi;
const appConfig = window.EVSPEARE_CONFIG || window.BAZAARGO_CONFIG || {};
const currency = new Intl.NumberFormat("en-IN");

const state = {
  query: "",
  activeFilter: "All",
  sortAscending: true,
  cart: new Map(loadJson(storageKeys.cart, [])),
  wishlist: new Set(loadJson(storageKeys.wishlist, [])),
  session: loadJson(storageKeys.session, null),
  pendingPhone: "",
  paymentMethod: "cod",
  syncing: false
};

const nodes = {
  categoryRail: document.querySelector("[data-category-rail]"),
  filterRow: document.querySelector("[data-filter-row]"),
  productGrid: document.querySelector("[data-product-grid]"),
  emptyState: document.querySelector("[data-empty-state]"),
  searchForm: document.querySelector("[data-search-form]"),
  searchInput: document.querySelector("[data-search-input]"),
  cartSheet: document.querySelector("[data-cart-sheet]"),
  cartItems: document.querySelector("[data-cart-items]"),
  cartCount: document.querySelector("[data-cart-count]"),
  cartSummary: document.querySelector("[data-cart-summary]"),
  wishlistCount: document.querySelector("[data-wishlist-count]"),
  subtotal: document.querySelector("[data-subtotal]"),
  total: document.querySelector("[data-total]"),
  priceBox: document.querySelector("[data-price-box]"),
  drawer: document.querySelector("[data-drawer]"),
  toast: document.querySelector("[data-toast]"),
  syncStatus: document.querySelector("[data-sync-status]"),
  accountPill: document.querySelector("[data-account-pill]"),
  authModal: document.querySelector("[data-auth-modal]"),
  authLogin: document.querySelector("[data-auth-login]"),
  authProfile: document.querySelector("[data-auth-profile]"),
  authTitle: document.querySelector("[data-auth-title]"),
  authSubtitle: document.querySelector("[data-auth-subtitle]"),
  loginPhone: document.querySelector("[data-login-phone]"),
  loginOtp: document.querySelector("[data-login-otp]"),
  otpPanel: document.querySelector("[data-otp-panel]"),
  profilePhone: document.querySelector("[data-profile-phone]"),
  checkoutForm: document.querySelector("[data-checkout-form]"),
  checkoutName: document.querySelector("[data-checkout-name]"),
  checkoutPhone: document.querySelector("[data-checkout-phone]"),
  checkoutAddress: document.querySelector("[data-checkout-address]"),
  gatewayNote: document.querySelector("[data-gateway-note]"),
  checkoutButton: document.querySelector("[data-action='checkout']")
};

function loadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.warn(`Unable to load ${key}`, error);
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrice(value) {
  return `Rs. ${currency.format(Math.round(Number(value) || 0))}`;
}

function discount(product) {
  if (!product.mrp || product.mrp <= product.price) return 0;
  return Math.round(((product.mrp - product.price) / product.mrp) * 100);
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function isLoggedIn() {
  return Boolean(state.session?.token && state.session?.user?.phone);
}

function persistShoppingState() {
  saveJson(storageKeys.cart, Array.from(state.cart.entries()));
  saveJson(storageKeys.wishlist, Array.from(state.wishlist));
}

function buildCategories(sourceProducts) {
  const map = new Map();
  sourceProducts.forEach((product) => {
    const name = product.category || "Deals";
    if (!map.has(name)) {
      map.set(name, {
        name,
        image: fallbackCategoryImages[name] || product.image || fallbackCategoryImages.Deals
      });
    }
  });
  return Array.from(map.values());
}

function productById(productId) {
  return products.find((product) => String(product.id) === String(productId));
}

function filteredProducts() {
  const text = state.query.trim().toLowerCase();
  const selected = state.activeFilter;

  return products
    .filter((product) => {
      const matchesText = [product.title, product.category, ...(product.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(text);
      const matchesWishlist = selected === "Wishlist" && state.wishlist.has(product.id);
      const matchesFilter =
        selected === "All" ||
        matchesWishlist ||
        product.category === selected ||
        (product.tags || []).includes(selected);

      return matchesText && matchesFilter;
    })
    .sort((a, b) => (state.sortAscending ? a.price - b.price : b.price - a.price));
}

function renderCategories() {
  nodes.categoryRail.innerHTML = categories
    .map(
      (category) => `
        <button class="category-card ${state.activeFilter === category.name ? "active" : ""}" type="button" data-filter-chip="${escapeHtml(category.name)}">
          <img src="${escapeHtml(category.image)}" alt="${escapeHtml(category.name)}" />
          <span>${escapeHtml(category.name)}</span>
        </button>
      `
    )
    .join("");
}

function renderFilters() {
  const filters = ["All", "Deals", "Wishlist", ...categories.map((category) => category.name)];
  nodes.filterRow.innerHTML = [...new Set(filters)]
    .map(
      (filter) => `
        <button class="filter-chip ${state.activeFilter === filter ? "active" : ""}" type="button" data-filter-chip="${escapeHtml(filter)}">
          ${escapeHtml(filter)}
        </button>
      `
    )
    .join("");
}

function productCard(product) {
  const wished = state.wishlist.has(product.id);
  const off = discount(product);

  return `
    <article class="product-card">
      <div class="product-media">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" loading="lazy" />
        <button class="wishlist-button ${wished ? "active" : ""}" type="button" aria-label="Add ${escapeHtml(product.title)} to wishlist" data-wishlist="${escapeHtml(product.id)}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
          </svg>
        </button>
      </div>
      <div class="product-body">
        <h3 class="product-title">${escapeHtml(product.title)}</h3>
        <div class="rating-row">
          <span class="rating-pill">${escapeHtml(product.rating || "4.1")}</span>
          <span>${currency.format(product.reviews || 0)} ratings</span>
        </div>
        <div class="price-row">
          <strong>${formatPrice(product.price)}</strong>
          ${product.mrp > product.price ? `<del>${formatPrice(product.mrp)}</del>` : ""}
          ${off ? `<span>${off}% off</span>` : ""}
        </div>
        <p class="delivery-line">${escapeHtml(product.delivery || "Delivery available")}</p>
        <div class="card-actions">
          <button class="add-button" type="button" data-add-cart="${escapeHtml(product.id)}">Add to cart</button>
          <button class="buy-button" type="button" aria-label="Buy ${escapeHtml(product.title)}" data-buy-now="${escapeHtml(product.id)}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const result = filteredProducts();
  nodes.productGrid.innerHTML = result.map(productCard).join("");
  nodes.emptyState.hidden = result.length > 0;
}

function cartEntries() {
  return Array.from(state.cart.entries())
    .map(([id, quantity]) => {
      const product = productById(id);
      return product ? { ...product, quantity } : null;
    })
    .filter(Boolean);
}

function cartTotals() {
  const entries = cartEntries();
  const itemCount = entries.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = entries.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const platformFee = itemCount ? 9 : 0;
  const delivery = 0;

  return {
    entries,
    itemCount,
    subtotal,
    platformFee,
    delivery,
    total: subtotal + platformFee + delivery
  };
}

function renderCart() {
  const totals = cartTotals();
  const { entries, itemCount, subtotal, total } = totals;

  nodes.cartCount.textContent = itemCount;
  nodes.cartSummary.textContent = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
  nodes.priceBox.hidden = itemCount === 0;
  nodes.checkoutForm.hidden = itemCount === 0;
  nodes.subtotal.textContent = formatPrice(subtotal);
  nodes.total.textContent = formatPrice(total);
  nodes.checkoutButton.disabled = itemCount === 0;
  nodes.checkoutButton.textContent = isLoggedIn() ? "Place order" : "Login to place order";

  nodes.cartItems.innerHTML =
    entries.length === 0
      ? `<div class="cart-empty">Your cart is empty.<br />Add products to start checkout.</div>`
      : entries
          .map(
            (item) => `
              <article class="cart-item">
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" />
                <div>
                  <h3>${escapeHtml(item.title)}</h3>
                  <p>${formatPrice(item.price)} x ${item.quantity}</p>
                  <div class="qty-row">
                    <div class="qty-control" aria-label="Quantity for ${escapeHtml(item.title)}">
                      <button type="button" data-decrease="${escapeHtml(item.id)}" aria-label="Decrease quantity">-</button>
                      <span>${item.quantity}</span>
                      <button type="button" data-increase="${escapeHtml(item.id)}" aria-label="Increase quantity">+</button>
                    </div>
                    <button class="remove-button" type="button" data-remove="${escapeHtml(item.id)}">Remove</button>
                  </div>
                </div>
              </article>
            `
          )
          .join("");
}

function renderBadges() {
  nodes.wishlistCount.textContent = state.wishlist.size;
}

function renderSession() {
  const loggedIn = isLoggedIn();
  const phone = state.session?.user?.phone || "";

  nodes.accountPill.textContent = loggedIn ? `+91 ${phone.slice(-4)}` : "Login";
  nodes.authLogin.hidden = loggedIn;
  nodes.authProfile.hidden = !loggedIn;
  nodes.authTitle.textContent = loggedIn ? "Your profile" : "OTP login";
  nodes.authSubtitle.textContent = loggedIn
    ? "You stay logged in until logout"
    : "Login stays active until you logout";
  nodes.profilePhone.textContent = loggedIn ? `+91 ${phone}` : "Customer";

  if (loggedIn && !nodes.checkoutPhone.value) {
    nodes.checkoutPhone.value = phone;
  }
}

function renderGatewayNote() {
  const hasKey = Boolean(appConfig.paymentGateway?.keyId);
  const hasPaymentServer = api?.hasEndpoint?.(appConfig.paymentCreateEndpoint);

  if (state.paymentMethod === "cod") {
    nodes.gatewayNote.textContent = "COD order will be pushed to your website as pending payment.";
  } else if (hasKey && hasPaymentServer) {
    nodes.gatewayNote.textContent = "Online payment will open PayU secure checkout.";
  } else if (appConfig.demo?.allowDemoPayment) {
    nodes.gatewayNote.textContent = "Demo online payment is enabled. Configure gateway keys before going live.";
  } else {
    nodes.gatewayNote.textContent = "Online payment needs PayU key/salt on Railway.";
  }
}

function renderAll() {
  renderCategories();
  renderFilters();
  renderProducts();
  renderCart();
  renderBadges();
  renderSession();
  renderGatewayNote();
}

function setFilter(filter) {
  state.activeFilter = filter;
  renderAll();
}

function addToCart(productId, openCart = false) {
  if (!productById(productId)) return;
  state.cart.set(productId, (state.cart.get(productId) || 0) + 1);
  persistShoppingState();
  renderCart();
  showToast("Added to cart");
  if (openCart) openCartSheet();
}

function openCartSheet() {
  nodes.cartSheet.classList.add("open");
  nodes.cartSheet.setAttribute("aria-hidden", "false");
}

function closeCartSheet() {
  nodes.cartSheet.classList.remove("open");
  nodes.cartSheet.setAttribute("aria-hidden", "true");
}

function openDrawer() {
  nodes.drawer.classList.add("open");
  nodes.drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  nodes.drawer.classList.remove("open");
  nodes.drawer.setAttribute("aria-hidden", "true");
}

function openAccount() {
  renderSession();
  nodes.authModal.classList.add("open");
  nodes.authModal.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    if (isLoggedIn()) return;
    nodes.loginPhone.focus();
  }, 80);
}

function closeAccount() {
  nodes.authModal.classList.remove("open");
  nodes.authModal.setAttribute("aria-hidden", "true");
}

function showToast(message) {
  nodes.toast.textContent = message;
  nodes.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => nodes.toast.classList.remove("show"), 2200);
}

function setSyncStatus(message) {
  nodes.syncStatus.textContent = message;
}

function setActiveNav(name) {
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === name);
  });
}

function scrollToSelector(selector) {
  document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function syncProducts({ silent = false } = {}) {
  if (!api) return;
  if (state.syncing) return;

  state.syncing = true;
  setSyncStatus("Syncing products...");

  try {
    const remoteProducts = await api.fetchProducts();
    if (remoteProducts.length) {
      products = remoteProducts;
      categories = buildCategories(products);
      state.activeFilter = "All";
      setSyncStatus(`Live catalog synced: ${remoteProducts.length} products`);
      if (!silent) showToast("Products imported from website");
    } else {
      setSyncStatus("Demo catalog active - add website API URL");
      if (!silent) showToast("Add API URL in config.js to import products");
    }
    renderAll();
  } catch (error) {
    console.error(error);
    setSyncStatus("Product sync failed - demo catalog active");
    if (!silent) showToast(error.message || "Product sync failed");
  } finally {
    state.syncing = false;
  }
}

async function requestOtp() {
  const phone = phoneDigits(nodes.loginPhone.value);
  if (phone.length !== 10) {
    showToast("Enter valid 10 digit mobile number");
    return;
  }

  state.pendingPhone = phone;
  try {
    await api.requestOtp(phone);
    nodes.otpPanel.hidden = false;
    nodes.loginOtp.value = "";
    nodes.loginOtp.focus();
    showToast(appConfig.demo?.enabled ? "Demo OTP: 123456" : "OTP sent");
  } catch (error) {
    showToast(error.message || "Unable to send OTP");
  }
}

async function verifyOtp() {
  const phone = state.pendingPhone || phoneDigits(nodes.loginPhone.value);
  const otp = String(nodes.loginOtp.value || "").trim();
  if (phone.length !== 10 || otp.length < 4) {
    showToast("Enter mobile number and OTP");
    return;
  }

  try {
    const response = await api.verifyOtp(phone, otp);
    state.session = {
      token: response.token || response.access_token || `session-${Date.now()}`,
      user: {
        id: response.user?.id || phone,
        name: response.user?.name || "Customer",
        phone: response.user?.phone || phone
      },
      loggedInAt: new Date().toISOString()
    };
    saveJson(storageKeys.session, state.session);
    renderAll();
    closeAccount();
    showToast("Login successful");
  } catch (error) {
    showToast(error.message || "OTP verification failed");
  }
}

function logout() {
  state.session = null;
  localStorage.removeItem(storageKeys.session);
  nodes.loginOtp.value = "";
  nodes.otpPanel.hidden = true;
  renderAll();
  closeAccount();
  showToast("Logged out");
}

function validateCheckout() {
  const phone = phoneDigits(nodes.checkoutPhone.value || state.session?.user?.phone);
  const name = String(nodes.checkoutName.value || state.session?.user?.name || "").trim();
  const address = String(nodes.checkoutAddress.value || "").trim();

  if (!isLoggedIn()) {
    openAccount();
    showToast("Login required before placing order");
    return null;
  }

  if (!name) {
    showToast("Enter customer name");
    nodes.checkoutName.focus();
    return null;
  }

  if (phone.length !== 10) {
    showToast("Enter valid mobile number");
    nodes.checkoutPhone.focus();
    return null;
  }

  if (address.length < 12) {
    showToast("Enter full delivery address");
    nodes.checkoutAddress.focus();
    return null;
  }

  return { name, phone, address };
}

function buildOrder(customer, payment) {
  const totals = cartTotals();
  return {
    orderId: `BG-${Date.now()}`,
    source: "mobile_pwa",
    customer: {
      id: state.session.user.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address
    },
    items: totals.entries.map((item) => ({
      productId: item.sourceId || item.id,
      appProductId: item.id,
      title: item.title,
      price: item.price,
      quantity: item.quantity,
      total: item.price * item.quantity
    })),
    amounts: {
      currency: appConfig.currency || "INR",
      subtotal: totals.subtotal,
      delivery: totals.delivery,
      platformFee: totals.platformFee,
      total: totals.total
    },
    payment,
    status: payment.method === "cod" ? "pending_cod" : "paid",
    createdAt: new Date().toISOString()
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Payment gateway script failed to load"));
    document.head.appendChild(script);
  });
}

function submitPaymentForm(action, fields) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";

  Object.entries(fields || {}).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value == null ? "" : String(value);
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
}

async function runRazorpay(order, gatewayOrder) {
  const gateway = appConfig.paymentGateway || {};
  if (!gateway.keyId) {
    throw new Error("Razorpay keyId missing in config.js");
  }

  await loadScript(gateway.checkoutScript || "https://checkout.razorpay.com/v1/checkout.js");
  if (!window.Razorpay) {
    throw new Error("Razorpay checkout is unavailable");
  }

  const gatewayOrderId = gatewayOrder.gatewayOrderId || gatewayOrder.order_id || gatewayOrder.id;
  if (!gatewayOrderId) {
    throw new Error("Payment order_id missing from server response");
  }

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: gateway.keyId,
      amount: gatewayOrder.amount || order.amounts.total * 100,
      currency: gatewayOrder.currency || order.amounts.currency,
      name: appConfig.businessName || "BazaarGo",
      description: order.orderId,
      order_id: gatewayOrderId,
      prefill: {
        name: order.customer.name,
        contact: order.customer.phone
      },
      theme: { color: "#2874f0" },
      handler: async (response) => {
        try {
          const verification = await api.verifyPayment({
            ...response,
            orderId: order.orderId,
            gatewayOrderId
          });
          if (verification.verified === false) {
            reject(new Error("Payment verification failed"));
            return;
          }
          resolve({
            method: "online",
            gateway: "razorpay",
            status: "paid",
            gatewayOrderId,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
            verified: true
          });
        } catch (error) {
          reject(error);
        }
      },
      modal: {
        ondismiss: () => reject(new Error("Payment cancelled"))
      }
    });

    checkout.open();
  });
}

async function runOnlinePayment(order) {
  const gatewayOrder = await api.createPaymentOrder(order);
  if (gatewayOrder.demo) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    return {
      method: "online",
      gateway: "demo",
      status: "paid",
      gatewayOrderId: gatewayOrder.gatewayOrderId,
      verified: true
    };
  }

  if (appConfig.paymentGateway?.provider === "razorpay") {
    return runRazorpay(order, gatewayOrder);
  }

  if (appConfig.paymentGateway?.provider === "payu" || gatewayOrder.gateway === "payu") {
    if (!gatewayOrder.action || !gatewayOrder.fields) {
      throw new Error("PayU payment form is missing");
    }
    showToast("Redirecting to PayU...");
    submitPaymentForm(gatewayOrder.action, gatewayOrder.fields);
    return new Promise(() => {});
  }

  if (gatewayOrder.redirectUrl) {
    window.location.href = gatewayOrder.redirectUrl;
    throw new Error("Redirecting to payment gateway");
  }

  throw new Error("Unsupported payment gateway response");
}

async function placeOrder() {
  const customer = validateCheckout();
  if (!customer) return;

  const totals = cartTotals();
  if (!totals.itemCount) return;

  nodes.checkoutButton.disabled = true;
  nodes.checkoutButton.textContent = "Processing...";

  try {
    let payment = {
      method: "cod",
      gateway: null,
      status: "pending"
    };

    const draftOrder = buildOrder(customer, payment);
    if (state.paymentMethod === "online") {
      payment = await runOnlinePayment(draftOrder);
    }

    const order = buildOrder(customer, payment);
    const response = await api.pushOrder(order);
    state.cart.clear();
    persistShoppingState();
    renderAll();
    closeCartSheet();
    showToast(response.storedLocally ? "Order saved locally. Configure API to push live." : "Order pushed successfully");
  } catch (error) {
    showToast(error.message || "Order failed");
  } finally {
    nodes.checkoutButton.disabled = cartTotals().itemCount === 0;
    nodes.checkoutButton.textContent = isLoggedIn() ? "Place order" : "Login to place order";
  }
}

function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("payment");
  if (!status) return;

  if (status === "success") {
    state.cart.clear();
    persistShoppingState();
    renderCart();
    showToast("Payment successful. Order placed.");
  } else if (status === "failure") {
    showToast("Payment failed or cancelled");
  } else if (status === "order-push-failed") {
    showToast("Payment captured. Order push needs backend check.");
  }

  window.history.replaceState({}, document.title, window.location.pathname);
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, [data-action], [data-filter-chip]");
  if (!target) return;

  const filter = target.dataset.filterChip;
  const addId = target.dataset.addCart;
  const buyId = target.dataset.buyNow;
  const wishlistId = target.dataset.wishlist;
  const increaseId = target.dataset.increase;
  const decreaseId = target.dataset.decrease;
  const removeId = target.dataset.remove;

  if (filter) {
    setFilter(filter);
    closeDrawer();
  }

  if (addId) addToCart(addId);
  if (buyId) addToCart(buyId, true);

  if (wishlistId) {
    if (state.wishlist.has(wishlistId)) {
      state.wishlist.delete(wishlistId);
      showToast("Removed from wishlist");
    } else {
      state.wishlist.add(wishlistId);
      showToast("Added to wishlist");
    }
    persistShoppingState();
    renderAll();
  }

  if (increaseId) {
    state.cart.set(increaseId, (state.cart.get(increaseId) || 0) + 1);
    persistShoppingState();
    renderCart();
  }

  if (decreaseId) {
    const next = (state.cart.get(decreaseId) || 0) - 1;
    if (next <= 0) state.cart.delete(decreaseId);
    else state.cart.set(decreaseId, next);
    persistShoppingState();
    renderCart();
  }

  if (removeId) {
    state.cart.delete(removeId);
    persistShoppingState();
    renderCart();
  }

  switch (target.dataset.action) {
    case "open-cart":
      openCartSheet();
      break;
    case "close-cart":
      closeCartSheet();
      break;
    case "open-menu":
      openDrawer();
      break;
    case "close-menu":
      closeDrawer();
      break;
    case "open-account":
      openAccount();
      closeDrawer();
      break;
    case "close-account":
      closeAccount();
      break;
    case "request-otp":
      await requestOtp();
      break;
    case "verify-otp":
      await verifyOtp();
      break;
    case "logout":
      logout();
      break;
    case "refresh-products":
      await syncProducts();
      closeDrawer();
      break;
    case "clear-filters":
      setFilter("All");
      break;
    case "sort-products":
      state.sortAscending = !state.sortAscending;
      showToast(state.sortAscending ? "Sorted by low price" : "Sorted by high price");
      renderProducts();
      break;
    case "select-address":
      nodes.checkoutAddress.focus();
      openCartSheet();
      break;
    case "show-wishlist":
      if (state.wishlist.size === 0) {
        showToast("Wishlist is empty");
      } else {
        state.query = "";
        nodes.searchInput.value = "";
        setFilter("Wishlist");
        scrollToSelector("#product-title");
        showToast("Showing wishlist products");
      }
      closeDrawer();
      break;
    case "checkout":
      await placeOrder();
      break;
    default:
      break;
  }

  switch (target.dataset.nav) {
    case "home":
      setActiveNav("home");
      state.query = "";
      nodes.searchInput.value = "";
      setFilter("All");
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;
    case "categories":
      setActiveNav("categories");
      scrollToSelector("#category-title");
      break;
    case "orders":
      setActiveNav("orders");
      showToast("Orders screen ready to connect");
      break;
    case "cart":
      setActiveNav("cart");
      break;
    default:
      break;
  }
});

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-payment-method]")) return;
  state.paymentMethod = event.target.value;
  renderGatewayNote();
});

nodes.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = new FormData(nodes.searchForm).get("search") || "";
  renderProducts();
});

nodes.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderProducts();
});

nodes.checkoutForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCartSheet();
    closeDrawer();
    closeAccount();
  }
});

if (state.session?.user?.phone) {
  nodes.checkoutPhone.value = state.session.user.phone;
  nodes.checkoutName.value = state.session.user.name || "";
}

renderAll();
syncProducts({ silent: true });
handlePaymentReturn();
