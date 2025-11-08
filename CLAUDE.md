# Slack Token Bridge Extension

Chrome MV3 extension that bridges a web app with Slack. Headless — no UI. Extracts Slack workspace tokens and cookies, exposing them to the configured web app via a postMessage-based RPC bridge.

Generic and forkable. All app-specific values live in `extension.config.json`.

## Build & Dev

```bash
pnpm install
pnpm build        # reads config, generates manifest, compiles TS, injects values into dist/
```

Output goes to `dist/`. To test: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`.

Package manager is pnpm (10.7.1). Only dev dependency is TypeScript.

## Configuration

Edit `extension.config.json` at the repo root. Required fields: `name`, `appOrigin`. Optional: `description`, `version`, `channel`, `portName` (derived from name if omitted).

## Architecture

Two source files, no bundler. Build script (`scripts/build.js`) handles config injection.

### `src/background.ts` — Service Worker

- Listens for port connections from bridge content script
- Single RPC handler: `slack.getTokens`
- Flow: creates hidden Slack tab → waits for load (15s timeout) → injects script to read `localStorage.localConfig_v2` → reads `d` cookie via `chrome.cookies` → closes tab → returns result
- On install/startup: injects bridge.js into matching app tabs
- On icon click: focuses existing app tab or opens new one

### `src/bridge.ts` — Content Script

- Injected into pages matching `appOrigin` from config
- Bridges `window.postMessage` ↔ `chrome.runtime.connect` port
- Handles PING/PONG for extension detection (returns version)
- Origin-locked to configured `appOrigin`

### `public/manifest.template.json`

Manifest template with `__PLACEHOLDER__` tokens. Build script generates `dist/manifest.json`.

### `scripts/build.js`

Node script (no deps) that: reads config → cleans dist → copies assets → generates manifest from template → runs tsc → replaces `%%SENTINEL%%` values in compiled JS.

## Build Pipeline

1. Read `extension.config.json`, validate, derive defaults
2. `rm -rf dist/` → `mkdir dist/` → copy `public/assets/`
3. Replace `__NAME__`, `__DESCRIPTION__`, `__VERSION__`, `__APP_ORIGIN__` in manifest template → write `dist/manifest.json`
4. Run `tsc -p tsconfig.json` (compiles `src/` → `dist/`)
5. Replace `%%CHANNEL%%`, `%%PORT_NAME%%`, `%%APP_ORIGIN%%` in `dist/background.js` and `dist/bridge.js`

## Message Protocol

Channel name is configurable (default derived from extension name).

**Detection:** PING → PONG with `extensionVersion`.

**RPC:** REQUEST with `{ method, params, requestId }` → RESPONSE with `{ ok, result/error, requestId }`.

## File Layout

```
extension.config.json          # App-specific configuration
public/
  manifest.template.json       # Manifest template
  assets/                      # Extension icons (16, 32, 48, 128px)
src/
  background.ts                # Service worker — RPC, Slack credential extraction
  bridge.ts                    # Content script — postMessage ↔ port bridge
  chrome.d.ts                  # Chrome API type declarations
scripts/
  build.js                     # Build orchestrator
dist/                          # Build output (gitignored)
```
