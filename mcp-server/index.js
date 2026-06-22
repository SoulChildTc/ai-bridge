#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { appendFileSync, cpSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { randomBytes } from "crypto";

// ============================================
// 日志
// ============================================

const LOG_FILE = process.env.AI_BRIDGE_LOG || "/tmp/ai-bridge.log";

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

// ============================================
// 配置
// ============================================

const WS_PORT = parseInt(process.env.SYNC_WS_PORT || "9527");
const DEFAULT_TOKEN = randomBytes(16).toString("hex");
const TOKEN = process.env.AI_BRIDGE_MCP_TOKEN || DEFAULT_TOKEN;

const SYSTEM_PROMPT = `你好，我是另一个 AI 助手（DeepSeek V4 Flash），在终端编码环境中工作。我能读写文件、执行命令、运行测试，但推理能力有限，复杂问题需要你指导。

请按以下方式和我协作：
- 简要分析问题原因（1-2句），然后给出具体可执行的方案
- 方案要包含完整代码和操作步骤，不要省略关键细节
- 如果信息不足，直接列出你需要知道什么
- 如果某个步骤需要人类用户操作（如浏览器测试），用"[需要用户操作]"标注
- 我们之间的交流语言不限，但输出给用户看的内容要用用户的语言`;

// ============================================
// WebSocket：与 Chrome 插件通信
// 主实例：启动 WebSocket 服务端，接受插件和其他 MCP 实例的连接
// 副实例：作为客户端连接到主实例，通过主实例中转与插件通信
// ============================================

let extensionSocket = null;
let pendingRequests = new Map();
let isServer = false;
let proxySocket = null;
let mcpClients = new Set();

function startWebSocketServer() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: WS_PORT });

    wss.on("listening", () => {
      isServer = true;
      log(`[ws] 主实例：WebSocket 服务端已启动，端口: ${WS_PORT}`);
      resolve();
    });

    wss.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        log(`[ws] 端口 ${WS_PORT} 已被占用，切换为副实例模式`);
        wss.close();
        connectAsClient();
        resolve();
      } else {
        log(`[ws] WebSocket 服务端错误: ${err.message}`);
      }
    });

    wss.on("connection", (ws, req) => {
      const url = new URL(req.url, `http://localhost:${WS_PORT}`);
      const clientToken = url.searchParams.get("token");
      const clientType = url.searchParams.get("type");

      if (clientToken !== TOKEN) {
        log("[ws] 连接被拒绝：Token 不匹配");
        ws.close(4001, "Invalid token");
        return;
      }

      if (clientType === "mcp") {
        log("[ws] 副实例 MCP Server 已连接");
        mcpClients.add(ws);

        ws.on("message", (data) => {
          if (extensionSocket && extensionSocket.readyState === 1) {
            extensionSocket.send(data);
          }
        });

        ws.on("close", () => {
          mcpClients.delete(ws);
          log("[ws] 副实例 MCP Server 已断开");
        });
      } else {
        log("[ws] Chrome 插件已连接");
        extensionSocket = ws;

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (pendingRequests.has(msg.requestId)) {
              handleExtensionMessage(msg);
            } else {
              for (const client of mcpClients) {
                if (client.readyState === 1) client.send(data);
              }
            }
          } catch (e) {
            log("[ws] 解析消息失败: " + e.message);
          }
        });

        ws.on("close", () => {
          log("[ws] Chrome 插件已断开");
          extensionSocket = null;
          for (const [id, pending] of pendingRequests) {
            pending.reject(new Error("Chrome 插件已断开连接"));
            clearTimeout(pending.timeout);
          }
          pendingRequests.clear();
        });
      }
    });
  });
}

// 副实例：作为客户端连到主实例
let clientReconnectTimer = null;

function connectAsClient() {
  if (proxySocket && proxySocket.readyState <= 1) return;
  if (clientReconnectTimer) { clearTimeout(clientReconnectTimer); clientReconnectTimer = null; }

  log(`[ws] 副实例：连接主实例...`);
  const wsClient = new WebSocket(`ws://localhost:${WS_PORT}?token=${encodeURIComponent(TOKEN)}&type=mcp`);

  wsClient.on("open", () => {
    log("[ws] 副实例：已连接到主实例");
    proxySocket = wsClient;
  });

  wsClient.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleExtensionMessage(msg);
    } catch (e) {
      log("[ws] 副实例：解析消息失败: " + e.message);
    }
  });

  wsClient.on("close", () => {
    log("[ws] 副实例：与主实例断开");
    proxySocket = null;
    clientReconnectTimer = setTimeout(connectAsClient, 10000);
  });

  wsClient.on("error", () => {
    // error 后一定会触发 close，不在这里重连
  });
}

