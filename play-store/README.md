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

After Bubblewrap creates the signing key, get the SHA-256 fingerprint and replace the placeholder in `assetlinks.template.json`.

Upload the final JSON file to:

```text
https://www.evspeare.shop/.well-known/assetlinks.json
```

The file must be reachable publicly over HTTPS before the Play Store app is tested.

## Important

Do not change checkout, APIs, auth, or backend for the Android wrapper. If the website works at `https://www.evspeare.shop/`, the app should work the same after Digital Asset Links is configured.
