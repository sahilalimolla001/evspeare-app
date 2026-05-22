const storageKeys = {
  session: "bazaarGo.session",
  cart: "bazaarGo.cart",
  wishlist: "bazaarGo.wishlist",
  orders: "bazaarGo.orders"
};

const fallbackCategoryImages = {
  Motors: "https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?auto=format&fit=crop&w=160&q=80",
  Lights: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=160&q=80",
  Parts: "https://images.unsplash.com/photo-1581092921461-39b9d08a9b21?auto=format&fit=crop&w=160&q=80",
  Deals: "https://images.unsplash.com/photo-1607082350899-7e105aa886ae?auto=format&fit=crop&w=160&q=80"
};

let products = [];
let categories = buildCategories(products);

const api = window.BazaarGoApi;
const appConfig = window.EVSPEARE_CONFIG || window.BAZAARGO_CONFIG || {};
const currency = new Intl.NumberFormat("en-IN");

const promoSlides = [
  {
    kicker: "Warehouse direct",
    title: "EV spare parts",
    copy: "Motors, rims, lights and service parts dispatched fast",
    terms: "Terms and conditions apply. Stock depends on warehouse availability.",
    image: "https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?auto=format&fit=crop&w=420&q=80"
  },
  {
    kicker: "COD available",
    title: "Order with trust",
    copy: "Pay online through PayU or choose Cash on Delivery",
    terms: "COD availability may vary by pincode and order value.",
    image: "https://images.unsplash.com/photo-1581092921461-39b9d08a9b21?auto=format&fit=crop&w=420&q=80"
  },
  {
    kicker: "Live tracking",
    title: "Warehouse updates",
    copy: "Track order progress from picked to delivered",
    terms: "Tracking updates depend on warehouse system sync.",
    image: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=420&q=80"
  }
];

