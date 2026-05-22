window.BAZAARGO_CONFIG = {
  businessName: "BazaarGo",
  currency: "INR",

  /*
   * Put your existing website API base URL here.
   * Example: "https://yourwebsite.com"
   */
  apiBaseUrl: "",

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
   * Do not put Razorpay secret key, database passwords, or admin passwords here.
   */
  authHeader: "",

  paymentGateway: {
    provider: "razorpay",
    keyId: "",
    checkoutScript: "https://checkout.razorpay.com/v1/checkout.js"
  },

  demo: {
    enabled: true,
    otp: "123456",
    allowDemoPayment: true
  }
};
