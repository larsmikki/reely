# Serving Play over HTTPS with Tailscale

Play's offline mode (see [offline.md](offline.md)) needs the server reachable over HTTPS — browsers refuse to register a service worker on a plain-HTTP LAN address. Tailscale is the easiest way to get there for a self-hosted setup: every device in your tailnet can reach the server by a stable DNS name with a valid certificate, at home or away, with no port forwarding and no certificate management.

Two ways to set it up. **Option 1 (Tailscale on the Docker host)** is simpler to operate if the host can run Tailscale. **Option 2 (sidecar container)** keeps everything inside Docker Compose and needs nothing installed on the host.

## Prerequisites (both options)

1. A Tailscale account (free for personal use) with the Tailscale app installed on the phone/devices that will use Play.
2. In the [admin console](https://login.tailscale.com/admin/dns) under **DNS**:
   - **MagicDNS** enabled.
   - **HTTPS Certificates** enabled.

Without both, `tailscale serve` cannot issue a certificate and will say so.

## Option 1 — Tailscale on the Docker host

Works because the default `docker-compose.yml` publishes Play's port to the host (`3030:3030`), so the host's Tailscale daemon can proxy to it.

1. Install Tailscale on the host (NAS/server) and log in:

   ```sh
   tailscale up
   ```

   Many NAS platforms (Synology, QNAP, Unraid, TrueNAS) have a Tailscale package — use that where available.

2. Start serving Play:

   ```sh
   tailscale serve --bg 3030
   ```

   `--bg` makes the config persistent — it survives reboots; you run this once, not per boot.

3. Check it:

   ```sh
   tailscale serve status
   ```

   You should see something like `https://<hostname>.<tailnet>.ts.net/ proxy http://127.0.0.1:3030`.

Play is now at `https://<hostname>.<tailnet>.ts.net` from every device in your tailnet. To stop serving: `tailscale serve --https=443 off`.

## Option 2 — Tailscale sidecar container

The sidecar joins your tailnet as its own machine (named `play`), and the Play container shares its network namespace. Nothing is installed on the host and the whole deployment stays in Compose.

### 1. Create an auth key

Admin console → **Settings → Keys → Generate auth key**. A plain single-use key is fine; the sidecar stores its identity in a volume after first login, so the key is only needed once. (Tip: tag the key, e.g. `tag:server`, so the node never expires.)

### 2. `docker-compose.yml`

```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    hostname: play                                  # machine name on the tailnet
    environment:
      - TS_AUTHKEY=tskey-auth-XXXXX       # the key from step 1
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_SERVE_CONFIG=/config/serve.json
    volumes:
      - tailscale-state:/var/lib/tailscale
      - ./tailscale-serve.json:/config/serve.json:ro
    ports:
      - "3030:3030"                       # optional: keeps plain-HTTP LAN access working
    restart: unless-stopped

  play:
    image: larsmikki/play:latest
    container_name: play
    network_mode: service:tailscale       # replaces the ports: mapping
    volumes:
      - play-data:/app/data
      # - /path/to/your/output:/output   # mount a host folder for downloads
    restart: unless-stopped
    depends_on:
      - tailscale

volumes:
  play-data:
  tailscale-state:
```

Notes:

- `network_mode: service:tailscale` means the Play container has no network of its own — `ports:` must live on the `tailscale` service, and a container-internal healthcheck still works.
- The sidecar runs in userspace networking mode by default, which is all `serve` needs — no `NET_ADMIN` capability or `/dev/net/tun` required.
- Prefer not to keep the auth key in the file? Put `TS_AUTHKEY` in an `.env` file next to the compose file (already gitignored) and reference it as `- TS_AUTHKEY=${TS_AUTHKEY}`.

### 3. `tailscale-serve.json` (next to the compose file)

```json
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": { "/": { "Proxy": "http://127.0.0.1:3030" } }
    }
  }
}
```

`${TS_CERT_DOMAIN}` is substituted by Tailscale at startup with the machine's full DNS name — no need to hardcode your tailnet name.

### 4. Start and verify

```sh
docker compose up -d
docker compose exec tailscale tailscale serve status
```

Play is now at `https://play.<your-tailnet>.ts.net`.

## Using it from the phone

- **PWA:** open the HTTPS URL, add Play to the home screen, open it once online — from then on the app shell and anything saved for offline work without a connection. Details in [offline.md](offline.md).
- **Android app:** enter the HTTPS URL under **Settings → Server**.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `tailscale serve` complains about certificates | MagicDNS or HTTPS Certificates not enabled in the admin console (see Prerequisites) |
| HTTPS URL works on the host but not on the phone | Tailscale app on the phone not installed / not logged in / toggled off |
| Sidecar loops on startup asking for login | `TS_AUTHKEY` missing, expired, or already used while the `tailscale-state` volume was wiped — generate a fresh key |
| Sidecar node disappears after a while | Untagged nodes expire by default — tag the auth key (e.g. `tag:server`) or disable key expiry for the node in the admin console |
| First page load is slow after idle | Tailscale connection re-establishing; subsequent requests are direct peer-to-peer where possible |