function handleExtensionMessage(msg) {
  if (msg.type === "log") {
    log(`[extension] ${msg.message}`);
    return;
  }

  const { requestId, success, data, error } = msg;
  log(`[ws-recv] requestId=${requestId} success=${success} error=${error || 'none'} dataKeys=${data ? Object.keys(data).join(',') : 'null'}`);

  const pending = pendingRequests.get(requestId);
  if (!pending) {
    log(`[ws-recv] 未找到 pending request: ${requestId}，当前 pending 数: ${pendingRequests.size}`);
    return;
  }

  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  log(`[ws-recv] 已匹配 pending request，剩余 pending 数: ${pendingRequests.size}`);

  if (success) {
    pending.resolve(data);
  } else {
    pending.reject(new Error(error || "插件返回错误"));
  }
}

function getSocket() {
  if (isServer) return extensionSocket;
  return proxySocket;
}

function waitForConnection(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const socket = getSocket();
    if (socket && socket.readyState === 1) {
      resolve();
      return;
    }
    log("[ws-send] 未连接，等待...");
    const startTime = Date.now();
    const check = setInterval(() => {
      const s = getSocket();
      if (s && s.readyState === 1) {
        clearInterval(check);
        log("[ws-send] 已连接");
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(check);
        reject(new Error("等待插件连接超时（30秒）。请检查：1) Chrome 插件已安装 2) 插件设置中已开启连接 3) Token 正确"));
      }
    }, 1000);
  });
}

async function sendToExtension(action, payload, timeoutMs = 180000) {
  await waitForConnection();

  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).substring(2, 10);
    log(`[ws-send] action=${action} requestId=${requestId} platform=${payload?.platform} timeout=${timeoutMs/1000}s`);

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      log(`[ws-send] 超时: requestId=${requestId} action=${action}`);
      reject(new Error(`请求超时（${timeoutMs / 1000}秒）`));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timeout });

    getSocket().send(JSON.stringify({
      requestId,
      action,
      payload,
    }));
    log(`[ws-send] 已发送，当前 pending 数: ${pendingRequests.size}`);
  });
}

// ============================================
// MCP Server：与 OpenCode/DeepSeek 通信
// ============================================

const server = new McpServer({
  name: "ai-bridge",
  version: "1.0.0",
});

server.tool(
  "check_connection",
  "检查与浏览器的连接状态。建议在首次调用 new_session 或 ask_ai 之前使用。已连接时可正常使用工具。",
  {},
  async () => {
    const connected = (isServer && extensionSocket && extensionSocket.readyState === 1) ||
                      (!isServer && proxySocket && proxySocket.readyState === 1);
    return {
      content: [{
        type: "text",
        text: connected
          ? "已连接，可以正常使用 new_session 和 ask_ai。"
          : "未连接。请让用户检查：1) Chrome 插件已安装 2) 插件设置中已开启连接 3) Token 正确",
      }],
    };
  }
);

