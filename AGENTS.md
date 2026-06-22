# AI Bridge 项目交接文档

## 项目概述

AI Bridge 是一个让终端 AI 编程助手（如 OpenCode 中的 DeepSeek）通过浏览器使用 Web AI 对话服务（豆包、ChatGPT）的工具。由 MCP Server（Node.js）和 Chrome 插件两部分组成，通过 WebSocket 通信。

## 架构

```
DeepSeek (OpenCode) ←→ MCP Server (stdio) ←→ WebSocket (9527) ←→ Chrome 插件 (Service Worker) ←→ Content Script ←→ AI 聊天页面 DOM
```

## 文件说明

### mcp-server/index.js

单文件，包含所有服务端逻辑：

- **日志系统**：写入 `/tmp/ai-bridge.log`，同时输出到 stderr
- **WebSocket 服务端/客户端**：
  - 主实例监听 9527 端口
  - 副实例（端口被占时）自动切换为客户端连接主实例
  - 主实例负责在插件和副实例之间路由消息（通过 requestId 匹配）
- **MCP 工具**：
  - `check_connection`：检查插件连接状态
  - `new_session`：新建对话，参数 message + platform，返回 sessionUrl
  - `ask_ai`：继续对话，参数 message + sessionUrl + platform
- **install 命令**：`node index.js install [token]`，自动配置 OpenCode 的 opencode.jsonc
- **系统提示词**：`SYSTEM_PROMPT` 常量，在 `new_session` 时拼接到用户消息前面
- **waitForConnection**：发送前检查插件连接，断了会等最多 30 秒让插件重连

### chrome-extension/

| 文件 | 职责 |
|------|------|
| `manifest.json` | Manifest V3 配置，声明权限（storage, activeTab, alarms, tabs）、host_permissions、content_scripts 加载顺序 |
| `default-configs.js` | 豆包和 ChatGPT 的内置默认配置，全局变量 `AI_BRIDGE_DEFAULT_CONFIGS`，content.js 和 debug-panel.js 共享 |
| `background.js` | Service Worker，管理 WebSocket 连接到 MCP Server、消息路由（MCP Server ↔ Content Script）、自动打开/刷新页面、keepalive alarm（10秒）、连接状态存 storage |
| `content.js` | 注入到 AI 聊天页面，DOM 操作（输入、发送、等待回复、提取回复）、请求队列（串行）、Markdown 提取、配置从 storage 读取 |
| `debug-panel.js` | 浮动调试面板 UI，可视化配置选择器和操作方式、高亮元素、逐项测试、保存到 storage |
| `popup.html` + `popup.js` | 插件设置弹窗，Token/URL 配置、连接开关、状态显示（含倒计时） |

## 关键设计决策

### 为什么用浏览器自动化而不是 API
用户没有经济能力购买 API 额度。

### 为什么用 WebSocket 而不是 Native Messaging
参考了 WechatSync 插件的架构。WebSocket 方案更简单，不需要额外的 native host manifest 配置。

### 为什么不用 HTTP 轮询替代 WebSocket
讨论过但未实施。HTTP 轮询能彻底解决 Service Worker 生命周期问题，但重构工作量大。当前用 chrome.alarms 保活缓解。

### 配置存储架构
- 选择器和操作方式存在 `chrome.storage.local`，key 为 `config_${hostname}`
- 每个域名独立存储，互不干扰
- 内置默认配置（`default-configs.js`）作为 fallback
- 用户通过调试面板保存的配置优先于内置默认

### 多实例架构
- 第一个 MCP Server 启动 WebSocket 服务端（主实例）
- 后续 MCP Server 检测到端口被占，切换为 WebSocket 客户端（副实例）
- 主实例通过 requestId 路由：自己的请求直接处理，不匹配的转发给所有副实例
- 副实例断线后 10 秒重连

### 输入方式
豆包用 React Setter（通过 HTMLTextAreaElement.prototype.value 的原生 setter 绕过 React 受控组件），ChatGPT 用 execCommand。由用户在调试面板配置。

### 生成完毕检测
- 豆包：`data-streaming` 属性（`"false"` 表示完成）
- ChatGPT：`aria-label` 属性变化（`"发送提示"` 或 `"启动语音功能"` 表示完成）
- 兜底：文本稳定性检测（连续 3 秒内容不变）

## 已知问题与待优化

### 高优先级

1. **Service Worker 断连**：Manifest V3 的 Service Worker 会被浏览器终止，WebSocket 断开。当前用 alarm 保活（10秒）+ MCP Server 端 waitForConnection（30秒）缓解，但不完美。根本解决方案是改为 HTTP 轮询。

2. **输入触发验证码**：豆包的 React Setter 注入方式与人工输入特征不同，偶尔触发验证码。可优化为模拟逐字输入加随机延迟。

3. **自动打开页面后偶尔失败**：新打开的 ChatGPT 页面加载慢，content script 注入时机问题。已加刷新重试逻辑，但 ChatGPT 页面特别重时仍可能超时。

### 中优先级

4. **ChatGPT 按钮状态异常**：偶发，回复完成后发送按钮停在"停止"状态，导致下次发送失败。原因不明，可能是 ChatGPT 的 bug。可改用回车键发送绕过。

5. **主实例退出后副实例不可用**：主实例的 WebSocket 服务端关闭后，副实例无法工作。需要某种主实例选举或迁移机制。

### 低优先级

6. **单浏览器限制**：多个浏览器的插件会互相抢 `extensionSocket`。需要改为支持多 extension 连接。

7. **npm 包发布**：package.json 已准备好，需要确认包名可用并发布。

## 开发调试

### MCP Server 日志
```bash
tail -f /tmp/ai-bridge.log
```

### Chrome 插件调试
- background.js：`chrome://extensions` → AI Bridge → "Service Worker" 链接
- content.js：在 AI 聊天页面 F12 控制台搜索 `[ai-bridge]`
- popup：右键插件图标 → "检查弹出式窗口"

### 手动启动 MCP Server
```bash
cd mcp-server
AI_BRIDGE_MCP_TOKEN=changeme node index.js
```

### 本地测试修改
1. 改代码
2. `chrome://extensions` 刷新插件
3. 刷新 AI 聊天页面
4. 重启 OpenCode（MCP Server 会重新启动）

## 代码风格

- ES Modules（`"type": "module"`）
- 无构建步骤，源码即运行代码
- Chrome 插件部分是普通 JS（非 ES Module），通过 manifest content_scripts 注入，共享全局作用域
- 变量命名带 `AI_BRIDGE_` 前缀避免全局冲突
