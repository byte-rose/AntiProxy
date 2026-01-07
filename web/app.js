const state = {
  accounts: [],
  currentAccountId: null,
  mappings: {
    anthropic: {},
    openai: {},
    custom: {},
  },
  models: [],
  selectedProtocol: "openai",
  selectedModelId: null,
  oauth: {
    status: "idle",
    message: "",
    authUrl: "",
  },
  // API Keys state
  apiKeys: [],
  apiKeysTotalUsage: null,
  // Theme state
  theme: "system", // "light", "dark", or "system"
};

// ========== Theme Management ==========

/**
 * Get system preferred theme
 * @returns {"light"|"dark"} System preferred theme
 */
function getSystemTheme() {
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

/**
 * Get effective theme (considering system option)
 * @param {string} theme - Theme setting ("light", "dark", or "system")
 * @returns {"light"|"dark"} Actual applied theme
 */
function getEffectiveTheme(theme) {
  if (theme === "system") {
    return getSystemTheme();
  }
  return theme;
}

/**
 * Apply theme to DOM
 * @param {string} theme - Theme setting
 */
function applyTheme(theme) {
  const effectiveTheme = getEffectiveTheme(theme);
  document.documentElement.setAttribute("data-theme", effectiveTheme);
}

/**
 * Save theme to localStorage
 * @param {string} theme - Theme setting
 */
function saveTheme(theme) {
  localStorage.setItem("theme", theme);
}

/**
 * Load theme from localStorage
 * @returns {string} Saved theme setting, defaults to "system"
 */
function loadTheme() {
  return localStorage.getItem("theme") || "system";
}

/**
 * Initialize theme
 */
function initTheme() {
  state.theme = loadTheme();
  applyTheme(state.theme);
  renderThemeSwitcher();

  // Listen for system theme changes
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (state.theme === "system") {
        applyTheme("system");
      }
    });
  }
}

/**
 * Set theme
 * @param {string} theme - New theme setting
 */
function setTheme(theme) {
  state.theme = theme;
  saveTheme(theme);
  applyTheme(theme);
  renderThemeSwitcher();
}

/**
 * Render theme switcher UI
 */
function renderThemeSwitcher() {
  const switcher = document.getElementById("themeSwitcher");
  if (!switcher) return;

  switcher.querySelectorAll(".theme-option").forEach((option) => {
    const themeValue = option.dataset.themeValue;
    option.classList.toggle("active", themeValue === state.theme);
  });
}

// ========== Utility Functions ==========

/**
 * Debounce function - reduces API calls for high-frequency operations
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay time in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(fn, delay) {
  let timeoutId = null;
  return function (...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Throttle function - limits execution frequency of high-frequency operations
 * @param {Function} fn - Function to throttle
 * @param {number} limit - Minimum interval time in milliseconds
 * @returns {Function} - Throttled function
 */
