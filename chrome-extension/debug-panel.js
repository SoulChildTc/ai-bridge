// ============================================
// debug-panel.js
// 浮动调试面板：配置选择器和操作方式，测试 DOM 操作
// ============================================

(function () {
  let panel = null;
  let highlightedEls = [];

  // 每个字段的配置：选择器 + 操作方式
  const FIELDS = [
    {
      key: "input", label: "输入框",
      placeholder: "如: #input-engine-container textarea",
      methods: [
        { value: "react-setter", label: "React Setter — 适用React站点" },
        { value: "exec-command", label: "execCommand — 通用" },
        { value: "paste", label: "Paste 事件 — 原生输入框" },
        { value: "input-event", label: "InputEvent — 备用" },
      ],
      defaultMethod: "react-setter",
    },
    {
      key: "sendButton", label: "发送按钮",
      placeholder: "如: #flow-end-msg-send",
      methods: [
        { value: "click", label: "点击元素 — 有独立发送按钮" },
        { value: "enter", label: "按回车键 — 无独立按钮" },
      ],
      defaultMethod: "click",
      hideSelectorWhen: ["enter"],
    },
    {
      key: "responseArea", label: "回复区域",
      placeholder: "如: .md-box-root, .markdown",
    },
    {
      key: "completionDetect", label: "生成完毕检测",
      placeholder: "停止按钮选择器",
      methods: [
        { value: "data-streaming", label: "data-streaming — 豆包" },
        { value: "aria-label", label: "aria-label 变化 — ChatGPT" },
        { value: "stop-button", label: "停止按钮消失 — 通用" },
        { value: "text-only", label: "仅文本稳定 — 兜底方案" },
      ],
      defaultMethod: "data-streaming",
      hideSelectorWhen: ["data-streaming", "aria-label", "text-only"],
      extraFields: [
        { key: "completionAriaSelector", label: "按钮选择器", placeholder: "如: #composer-submit-button", showWhen: "aria-label" },
        { key: "completionAriaDoneValue", label: "完成时的值", placeholder: "多个用逗号分隔，如: 发送提示,启动语音功能", showWhen: "aria-label" },
      ],
    },
    {
      key: "newChat", label: "新建聊天",
      placeholder: "新建聊天按钮选择器",
      methods: [
        { value: "shortcut", label: "键盘快捷键 — 豆包" },
        { value: "click", label: "点击元素 — ChatGPT等" },
        { value: "url", label: "跳转 URL — 通用" },
      ],
      defaultMethod: "shortcut",
      hideSelectorWhen: ["shortcut", "url"],
      extraFields: [
        { key: "newChatShortcut", label: "快捷键", placeholder: "如: shift+meta+k", showWhen: "shortcut" },
        { key: "newChatUrl", label: "URL", placeholder: "如: /chat/", showWhen: "url" },
      ],
    },
  ];

  function createPanel() {
    const el = document.createElement("div");
    el.id = "ai-bridge-debug";
    el.innerHTML = `
      <style>
        #ai-bridge-debug {
          position: fixed; top: 10px; right: 10px; z-index: 999999;
          width: 380px; max-height: 90vh; overflow-y: auto;
          background: #1e1e1e; color: #eee; border-radius: 8px;
          font-family: -apple-system, system-ui, sans-serif; font-size: 12px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.4); padding: 10px;
        }
        #ai-bridge-debug h3 {
          margin: 0 0 8px; font-size: 13px; color: #4fc3f7;
          cursor: grab; user-select: none; padding: 2px 0;
          display: flex; align-items: center; justify-content: space-between;
        }
        #ai-bridge-debug h3:active { cursor: grabbing; }
        #ai-bridge-debug .field { margin-bottom: 6px; padding: 6px 8px; background: #252525; border-radius: 6px; }
        #ai-bridge-debug label { display: inline; color: #888; font-size: 11px; margin-right: 4px; }
        #ai-bridge-debug .field-title { color: #ccc; font-size: 12px; font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; }
        #ai-bridge-debug .row { display: flex; gap: 3px; margin-bottom: 3px; align-items: center; }
        #ai-bridge-debug input[type="text"] {
          flex: 1; padding: 3px 6px; background: #1a1a1a; color: #eee;
          border: 1px solid #3a3a3a; border-radius: 3px; font-size: 11px; font-family: monospace;
        }
        #ai-bridge-debug select {
          padding: 2px 4px !important; background: #1a1a1a !important; color: #eee !important;
          border: 1px solid #3a3a3a !important; border-radius: 3px !important; font-size: 11px !important;
          appearance: auto !important; -webkit-appearance: menulist !important;
        }
        #ai-bridge-debug button {
          padding: 3px 8px; border: none; border-radius: 3px; cursor: pointer;
          font-size: 11px; background: #333; color: #ccc; white-space: nowrap;
        }
        #ai-bridge-debug button:hover { background: #444; }
        #ai-bridge-debug button.primary { background: #1976d2; color: #fff; }
        #ai-bridge-debug button.primary:hover { background: #1565c0; }
        #ai-bridge-debug button.success { background: #2e7d32; color: #fff; }
        #ai-bridge-debug button.success:hover { background: #1b5e20; }
        #ai-bridge-debug .result {
          margin-top: 3px; padding: 3px 6px; background: #1a1a1a;
          border-radius: 3px; font-size: 10px; color: #888; max-height: 50px; overflow-y: auto;
          white-space: pre-wrap; word-break: break-all; display: none;
        }
        #ai-bridge-debug .result.ok, #ai-bridge-debug .result.err, #ai-bridge-debug #aib-log { display: block; }
        #ai-bridge-debug .result.ok { color: #81c784; }
        #ai-bridge-debug .result.err { color: #e57373; }
        #ai-bridge-debug .actions { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
        #ai-bridge-debug .extra-row { margin-top: 3px; }
        .ai-bridge-highlight {
          outline: 3px solid #ff5722 !important;
          outline-offset: 2px !important;
          background: rgba(255, 87, 34, 0.1) !important;
        }
      </style>
      <h3><span>AI Bridge 调试面板</span><div style="display:flex;gap:3px"><button id="aib-clear-hl" style="font-size:11px">清除高亮</button><button class="success" id="aib-save">保存配置</button></div></h3>
      <div id="aib-fields"></div>
      <div style="margin-top:10px">
        <div id="aib-log" class="result" style="min-height:40px;max-height:120px;">日志输出...</div>
      </div>
    `;
    document.body.appendChild(el);

    // 构建字段 UI
    const fieldsContainer = el.querySelector("#aib-fields");
    FIELDS.forEach(f => {
      const div = document.createElement("div");
      div.className = "field";

      let methodHtml = "";
      if (f.methods) {
        const options = f.methods.map(m =>
          `<option value="${m.value}">${m.label}</option>`
        ).join("");
        methodHtml = `<select id="aib-method-${f.key}">${options}</select>`;
      }

      let extraHtml = "";
      if (f.extraFields) {
        extraHtml = f.extraFields.map(ef => `
          <div class="extra-row" id="aib-extra-${ef.key}" style="display:none">
            <div class="row"><label>${ef.label}</label><input type="text" id="aib-val-${ef.key}" placeholder="${ef.placeholder}">${ef.testable ? `<button data-key="${f.key}" class="field-test-btn primary">测试</button>` : ''}</div>
          </div>
        `).join("");
      }

      div.innerHTML = `
        <div class="field-title"><span>${f.label}</span><div style="display:flex;gap:3px;align-items:center">${methodHtml}<button data-key="${f.key}" class="field-test-btn primary">测试</button></div></div>
        <div class="row" id="aib-selrow-${f.key}">
          <input type="text" id="aib-sel-${f.key}" placeholder="${f.placeholder}">
          <button data-key="${f.key}" class="hl-btn">高亮</button>
        </div>
        ${extraHtml}
        <div class="result" id="aib-res-${f.key}"></div>
      `;
      fieldsContainer.appendChild(div);

      // 方式下拉框变化时，显示/隐藏选择器行和额外字段
      if (f.methods) {
        const select = div.querySelector(`#aib-method-${f.key}`);
        const selectorRow = div.querySelector(`#aib-selrow-${f.key}`);
        const updateVisibility = () => {
          // 选择器行
          if (f.hideSelectorWhen && f.hideSelectorWhen.includes(select.value)) {
            selectorRow.style.display = "none";
          } else {
            selectorRow.style.display = "flex";
          }
          // 额外字段
          if (f.extraFields) {
            f.extraFields.forEach(ef => {
              const extraEl = div.querySelector(`#aib-extra-${ef.key}`);
              extraEl.style.display = select.value === ef.showWhen ? "block" : "none";
            });
          }
        };
        select.addEventListener("change", updateVisibility);
        updateVisibility();
      }
    });

    // 高亮按钮
    el.querySelectorAll(".hl-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        const selector = el.querySelector(`#aib-sel-${key}`).value.trim();
        const resEl = el.querySelector(`#aib-res-${key}`);
        testSelector(selector, resEl);
      });
    });

    // 测试按钮
    el.querySelectorAll(".field-test-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        const selector = el.querySelector(`#aib-sel-${key}`)?.value.trim();
        const methodSelect = el.querySelector(`#aib-method-${key}`);
        const method = methodSelect ? methodSelect.value : "default";

        switch (key) {
          case "input":
            testInput(selector, method);
            break;
          case "sendButton":
            testSend(selector, method);
            break;
          case "responseArea":
            testResponse(selector);
            break;
          case "completionDetect":
            testCompletion(selector, method);
            break;
          case "newChat":
            testNewChat(selector, method);
            break;
        }
      });
    });

    // 保存配置
    el.querySelector("#aib-save").addEventListener("click", () => {
      const config = {};
      FIELDS.forEach(f => {
        config[f.key] = {
          selector: el.querySelector(`#aib-sel-${f.key}`)?.value.trim() || "",
          method: el.querySelector(`#aib-method-${f.key}`)?.value || "default",
        };
        if (f.extraFields) {
          f.extraFields.forEach(ef => {
            config[ef.key] = el.querySelector(`#aib-val-${ef.key}`)?.value.trim() || "";
          });
        }
      });
      const host = window.location.hostname;
      chrome.storage.local.set({ [`config_${host}`]: config }, () => {
        log(`已保存 ${host} 的配置:\n${JSON.stringify(config, null, 2)}`);
      });
    });

    // 清除高亮
    el.querySelector("#aib-clear-hl").addEventListener("click", clearHighlights);

    // 加载已保存的配置，或内置默认配置（由 default-configs.js 提供）
    const host = window.location.hostname;

    chrome.storage.local.get(`config_${host}`, (data) => {
      const config = data[`config_${host}`] || (typeof AI_BRIDGE_DEFAULT_CONFIGS !== "undefined" && AI_BRIDGE_DEFAULT_CONFIGS[host]);
      if (config) {
        fillConfig(el, config);
        log(data[`config_${host}`] ? "已加载保存的配置" : "已加载内置默认配置");
      }
    });

    function fillConfig(el, config) {
      FIELDS.forEach(f => {
        if (config[f.key]) {
          const selInput = el.querySelector(`#aib-sel-${f.key}`);
          const methodSelect = el.querySelector(`#aib-method-${f.key}`);
          if (selInput && config[f.key].selector) selInput.value = config[f.key].selector;
          if (methodSelect && config[f.key].method) {
            methodSelect.value = config[f.key].method;
            methodSelect.dispatchEvent(new Event("change"));
          }
        }
        if (f.extraFields) {
          f.extraFields.forEach(ef => {
            if (config[ef.key]) {
              const input = el.querySelector(`#aib-val-${ef.key}`);
              if (input) input.value = config[ef.key];
            }
          });
        }
      });
    }

    // 拖动
    const header = el.querySelector("h3");
    let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
    header.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragOffsetX = e.clientX - el.getBoundingClientRect().left;
      dragOffsetY = e.clientY - el.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      el.style.left = (e.clientX - dragOffsetX) + "px";
      el.style.top = (e.clientY - dragOffsetY) + "px";
      el.style.right = "auto";
    });
    document.addEventListener("mouseup", () => { isDragging = false; });

    return el;
  }

  // ---------- 测试函数 ----------

  function testInput(selector, method) {
    if (!selector) { log("请填入输入框选择器"); return; }
    const target = document.querySelector(selector);
    if (!target) { log(`找不到元素: ${selector}`); return; }

    const testText = "Hello from AI Bridge!";
    target.focus();

    switch (method) {
      case "react-setter": {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set;
        if (setter) {
          setter.call(target, testText);
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          log(`React Setter: 已输入 "${testText}"`);
        } else {
          log("React Setter: 无法获取 value setter");
        }
        break;
      }
      case "exec-command":
        document.execCommand('insertText', false, testText);
        log(`execCommand: 已输入 "${testText}"`);
        break;
      case "paste": {
        const cd = new DataTransfer();
        cd.setData("text/plain", testText);
        target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: cd }));
        log(`Paste: 已输入 "${testText}"`);
        break;
      }
      case "input-event":
        target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: testText }));
        target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: testText }));
        log(`InputEvent: 已输入 "${testText}"`);
        break;
    }
  }

  function testSend(selector, method) {
    if (method === "enter") {
      log("发送测试：1.5秒后按回车...");
      setTimeout(() => {
        const input = document.activeElement;
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        log("回车已发送");
      }, 1500);
      return;
    }
    if (!selector) { log("请填入发送按钮选择器"); return; }
    const target = document.querySelector(selector);
    if (!target) { log(`找不到元素: ${selector}`); return; }
    log("发送测试：1.5秒后点击...\n（如果输入框有内容会真的发送！）");
    setTimeout(() => { target.click(); log("发送按钮已点击"); }, 1500);
  }

  function testResponse(selector) {
    if (!selector) { log("请填入回复区域选择器"); return; }
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) { log("未找到回复元素"); return; }
    const last = elements[elements.length - 1];
    const text = last.innerText || last.textContent || "";
    const streaming = last.getAttribute("data-streaming");
    log(`找到 ${elements.length} 条回复${streaming !== null ? ` | data-streaming="${streaming}"` : ""}\n\n最后一条（前300字）:\n${text.substring(0, 300)}`);
  }

  function testCompletion(selector, method) {
    const panel = document.querySelector("#ai-bridge-debug");
    const responseSelector = panel.querySelector("#aib-sel-responseArea")?.value.trim();
    switch (method) {
      case "data-streaming": {
        if (!responseSelector) { log("请先配置回复区域选择器"); return; }
        const responses = document.querySelectorAll(responseSelector);
        if (responses.length === 0) { log("页面上没有回复，请先发一条消息再测试"); return; }
        const last = responses[responses.length - 1];
        const val = last.getAttribute("data-streaming");
        if (val === null) {
          log('最后一条回复没有 data-streaming 属性\n→ 该网站不支持此方式，请换成「停止按钮」或「仅文本稳定」');
        } else {
          log(`data-streaming = "${val}"\n→ ${val === "false" ? "生成已完毕" : "正在生成中"}`);
        }
        break;
      }
      case "aria-label": {
        const panel = document.querySelector("#ai-bridge-debug");
        const ariaSelector = panel.querySelector("#aib-val-completionAriaSelector")?.value.trim();
        const ariaDoneStr = panel.querySelector("#aib-val-completionAriaDoneValue")?.value.trim();
        if (!ariaSelector) { log("请填入按钮选择器"); return; }
        if (!ariaDoneStr) { log("请填入完成时的 aria-label 值"); return; }
        const ariaDoneValues = ariaDoneStr.split(",").map(s => s.trim());
        const btn = document.querySelector(ariaSelector);
        if (!btn) { log(`找不到元素: ${ariaSelector}`); return; }
        const currentLabel = btn.getAttribute("aria-label");
        const isDone = ariaDoneValues.includes(currentLabel);
        log(`当前 aria-label = "${currentLabel}"\n匹配值: ${ariaDoneValues.join(", ")}\n→ ${isDone ? "未在生成（已完成）" : "正在生成中"}`);
        break;
      }
      case "stop-button": {
        if (!selector) { log("请填入停止按钮选择器"); return; }
        const btn = document.querySelector(selector);
        log(btn ? `停止按钮已找到，${btn.offsetParent !== null ? "当前可见（正在生成）" : "当前不可见（未生成）"}` : "停止按钮未找到（当前可能没在生成，属正常）");
        break;
      }
      case "text-only":
        log("此方式不需要额外配置\n发送消息后会自动等待回复文本连续3秒不变后判定完毕");
        break;
    }
  }

  function testNewChat(selector, method) {
    const panel = document.querySelector("#ai-bridge-debug");
    switch (method) {
      case "shortcut": {
        const shortcutStr = panel.querySelector("#aib-val-newChatShortcut")?.value.trim();
        if (!shortcutStr) { log("请填入快捷键，如: shift+meta+k"); return; }
        const keys = parseShortcut(shortcutStr);
        log(`新建聊天测试：1.5秒后发送快捷键 ${shortcutStr}...`);
        setTimeout(() => {
          document.dispatchEvent(new KeyboardEvent("keydown", {
            key: keys.key, code: `Key${keys.key.toUpperCase()}`,
            shiftKey: keys.shift, metaKey: keys.meta, ctrlKey: keys.ctrl, altKey: keys.alt,
            bubbles: true,
          }));
          log("快捷键已发送");
        }, 1500);
        break;
      }
      case "click": {
        if (!selector) { log("请填入新建聊天按钮选择器"); return; }
        const btn = document.querySelector(selector);
        if (!btn) { log(`找不到元素: ${selector}`); return; }
        log("新建聊天测试：1.5秒后点击...");
        setTimeout(() => { btn.click(); log("已点击"); }, 1500);
        break;
      }
      case "url": {
        const url = panel.querySelector("#aib-val-newChatUrl")?.value.trim();
        if (!url) { log("请填入 URL"); return; }
        log(`新建聊天测试：1.5秒后跳转到 ${url}...`);
        setTimeout(() => { window.location.href = url; }, 1500);
        break;
      }
    }
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

  // ---------- 通用函数 ----------

  function testSelector(selector, resEl) {
    clearHighlights();
    if (!selector) { resEl.textContent = "请输入选择器"; resEl.className = "result err"; return; }
    try {
      const els = document.querySelectorAll(selector);
      if (els.length === 0) {
        resEl.textContent = "未找到匹配元素";
        resEl.className = "result err";
      } else {
        const first = els[0];
        const tag = first.tagName.toLowerCase();
        const id = first.id ? `#${first.id}` : "";
        const cls = first.className && typeof first.className === "string"
          ? `.${first.className.split(" ").slice(0, 2).join(".")}` : "";
        resEl.textContent = `找到 ${els.length} 个元素 | <${tag}${id}${cls}> | "${(first.textContent || "").substring(0, 50)}"`;
        resEl.className = "result ok";
        els.forEach(el => { el.classList.add("ai-bridge-highlight"); highlightedEls.push(el); });
      }
    } catch (e) {
      resEl.textContent = `选择器语法错误: ${e.message}`;
      resEl.className = "result err";
    }
  }

  function clearHighlights() {
    highlightedEls.forEach(el => { try { el.classList.remove("ai-bridge-highlight"); } catch {} });
    highlightedEls = [];
  }

  function log(text) {
    const logEl = document.querySelector("#aib-log");
    if (logEl) logEl.textContent = text;
  }

  function togglePanel() {
    if (panel) { panel.remove(); panel = null; clearHighlights(); }
    else { panel = createPanel(); }
  }

  // ---------- 浮动按钮 ----------

  const fab = document.createElement("div");
  fab.id = "ai-bridge-fab";
  fab.innerHTML = `
    <style>
      #ai-bridge-fab {
        position: fixed; bottom: 20px; right: 20px; z-index: 999998;
        width: 48px; height: 48px; border-radius: 50%;
        background: #1976d2; color: white;
        display: flex; align-items: center; justify-content: center;
        cursor: grab; font-size: 20px; font-weight: bold;
        box-shadow: 0 2px 12px rgba(0,0,0,0.3); user-select: none;
      }
      #ai-bridge-fab:hover { background: #1565c0; }
      #ai-bridge-fab:active { cursor: grabbing; }
    </style>
    AI
  `;

  let fabDragging = false, fabMoved = false, fabOffsetX = 0, fabOffsetY = 0, fabStartX = 0, fabStartY = 0;
  fab.addEventListener("mousedown", (e) => {
    fabDragging = true; fabMoved = false;
    fabStartX = e.clientX; fabStartY = e.clientY;
    fabOffsetX = e.clientX - fab.getBoundingClientRect().left;
    fabOffsetY = e.clientY - fab.getBoundingClientRect().top;
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!fabDragging) return;
    const dx = e.clientX - fabStartX, dy = e.clientY - fabStartY;
    if (!fabMoved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    fabMoved = true;
    fab.style.left = (e.clientX - fabOffsetX) + "px";
    fab.style.top = (e.clientY - fabOffsetY) + "px";
    fab.style.right = "auto"; fab.style.bottom = "auto";
  });
  document.addEventListener("mouseup", () => {
    if (fabDragging && !fabMoved) togglePanel();
    fabDragging = false;
  });
  document.body.appendChild(fab);

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "D") { e.preventDefault(); togglePanel(); }
  });

  console.log("[ai-bridge] 调试面板已就绪");
})();
