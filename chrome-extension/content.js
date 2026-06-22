// ============================================
// content.js
// 注入到 AI 聊天页面（豆包/ChatGPT）
// 职责：操作 DOM，发送消息，等待并提取回复
// 所有配置从 chrome.storage.local 读取（由调试面板保存）
// ============================================

// ---------- 配置管理 ----------
// AI_BRIDGE_DEFAULT_CONFIGS 由 default-configs.js 提供

let cachedConfig = null;

async function getConfig() {
  if (cachedConfig) return cachedConfig;

  const host = window.location.hostname;
  const storageKey = `config_${host}`;

  return new Promise((resolve) => {
    chrome.storage.local.get(storageKey, (data) => {
      const saved = data[storageKey];
      if (saved) {
        cachedConfig = saved;
        console.log("[ai-bridge] 已加载保存的配置");
      } else if (AI_BRIDGE_DEFAULT_CONFIGS[host]) {
        cachedConfig = AI_BRIDGE_DEFAULT_CONFIGS[host];
        console.log("[ai-bridge] 使用内置默认配置");
      } else {
        cachedConfig = null;
        console.log("[ai-bridge] 未找到配置，请用调试面板配置并保存");
      }
      resolve(cachedConfig);
    });
  });
}

chrome.storage.onChanged.addListener((changes) => {
  const host = window.location.hostname;
  if (changes[`config_${host}`]) {
    cachedConfig = null;
    console.log("[ai-bridge] 配置已更新");
  }
});

// ---------- 请求队列 ----------

let requestQueue = Promise.resolve();

function enqueue(fn) {
  requestQueue = requestQueue.then(fn, fn);
  return requestQueue;
}

// ---------- Markdown 格式提取 ----------

function extractMarkdown(element) {
  let md = "";
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) { md += node.textContent; continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toLowerCase();
    switch (tag) {
      case "p": md += extractMarkdown(node) + "\n\n"; break;
      case "br": md += "\n"; break;
      case "strong": case "b": md += `**${extractMarkdown(node)}**`; break;
      case "em": case "i": md += `*${extractMarkdown(node)}*`; break;
      case "code":
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === "pre") break;
        md += `\`${node.textContent}\``; break;
      case "pre": {
        const codeEl = node.querySelector("code");
        const codeText = codeEl ? codeEl.textContent : node.textContent;
        const langClass = codeEl?.className?.match(/language-(\w+)/);
        const lang = langClass ? langClass[1] : "";
        md += `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`; break;
      }
      case "ul":
        for (const li of node.querySelectorAll(":scope > li")) md += `- ${extractMarkdown(li)}\n`;
        md += "\n"; break;
      case "ol": {
        let i = 1;
        for (const li of node.querySelectorAll(":scope > li")) { md += `${i}. ${extractMarkdown(li)}\n`; i++; }
        md += "\n"; break;
      }
      case "h1": md += `# ${extractMarkdown(node)}\n\n`; break;
      case "h2": md += `## ${extractMarkdown(node)}\n\n`; break;
      case "h3": md += `### ${extractMarkdown(node)}\n\n`; break;
      case "h4": md += `#### ${extractMarkdown(node)}\n\n`; break;
      case "blockquote":
        md += extractMarkdown(node).split("\n").map(l => `> ${l}`).join("\n") + "\n\n"; break;
      case "a": md += `[${extractMarkdown(node)}](${node.href})`; break;
      case "table": {
        const rows = node.querySelectorAll("tr");
        rows.forEach((row, idx) => {
          const cells = row.querySelectorAll("th, td");
          md += "| " + Array.from(cells).map(c => c.textContent.trim()).join(" | ") + " |\n";
          if (idx === 0) md += "| " + Array.from(cells).map(() => "---").join(" | ") + " |\n";
        });
        md += "\n"; break;
      }
      default: md += extractMarkdown(node);
    }
  }
  return md;
}

// ---------- DOM 操作 ----------

async function typeMessage(config, text) {
  const selector = config.input?.selector;
  const method = config.input?.method || "react-setter";
  const input = document.querySelector(selector);
  if (!input) throw new Error(`找不到输入框: ${selector}`);

  input.focus();

  switch (method) {
    case "react-setter": {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      if (!setter) throw new Error("无法获取 value setter");
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }
    case "exec-command":
      input.focus();
      document.execCommand('insertText', false, text);
      break;
    case "paste": {
      const cd = new DataTransfer();
      cd.setData("text/plain", text);
      input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: cd }));
      break;
    }
    case "input-event":
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: text }));
      break;
  }
  await sleep(300);
}

async function clickSend(config) {
  const method = config.sendButton?.method || "click";

  if (method === "enter") {
    const input = document.querySelector(config.input?.selector);
    if (input) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    }
    return;
  }

  const selector = config.sendButton?.selector;
  await waitForElement(selector, 5000);
  const btn = document.querySelector(selector);
  if (btn) {
    btn.click();
  } else {
    const input = document.querySelector(config.input?.selector);
    if (input) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    }
  }
}

async function startNewChat(config) {
  const method = config.newChat?.method || "click";

  switch (method) {
    case "shortcut": {
      const shortcutStr = config.newChatShortcut || "";
      if (!shortcutStr) throw new Error("未配置新建聊天快捷键");
      const keys = parseShortcut(shortcutStr);
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: keys.key, code: `Key${keys.key.toUpperCase()}`,
        shiftKey: keys.shift, metaKey: keys.meta, ctrlKey: keys.ctrl, altKey: keys.alt,
        bubbles: true,
      }));
      break;
    }
    case "click": {
      const btn = document.querySelector(config.newChat?.selector);
      if (btn) btn.click();
      break;
    }
    case "url": {
      const url = config.newChatUrl || "/";
      window.location.href = url;
      break;
    }
  }
  await sleep(1500);
}

