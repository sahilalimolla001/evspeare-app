# EV Speare Play Store Release Checklist

Use this checklist before uploading the Android App Bundle (`.aab`) to Play Console.

## Website

- Live URL opens over HTTPS: `https://www.evspeare.shop/`
- `https://www.evspeare.shop/manifest.webmanifest` returns HTTP 200
- `https://www.evspeare.shop/app-icon-512.png` returns HTTP 200
- `https://www.evspeare.shop/sw.js` returns HTTP 200
- Login, product search, cart, checkout, COD, Razorpay payment, orders, and support work on mobile

## Digital Asset Links

Set these production environment variables on the deployed web server:

```text
PLAY_STORE_PACKAGE_NAME=com.evspeare.shop
PLAY_STORE_SHA256_CERT_FINGERPRINT=PASTE_RELEASE_KEY_SHA256_HERE
```

Then verify this URL returns a valid JSON array with the final SHA-256 fingerprint:

```text
https://www.evspeare.shop/.well-known/assetlinks.json
```

If Play App Signing is enabled, use the App signing key certificate SHA-256 from Play Console, not only the local upload key.

## Android Bundle

- Build type: Trusted Web Activity
- Package name: `com.evspeare.shop`
- App name: `Ev Speare`
- Launch URL: `https://www.evspeare.shop/`
- Target SDK: Android 15 / API 35 or newer
- Release file: Android App Bundle (`.aab`)
- Signing: Play App Signing enabled

## Play Console Listing

- Category: Shopping
- Short description added
- Full description added
- App icon uploaded
- Feature graphic uploaded
- Phone screenshots uploaded
- Privacy policy URL added
- Support email added
- Data Safety form completed
- Content rating questionnaire completed
- Target audience set
- App access instructions added if login is required for review

## Final Smoke Test

- Install the internal test release from Play Console
- Open app from launcher icon
- Confirm there is no browser address bar
- Confirm back button/navigation works
- Confirm checkout and payment redirect/return works
- Confirm customer can place a test order
