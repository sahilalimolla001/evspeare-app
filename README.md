# BazaarGo Mobile Commerce

A mobile-first e-commerce PWA with product import, OTP login, persistent session, wishlist, cart, COD checkout, online payment hooks, and order push support.

## Run

Open `index.html` in a browser, or serve the folder with any static server.

Demo OTP: `123456`

## Connect Your Website

Edit `config.js` and set:

```js
apiBaseUrl: "https://yourwebsite.com",
productsEndpoint: "/api/mobile/products",
ordersEndpoint: "/api/mobile/orders",
otpRequestEndpoint: "/api/mobile/auth/request-otp",
otpVerifyEndpoint: "/api/mobile/auth/verify-otp",
paymentCreateEndpoint: "/api/mobile/payments/create",
paymentVerifyEndpoint: "/api/mobile/payments/verify"
```

## API Contract

`GET /api/mobile/products`

Return an array or `{ products: [] }`. Supported product fields:

```json
{
  "id": "123",
  "name": "Product name",
  "price": 999,
  "regular_price": 1299,
  "images": [{ "src": "https://..." }],
  "categories": [{ "name": "Mobiles" }],
  "average_rating": 4.4,
  "rating_count": 20
}
```

`POST /api/mobile/orders`

The app pushes:

```json
{
  "orderId": "BG-...",
  "source": "mobile_pwa",
  "customer": {},
  "items": [],
  "amounts": {},
  "payment": {},
  "status": "pending_cod"
}
```

`POST /api/mobile/auth/request-otp`

Body: `{ "phone": "9876543210" }`

`POST /api/mobile/auth/verify-otp`

Body: `{ "phone": "9876543210", "otp": "123456" }`

Return:

```json
{
  "token": "customer-jwt",
  "user": { "id": "1", "phone": "9876543210", "name": "Customer" }
}
```

## Payment Gateway

For Razorpay, set `paymentGateway.keyId` in `config.js`. Your backend must create the Razorpay order in `paymentCreateEndpoint` and verify the payment signature in `paymentVerifyEndpoint`.

Never put Razorpay secret key, admin password, or database password in frontend files.

## Files

- `index.html` - app shell, login modal, cart checkout
- `styles.css` - professional mobile UI styling
- `config.js` - website/API/payment configuration
- `api.js` - product import, OTP, payment, order push layer
- `app.js` - catalog, auth, cart, checkout interactions
- `manifest.webmanifest` - installable PWA metadata
