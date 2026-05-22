window.EVSPEARE_CONFIG = {
  businessName: "Ev Speare",
  currency: "INR",

  /*
   * Put your website product API URL here for local testing, for example:
   * "https://yourwebsite.com/api/mobile/products"
   * On Railway, WEBSITE_PRODUCTS_URL env still takes priority.
   * If the API is private, use WEBSITE_API_TOKEN/WEBSITE_COOKIE env vars.
   * Local websiteAuthHeader, websiteCookie, and websiteLogin* are only for testing.
   */
  websiteProductsUrl: "https://evsphere-warehouse-backend-production.up.railway.app/api/products",
  websiteOrdersUrl: "",
  websiteAuthHeader: "",
  websiteCookie: "",
  websiteLoginUrl: "https://evsphere-warehouse-backend-production.up.railway.app/login",
  websiteLoginEmail: "",
  websiteLoginPassword: "",
  apiBaseUrl: window.location.protocol === "file:" ? "" : window.location.origin,

  /*
   * These paths should be provided by your existing website/backend.
   * The app calls:
   * GET  productsEndpoint       -> import catalog
   * POST ordersEndpoint         -> push customer order
   * POST otpRequestEndpoint     -> send OTP
   * POST otpVerifyEndpoint      -> verify OTP and return token/user
   * POST paymentCreateEndpoint  -> create gateway order on server
   * POST paymentVerifyEndpoint  -> verify gateway payment signature on server
   */
  productsEndpoint: "/api/mobile/products",
  ordersEndpoint: "/api/mobile/orders",
  otpRequestEndpoint: "/api/mobile/auth/request-otp",
  otpVerifyEndpoint: "/api/mobile/auth/verify-otp",
  paymentCreateEndpoint: "/api/mobile/payments/create",
  paymentVerifyEndpoint: "/api/mobile/payments/verify",

  /*
   * Add an API token only if your website exposes a secure server-side token.
   * Do not put PayU salt, Twilio auth token, database passwords, or admin passwords here.
   */
  authHeader: "",

  paymentGateway: {
    provider: "payu",
    keyId: "",
    checkoutScript: ""
  },

  demo: {
    enabled: false,
    otp: "123456",
    allowDemoPayment: false
  }
};

window.BAZAARGO_CONFIG = window.EVSPEARE_CONFIG;
