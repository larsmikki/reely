# Offline mode

Fetchr supports offline playback two ways:

1. **PWA (any phone/browser)** — install Fetchr to your home screen; downloaded videos are stored in the browser (IndexedDB) and served by a service worker.
2. **Android app (Capacitor)** — the app shell ships inside the APK and videos are stored as real files in the app sandbox, so there are no browser storage quotas and the OS never evicts them.

Both share the same UI: the "Save for offline" button on a video card or in the player.

## What works offline

- The app launches (full shell is precached / bundled).
- **PWA:** the video and collection grids render from the last cached state when the server is unreachable, including thumbnails. (Online, lists always come fresh from the server — the cache is only a fallback.)
- **Android app:** when the server is unreachable, the front page falls back to an "on this device" library — every video saved for offline, with its locally stored title and thumbnail, playable from the sandbox file. (The app does not run the service worker: in the Android WebView, requests routed through a service worker to the remote server fail.) Desk 2 is not browsable offline unless it was unlocked earlier in the same session — its PIN can only be verified by the server.
- Any video you saved for offline plays, with seeking.
- **Desk 2 lists are deliberately never cached offline** — a cached copy would be readable without the PIN. Desk 2 videos can still be saved for offline playback explicitly.

## PWA setup — HTTPS is required

Service workers only run in a secure context. `http://localhost` counts, but a LAN IP like `http://192.168.1.10:3030` does **not** — on a phone the service worker will silently never register and nothing will work offline. Put the server behind HTTPS:

### Option 1: Tailscale (easiest, works away from home)

Your server becomes `https://<machine>.<tailnet>.ts.net` with a valid certificate on every device in your tailnet — no port forwarding, no certificate management. Full setup guide, including running Tailscale as a Docker sidecar next to Fetchr: **[tailscale.md](tailscale.md)**.

### Option 2: Caddy reverse proxy

For a LAN-only setup with your own DNS name:

```
fetchr.example.com {
    reverse_proxy localhost:3030
}
```

Caddy obtains and renews certificates automatically (requires a real domain; for purely internal names use Caddy's `tls internal` and install its root CA on your phone).

### Then, on the phone

1. Open the HTTPS URL, add Fetchr to the home screen (Share → "Add to Home Screen" on iOS, install prompt on Android).
2. Open the app once so the shell is cached, then save videos for offline.

On iOS, installing to the home screen matters beyond convenience: Safari evicts storage for ordinary tabs after ~7 days of non-use, but home-screen web apps are exempt. Storage is still subject to iOS quotas — for multi-gigabyte libraries prefer the Android app.

## Android app

The Capacitor project lives in `client/android/`. To build the APK you need the Android SDK (Android Studio brings it along) with JDK 17+.

On Windows, one command runs the whole chain (web build → Capacitor sync → Gradle → publish):

```bat
build-android-client-app.bat
```

It drops the finished `fetchr-client.apk` into `apk/`, which the Docker build bakes into the image — so the full release flow is just: run this script, then build/deploy the image as usual. The server offers the APK under **Settings → Android App**: open Fetchr in the phone's browser, download it from there, tap it, and allow the install when asked. No cable, no store.

(To update the APK on a running deployment without rebuilding the image, drop a newer file into the data volume — `docker cp apk/fetchr-client.apk fetchr:/app/data/` — the data dir copy takes priority over the bundled one.)

The manual equivalent:

```sh
cd client
npm run build          # build the web bundle
npx @capacitor/assets generate --android   # launcher icons + splash from client/assets/
npx cap sync android   # copy it into the Android project
cd android
./gradlew assembleDebug   # APK at app/build/outputs/apk/debug/fetchr-client.apk
``` On first launch, open **Settings → Server** in the app and enter your server address (e.g. `http://192.168.1.10:3030` or your Tailscale HTTPS URL). Plain HTTP works in the native app — the HTTPS requirement only applies to the PWA.

Videos saved for offline in the Android app are written to the app's private files directory via the Filesystem plugin, together with the video's metadata and thumbnail so the offline library can render without a server. There is no quota beyond free disk space and Android never evicts them. (Videos saved by builds that predate stored metadata are backfilled automatically the next time the app starts with the server reachable.)

## Architecture notes

- `client/src/sw.ts` — service worker, built by vite-plugin-pwa (`injectManifest`): the full list of hashed build assets is injected at build time, so the precache never goes stale after a deploy. It also intercepts `/api/videos/:id/stream` and serves saved videos from IndexedDB with HTTP Range support. Web only — `client/src/offline/register.ts` skips (and actively unregisters) it in the native app, where SW-routed requests break in the WebView.
- `client/src/offline/db.ts` — IndexedDB schema, shared by the app and the service worker. Videos are stored as 8 MiB chunks so a movie is never buffered in memory as one piece.
- `client/src/offline/nativeStore.ts` — the Android storage backend (Filesystem plugin).
- `client/src/platform.ts` — resolves API URLs: same-origin in the browser, prefixed with the configured server URL in the native app.
