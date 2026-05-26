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
  storePincode: "700136",
  storeLatitude: "22.637112",
  storeLongitude: "88.454125",
  fastDeliveryRadiusKm: 20,
  addressPincodeRadiusKm: 25,
  fastDeliveryPincodes: ["700136"],
  pincodeCoordinates: {
    700136: { lat: 22.637112, lng: 88.454125 }
  },

  /*
   * These paths should be provided by your existing website/backend.
   * The app calls:
   * GET  productsEndpoint       -> import catalog
   * POST ordersEndpoint         -> push customer order
   * POST orderCancelEndpoint    -> create cancellation request
   * POST orderReturnEndpoint    -> create return request
   * POST otpRequestEndpoint     -> send COD confirmation OTP
   * POST otpVerifyEndpoint      -> verify COD confirmation OTP
   * POST firebaseVerifyEndpoint -> exchange verified Google login for app session
   * POST paymentCreateEndpoint  -> create gateway order on server
   * POST paymentVerifyEndpoint  -> verify gateway payment signature on server
   */
  productsEndpoint: "/api/mobile/products",
  ordersEndpoint: "/api/mobile/orders",
  orderCancelEndpoint: "/api/mobile/orders/cancel",
  orderReturnEndpoint: "/api/mobile/orders/return",
  supportEndpoint: "/api/mobile/support",
  otpRequestEndpoint: "/api/mobile/auth/request-otp",
  otpVerifyEndpoint: "/api/mobile/auth/verify-otp",
  firebaseVerifyEndpoint: "/api/mobile/auth/firebase",
  profileEndpoint: "/api/mobile/profile",
  paymentCreateEndpoint: "/api/mobile/payments/create",
  paymentVerifyEndpoint: "/api/mobile/payments/verify",

  /*
   * Add an API token only if your website exposes a secure server-side token.
   * Do not put Razorpay key secret, Twilio auth token, database passwords, or admin passwords here.
   */
  authHeader: "",

  firebaseAuth: {
    provider: "firebase",
    enabled: false,
    apiKey: "AIzaSyBHAvF01gxheV53SfnzNxh41ODZHSHNWbI",
    authDomain: "app-evspeare.firebaseapp.com",
    projectId: "app-evspeare",
    storageBucket: "app-evspeare.firebasestorage.app",
    appId: "1:723482884028:web:74cc6cdc873ad2c4f25db9",
    messagingSenderId: "723482884028",
    measurementId: "G-E5C6PWX5KV",
    sdkAppScript: "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
    sdkAuthScript: "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"
  },

  paymentGateway: {
    provider: "razorpay",
    keyId: "",
    checkoutScript: "https://checkout.razorpay.com/v1/checkout.js"
  },

  demo: {
    enabled: false,
    otp: "123456",
    allowDemoPayment: false
  }
};

window.BAZAARGO_CONFIG = window.EVSPEARE_CONFIG;
