const storageKeys = {
  session: "bazaarGo.session",
  cart: "bazaarGo.cart",
  wishlist: "bazaarGo.wishlist",
  orders: "bazaarGo.orders",
  location: "bazaarGo.location"
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
const deliveryEstimateDays = 7;
const codMaxOrderAmount = 1000;

const customerTrackingStages = [
  { key: "placed", label: "Order Placed", offsetDays: 0, icon: "bag" },
  { key: "shipped", label: "Shipped", offsetDays: 2, icon: "box" },
  { key: "transit", label: "In Transit", offsetDays: 4, icon: "truck" },
  { key: "delivered", label: "Delivered", offsetDays: deliveryEstimateDays, icon: "check" }
];

const infoPages = {
  privacy: {
    title: "Privacy Policy",
    subtitle: "How customer data is handled",
    sections: [
      {
        heading: "Information we collect",
        body: "We collect only the details needed to run your shopping experience, including your mobile number, OTP login status, name, delivery address, cart items, order details, payment status, and live location only when you choose to share it."
      },
      {
        heading: "How we use information",
        body: "Your information is used to verify login, confirm orders, arrange delivery, process payments, show order tracking, handle cancellation or return requests, and improve product availability and customer support."
      },
      {
        heading: "Payments and security",
        body: "Online payments are processed through PayU secure checkout. We do not store card, UPI, CVV, net banking, or wallet credentials in this app."
      },
      {
        heading: "Sharing with service partners",
        body: "Order and delivery details may be shared with warehouse, courier, payment, OTP, and website systems only for fulfilment, verification, tracking, payment, or customer support."
      },
      {
        heading: "Data retention",
        body: "Order records are retained as required for customer support, tax, accounting, dispute resolution, fraud prevention, and legal compliance. You may contact support for data correction requests."
      },
      {
        heading: "Customer choice",
        body: "You can logout from the profile section, update delivery details before checkout, and choose whether to share live location. Some services may not work if required details are not provided."
      }
    ]
  },
  terms: {
    title: "Terms and Conditions",
    subtitle: "Rules for using Ev Speare",
    sections: [
      {
        heading: "Acceptance of terms",
        body: "By using Ev Speare, browsing products, logging in, or placing an order, you agree to these terms, our policies, and any applicable warehouse, courier, payment, or platform rules."
      },
      {
        heading: "Product catalogue",
        body: "Product images, descriptions, prices, discounts, stock, and compatibility details are synced from connected catalogue or warehouse systems. We try to keep them accurate, but updates may take time to reflect."
      },
      {
        heading: "Order confirmation",
        body: "An order is confirmed only after stock verification, valid customer details, successful payment where applicable, and acceptance by the seller or warehouse."
      },
      {
        heading: "Customer responsibility",
        body: "You are responsible for entering a correct mobile number, OTP, delivery address, pincode, and part compatibility details. Incorrect details can lead to delay, failed delivery, or non-return eligibility."
      },
      {
        heading: "Cancellation and refusal",
        body: "Orders may be cancelled by the customer before shipment. We may cancel or refuse orders because of stock mismatch, pricing error, payment risk, delivery restrictions, suspected misuse, or incomplete information."
      },
      {
        heading: "Limitation",
        body: "Ev Speare is not responsible for delays caused by courier issues, incorrect address, payment gateway downtime, warehouse dependency, natural events, or third-party service interruptions."
      }
    ]
  },
  shipping: {
    title: "Shipping Policy",
    subtitle: "Dispatch, delivery, and tracking",
    sections: [
      {
        heading: "Order processing",
        body: "After checkout, your order is shared with the connected website or warehouse for stock confirmation, packing, invoice preparation, and courier handover."
      },
      {
        heading: "Dispatch timeline",
        body: "Most eligible orders are prepared for dispatch after confirmation. Dispatch time may vary based on stock location, product type, payment status, public holidays, and courier pickup schedules."
      },
      {
        heading: "Estimated delivery",
        body: "Estimated delivery is shown in the order tracking section. Delivery to remote, restricted, or service-limited pincodes may take longer than the displayed estimate."
      },
      {
        heading: "Live tracking",
        body: "Tracking updates are fetched order-id wise from the connected warehouse or website. The tracking line moves as the order status changes to shipped, in transit, out for delivery, or delivered."
      },
      {
        heading: "Delivery attempts",
        body: "Courier partners may contact you before delivery. Missed calls, unavailable customer, wrong address, or refused delivery can result in delay, return, or cancellation."
      },
      {
        heading: "Shipping charges",
        body: "Shipping charges, if applicable, are shown at checkout or included in the order total. Additional location-based charges may apply for certain pincodes or bulky parts."
      }
    ]
  },
  returns: {
    title: "Return Policy",
    subtitle: "Return, replacement, and refund rules",
    sections: [
      {
        heading: "Eligibility",
        body: "Returns are accepted only for eligible products that are unused, unfitted, undamaged, and returned with original packaging, invoice, labels, accessories, manuals, and warranty cards where applicable."
      },
      {
        heading: "Return window",
        body: "Return or replacement requests should be raised as soon as possible after delivery. The final approval depends on product category, seller policy, and warehouse inspection."
      },
      {
        heading: "Damaged or wrong item",
        body: "If you receive a damaged, defective, missing, or wrong item, keep the packaging intact and share order details, photos, and opening/unboxing proof if requested."
      },
      {
        heading: "Non-returnable items",
        body: "Used parts, fitted parts, electrical items after installation, damaged packaging, missing accessories, custom orders, and products ordered with wrong compatibility details may not be returnable."
      },
      {
        heading: "Inspection and approval",
        body: "Every return is inspected by the seller or warehouse. Refund, replacement, or rejection is decided after checking product condition, serial number, packaging, and claim details."
      },
      {
        heading: "Refund timeline",
        body: "Approved refunds are processed to the original payment method or eligible refund mode. Bank, wallet, or payment gateway settlement time may vary."
      }
    ]
  },
  payments: {
    title: "Payment Policy",
    subtitle: "COD, PayU, refunds, and security",
    sections: [
      {
        heading: "Available payment modes",
        body: "Ev Speare supports Cash on Delivery and online payment through PayU secure checkout where available. Payment options may vary by order value, pincode, stock status, and risk checks."
      },
      {
        heading: "Online payment security",
        body: "For online payment, you are redirected to PayU. Payment credentials are entered on the payment gateway page and are not stored by Ev Speare."
      },
      {
        heading: "Payment confirmation",
        body: "An online order is treated as paid only after successful gateway verification. If verification fails, the order may remain pending, failed, or cancelled."
      },
      {
        heading: "Failed or duplicate payment",
        body: "If money is debited but payment status is not updated, wait for gateway reconciliation or contact support with transaction details. Duplicate successful payments are refunded after verification."
      },
      {
        heading: "Cash on Delivery",
        body: "COD orders are payable at delivery. COD may be unavailable for selected pincodes, high-value orders, repeated refusals, or products that require prepaid confirmation."
      },
      {
        heading: "Refund mode",
        body: "Refunds for prepaid orders are generally issued to the original payment method. COD refunds, if approved, may require bank or wallet details for processing."
      }
    ]
  },
  about: {
    title: "About Ev Speare",
    subtitle: "EV spare parts and order support",
    sections: [
      {
        heading: "Who we are",
        body: "Ev Speare is an EV spare parts commerce experience built to help customers discover parts, check current stock, place orders, and follow fulfilment updates from connected warehouse systems."
      },
      {
        heading: "Live catalogue",
        body: "The app connects with website and warehouse catalogues to show product information, pricing, stock status, images, and order availability as close to real time as possible."
      },
      {
        heading: "Checkout and payments",
        body: "Customers can choose COD where available or pay online through PayU secure checkout. Orders are verified and pushed to the fulfilment system after checkout."
      },
      {
        heading: "Tracking and service",
        body: "The Orders section provides live status updates, estimated delivery, shipment progress, and cancellation support before dispatch."
      },
      {
        heading: "Customer-first approach",
        body: "Our goal is to make EV spare part ordering clearer, faster, and easier with transparent policies, stock visibility, and simple mobile-first workflows."
      }
    ]
  }
};

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
  paymentMode: "cod",
  syncing: false,
  selectedProductId: "",
  savedLocation: loadJson(storageKeys.location, null),
  locationFormOpen: false,
  orders: loadJson(storageKeys.orders, []),
  ordersLoading: false,
  checkoutProcessing: false,
  ordersRefreshTimer: null,
  cancellingOrderId: "",
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
  locationStrip: document.querySelector("[data-action='select-address']"),
  accountPill: document.querySelector("[data-account-pill]"),
  authModal: document.querySelector("[data-auth-modal]"),
  authLogin: document.querySelector("[data-auth-login]"),
  authProfile: document.querySelector("[data-auth-profile]"),
  authTitle: document.querySelector("[data-auth-title]"),
  authSubtitle: document.querySelector("[data-auth-subtitle]"),
  loginPhone: document.querySelector("[data-login-phone]"),
  loginOtp: document.querySelector("[data-login-otp]"),
  otpPanel: document.querySelector("[data-otp-panel]"),
  profileName: document.querySelector("[data-profile-name]"),
  profilePhone: document.querySelector("[data-profile-phone]"),
  profileSavedCount: document.querySelector("[data-profile-saved-count]"),
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
  infoPage: document.querySelector("[data-info-page-content]"),
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

function formatRupeeAmount(value) {
  return `Rs. ${currency.format(Math.round(Number(value) || 0))}`;
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

function orderEstimatedDeliveryDate(order) {
  const createdAt = orderCreatedDate(order);
  return validDate(
    order.estimatedDeliveryAt ||
      order.estimatedDeliveryDate ||
      order.deliveryDate ||
      order.eta ||
      order.deliveryEstimate?.estimatedDeliveryAt ||
      order.tracking?.estimatedDeliveryAt ||
      order.tracking?.eta
  ) || addDays(createdAt, deliveryEstimateDays);
}

function formatOrderDate(value, includeYear = true) {
  const date = validDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {})
  });
}

