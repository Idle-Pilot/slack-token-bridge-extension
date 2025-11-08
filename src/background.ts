export { };

const CHANNEL = "%%CHANNEL%%";
const PORT_NAME = "%%PORT_NAME%%";

const SLACK_ORIGINS = ["https://app.slack.com", "https://slack.com"];
const SLACK_COOKIE_NAME = "d";
const SLACK_ENTRY_URL = "https://app.slack.com/client";
const APP_ORIGINS = ["%%APP_ORIGIN%%"];
const APP_URL = "%%APP_ORIGIN%%";
const TAB_READY_TIMEOUT_MS = 15000;

type RpcRequest = {
  channel: string;
  type: "REQUEST";
  requestId?: string;
  method: string;
  params?: unknown;
};

type RpcResponse = {
  channel: string;
  type: "RESPONSE";
  requestId?: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type SlackWorkspace = {
  id: string;
  name: string;
  domain: string;
  iconUrl: string | null;
  token: string | null;
};

type SlackCredentialResult = {
  xoxdCookie: string | null;
  workspaces: SlackWorkspace[];
  errors: string[];
};

type SlackWorkspaceScriptResult = {
  workspaces: SlackWorkspace[];
  error?: string;
};

type RpcHandler = (params: unknown) => Promise<unknown>;

const RPC_HANDLERS: Record<string, RpcHandler> = {
  "slack.getTokens": async () => {
    return await detectSlackCredentials();
  }
};

chrome.runtime.onConnect.addListener((port: any) => {
  if (port.name !== PORT_NAME) {
    return;
  }

  port.onMessage.addListener((message: unknown) => {
    if (!isRpcRequest(message)) {
      return;
    }

    void handleRpcRequest(message, port);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void injectBridgeIntoMatchingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void injectBridgeIntoMatchingTabs();
});

chrome.action.onClicked.addListener(async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.url && isAppOrigin(activeTab.url)) {
    return;
  }

  const tabs: Array<{ id?: number; url?: string; windowId?: number }> = await chrome.tabs.query({});
  const appTab = tabs.find((tab) => tab?.url && isAppOrigin(tab.url));

  if (appTab?.id) {
    if (typeof appTab.windowId === "number") {
      chrome.windows.update(appTab.windowId, { focused: true });
    }
    chrome.tabs.update(appTab.id, { active: true });
    return;
  }

  chrome.tabs.create({ url: APP_URL, active: true });
});

async function handleRpcRequest(message: RpcRequest, port: any) {
  const { requestId, method, params } = message;
  const response: RpcResponse = {
    channel: CHANNEL,
    type: "RESPONSE",
    requestId,
    ok: false
  };

  try {
    const handler = RPC_HANDLERS[method];
    if (!handler) {
      throw new Error(`Unknown method: ${method}`);
    }

    const result = await handler(params ?? {});
    port.postMessage({ ...response, ok: true, result });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    port.postMessage({ ...response, ok: false, error: errorMessage });
  }
}

async function detectSlackCredentials(): Promise<SlackCredentialResult> {
  const tabId = await createBackgroundSlackTab();
  try {
    return await handleSlackCredentialRequest(tabId);
  } finally {
    await closeTabSafely(tabId);
  }
}

async function handleSlackCredentialRequest(tabId: number): Promise<SlackCredentialResult> {
  if (typeof tabId !== "number") {
    throw new Error("tabId is required to fetch Slack credentials.");
  }

  const errors: string[] = [];
  const workspaceResult = await runSlackWorkspaceScript(tabId).catch((error: Error) => {
    errors.push(error?.message ?? "Workspace script failed");
    return { workspaces: [], error: error?.message };
  });

  if (workspaceResult?.error) {
    errors.push(workspaceResult.error);
  }

  const cookieValue = await getSlackCookie().catch((error: Error) => {
    errors.push(error?.message ?? "Cookie lookup failed");
    return null;
  });

  return {
    xoxdCookie: cookieValue ?? null,
    workspaces: workspaceResult?.workspaces ?? [],
    errors
  };
}

function runSlackWorkspaceScript(tabId: number): Promise<SlackWorkspaceScriptResult> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: () => {
          try {
            const localConfigRaw = window.localStorage.getItem("localConfig_v2");
            if (!localConfigRaw) {
              return {
                workspaces: [],
                error: "Couldn't read Slack session. Open a workspace in app.slack.com/client and make sure you're signed in."
              };
            }

            const config = JSON.parse(localConfigRaw) as { teams?: Record<string, unknown> };
            const teams = Object.entries(config?.teams ?? {}).map(([teamId, team]) => {
              const teamData = team as any;
              const domainValue = teamData?.domain || teamData?.team_domain || "";
              const icon =
                teamData?.icon?.image_88 ||
                teamData?.icon?.image_72 ||
                teamData?.icon?.image_68 ||
                teamData?.icon?.image_44 ||
                null;
              return {
                id: teamData?.id || teamId,
                name: teamData?.name || teamData?.team_name || "Slack workspace",
                domain: domainValue || "",
                iconUrl: icon,
                token: teamData?.token ?? null
              };
            });
            return { workspaces: teams };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { workspaces: [], error: message };
          }
        }
      },
      (results: Array<{ result?: SlackWorkspaceScriptResult }>) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!results || !results.length) {
          reject(new Error("No results returned from Slack token script."));
          return;
        }

        const payload = results[0]?.result;
        if (!payload) {
          reject(new Error("Slack token script returned no payload."));
          return;
        }

        resolve(payload);
      }
    );
  });
}