const state = {
  query: "",
  activeFilter: "All",
  sortAscending: true,
  cart: new Map(loadJson(storageKeys.cart, [])),
  wishlist: new Set(loadJson(storageKeys.wishlist, [])),
  session: loadJson(storageKeys.session, null),
  pendingPhone: "",
  paymentMethod: "cod",
  syncing: false,
  selectedProductId: "",
  orders: loadJson(storageKeys.orders, []),
  ordersLoading: false,
  promoIndex: 0
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
  checkoutButton: document.querySelector("[data-action='checkout']"),
  requestOtpButton: document.querySelector("[data-action='request-otp']"),
  productPage: document.querySelector("[data-product-page]"),
  cartPage: document.querySelector("[data-cart-page]"),
  checkoutPage: document.querySelector("[data-checkout-page]"),
  ordersPage: document.querySelector("[data-orders-page]"),
  promoKicker: document.querySelector("[data-promo-kicker]"),
  promoTitle: document.querySelector("[data-promo-title]"),
  promoCopy: document.querySelector("[data-promo-copy]"),
  promoTerms: document.querySelector("[data-promo-terms]"),
  promoImage: document.querySelector("[data-promo-image]"),
  promoDots: document.querySelector("[data-promo-dots]")
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

function productImageFallback(title = "EV Spare") {
  const initials = String(title)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "EV";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
      <rect width="640" height="480" fill="#eef4ff"/>
      <circle cx="320" cy="220" r="96" fill="#2874f0" opacity=".14"/>
      <path d="M205 285h230l36 55H169l36-55Z" fill="#172033" opacity=".9"/>
      <path d="M232 164h176l46 100H186l46-100Z" fill="#2874f0"/>
      <path d="M242 190h156l24 50H218l24-50Z" fill="#ffffff" opacity=".9"/>
      <text x="320" y="383" text-anchor="middle" font-family="Arial, sans-serif" font-size="54" font-weight="800" fill="#172033">${initials}</text>
      <text x="320" y="426" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#627086">Ev Speare</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function imageAttrs(product) {
  const src = escapeHtml(product.image || productImageFallback(product.title));
  const fallback = escapeHtml(productImageFallback(product.title));
  return `src="${src}" onerror="this.onerror=null;this.src='${fallback}'"`;
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

function stockQuantity(product) {
  if (product?.stockQuantity === null || product?.stockQuantity === undefined || product?.stockQuantity === "") return null;
  const parsed = Number(product.stockQuantity);
  return Number.isFinite(parsed) ? parsed : null;
}

function isProductAvailable(product) {
  if (!product) return false;
  const quantity = stockQuantity(product);
  const status = String(product.stock || "").toLowerCase();
  if (quantity !== null) return quantity > 0;
  return !["out_of_stock", "out of stock", "sold_out", "sold out", "unavailable"].includes(status);
}

function stockLabel(product) {
  const quantity = stockQuantity(product);
  if (!isProductAvailable(product)) return "Out of stock";
  if (quantity !== null) return `${quantity} in warehouse`;
  return "In stock";
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
          <img src="${escapeHtml(category.image)}" alt="${escapeHtml(category.name)}" onerror="this.onerror=null;this.src='${escapeHtml(productImageFallback(category.name))}'" />
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
  const available = isProductAvailable(product);

  return `
    <article class="product-card ${available ? "" : "out-of-stock"}" data-open-product="${escapeHtml(product.id)}">
      <div class="product-media">
        <img ${imageAttrs(product)} alt="${escapeHtml(product.title)}" loading="lazy" />
        <span class="stock-badge ${available ? "in" : "out"}">${escapeHtml(stockLabel(product))}</span>
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
          <button class="add-button" type="button" data-add-cart="${escapeHtml(product.id)}" ${available ? "" : "disabled"}>${available ? "Add to cart" : "Out of stock"}</button>
          <button class="buy-button" type="button" aria-label="Buy ${escapeHtml(product.title)}" data-buy-now="${escapeHtml(product.id)}" ${available ? "" : "disabled"}>
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
                <img ${imageAttrs(item)} alt="${escapeHtml(item.title)}" />
                <div>
                  <h3>${escapeHtml(item.title)}</h3>
                  <p>${formatPrice(item.price)} x ${item.quantity}</p>
                  <div class="qty-row">
                    <div class="qty-control" aria-label="Quantity for ${escapeHtml(item.title)}">
                      <button type="button" data-decrease="${escapeHtml(item.id)}" aria-label="Decrease quantity">-</button>
                      <span>${item.quantity}</span>
                      <button type="button" data-increase="${escapeHtml(item.id)}" aria-label="Increase quantity" ${stockQuantity(item) !== null && item.quantity >= stockQuantity(item) ? "disabled" : ""}>+</button>
                    </div>
                    <button class="remove-button" type="button" data-remove="${escapeHtml(item.id)}">Remove</button>
                  </div>
                </div>
              </article>
            `
          )
          .join("");

  if (nodes.cartPage) renderCartPage();
}

function renderBadges() {
  nodes.wishlistCount.textContent = state.wishlist.size;
}

function renderSession() {
  const loggedIn = isLoggedIn();
  const phone = state.session?.user?.phone || "";

  nodes.accountPill.hidden = loggedIn;
  nodes.accountPill.textContent = "Login";
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

  document.querySelectorAll("[data-page-gateway-note]").forEach((node) => {
    node.textContent = nodes.gatewayNote.textContent;
  });
}

function openPage(name) {
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    const active = panel.dataset.pagePanel === name;
    panel.classList.toggle("open", active);
    panel.setAttribute("aria-hidden", active ? "false" : "true");
  });
}

function closePages() {
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  });
}

function renderPromo() {
  const slide = promoSlides[state.promoIndex % promoSlides.length];
  nodes.promoKicker.textContent = slide.kicker;
  nodes.promoTitle.textContent = slide.title;
  nodes.promoCopy.textContent = slide.copy;
  nodes.promoTerms.textContent = slide.terms;
  nodes.promoImage.src = slide.image;
  nodes.promoImage.onerror = () => {
    nodes.promoImage.onerror = null;
    nodes.promoImage.src = productImageFallback(slide.title);
  };
  nodes.promoDots.innerHTML = promoSlides
    .map((_, index) => `<span class="${index === state.promoIndex ? "active" : ""}"></span>`)
    .join("");
}

