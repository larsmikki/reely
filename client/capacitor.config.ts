import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.play.client',
  appName: 'Play',
  webDir: 'dist',
  server: {
    // For dev against a tunneled/LAN server, set CAPACITOR_SERVER_URL in your
    // shell before running `npx cap sync`. Leave undefined in production so
    // the bundled `dist/` is loaded from the app sandbox.
    url: process.env.CAPACITOR_SERVER_URL,
    // The webview must NOT run on https://localhost: a self-hosted server is
    // often plain http:// on the LAN, and an https page loading http media is
    // mixed content — allowMixedContent lets fetch() through, but the WebView
    // still refuses <img>/<video> loads, so thumbnails and streaming break.
    // With an http origin nothing is mixed content (http://localhost is still
    // a secure context, so clipboard etc. keep working).
    androidScheme: 'http',
    cleartext: true,
  },
}

export default config
