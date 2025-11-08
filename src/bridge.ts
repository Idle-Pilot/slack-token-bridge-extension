const CHANNEL = "%%CHANNEL%%";
const PORT_NAME = "%%PORT_NAME%%";
const ALLOWED_ORIGINS = new Set([
  "%%APP_ORIGIN%%",
]);

type BridgeBase = {
  channel: string;
  type: "REQUEST" | "RESPONSE" | "PING" | "PONG";
  requestId?: string;
};

type BridgeRequest = BridgeBase & {
  channel: string;
  type: "REQUEST";
  method: string;
  params?: unknown;
};

type BridgeResponse = BridgeBase & {
  channel: string;
  type: "RESPONSE";
  ok: boolean;
  result?: unknown;
  error?: string;
};

type BridgePing = BridgeBase & {
  channel: string;
  type: "PING";
  nonce?: string;
};

type BridgePong = BridgeBase & {
  channel: string;
  type: "PONG";
  nonce?: string;
  extensionVersion?: string;
};

type BridgeMessage = BridgeRequest | BridgeResponse | BridgePing | BridgePong;

let port: any | null = null;
const pendingOrigins = new Map<string, string>();
let lastOrigin: string | null = null;

function ensurePort() {
  if (port) {
    return port;
  }

  port = chrome.runtime.connect({ name: PORT_NAME });
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => {
    port = null;
  });

  return port;
}

function handlePortMessage(message: unknown) {
  if (!isBridgeMessage(message)) {
    return;
  }

  let targetOrigin: string | null = null;
  if (message.requestId && pendingOrigins.has(message.requestId)) {
    targetOrigin = pendingOrigins.get(message.requestId) ?? null;
  } else {
    targetOrigin = lastOrigin;
  }

  if (message.type === "RESPONSE" && message.requestId) {
    pendingOrigins.delete(message.requestId);
  }

  postToPage(message, targetOrigin);
}

function postToPage(message: BridgeMessage, targetOrigin: string | null) {
  if (!targetOrigin || !ALLOWED_ORIGINS.has(targetOrigin)) {
    targetOrigin = lastOrigin;
  }

  if (!targetOrigin || !ALLOWED_ORIGINS.has(targetOrigin)) {
    for (const origin of ALLOWED_ORIGINS) {
      targetOrigin = origin;
      break;
    }
  }

  window.postMessage(message, targetOrigin ?? "*");
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!ALLOWED_ORIGINS.has(event.origin)) return;

  const msg = event.data;
  if (!isBridgeMessage(msg)) return;

  lastOrigin = event.origin;

  if (msg.type === "PING") {
    window.postMessage(
      {
        channel: CHANNEL,
        type: "PONG",
        nonce: msg.nonce,
        extensionVersion: chrome.runtime.getManifest().version
      },
      event.origin
    );
    return;
  }

  if (msg.type === "REQUEST") {
    const activePort = ensurePort();
    if (msg.requestId) {
      pendingOrigins.set(msg.requestId, event.origin);
    }
    activePort.postMessage(msg);
  }
});

function isBridgeMessage(message: unknown): message is BridgeMessage {
  if (!isRecord(message)) {
    return false;
  }

  if (message.channel !== CHANNEL || typeof message.type !== "string") {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