function throttle(fn, limit) {
  let lastCall = 0;
  let timeoutId = null;
  return function (...args) {
    const now = Date.now();
    const remaining = limit - (now - lastCall);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn.apply(this, args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

const elements = {
  summaryGrid: document.getElementById("summaryGrid"),
  currentAccountBadge: document.getElementById("currentAccountBadge"),
  currentAccountBody: document.getElementById("currentAccountBody"),
  accountsList: document.getElementById("accountsList"),
  refreshAllBtn: document.getElementById("refreshAllBtn"),
  refreshAllAccountsBtn: document.getElementById("refreshAllAccountsBtn"),
  refreshTokenInput: document.getElementById("refreshTokenInput"),
  addAccountBtn: document.getElementById("addAccountBtn"),
  toast: document.getElementById("toast"),
  oauthStartBtn: document.getElementById("oauthStartBtn"),
  oauthLinkBox: document.getElementById("oauthLinkBox"),
  oauthLinkText: document.getElementById("oauthLinkText"),
  oauthOpenBtn: document.getElementById("oauthOpenBtn"),
  oauthCopyBtn: document.getElementById("oauthCopyBtn"),
  oauthStatus: document.getElementById("oauthStatus"),
  oauthFallbackBox: document.getElementById("oauthFallbackBox"),
  oauthCallbackInput: document.getElementById("oauthCallbackInput"),
  oauthCallbackSubmit: document.getElementById("oauthCallbackSubmit"),
  resetMappingBtn: document.getElementById("resetMappingBtn"),
  customMappingSource: document.getElementById("customMappingSource"),
  customMappingTarget: document.getElementById("customMappingTarget"),
  addCustomMappingBtn: document.getElementById("addCustomMappingBtn"),
  customMappingList: document.getElementById("customMappingList"),
  protocolGrid: document.getElementById("protocolGrid"),
  modelList: document.getElementById("modelList"),
  codeSample: document.getElementById("codeSample"),
  protocolBadge: document.getElementById("protocolBadge"),
  copyExampleBtn: document.getElementById("copyExampleBtn"),
  // API Keys elements
  createApiKeyBtn: document.getElementById("createApiKeyBtn"),
  refreshApiKeysBtn: document.getElementById("refreshApiKeysBtn"),
  apiKeysList: document.getElementById("apiKeysList"),
  apiKeysUsageSummary: document.getElementById("apiKeysUsageSummary"),
  // Settings elements
  resetAuthBtn: document.getElementById("resetAuthBtn"),
};

const defaultMappings = {
  anthropic: {
    "claude-4.5-series": "gemini-3-pro-high",
    "claude-3.5-series": "claude-sonnet-4-5-thinking",
  },
  openai: {
    "gpt-4-series": "gemini-3-pro-high",
    "gpt-4o-series": "gemini-3-flash",
    "gpt-5-series": "gemini-3-flash",
  },
};

const protocolBadges = {
  openai: "OpenAI SDK",
  anthropic: "Anthropic SDK",
  gemini: "Google GenAI",
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function getBaseUrl() {
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

function getOpenAiBaseUrl() {
  return `${getBaseUrl()}/v1`;
}

function buildModelOptions(models) {
  if (!models.length) {
    return '<option value="">Loading models...</option>';
  }
  return models
    .map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
    .join("");
}

function copyText(text, label) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast(label);
  });
}

let oauthPollTimer = null;

function updateOAuthUI(status, message, authUrl) {
  state.oauth.status = status || "idle";
  state.oauth.message = message || "";
  const isSuccess = state.oauth.status === "success";
  if (typeof authUrl === "string") {
    state.oauth.authUrl = isSuccess ? "" : authUrl;
  } else if (isSuccess) {
    state.oauth.authUrl = "";
  }
  const isLoading = state.oauth.status === "loading";
  const isWaiting = state.oauth.status === "waiting";
  const isBusy = isLoading || isWaiting;

  if (elements.oauthStatus) {
    elements.oauthStatus.textContent = state.oauth.message || "";
    elements.oauthStatus.classList.remove("success", "error");
    if (state.oauth.status === "success") {
      elements.oauthStatus.classList.add("success");
    }
    if (state.oauth.status === "error") {
      elements.oauthStatus.classList.add("error");
    }
  }

  if (elements.oauthStartBtn) {
    elements.oauthStartBtn.disabled = isBusy;
    elements.oauthStartBtn.textContent = isBusy ? "Waiting for OAuth..." : "Start OAuth Login";
  }

  if (elements.oauthLinkBox) {
    if (state.oauth.authUrl && !isSuccess) {
      elements.oauthLinkBox.classList.remove("hidden");
    } else {
      elements.oauthLinkBox.classList.add("hidden");
    }
  }

  if (elements.oauthLinkText) {
    elements.oauthLinkText.textContent = state.oauth.authUrl || "";
  }

  if (elements.oauthOpenBtn) {
    elements.oauthOpenBtn.disabled = !state.oauth.authUrl;
  }

  if (elements.oauthCallbackSubmit) {
    elements.oauthCallbackSubmit.disabled = isLoading;
  }
}

async function fetchOAuthStatus() {
  if (!elements.oauthStatus) return;
  try {
    const data = await apiFetch("/api/oauth/status");
    if (!data) return;
    updateOAuthUI(data.status, data.message || "", data.auth_url || "");
    if (data.status === "success") {
      stopOAuthPolling();
      showToast("OAuth success");
      loadAccounts();
    } else if (data.status === "waiting") {
      startOAuthPolling();
    } else if (data.status === "error") {
      stopOAuthPolling();
    }
  } catch (err) {
    stopOAuthPolling();
    updateOAuthUI("error", `OAuth status failed: ${err.message}`);
  }
}

function startOAuthPolling() {
  if (oauthPollTimer) {
    return;
  }
  oauthPollTimer = setInterval(fetchOAuthStatus, 2000);
}

function stopOAuthPolling() {
  if (oauthPollTimer) {
    clearInterval(oauthPollTimer);
    oauthPollTimer = null;
  }
}

function openOAuthLink() {
  if (!state.oauth.authUrl) return;
  window.open(state.oauth.authUrl, "_blank", "noopener");
}

async function startOAuthLogin() {
  if (!elements.oauthStartBtn) return;
  updateOAuthUI("loading", "Preparing OAuth link...");
  try {
    const data = await apiFetch("/api/oauth/prepare");
    if (!data || !data.auth_url) {
      throw new Error("OAuth URL missing");
    }
    updateOAuthUI("waiting", "Waiting for authorization...", data.auth_url);
    if (elements.oauthCallbackInput) {
      elements.oauthCallbackInput.value = "";
    }
    openOAuthLink();
    startOAuthPolling();
    fetchOAuthStatus();
  } catch (err) {
    updateOAuthUI("error", err.message || "OAuth failed");
  }
}

async function submitOAuthCallback() {
  if (!elements.oauthCallbackInput) return;
  const callbackUrl = elements.oauthCallbackInput.value.trim();
  if (!callbackUrl) {
    updateOAuthUI("error", "Please paste the callback URL first.");
    return;
  }
  updateOAuthUI("loading", "Submitting callback URL...");
  try {
    const data = await apiFetch("/api/oauth/callback", {
      method: "POST",
      body: JSON.stringify({ callback_url: callbackUrl }),
    });
    updateOAuthUI(data.status || "success", data.message || "", data.auth_url || "");
    stopOAuthPolling();
    if (data.status === "success") {
      showToast("OAuth success");
      elements.oauthCallbackInput.value = "";
      loadAccounts();
    }
  } catch (err) {
    stopOAuthPolling();
    updateOAuthUI("error", err.message || "OAuth callback failed");
  }
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized - redirect to login
  if (response.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Authentication required");
  }

  if (!response.ok) {
    const text = await response.text();
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.error) {
        message = parsed.error;
      }
    } catch (_) { }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(timestamp) {
  if (!timestamp) return "-";
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

/**
 * Returns color class based on percentage
 * @param {number} percentage - Percentage value (0-100)
 * @returns {string} - CSS class name: 'quota-high' (green), 'quota-medium' (yellow), 'quota-low' (red)
 */
function getQuotaColorClass(percentage) {
  if (percentage >= 60) return "quota-high";
  if (percentage >= 30) return "quota-medium";
  return "quota-low";
}

function computeSummary(accounts) {
  const total = accounts.length;
  let geminiAvg = 0;
  let claudeAvg = 0;
  let geminiCount = 0;
  let claudeCount = 0;

  accounts.forEach((account) => {
    const models = (account.quota && account.quota.models) || [];
    models.forEach((model) => {
      const name = String(model.name || "").toLowerCase();
      if (name.includes("gemini")) {
        geminiAvg += model.percentage || 0;
        geminiCount += 1;
      }
      if (name.includes("claude")) {
        claudeAvg += model.percentage || 0;
        claudeCount += 1;
      }
    });
  });

  const avgGemini = geminiCount ? Math.round(geminiAvg / geminiCount) : 0;
  const avgClaude = claudeCount ? Math.round(claudeAvg / claudeCount) : 0;

  return { total, avgGemini, avgClaude };
}

function computeAccountStats(account) {
  const models = (account.quota && account.quota.models) || [];
  let geminiTotal = 0;
  let claudeTotal = 0;
  let geminiCount = 0;
  let claudeCount = 0;

  models.forEach((model) => {
    const name = String(model.name || "").toLowerCase();
    if (name.includes("gemini")) {
      geminiTotal += model.percentage || 0;
      geminiCount += 1;
    }
    if (name.includes("claude")) {
      claudeTotal += model.percentage || 0;
      claudeCount += 1;
    }
  });

  return {
    geminiAvg: geminiCount ? Math.round(geminiTotal / geminiCount) : 0,
    claudeAvg: claudeCount ? Math.round(claudeTotal / claudeCount) : 0,
    geminiCount,
    claudeCount,
  };
}

function renderMetricCard(label, value, count) {
  const safeValue = Math.max(0, Math.min(100, value || 0));
  const colorClass = getQuotaColorClass(safeValue);
  return `
    <div class="metric-card ${colorClass}">
      <span class="metric-title">${escapeHtml(label)}</span>
      <strong>${safeValue}%</strong>
      <div class="progress"><div style="width:${safeValue}%"></div></div>
      <span class="metric-meta">${count || 0} models</span>
    </div>
  `;
}

function renderTierBadge(tier) {
  if (!tier || tier === "-") {
    return '<span class="badge">Tier: -</span>';
  }
  const normalized = String(tier).toLowerCase();
  if (normalized.includes("ultra")) {
    return '<span class="badge ultra">ULTRA</span>';
  }
  if (normalized.includes("pro")) {
    return '<span class="badge pro">PRO</span>';
  }
  if (normalized.includes("free")) {
    return '<span class="badge free">FREE</span>';
  }
  return `<span class="badge">Tier: ${escapeHtml(tier)}</span>`;
}

function renderSummary() {
  const summary = computeSummary(state.accounts);
  const cards = [
    { title: "Gemini", value: summary.avgGemini },
    { title: "Claude", value: summary.avgClaude },
  ];

  elements.summaryGrid.innerHTML = cards
    .map(
      (card, index) => {
        const colorClass = getQuotaColorClass(card.value);
        return `
      <div class="summary-card ${colorClass}" style="animation-delay:${index * 0.05}s">
        <h3>${escapeHtml(card.title)}</h3>
        <div class="value">${card.value}%</div>
      </div>
    `;
      }
    )
    .join("");
}

function renderCurrentAccount() {
  const current = state.accounts.find((a) => a.id === state.currentAccountId);
  if (!current) {
    elements.currentAccountBadge.textContent = "None";
    elements.currentAccountBody.innerHTML = "<div class=\"empty\">No account selected.</div>";
    return;
  }

  elements.currentAccountBadge.textContent = current.email || "Account";
  const stats = computeAccountStats(current);
  const otherAccounts = state.accounts.filter((a) => a.id !== state.currentAccountId);
  const otherAccountsHtml = otherAccounts.length
    ? `
    <div class="other-accounts">
      <div class="other-accounts-head">
        <span>Other Accounts</span>
        <div class="other-accounts-cols">
          <span>Gemini</span>
          <span>Claude</span>
        </div>
      </div>
      <div class="other-accounts-list">
        ${otherAccounts
          .map((account) => {
            const accountStats = computeAccountStats(account);
            const geminiColorClass = getQuotaColorClass(accountStats.geminiAvg);
            const claudeColorClass = getQuotaColorClass(accountStats.claudeAvg);
            return `
              <div class="other-account-item">
                <div class="other-account-main">
                  <span class="other-account-email truncate" title="${escapeHtml(account.email)}">${escapeHtml(account.email)}</span>
                </div>
                <div class="other-account-meta">
                  <span class="other-account-pill ${geminiColorClass}">${accountStats.geminiAvg}%</span>
                  <span class="other-account-pill ${claudeColorClass}">${accountStats.claudeAvg}%</span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
    `
    : "";
  elements.currentAccountBody.innerHTML = `
    <div class="card-title">
      <strong class="truncate" title="${escapeHtml(current.email)}">${escapeHtml(current.email)}</strong>
      <span class="muted truncate">${escapeHtml(current.name || "Unnamed")}</span>
    </div>
    <div class="badges">
      ${current.quota && current.quota.subscription_tier ? renderTierBadge(current.quota.subscription_tier) : ""}
      ${current.disabled ? '<span class="badge danger">Disabled</span>' : '<span class="badge success">Active</span>'}
    </div>
    <div class="account-metrics">
      ${renderMetricCard("Gemini", stats.geminiAvg, stats.geminiCount)}
      ${renderMetricCard("Claude", stats.claudeAvg, stats.claudeCount)}
    </div>
    ${otherAccountsHtml}
  `;
}

function renderAccounts() {
  if (!state.accounts.length) {
    elements.accountsList.innerHTML = '<div class="empty">No accounts found.</div>';
    return;
  }

  elements.accountsList.innerHTML = state.accounts
    .map((account) => {
      const isCurrent = account.id === state.currentAccountId;
      const tier = account.quota && account.quota.subscription_tier ? account.quota.subscription_tier : "-";
      const updatedAt = account.quota && account.quota.last_updated ? formatDate(account.quota.last_updated) : "-";
      const stats = computeAccountStats(account);
      const geminiColorClass = getQuotaColorClass(stats.geminiAvg);
      const claudeColorClass = getQuotaColorClass(stats.claudeAvg);
      return `
        <div class="table-row">
          <div class="table-cell" style="overflow:hidden">
            <strong class="truncate" title="${escapeHtml(account.email)}">${escapeHtml(account.email)}</strong>
            <span class="muted truncate">${escapeHtml(account.name || "Unnamed")}</span>
          </div>
          <div class="table-cell">
            ${isCurrent ? '<span class="badge success">Current</span>' : ""}
            ${account.disabled ? '<span class="badge danger">Disabled</span>' : '<span class="badge success">Active</span>'}
          </div>
          <div class="table-cell">
            ${renderTierBadge(tier)}
          </div>
          <div class="table-cell">
            <span class="muted">${escapeHtml(updatedAt)}</span>
          </div>
          <div class="table-cell">
            <span class="badge ${geminiColorClass}">${stats.geminiAvg}%</span>
          </div>
          <div class="table-cell">
            <span class="badge ${claudeColorClass}">${stats.claudeAvg}%</span>
          </div>
          <div class="table-cell table-actions">
            <button class="secondary small" data-action="set-current" data-id="${escapeHtml(account.id)}">Set</button>
            <button class="ghost small" data-action="refresh-quota" data-id="${escapeHtml(account.id)}">Refresh</button>
            <button class="danger small" data-action="delete" data-id="${escapeHtml(account.id)}">Del</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function normalizeMappings(payload) {
  const anthropic = Object.assign({}, defaultMappings.anthropic, payload.anthropic_mapping || {});
  const openai = Object.assign({}, defaultMappings.openai, payload.openai_mapping || {});
  const custom = Object.assign({}, payload.custom_mapping || {});
  return { anthropic, openai, custom };
}

function renderMappingOptions() {
  const options = buildModelOptions(state.models);
  const selects = document.querySelectorAll(".router-select");
  selects.forEach((select) => {
    const scope = select.dataset.mappingScope;
    const key = select.dataset.mappingKey;
    if (!scope || !key) return;
    select.innerHTML = options;
    const value = state.mappings[scope][key] || "";
    if (value) {
      select.value = value;
    }
  });

  if (elements.customMappingTarget) {
    elements.customMappingTarget.innerHTML = options;
  }
}

function renderCustomMappingList() {
  if (!elements.customMappingList) return;
  const entries = Object.entries(state.mappings.custom || {});
  if (!entries.length) {
    elements.customMappingList.innerHTML = '<div class="empty">No custom mappings yet.</div>';
    return;
  }
  elements.customMappingList.innerHTML = entries
    .map(
      ([source, target]) => `
      <div class="mapping-row">
        <code>${escapeHtml(source)}</code>
        <code>${escapeHtml(target)}</code>
        <button class="ghost small" data-remove-mapping="${escapeHtml(source)}" type="button">Remove</button>
      </div>
    `
    )
    .join("");
}

function renderProtocolCards() {
  if (!elements.protocolGrid) return;
  elements.protocolGrid.querySelectorAll(".protocol-card").forEach((card) => {
    const protocol = card.dataset.protocol;
    card.classList.toggle("active", protocol === state.selectedProtocol);
  });
  if (elements.protocolBadge) {
    elements.protocolBadge.textContent = protocolBadges[state.selectedProtocol] || "SDK";
  }
}

function renderModelList() {
  if (!elements.modelList) return;
  if (!state.models.length) {
    elements.modelList.innerHTML = '<div class="empty">No models loaded yet.</div>';
    return;
  }

  if (!state.selectedModelId) {
    state.selectedModelId = state.models[0];
  }

  elements.modelList.innerHTML = state.models
    .map((model) => {
      const isActive = model === state.selectedModelId;
      return `
        <div class="model-row ${isActive ? "active" : ""}" data-model-id="${escapeHtml(model)}">
          <code>${escapeHtml(model)}</code>
          <button class="ghost small" data-copy-model="${escapeHtml(model)}" type="button">Copy</button>
        </div>
      `;
    })
    .join("");
}

function getExampleCode(modelId) {
  const apiKey = state.apiKey || "YOUR_API_KEY";
  const baseUrl = getBaseUrl();
  const openaiBase = getOpenAiBaseUrl();

  if (state.selectedProtocol === "anthropic") {
    return `from anthropic import Anthropic

client = Anthropic(
    base_url="${baseUrl}",
    api_key="${apiKey}"
)

response = client.messages.create(
    model="${modelId}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}]
)

print(response.content[0].text)`;
  }

  if (state.selectedProtocol === "gemini") {
    return `# pip install google-generativeai
import google.generativeai as genai

genai.configure(
    api_key="${apiKey}",
    transport="rest",
    client_options={"api_endpoint": "${baseUrl}"}
)

model = genai.GenerativeModel("${modelId}")
response = model.generate_content("Hello")
print(response.text)`;
  }

  if (modelId && modelId.startsWith("gemini-3-pro-image")) {
    return `from openai import OpenAI

client = OpenAI(
    base_url="${openaiBase}",
    api_key="${apiKey}"
)

response = client.images.generate(
    model="${modelId}",
    prompt="Draw a futuristic city",
    size="1024x1024"
)

print(response.data[0].b64_json)`;
  }

  return `from openai import OpenAI

client = OpenAI(
    base_url="${openaiBase}",
    api_key="${apiKey}"
)

response = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Hello"}]
)

print(response.choices[0].message.content)`;
}

function renderExampleCode() {
  if (!elements.codeSample) return;
  const modelId = state.selectedModelId || "gemini-3-pro-high";
  elements.codeSample.textContent = getExampleCode(modelId);
}

function setActiveTab(tabId) {
  const requested = tabId || "overview";
  const targetTab = document.getElementById(requested) ? requested : "overview";
  document.querySelectorAll(".tab-page").forEach((page) => {
    page.classList.toggle("active", page.id === targetTab);
  });
  document.querySelectorAll(".nav-link[data-tab]").forEach((link) => {
    link.classList.toggle("active", link.dataset.tab === targetTab);
  });
  const nextHash = `#${targetTab}`;
  if (window.location.hash !== nextHash) {
    history.replaceState(null, "", nextHash);
  }
}

function initTabs() {
  const hash = window.location.hash.replace("#", "");
  setActiveTab(hash || "overview");
}

async function loadAccounts() {
  try {
    const data = await apiFetch("/api/accounts");
    state.accounts = data.accounts || [];
    state.currentAccountId = data.current_account_id || null;
    renderSummary();
    renderCurrentAccount();
    renderAccounts();
  } catch (err) {
    showToast(`Load failed: ${err.message}`);
  }
}

async function loadMappings() {
  try {
    const data = await apiFetch("/api/proxy/mappings");
    state.mappings = normalizeMappings(data || {});
    renderMappingOptions();
    renderCustomMappingList();
  } catch (err) {
    state.mappings = {
      anthropic: Object.assign({}, defaultMappings.anthropic),
      openai: Object.assign({}, defaultMappings.openai),
      custom: {},
    };
    renderMappingOptions();
    renderCustomMappingList();
    showToast(`Mapping load failed: ${err.message}`);
  }
}

// Internal save function (direct API call)
async function _saveMappingsImpl() {
  await apiFetch("/api/proxy/mappings", {
    method: "PUT",
    body: JSON.stringify({
      anthropic_mapping: state.mappings.anthropic,
      openai_mapping: state.mappings.openai,
      custom_mapping: state.mappings.custom,
    }),
  });
}

// State tracking for saving mappings
let _saveMappingsTimer = null;
let _saveMappingsResolvers = [];

/**
 * Debounced version of saveMappings
 * Multiple calls within 300ms will be combined into one, reducing API requests
 * @returns {Promise} - Promise that resolves when save completes
 */
function saveMappings() {
  return new Promise((resolve, reject) => {
    // Save current call's resolver
    _saveMappingsResolvers.push({ resolve, reject });

    // Clear previous timer (reset debounce)
    if (_saveMappingsTimer) {
      clearTimeout(_saveMappingsTimer);
    }

    // Set new timer
    _saveMappingsTimer = setTimeout(async () => {
      const resolvers = _saveMappingsResolvers;
      _saveMappingsResolvers = [];
      _saveMappingsTimer = null;

      try {
        await _saveMappingsImpl();
        // All waiting calls succeed
        resolvers.forEach(({ resolve }) => resolve());
      } catch (err) {
        // All waiting calls fail
        resolvers.forEach(({ reject }) => reject(err));
      }
    }, 300); // 300ms debounce delay
  });
}

async function handleResetMappings() {
  state.mappings = {
    anthropic: Object.assign({}, defaultMappings.anthropic),
    openai: Object.assign({}, defaultMappings.openai),
    custom: {},
  };
  renderMappingOptions();
  renderCustomMappingList();
  try {
    await saveMappings();
    showToast("Mappings reset");
  } catch (err) {
    showToast(`Reset failed: ${err.message}`);
  }
}

async function loadModels() {
  try {
    const data = await apiFetch("/v1/models");
    const models = (data && data.data ? data.data.map((item) => item.id) : []).filter(Boolean);
    models.sort();
    state.models = models;
    renderMappingOptions();
    renderModelList();
    renderExampleCode();
  } catch (err) {
    showToast(`Models load failed: ${err.message}`);
  }
}

async function updateGroupMapping(scope, key, value) {
  if (!scope || !key || !value) return;
  state.mappings[scope][key] = value;
  try {
    await saveMappings();
    showToast("Mapping updated");
  } catch (err) {
    showToast(`Update failed: ${err.message}`);
  }
}

async function addCustomMapping() {
  const source = elements.customMappingSource.value.trim();
  const target = elements.customMappingTarget.value;
  if (!source) {
    showToast("Original model id is required");
    return;
  }
  if (!target) {
    showToast("Select a target model");
    return;
  }
  state.mappings.custom[source] = target;
  renderCustomMappingList();
  try {
    await saveMappings();
    elements.customMappingSource.value = "";
    showToast("Custom mapping added");
  } catch (err) {
    showToast(`Save failed: ${err.message}`);
  }
}

async function removeCustomMapping(key) {
  if (!key || !state.mappings.custom[key]) return;
  delete state.mappings.custom[key];
  renderCustomMappingList();
  try {
    await saveMappings();
    showToast("Custom mapping removed");
  } catch (err) {
    showToast(`Remove failed: ${err.message}`);
  }
}

function refreshProtocolCopyTargets() {
  const baseUrl = getBaseUrl();
  const openaiBase = getOpenAiBaseUrl();

  const copyMap = {
    "openai-base": openaiBase,
    "anthropic-base": `${baseUrl}/v1/messages`,
    "gemini-base": `${baseUrl}/v1beta/models`,
  };

  Object.entries(copyMap).forEach(([key, value]) => {
    const button = elements.protocolGrid && elements.protocolGrid.querySelector(`[data-copy="${key}"]`);
    if (button) {
      button.dataset.copyValue = value;
    }
  });
}

async function handleAddAccount() {
  const token = elements.refreshTokenInput.value.trim();
  if (!token) {
    showToast("Refresh token is required");
    return;
  }
  elements.addAccountBtn.disabled = true;
  try {
    await apiFetch("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ refresh_token: token }),
    });
    elements.refreshTokenInput.value = "";
    showToast("Account added");
    await loadAccounts();
  } catch (err) {
    showToast(`Add failed: ${err.message}`);
  } finally {
    elements.addAccountBtn.disabled = false;
  }
}

async function handleSetCurrent(accountId) {
  try {
    await apiFetch("/api/accounts/current", {
      method: "PUT",
      body: JSON.stringify({ account_id: accountId }),
    });
    showToast("Current account updated");
    await loadAccounts();
  } catch (err) {
    showToast(`Update failed: ${err.message}`);
  }
}

async function handleDelete(accountId) {
  if (!window.confirm("Delete this account?")) {
    return;
  }
  try {
    await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
    showToast("Account deleted");
    await loadAccounts();
  } catch (err) {
    showToast(`Delete failed: ${err.message}`);
  }
}

async function handleRefreshQuota(accountId) {
  try {
    await apiFetch(`/api/accounts/${accountId}/refresh_quota`, { method: "POST" });
    showToast("Quota refreshed");
    await loadAccounts();
  } catch (err) {
    showToast(`Refresh failed: ${err.message}`);
  }
}

async function handleRefreshAll() {
  // Disable both refresh buttons during the operation
  if (elements.refreshAllBtn) elements.refreshAllBtn.disabled = true;
  if (elements.refreshAllAccountsBtn) elements.refreshAllAccountsBtn.disabled = true;
  try {
    await apiFetch("/api/accounts/refresh_quotas", { method: "POST" });
    showToast("All quotas refreshed");
    await loadAccounts();
  } catch (err) {
    showToast(`Refresh failed: ${err.message}`);
  } finally {
    if (elements.refreshAllBtn) elements.refreshAllBtn.disabled = false;
    if (elements.refreshAllAccountsBtn) elements.refreshAllAccountsBtn.disabled = false;
  }
}

// ========== API Keys Management ==========

async function loadApiKeys() {
  try {
    const [keys, usage] = await Promise.all([
      apiFetch("/api/keys"),
      apiFetch("/api/keys/usage"),
    ]);
    state.apiKeys = keys || [];
    state.apiKeysTotalUsage = usage || null;
    renderApiKeysList();
    renderApiKeysUsageSummary();
  } catch (err) {
    console.error("Failed to load API keys:", err);
  }
}

async function handleRefreshApiKeys() {
  if (elements.refreshApiKeysBtn) {
    elements.refreshApiKeysBtn.disabled = true;
    elements.refreshApiKeysBtn.textContent = "Refreshing...";
  }
  try {
    await loadApiKeys();
    showToast("API keys refreshed");
  } catch (err) {
    showToast(`Refresh failed: ${err.message}`);
  } finally {
    if (elements.refreshApiKeysBtn) {
      elements.refreshApiKeysBtn.disabled = false;
      elements.refreshApiKeysBtn.textContent = "Refresh";
    }
  }
}

function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
}

function formatTimestamp(ts) {
  if (!ts) return "Never";
  const date = new Date(ts * 1000);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function renderApiKeysUsageSummary() {
  if (!elements.apiKeysUsageSummary) return;
  const usage = state.apiKeysTotalUsage;
  if (!usage) {
    elements.apiKeysUsageSummary.innerHTML = '<div class="empty">No usage data</div>';
    return;
  }

  const successRate = usage.total_requests > 0
    ? ((usage.success_count / usage.total_requests) * 100).toFixed(1)
    : 0;

  elements.apiKeysUsageSummary.innerHTML = `
    <div class="summary-card">
      <div class="summary-label">Total Requests</div>
      <div class="summary-value">${formatNumber(usage.total_requests)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Success Rate</div>
      <div class="summary-value">${successRate}%</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Input Tokens</div>
      <div class="summary-value">${formatNumber(usage.total_input_tokens)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Output Tokens</div>
      <div class="summary-value">${formatNumber(usage.total_output_tokens)}</div>
    </div>
  `;
}

function renderApiKeysList() {
  if (!elements.apiKeysList) return;

  if (state.apiKeys.length === 0) {
    elements.apiKeysList.innerHTML = `
      <div class="empty" style="padding: 40px; text-align: center;">
        <p>No API keys yet. Create one to get started.</p>
      </div>
    `;
    return;
  }

  elements.apiKeysList.innerHTML = state.apiKeys.map(key => `
    <div class="apikey-row" data-key-id="${escapeHtml(key.id)}">
      <div class="apikey-name">${escapeHtml(key.name)}</div>
      <div class="apikey-key">
        <code>${escapeHtml(key.key_preview)}</code>
        <button class="ghost copy-btn" data-copy-key="${escapeHtml(key.id)}" type="button">Copy</button>
      </div>
      <div class="apikey-status">
        <span class="status-dot ${key.enabled ? '' : 'disabled'}"></span>
        <span>${key.enabled ? 'Active' : 'Disabled'}</span>
      </div>
      <div class="apikey-requests">
        <strong>${formatNumber(key.usage.total_requests)}</strong>
        <span style="font-size: 10px; color: var(--text-muted);">
          (${formatNumber(key.usage.success_count)} ok)
        </span>
      </div>
      <div class="apikey-tokens">
        <strong>${formatNumber(key.usage.total_input_tokens + key.usage.total_output_tokens)}</strong>
      </div>
      <div class="apikey-lastused">${formatTimestamp(key.last_used_at)}</div>
      <div class="apikey-actions">
        <button class="ghost" data-apikey-action="toggle" data-key-id="${escapeHtml(key.id)}" type="button">
          ${key.enabled ? 'Disable' : 'Enable'}
        </button>
        <button class="ghost" data-apikey-action="regenerate" data-key-id="${escapeHtml(key.id)}" type="button">
          Regen
        </button>
        <button class="ghost danger" data-apikey-action="delete" data-key-id="${escapeHtml(key.id)}" type="button">
          Delete
        </button>
      </div>
    </div>
  `).join('');
}

function showCreateApiKeyModal() {
  // Remove existing modal if any
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Create New API Key</h3>
        <button class="modal-close" type="button">&times;</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label for="newKeyName">Key Name</label>
          <input type="text" id="newKeyName" placeholder="e.g., Production, Development, CI/CD" autofocus />
        </div>
        <div id="createdKeyContainer"></div>
      </div>
      <div class="modal-footer">
        <button class="ghost" id="modalCancelBtn" type="button">Cancel</button>
        <button class="primary" id="modalCreateBtn" type="button">Create Key</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Show modal with animation
  requestAnimationFrame(() => modal.classList.add('show'));

  const closeModal = () => {
    modal.classList.remove('show');
    setTimeout(() => modal.remove(), 200);
  };

  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#modalCancelBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  const nameInput = modal.querySelector('#newKeyName');
  const createBtn = modal.querySelector('#modalCreateBtn');
  const createdContainer = modal.querySelector('#createdKeyContainer');

  // Track whether key has been created to prevent duplicate creation
  let keyCreated = false;
  let createdKey = null;

  createBtn.addEventListener('click', async () => {
    // If key was already created, just copy and close
    if (keyCreated && createdKey) {
      copyText(createdKey, "API key copied!");
      closeModal();
      loadApiKeys();
      return;
    }

    const name = nameInput.value.trim();
    if (!name) {
      showToast("Please enter a key name");
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = "Creating...";

    try {
      const result = await apiFetch("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      });

      // Mark as created and store the key
      keyCreated = true;
      createdKey = result.key;

      // Show the created key
      createdContainer.innerHTML = `
        <div class="created-key-display">
          <div class="label">Your New API Key</div>
          <code>${escapeHtml(result.key)}</code>
          <div class="warning">
            Make sure to copy this key now. You won't be able to see it again!
          </div>
        </div>
      `;

      // Change button to copy & close
      createBtn.textContent = "Copy & Close";
      createBtn.disabled = false;
      nameInput.disabled = true;

    } catch (err) {
      showToast(`Failed to create key: ${err.message}`);
      createBtn.disabled = false;
      createBtn.textContent = "Create Key";
    }
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createBtn.click();
    }
  });
}

async function handleApiKeyAction(action, keyId) {
  const key = state.apiKeys.find(k => k.id === keyId);
  if (!key) return;

  switch (action) {
    case 'toggle':
      try {
        await apiFetch(`/api/keys/${keyId}`, {
          method: "PUT",
          body: JSON.stringify({ enabled: !key.enabled }),
        });
        showToast(key.enabled ? "API key disabled" : "API key enabled");
        await loadApiKeys();
      } catch (err) {
        showToast(`Failed: ${err.message}`);
      }
      break;

    case 'regenerate':
      if (!window.confirm("Regenerate this API key? The old key will stop working immediately.")) {
        return;
      }
      try {
        const result = await apiFetch(`/api/keys/${keyId}/regenerate`, { method: "POST" });
        // Show the new key in a modal
        showRegeneratedKeyModal(result.key);
        await loadApiKeys();
      } catch (err) {
        showToast(`Failed: ${err.message}`);
      }
      break;

    case 'delete':
      if (!window.confirm(`Delete API key "${key.name}"? This cannot be undone.`)) {
        return;
      }
      try {
        await apiFetch(`/api/keys/${keyId}`, { method: "DELETE" });
        showToast("API key deleted");
        await loadApiKeys();
      } catch (err) {
        showToast(`Failed: ${err.message}`);
      }
      break;
  }
}

async function handleCopyApiKey(keyId) {
  try {
    const result = await apiFetch(`/api/keys/${keyId}/reveal`, { method: "POST" });
    if (result && result.key) {
      copyText(result.key, "API key copied!");
    } else {
      showToast("Failed to get API key");
    }
  } catch (err) {
    // If reveal endpoint doesn't exist, show a message
    showToast("Full key not available. Keys can only be viewed when created.");
  }
}

function showRegeneratedKeyModal(newKey) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Key Regenerated</h3>
        <button class="modal-close" type="button">&times;</button>
      </div>
      <div class="modal-body">
        <div class="created-key-display">
          <div class="label">Your New API Key</div>
          <code>${escapeHtml(newKey)}</code>
          <div class="warning">
            Make sure to copy this key now. You won't be able to see it again!
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="primary" id="copyAndCloseBtn" type="button">Copy & Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => {
    modal.classList.remove('show');
    setTimeout(() => modal.remove(), 200);
  };

  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#copyAndCloseBtn').addEventListener('click', () => {
    copyText(newKey, "API key copied!");
    closeModal();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

// ========== Settings ==========

function showConfirmModal(title, message, confirmText, onConfirm, isDanger = false) {
  // Remove existing modal if any
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal ${isDanger ? 'modal-danger' : ''}">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close" type="button">&times;</button>
      </div>
      <div class="modal-body">
        <p class="confirm-message">${escapeHtml(message)}</p>
      </div>
      <div class="modal-footer">
        <button class="ghost" id="modalCancelBtn" type="button">Cancel</button>
        <button class="${isDanger ? 'danger' : 'primary'}" id="modalConfirmBtn" type="button">${escapeHtml(confirmText)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Show modal with animation
  requestAnimationFrame(() => modal.classList.add('show'));

  const closeModal = () => {
    modal.classList.remove('show');
    setTimeout(() => modal.remove(), 200);
  };

  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#modalCancelBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  modal.querySelector('#modalConfirmBtn').addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
}

async function handleResetAuth() {
  showConfirmModal(
    "Reset Authentication",
    "Are you sure you want to reset authentication?\n\nThis will remove ALL passkeys and passwords. You will need to set up authentication again.",
    "Yes, Reset",
    () => {
      // Second confirmation
      showConfirmModal(
        "Final Confirmation",
        "This action is IRREVERSIBLE!\n\nAll authentication credentials will be permanently deleted.",
        "I Understand, Reset Now",
        async () => {
          try {
            await apiFetch("/api/auth/reset", { method: "POST" });
            showToast("Authentication reset successfully");
            // Redirect to login page after reset
            setTimeout(() => {
              window.location.href = "/login.html";
            }, 1000);
          } catch (err) {
            showToast(`Reset failed: ${err.message}`);
          }
        },
        true
      );
    },
    true
  );
}

function bindEvents() {
  elements.refreshAllBtn.addEventListener("click", handleRefreshAll);
  if (elements.refreshAllAccountsBtn) {
    elements.refreshAllAccountsBtn.addEventListener("click", handleRefreshAll);
  }
  elements.addAccountBtn.addEventListener("click", handleAddAccount);
  if (elements.oauthStartBtn) {
    elements.oauthStartBtn.addEventListener("click", startOAuthLogin);
  }
  if (elements.oauthOpenBtn) {
    elements.oauthOpenBtn.addEventListener("click", openOAuthLink);
  }
  if (elements.oauthCopyBtn) {
    elements.oauthCopyBtn.addEventListener("click", () => {
      copyText(state.oauth.authUrl, "OAuth link copied");
    });
  }
  if (elements.oauthCallbackSubmit) {
    elements.oauthCallbackSubmit.addEventListener("click", submitOAuthCallback);
  }
  if (elements.oauthCallbackInput) {
    elements.oauthCallbackInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitOAuthCallback();
      }
    });
  }
  if (elements.resetMappingBtn) {
    elements.resetMappingBtn.addEventListener("click", handleResetMappings);
  }
  if (elements.addCustomMappingBtn) {
    elements.addCustomMappingBtn.addEventListener("click", addCustomMapping);
  }
  if (elements.copyExampleBtn) {
    elements.copyExampleBtn.addEventListener("click", () => {
      copyText(elements.codeSample.textContent || "", "Example copied");
    });
  }

  // API Keys event listeners
  if (elements.createApiKeyBtn) {
    elements.createApiKeyBtn.addEventListener("click", showCreateApiKeyModal);
  }
  if (elements.refreshApiKeysBtn) {
    elements.refreshApiKeysBtn.addEventListener("click", handleRefreshApiKeys);
  }

  // Settings event listeners
  if (elements.resetAuthBtn) {
    elements.resetAuthBtn.addEventListener("click", handleResetAuth);
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const accountId = target.dataset.id;
    if (!accountId) return;

    if (action === "set-current") {
      handleSetCurrent(accountId);
    } else if (action === "refresh-quota") {
      handleRefreshQuota(accountId);
    } else if (action === "delete") {
      handleDelete(accountId);
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (!target.classList.contains("router-select")) return;
    updateGroupMapping(target.dataset.mappingScope, target.dataset.mappingKey, target.value);
  });

  document.addEventListener("click", (event) => {
    const navButton = event.target.closest(".nav-link[data-tab]");
    if (navButton) {
      setActiveTab(navButton.dataset.tab);
      return;
    }

    const removeBtn = event.target.closest("button[data-remove-mapping]");
    if (removeBtn) {
      removeCustomMapping(removeBtn.dataset.removeMapping);
      return;
    }

    const copyButton = event.target.closest("button[data-copy]");
    if (copyButton) {
      const value = copyButton.dataset.copyValue;
      copyText(value, "Copied");
      return;
    }

    const copyModel = event.target.closest("button[data-copy-model]");
    if (copyModel) {
      const model = copyModel.dataset.copyModel;
      copyText(model, "Model copied");
      return;
    }

    // API Key copy button
    const copyKeyBtn = event.target.closest("button[data-copy-key]");
    if (copyKeyBtn) {
      const keyId = copyKeyBtn.dataset.copyKey;
      handleCopyApiKey(keyId);
      return;
    }

    const endpoint = event.target.closest("code[data-endpoint]");
    if (endpoint) {
      const path = endpoint.textContent.trim();
      const url = path.startsWith("/") ? `${getBaseUrl()}${path}` : `${getBaseUrl()}/${path}`;
      copyText(url, "Endpoint copied");
      return;
    }

    const protocolCard = event.target.closest(".protocol-card");
    if (protocolCard && protocolCard.dataset.protocol) {
      state.selectedProtocol = protocolCard.dataset.protocol;
      renderProtocolCards();
      renderExampleCode();
      return;
    }

    const modelRow = event.target.closest(".model-row");
    if (modelRow && modelRow.dataset.modelId) {
      state.selectedModelId = modelRow.dataset.modelId;
      renderModelList();
      renderExampleCode();
      return;
    }

    // API Keys actions
    const apikeyActionBtn = event.target.closest("button[data-apikey-action]");
    if (apikeyActionBtn) {
      const action = apikeyActionBtn.dataset.apikeyAction;
      const keyId = apikeyActionBtn.dataset.keyId;
      handleApiKeyAction(action, keyId);
      return;
    }

    // Theme switcher
    const themeOption = event.target.closest(".theme-option[data-theme-value]");
    if (themeOption) {
      const themeValue = themeOption.dataset.themeValue;
      setTheme(themeValue);
      showToast(`Theme set to ${themeValue}`);
      return;
    }
  });
}

// Check authentication status on page load
async function checkAuthStatus() {
  try {
    const response = await fetch("/api/auth/status");
    if (!response.ok) {
      window.location.href = "/login.html";
      return false;
    }
    const data = await response.json();
    if (!data.authenticated) {
      window.location.href = "/login.html";
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to check auth status:", err);
    window.location.href = "/login.html";
    return false;
  }
}

// Initialize app after auth check
// Initialize theme immediately (before auth check to prevent flash)
initTheme();

(async function init() {
  const isAuthenticated = await checkAuthStatus();
  if (!isAuthenticated) return;

  bindEvents();
  initTabs();
  refreshProtocolCopyTargets();
  renderProtocolCards();
  renderExampleCode();
  renderThemeSwitcher();
  loadAccounts();
  loadMappings();
  loadModels();
  loadApiKeys();
  fetchOAuthStatus();
})();
