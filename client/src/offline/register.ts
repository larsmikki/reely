/// <reference types="vite/client" />

import { isNativeApp } from '@/platform'

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  // The native (Capacitor) app must never run the service worker: in the
  // Android WebView, requests that pass through a controlling service worker
  // to the cross-origin server fail at the network layer — lists, thumbnails
  // and video streams all break. The SW adds nothing on native anyway: the
  // app shell ships inside the APK, and offline videos are real files played
  // from a local src. Unregister actively so installs that ran an older build
  // recover, and reload once so the current page drops out of SW control.
  if (isNativeApp) {
    void navigator.serviceWorker
      .getRegistrations()
      .then(async regs => {
        if (regs.length === 0) return
        const hadController = !!navigator.serviceWorker.controller
        await Promise.all(regs.map(r => r.unregister()))
        if (hadController) window.location.reload()
      })
      .catch(() => {})
    return
  }

  if (import.meta.env.DEV) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
      console.warn('[sw] registration failed:', err)
    })
  })
}