function orderDisplayId(order) {
  return order.orderId || order.order_id || order.id || "Order";
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
  setCheckoutActionState();

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
  const name = state.session?.user?.name || "Ev Speare Customer";

  nodes.accountPill.hidden = loggedIn;
  nodes.accountPill.textContent = "Login";
  nodes.authLogin.hidden = loggedIn;
  nodes.authProfile.hidden = !loggedIn;
  nodes.authTitle.textContent = loggedIn ? "Your profile" : "OTP login";
  nodes.authSubtitle.textContent = loggedIn
    ? "You stay logged in until logout"
    : "Login stays active until you logout";
  nodes.profileName.textContent = loggedIn ? name : "Ev Speare Customer";
  nodes.profilePhone.textContent = loggedIn ? `+91 ${phone}` : "Customer";
  nodes.profileSavedCount.textContent = state.wishlist.size;

  if (loggedIn && !nodes.checkoutPhone.value) {
    nodes.checkoutPhone.value = phone;
  }
}

function renderGatewayNote() {
  const hasKey = Boolean(appConfig.paymentGateway?.keyId);
  const hasPaymentServer = api?.hasEndpoint?.(appConfig.paymentCreateEndpoint);
  const totals = cartTotals();

  if (totals.total > codMaxOrderAmount && state.paymentMethod === "cod") {
    nodes.gatewayNote.textContent = "COD not available above Rs. 1,000. Pay online to place order.";
  } else if (state.paymentMethod === "cod") {
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
  syncOrdersAutoRefresh();
}

function closePages() {
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  });
  syncOrdersAutoRefresh();
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

