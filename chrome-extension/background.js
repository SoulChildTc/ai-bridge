// ============================================
// background.js
// Chrome 插件 Service Worker
// 职责：管理 WebSocket 连接，在 MCP Server 和 Content Script 之间路由消息
// ============================================

let ws = null;
let reconnectTimer = null;
const RECONNECT_INTERVAL = 5000;

// ---------- 设置管理 ----------

async function getSettings() {
  const defaults = {
    serverUrl: "ws://localhost:9527",
    token: "",
    enabled: true,
  };
  const result = await chrome.storage.local.get(defaults);
  return result;
}

// ---------- WebSocket 连接 ----------

let connectAttempts = 0;

function updateConnectionState(state, detail, nextRetry) {
  chrome.storage.local.set({ connectionState: { state, detail, time: Date.now(), nextRetry: nextRetry || null } });
}

async function connect() {
  const settings = await getSettings();

  if (!settings.enabled) {
    updateConnectionState("disabled", "连接未启用");
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  connectAttempts++;
  const url = `${settings.serverUrl}?token=${encodeURIComponent(settings.token)}`;
  updateBadge("...", "#FF9800");
  updateConnectionState("connecting", `第 ${connectAttempts} 次尝试连接...`);

  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      connectAttempts = 0;
      updateBadge("ON", "#4CAF50");
      updateConnectionState("connected", "已连接到 MCP Server");
    };

    ws.onmessage = async (event) => {
      try {
        const text = event.data instanceof Blob ? await event.data.text() : event.data;
        const msg = JSON.parse(text);
        handleServerMessage(msg);
      } catch (e) {
        console.error("[ai-bridge] 解析消息失败:", e);
      }
    };

    ws.onclose = (event) => {
      ws = null;
      // 重试等待期间保持橙色，不变红
      updateBadge("...", "#FF9800");
      const nextRetry = Date.now() + 10000;
      updateConnectionState("retrying", `连接断开，等待重连...`, nextRetry);
      scheduleReconnect();
    };

    ws.onerror = (error) => {
      const nextRetry = Date.now() + 10000;
      updateConnectionState("retrying", `连接失败（第 ${connectAttempts} 次），等待重连...`, nextRetry);
    };
  } catch (e) {
    updateConnectionState("error", `连接异常: ${e.message}`);
    scheduleReconnect();
  }
}

function disconnect() {
  clearReconnectTimer();
  if (ws) {
    ws.close();
    ws = null;
  }
  updateBadge("", "");
}

function scheduleReconnect() {
  // 不用 setTimeout（Service Worker 被杀后 timer 会丢），依赖 keepalive alarm 重连
  console.log("[ai-bridge] 等待 keepalive alarm 重连...");
}

function clearReconnectTimer() {
  // 保留接口兼容，实际不需要操作
}

function updateBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color });
  }
}

// ---------- 聊天页面 URL 配置 ----------

const PLATFORM_URLS = {
  doubao:  { pattern: "https://www.doubao.com/*", openUrl: "https://www.doubao.com/chat/" },
  chatgpt: { pattern: "https://chatgpt.com/*",    openUrl: "https://chatgpt.com/" },
};

// ---------- 处理来自 MCP Server 的消息 ----------

