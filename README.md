# Ev Speare Mobile Commerce

Mobile-first e-commerce PWA with website product sync, OTP login, COD orders, Razorpay online payments, and order push support.

## Run

```bash
npm start
```

Open `http://localhost:3000`.

For local website import, put your product API URL in `config.js`:

```js
websiteProductsUrl: "https://yourwebsite.com/api/mobile/products"
```

On Railway, set `WEBSITE_PRODUCTS_URL`; that env value takes priority.
If the product API is private, set `WEBSITE_API_TOKEN` or `WEBSITE_COOKIE` in
the server environment.
For local testing against a form-login warehouse, you can also set
`websiteLoginUrl`, `websiteLoginEmail`, and `websiteLoginPassword` in `config.js`.
If `WEBSITE_ORDERS_URL` is not set, the app derives the warehouse form endpoint
from `WEBSITE_PRODUCTS_URL` as `/add-order`.

## Railway Environment Variables

Set these in Railway before using the live app:

```env
BUSINESS_NAME=Ev Speare
CURRENCY=INR
SESSION_SECRET=use-a-long-random-secret
PUBLIC_BASE_URL=https://evspeare.shop

WEBSITE_PRODUCTS_URL=https://yourwebsite.com/api/mobile/products
WEBSITE_ORDERS_URL=https://yourwebsite.com/api/mobile/orders
WEBSITE_CUSTOMER_ORDERS_URL=https://yourwebsite.com/api/mobile/customer-orders
WEBSITE_TRACKING_URL=https://yourwebsite.com/api/mobile/order-tracking
WEBSITE_CANCEL_ORDER_URL=https://yourwebsite.com/api/mobile/orders/cancel
WEBSITE_RETURN_ORDER_URL=https://yourwebsite.com/api/mobile/orders/return
WEBSITE_API_TOKEN=Bearer your_backend_api_token
STORE_PINCODE=700136
STORE_LATITUDE=22.637112
STORE_LONGITUDE=88.454125
FAST_DELIVERY_RADIUS_KM=20
ADDRESS_PINCODE_RADIUS_KM=25
FAST_DELIVERY_PINCODES=700136
PINCODE_COORDINATES_JSON={"700136":{"lat":22.637112,"lng":88.454125}}

WAREHOUSE_ORDERS_URL=https://yourwarehouse.com/api/integrations/orders
WAREHOUSE_TRACKING_URL=https://yourwarehouse.com/api/order-tracking
WAREHOUSE_CANCEL_ORDER_URL=https://yourwarehouse.com/api/integrations/order-cancel
WAREHOUSE_RETURN_ORDER_URL=https://yourwarehouse.com/api/integrations/returns
WAREHOUSE_PRODUCTS_URL=https://yourwarehouse.com/api/products
WAREHOUSE_INVENTORY_URL=https://yourwarehouse.com/api/inventory
WAREHOUSE_API_TOKEN=Bearer your_warehouse_token
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
IMAGE_PROXY_ALLOWED_HOSTS=yourwarehouse.com,cdn.yourwarehouse.com

ENABLE_DATABASE=false
DATABASE_CLIENT=mysql
DATABASE_URL=mysql://user:password@host:3306/database
DB_PRODUCTS_TABLE=products
DB_INVENTORY_TABLE=warehouse_inventory
DB_ORDERS_TABLE=evspeare_orders
DB_ORDER_ITEMS_TABLE=evspeare_order_items
DB_AUTO_CREATE_TABLES=true

FIREBASE_AUTH_ENABLED=true
FIREBASE_API_KEY=your_firebase_web_api_key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_APP_ID=your_firebase_web_app_id
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}

# Optional fallback while Firebase Authentication is not enabled.
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VERIFY_CHANNEL=sms

RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
DEFAULT_CUSTOMER_EMAIL=orders@yourdomain.com
```

Use Razorpay Test Mode keys during testing and replace them with Live Mode keys only after payment flow verification and live webhook/capture configuration.

## How It Works

- `GET /api/mobile/products` imports products directly from `WEBSITE_PRODUCTS_URL` first. If warehouse endpoints are set, it can also use `WAREHOUSE_PRODUCTS_URL` and merge stock from `WAREHOUSE_INVENTORY_URL`.
- Product inventory is auto-detected from columns like `stock_quantity`, `inventory`, `available_stock`, `qty`, or `stock`. Quantity `0` is shown as out of stock and cannot be ordered.
- Database mode is off by default. Set `ENABLE_DATABASE=true` only if you intentionally want DB fallback.
- With `FIREBASE_AUTH_ENABLED=true`, Firebase Phone Authentication sends and verifies customer OTP in the browser using invisible reCAPTCHA.
- `POST /api/mobile/auth/firebase` verifies the Firebase ID token through Firebase Admin and returns the app session token used by protected APIs.
- `POST /api/mobile/auth/request-otp` and `/verify-otp` remain available as the fallback until Firebase is fully configured.
- `GET /api/mobile/diagnostics` checks whether Firebase Auth, fallback Twilio, Razorpay, and website env vars are set without exposing secrets.
- `POST /api/mobile/orders` validates live catalog inventory and pushes COD/paid orders to `WEBSITE_ORDERS_URL`.
- If `WAREHOUSE_ORDERS_URL` is set, every placed order is also pushed to the warehouse system.
- `GET /api/mobile/orders` returns customer orders from `WEBSITE_CUSTOMER_ORDERS_URL` or `WEBSITE_ORDERS_URL`, then merges live website tracking from `WEBSITE_TRACKING_URL` and warehouse tracking from `WAREHOUSE_TRACKING_URL`.
- `POST /api/mobile/orders/cancel` accepts customer cancel requests before the order reaches shipped/out-for-delivery; set `WEBSITE_CANCEL_ORDER_URL` or `WAREHOUSE_CANCEL_ORDER_URL` to forward full order details.
- `POST /api/mobile/orders/return` accepts return requests for 7 days after delivered status; set `WEBSITE_RETURN_ORDER_URL` or `WAREHOUSE_RETURN_ORDER_URL` to forward order id, AWB, items, EAN/SKU, customer, address, phone, amount, reason, and tracking details.
- `GET /api/mobile/inventory-diagnostics` shows safe warehouse product/inventory mapping samples without exposing API tokens.
- `GET /api/mobile/images?src=...` serves warehouse product images through the backend, including private `gs://` Google Storage images when `GOOGLE_SERVICE_ACCOUNT_JSON` is configured.
- `POST /api/mobile/payments/create` creates a Razorpay order on the server and returns its order id to Standard Checkout.
- `POST /api/mobile/payments/verify` verifies the Razorpay checkout signature on the server and confirms that payment is captured before the order is submitted.
- In the Razorpay Dashboard, enable automatic capture and configure webhooks before accepting live fulfilment orders.
- Set `PUBLIC_BASE_URL=https://evspeare.shop` in Railway after adding your custom domain so generated config and payment callbacks use the live domain.

