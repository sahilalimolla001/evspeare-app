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

- `GET /api/mobile/products` imports products from `WEBSITE_PRODUCTS_URL`.
- `POST /api/mobile/auth/request-otp` sends OTP through Twilio Verify.
- `POST /api/mobile/auth/verify-otp` verifies OTP through Twilio and returns a saved login token.
- `POST /api/mobile/orders` pushes COD orders to `WEBSITE_ORDERS_URL`.
- `POST /api/mobile/payments/create` creates a PayU hosted checkout form with server-generated SHA-512 hash.
- `/payment/payu/success` verifies PayU response hash, then pushes paid order to your website.
- `/payment/payu/failure` returns the customer to the app after failed/cancelled payment.

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
