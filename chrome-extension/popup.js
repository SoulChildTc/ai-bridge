// ============================================
// popup.js
// 设置页面逻辑
// ============================================

const serverUrlInput = document.getElementById("serverUrl");
const tokenInput = document.getElementById("token");
const enabledToggle = document.getElementById("enabled");
const saveBtn = document.getElementById("saveBtn");
const statusDiv = document.getElementById("status");
const statusText = document.getElementById("statusText");

// 加载设置
chrome.storage.local.get(
  { serverUrl: "ws://localhost:9527", token: "", enabled: true },
  (settings) => {
    serverUrlInput.value = settings.serverUrl;
    tokenInput.value = settings.token;
    enabledToggle.checked = settings.enabled;
  }
);

// 查询连接状态
const slider = document.querySelector(".slider");

let countdownTimer = null;

function updateStatus() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

  chrome.storage.local.get("connectionState", (data) => {
    const cs = data.connectionState;
    if (!cs) {
      statusDiv.className = "status disconnected";
      statusText.textContent = "未连接";
      slider.classList.remove("connected");
      return;
    }
    switch (cs.state) {
      case "connected":
        statusDiv.className = "status connected";
        statusText.textContent = cs.detail;
        slider.classList.add("connected");
        break;
      case "connecting":
        statusDiv.className = "status connecting";
        statusText.textContent = cs.detail;
        slider.classList.remove("connected");
        break;
      case "retrying":
        statusDiv.className = "status connecting";
        slider.classList.remove("connected");
        if (cs.nextRetry) {
          startCountdown(cs.nextRetry, cs.detail);
        } else {
          statusText.textContent = cs.detail;
        }
        break;
      default:
        statusDiv.className = "status disconnected";
        statusText.textContent = cs.detail || "未知状态";
        slider.classList.remove("connected");
    }
  });
}

function startCountdown(nextRetry, baseText) {
  const update = () => {
    const remaining = Math.max(0, Math.ceil((nextRetry - Date.now()) / 1000));
    if (remaining > 0) {
      statusText.textContent = `${baseText}（${remaining}秒后重试）`;
    } else {
      statusText.textContent = "正在重连...";
      clearInterval(countdownTimer);
      countdownTimer = null;
      setTimeout(updateStatus, 2000);
    }
  };
  update();
  countdownTimer = setInterval(update, 1000);
}
updateStatus();

// 连接后轮询状态，最多查 5 次
function pollStatus(retries) {
  let count = 0;
  statusText.textContent = "连接中...";
  statusDiv.className = "status connecting";
  const timer = setInterval(() => {
    count++;
    chrome.storage.local.get("connectionState", (data) => {
      const cs = data.connectionState;
      if (cs && cs.state === "connected") {
        clearInterval(timer);
        updateStatus();
      } else if (count >= retries) {
        clearInterval(timer);
        updateStatus();
      }
    });
  }, 1000);
}

// 保存当前所有设置
function saveSettings(callback) {
  const settings = {
    serverUrl: serverUrlInput.value.trim(),
    token: tokenInput.value.trim(),
    enabled: enabledToggle.checked,
  };
  chrome.storage.local.set(settings, callback);
}

// 开关切换时立即保存并连接/断开
enabledToggle.addEventListener("change", () => {
  saveSettings(() => {
    if (enabledToggle.checked) {
      chrome.runtime.sendMessage({ type: "reconnect" }, () => {
        pollStatus(5);
      });
    } else {
      chrome.runtime.sendMessage({ type: "disconnect" }, () => {
        statusDiv.className = "status disconnected";
        statusText.textContent = "未连接";
      });
    }
  });
});

// 保存按钮
saveBtn.addEventListener("click", () => {
  saveSettings(() => {
    saveBtn.textContent = "已保存";
    setTimeout(() => { saveBtn.textContent = "保存设置"; }, 1500);

    if (enabledToggle.checked) {
      chrome.runtime.sendMessage({ type: "reconnect" }, () => {
        pollStatus(5);
      });
    }
  });
});