function splitName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ")
  };
}

function emptyBillingDetails() {
  return {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    alternatePhone: "",
    country: "India",
    address1: "",
    address2: "",
    city: "",
    state: "",
    pincode: "",
    shippingSame: true,
    coordinates: null,
    source: "manual"
  };
}

function splitAddress(value) {
  const parts = String(value || "")
    .split(",")
    .map((part) => part.trim());
  return {
    ...emptyBillingDetails(),
    address1: parts.slice(0, 3).filter(Boolean).join(", "),
    city: parts[3] || "",
    pincode: (parts[4] || "").replace(/\D/g, "").slice(0, 6),
    country: "India"
  };
}

function normalizeBillingDetails(details = {}, source = details.source || "manual") {
  const base = {
    ...emptyBillingDetails(),
    ...(details || {})
  };
  return {
    ...base,
    firstName: String(base.firstName || "").trim(),
    lastName: String(base.lastName || "").trim(),
    phone: phoneDigits(base.phone),
    email: String(base.email || "").trim(),
    alternatePhone: phoneDigits(base.alternatePhone),
    country: String(base.country || "India").trim(),
    address1: String(base.address1 || base.address || "").trim(),
    address2: String(base.address2 || "").trim(),
    city: String(base.city || "").trim(),
    state: String(base.state || "").trim(),
    pincode: String(base.pincode || "").replace(/\D/g, "").slice(0, 6),
    shippingSame: base.shippingSame !== false,
    coordinates: base.coordinates || null,
    source,
    updatedAt: base.updatedAt || new Date().toISOString()
  };
}

function savedLocationDetails() {
  return state.savedLocation ? normalizeBillingDetails(state.savedLocation, state.savedLocation.source || "manual") : null;
}

function hasLocationDetails(details) {
  return Boolean(details?.address1 || details?.coordinates);
}

