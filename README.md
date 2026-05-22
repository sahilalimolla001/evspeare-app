# Ev Speare Mobile Commerce

Mobile-first e-commerce PWA with website product sync, OTP login, COD orders, PayU online payments, and order push support.

## Run

```bash
npm start
```

Open `http://localhost:3000`.

## Railway Environment Variables

Set these in Railway before using the live app:

```env
BUSINESS_NAME=Ev Speare
CURRENCY=INR
SESSION_SECRET=use-a-long-random-secret

WEBSITE_PRODUCTS_URL=https://yourwebsite.com/api/mobile/products
WEBSITE_ORDERS_URL=https://yourwebsite.com/api/mobile/orders
WEBSITE_API_TOKEN=Bearer your_backend_api_token

WAREHOUSE_ORDERS_URL=https://yourwarehouse.com/api/orders
WAREHOUSE_TRACKING_URL=https://yourwarehouse.com/api/order-tracking
WAREHOUSE_API_TOKEN=Bearer your_warehouse_token
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
IMAGE_PROXY_ALLOWED_HOSTS=yourwarehouse.com,cdn.yourwarehouse.com

DATABASE_CLIENT=mysql
DATABASE_URL=mysql://user:password@host:3306/database
DB_PRODUCTS_TABLE=products
DB_INVENTORY_TABLE=warehouse_inventory
DB_ORDERS_TABLE=evspeare_orders
DB_ORDER_ITEMS_TABLE=evspeare_order_items
DB_AUTO_CREATE_TABLES=true

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VERIFY_CHANNEL=sms

PAYU_ENV=test
PAYU_KEY=your_payu_key
PAYU_SALT=your_payu_salt
DEFAULT_CUSTOMER_EMAIL=orders@yourdomain.com
```

For live PayU, set:

```env
PAYU_ENV=production
```

## How It Works

- `GET /api/mobile/products` imports products from database first, then falls back to `WEBSITE_PRODUCTS_URL`.
- Product inventory is auto-detected from columns like `stock_quantity`, `inventory`, `available_stock`, `qty`, or `stock`. Quantity `0` is shown as out of stock and cannot be ordered.
- If inventory is stored in a separate warehouse table, set `DB_INVENTORY_TABLE`. The app auto-detects product columns like `product_id`/`sku` and quantity columns like `quantity`/`available_stock`/`warehouse_stock`.
- `POST /api/mobile/auth/request-otp` sends OTP through Twilio Verify.
- `POST /api/mobile/auth/verify-otp` verifies OTP through Twilio and returns a saved login token.
- `GET /api/mobile/diagnostics` checks whether Twilio, PayU, and website env vars are set without exposing secrets.
- `POST /api/mobile/orders` validates warehouse inventory, inserts COD orders into database, and also pushes to `WEBSITE_ORDERS_URL` when configured.
- If `WAREHOUSE_ORDERS_URL` is set, every placed order is pushed to the warehouse system after DB save.
- `GET /api/mobile/orders` returns customer orders and merges live warehouse tracking from `WAREHOUSE_TRACKING_URL`.
- `GET /api/mobile/images?src=...` serves warehouse product images through the backend, including private `gs://` Google Storage images when `GOOGLE_SERVICE_ACCOUNT_JSON` is configured.
- `POST /api/mobile/payments/create` creates a PayU hosted checkout form with server-generated SHA-512 hash.
- `/payment/payu/success` verifies PayU response hash, then pushes paid order to your website.
- `/payment/payu/failure` returns the customer to the app after failed/cancelled payment.

## Database Mode

Set `DATABASE_URL` and `DATABASE_CLIENT` in Railway to connect directly to your website database from the backend.

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

## Security Notes

Never put PayU salt, Twilio auth token, database password, or admin credentials in frontend files. They belong only in Railway environment variables or your backend.

PayU requires server-side hash generation and response hash verification. Twilio Verify requires phone numbers in E.164 format; this app converts Indian 10 digit numbers to `+91`.

If OTP does not send, open:

```text
https://your-railway-domain/api/mobile/diagnostics
```

Check that:

- `twilio.configured` is `true`
- `database.configured` is `true` if database mode is being used
- `twilio.accountSidLooksValid` is `true`
- `twilio.serviceSidLooksValid` is `true`
- trial Twilio accounts have the recipient phone number verified in Twilio Console

Sources:

- PayU hash and hosted checkout docs: https://docs.payu.in/docs/prebuilt-checkout-page-integration
- Twilio Verify API docs: https://www.twilio.com/docs/verify/api/verification

## Files

- `server.js` - Railway Node backend, static server, Twilio OTP, PayU, website order push
- `index.html` - app shell, login modal, cart checkout
- `styles.css` - mobile UI styling
- `config.js` - local fallback config; Railway serves dynamic runtime config
- `api.js` - frontend API client
- `app.js` - catalog, auth, cart, checkout interactions
- `manifest.webmanifest` - installable PWA metadata
