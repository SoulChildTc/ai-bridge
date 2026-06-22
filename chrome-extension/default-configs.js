// 内置默认配置，content.js 和 debug-panel.js 共享
// 新增平台时只需在这里添加

const AI_BRIDGE_DEFAULT_CONFIGS = {
  "www.doubao.com": {
    input: { selector: "#input-engine-container textarea", method: "react-setter" },
    sendButton: { selector: "#flow-end-msg-send", method: "click" },
    responseArea: { selector: ".md-box-root", method: "default" },
    completionDetect: { selector: "", method: "data-streaming" },
    newChat: { selector: "", method: "shortcut" },
    newChatShortcut: "shift+cmd+k",
    newChatUrl: "",
  },
  "chatgpt.com": {
    input: { selector: "#prompt-textarea", method: "exec-command" },
    sendButton: { selector: 'button[data-testid="send-button"]', method: "click" },
    responseArea: { selector: '[data-message-author-role="assistant"] .markdown', method: "default" },
    completionDetect: { selector: "", method: "aria-label" },
    completionAriaSelector: "button.composer-submit-button-color",
    completionAriaDoneValue: "发送提示,启动语音功能",
    newChat: { selector: 'a[href="/"]', method: "click" },
    newChatShortcut: "",
    newChatUrl: "",
  },
};