function coordinatesText(coordinates) {
  if (!coordinates) return "";
  const latitude = Number(coordinates.latitude);
  const longitude = Number(coordinates.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function checkoutBillingDetails() {
  const pagePanel = document.querySelector('[data-page-panel="checkout"]');
  const saved = savedLocationDetails();
  if (!pagePanel || pagePanel.getAttribute("aria-hidden") === "true") {
    const nameParts = splitName(nodes.checkoutName.value || state.session?.user?.name || formatCustomerName(saved || {}));
    return {
      ...emptyBillingDetails(),
      ...(saved || splitAddress(nodes.checkoutAddress.value)),
      ...nameParts,
      phone: phoneDigits(saved?.phone || nodes.checkoutPhone.value || state.session?.user?.phone || ""),
      email: saved?.email || "",
      alternatePhone: saved?.alternatePhone || "",
      shippingSame: saved?.shippingSame !== false
    };
  }

  const values = {
    firstName: pagePanel.querySelector("[data-page-checkout-first-name]")?.value || "",
    lastName: pagePanel.querySelector("[data-page-checkout-last-name]")?.value || "",
    phone: pagePanel.querySelector("[data-page-checkout-phone]")?.value || "",
    email: pagePanel.querySelector("[data-page-checkout-email]")?.value || "",
    alternatePhone: pagePanel.querySelector("[data-page-checkout-alt-phone]")?.value || "",
    country: pagePanel.querySelector("[data-page-checkout-country]")?.value || "India",
    address1: pagePanel.querySelector("[data-page-checkout-address1]")?.value || "",
    address2: pagePanel.querySelector("[data-page-checkout-address2]")?.value || "",
    city: pagePanel.querySelector("[data-page-checkout-city]")?.value || "",
    state: pagePanel.querySelector("[data-page-checkout-state]")?.value || "",
    pincode: pagePanel.querySelector("[data-page-checkout-pincode]")?.value || "",
    shippingSame: pagePanel.querySelector("[data-page-shipping-same]")?.checked !== false
  };

  if (Object.entries(values).some(([key, value]) => key !== "shippingSame" && String(value).trim())) {
    return normalizeBillingDetails({
      firstName: String(values.firstName).trim(),
      lastName: String(values.lastName).trim(),
      phone: phoneDigits(values.phone),
      email: String(values.email).trim(),
      alternatePhone: phoneDigits(values.alternatePhone),
      country: String(values.country || "India").trim(),
      address1: String(values.address1).trim(),
      address2: String(values.address2).trim(),
      city: String(values.city).trim(),
      state: String(values.state).trim(),
      pincode: String(values.pincode).replace(/\D/g, "").slice(0, 6),
      coordinates: saved?.coordinates || null,
      shippingSame: Boolean(values.shippingSame)
    }, saved?.source || "manual");
  }

  return {
    ...emptyBillingDetails(),
    ...(saved || splitAddress(nodes.checkoutAddress.value)),
    ...splitName(nodes.checkoutName.value || state.session?.user?.name || ""),
    phone: phoneDigits(saved?.phone || nodes.checkoutPhone.value || state.session?.user?.phone || ""),
    shippingSame: true
  };
}

function formatCustomerName(details) {
  return [details.firstName, details.lastName].filter(Boolean).join(" ").trim();
}

function formatAddress(details) {
  const text = [
    details.address1,
    details.address2,
    details.city,
    details.state,
    details.pincode,
    details.country
  ].filter(Boolean).join(", ");
  if (text) return text;
  const coordinates = coordinatesText(details.coordinates);
  return coordinates ? `Live location: ${coordinates}` : "";
}

function locationSummary(details) {
  const location = normalizeBillingDetails(details || {});
  const address = formatAddress(location);
  if (address) return address;
  return "No saved location";
}

function locationShortText(details) {
  const location = normalizeBillingDetails(details || {});
  const compact = [location.city, location.pincode].filter(Boolean).join(" - ");
  if (compact) return compact;
  if (location.address1) return location.address1;
  const coordinates = coordinatesText(location.coordinates);
  return coordinates ? `Live location ${coordinates}` : "Add delivery address";
}

function renderSavedLocation() {
  const location = savedLocationDetails();
  const stripText = nodes.locationStrip?.querySelector("span");
  const stripAction = nodes.locationStrip?.querySelector("strong");

  if (location && hasLocationDetails(location)) {
    if (stripText) stripText.textContent = locationShortText(location);
    if (stripAction) stripAction.textContent = "Change";
    if (!nodes.checkoutAddress.value) nodes.checkoutAddress.value = formatAddress(location);
    if (!nodes.checkoutPhone.value && location.phone) nodes.checkoutPhone.value = location.phone;
    if (!nodes.checkoutName.value && formatCustomerName(location)) nodes.checkoutName.value = formatCustomerName(location);
    return;
  }

  if (stripText) stripText.textContent = "Add delivery address";
  if (stripAction) stripAction.textContent = "Change";
}

function saveCustomerLocation(details, source = "manual", { silent = false, rerender = true } = {}) {
  const location = {
    ...normalizeBillingDetails(details, source),
    updatedAt: new Date().toISOString()
  };
  const address = formatAddress(location);
  state.savedLocation = {
    ...location,
    address: address || ""
  };
  saveJson(storageKeys.location, state.savedLocation);
  nodes.checkoutAddress.value = address;
  if (location.phone) nodes.checkoutPhone.value = location.phone;
  if (formatCustomerName(location)) nodes.checkoutName.value = formatCustomerName(location);
  state.locationFormOpen = false;
  renderSavedLocation();
  if (rerender && document.querySelector('[data-page-panel="checkout"]')?.classList.contains("open")) {
    renderCheckoutPage();
  }
  if (!silent) showToast(source === "live" ? "Live location saved" : "Location saved");
  return state.savedLocation;
}

function saveLocationFromForm() {
  const location = checkoutBillingDetails();
  const address1Node = checkoutField("[data-page-checkout-address1]", nodes.checkoutAddress);

  if (!location.address1 && !location.coordinates) {
    showToast("Enter address or use live location");
    address1Node.focus();
    return;
  }

  saveCustomerLocation(location, "manual");
}

function useLiveLocation() {
  if (!navigator.geolocation) {
    showToast("Live location is not available");
    return;
  }

  showToast("Fetching live location...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const current = checkoutBillingDetails();
      const coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      const label = `Live location: ${coordinatesText(coordinates)}`;
      saveCustomerLocation({
        ...current,
        address1: current.address1 || label,
        coordinates
      }, "live");
    },
    () => {
      showToast("Unable to fetch live location");
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60000
    }
  );
}

function setCheckoutActionState(processing = false) {
  const disabled = processing || cartTotals().itemCount === 0;
  const label = processing
    ? "Processing..."
    : !isLoggedIn()
      ? "Login to place order"
      : state.paymentMethod === "online"
        ? "Continue to PayU"
        : "Place order";
  document.querySelectorAll("[data-action='checkout']").forEach((button) => {
    button.disabled = disabled;
    button.textContent = label;
  });
}

function checkoutItemsPreview(entries) {
  if (!entries.length) {
    return `<div class="checkout-empty">Your cart is empty.</div>`;
  }

  const visible = entries.slice(0, 3);
  const extraCount = entries.length - visible.length;
  return `
    <div class="checkout-items">
      ${visible.map((item) => `
        <article class="checkout-item">
          <img ${imageAttrs(item)} alt="${escapeHtml(item.title)}" />
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <span>${item.quantity} x ${formatPrice(item.price)}</span>
          </div>
          <strong>${formatPrice(item.price * item.quantity)}</strong>
        </article>
      `).join("")}
      ${extraCount > 0 ? `<div class="checkout-more">+${extraCount} more ${extraCount === 1 ? "item" : "items"}</div>` : ""}
    </div>
  `;
}

function paymentOptionIcon(name) {
  const icons = {
    online: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3V6Z" /><path d="M3 10h18M7 15h4" /></svg>`,
    cod: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v11H4V7Z" /><path d="M8 11h7M8 14h4M16 7V5H8v2" /></svg>`,
  };
  return icons[name] || icons.online;
}

function paymentOptionRow({ mode, method, icon, title, subtitle, disabled = false, badge = "" }) {
  const selected = state.paymentMode === mode || (!state.paymentMode && state.paymentMethod === method);
  return `
    <label class="payment-option-row ${selected ? "selected" : ""} ${disabled ? "unavailable" : ""}">
      <input class="payment-choice-input" type="radio" name="page-payment" value="${escapeHtml(method)}" data-payment-method data-payment-mode="${escapeHtml(mode)}" ${selected ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span class="payment-option-icon">${paymentOptionIcon(icon)}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}
      </div>
      ${badge ? `<b>${escapeHtml(badge)}</b>` : ""}
      <svg class="payment-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </label>
  `;
}

function renderCheckoutPage() {
  const totals = cartTotals();
  const codUnavailable = totals.total > codMaxOrderAmount;
  if (codUnavailable && state.paymentMethod === "cod") {
    state.paymentMethod = "online";
    state.paymentMode = "online";
  }
  const nameNode = checkoutField("[data-page-checkout-name]", nodes.checkoutName);
  const phoneNode = checkoutField("[data-page-checkout-phone]", nodes.checkoutPhone);
  const addressNode = checkoutField("[data-page-checkout-address]", nodes.checkoutAddress);
  const existingName = nameNode.value || state.session?.user?.name || "";
  const currentBilling = checkoutBillingDetails();
  const billing = {
    ...currentBilling,
    ...(!currentBilling.firstName && !currentBilling.lastName ? splitName(existingName) : {}),
    phone: currentBilling.phone || phoneDigits(state.session?.user?.phone || phoneNode.value || "")
  };
  const name = formatCustomerName(billing) || existingName;
  const address = formatAddress(billing) || addressNode.value || "";
  const checkoutLabel = isLoggedIn() ? "Place order" : "Login to place order";
  const savedLocation = savedLocationDetails();
  const hasSavedLocation = hasLocationDetails(savedLocation);
  const showLocationForm = state.locationFormOpen || !hasSavedLocation;

  nodes.checkoutPage.innerHTML = `
    <div class="payment-page-header">
      <button class="payment-back-button" type="button" data-action="open-cart" aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      <div>
        <span>Step 3 of 3</span>
        <h2>Payments</h2>
      </div>
      <strong class="secure-badge">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2" /><path d="M5 10h14v10H5V10Z" /></svg>
        100% Secure
      </strong>
    </div>

    <div class="payment-total-card">
      <button type="button">
        <span>Total Amount</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <strong>${formatRupeeAmount(totals.total)}</strong>
    </div>

    <div class="payment-offer-strip">
      <span>Claim now with payment offers</span>
      <div aria-hidden="true"><i></i><i></i><i></i></div>
    </div>

    <form class="checkout-form checkout-page-form payment-checkout-form" data-page-checkout-form>
      <section class="payment-list" aria-label="Payment options">
        ${paymentOptionRow({
          mode: "cod",
          method: "cod",
          icon: "cod",
          title: "Cash on Delivery",
          subtitle: codUnavailable ? "Pay online to place order" : "",
          disabled: codUnavailable,
          badge: codUnavailable ? "Not available" : ""
        })}
        ${paymentOptionRow({
          mode: "online",
          method: "online",
          icon: "online",
          title: "Pay Online",
          subtitle: "Redirects to PayU secure checkout"
        })}
      </section>

      <p class="gateway-note payment-gateway-note" data-page-gateway-note></p>

      <section class="checkout-section checkout-address-section">
        <div class="checkout-section-head">
          <div>
            <span>Delivery details</span>
            <h3>Billing Address</h3>
            <p>These details are sent to warehouse with your payment choice.</p>
          </div>
          <label class="shipping-toggle">
            <input type="checkbox" data-page-shipping-same ${billing.shippingSame === false ? "" : "checked"} />
            <span>Shipping same</span>
          </label>
        </div>
        ${hasSavedLocation ? `
          <div class="saved-location-card">
            <span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.1 7-12A7 7 0 1 0 5 9c0 6.9 7 12 7 12Z" /><path d="M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /></svg>
            </span>
            <div>
              <strong>${savedLocation.source === "live" ? "Saved live location" : "Saved delivery location"}</strong>
              <p>${escapeHtml(locationSummary(savedLocation))}</p>
            </div>
          </div>
        ` : ""}
        <div class="location-action-row">
          <button type="button" data-action="use-live-location">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" /></svg>
            Use live location
          </button>
          <button type="button" data-action="edit-location">${hasSavedLocation ? "Add location" : "Manual location"}</button>
        </div>
        <div class="manual-location-panel ${showLocationForm ? "" : "collapsed"}">
          <div class="checkout-field-grid">
            <label>First Name<input type="text" data-page-checkout-first-name value="${escapeHtml(billing.firstName)}" autocomplete="given-name" /></label>
            <label>Last Name<input type="text" data-page-checkout-last-name value="${escapeHtml(billing.lastName)}" autocomplete="family-name" /></label>
            <label>Phone<input type="tel" inputmode="numeric" data-page-checkout-phone value="${escapeHtml(billing.phone)}" autocomplete="tel" /></label>
            <label>Email<input type="email" data-page-checkout-email value="${escapeHtml(billing.email)}" autocomplete="email" /></label>
            <label>Alternate Phone<input type="tel" inputmode="numeric" data-page-checkout-alt-phone value="${escapeHtml(billing.alternatePhone)}" /></label>
            <label>Country<input type="text" data-page-checkout-country value="${escapeHtml(billing.country || "India")}" autocomplete="country-name" /></label>
            <label class="wide">Address<textarea data-page-checkout-address1 rows="3" autocomplete="address-line1">${escapeHtml(billing.address1)}</textarea></label>
            <label class="wide">Address 2<textarea data-page-checkout-address2 rows="2" autocomplete="address-line2">${escapeHtml(billing.address2)}</textarea></label>
            <label>City<input type="text" data-page-checkout-city value="${escapeHtml(billing.city)}" autocomplete="address-level2" /></label>
            <label>State<input type="text" data-page-checkout-state value="${escapeHtml(billing.state)}" autocomplete="address-level1" /></label>
            <label>Pincode<input type="tel" inputmode="numeric" maxlength="6" data-page-checkout-pincode value="${escapeHtml(billing.pincode)}" autocomplete="postal-code" /></label>
            <input type="hidden" data-page-checkout-name value="${escapeHtml(name)}" />
            <input type="hidden" data-page-checkout-address value="${escapeHtml(address)}" />
          </div>
          <button class="save-location-button" type="button" data-action="save-location">Save location</button>
        </div>
      </section>
    </form>

    <section class="checkout-section checkout-summary payment-summary-section">
      <div class="checkout-section-head">
        <div>
          <span>Order summary</span>
          <h3>${totals.itemCount} ${totals.itemCount === 1 ? "item" : "items"}</h3>
        </div>
        <b>Free delivery</b>
      </div>
      ${checkoutItemsPreview(totals.entries)}
      <div class="checkout-price-panel">
        <div><span>Subtotal</span><strong>${formatPrice(totals.subtotal)}</strong></div>
        <div><span>Delivery</span><strong>Free</strong></div>
        <div><span>Platform fee</span><strong>${formatPrice(totals.platformFee)}</strong></div>
        <div class="total"><span>Total</span><strong>${formatRupeeAmount(totals.total)}</strong></div>
      </div>
    </section>

    <div class="checkout-trust-note">
      <strong>35 Crore happy customers and counting!</strong>
      <span>:)</span>
    </div>

    <div class="checkout-sticky-bar payment-sticky-bar">
      <div><span>Total Amount</span><strong>${formatRupeeAmount(totals.total)}</strong></div>
      <button class="checkout-button" type="button" data-action="checkout" ${totals.itemCount ? "" : "disabled"}>${checkoutLabel}</button>
    </div>
  `;
  renderGatewayNote();
  setCheckoutActionState();
}

function trackingIconSvg(icon) {
  const icons = {
    bag: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v13H6V7Z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>`,
    box: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></svg>`,
    truck: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3V6Z" /><path d="M14 10h4l3 3v3h-7v-6Z" /><path d="M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>`,
    check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>`
  };
  return icons[icon] || icons.bag;
}

function trackingStageKeyFromText(value) {
  const normalized = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (/cancel/.test(normalized)) return "placed";
  if (/delivered|complete/.test(normalized)) return "delivered";
  if (/out_for_delivery|in_transit|transit|dispatch|on_the_way/.test(normalized)) return "transit";
  if (/shipped|picked|packed|ready_to_ship|warehouse_picked/.test(normalized)) return "shipped";
  if (/placed|ordered|pending|paid|cod|processing/.test(normalized)) return "placed";
  return "";
}

function orderTrackingStage(order) {
  return trackingStageKeyFromText(
    [
      order.tracking?.status,
      order.status,
      order.fulfillmentStatus,
      order.shippingStatus
    ].filter(Boolean).join(" ")
  ) || "placed";
}

function trackingStepStageKey(step) {
  return trackingStageKeyFromText([step.key, step.label, step.status].filter(Boolean).join(" "));
}

function trackingActiveIndex(order) {
  const stageKeys = customerTrackingStages.map((stage) => stage.key);
  let activeIndex = Math.max(0, stageKeys.indexOf(orderTrackingStage(order)));
  const steps = Array.isArray(order.tracking?.steps) ? order.tracking.steps : [];

  steps.forEach((step) => {
    if (!step.done) return;
    const index = stageKeys.indexOf(trackingStepStageKey(step));
    if (index > activeIndex) activeIndex = index;
  });

  return activeIndex;
}

function orderIsCancelled(order) {
  return /cancel/.test([
    order.status,
    order.tracking?.status,
    order.tracking?.label
  ].filter(Boolean).join(" ").toLowerCase());
}

function stepDateForStage(order, stage) {
  const steps = Array.isArray(order.tracking?.steps) ? order.tracking.steps : [];
  const matchingStep = steps.find((step) => trackingStepStageKey(step) === stage.key);
  return validDate(
    matchingStep?.date ||
      matchingStep?.createdAt ||
      matchingStep?.completedAt ||
      matchingStep?.updatedAt ||
      order.tracking?.[`${stage.key}At`] ||
      order[`${stage.key}At`]
  );
}

function stageDisplayDate(order, stage) {
  const createdAt = orderCreatedDate(order);
  const stepDate = stepDateForStage(order, stage);
  if (stepDate) return stepDate;
  if (stage.key === "delivered") return orderEstimatedDeliveryDate(order);
  return addDays(createdAt, stage.offsetDays);
}

function customerTrackingHtml(order) {
  const activeIndex = trackingActiveIndex(order);
  const progress = Math.round((activeIndex / (customerTrackingStages.length - 1)) * 75);
  const createdAt = orderCreatedDate(order);
  const estimatedAt = orderEstimatedDeliveryDate(order);
  const status = order.tracking?.label || order.tracking?.status || order.status || "Order placed";

  return `
    <section class="customer-tracking" aria-label="Track your order">
      <div class="customer-tracking-head">
        <div>
          <span>Track Your Order</span>
          <strong>${escapeHtml(status)}</strong>
        </div>
        <time datetime="${escapeHtml(estimatedAt.toISOString())}">Delivery by ${escapeHtml(formatOrderDate(estimatedAt, false))}</time>
      </div>
      <div class="tracking-date-summary">
        <span>Order: ${escapeHtml(formatOrderDate(createdAt))}</span>
        <strong>Estimate: ${deliveryEstimateDays} days</strong>
      </div>
      <div class="customer-track-line" style="--tracking-progress: ${progress}%">
        ${customerTrackingStages.map((stage, index) => {
          const done = index <= activeIndex;
          const current = index === activeIndex && activeIndex < customerTrackingStages.length - 1;
          const date = stageDisplayDate(order, stage);
          return `
            <div class="customer-track-stage ${done ? "done" : ""} ${current ? "current" : ""}">
              <span class="track-icon">${trackingIconSvg(stage.icon)}</span>
              <strong>${escapeHtml(stage.label)}</strong>
              <small>${escapeHtml(formatOrderDate(date, false))}</small>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function orderCancelHtml(order) {
  const orderId = orderDisplayId(order);
  const activeIndex = trackingActiveIndex(order);

  if (orderIsCancelled(order)) {
    return `
      <div class="order-cancel-row locked">
        <span>Cancellation requested</span>
      </div>
    `;
  }

  if (activeIndex > 0) {
    return `
      <div class="order-cancel-row locked">
        <span>Cancel unavailable after shipping / out for delivery</span>
      </div>
    `;
  }

  return `
    <div class="order-cancel-row">
      <button type="button" data-cancel-order="${escapeHtml(orderId)}" ${state.cancellingOrderId === orderId ? "disabled" : ""}>
        ${state.cancellingOrderId === orderId ? "Cancelling..." : "Cancel order"}
      </button>
    </div>
  `;
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
      ${state.orders.length ? state.orders.map((order) => {
        const createdAt = orderCreatedDate(order);
        const estimatedAt = orderEstimatedDeliveryDate(order);
        return `
          <article class="order-card">
            <div class="order-head">
              <div>
                <strong>${escapeHtml(orderDisplayId(order))}</strong>
                <span>${escapeHtml(formatOrderDate(createdAt))}</span>
              </div>
              <b>${formatPrice(order.amountTotal || order.amounts?.total || 0)}</b>
            </div>
            <div class="order-date-grid">
              <span>Order Date<strong>${escapeHtml(formatOrderDate(createdAt, false))}</strong></span>
              <span>Estimated Delivery<strong>${escapeHtml(formatOrderDate(estimatedAt, false))}</strong></span>
            </div>
            ${customerTrackingHtml(order)}
            ${orderCancelHtml(order)}
          </article>
        `;
      }).join("") : `<div class="cart-empty">No orders yet.<br />Place an order to track warehouse status.</div>`}
    </div>
  `;
}

function renderInfoPage(pageKey) {
  const page = infoPages[pageKey] || infoPages.about;
  nodes.infoPage.innerHTML = `
    <div class="page-header">
      <button class="icon-button" type="button" data-action="close-page" aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      <div><h2>${escapeHtml(page.title)}</h2><span>${escapeHtml(page.subtitle)}</span></div>
      <span></span>
    </div>
    <div class="info-page-body">
      ${page.sections.map((section) => `
        <section class="info-section">
          <h3>${escapeHtml(section.heading)}</h3>
          <p>${escapeHtml(section.body)}</p>
        </section>
      `).join("")}
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
  renderSavedLocation();
  renderGatewayNote();
  renderCartPage();
  renderCheckoutPage();
  renderOrdersPage();
  renderInfoPage("about");
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
  const firstNameNode = checkoutField("[data-page-checkout-first-name]", nameNode);
  const address1Node = checkoutField("[data-page-checkout-address1]", addressNode);
  const cityNode = checkoutField("[data-page-checkout-city]", addressNode);
  const pincodeNode = checkoutField("[data-page-checkout-pincode]", addressNode);
  const billing = checkoutBillingDetails();
  const phone = phoneDigits(billing.phone || phoneNode.value || state.session?.user?.phone);
  const name = formatCustomerName(billing) || String(nameNode.value || state.session?.user?.name || "").trim();
  const address = formatAddress(billing);
  const hasLiveCoordinates = Boolean(billing.coordinates);
  const totals = cartTotals();

  if (!isLoggedIn()) {
    openAccount();
    showToast("Login required before placing order");
    return null;
  }

  if (state.paymentMethod === "cod" && totals.total > codMaxOrderAmount) {
    showToast("COD not available above Rs. 1,000. Pay online to place order.");
    state.paymentMethod = "online";
    state.paymentMode = "online";
    renderCheckoutPage();
    return null;
  }

  for (const item of totals.entries) {
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
    firstNameNode.focus();
    return null;
  }

  if (phone.length !== 10) {
    showToast("Enter valid mobile number");
    phoneNode.focus();
    return null;
  }

  if (!billing.address1 && !hasLiveCoordinates) {
    showToast("Enter delivery address or use live location");
    address1Node.focus();
    return null;
  }

  if (!hasLiveCoordinates && !billing.city) {
    showToast("Enter city");
    cityNode.focus();
    return null;
  }

  if (!hasLiveCoordinates && billing.pincode.length !== 6) {
    showToast("Enter valid 6 digit pincode");
    pincodeNode.focus();
    return null;
  }

  saveCustomerLocation(billing, billing.coordinates ? "live" : "manual", { silent: true, rerender: false });
  nameNode.value = name;
  phoneNode.value = phone;
  addressNode.value = address;
  nodes.checkoutName.value = name;
  nodes.checkoutPhone.value = phone;
  nodes.checkoutAddress.value = address;
  return { name, phone, address, addressParts: billing, location: state.savedLocation };
}

function buildOrder(customer, payment) {
  const totals = cartTotals();
  const createdAt = new Date();
  const estimatedDeliveryAt = addDays(createdAt, deliveryEstimateDays);
  return {
    orderId: `BG-${Date.now()}`,
    source: "mobile_pwa",
    customer: {
      id: state.session.user.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      location: customer.location || null
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
    createdAt: createdAt.toISOString(),
    estimatedDeliveryAt: estimatedDeliveryAt.toISOString(),
    deliveryEstimate: {
      days: deliveryEstimateDays,
      estimatedDeliveryAt: estimatedDeliveryAt.toISOString()
    }
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
  if (state.checkoutProcessing) return;

  const customer = validateCheckout();
  if (!customer) return;

  const totals = cartTotals();
  if (!totals.itemCount) return;

  state.checkoutProcessing = true;
  setCheckoutActionState(true);

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
    const pushedToWarehouse = response.warehousePushed || response.websitePushed;
    saveLocalOrder({
      ...order,
      amountTotal: order.amounts.total,
      paymentMethod: order.payment.method,
      paymentStatus: order.payment.status,
      tracking: {
        status: "placed",
        label: pushedToWarehouse ? "Sent to warehouse" : "Order placed",
        estimatedDays: deliveryEstimateDays,
        estimatedDeliveryAt: order.estimatedDeliveryAt,
        steps: [
          { key: "placed", label: "Order Placed", done: true, date: order.createdAt },
          { key: "shipped", label: "Shipped", done: false, date: addDays(validDate(order.createdAt) || new Date(), 2).toISOString() },
          { key: "in_transit", label: "In Transit", done: false, date: addDays(validDate(order.createdAt) || new Date(), 4).toISOString() },
          { key: "delivered", label: "Delivered", done: false, date: order.estimatedDeliveryAt }
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
    showToast(pushedToWarehouse ? "Order sent to warehouse" : "Order placed successfully");
  } catch (error) {
    showToast(error.message || "Order failed");
  } finally {
    state.checkoutProcessing = false;
    setCheckoutActionState();
  }
}

function saveLocalOrder(order) {
  state.orders = [order, ...state.orders.filter((item) => item.orderId !== order.orderId)].slice(0, 50);
  saveJson(storageKeys.orders, state.orders);
}

function ordersPageIsOpen() {
  return document.querySelector('[data-page-panel="orders"]')?.classList.contains("open");
}

function syncOrdersAutoRefresh() {
  if (!ordersPageIsOpen() || !isLoggedIn()) {
    if (state.ordersRefreshTimer) {
      clearInterval(state.ordersRefreshTimer);
      state.ordersRefreshTimer = null;
    }
    return;
  }

  if (state.ordersRefreshTimer) return;
  state.ordersRefreshTimer = setInterval(() => {
    if (!ordersPageIsOpen() || state.ordersLoading) return;
    loadOrders({ silent: true, background: true });
  }, 30000);
}

async function cancelOrder(orderId) {
  if (!orderId || state.cancellingOrderId) return;

  state.cancellingOrderId = orderId;
  renderOrdersPage();

  try {
    const response = await api.cancelOrder(orderId);
    state.orders = state.orders.map((order) => {
      if (String(orderDisplayId(order)) !== String(orderId)) return order;
      return {
        ...order,
        status: response.status || "cancel_requested",
        tracking: {
          ...(order.tracking || {}),
          status: response.status || "cancel_requested",
          label: "Cancellation requested"
        }
      };
    });
    saveJson(storageKeys.orders, state.orders);
    showToast("Cancel request sent");
    if (!response.localOnly) {
      await loadOrders({ silent: true, background: true });
    }
  } catch (error) {
    showToast(error.message || "Unable to cancel order");
  } finally {
    state.cancellingOrderId = "";
    renderOrdersPage();
  }
}

async function loadOrders({ silent = false, background = false } = {}) {
  if (!isLoggedIn()) {
    if (!silent) openAccount();
    return;
  }

  state.ordersLoading = true;
  if (!background) renderOrdersPage();
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
  const cancelOrderId = target.dataset.cancelOrder;
  const infoPageKey = target.dataset.infoPage;

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

  if (cancelOrderId) {
    await cancelOrder(cancelOrderId);
  }

  if (infoPageKey) {
    renderInfoPage(infoPageKey);
    openPage("info");
    closeDrawer();
    closeAccount();
  }

  switch (target.dataset.action) {
    case "open-cart":
      closeAccount();
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
      closeAccount();
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
      state.locationFormOpen = !hasLocationDetails(savedLocationDetails());
      renderCheckoutPage();
      openPage("checkout");
      closeAccount();
      break;
    case "edit-location":
      state.locationFormOpen = true;
      renderCheckoutPage();
      requestAnimationFrame(() => checkoutField("[data-page-checkout-address1]", nodes.checkoutAddress).focus());
      break;
    case "save-location":
      saveLocationFromForm();
      break;
    case "use-live-location":
      useLiveLocation();
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
      closeAccount();
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

document.addEventListener("change", async (event) => {
  if (!event.target.matches("[data-payment-method]")) return;
  if (event.target.disabled) return;
  state.paymentMethod = event.target.value;
  state.paymentMode = event.target.dataset.paymentMode || event.target.value;
  event.target.closest(".payment-list")?.querySelectorAll(".payment-option-row").forEach((row) => {
    row.classList.toggle("selected", row.contains(event.target));
  });
  renderGatewayNote();

  if (state.paymentMethod === "online") {
    await placeOrder();
  }
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