function renderProductPage(productId) {
  const product = productById(productId);
  if (!product) return;
  state.selectedProductId = product.id;
  const off = discount(product);
  const available = isProductAvailable(product);

  nodes.productPage.innerHTML = `
    <div class="page-header">
      <button class="icon-button" type="button" data-action="close-page" aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      <div><h2>Product details</h2><span>${escapeHtml(product.category || "Parts")}</span></div>
      <button class="icon-button" type="button" data-wishlist="${escapeHtml(product.id)}" aria-label="Wishlist">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" /></svg>
      </button>
    </div>
    <div class="detail-media"><img ${imageAttrs(product)} alt="${escapeHtml(product.title)}" /></div>
    <div class="detail-body">
      <h1>${escapeHtml(product.title)}</h1>
      <div class="rating-row"><span class="rating-pill">${escapeHtml(product.rating || "4.1")}</span><span>${currency.format(product.reviews || 0)} ratings</span></div>
      <div class="price-row detail-price">
        <strong>${formatPrice(product.price)}</strong>
        ${product.mrp > product.price ? `<del>${formatPrice(product.mrp)}</del>` : ""}
        ${off ? `<span>${off}% off</span>` : ""}
      </div>
      <div class="detail-service">
        <span>Warehouse inventory: ${escapeHtml(stockLabel(product))}</span>
        <span>${escapeHtml(product.delivery || "Delivery available")}</span>
        <span>Secure checkout with COD and PayU</span>
      </div>
      <div class="detail-actions">
        <button class="add-button" type="button" data-add-cart="${escapeHtml(product.id)}" ${available ? "" : "disabled"}>${available ? "Add to cart" : "Out of stock"}</button>
        <button class="checkout-button" type="button" data-buy-now="${escapeHtml(product.id)}" ${available ? "" : "disabled"}>Buy now</button>
      </div>
    </div>
  `;
  openPage("product");
}

function renderCartPage() {
  const totals = cartTotals();
  nodes.cartPage.innerHTML = `
    <div class="page-header">
      <button class="icon-button" type="button" data-action="close-page" aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      <div><h2>Cart</h2><span>${totals.itemCount} ${totals.itemCount === 1 ? "item" : "items"}</span></div>
      <button class="icon-button" type="button" data-action="open-orders" aria-label="Orders">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4V7ZM7 7a5 5 0 0 1 10 0M9 12h6" /></svg>
      </button>
    </div>
    <div class="page-list">
      ${totals.entries.length ? totals.entries.map((item) => `
        <article class="cart-item page-cart-item">
          <img ${imageAttrs(item)} alt="${escapeHtml(item.title)}" />
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${formatPrice(item.price)} x ${item.quantity}</p>
            <div class="qty-row">
              <div class="qty-control">
                <button type="button" data-decrease="${escapeHtml(item.id)}">-</button>
                <span>${item.quantity}</span>
                <button type="button" data-increase="${escapeHtml(item.id)}" ${stockQuantity(item) !== null && item.quantity >= stockQuantity(item) ? "disabled" : ""}>+</button>
              </div>
              <button class="remove-button" type="button" data-remove="${escapeHtml(item.id)}">Remove</button>
            </div>
          </div>
        </article>
      `).join("") : `<div class="cart-empty">Your cart is empty.<br />Add products to start checkout.</div>`}
    </div>
    <div class="page-total">
      <div><span>Subtotal</span><strong>${formatPrice(totals.subtotal)}</strong></div>
      <div><span>Platform fee</span><strong>${formatPrice(totals.platformFee)}</strong></div>
      <div class="total"><span>Total</span><strong>${formatPrice(totals.total)}</strong></div>
    </div>
    <button class="checkout-button" type="button" data-action="open-checkout-page" ${totals.itemCount ? "" : "disabled"}>Continue to checkout</button>
  `;
}

