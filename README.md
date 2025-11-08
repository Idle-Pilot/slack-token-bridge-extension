# Slack Token Bridge Extension (Chrome MV3)

A headless Chrome extension that extracts Slack workspace tokens and the `xoxd`
cookie from the browser, exposing them to your web app via a secure
postMessage-based RPC bridge.

Fork this repo and configure it for your own app.

Originally built for [Idle Pilot](https://idlepilot.com), a cloud-based [Slack presence scheduler](https://idlepilot.com/slack-presence-scheduler).

## Quick start

1. Clone/fork this repository
2. Edit `extension.config.json`:

```json
{
  "name": "Your App Name",
  "description": "Short description for Chrome Web Store.",
  "version": "1.0.0",
  "appOrigin": "https://app.yourservice.com",
  "channel": "yourapp-ext-bridge",
  "portName": "yourapp-bridge"
}
```

| Field | Required | Description |
|---|---|---|
| `name` | yes | Extension name shown in Chrome |
| `appOrigin` | yes | Your web app origin (must be `https://`) |
| `description` | no | Chrome Web Store description |
| `version` | no | Semver version (default `0.0.1`) |
| `channel` | no | postMessage channel name (default: derived from name) |
| `portName` | no | Chrome port name (default: derived from name) |

3. Replace the icons in `public/assets/` with your own (16, 32, 48, 128px PNGs)
4. Build and load:

```bash
pnpm install
pnpm build
```

5. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `dist/`

## How it works

The extension has two components:

- **Service worker** (`src/background.ts`) — listens for RPC requests, opens a
  hidden Slack tab, reads workspace data from `localStorage.localConfig_v2`,
  fetches the `d` cookie via `chrome.cookies`, and returns the result.

- **Content script** (`src/bridge.ts`) — injected into your web app's pages.
  Bridges `window.postMessage` from the page to the service worker via a Chrome
  runtime port.

## Web app integration

### Detect the extension

Send a `PING` and listen for a `PONG`:

```js
window.addEventListener("message", (event) => {
  if (event.data?.type === "PONG" && event.data?.channel === "yourapp-ext-bridge") {
    console.log("Extension installed, version:", event.data.extensionVersion);
  }
});

window.postMessage({
  channel: "yourapp-ext-bridge",
  type: "PING",
  nonce: crypto.randomUUID()
}, window.location.origin);
```

### Fetch Slack tokens

```js
const requestId = crypto.randomUUID();

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg?.type !== "RESPONSE" || msg?.requestId !== requestId) return;

  if (msg.ok) {
    console.log("Tokens:", msg.result);
    // msg.result = { xoxdCookie, workspaces: [{ id, name, domain, iconUrl, token }], errors }
  } else {
    console.error("Error:", msg.error);
  }
});

window.postMessage({
  channel: "yourapp-ext-bridge",
  type: "REQUEST",
  requestId,
  method: "slack.getTokens",
  params: {}
}, window.location.origin);
```

### Response shape

```ts
// Success (ok: true)
{
  xoxdCookie: string | null,
  workspaces: Array<{
    id: string,
    name: string,
    domain: string,
    iconUrl: string | null,
    token: string | null    // xoxc-... token
  }>,
  errors: string[]          // non-fatal warnings
}

// Fatal error (ok: false)
{ error: string }
```

## Use cases

- **[Presence scheduling](https://idlepilot.com/features)** — Keep your Slack status active during configured work hours from a cloud server, even with your laptop closed.
- **Status automation** — Build tools that sync Slack status with your calendar or set statuses on a schedule.
- **Workspace analytics** — Collect your own presence data for personal productivity tracking.
- **Development and testing** — Use real Slack sessions locally when building integrations that go beyond the official API.

For a breakdown of how Slack presence detection works under the hood, see the [Slack Presence Guide](https://idlepilot.com/slack-presence-guide/).

## Project structure

```
extension.config.json          # Your configuration (edit this)
public/
  manifest.template.json       # Manifest template (placeholders replaced at build)
  assets/                      # Extension icons
src/
  background.ts                # Service worker
  bridge.ts                    # Content script
  chrome.d.ts                  # Chrome API types
scripts/
  build.js                     # Build script (reads config, compiles, injects values)
dist/                          # Build output (gitignored)
```

## Used by

- **[Idle Pilot](https://idlepilot.com)** — Cloud-based Slack presence scheduler. [How it works](https://idlepilot.com/how-it-works) · [Security](https://idlepilot.com/security) · [Compare tools](https://idlepilot.com/compare)