function parseShortcut(str) {
  const parts = str.toLowerCase().split("+").map(s => s.trim());
  return {
    key: parts.filter(p => !["shift", "meta", "ctrl", "alt", "cmd", "command", "control"].includes(p))[0] || "",
    shift: parts.includes("shift"),
    meta: parts.includes("meta") || parts.includes("cmd") || parts.includes("command"),
    ctrl: parts.includes("ctrl") || parts.includes("control"),
    alt: parts.includes("alt"),
  };
}

function countResponses(config) {
  return document.querySelectorAll(config.responseArea?.selector).length;
}

async function waitForResponse(config, prevCount, timeoutMs = 180000) {
  const startTime = Date.now();
  const responseSelector = config.responseArea?.selector;
  const completionMethod = config.completionDetect?.method || "text-only";

  // 阶段一：等待新回复出现
  while (countResponses(config) <= prevCount) {
    if (Date.now() - startTime > timeoutMs) throw new Error("等待回复超时：未检测到新回复");
    await sleep(500);
  }

  // 阶段二：等待生成完毕
  switch (completionMethod) {
    case "data-streaming": {
      while (true) {
        if (Date.now() - startTime > timeoutMs) throw new Error("等待回复超时");
        const responses = document.querySelectorAll(responseSelector);
        const last = responses[responses.length - 1];
        if (last && last.getAttribute("data-streaming") === "false") break;
        await sleep(500);
      }
      break;
    }
    case "aria-label": {
      const ariaSelector = config.completionAriaSelector;
      const ariaDoneValues = (config.completionAriaDoneValue || "").split(",").map(s => s.trim());
      if (ariaSelector && ariaDoneValues.length) {
        while (true) {
          if (Date.now() - startTime > timeoutMs) throw new Error("等待回复超时");
          const btn = document.querySelector(ariaSelector);
          if (btn && ariaDoneValues.includes(btn.getAttribute("aria-label"))) break;
          await sleep(500);
        }
      }
      break;
    }
    case "stop-button": {
      const stopSelector = config.completionDetect?.selector;
      if (stopSelector) {
        try { await waitForElement(stopSelector, 10000); } catch {}
        await waitForElementGone(stopSelector, timeoutMs - (Date.now() - startTime));
      }
      break;
    }
    case "text-only":
      break;
  }

  // 阶段三：文本稳定性检测（双保险）
  let lastText = "";
  let stableCount = 0;
  while (stableCount < 3) {
    if (Date.now() - startTime > timeoutMs) throw new Error("等待回复超时");
    await sleep(1000);
    const currentText = getLastResponse(config);
    if (currentText && currentText === lastText) { stableCount++; }
    else { stableCount = 0; lastText = currentText; }
  }

  return lastText;
}

function getLastResponse(config) {
  const elements = document.querySelectorAll(config.responseArea?.selector);
  if (elements.length === 0) return "";
  const last = elements[elements.length - 1];
  try {
    const md = extractMarkdown(last).trim();
    if (md) return md;
  } catch {}
  return last.innerText || last.textContent || "";
}

// ---------- 工具函数 ----------

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function waitForElement(selector, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error(`等待元素超时: ${selector}`)); }, timeoutMs);
  });
}

function waitForElementGone(selector, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const check = () => !document.querySelector(selector);
    if (check()) { resolve(); return; }
    const observer = new MutationObserver(() => { if (check()) { observer.disconnect(); resolve(); } });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); if (check()) resolve(); else reject(new Error("等待生成完毕超时")); }, timeoutMs);
  });
}

// ---------- 消息处理 ----------

chrome.runtime.onMessage.addListener((msg, sender, sendReply) => {
  if (msg.action === "ping") { sendReply({ pong: true }); return false; }

  getConfig().then((config) => {
    if (!config) {
      sendReply({ error: "未找到配置。请点击页面上的 AI 按钮，打开调试面板配置并保存。" });
      return;
    }
    return enqueue(() => handleAction(msg, config));
  }).then(sendReply);

  return true;
});

async function handleAction(msg, config) {
  const { action, payload } = msg;
  const t = (label) => console.log(`[ai-bridge] ${label}`, new Date().toISOString());
  try {
    switch (action) {
      case "new_session": {
        t("new_session: 开始新建聊天");
        await startNewChat(config);
        await sleep(500);
        const prevCount = countResponses(config);
        t(`new_session: 当前回复数=${prevCount}，准备输入`);
        await typeMessage(config, payload.message);
        t("new_session: 输入完成，点击发送");
        await clickSend(config);
        t("new_session: 已发送，等待回复...");
        const response = await waitForResponse(config, prevCount);
        const sessionUrl = window.location.href;
        t(`new_session: 收到回复 (${response.length}字)，sessionUrl=${sessionUrl}`);
        return { response, sessionUrl };
      }
      case "send_message": {
        t("send_message: 准备输入");
        const prevCount = countResponses(config);
        t(`send_message: 当前回复数=${prevCount}`);
        await typeMessage(config, payload.message);
        t("send_message: 输入完成，点击发送");
        await clickSend(config);
        t("send_message: 已发送，等待回复...");
        const response = await waitForResponse(config, prevCount);
        t(`send_message: 收到回复 (${response.length}字)`);
        return { response };
      }
      default:
        return { error: `未知的 action: ${action}` };
    }
  } catch (e) {
    t(`错误: ${e.message}`);
    return { error: e.message };
  }
}

console.log("[ai-bridge] Content script 已加载:", window.location.hostname);
