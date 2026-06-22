# AI Bridge

让终端 AI 编程助手（如 DeepSeek）通过浏览器使用 Web AI 对话服务（豆包、ChatGPT）。

> **免责声明**
>
> 本项目是一个技术实验，通过浏览器自动化实现终端 AI 与 Web AI 服务之间的通信桥接。用户应自行遵守各平台的使用规定。
>
> 本项目仅供个人学习和研究用途。如果你需要稳定可靠的 API 服务，建议使用各平台提供的官方 API——这不仅是对服务商的支持，也能获得更好的体验。
>
> 使用本项目产生的任何后果由用户自行承担。

## 工作原理

```
DeepSeek (OpenCode)
    ↕ MCP 协议 (stdio)
MCP Server (Node.js)
    ↕ WebSocket (localhost:9527)
Chrome 插件
    ↕ DOM 操作
豆包 / ChatGPT 网页
```

DeepSeek 遇到难题时，通过 MCP 工具发送问题。MCP Server 通过 WebSocket 指挥 Chrome 插件在 AI 聊天页面上操作——输入问题、等待回复、提取结果——然后返回给 DeepSeek。

## 功能特性

- **多平台支持**：豆包、ChatGPT，通过调试面板可适配任意 AI 聊天网站
- **多实例支持**：多个 OpenCode 实例可同时使用，通过主/副实例架构共享同一个 WebSocket 端口
- **会话管理**：通过 sessionUrl 确保消息发到正确的对话
- **自动重连**：插件断开后自动重连，MCP Server 端会等待重连而非直接报错
- **调试面板**：页面上的浮动面板，可视化配置和测试 CSS 选择器与 DOM 操作
- **一键安装**：`npx @soulchildtc/ai-bridge-mcp install` 自动配置 OpenCode

## 安装

### 1. 安装 MCP Server

**方式一：通过 npx（推荐）**

```bash
npx @soulchildtc/ai-bridge-mcp install
# 或指定 token
npx @soulchildtc/ai-bridge-mcp install my-secret-token
```

**方式二：从源码安装**

```bash
git clone https://github.com/soulchildtc/ai-bridge.git
cd ai-bridge
npm install
node mcp-server/index.js install
```

`install` 命令会：
- 安装 npm 依赖
- 显示要写入的配置并让你确认
- 自动写入 `~/.config/opencode/opencode.jsonc`（已有配置会合并，写入前自动备份）

### 2. 安装 Chrome 插件

1. 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `chrome-extension` 目录

### 3. 配置选择器

项目内置了**豆包**和 **ChatGPT** 的默认配置，开箱即用，无需手动配置选择器。

打开豆包或 ChatGPT 页面时，调试面板会自动填充对应的选择器和操作方式。如果网站更新导致默认配置失效，可以按以下步骤重新配置：

1. 打开豆包（doubao.com）或 ChatGPT（chatgpt.com）
2. 点击页面右下角的蓝色 **AI** 按钮，打开调试面板
3. 用 F12 开发者工具找到正确的 CSS 选择器，填入对应字段
4. 点击「高亮」验证选择器是否匹配，点「测试」验证功能是否正常
5. 确认无误后点击「保存配置」（保存后的配置优先于内置默认值）

其他 AI 平台（如智谱清言、Kimi 等）需要手动配置，参见下方「适配新平台」章节。

### 4. 启动使用

启动 OpenCode，插件会自动连接。DeepSeek-V4-Flash 遇到难题时可以让它调用 AI Bridge 向强模型求助。

## MCP 工具

| 工具 | 说明 |
|------|------|
| `check_connection` | 检查与浏览器的连接状态 |
| `new_session` | 新建咨询对话，返回 sessionUrl。如果上下文中已有 sessionUrl 应优先用 ask_ai |
| `ask_ai` | 在已有对话中继续交流，需传入 sessionUrl 和 platform |

### 参数

**new_session**
- `message`：咨询的问题
- `platform`：`"doubao"` 或 `"chatgpt"`，默认 `"doubao"`

**ask_ai**
- `message`：继续对话的消息
- `sessionUrl`：`new_session` 返回的会话 URL
- `platform`：与 `new_session` 时一致

## 调试面板

在 AI 聊天页面点击右下角蓝色 **AI** 按钮打开，支持：

- 为每个字段选择操作方式（如输入方式：React Setter / execCommand / Paste）
- 高亮匹配的 DOM 元素
- 逐项测试每个功能
- 保存配置到 Chrome 存储（按域名隔离）
- 面板和按钮均可拖动

### 适配新平台

以添加智谱清言（chatglm.cn）为例：

**第一步：修改 manifest.json**

在 `host_permissions` 和 `content_scripts.matches` 中添加新域名：

```json
"host_permissions": [
  "https://www.doubao.com/*",
  "https://chatgpt.com/*",
  "https://chatglm.cn/*"
],
"content_scripts": [{
  "matches": [
    "https://www.doubao.com/*",
    "https://chatgpt.com/*",
    "https://chatglm.cn/*"
  ],
  ...
}]
```

**第二步：修改 background.js**

在 `PLATFORM_URLS` 中添加新平台：