async function handleServerMessage(msg) {
  const { requestId, action, payload } = msg;
  wsLog(`收到指令: ${action} platform: ${payload?.platform}`);

  try {
    const platform = payload?.platform || "doubao";
    const platformConfig = PLATFORM_URLS[platform];
    if (!platformConfig) {
      sendResponse(requestId, false, null, `不支持的平台: ${platform}`);
      return;
    }

    let tab;

    // send_message 时用 sessionUrl 精确定位 tab
    if (action === "send_message" && payload?.sessionUrl) {
      const allTabs = await chrome.tabs.query({});
      tab = allTabs.find(t => t.url && t.url.startsWith(payload.sessionUrl));
      if (!tab) {
        // sessionUrl 对应的 tab 可能被关了，尝试重新打开
        wsLog(`会话页面已关闭，重新打开: ${payload.sessionUrl}`);
        tab = await openChatTab(payload.sessionUrl);
      }
    } else {
      // new_session 时找到或打开平台页面
      tab = await findChatTab(platformConfig.pattern);
      if (!tab) {
        wsLog(`未找到 ${platform} 页面，自动打开...`);
        tab = await openChatTab(platformConfig.openUrl);
      }
    }

    if (!tab) {
      sendResponse(requestId, false, null, "无法打开 AI 聊天页面");
      return;
    }

    // 确保 tab 处于活跃状态
    await chrome.tabs.update(tab.id, { active: true });

    // 等待 content script 就绪
    await waitForContentScript(tab.id);

    // 转发给 content script 处理
    const response = await chrome.tabs.sendMessage(tab.id, {
      requestId,
      action,
      payload,
    });

    // 如果 content script 返回了错误
    if (response && response.error) {
      sendResponse(requestId, false, null, response.error);
    } else {
      sendResponse(requestId, true, response);
    }
  } catch (e) {
    sendResponse(requestId, false, null, e.message);
  }
}

async function findChatTab(pattern) {
  const tabs = await chrome.tabs.query({ url: pattern });
  return tabs.length > 0 ? tabs[0] : null;
}

async function openChatTab(url) {
  const tab = await chrome.tabs.create({ url, active: true });
  wsLog(`已打开新标签: ${url}, tabId=${tab.id}`);

  // 等待页面加载完成
  await new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);
  });

  wsLog("页面加载完成，等待 content script 注入...");

  // 页面加载完后额外等一下，让 content script 有时间注入
  await new Promise((r) => setTimeout(r, 2000));

  // 确保 content script 就绪
  await waitForContentScript(tab.id);
  wsLog("content script 已就绪");

  // 重新获取 tab 信息（URL 可能变了）
  const updatedTab = await chrome.tabs.get(tab.id);
  return updatedTab;
}

async function waitForContentScript(tabId, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // content script 没就绪，刷新页面重试
  wsLog("Content script 未就绪，刷新页面重试...");
  await chrome.tabs.reload(tabId);
  await new Promise((r) => setTimeout(r, 3000));

  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      wsLog("刷新后 content script 已就绪");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  throw new Error("Content script 未就绪，刷新页面后仍无法加载");
}

// 通过 WebSocket 发送日志给 MCP Server
function wsLog(msg) {
  console.log("[ai-bridge]", msg);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "log", message: msg }));
  }
}

function sendResponse(requestId, success, data, error) {
  if (error) wsLog(`错误: ${error}`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ requestId, success, data, error }));
  }
}

// ---------- 监听来自 popup 的消息 ----------

chrome.runtime.onMessage.addListener((msg, sender, sendReply) => {
  if (msg.type === "getStatus") {
    let status;
    if (ws && ws.readyState === WebSocket.OPEN) {
      status = "connected";
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
      status = "connecting";
    } else {
      status = "disconnected";
    }
    sendReply({ connected: status === "connected", status });
    return false;
  }

  if (msg.type === "reconnect") {
    disconnect();
    connect();
    sendReply({ ok: true });
    return false;
  }

  if (msg.type === "disconnect") {
    disconnect();
    sendReply({ ok: true });
    return false;
  }

  return false;
});

// ---------- 监听设置变化 ----------

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    if (changes.enabled.newValue) {
      connect();
      startKeepAlive();
    } else {
      disconnect();
      stopKeepAlive();
    }
  }
});

// ---------- 保活机制 ----------
// Service Worker 会被浏览器在 ~30 秒后杀掉，用 alarm 定期唤醒并检查连接

const KEEPALIVE_ALARM = "ai-bridge-keepalive";

function startKeepAlive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.17 }); // 约 10 秒
}

function stopKeepAlive() {
  chrome.alarms.clear(KEEPALIVE_ALARM);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      updateBadge("...", "#FF9800");
      connect();
    }
  }
});

// ---------- 启动时自动连接 ----------

chrome.runtime.onInstalled.addListener(() => {
  connect();
  startKeepAlive();
});

chrome.runtime.onStartup.addListener(() => {
  connect();
  startKeepAlive();
});

// Service Worker 重启时也连接
connect();
startKeepAlive();