function checkoutField(selector, fallbackNode) {
  return document.querySelector(`[data-page-panel="checkout"] ${selector}`) || fallbackNode;
}

function renderCheckoutPage() {
  const totals = cartTotals();
  const phone = state.session?.user?.phone || nodes.checkoutPhone.value || "";
  const name = nodes.checkoutName.value || state.session?.user?.name || "";
  const address = nodes.checkoutAddress.value || "";

  nodes.checkoutPage.innerHTML = `
    <div class="page-header">
      <button class="icon-button" type="button" data-action="open-cart" aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      <div><h2>Checkout</h2><span>${formatPrice(totals.total)}</span></div>
    </div>
    <form class="checkout-form checkout-page-form" data-page-checkout-form>
      <label>Full name<input type="text" data-page-checkout-name value="${escapeHtml(name)}" placeholder="Customer name" autocomplete="name" /></label>
      <label>Mobile number<input type="tel" data-page-checkout-phone value="${escapeHtml(phone)}" placeholder="10 digit mobile" autocomplete="tel" /></label>
      <label>Delivery address<textarea data-page-checkout-address placeholder="House no, street, city, pincode" rows="4">${escapeHtml(address)}</textarea></label>
      <div class="payment-options" role="radiogroup" aria-label="Payment method">
        <label><input type="radio" name="page-payment" value="cod" ${state.paymentMethod === "cod" ? "checked" : ""} data-payment-method /><span>Cash on Delivery</span></label>
        <label><input type="radio" name="page-payment" value="online" ${state.paymentMethod === "online" ? "checked" : ""} data-payment-method /><span>PayU Online</span></label>
      </div>
      <p class="gateway-note" data-page-gateway-note></p>
    </form>
    <div class="page-total">
      <div><span>Subtotal</span><strong>${formatPrice(totals.subtotal)}</strong></div>
      <div><span>Delivery</span><strong>Free</strong></div>
      <div><span>Platform fee</span><strong>${formatPrice(totals.platformFee)}</strong></div>
      <div class="total"><span>Total</span><strong>${formatPrice(totals.total)}</strong></div>
    </div>
    <button class="checkout-button" type="button" data-action="checkout">${isLoggedIn() ? "Place order" : "Login to place order"}</button>
  `;
  renderGatewayNote();
}

function trackingStepsHtml(order) {
  const steps = order.tracking?.steps || [];
  return `<div class="tracking-steps">${steps.map((step) => `
    <div class="tracking-step ${step.done ? "done" : ""}">
      <span></span><strong>${escapeHtml(step.label)}</strong>
    </div>
  `).join("")}</div>`;
}

function renderOrdersPage() {
  nodes.ordersPage.innerHTML = `
    <div class="page-header">
      <button class="icon-button" type="button" data-action="close-page" aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      <div><h2>Orders</h2><span>Warehouse tracking</span></div>
      <button class="icon-button" type="button" data-action="refresh-orders" aria-label="Refresh orders">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.6 6M3 12a9 9 0 0 1 15.6-6M3 18v-6h6M21 6v6h-6" /></svg>
      </button>
    </div>
    ${state.ordersLoading ? `<div class="cart-empty">Loading orders...</div>` : ""}
    <div class="orders-list">
      ${state.orders.length ? state.orders.map((order) => `
        <article class="order-card">
          <div class="order-head">
            <div><strong>${escapeHtml(order.orderId)}</strong><span>${escapeHtml(new Date(order.createdAt || Date.now()).toLocaleString())}</span></div>
            <b>${formatPrice(order.amountTotal || order.amounts?.total || 0)}</b>
          </div>
          <p>${escapeHtml(order.tracking?.label || order.tracking?.status || order.status || "Order placed")}</p>
          ${trackingStepsHtml(order)}
        </article>
      `).join("") : `<div class="cart-empty">No orders yet.<br />Place an order to track warehouse status.</div>`}
    </div>
  `;
}