```js
const PLATFORM_URLS = {
  doubao:  { pattern: "https://www.doubao.com/*", openUrl: "https://www.doubao.com/chat/" },
  chatgpt: { pattern: "https://chatgpt.com/*",    openUrl: "https://chatgpt.com/" },
  chatglm: { pattern: "https://chatglm.cn/*",     openUrl: "https://chatglm.cn/" },
};
```

**第三步：修改 index.js**

在 MCP 工具的 `platform` 参数中添加新选项：

```js
platform: z.enum(["doubao", "chatgpt", "chatglm"]).default("doubao")
```

搜索所有包含 `z.enum` 的地方（`new_session` 和 `ask_ai` 各一处），都加上新平台。

**第四步：配置选择器**

1. 刷新插件，打开智谱清言网页
2. 点击蓝色 AI 按钮，打开调试面板
3. 用 F12 找到输入框、发送按钮、回复区域的 CSS 选择器
4. 选择合适的操作方式（输入方式、生成完毕检测方式等）
5. 逐项测试，确认无误后保存

**第五步（可选）：添加内置默认配置**

在 `chrome-extension/default-configs.js` 中添加新平台的预设配置（content.js 和 debug-panel.js 共享此文件，只需改一处）：

```js
"chatglm.cn": {
  input: { selector: "你找到的选择器", method: "react-setter" },
  sendButton: { selector: "你找到的选择器", method: "click" },
  responseArea: { selector: "你找到的选择器", method: "default" },
  completionDetect: { selector: "", method: "text-only" },
  newChat: { selector: "你找到的选择器", method: "click" },
  newChatShortcut: "",
  newChatUrl: "",
},
```

完成后，DeepSeek 就可以通过 `platform: "chatglm"` 使用智谱清言了。

## 多实例架构

```
OpenCode-1 → MCP Server（主实例，监听 9527）
                    ↕
               Chrome 插件
                    ↕
OpenCode-2 → MCP Server（副实例，连接 9527）
OpenCode-3 → MCP Server（副实例，连接 9527）
```

- 第一个启动的 MCP Server 成为主实例，监听 WebSocket 端口
- 后续启动的自动切换为副实例，连接到主实例
- 请求通过 requestId 路由，互不干扰
- 同一时间只能处理一个 DOM 操作（浏览器页面串行）

## 日志

MCP Server 日志输出到 `/tmp/ai-bridge.log`：

```bash
tail -f /tmp/ai-bridge.log
```

Chrome 插件的日志通过 WebSocket 转发到同一个文件，也可以在聊天页面的 F12 控制台查看（搜索 `[ai-bridge]`）。

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AI_BRIDGE_MCP_TOKEN` | 随机生成 | WebSocket 认证 Token，需与插件设置一致 |
| `SYNC_WS_PORT` | `9527` | WebSocket 端口 |
| `AI_BRIDGE_LOG` | `/tmp/ai-bridge.log` | 日志文件路径 |

### 已知问题与限制

**多实例队列阻塞**：多个 OpenCode 实例同时发起请求时，浏览器页面上的 DOM 操作是串行的（content.js 有请求队列）。如果实例 A 正在等待 ChatGPT 回复（可能需要几十秒），实例 B 的请求会排队等待，直到 A 完成。极端情况下可能触发实例 B 的 MCP 超时。

**主实例退出后副实例无法工作**：如果先启动的 OpenCode（主实例）退出，WebSocket 服务端随之关闭，副实例会断开连接。副实例会每 10 秒重试连接，但在主实例重新启动前无法工作。此时需要重启任意一个 OpenCode 来恢复。

**自动打开的页面可能加载失败**：当 AI 指定的平台页面未打开时，插件会自动打开。但如果页面加载较慢（特别是 ChatGPT），content script 可能未就绪。插件会尝试刷新页面重试，但仍有小概率失败。建议提前打开常用的 AI 聊天页面。

**输入方式可能触发验证码**：豆包使用 React Setter 注入文本，与人工输入的事件特征不同，可能触发验证码。通过验证后短时间内不会再触发。

**ChatGPT 按钮状态异常**：ChatGPT 偶尔出现回复完成后发送按钮仍停在"停止"状态的情况，导致下一次发送失败。刷新页面可恢复。

**浏览器 Service Worker 生命周期**：Chrome 的 Manifest V3 会在约 30 秒无活动后终止 Service Worker，WebSocket 连接随之断开。已通过 chrome.alarms 保活（每 10 秒检查）和自动重连缓解，但仍有极小概率出现短暂断连。MCP Server 端会等待最多 30 秒让插件重连。

**单浏览器限制**：同一时刻只能有一个浏览器实例连接 MCP Server。如果两个浏览器都安装了插件，会互相抢连接。

## 文件结构

```
ai-bridge/
├── mcp-server/
│   ├── package.json        # Node.js 依赖
│   └── index.js            # MCP Server + WebSocket + install 命令
└── chrome-extension/
    ├── manifest.json        # 插件配置 (Manifest V3)
    ├── default-configs.js   # 内置默认配置（新增平台只改这里）
    ├── background.js        # WebSocket 客户端 + 消息路由 + 保活
    ├── content.js           # DOM 操作 + Markdown 提取 + 请求队列
    ├── debug-panel.js       # 调试面板 UI
    ├── popup.html           # 设置页面
    └── popup.js             # 设置逻辑 + 连接状态显示
```