function getSlackCookie(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const originsToCheck = [...SLACK_ORIGINS];

    function tryNextOrigin() {
      const origin = originsToCheck.shift();
      if (!origin) {
        resolve(null);
        return;
      }

      chrome.cookies.get({ url: `${origin}/`, name: SLACK_COOKIE_NAME }, (cookie: { value?: string }) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (cookie?.value) {
          resolve(cookie.value);
          return;
        }

        tryNextOrigin();
      });
    }

    tryNextOrigin();
  });
}

async function createBackgroundSlackTab(): Promise<number> {
  return await createTab(SLACK_ENTRY_URL, false);
}

function createTab(url: string, active: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!chrome?.tabs?.create) {
      reject(new Error("chrome.tabs.create is unavailable."));
      return;
    }

    chrome.tabs.create(
      { url, active, pinned: !active, index: 0 },
      (createdTab: { id?: number; status?: string }) => {
        if (chrome?.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!createdTab?.id) {
          reject(new Error("Unable to open tab."));
          return;
        }

        const tabId = createdTab.id;
        if (createdTab.status === "complete") {
          resolve(tabId);
          return;
        }

        waitForTabToComplete(tabId)
          .then(() => resolve(tabId))
          .catch(reject);
      }
    );
  });
}

function waitForTabToComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!chrome?.tabs?.onUpdated) {
      reject(new Error("chrome.tabs.onUpdated is unavailable."));
      return;
    }

    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo?.status === "complete") {
        cleanup();
        resolve();
      }
    };

    const onRemoved = (removedTabId: number) => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error("Slack tab closed before it finished loading."));
      }
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while waiting for Slack to load."));
    }, TAB_READY_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated?.removeListener(onUpdated);
      chrome.tabs.onRemoved?.removeListener(onRemoved);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved?.addListener(onRemoved);

    if (chrome?.tabs?.get) {
      chrome.tabs.get(tabId, (tab: { status?: string }) => {
        if (chrome?.runtime?.lastError) {
          cleanup();
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (tab?.status === "complete") {
          cleanup();
          resolve();
        }
      });
    }
  });
}

function closeTabSafely(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    if (!chrome?.tabs?.remove) {
      resolve();
      return;
    }

    chrome.tabs.remove(tabId, () => {
      resolve();
    });
  });
}

function isRpcRequest(message: unknown): message is RpcRequest {
  if (!isRecord(message)) {
    return false;
  }
  return (
    message.channel === CHANNEL &&
    message.type === "REQUEST" &&
    typeof message.method === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAppOrigin(url: string): boolean {
  try {
    const origin = new URL(url).origin;
    return APP_ORIGINS.includes(origin);
  } catch {
    return false;
  }
}

async function injectBridgeIntoMatchingTabs(): Promise<void> {
  if (!chrome?.tabs?.query || !chrome?.scripting?.executeScript) {
    return;
  }

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab?.id || !tab?.url || !isAppOrigin(tab.url)) {
      continue;
    }

    try {
      await injectBridgeIntoTab(tab.id);
    } catch {
      // Best-effort injection; ignore failures (tab closed, permission, etc).
    }
  }
}

function injectBridgeIntoTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["bridge.js"]
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      }
    );
  });
}