function renderAll() {
  renderPromo();
  renderCategories();
  renderFilters();
  renderProducts();
  renderCart();
  renderBadges();
  renderSession();
  renderGatewayNote();
  renderCartPage();
  renderCheckoutPage();
  renderOrdersPage();
}

function setFilter(filter) {
  state.activeFilter = filter;
  renderAll();
}

function addToCart(productId, openCart = false) {
  const product = productById(productId);
  if (!product) return;
  if (!isProductAvailable(product)) {
    showToast("Product is out of stock");
    return;
  }
  const current = state.cart.get(productId) || 0;
  const quantity = stockQuantity(product);
  if (quantity !== null && current >= quantity) {
    showToast(`Only ${quantity} available in warehouse`);
    return;
  }
  state.cart.set(productId, current + 1);
  persistShoppingState();
  renderCart();
  showToast("Added to cart");
  if (openCart) openCartSheet();
}

function openCartSheet() {
  renderCartPage();
  openPage("cart");
}

function closeCartSheet() {
  nodes.cartSheet.classList.remove("open");
  nodes.cartSheet.setAttribute("aria-hidden", "true");
  closePages();
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

function catalogSourceLabel(source) {
  const labels = {
    website: "Website",
    warehouse: "Warehouse",
    database: "Database",
    website_not_configured: "Website import URL missing",
    api_not_configured: "API not configured"
  };
  return labels[source] || "Live catalog";
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
    const catalog = api.fetchCatalog
      ? await api.fetchCatalog()
      : { source: "website", products: await api.fetchProducts() };
    const remoteProducts = catalog.products || [];
    const sourceLabel = catalogSourceLabel(catalog.source);

    if (remoteProducts.length) {
      products = remoteProducts;
      categories = buildCategories(products);
      state.activeFilter = "All";
      setSyncStatus(`${sourceLabel} synced: ${remoteProducts.length} products`);
      if (!silent) showToast(`Products imported from ${sourceLabel.toLowerCase()}`);
    } else {
      products = [];
      categories = [];
      state.activeFilter = "All";
      const message = catalog.source === "website_not_configured" || catalog.source === "api_not_configured"
        ? sourceLabel
        : `No products found from ${sourceLabel.toLowerCase()}`;
      setSyncStatus(message);
      if (!silent) showToast(message);
    }
    renderAll();
  } catch (error) {
    console.error(error);
    products = [];
    categories = [];
    state.activeFilter = "All";
    renderAll();
    setSyncStatus("Product sync failed");
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
    nodes.loginPhone.disabled = true;
    nodes.requestOtpButton.hidden = true;
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
  nodes.loginPhone.disabled = false;
  nodes.requestOtpButton.hidden = false;
  renderAll();
  closeAccount();
  showToast("Logged out");
}

function validateCheckout() {
  const nameNode = checkoutField("[data-page-checkout-name]", nodes.checkoutName);
  const phoneNode = checkoutField("[data-page-checkout-phone]", nodes.checkoutPhone);
  const addressNode = checkoutField("[data-page-checkout-address]", nodes.checkoutAddress);
  const phone = phoneDigits(phoneNode.value || state.session?.user?.phone);
  const name = String(nameNode.value || state.session?.user?.name || "").trim();
  const address = String(addressNode.value || "").trim();

  if (!isLoggedIn()) {
    openAccount();
    showToast("Login required before placing order");
    return null;
  }

  for (const item of cartTotals().entries) {
    if (!isProductAvailable(item)) {
      showToast(`${item.title} is out of stock`);
      return null;
    }
    const quantity = stockQuantity(item);
    if (quantity !== null && item.quantity > quantity) {
      showToast(`Only ${quantity} ${item.title} available`);
      return null;
    }
  }

  if (!name) {
    showToast("Enter customer name");
    nameNode.focus();
    return null;
  }

  if (phone.length !== 10) {
    showToast("Enter valid mobile number");
    phoneNode.focus();
    return null;
  }

  if (address.length < 12) {
    showToast("Enter full delivery address");
    addressNode.focus();
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
      total: item.price * item.quantity,
      stockQuantity: stockQuantity(item)
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
    saveLocalOrder({
      ...order,
      amountTotal: order.amounts.total,
      paymentMethod: order.payment.method,
      paymentStatus: order.payment.status,
      tracking: {
        status: "placed",
        label: response.warehousePushed ? "Sent to warehouse" : "Order placed",
        steps: [
          { key: "placed", label: "Order placed", done: true },
          { key: "picked", label: "Warehouse picked", done: false },
          { key: "shipped", label: "Shipped", done: false },
          { key: "out_for_delivery", label: "Out for delivery", done: false },
          { key: "delivered", label: "Delivered", done: false }
        ]
      }
    });
    state.cart.clear();
    persistShoppingState();
    renderAll();
    closeCartSheet();
    await loadOrders({ silent: true });
    renderOrdersPage();
    openPage("orders");
    showToast(response.warehousePushed ? "Order sent to warehouse" : "Order placed successfully");
  } catch (error) {
    showToast(error.message || "Order failed");
  } finally {
    nodes.checkoutButton.disabled = cartTotals().itemCount === 0;
    nodes.checkoutButton.textContent = isLoggedIn() ? "Place order" : "Login to place order";
  }
}

function saveLocalOrder(order) {
  state.orders = [order, ...state.orders.filter((item) => item.orderId !== order.orderId)].slice(0, 50);
  saveJson(storageKeys.orders, state.orders);
}

async function loadOrders({ silent = false } = {}) {
  if (!isLoggedIn()) {
    if (!silent) openAccount();
    return;
  }

  state.ordersLoading = true;
  renderOrdersPage();
  try {
    const response = await api.fetchOrders();
    if (Array.isArray(response.orders)) {
      if (response.orders.length || !state.orders.length) {
        state.orders = response.orders;
        saveJson(storageKeys.orders, state.orders);
      }
    }
  } catch (error) {
    if (!silent) showToast(error.message || "Orders not available");
  } finally {
    state.ordersLoading = false;
    renderOrdersPage();
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
    loadOrders({ silent: true });
    openPage("orders");
    showToast("Payment successful. Order placed.");
  } else if (status === "failure") {
    showToast("Payment failed or cancelled");
  } else if (status === "order-push-failed") {
    showToast("Payment captured. Order push needs backend check.");
  }

  window.history.replaceState({}, document.title, window.location.pathname);
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, [data-action], [data-filter-chip], [data-open-product]");
  if (!target) return;

  const filter = target.dataset.filterChip;
  const openProductId = target.dataset.openProduct;
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

  if (openProductId && !target.dataset.addCart && !target.dataset.buyNow && !target.dataset.wishlist) {
    renderProductPage(openProductId);
  }

  if (addId) addToCart(addId);
  if (buyId) {
    addToCart(buyId);
    if (isLoggedIn()) {
      renderCheckoutPage();
      openPage("checkout");
    } else {
      openAccount();
    }
  }

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
    addToCart(increaseId);
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
    case "open-checkout-page":
      if (!isLoggedIn()) {
        openAccount();
      } else {
        renderCheckoutPage();
        openPage("checkout");
      }
      break;
    case "open-orders":
      renderOrdersPage();
      openPage("orders");
      await loadOrders({ silent: true });
      closeDrawer();
      break;
    case "refresh-orders":
      await loadOrders();
      break;
    case "close-page":
      closePages();
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
      renderCheckoutPage();
      openPage("checkout");
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
      closePages();
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
      renderOrdersPage();
      openPage("orders");
      await loadOrders({ silent: true });
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
    closePages();
  }
});

if (state.session?.user?.phone) {
  nodes.checkoutPhone.value = state.session.user.phone;
  nodes.checkoutName.value = state.session.user.name || "";
}

renderAll();
syncProducts({ silent: true });
handlePaymentReturn();
setInterval(() => {
  state.promoIndex = (state.promoIndex + 1) % promoSlides.length;
  renderPromo();
}, 4500);
if (isLoggedIn()) {
  loadOrders({ silent: true });
}
