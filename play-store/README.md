# EV Speare Android App for Play Store

This folder prepares the existing EV Speare web app for Google Play using a Trusted Web Activity (TWA). A TWA keeps the website, APIs, checkout, authentication, and business logic exactly the same while packaging the live storefront as an Android app.

## Recommended App Route

- App type: Trusted Web Activity
- Package name: `com.evspeare.shop`
- App name: `Ev Speare`
- Launch URL: `https://www.evspeare.shop/`
- Required Play target: Android 15 / API 35 or higher for new apps submitted after August 31, 2025

## What You Need Installed

1. Android Studio
2. JDK 17 or newer
3. Node.js
4. Bubblewrap CLI

Install Bubblewrap after Java/Android Studio are ready:

```powershell
npm install -g @bubblewrap/cli
```

## Build Steps

Run these from a new packaging folder, not from the backend server folder:

```powershell
bubblewrap init --manifest https://www.evspeare.shop/manifest.webmanifest
```

Use these answers when asked:

- Package ID: `com.evspeare.shop`
- App name: `Ev Speare`
- Launcher name: `Ev Speare`
- Host: `www.evspeare.shop`
- Start URL: `/`
- Theme color: `#2874f0`
- Background color: `#f2f5f9`
- Display mode: `standalone`

Then build the release bundle:

```powershell
bubblewrap build
```

Upload the generated `.aab` file to Play Console.

## Digital Asset Links

After Bubblewrap creates the signing key, get the SHA-256 fingerprint. For production with Play App Signing, use the App signing key certificate SHA-256 shown in Play Console.

The web server can now serve Digital Asset Links automatically. Set these environment variables in production:

```text
PLAY_STORE_PACKAGE_NAME=com.evspeare.shop
PLAY_STORE_SHA256_CERT_FINGERPRINT=PASTE_RELEASE_KEY_SHA256_HERE
```

Then verify this URL:

```text
https://www.evspeare.shop/.well-known/assetlinks.json
```

The file must be reachable publicly over HTTPS before the Play Store app is tested.

If you prefer a static file instead of environment variables, copy `assetlinks.template.json`, replace the placeholder fingerprint, and deploy the final file as `.well-known/assetlinks.json`.

## Release Checklist

Use `release-checklist.md` before submitting the app to Play Console.

## Important

Do not change checkout, APIs, auth, or backend for the Android wrapper. If the website works at `https://www.evspeare.shop/`, the app should work the same after Digital Asset Links is configured.