server.tool(
  "new_session",
  "向 Web AI 对话服务发起新的咨询对话。返回值中包含 sessionUrl 和 platform，后续调用 ask_ai 时必须传入这两个值。不要在消息中包含密钥等敏感信息。注意：如果你的上下文中已有之前 new_session 返回的 sessionUrl，应优先使用 ask_ai 继续该对话，而不是创建新会话。只在以下情况使用 new_session：1) 上下文中没有 sessionUrl（首次咨询）2) 用户明确要求新建对话。",
  {
    message: z.string().describe("你要咨询的问题，包括问题描述、已尝试的方案、卡在哪里、关键代码片段"),
    platform: z.enum(["doubao", "chatgpt"]).default("doubao").describe("使用哪个 AI 平台：doubao（豆包）或 chatgpt"),
  },
  async ({ message, platform }) => {
    try {
      const fullMessage = `${SYSTEM_PROMPT}\n\n---\n\n以下是我的第一个问题：\n\n${message}`;

      const result = await sendToExtension("new_session", {
        message: fullMessage,
        platform,
      });

      log(`[session] 新会话: platform=${platform} sessionUrl=${result.sessionUrl}`);

      return {
        content: [{
          type: "text",
          text: `[sessionUrl: ${result.sessionUrl}]\n\n${result.response}`,
        }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `错误: ${e.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "ask_ai",
  "在已有的咨询对话中继续交流。传入 new_session 返回的 sessionUrl 和 platform，确保消息发到正确的对话。",
  {
    message: z.string().describe("继续对话的消息：回答追问、反馈执行结果、补充信息等"),
    sessionUrl: z.string().describe("new_session 返回的 sessionUrl"),
    platform: z.enum(["doubao", "chatgpt"]).describe("使用哪个 AI 平台，与 new_session 时一致"),
  },
  async ({ message, sessionUrl, platform }) => {
    log(`[session] 继续会话: platform=${platform} sessionUrl=${sessionUrl}`);
    try {
      const result = await sendToExtension("send_message", {
        message,
        sessionUrl,
        platform,
      });

      return {
        content: [{
          type: "text",
          text: result.response,
        }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `错误: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ============================================
// 安装命令: node index.js install [token]
// ============================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

async function install(token) {
  const configDir = resolve(process.env.HOME, ".config/opencode");
  const candidates = ["opencode.jsonc", "opencode.json"];

  let configFile = null;
  for (const name of candidates) {
    const p = resolve(configDir, name);
    if (existsSync(p)) { configFile = p; break; }
  }
  if (!configFile) configFile = resolve(configDir, "opencode.jsonc");

  const PACKAGE_NAME = "@soulchildtc/ai-bridge-mcp";
  const mcpConfig = {
    type: "local",
    command: ["npx", "-y", PACKAGE_NAME],
    environment: { AI_BRIDGE_MCP_TOKEN: token },
    timeout: 300000,
  };

  console.log("将添加以下 MCP 配置到 OpenCode:\n");
  console.log(JSON.stringify({ mcp: { "ai-bridge": mcpConfig } }, null, 2));
  console.log(`\n配置文件: ${configFile}`);

  if (existsSync(configFile)) {
    console.log("该文件已存在，新配置会合并进去（只修改 mcp.ai-bridge 字段，不影响其他配置）。");
  } else {
    console.log("该文件不存在，将创建新文件。");
  }

  const answer = await ask("\n确认写入？(y/N) ");
  if (answer !== "y" && answer !== "yes") {
    console.log("已取消。你可以手动将上面的配置添加到配置文件中。");
    process.exit(0);
  }

  // 读取现有配置
  mkdirSync(configDir, { recursive: true });
  let config = {};
  if (existsSync(configFile)) {
    const raw = readFileSync(configFile, "utf8");
    try {
      const stripped = raw.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || "");
      config = JSON.parse(stripped);
    } catch (e) {
      console.error(`解析配置文件失败: ${e.message}`);
      console.error("为安全起见，不会修改该文件。请手动将上面的配置添加到配置文件中。");
      process.exit(1);
    }

    const backupFile = configFile + ".backup";
    writeFileSync(backupFile, raw);
    console.log(`已备份原文件到: ${backupFile}`);
  }

  if (!config.mcp) config.mcp = {};
  config.mcp["ai-bridge"] = mcpConfig;

  writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");

  // Chrome 插件安装
  const DEFAULT_EXT_DIR = resolve(process.env.HOME, ".config/ai-bridge/chrome-extension");
  console.log("\n--- Chrome 插件 ---");
  console.log("MCP Server 配置完成，接下来安装 Chrome 插件。");
  console.log(`插件将被复制到: ${DEFAULT_EXT_DIR}`);
  const customPath = await ask("输入自定义路径（直接回车使用默认路径）: ");

  const extTarget = customPath || DEFAULT_EXT_DIR;
  const extSource = resolve(__dirname, "../chrome-extension");

  if (existsSync(extTarget)) {
    console.log(`目标目录已存在，将覆盖: ${extTarget}`);
  }
  mkdirSync(extTarget, { recursive: true });
  cpSync(extSource, extTarget, { recursive: true, force: true });
  console.log(`Chrome 插件已复制到: ${extTarget}`);

  console.log("\n安装完成！\n");
  console.log(`  Command: npx -y ${PACKAGE_NAME}`);
  console.log(`  Token: ${token}`);
  console.log(`  WebSocket 端口: ${WS_PORT}`);
  console.log(`  Chrome 插件: ${extTarget}`);
  console.log("");
  console.log("下一步:");
  console.log(`  1. Chrome 加载插件: chrome://extensions → 加载已解压的扩展 → 选择 ${extTarget}`);
  console.log(`  2. 插件设置: Token 填 "${token}"，开启连接`);
  console.log("  3. 启动 OpenCode 即可使用");
}

// ============================================
// 启动
// ============================================

if (process.argv[2] === "install") {
  const customToken = process.argv[3];
  install(customToken || TOKEN).catch(console.error);
} else {
  startWebSocketServer();
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    log("[ai-bridge] MCP Server 已启动");
  }).catch((e) => {
    log("[ai-bridge] 启动失败: " + e);
    process.exit(1);
  });
}