## Optional Database Mode

Database is disconnected by default. Set `ENABLE_DATABASE=true`, `DATABASE_URL`, and `DATABASE_CLIENT` in Railway only if you want the backend to use direct database fallback.

Supported clients:

```env
DATABASE_CLIENT=mysql
DATABASE_URL=mysql://user:password@host:3306/database
```

```env
DATABASE_CLIENT=postgres
DATABASE_URL=postgresql://user:password@host:5432/database
```

Default product table expected by the app:

```sql
CREATE TABLE products (
  id INT PRIMARY KEY,
  name VARCHAR(255),
  price DECIMAL(12,2),
  regular_price DECIMAL(12,2),
  image_url TEXT,
  category VARCHAR(120),
  average_rating DECIMAL(3,2),
  rating_count INT,
  stock_status VARCHAR(60)
);
```

If your existing product table has different columns, set `DB_PRODUCTS_QUERY` in Railway. Example:

```sql
SELECT
  product_id AS id,
  product_name AS name,
  sale_price AS price,
  mrp AS regular_price,
  image AS image_url,
  category_name AS category
FROM your_products
WHERE status = 'active'
ORDER BY product_id DESC
LIMIT 100
```

Orders are inserted into `evspeare_orders` and `evspeare_order_items` by default. Tables are auto-created unless:

```env
DB_AUTO_CREATE_TABLES=false
```

Default order tables:

```sql
CREATE TABLE evspeare_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(80) UNIQUE NOT NULL,
  customer_name VARCHAR(160),
  customer_phone VARCHAR(30),
  customer_address TEXT,
  amount_total DECIMAL(12,2),
  payment_method VARCHAR(40),
  payment_status VARCHAR(40),
  status VARCHAR(60),
  payload JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE evspeare_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(80) NOT NULL,
  product_id VARCHAR(120),
  title TEXT,
  price DECIMAL(12,2),
  quantity INT,
  line_total DECIMAL(12,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Website Product Response

Return an array or `{ "products": [] }`. Supported fields:

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

## Website Order Payload

The app/backend pushes:

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

## Website Tracking Payload

`WEBSITE_TRACKING_URL` is called with `orderId`, `order_id`, and AWB query params when available. It may return an object or a list under `data`, `orders`, `tracking`, `events`, `timeline`, or `updates`.

```json
{
  "orderId": "BG-...",
  "awbNumber": "1234567890",
  "status": "shipped",
  "label": "Order shipped",
  "timeline": [
    {
      "date": "2026-05-23T12:30:00+05:30",
      "activity": "Shipment picked up",
      "location": "Rajarhat Hub"
    }
  ]
}
```

## Security Notes

Never put the Razorpay key secret, Firebase service-account JSON, Twilio auth token, database password, or admin credentials in frontend files. They belong only in Railway environment variables or your backend. Firebase web configuration values are intentionally public and are served only after Firebase login is fully enabled on the server.

Razorpay requires server-side order creation and payment signature verification. Firebase Phone Authentication requires Phone sign-in to be enabled in Firebase Console and the deployed customer domain to be added as an authorized domain.

If OTP does not send, open:

```text
https://your-railway-domain/api/mobile/diagnostics
```

For Firebase login, check that:

- `firebaseAuth.enabled` is `true`
- `firebaseAuth.clientConfigSet` is `true`
- `firebaseAuth.projectIdSet` is `true`
- `firebaseAuth.serviceAccountSet` is `true`
- `database.configured` is `true` if database mode is being used

Sources:

- Razorpay Standard Checkout docs: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
- Firebase Phone Auth for Web: https://firebase.google.com/docs/auth/web/phone-auth
- Firebase Admin ID token verification: https://firebase.google.com/docs/auth/admin/verify-id-tokens
- Twilio Verify API docs: https://www.twilio.com/docs/verify/api/verification

## Files

- `server.js` - Railway Node backend, static server, Firebase/Twilio OTP authentication, Razorpay, website order push
- `index.html` - app shell, login modal, cart checkout
- `styles.css` - mobile UI styling
- `config.js` - local fallback config; Railway serves dynamic runtime config
- `api.js` - frontend API client
- `app.js` - catalog, auth, cart, checkout interactions
- `manifest.webmanifest` - installable PWA metadata
