/**
 * VPS SFTP File Management Web Application - Full SPA Core Logic
 */

const AppState = {
  token: localStorage.getItem('vps_token') || null,
  user: JSON.parse(localStorage.getItem('vps_user') || 'null'),
  currentPath: '/',
  files: [],
  selectedPaths: [],
  viewMode: localStorage.getItem('vps_view_mode') || 'grid',
  sortBy: localStorage.getItem('vps_sort_by') || 'name-asc',
  currentTab: 'dashboard',
  isSidebarCollapsed: localStorage.getItem('zen_sidebar_collapsed') === 'true',
  isMobileSidebarOpen: false,
  otpSessionData: null,
  searchQuery: '',
  adminUserSearch: '',
  pendingScrollTarget: null,
  theme: localStorage.getItem('vps_theme') || 'dark',
  isDarkMode: (localStorage.getItem('vps_theme') || 'dark') === 'dark',
  adminTab: 'overview',
  adminUsers: [],
  adminStats: null,
  activeShareLinks: [],
  publicShareData: null,
  fileRefreshLockedUntil: 0,
  fileRefreshCountdownTimer: null,
  downloadJobsTimer: null,
  previewObjectUrl: null,
  quotaRequestId: 0,
  displayedQuotaPercent: 0,
  targetUserId: null,
  targetUser: null,
  directoryUserList: [],
  consoleMode: 'auto'
};

// Sync HTML theme immediately
document.documentElement.classList.toggle('dark', AppState.isDarkMode);
document.documentElement.classList.toggle('light', !AppState.isDarkMode);

// Global Toast Notification Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  const bgClass = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-emerald-600' : 'bg-neutral-900 border border-white/20';
  
  toast.className = `${bgClass} text-white px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0 z-50`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function createToastContainer() {
  const c = document.createElement('div');
  c.id = 'toast-container';
  c.className = 'fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full';
  document.body.appendChild(c);
  return c;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsArg(str) {
  return encodeURIComponent(String(str || ''));
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Global Loading Indicator Handler
function setLoading(message = '', show = true) {
  const globalLoader = document.getElementById('global-loading-indicator');
  if (globalLoader) {
    globalLoader.classList.toggle('hidden', !show);
    const textEl = globalLoader.querySelector('[data-loading-text]');
    if (textEl && message) textEl.textContent = message;
  }
}
window.setLoading = setLoading;

// Public application branding (title + favicon)
async function loadPublicBranding() {
  try {
    const res = await fetch('/api/public/settings', { cache: 'no-store' });
    const settings = await res.json();
    if (!res.ok) throw new Error(settings.error || 'Failed to load app settings');

    const title = settings.websiteTitle || settings.appName || 'ZenStorage';
    document.title = title;

    if (settings.websiteIconUrl) {
      let link = document.querySelector('link[data-site-favicon]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        link.dataset.siteFavicon = 'true';
        document.head.appendChild(link);
      }
      link.href = `${settings.websiteIconUrl}?v=${Date.now()}`;
    }
  } catch (_) {
    // Keep static defaults if public settings are unavailable.
  }
}

// API Fetch Helper
async function apiRequest(endpoint, options = {}) {
  const headers = options.headers || {};
  if (AppState.token) {
    headers['Authorization'] = `Bearer ${AppState.token}`;
  }
  // If logged in as admin and inspecting a target user directory, pass target user header for file API requests
  if (AppState.user && AppState.user.role === 'admin' && AppState.targetUserId && endpoint.startsWith('/files')) {
    headers['x-target-user-id'] = String(AppState.targetUserId);
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  options.headers = headers;

  try {
    const res = await fetch(`/api${endpoint}`, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.requiresOtpVerification) {
        AppState.otpSessionData = data;
        window.location.hash = '#otp-verification';
        renderApp();
      }
      if (res.status === 401 && AppState.token) {
        logoutUser();
        showToast('Session expired. Please log in again.', 'error');
      }
      const err = new Error(data.error || 'API Request failed');
      if (data.requiresOtpVerification) err.requiresOtpVerification = true;
      throw err;
    }
    return data;
  } catch (err) {
    throw err;
  }
}

function getEffectiveDownloadUrl(filePath) {
  let url = `/api/files/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(AppState.token || '')}`;
  if (AppState.user && AppState.user.role === 'admin' && AppState.targetUserId) {
    url += `&targetUserId=${encodeURIComponent(AppState.targetUserId)}`;
  }
  return url;
}

function getEffectivePreviewUrl(filePath, extra = '') {
  let url = `/api/files/preview?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(AppState.token || '')}`;
  if (AppState.user && AppState.user.role === 'admin' && AppState.targetUserId) {
    url += `&targetUserId=${encodeURIComponent(AppState.targetUserId)}`;
  }
  if (extra) url += extra;
  return url;
}

function getEffectiveTranscodedUrl(filePath, safe = false) {
  let url = `/api/files/preview-transcoded?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(AppState.token || '')}`;
  if (AppState.user && AppState.user.role === 'admin' && AppState.targetUserId) {
    url += `&targetUserId=${encodeURIComponent(AppState.targetUserId)}`;
  }
  if (safe) url += '&safe=1';
  return url;
}

async function inspectUserDirectory(userId, username) {
  AppState.targetUserId = Number(userId);
  AppState.targetUser = (AppState.adminUsers || []).find(u => Number(u.id) === Number(userId)) || { id: userId, username };
  AppState.currentPath = '/';
  AppState.selectedPaths = [];
  showToast(`Switching to directory for ${username}...`, 'info');
  navigateTab('files');
}

function resetAdminUserDirectory() {
  AppState.targetUserId = null;
  AppState.targetUser = null;
  AppState.currentPath = '/';
  AppState.selectedPaths = [];
  showToast('Returned to your personal storage directory.', 'info');
  navigateTab('files');
}

async function handleAdminUserDirectoryChange(targetVal) {
  if (!targetVal) {
    resetAdminUserDirectory();
  } else {
    const userId = Number(targetVal);
    const users = AppState.directoryUserList || AppState.adminUsers || [];
    const targetUser = users.find(u => Number(u.id) === userId) || { id: userId, username: `User #${userId}` };
    inspectUserDirectory(userId, targetUser.username || targetUser.name);
  }
}

async function loadAdminUserDirectoryDropdown() {
  const select = document.getElementById('admin-user-directory-select');
  if (!select) return;
  try {
    const users = await apiRequest('/files/admin/user-directories');
    AppState.directoryUserList = users;
    let html = `<option value="">📁 My Storage (Self - ${escapeHtml(AppState.user?.username || 'admin')})</option>`;
    users.forEach(u => {
      const isCurrentAdmin = Number(u.id) === Number(AppState.user?.id);
      if (isCurrentAdmin) return;
      const isSelected = AppState.targetUserId && Number(AppState.targetUserId) === Number(u.id);
      const displayName = u.name && u.name !== u.username ? `${escapeHtml(u.username)} (${escapeHtml(u.name)})` : escapeHtml(u.username);
      html += `<option value="${u.id}" ${isSelected ? 'selected' : ''}>👤 ${displayName} · ${formatBytes(u.used_storage_bytes || 0)}</option>`;
    });
    select.innerHTML = html;
  } catch (e) {
    console.error('Failed to load user directories dropdown:', e);
  }
}

function logoutUser() {
  AppState.token = null;
  AppState.user = null;
  localStorage.removeItem('vps_token');
  localStorage.removeItem('vps_user');
  renderApp();
}

// Router & App Render Engine
function renderApp() {
  const root = document.getElementById('app');
  if (!root) return;

  // Check Hash for Public Share or Password Reset links
  const hash = window.location.hash || '';
  if (hash.startsWith('#public-share')) {
    renderPublicShareView(root);
    return;
  }
  if (hash.startsWith('#reset-password')) {
    renderResetPasswordView(root);
    return;
  }
  if (hash.startsWith('#verify-email?')) {
    renderVerifyEmailView(root);
    return;
  }
  if (hash.startsWith('#verify-email-change')) {
    renderVerifyEmailChangeView(root);
    return;
  }

  // OTP Verification view should ONLY be rendered if there is an active OTP pending for the user:
  const userNeedsOtp = (AppState.user && Number(AppState.user.requires_otp_verification) === 1) ||
                       (AppState.otpSessionData && (AppState.otpSessionData.requiresOtp || AppState.otpSessionData.tempToken));

  if (userNeedsOtp) {
    renderOtpVerificationView(root);
    return;
  } else if (hash.startsWith('#otp-verification')) {
    // If URL has #otp-verification but user is already verified / does not need OTP, clear the stale hash
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } else {
      window.location.hash = '';
    }
  }

  if (!AppState.token || !AppState.user) {
    renderAuthView(root);
  } else {
    renderDashboardLayout(root);
  }

  if (window.lucide) {
    lucide.createIcons();
  }
}

// ==========================================
// 1a. BEAUTIFUL ANIMATED 4-DIGIT OTP SECURITY VERIFICATION VIEW
// ==========================================
async function renderOtpVerificationView(root) {
  const otpData = AppState.otpSessionData || {};
  const emailDisplay = otpData.email || AppState.user?.email || 'your registered email';
  const reasonDisplay = otpData.reason || (AppState.user && AppState.user.otp_reason) || 'Account Security Review';

  root.innerHTML = `
    <div class="h-full min-h-full overflow-y-auto grid grid-cols-1 lg:grid-cols-2 theme-main-bg transition-colors duration-200 custom-scrollbar select-none">
      <!-- Left Obsidian Security Panel -->
      <div class="hidden lg:flex flex-col justify-between p-12 bg-[#09090b] text-white border-r border-white/10 enterprise-grid-bg relative overflow-hidden">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <i data-lucide="cloud-lightning" class="w-5 h-5"></i>
          </div>
          <span class="text-lg font-bold tracking-tight text-white whitespace-nowrap">ZenStorage</span>
        </div>

        <div class="max-w-md space-y-6">
          <div class="text-xs font-medium text-blue-400 tracking-wide">Account Security Verification</div>
          <h2 class="text-3xl font-bold tracking-tight text-white leading-tight" style="text-wrap: balance;">
            Multi-factor protection for your storage cluster.
          </h2>
          <p class="text-sm text-zinc-400 leading-relaxed">
            Your session requires a 4-digit security verification code before accessing workspace files, S3 endpoints, or administrative controls.
          </p>
          <div class="pt-4 border-t border-white/10 space-y-3 text-xs text-zinc-300">
            <div class="flex items-center gap-2.5">
              <i data-lucide="shield-check" class="w-4 h-4 text-blue-400 shrink-0"></i>
              <span>Hardware-isolated workspace encryption</span>
            </div>
            <div class="flex items-center gap-2.5">
              <i data-lucide="clock" class="w-4 h-4 text-blue-400 shrink-0"></i>
              <span>One-time verification code expires automatically</span>
            </div>
          </div>
        </div>

        <div class="text-xs text-zinc-500">ZenStorage Enterprise Cloud Infrastructure</div>
      </div>

      <!-- Right Verification Form Panel -->
      <div class="flex flex-col justify-between p-6 sm:p-10 theme-main-bg overflow-y-auto">
        <div class="flex items-center justify-between">
          <div class="flex lg:hidden items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg zencloud-logo-badge"><i data-lucide="cloud-lightning" class="w-4 h-4"></i></div>
            <span class="text-base font-bold text-slate-900 dark:text-white">ZenStorage</span>
          </div>
          <div class="ml-auto">
            <button onclick="toggleDarkMode()" title="Toggle Light / Dark Theme" class="px-3 py-1.5 flex items-center gap-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-300 hover:border-blue-500/50 transition-colors">
              <i data-lucide="${AppState.isDarkMode ? 'sun' : 'moon'}" class="w-3.5 h-3.5 text-amber-500 dark:text-blue-400"></i>
              <span>${AppState.isDarkMode ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>

        <div class="w-full max-w-md mx-auto my-auto py-8">
          <div class="glass-card p-8 rounded-2xl text-center relative overflow-hidden">
            <div class="inline-flex p-3 rounded-xl zencloud-logo-badge mb-4">
              <i data-lucide="shield-check" class="w-6 h-6"></i>
            </div>

            <h1 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Security Verification</h1>
            <p class="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
              Enter the 4-digit code sent to <b class="text-slate-900 dark:text-white font-mono font-semibold">${escapeHtml(emailDisplay)}</b>.
            </p>

            ${reasonDisplay ? `
              <div class="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs font-medium text-left" title="${escapeHtml(reasonDisplay)}">
                <span class="font-semibold">Review note:</span> ${escapeHtml(reasonDisplay)}
              </div>
            ` : ''}

            <!-- Dynamic Error / Alert Banner Above the 4 Boxes -->
            <div id="otp-error-container" class="min-h-[28px] mt-3 mb-1"></div>

            <!-- 4-Digit Rotating / Merging Arena -->
            <div id="otp-arena" class="otp-stage-container w-full max-w-[280px] mx-auto h-24 flex items-center justify-center gap-3 relative my-2">
              <div id="otp-slot-0" class="otp-box-slot">
                <input type="text" maxlength="1" inputmode="numeric" autocomplete="one-time-code" id="otp-digit-0" class="otp-input-element w-[54px] h-[62px] rounded-xl text-2xl font-mono font-bold tabular-nums text-center pitch-input focus:outline-none" data-idx="0">
              </div>
              <div id="otp-slot-1" class="otp-box-slot">
                <input type="text" maxlength="1" inputmode="numeric" id="otp-digit-1" class="otp-input-element w-[54px] h-[62px] rounded-xl text-2xl font-mono font-bold tabular-nums text-center pitch-input focus:outline-none" data-idx="1">
              </div>
              <div id="otp-slot-2" class="otp-box-slot">
                <input type="text" maxlength="1" inputmode="numeric" id="otp-digit-2" class="otp-input-element w-[54px] h-[62px] rounded-xl text-2xl font-mono font-bold tabular-nums text-center pitch-input focus:outline-none" data-idx="2">
              </div>
              <div id="otp-slot-3" class="otp-box-slot">
                <input type="text" maxlength="1" inputmode="numeric" id="otp-digit-3" class="otp-input-element w-[54px] h-[62px] rounded-xl text-2xl font-mono font-bold tabular-nums text-center pitch-input focus:outline-none" data-idx="3">
              </div>

              <!-- Central Fusion Tick Core -->
              <div id="otp-fusion-core" class="otp-fusion-core bg-blue-600 text-white shadow-2xl">
                <svg class="w-8 h-8 text-white stroke-[3.5]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            </div>

            <!-- Success Message Placeholder -->
            <div id="otp-success-container" class="min-h-[20px]"></div>

            <!-- Action Buttons -->
            <div class="mt-4 space-y-3">
              <button id="otp-continue-btn" onclick="triggerOtpVerificationSubmit()" class="w-full zencloud-btn-primary py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 whitespace-nowrap">
                <span>Verify & Continue</span>
                <i data-lucide="arrow-right" class="w-4 h-4"></i>
              </button>

              <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-1">
                <button id="otp-resend-btn" onclick="handleOtpResend()" class="hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-medium">
                  Resend OTP Code
                </button>
                <button onclick="cancelOtpAndLogout()" class="hover:text-red-500 transition-colors font-medium">
                  Back to Login
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="text-center text-xs text-slate-500">Protected by ZenStorage Security</div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
  setupOtpInputHandlers();
}

function setupOtpInputHandlers() {
  const inputs = [0, 1, 2, 3].map(i => document.getElementById(`otp-digit-${i}`)).filter(Boolean);
  if (inputs.length < 4) return;

  // Auto focus first input
  setTimeout(() => inputs[0]?.focus(), 100);

  inputs.forEach((input, idx) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val ? val.slice(-1) : '';

      // Clear any existing error state
      document.getElementById('otp-error-container').innerHTML = '';
      inputs.forEach(inp => inp.classList.remove('border-red-500', 'otp-error-shake'));

      if (e.target.value && idx < 3) {
        inputs[idx + 1].focus();
      }

      // If all 4 boxes have digits, trigger verification automatically
      const fullOtp = inputs.map(i => i.value).join('');
      if (fullOtp.length === 4) {
        triggerOtpVerificationSubmit();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!e.target.value && idx > 0) {
          inputs[idx - 1].focus();
          inputs[idx - 1].value = '';
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        inputs[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < 3) {
        inputs[idx + 1].focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        triggerOtpVerificationSubmit();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      const cleanDigits = pasteData.replace(/\D/g, '').slice(0, 4);
      if (!cleanDigits) return;

      for (let i = 0; i < cleanDigits.length; i++) {
        if (inputs[i]) inputs[i].value = cleanDigits[i];
      }
      if (cleanDigits.length < 4 && inputs[cleanDigits.length]) {
        inputs[cleanDigits.length].focus();
      } else if (cleanDigits.length === 4) {
        inputs[3].focus();
        triggerOtpVerificationSubmit();
      }
    });
  });
}

let isOtpVerifying = false;
async function triggerOtpVerificationSubmit() {
  if (isOtpVerifying) return;

  const inputs = [0, 1, 2, 3].map(i => document.getElementById(`otp-digit-${i}`)).filter(Boolean);
  const otpCode = inputs.map(i => (i ? i.value.trim() : '')).join('');

  const errorContainer = document.getElementById('otp-error-container');
  const continueBtn = document.getElementById('otp-continue-btn');
  const fusionCore = document.getElementById('otp-fusion-core');

  if (otpCode.length !== 4) {
    if (errorContainer) {
      errorContainer.innerHTML = `
        <div class="text-red-400 bg-red-500/10 border border-red-500/25 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 animate-slide-down">
          <i data-lucide="alert-circle" class="w-4 h-4 text-red-400 shrink-0"></i>
          <span>Please enter all 4 verification digits.</span>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    }
    const emptyIdx = inputs.findIndex(i => !i.value);
    if (emptyIdx >= 0 && inputs[emptyIdx]) inputs[emptyIdx].focus();
    return;
  }

  isOtpVerifying = true;
  if (errorContainer) errorContainer.innerHTML = '';
  if (continueBtn) {
    continueBtn.disabled = true;
    continueBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> <span>Verifying...</span>`;
    if (window.lucide) lucide.createIcons();
  }

  // 1. Trigger Clean Circular Orbit and Merge Animation on the 4 boxes
  for (let i = 0; i < 4; i++) {
    const slot = document.getElementById(`otp-slot-${i}`);
    if (slot) {
      slot.className = `otp-box-slot otp-anim-orbit-${i}`;
    }
    if (inputs[i]) inputs[i].disabled = true;
  }

  // 2. Show Central Fusion Core as boxes rotate & merge inwards
  setTimeout(() => {
    if (fusionCore) fusionCore.classList.add('otp-fusion-active');
  }, 750);

  // 3. Make API verification call in parallel with the circular merge animation
  const tempToken = AppState.otpSessionData?.tempToken || AppState.token;
  const startTime = Date.now();

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tempToken ? { 'Authorization': `Bearer ${tempToken}` } : {})
      },
      body: JSON.stringify({ otp: otpCode, tempToken })
    });

    const data = await res.json().catch(() => ({}));
    const elapsed = Date.now() - startTime;
    const minWait = Math.max(0, 1300 - elapsed); // Let the merge animation complete gracefully

    await new Promise(r => setTimeout(r, minWait));

    if (!res.ok) {
      throw new Error(data.error || 'Incorrect verification code.');
    }

    // SUCCESS: Merged core combines into radiant green badge with tick sign!
    if (fusionCore) {
      fusionCore.className = 'otp-fusion-core otp-success-glow';
    }

    const successContainer = document.getElementById('otp-success-container');
    if (successContainer) {
      successContainer.innerHTML = `
        <div class="text-emerald-400 font-bold text-sm mt-2 animate-slide-down flex items-center justify-center gap-1.5">
          <i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>
          <span>Verification Successful! Unlocking account...</span>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    }

    // Update global state with active session
    AppState.token = data.token;
    AppState.user = { ...data.user, requires_otp_verification: 0, is_suspicious: 0 };
    AppState.otpSessionData = null;
    AppState.currentTab = 'dashboard';
    localStorage.setItem('vps_token', data.token);
    localStorage.setItem('vps_user', JSON.stringify(AppState.user));

    showToast('Identity verified successfully! Welcome to ZenStorage.', 'success');

    // Smooth transition to Dashboard
    setTimeout(() => {
      isOtpVerifying = false;
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } else {
        window.location.hash = '';
      }
      renderApp();
    }, 950);

  } catch (err) {
    const elapsed = Date.now() - startTime;
    const minWait = Math.max(0, 1300 - elapsed);
    await new Promise(r => setTimeout(r, minWait));

    // ERROR: 4 boxes undergo dramatic REPULSION outward and recoil back to normal state
    if (fusionCore) {
      fusionCore.className = 'otp-fusion-core';
    }

    for (let i = 0; i < 4; i++) {
      const slot = document.getElementById(`otp-slot-${i}`);
      if (slot) {
        slot.className = `otp-box-slot otp-anim-repulse-${i}`;
      }
    }

    // Display clear, prominent error text above the boxes
    if (errorContainer) {
      errorContainer.innerHTML = `
        <div class="text-red-400 bg-red-500/10 border border-red-500/30 px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 animate-slide-down">
          <i data-lucide="alert-triangle" class="w-4 h-4 text-red-400 shrink-0"></i>
          <span>${escapeHtml(err.message || 'Incorrect verification code. Please try again.')}</span>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    }

    // Reset slots and inputs after repulsion spring settles
    setTimeout(() => {
      for (let i = 0; i < 4; i++) {
        const slot = document.getElementById(`otp-slot-${i}`);
        if (slot) slot.className = 'otp-box-slot';
        if (inputs[i]) {
          inputs[i].disabled = false;
          inputs[i].value = '';
          inputs[i].classList.add('border-red-500', 'otp-error-shake');
        }
      }
      if (inputs[0]) inputs[0].focus();
      if (continueBtn) {
        continueBtn.disabled = false;
        continueBtn.innerHTML = `<span>Continue</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
        if (window.lucide) lucide.createIcons();
      }
      isOtpVerifying = false;
    }, 850);
  }
}

async function handleOtpResend() {
  const btn = document.getElementById('otp-resend-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending new OTP...';
  }

  try {
    const tempToken = AppState.otpSessionData?.tempToken || AppState.token;
    const res = await fetch('/api/auth/resend-otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tempToken ? { 'Authorization': `Bearer ${tempToken}` } : {})
      },
      body: JSON.stringify({ tempToken })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to resend code.');

    showToast(data.message || 'A fresh 4-digit verification code was sent to your email.', 'success');

    // Clear inputs and focus first box
    [0, 1, 2, 3].forEach(i => {
      const inp = document.getElementById(`otp-digit-${i}`);
      if (inp) { inp.value = ''; inp.classList.remove('border-red-500'); }
    });
    document.getElementById('otp-digit-0')?.focus();

    // Start 30s countdown
    let seconds = 30;
    const timer = setInterval(() => {
      seconds--;
      if (seconds > 0) {
        if (btn) btn.textContent = `Resend available in ${seconds}s`;
      } else {
        clearInterval(timer);
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Resend OTP Code';
        }
      }
    }, 1000);

  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Resend OTP Code';
    }
  }
}

function cancelOtpAndLogout() {
  AppState.otpSessionData = null;
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } else {
    window.location.hash = '';
  }
  logoutUser();
}

async function renderPublicShareView(root) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');
  root.innerHTML = `
    <div class="h-full min-h-full overflow-y-auto flex flex-col items-center justify-center p-4 sm:p-6 theme-main-bg custom-scrollbar">
      <div class="w-full max-w-xl flex justify-between items-center mb-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg zencloud-logo-badge"><i data-lucide="cloud-lightning" class="w-4 h-4"></i></div>
          <span class="text-sm font-bold text-slate-900 dark:text-white">ZenStorage</span>
        </div>
        <button onclick="toggleDarkMode()" class="px-3 py-1.5 flex items-center gap-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-300">
          <i data-lucide="${AppState.isDarkMode ? 'sun' : 'moon'}" class="w-3.5 h-3.5 text-amber-500 dark:text-blue-400"></i>
          <span>${AppState.isDarkMode ? 'Light' : 'Dark'}</span>
        </button>
      </div>
      <div class="w-full max-w-xl glass-card p-7 rounded-2xl my-auto">
        <div class="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200 dark:border-white/10">
          <div class="w-10 h-10 rounded-xl zencloud-logo-badge"><i data-lucide="share-2" class="w-5 h-5"></i></div>
          <div>
            <h1 class="text-base font-bold text-slate-900 dark:text-white">Shared Resource</h1>
            <p class="text-xs text-slate-500 dark:text-slate-400">Encrypted public transfer link</p>
          </div>
        </div>
        <div id="public-share-content" class="text-sm text-slate-600 dark:text-slate-300">Loading shared content...</div>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons();
  if (!token) {
    document.getElementById('public-share-content').innerHTML = '<div class="text-red-500 dark:text-red-400 font-medium">Share token is missing.</div>';
    return;
  }
  try {
    const res = await fetch(`/api/share/public/${encodeURIComponent(token)}?info=1`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Share link is unavailable.');
    const canPreview = !data.isDirectory && (String(data.mimeType || '').startsWith('image/') || String(data.mimeType || '').startsWith('video/'));
    document.getElementById('public-share-content').innerHTML = `
      <div class="rounded-xl bg-slate-50 dark:bg-[#0d0d12] border border-slate-200 dark:border-white/10 p-4 space-y-3">
        <div>
          <div class="text-xs text-slate-500 dark:text-slate-400">Resource Name</div>
          <div class="text-base font-semibold text-slate-900 dark:text-white break-all mt-0.5">${escapeHtml(data.fileName)}</div>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums pt-1">
          <span>${data.isDirectory ? 'Folder Archive' : escapeHtml(data.mimeType || 'Binary File')}</span>
          <span aria-hidden="true">·</span>
          <span>${data.isDirectory ? 'Directory' : formatBytes(data.sizeBytes)}</span>
          <span aria-hidden="true">·</span>
          <span class="${data.expiresAt ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}">${data.expiresAt ? 'Expires ' + new Date(data.expiresAt).toLocaleString() : 'No expiration'}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-3 mt-5">
        ${canPreview ? `<button onclick="openPublicSharePreview('${encodeURIComponent(token)}','${escapeHtml(data.fileName)}','${escapeHtml(data.mimeType || '')}')" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-white/15 bg-white dark:bg-[#16161e] text-slate-900 dark:text-white hover:border-blue-500/50 transition-all"><i data-lucide="${String(data.mimeType || '').startsWith('video/') ? 'play-circle' : 'image'}" class="w-4 h-4 text-blue-500"></i> Preview</button>` : ''}
        <a href="/api/share/public/${encodeURIComponent(token)}" class="zencloud-btn-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold"><i data-lucide="download" class="w-4 h-4"></i> Download ${data.isDirectory ? 'Folder' : 'File'}</a>
      </div>`;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    document.getElementById('public-share-content').innerHTML = `<div class="text-red-500 dark:text-red-400 font-medium">${escapeHtml(err.message)}</div>`;
  }
}

function formatMediaTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function createVideoPlayerMarkup(videoId, sourceUrl, title) {
  return `
    <div class="w-full max-w-5xl mx-auto rounded-2xl overflow-hidden border border-slate-800 bg-black shadow-2xl" data-media-player="1" data-title="${escapeHtml(title)}">
      <div class="relative bg-black min-h-[240px] flex items-center justify-center">
        <video id="${videoId}" src="${sourceUrl}" class="block w-full max-h-[72vh] object-contain bg-black" playsinline preload="auto"></video>
        <div id="${videoId}-loading" class="absolute inset-0 flex items-center justify-center bg-black/35 pointer-events-none">
          <div class="flex items-center gap-2 text-xs text-slate-200 bg-slate-950/70 px-3 py-2 rounded-full border border-slate-800">
            <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Loading video…</span>
          </div>
        </div>
      </div>
      <div class="px-3 py-3 bg-slate-950 border-t border-slate-800 space-y-2">
        <input id="${videoId}-seek" type="range" min="0" max="1000" value="0" class="w-full accent-cyan-500 cursor-pointer" aria-label="Seek video">
        <div class="flex items-center gap-2 text-xs text-slate-300">
          <button id="${videoId}-play" type="button" class="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center" title="Play / Pause">
            <i data-lucide="play" class="w-4 h-4"></i>
          </button>
          <span id="${videoId}-time" class="tabular-nums min-w-[86px]">0:00 / 0:00</span>
          <button id="${videoId}-mute" type="button" class="w-9 h-9 rounded-lg hover:bg-slate-800 flex items-center justify-center" title="Mute">
            <i data-lucide="volume-2" class="w-4 h-4"></i>
          </button>
          <input id="${videoId}-volume" type="range" min="0" max="1" step="0.01" value="1" class="w-20 accent-cyan-500" aria-label="Volume">
          <div class="flex-1"></div>
          <select id="${videoId}-speed" class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" title="Playback speed">
            <option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option>
          </select>
          <button id="${videoId}-pip" type="button" class="w-9 h-9 rounded-lg hover:bg-slate-800 flex items-center justify-center" title="Picture in Picture">
            <i data-lucide="picture-in-picture-2" class="w-4 h-4"></i>
          </button>
          <button id="${videoId}-fullscreen" type="button" class="w-9 h-9 rounded-lg hover:bg-slate-800 flex items-center justify-center" title="Fullscreen">
            <i data-lucide="maximize" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    </div>`;
}

function setupVideoPlayer(videoId, directUrl, fallbackUrl, safeFallbackUrl, downloadUrl) {
  const video = document.getElementById(videoId);
  if (!video) return;
  const player = video.closest('[data-media-player]');
  const loading = document.getElementById(`${videoId}-loading`);
  const seek = document.getElementById(`${videoId}-seek`);
  const time = document.getElementById(`${videoId}-time`);
  const play = document.getElementById(`${videoId}-play`);
  const mute = document.getElementById(`${videoId}-mute`);
  const volume = document.getElementById(`${videoId}-volume`);
  const speed = document.getElementById(`${videoId}-speed`);
  const pip = document.getElementById(`${videoId}-pip`);
  const fullscreen = document.getElementById(`${videoId}-fullscreen`);

  // Playback is attempted in tiers: the original file streams instantly if the
  // browser can decode it; if the browser's decoder rejects it (including
  // hardware-decoder failures such as Chromium's "GetVideoDecoderConfigCount
  // failed"), we retry against a server-transcoded H.264 High/1080p stream;
  // if that ALSO fails (a stubborn hardware/driver issue), we retry once more
  // against a maximally conservative Baseline/720p stream before giving up.
  let tier = 0;
  const tiers = [directUrl, fallbackUrl, safeFallbackUrl].filter(Boolean);

  const icon = (button, name) => {
    if (!button) return;
    button.innerHTML = `<i data-lucide="${name}" class="w-4 h-4"></i>`;
    if (window.lucide) lucide.createIcons();
  };
  const setLoading = (message, show = true) => {
    if (!loading) return;
    loading.classList.toggle('hidden', !show);
    const span = loading.querySelector('span');
    if (span) span.textContent = message;
  };
  const updateTime = () => {
    if (!time) return;
    time.textContent = `${formatMediaTime(video.currentTime)} / ${formatMediaTime(video.duration)}`;
    if (seek && Number.isFinite(video.duration) && video.duration > 0) {
      seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
  };

  play?.addEventListener('click', async () => {
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch (_) {}
  });
  mute?.addEventListener('click', () => {
    video.muted = !video.muted;
    icon(mute, video.muted || video.volume === 0 ? 'volume-x' : 'volume-2');
  });
  volume?.addEventListener('input', () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
    icon(mute, video.muted ? 'volume-x' : 'volume-2');
  });
  speed?.addEventListener('change', () => { video.playbackRate = Number(speed.value); });
  seek?.addEventListener('input', () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = (Number(seek.value) / 1000) * video.duration;
    }
  });
  pip?.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video.requestPictureInPicture) await video.requestPictureInPicture();
    } catch (_) {}
  });
  fullscreen?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (player?.requestFullscreen) await player.requestFullscreen();
    } catch (_) {}
  });
  video.addEventListener('play', () => icon(play, 'pause'));
  video.addEventListener('pause', () => icon(play, 'play'));
  video.addEventListener('timeupdate', updateTime);
  video.addEventListener('durationchange', updateTime);
  video.addEventListener('loadedmetadata', () => { updateTime(); setLoading('', false); });
  video.addEventListener('canplay', () => setLoading('', false));
  video.addEventListener('waiting', () => setLoading('Buffering…', true));
  video.addEventListener('playing', () => setLoading('', false));

  const loadTier = (index, resume) => {
    tier = index;
    video.removeAttribute('src');
    video.src = tiers[tier];
    video.preload = 'auto';
    video.load();
    if (resume) {
      // A tier switch happens after the person already pressed play, so
      // resuming automatically continues their original request instead of
      // silently sitting at 0:00 until they click play again.
      video.addEventListener('canplay', () => { video.play().catch(() => {}); }, { once: true });
    }
  };

  const giveUp = () => {
    const code = video.error?.code || 0;
    const detail = video.error?.message || 'Unsupported media codec or a corrupted video stream.';
    setLoading('', false);
    const body = video.closest('[data-media-player]')?.parentElement;
    if (body) {
      const notice = document.createElement('div');
      notice.className = 'mt-3 text-xs text-amber-300 bg-amber-950/40 border border-amber-900/50 rounded-xl px-3 py-3 flex flex-col gap-2';
      notice.innerHTML = `
        <div>This video's format isn't supported by your browser/GPU on this device, even after converting it. This is usually a browser hardware-acceleration issue, not a problem with the file.</div>
        <div class="flex flex-wrap gap-2">
          ${downloadUrl ? `<a href="${downloadUrl}" class="inline-flex items-center gap-1.5 bg-white hover:bg-neutral-200 text-black font-semibold px-3 py-1.5 rounded-lg text-xs transition-all"><i data-lucide="download" class="w-3.5 h-3.5"></i> Download instead</a>` : ''}
        </div>`;
      body.appendChild(notice);
      if (window.lucide) lucide.createIcons();
    }
    showToast(`Video preview failed (${code}): ${detail}`, 'error');
  };

  video.addEventListener('error', () => {
    if (tier < tiers.length - 1) {
      setLoading(tier === 0 ? 'Preparing a browser-compatible preview…' : 'Trying a more compatible format…', true);
      loadTier(tier + 1, true);
      return;
    }
    giveUp();
  });

  setLoading('Opening video…', true);
  loadTier(0, false);
}

function openPublicSharePreview(token, fileName, mimeType) {
  closeFilePreview();
  const drawer = document.createElement('div');
  drawer.id = 'file-preview-drawer';
  drawer.className = 'fixed right-0 top-0 h-full shadow-2xl z-[80] flex flex-col';
  const previewUrl = `/api/share/public/${token}?preview=1`;
  const isVideo = String(mimeType || '').startsWith('video/');
  drawer.innerHTML = `
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d0d12] shrink-0">
      <div class="min-w-0">
        <div class="text-xs text-slate-500 dark:text-slate-400">Shared Preview</div>
        <div class="text-sm font-semibold text-slate-900 dark:text-white truncate" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
      </div>
      <button onclick="closeFilePreview()" class="p-2 rounded-lg bg-slate-100 dark:bg-white/10 hover:bg-red-600 text-slate-600 dark:text-slate-300 hover:text-white shrink-0 transition-colors" title="Close preview">
        <i data-lucide="x" class="w-5 h-5"></i>
      </button>
    </div>
    <div class="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100/70 dark:bg-[#09090b]">
      ${isVideo
        ? createVideoPlayerMarkup('public-share-preview-video', previewUrl, fileName)
        : `<img src="${previewUrl}" alt="${escapeHtml(fileName)}" class="preview-media mx-auto" />`}
    </div>
    <div class="px-4 py-3 border-t border-slate-200 dark:border-white/10 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">Public shared preview</div>
  `;
  document.body.appendChild(drawer);
  if (window.lucide) lucide.createIcons();
  if (isVideo) {
    setupVideoPlayer(
      'public-share-preview-video',
      previewUrl,
      `${previewUrl}&transcoded=1`,
      `${previewUrl}&transcoded=1&safe=1`,
      `/api/share/public/${token}`
    );
  }
}

async function renderResetPasswordView(root) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');
  root.innerHTML = `
    <div class="h-full min-h-full overflow-y-auto flex flex-col items-center justify-center p-4 theme-main-bg custom-scrollbar">
      <div class="w-full max-w-md glass-card p-8 rounded-2xl text-left my-auto">
        <div class="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200 dark:border-white/10">
          <div class="w-10 h-10 rounded-xl zencloud-logo-badge"><i data-lucide="key" class="w-5 h-5"></i></div>
          <div>
            <h1 class="text-lg font-bold text-slate-900 dark:text-white">Reset Password</h1>
            <p class="text-xs text-slate-500 dark:text-slate-400">Enter your new account password</p>
          </div>
        </div>
        <form onsubmit="handleResetPasswordSubmit(event, '${encodeURIComponent(token || '')}')" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">New Password</label>
            <input type="password" id="reset-new-pass" required minlength="6" class="w-full pitch-input rounded-xl px-4 py-2.5 text-sm focus:outline-none" placeholder="••••••••">
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Confirm New Password</label>
            <input type="password" id="reset-confirm-pass" required minlength="6" class="w-full pitch-input rounded-xl px-4 py-2.5 text-sm focus:outline-none" placeholder="••••••••">
          </div>
          <button type="submit" class="w-full zencloud-btn-primary py-2.5 rounded-xl text-sm">Update Password</button>
        </form>
        <div class="mt-4 text-center">
          <button onclick="window.location.hash=''; renderApp();" class="text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-medium">Back to Login</button>
        </div>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

async function handleResetPasswordSubmit(e, token) {
  e.preventDefault();
  const newPassword = document.getElementById('reset-new-pass').value;
  const confirmPassword = document.getElementById('reset-confirm-pass').value;
  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match.', 'error');
    return;
  }
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: decodeURIComponent(token), newPassword, confirmPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Password reset failed.');
    showToast(data.message, 'success');
    window.location.hash = '';
    renderApp();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openForgotPasswordModal() {
  document.getElementById('forgot-pass-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'forgot-pass-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm modal-backdrop-enter';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="glass-card w-full max-w-md p-6 rounded-2xl modal-box-enter" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2"><i data-lucide="help-circle" class="w-5 h-5 text-blue-500"></i> Forgot Password</h3>
        <button type="button" onclick="document.getElementById('forgot-pass-modal')?.remove()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <p class="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">Enter your registered email address and we will send you a password reset link.</p>
      <form onsubmit="handleForgotPasswordSubmit(event)" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Account Email</label>
          <input type="email" id="forgot-email-input" required class="w-full pitch-input rounded-xl px-4 py-2.5 text-sm focus:outline-none" placeholder="user@domain.com">
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="document.getElementById('forgot-pass-modal')?.remove()" class="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 text-xs font-semibold">Cancel</button>
          <button type="submit" class="px-4 py-2 rounded-xl zencloud-btn-primary text-xs">Send Reset Link</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

async function handleForgotPasswordSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email-input').value.trim();
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    document.getElementById('forgot-pass-modal')?.remove();
    showToast(data.message || 'If an account exists with that email, a reset link was sent.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function renderVerifyEmailView(root) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');
  root.innerHTML = `
    <div class="h-full min-h-full overflow-y-auto flex items-center justify-center p-4 theme-main-bg custom-scrollbar">
      <div class="w-full max-w-md glass-card p-8 rounded-2xl text-center my-auto">
        <div id="verify-email-status" class="text-sm text-slate-600 dark:text-slate-300">Verifying your email...</div>
      </div>
    </div>`;
  if (!token) {
    document.getElementById('verify-email-status').innerHTML = '<div class="text-red-500 dark:text-red-400 font-medium">Verification token is missing.</div>';
    return;
  }
  try {
    const res = await fetch('/api/auth/email/verify-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Verification failed.');
    if (AppState.user) {
      AppState.user.emailVerified = true;
      localStorage.setItem('vps_user', JSON.stringify(AppState.user));
    }
    document.getElementById('verify-email-status').innerHTML = `
      <div class="text-emerald-600 dark:text-emerald-400 font-semibold">${escapeHtml(data.message)}</div>
      <button onclick="window.location.hash=''; renderApp()" class="mt-5 zencloud-btn-primary text-xs px-5 py-2.5 rounded-xl">Continue</button>`;
  } catch (err) {
    document.getElementById('verify-email-status').innerHTML = `
      <div class="text-red-500 dark:text-red-400 font-semibold">${escapeHtml(err.message)}</div>
      <button onclick="window.location.hash=''; renderApp()" class="mt-5 border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 text-slate-800 dark:text-white font-semibold text-xs px-5 py-2.5 rounded-xl">Back</button>`;
  }
}

async function renderVerifyEmailChangeView(root) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');
  root.innerHTML = `
    <div class="h-full min-h-full overflow-y-auto flex items-center justify-center p-4 theme-main-bg custom-scrollbar">
      <div class="w-full max-w-md glass-card p-8 rounded-2xl text-center my-auto">
        <div id="verify-change-status" class="text-sm text-slate-600 dark:text-slate-300">Verifying your new email...</div>
      </div>
    </div>`;
  if (!token) {
    document.getElementById('verify-change-status').innerHTML = '<div class="text-red-500 dark:text-red-400 font-medium">Verification token is missing.</div>';
    return;
  }
  try {
    const res = await fetch('/api/auth/email/verify-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Verification failed.');
    document.getElementById('verify-change-status').innerHTML = `
      <div class="text-emerald-600 dark:text-emerald-400 font-semibold">${escapeHtml(data.message)}</div>
      <button onclick="window.location.hash=''; renderApp()" class="mt-5 zencloud-btn-primary text-xs px-5 py-2.5 rounded-xl">Continue</button>`;
  } catch (err) {
    document.getElementById('verify-change-status').innerHTML = `
      <div class="text-red-500 dark:text-red-400 font-semibold">${escapeHtml(err.message)}</div>
      <button onclick="window.location.hash=''; renderApp()" class="mt-5 border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 text-slate-800 dark:text-white font-semibold text-xs px-5 py-2.5 rounded-xl">Back</button>`;
  }
}

// ==========================================
// 1. AUTHENTICATION VIEWS (Login / Register / Reset)
// ==========================================
function renderAuthView(container) {
  container.innerHTML = `
    <div class="h-full min-h-full overflow-y-auto grid grid-cols-1 lg:grid-cols-2 theme-main-bg transition-colors duration-200 custom-scrollbar">
      <!-- Left Infrastructure Showcase Panel (Deep Obsidian) -->
      <div class="hidden lg:flex flex-col justify-between p-12 xl:p-16 bg-[#09090b] text-white border-r border-white/10 enterprise-grid-bg relative overflow-hidden">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <i data-lucide="cloud-lightning" class="w-5 h-5"></i>
          </div>
          <span class="text-lg font-bold tracking-tight text-white whitespace-nowrap">ZenStorage</span>
        </div>

        <div class="max-w-lg space-y-8 my-auto py-8">
          <div class="space-y-4">
            <p class="text-xs font-semibold text-blue-400 tracking-wide">Enterprise Object Storage</p>
            <h1 class="text-4xl font-bold tracking-tight text-white leading-[1.15]" style="text-wrap: balance;">
              Unified S3, Blob & SFTP infrastructure console.
            </h1>
            <p class="text-sm text-zinc-400 leading-relaxed max-w-md">
              Deploy programmable object buckets, manage multi-user storage quotas, edit files in the live developer studio, and inspect server activity from one high-density workspace.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6 border-t border-white/10">
            <div class="space-y-1">
              <div class="text-xs font-semibold text-white">AWS S3 v4 Gateway</div>
              <p class="text-xs text-zinc-400 leading-relaxed">Drop-in endpoint compatibility for Boto3, AWS SDK v3, and Cyberduck.</p>
            </div>
            <div class="space-y-1">
              <div class="text-xs font-semibold text-white">Vercel Blob Compatible</div>
              <p class="text-xs text-zinc-400 leading-relaxed">Token-authenticated put, list, head, and direct inline CDN embeds.</p>
            </div>
            <div class="space-y-1">
              <div class="text-xs font-semibold text-white">Inbuilt Code Studio</div>
              <p class="text-xs text-zinc-400 leading-relaxed">Edit HTML, Markdown, JSON, and scripts with live split preview.</p>
            </div>
            <div class="space-y-1">
              <div class="text-xs font-semibold text-white">Hardware Isolation</div>
              <p class="text-xs text-zinc-400 leading-relaxed">Per-account directory sandboxing, IP tracking, and 4-digit OTP checks.</p>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3 text-xs text-zinc-500">
          <span>Zero-Egress Edge Delivery</span>
          <span aria-hidden="true">·</span>
          <span>SFTP & HTTP Streaming</span>
        </div>
      </div>

      <!-- Right Authentication Form Panel -->
      <div class="flex flex-col justify-between p-6 sm:p-10 lg:p-12 theme-main-bg overflow-y-auto">
        <div class="flex items-center justify-between">
          <div class="flex lg:hidden items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg zencloud-logo-badge"><i data-lucide="cloud-lightning" class="w-4 h-4"></i></div>
            <span class="text-base font-bold text-slate-900 dark:text-white whitespace-nowrap">ZenStorage</span>
          </div>
          <div class="ml-auto">
            <button onclick="toggleDarkMode()" title="Toggle Light / Dark Theme" class="px-3 py-1.5 flex items-center gap-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-300 hover:border-blue-500/50 transition-colors">
              <i data-lucide="${AppState.isDarkMode ? 'sun' : 'moon'}" class="w-3.5 h-3.5 text-amber-500 dark:text-blue-400"></i>
              <span>${AppState.isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          </div>
        </div>

        <div class="w-full max-w-md mx-auto my-auto py-8 tab-pane-enter">
          <div class="glass-card p-7 sm:p-8 rounded-2xl">
            <div class="mb-6">
              <h2 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Access Console</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Sign in to manage storage volumes, API tokens, and files.</p>
            </div>

            <div class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#09090b] border border-slate-200 dark:border-white/10 mb-6">
              <button id="tab-login-btn" onclick="switchAuthTab('login')" class="py-2 text-xs font-semibold rounded-lg bg-white dark:bg-[#181820] text-slate-900 dark:text-white shadow-sm transition-all whitespace-nowrap">Sign In</button>
              <button id="tab-register-btn" onclick="switchAuthTab('register')" class="py-2 text-xs font-medium rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all whitespace-nowrap">Create Account</button>
            </div>

            <!-- Login Form -->
            <form id="auth-login-form" onsubmit="handleLoginSubmit(event)">
              <div class="space-y-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Username or Email</label>
                  <input type="text" id="login-input-user" required class="w-full pitch-input rounded-xl px-3.5 py-2.5 text-sm focus:outline-none" placeholder="you@company.com">
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300">Password</label>
                    <button type="button" onclick="openForgotPasswordModal()" class="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">Forgot password?</button>
                  </div>
                  <input type="password" id="login-input-pass" required class="w-full pitch-input rounded-xl px-3.5 py-2.5 text-sm focus:outline-none" placeholder="••••••••">
                </div>
                <button type="submit" class="w-full zencloud-btn-primary py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 whitespace-nowrap">
                  <i data-lucide="log-in" class="w-4 h-4"></i> Sign In
                </button>
              </div>
            </form>

            <!-- Register Form -->
            <form id="auth-register-form" onsubmit="handleRegisterSubmit(event)" class="hidden">
              <div class="space-y-3.5">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Full Name</label>
                    <input type="text" id="reg-name" required class="w-full pitch-input rounded-xl px-3.5 py-2 text-sm focus:outline-none" placeholder="Alex Rivera">
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Username</label>
                    <input type="text" id="reg-username" required class="w-full pitch-input rounded-xl px-3.5 py-2 text-sm focus:outline-none" placeholder="arivera">
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Email Address</label>
                  <input type="email" id="reg-email" required class="w-full pitch-input rounded-xl px-3.5 py-2 text-sm focus:outline-none" placeholder="you@company.com">
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Password</label>
                    <input type="password" id="reg-password" required minlength="6" class="w-full pitch-input rounded-xl px-3.5 py-2 text-sm focus:outline-none" placeholder="••••••••">
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Confirm</label>
                    <input type="password" id="reg-confirm" required class="w-full pitch-input rounded-xl px-3.5 py-2 text-sm focus:outline-none" placeholder="••••••••">
                  </div>
                </div>
                <button type="submit" class="w-full zencloud-btn-primary py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 mt-1 whitespace-nowrap">
                  <i data-lucide="user-plus" class="w-4 h-4"></i> Create Account
                </button>
              </div>
            </form>
          </div>
        </div>

        <div class="text-center text-xs text-slate-500">
          ZenStorage Cloud Console · Encrypted Session
        </div>
      </div>
    </div>
  `;
  if (window.lucide) {
    lucide.createIcons();
  }
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById('auth-login-form');
  const regForm = document.getElementById('auth-register-form');
  const loginBtn = document.getElementById('tab-login-btn');
  const regBtn = document.getElementById('tab-register-btn');
  const activeClass = 'py-2 text-xs font-semibold rounded-lg bg-white dark:bg-[#181820] text-slate-900 dark:text-white shadow-sm transition-all whitespace-nowrap';
  const inactiveClass = 'py-2 text-xs font-medium rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all whitespace-nowrap';

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
    loginBtn.className = activeClass;
    regBtn.className = inactiveClass;
  } else {
    loginForm.classList.add('hidden');
    regForm.classList.remove('hidden');
    regBtn.className = activeClass;
    loginBtn.className = inactiveClass;
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const usernameOrEmail = document.getElementById('login-input-user').value.trim();
  const password = document.getElementById('login-input-pass').value;

  try {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: { usernameOrEmail, password }
    });

    if (data.requiresOtp) {
      AppState.otpSessionData = data;
      AppState.currentTab = 'dashboard';
      window.location.hash = '#otp-verification';
      renderApp();
      return;
    }

    AppState.token = data.token;
    AppState.user = data.user;
    AppState.currentTab = 'dashboard';
    localStorage.setItem('vps_token', data.token);
    localStorage.setItem('vps_user', JSON.stringify(data.user));

    showToast('Logged in successfully!', 'success');
    renderApp();
  } catch (err) {
    if (err.requiresOtpVerification) {
      AppState.otpSessionData = err;
      window.location.hash = '#otp-verification';
      renderApp();
      return;
    }
    showToast(err.message, 'error');
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirmPassword = document.getElementById('reg-confirm').value;

  try {
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      body: { name, username, email, password, confirmPassword }
    });

    showToast(data.message, 'success');
    switchAuthTab('login');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 2. DASHBOARD & GLOBAL APPLICATION LAYOUT
// ==========================================
function renderBreadcrumbMarkup() {
  const tab = AppState.currentTab;
  let section = 'Workspace';
  let title = 'Overview';
  let icon = 'layout-dashboard';

  if (tab === 'files') {
    section = 'Workspace';
    title = 'Files & Studio';
    icon = 'folder';
  } else if (tab === 's3cluster') {
    section = 'Developer';
    title = AppState.pendingScrollTarget === 'api-keys-section' ? 'API Keys & Docs' : 'S3 & Blob Cluster';
    icon = 'database';
  } else if (tab === 'shares') {
    section = 'Workspace';
    title = 'Share Links';
    icon = 'share-2';
  } else if (tab === 'profile') {
    section = 'Account';
    title = 'Settings & Security';
    icon = 'settings';
  } else if (tab === 'admin') {
    section = 'Administration';
    title = 'Admin Console';
    icon = 'shield-alert';
  }

  let html = `
    <span class="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors whitespace-nowrap" onclick="navigateTab('dashboard')">ZenStorage</span>
    <span class="text-slate-300 dark:text-white/15 select-none">/</span>
    <span class="hidden sm:inline text-slate-500 dark:text-slate-400 whitespace-nowrap">${escapeHtml(section)}</span>
    <span class="hidden sm:inline text-slate-300 dark:text-white/15 select-none">/</span>
    <span class="text-slate-900 dark:text-white font-semibold flex items-center gap-1.5 whitespace-nowrap"><i data-lucide="${icon}" class="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0"></i> ${escapeHtml(title)}</span>
  `;

  if (tab === 'files' && AppState.currentPath && AppState.currentPath !== '/') {
    const parts = AppState.currentPath.split('/').filter(Boolean);
    let accum = '';
    parts.forEach((p, idx) => {
      accum += `/${p}`;
      const isLast = idx === parts.length - 1;
      const thisPath = accum;
      html += `
        <span class="text-slate-300 dark:text-white/15 select-none">/</span>
        ${isLast
          ? `<span class="text-slate-900 dark:text-white font-semibold font-mono truncate max-w-[140px]">${escapeHtml(p)}</span>`
          : `<span class="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-mono cursor-pointer transition-colors truncate max-w-[120px]" onclick="navigateToPath(decodeURIComponent('${escapeJsArg(thisPath)}'))">${escapeHtml(p)}</span>`
        }
      `;
    });
  }
  return html;
}

function toggleSidebarCollapse() {
  AppState.isSidebarCollapsed = !AppState.isSidebarCollapsed;
  localStorage.setItem('zen_sidebar_collapsed', String(AppState.isSidebarCollapsed));
  renderApp();
}

function toggleMobileSidebar(forceState = null) {
  if (forceState !== null) {
    AppState.isMobileSidebarOpen = forceState;
  } else {
    AppState.isMobileSidebarOpen = !AppState.isMobileSidebarOpen;
  }
  renderApp();
}

function navigateTabToSection(tabName, sectionId) {
  AppState.pendingScrollTarget = sectionId || null;
  if (AppState.currentTab === tabName) {
    AppState.isMobileSidebarOpen = false;
    if (sectionId) {
      setTimeout(() => {
        const el = document.getElementById(sectionId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
    return;
  }
  navigateTab(tabName);
}

function renderDashboardLayout(container) {
  const isAdmin = AppState.user && AppState.user.role === 'admin';
  const currentTab = AppState.currentTab || 'dashboard';
  const collapsed = !!AppState.isSidebarCollapsed;
  const mobileOpen = !!AppState.isMobileSidebarOpen;

  const navBtn = (tabKey, label, icon, onclickExpr, isSectionActive = null) => {
    const active = isSectionActive !== null ? isSectionActive : (currentTab === tabKey && !(tabKey === 's3cluster' && AppState.pendingScrollTarget === 'api-keys-section'));
    return `
      <button onclick="${onclickExpr}" data-tooltip="${escapeHtml(label)}"
        class="sidebar-nav-item ${active ? 'active' : ''} ${collapsed ? 'lg:justify-center lg:px-0 lg:w-10 lg:h-10 lg:mx-auto sidebar-collapsed-item' : 'w-full'} whitespace-nowrap shrink-0">
        <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
        <span class="${collapsed ? 'lg:hidden' : ''} truncate">${escapeHtml(label)}</span>
      </button>
    `;
  };

  const pct = Math.min(100, Math.max(0, Number(AppState.displayedQuotaPercent) || 0));

  container.innerHTML = `
    <div class="h-full w-full flex theme-main-bg text-slate-900 dark:text-slate-100 overflow-hidden relative">
      <!-- Mobile Drawer Backdrop -->
      ${mobileOpen ? `
        <div onclick="toggleMobileSidebar(false)" class="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 lg:hidden"></div>
      ` : ''}

      <!-- Persistent Collapsible Left Sidebar -->
      <aside class="fixed inset-y-0 left-0 z-50 lg:static flex flex-col theme-sidebar border-r transition-all duration-200 shrink-0 ${collapsed ? 'lg:w-[68px]' : 'lg:w-64'} w-64 ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}">
        <!-- Brand Header -->
        <div class="h-14 px-3.5 border-b border-slate-200 dark:border-white/10 flex items-center ${collapsed ? 'lg:justify-center' : 'justify-between'} gap-2 shrink-0">
          <button onclick="navigateTab('dashboard')" class="flex items-center gap-2.5 min-w-0 text-left group">
            <div class="w-8 h-8 rounded-lg zencloud-logo-badge shrink-0">
              <i data-lucide="cloud-lightning" class="w-4 h-4"></i>
            </div>
            <span class="font-bold text-sm tracking-tight text-slate-900 dark:text-white whitespace-nowrap truncate ${collapsed ? 'lg:hidden' : ''}">ZenStorage</span>
          </button>

          <button onclick="toggleSidebarCollapse()" title="${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}" class="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors shrink-0">
            <i data-lucide="${collapsed ? 'panel-left-open' : 'panel-left-close'}" class="w-4 h-4"></i>
          </button>

          <button onclick="toggleMobileSidebar(false)" class="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        <!-- Sidebar Navigation Sections -->
        <nav class="flex-1 overflow-y-auto custom-scrollbar px-2.5 py-4 space-y-5">
          <div class="space-y-1">
            <div class="px-2.5 pb-1 text-[11px] font-semibold text-slate-400 dark:text-zinc-500 ${collapsed ? 'lg:hidden' : ''}">Workspace</div>
            ${navBtn('dashboard', 'Overview', 'layout-dashboard', "AppState.pendingScrollTarget=null; navigateTab('dashboard')")}
            ${navBtn('files', 'Files & Studio', 'folder', "AppState.pendingScrollTarget=null; navigateTab('files')")}
            ${navBtn('shares', 'Share Links', 'share-2', "AppState.pendingScrollTarget=null; navigateTab('shares')")}
          </div>

          <div class="space-y-1">
            <div class="px-2.5 pb-1 text-[11px] font-semibold text-slate-400 dark:text-zinc-500 ${collapsed ? 'lg:hidden' : ''}">Developer</div>
            ${navBtn('s3cluster', 'S3 & Blob Cluster', 'database', "AppState.pendingScrollTarget=null; navigateTab('s3cluster')", currentTab === 's3cluster' && AppState.pendingScrollTarget !== 'api-keys-section')}
            ${navBtn('s3cluster-keys', 'API Keys & Docs', 'key', "navigateTabToSection('s3cluster', 'api-keys-section')", currentTab === 's3cluster' && AppState.pendingScrollTarget === 'api-keys-section')}
          </div>

          <div class="space-y-1">
            <div class="px-2.5 pb-1 text-[11px] font-semibold text-slate-400 dark:text-zinc-500 ${collapsed ? 'lg:hidden' : ''}">Account</div>
            ${navBtn('profile', 'Settings', 'settings', "AppState.pendingScrollTarget=null; navigateTab('profile')")}
          </div>

          ${isAdmin ? `
            <div class="space-y-1 pt-2 border-t border-slate-200 dark:border-white/10">
              <div class="px-2.5 pb-1 text-[11px] font-semibold text-slate-400 dark:text-zinc-500 ${collapsed ? 'lg:hidden' : ''}">Administration</div>
              ${navBtn('admin', 'Admin Console', 'shield-alert', "AppState.pendingScrollTarget=null; navigateTab('admin')")}
            </div>
          ` : ''}
        </nav>

        <!-- Bottom Storage Quota & User Footer -->
        <div class="p-3 border-t border-slate-200 dark:border-white/10 space-y-3 shrink-0">
          <div class="rounded-xl p-2.5 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 ${collapsed ? 'lg:hidden' : ''}">
            <div class="flex items-center justify-between text-[11px] font-medium mb-1.5">
              <span class="text-slate-600 dark:text-slate-300">Storage Quota</span>
              <span id="quota-percent-text" class="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">${pct}%</span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden mb-1.5">
              <div id="quota-bar" class="h-full rounded-full bg-blue-600 dark:bg-blue-500 transition-all duration-300" style="width: ${pct}%"></div>
            </div>
            <div id="quota-detail-text" class="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">Syncing usage...</div>
          </div>

          <div class="flex items-center ${collapsed ? 'lg:justify-center' : 'justify-between'} gap-2">
            <button onclick="navigateTab('profile')" class="flex items-center gap-2.5 min-w-0 text-left group ${collapsed ? 'lg:hidden' : ''}">
              <div class="zencloud-avatar-badge w-8 h-8 rounded-lg text-xs uppercase shrink-0">
                ${escapeHtml((AppState.user.username || 'US').substring(0, 2))}
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-slate-900 dark:text-white truncate">${escapeHtml(AppState.user.name || AppState.user.username)}</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate capitalize">${escapeHtml(AppState.user.role)} tier</div>
              </div>
            </button>
            <button onclick="logoutUser()" title="Sign Out" class="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0">
              <i data-lucide="log-out" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      </aside>

      <!-- Main Workspace Column -->
      <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
        <!-- Contextual Top Header -->
        <header class="h-14 border-b theme-header px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 z-30">
          <!-- Left: Mobile Sidebar Toggle + Breadcrumbs -->
          <div class="flex items-center gap-2.5 min-w-0">
            <button onclick="toggleMobileSidebar(true)" class="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10 shrink-0" aria-label="Open navigation">
              <i data-lucide="menu" class="w-4 h-4"></i>
            </button>
            <div class="flex items-center gap-1.5 text-xs min-w-0 overflow-hidden">
              ${renderBreadcrumbMarkup()}
            </div>
          </div>

          <!-- Right: Search Palette Trigger, + New Menu, Theme Toggle, Profile -->
          <div class="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <button onclick="openTwilightCommandPalette()" class="hidden sm:flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-blue-500/40 transition-all whitespace-nowrap shrink-0" title="Command Palette (Ctrl+K)">
              <i data-lucide="search" class="w-3.5 h-3.5"></i>
              <span class="hidden md:inline">Quick search...</span>
              <kbd class="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 rounded text-slate-500 dark:text-slate-300">Ctrl+K</kbd>
            </button>

            <!-- Quick Create Dropdown -->
            <div class="relative shrink-0">
              <button id="twilight-create-btn" onclick="toggleTwilightCreateMenu(event)" class="zencloud-btn-primary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                <span class="hidden sm:inline">New</span>
                <i data-lucide="chevron-down" class="w-3 h-3 opacity-80"></i>
              </button>

              <div id="twilight-create-menu" class="hidden absolute right-0 mt-2 w-56 rounded-xl glass-card shadow-2xl p-1.5 z-50 text-xs animate-scale-in">
                <div class="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-200 dark:border-white/10 mb-1">
                  Create or Upload
                </div>
                <button onclick="triggerNavbarFileUpload(); closeTwilightMenus();" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  <i data-lucide="upload-cloud" class="w-4 h-4 text-blue-500 shrink-0"></i>
                  <div>
                    <div class="font-medium text-slate-900 dark:text-white">Upload Files</div>
                    <div class="text-[10px] text-slate-500">Direct workspace transfer</div>
                  </div>
                </button>
                <button onclick="openCreateNewFileModal(); closeTwilightMenus();" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  <i data-lucide="file-plus" class="w-4 h-4 text-blue-500 shrink-0"></i>
                  <div>
                    <div class="font-medium text-slate-900 dark:text-white">New File</div>
                    <div class="text-[10px] text-slate-500">Open in Code Studio</div>
                  </div>
                </button>
                <button onclick="openCreateFolderModal(); closeTwilightMenus();" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  <i data-lucide="folder-plus" class="w-4 h-4 text-blue-500 shrink-0"></i>
                  <div>
                    <div class="font-medium text-slate-900 dark:text-white">New Folder</div>
                    <div class="text-[10px] text-slate-500">Directory in current path</div>
                  </div>
                </button>
                <button onclick="navigateTabToSection('s3cluster', 'api-keys-section'); closeTwilightMenus();" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  <i data-lucide="key" class="w-4 h-4 text-blue-500 shrink-0"></i>
                  <div>
                    <div class="font-medium text-slate-900 dark:text-white">New API Token</div>
                    <div class="text-[10px] text-slate-500">S3 & Vercel Blob access</div>
                  </div>
                </button>
              </div>
            </div>

            <!-- Theme Switcher -->
            <button onclick="toggleDarkMode()" title="Toggle Light / Dark Theme" class="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] transition-colors shrink-0">
              <i data-lucide="${AppState.isDarkMode ? 'sun' : 'moon'}" class="w-4 h-4 text-amber-500 dark:text-blue-400"></i>
            </button>

            <!-- User Dropdown -->
            <div class="relative shrink-0">
              <button id="twilight-user-btn" onclick="toggleTwilightUserMenu(event)" class="flex items-center gap-2 p-0.5 rounded-lg hover:ring-2 hover:ring-blue-500/40 transition-all">
                <div class="zencloud-avatar-badge w-8 h-8 rounded-lg text-xs uppercase">
                  ${escapeHtml((AppState.user.username || 'US').substring(0, 2))}
                </div>
              </button>

              <div id="twilight-user-menu" class="hidden absolute right-0 mt-2 w-60 rounded-xl glass-card shadow-2xl p-1.5 z-50 text-xs animate-scale-in">
                <div class="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 mb-1.5 flex items-center gap-2.5">
                  <div class="zencloud-avatar-badge w-8 h-8 rounded-lg text-xs uppercase shrink-0">
                    ${escapeHtml((AppState.user.username || 'US').substring(0, 2))}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="font-semibold text-slate-900 dark:text-white truncate">${escapeHtml(AppState.user.name || AppState.user.username)}</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">${escapeHtml(AppState.user.email || AppState.user.username)}</div>
                  </div>
                </div>
                <button onclick="navigateTab('dashboard'); closeTwilightMenus();" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  <i data-lucide="layout-dashboard" class="w-4 h-4 text-slate-400"></i> Overview
                </button>
                <button onclick="navigateTab('files'); closeTwilightMenus();" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  <i data-lucide="folder" class="w-4 h-4 text-slate-400"></i> Files & Studio
                </button>
                <button onclick="navigateTab('s3cluster'); closeTwilightMenus();" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  <i data-lucide="key" class="w-4 h-4 text-slate-400"></i> S3 & Blob API
                </button>
                <button onclick="navigateTab('profile'); closeTwilightMenus();" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  <i data-lucide="settings" class="w-4 h-4 text-slate-400"></i> Settings
                </button>
                ${isAdmin ? `
                  <button onclick="navigateTab('admin'); closeTwilightMenus();" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors font-semibold">
                    <i data-lucide="shield-alert" class="w-4 h-4"></i> Admin Console
                  </button>
                ` : ''}
                <div class="my-1.5 border-t border-slate-200 dark:border-white/10"></div>
                <button onclick="logoutUser()" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors">
                  <i data-lucide="log-out" class="w-4 h-4"></i> Sign Out
                </button>
              </div>
            </div>
          </div>
        </header>

        <!-- Dynamic Alert Banners -->
        <div id="main-header" class="shrink-0 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full space-y-2">
          <div id="email-verification-banner"></div>
        </div>

        <!-- Main Scrollable Viewport -->
        <main class="flex-1 min-h-0 overflow-y-auto custom-scrollbar theme-main-bg">
          <div id="tab-content-area" class="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 tab-pane-enter">
            <!-- Rendered dynamically -->
          </div>
        </main>
      </div>
    </div>
  `;

  updateQuotaWidget();
  renderEmailVerificationBanner();
  renderTabContent();
}

function toggleTwilightScopeMenu(event) {
  event.stopPropagation();
  const sMenu = document.getElementById('twilight-scope-menu');
  const cMenu = document.getElementById('twilight-create-menu');
  const uMenu = document.getElementById('twilight-user-menu');
  if (cMenu) cMenu.classList.add('hidden');
  if (uMenu) uMenu.classList.add('hidden');
  if (sMenu) {
    sMenu.classList.toggle('hidden');
    if (!sMenu.classList.contains('hidden') && window.lucide) {
      lucide.createIcons();
    }
  }
}

function toggleTwilightCreateMenu(event) {
  event.stopPropagation();
  const sMenu = document.getElementById('twilight-scope-menu');
  const cMenu = document.getElementById('twilight-create-menu');
  const uMenu = document.getElementById('twilight-user-menu');
  if (sMenu) sMenu.classList.add('hidden');
  if (uMenu) uMenu.classList.add('hidden');
  if (cMenu) {
    cMenu.classList.toggle('hidden');
    if (!cMenu.classList.contains('hidden') && window.lucide) {
      lucide.createIcons();
    }
  }
}

function toggleTwilightUserMenu(event) {
  event.stopPropagation();
  const sMenu = document.getElementById('twilight-scope-menu');
  const cMenu = document.getElementById('twilight-create-menu');
  const uMenu = document.getElementById('twilight-user-menu');
  if (sMenu) sMenu.classList.add('hidden');
  if (cMenu) cMenu.classList.add('hidden');
  if (uMenu) {
    uMenu.classList.toggle('hidden');
    if (!uMenu.classList.contains('hidden') && window.lucide) {
      lucide.createIcons();
    }
  }
}

function closeTwilightMenus() {
  const sMenu = document.getElementById('twilight-scope-menu');
  const cMenu = document.getElementById('twilight-create-menu');
  const uMenu = document.getElementById('twilight-user-menu');
  if (sMenu) sMenu.classList.add('hidden');
  if (cMenu) cMenu.classList.add('hidden');
  if (uMenu) uMenu.classList.add('hidden');
}

function openFeedbackModal() {
  const existing = document.getElementById('vercel-feedback-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'vercel-feedback-modal';
  modal.className = 'fixed inset-0 bg-black/75 backdrop-blur-sm z-[100] flex items-center justify-center p-4 modal-backdrop-enter';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="glass-card w-full max-w-md rounded-2xl shadow-2xl overflow-hidden modal-box-enter" onclick="event.stopPropagation()">
      <div class="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
        <h3 class="text-sm font-semibold text-slate-900 dark:text-white">Send Feedback</h3>
        <button onclick="document.getElementById('vercel-feedback-modal')?.remove()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <form onsubmit="handleFeedbackSubmit(event)" class="p-6 space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Your Feedback</label>
          <textarea id="feedback-textarea" required rows="4" class="w-full pitch-input rounded-xl px-3.5 py-2.5 text-xs focus:outline-none" placeholder="What can we improve about ZenStorage?"></textarea>
        </div>
        <div class="flex justify-between items-center text-xs text-slate-500">
          <span>We read all submissions.</span>
          <div class="flex gap-2">
            <button type="button" onclick="document.getElementById('vercel-feedback-modal')?.remove()" class="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 text-xs font-medium">Cancel</button>
            <button type="submit" class="zencloud-btn-primary px-4 py-1.5 rounded-lg text-xs">Send</button>
          </div>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
  setTimeout(() => document.getElementById('feedback-textarea')?.focus(), 50);
}

function handleFeedbackSubmit(e) {
  e.preventDefault();
  document.getElementById('vercel-feedback-modal')?.remove();
  showToast('Thank you for your feedback!', 'success');
}

function openChangelogModal() {
  const existing = document.getElementById('vercel-changelog-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'vercel-changelog-modal';
  modal.className = 'fixed inset-0 bg-black/75 backdrop-blur-sm z-[100] flex items-center justify-center p-4 modal-backdrop-enter';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="glass-card w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden modal-box-enter" onclick="event.stopPropagation()">
      <div class="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
        <h3 class="text-sm font-semibold text-slate-900 dark:text-white">Platform Updates</h3>
        <button onclick="document.getElementById('vercel-changelog-modal')?.remove()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar text-xs">
        <div class="space-y-1.5 border-b border-slate-200 dark:border-white/10 pb-3">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-slate-900 dark:text-white">Enterprise Cloud Console</span>
            <span class="text-blue-600 dark:text-blue-400 font-medium">Latest</span>
          </div>
          <p class="text-slate-600 dark:text-slate-400">Collapsible workspace sidebar, obsidian & light parity, live storage ring analytics, and drag-and-drop uploads.</p>
        </div>
        <div class="space-y-1.5 border-b border-slate-200 dark:border-white/10 pb-3">
          <div class="font-semibold text-slate-900 dark:text-white">S3 & Blob SDK Gateway</div>
          <p class="text-slate-600 dark:text-slate-400">AWS Signature v4 validation, multipart uploads, and direct inline CDN links.</p>
        </div>
        <div class="space-y-1.5">
          <div class="font-semibold text-slate-900 dark:text-white">Inbuilt Code Studio</div>
          <p class="text-slate-600 dark:text-slate-400">Multi-tab editor with live HTML/Markdown split preview and syntax highlighting.</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

function triggerNavbarFileUpload() {
  if (AppState.currentTab !== 'files') {
    AppState.currentTab = 'files';
    renderApp();
  }
  setTimeout(() => {
    const input = document.getElementById('file-upload-input');
    if (input) input.click();
  }, 100);
}

function openTwilightCommandPalette() {
  const existing = document.getElementById('twilight-command-palette');
  if (existing) {
    existing.classList.remove('hidden');
    const input = document.getElementById('twilight-cmd-input');
    if (input) { input.value = ''; input.focus(); filterTwilightCommands(''); }
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'twilight-command-palette';
  modal.className = 'fixed inset-0 bg-black/75 backdrop-blur-md z-[100] flex items-start justify-center pt-20 p-4 modal-backdrop-enter';
  modal.onclick = (e) => {
    if (e.target === modal) closeTwilightCommandPalette();
  };

  modal.innerHTML = `
    <div class="glass-card w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden modal-box-enter" onclick="event.stopPropagation()">
      <div class="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12]">
        <i data-lucide="search" class="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0"></i>
        <input id="twilight-cmd-input" type="text" placeholder="Type a destination, action, or command..." class="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none" oninput="filterTwilightCommands(this.value)">
        <kbd class="px-2 py-0.5 text-[11px] font-mono bg-white dark:bg-white/10 border border-slate-200 dark:border-white/15 rounded text-slate-500 dark:text-slate-300">ESC</kbd>
      </div>
      <div id="twilight-cmd-list" class="max-h-80 overflow-y-auto p-2 space-y-1 custom-scrollbar">
      </div>
      <div class="px-4 py-2.5 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span>Select a workspace destination or quick action</span>
        <span class="text-blue-600 dark:text-blue-400 font-semibold">ZenStorage Console</span>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();

  const input = document.getElementById('twilight-cmd-input');
  if (input) input.focus();
  filterTwilightCommands('');
}

function closeTwilightCommandPalette() {
  const modal = document.getElementById('twilight-command-palette');
  if (modal) modal.remove();
}

function filterTwilightCommands(query) {
  const list = document.getElementById('twilight-cmd-list');
  if (!list) return;
  const q = (query || '').toLowerCase().trim();

  const commands = [
    { title: 'Overview & Telemetry', desc: 'Storage usage, monthly bandwidth, and API activity', icon: 'layout-dashboard', color: 'text-blue-600 dark:text-blue-400', action: () => { AppState.pendingScrollTarget = null; navigateTab('dashboard'); closeTwilightCommandPalette(); } },
    { title: 'Files & Code Studio', desc: 'Browse, upload, preview, and edit workspace files', icon: 'folder', color: 'text-blue-600 dark:text-blue-400', action: () => { AppState.pendingScrollTarget = null; navigateTab('files'); closeTwilightCommandPalette(); } },
    { title: 'S3 & Blob Cluster', desc: 'Manage endpoints, test uploads, and inspect SDK snippets', icon: 'database', color: 'text-blue-600 dark:text-blue-400', action: () => { AppState.pendingScrollTarget = null; navigateTab('s3cluster'); closeTwilightCommandPalette(); } },
    { title: 'API Keys & Docs', desc: 'Create and revoke S3/Blob access tokens', icon: 'key', color: 'text-blue-600 dark:text-blue-400', action: () => { navigateTabToSection('s3cluster', 'api-keys-section'); closeTwilightCommandPalette(); } },
    { title: 'Share Links', desc: 'Manage active public share links and expirations', icon: 'share-2', color: 'text-blue-600 dark:text-blue-400', action: () => { AppState.pendingScrollTarget = null; navigateTab('shares'); closeTwilightCommandPalette(); } },
    { title: 'Settings & Security', desc: 'Update profile, password, and view usage policies', icon: 'settings', color: 'text-slate-600 dark:text-slate-300', action: () => { AppState.pendingScrollTarget = null; navigateTab('profile'); closeTwilightCommandPalette(); } },
    { title: 'Upload Files', desc: 'Upload local files to current directory', icon: 'upload-cloud', color: 'text-blue-600 dark:text-blue-400', action: () => { closeTwilightCommandPalette(); triggerNavbarFileUpload(); } },
    { title: 'Create New File', desc: 'Start a file in the built-in Code Studio', icon: 'file-plus', color: 'text-blue-600 dark:text-blue-400', action: () => { closeTwilightCommandPalette(); openCreateNewFileModal(); } },
    { title: 'Create New Folder', desc: 'Create a directory in current path', icon: 'folder-plus', color: 'text-blue-600 dark:text-blue-400', action: () => { closeTwilightCommandPalette(); openCreateFolderModal(); } },
    { title: 'Toggle Light / Dark Theme', desc: 'Switch between deep obsidian and crisp light mode', icon: 'sun', color: 'text-amber-500 dark:text-blue-400', action: () => { toggleDarkMode(); closeTwilightCommandPalette(); } },
  ];

  if (AppState.user && AppState.user.role === 'admin') {
    commands.push({ title: 'Admin Console & Terminal', desc: 'Manage users, storage limits, logs, and VPS console', icon: 'shield-alert', color: 'text-blue-600 dark:text-blue-400', action: () => { AppState.pendingScrollTarget = null; navigateTab('admin'); closeTwilightCommandPalette(); } });
  }

  const filtered = commands.filter(c => c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
  if (filtered.length === 0) {
    list.innerHTML = `<div class="p-6 text-center text-slate-500 text-xs">No matching actions found for "${escapeHtml(q)}"</div>`;
    return;
  }

  list.innerHTML = filtered.map((c, idx) => {
    window._cmdPaletteActions = window._cmdPaletteActions || {};
    window._cmdPaletteActions[idx] = c.action;
    return `
      <button onclick="window._cmdPaletteActions[${idx}]()" class="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 text-left transition-colors group">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-lg bg-slate-100 dark:bg-white/5 ${c.color} border border-slate-200 dark:border-white/10 group-hover:border-blue-500/40">
            <i data-lucide="${c.icon}" class="w-4 h-4"></i>
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">${escapeHtml(c.title)}</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtml(c.desc)}</div>
          </div>
        </div>
        <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all"></i>
      </button>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

window.addEventListener('click', (e) => {
  const cMenu = document.getElementById('twilight-create-menu');
  const cBtn = document.getElementById('twilight-create-btn');
  const uMenu = document.getElementById('twilight-user-menu');
  const uBtn = document.getElementById('twilight-user-btn');
  const sMenu = document.getElementById('twilight-scope-menu');
  const sBtn = document.getElementById('twilight-scope-btn');
  if (cMenu && !cMenu.contains(e.target) && !cBtn?.contains(e.target)) cMenu.classList.add('hidden');
  if (uMenu && !uMenu.contains(e.target) && !uBtn?.contains(e.target)) uMenu.classList.add('hidden');
  if (sMenu && !sMenu.contains(e.target) && !sBtn?.contains(e.target)) sMenu.classList.add('hidden');
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (AppState.token && AppState.user) openTwilightCommandPalette();
  }
  if (e.key === 'Escape') {
    closeTwilightCommandPalette();
    closeTwilightMenus();
  }
});

function navigateTab(tabName) {
  AppState.currentTab = tabName;
  AppState.isMobileSidebarOpen = false;
  renderApp();
}

function switchTab(tabName) {
  navigateTab(tabName);
}

function toggleDarkMode() {
  AppState.isDarkMode = !AppState.isDarkMode;
  AppState.theme = AppState.isDarkMode ? 'dark' : 'light';
  localStorage.setItem('vps_theme', AppState.theme);
  document.documentElement.classList.toggle('dark', AppState.isDarkMode);
  document.documentElement.classList.toggle('light', !AppState.isDarkMode);
  renderApp();
}

function renderStorageOveruseBanner(user) {
  const header = document.getElementById('main-header');
  if (!header) return;
  let el = document.getElementById('storage-overuse-banner');
  const used = Number(user?.usedStorageBytes || 0);
  const quota = Number(user?.storage_quota_bytes || 0);
  const over = used > quota;
  if (!over) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'storage-overuse-banner'; header.appendChild(el); }
  el.innerHTML = `<div class="mt-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 flex items-start gap-3">
    <div class="mt-0.5 text-red-500 dark:text-red-400 shrink-0"><i data-lucide="triangle-alert" class="w-4 h-4"></i></div>
    <div class="text-xs"><div class="font-semibold text-red-700 dark:text-red-200">Storage quota exceeded</div>
    <div class="text-red-600/90 dark:text-red-200/80 mt-0.5 tabular-nums">Using ${escapeHtml(formatBytes(used))} of ${escapeHtml(formatBytes(quota))}. Free up space to prevent upload restrictions.</div></div>
  </div>`;
  if (window.lucide) lucide.createIcons();
}

function renderEmailVerificationBanner() {
  const el = document.getElementById('email-verification-banner');
  if (!el) return;
  if (!AppState.user || AppState.user.emailVerified) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <div class="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
      <div class="flex items-start gap-3 min-w-0">
        <div class="mt-0.5 text-amber-600 dark:text-amber-400 shrink-0"><i data-lucide="triangle-alert" class="w-4 h-4"></i></div>
        <div class="min-w-0 text-xs">
          <div class="font-semibold text-amber-800 dark:text-amber-200">Verify your email address</div>
          <div class="text-amber-700/80 dark:text-amber-200/75 mt-0.5 break-words">${escapeHtml(AppState.user.email)} · Required before uploading files.</div>
        </div>
      </div>
      <div class="shrink-0">
        <button onclick="resendVerificationEmail()" id="resend-verify-header" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs px-3.5 py-2 rounded-lg whitespace-nowrap">Resend Verification</button>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

async function resendVerificationEmail() {
  const btn = document.getElementById('resend-verify-header');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try {
    const data = await apiRequest('/auth/email/resend-verification', { method: 'POST' });
    showToast(data.message, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Resend Verify Email'; }
  }
}

async function updateQuotaWidget() {
  const requestId = ++AppState.quotaRequestId;
  try {
    const profile = await apiRequest('/auth/profile');
    // Ignore an older response that arrived after a newer request.
    if (requestId !== AppState.quotaRequestId) return;
    AppState.user.usedStorageBytes = profile.user.usedStorageBytes;
    AppState.user.storage_quota_bytes = profile.user.storage_quota_bytes;
    AppState.user.emailVerified = !!profile.user.emailVerified;
    localStorage.setItem('vps_user', JSON.stringify(AppState.user));
    renderEmailVerificationBanner();
    renderStorageOveruseBanner(profile.user);

    const used = Math.max(0, Number(profile.user.usedStorageBytes) || 0);
    const total = Math.max(1, Number(profile.user.storage_quota_bytes) || 10737418240);
    const percent = Math.min(100, Math.round((used / total) * 100));

    const qBar = document.getElementById('quota-bar');
    const qPercentText = document.getElementById('quota-percent-text');
    const qDetailText = document.getElementById('quota-detail-text');

    if (qBar) qBar.style.width = `${percent}%`;
    if (qPercentText) qPercentText.innerText = `${percent}%`;
    if (qDetailText) qDetailText.innerText = `${formatBytes(used)} / ${formatBytes(total)}`;
    AppState.displayedQuotaPercent = percent;
  } catch (e) {}
}

function renderTabContent() {
  const area = document.getElementById('tab-content-area');
  if (!area) return;

  // Smooth entrance animation
  area.classList.remove('tab-pane-enter');
  void area.offsetWidth; // trigger reflow
  area.classList.add('tab-pane-enter');

  if (AppState.currentTab === 'dashboard') {
    renderDashboardTab(area);
  } else if (AppState.currentTab === 'files') {
    renderFileManagerTab(area);
  } else if (AppState.currentTab === 's3cluster') {
    renderS3ClusterTab(area);
  } else if (AppState.currentTab === 'shares') {
    renderShareLinksTab(area);
  } else if (AppState.currentTab === 'profile') {
    renderProfileTab(area);
  } else if (AppState.currentTab === 'admin') {
    renderAdminPortalTab(area);
  }
}

// ==========================================
// 3. FILE MANAGER COMPONENT (Upload, Operations, Compression)
// ==========================================
async function renderFileManagerTab(container) {
  const isAdmin = AppState.user && AppState.user.role === 'admin';
  const isInspecting = isAdmin && Boolean(AppState.targetUserId);
  const targetLabel = AppState.targetUser ? (AppState.targetUser.username || AppState.targetUser.name || `User #${AppState.targetUserId}`) : `User #${AppState.targetUserId}`;

  container.innerHTML = `
    <div class="space-y-4 w-full max-w-full min-w-0">
      ${isAdmin ? `
        <div class="w-full max-w-full min-w-0 p-4 rounded-xl border ${isInspecting ? 'bg-amber-500/10 border-amber-500/30' : 'glass-card'} space-y-3 overflow-hidden box-border">
          <div class="flex items-start gap-3 min-w-0 w-full">
            <div class="w-9 h-9 rounded-lg ${isInspecting ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'zencloud-logo-badge'} flex items-center justify-center shrink-0">
              <i data-lucide="${isInspecting ? 'user-check' : 'shield'}" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2 min-w-0 text-xs">
                <span class="font-semibold text-slate-900 dark:text-white shrink-0">Admin Directory Scope:</span>
                <span class="font-mono font-semibold ${isInspecting ? 'text-amber-600 dark:text-amber-300' : 'text-blue-600 dark:text-blue-400'} truncate">
                  ${isInspecting ? `Inspecting User #${AppState.targetUserId} (${escapeHtml(targetLabel)})` : 'My Personal Storage (Self)'}
                </span>
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 break-words">
                ${isInspecting
                  ? `Full administrative access to ${escapeHtml(targetLabel)}'s directory.`
                  : 'Switch to any registered user workspace to inspect or manage their stored objects.'}
              </p>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2.5 border-t border-slate-200 dark:border-white/10 min-w-0 w-full">
            <div class="relative flex-1 min-w-0 w-full">
              <select id="admin-user-directory-select" onchange="handleAdminUserDirectoryChange(this.value)" class="w-full min-w-0 pitch-input rounded-lg px-3 py-2 text-xs truncate cursor-pointer focus:outline-none">
                <option value="">My Admin Directory (Self)</option>
              </select>
            </div>
            ${isInspecting ? `
              <button onclick="resetAdminUserDirectory()" class="w-full sm:w-auto shrink-0 justify-center px-3.5 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#16161e] text-slate-700 dark:text-slate-200 hover:border-blue-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap">
                <i data-lucide="corner-up-left" class="w-3.5 h-3.5 shrink-0"></i>
                <span>Exit to My Storage</span>
              </button>
            ` : ''}
          </div>
        </div>
      ` : ''}

      <!-- Unified Action Toolbar -->
      <div class="flex flex-wrap items-center justify-between gap-3 glass-card p-3.5 rounded-xl w-full max-w-full min-w-0">
        <div class="flex flex-wrap items-center gap-2 min-w-0">
          <label class="zencloud-btn-primary text-xs px-3.5 py-2 rounded-lg cursor-pointer flex items-center gap-2 whitespace-nowrap shrink-0">
            <i data-lucide="upload-cloud" class="w-4 h-4"></i> Upload Files
            <input type="file" id="file-upload-input" multiple onchange="handleFileUpload(event)" class="hidden">
          </label>

          <button onclick="openCreateNewFileModal()" class="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-800 dark:text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-2 transition-colors border border-slate-200 dark:border-white/10 whitespace-nowrap shrink-0" title="Create New File">
            <i data-lucide="file-plus" class="w-4 h-4 text-blue-500"></i> New File
          </button>

          <button onclick="openCreateFolderModal()" class="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-800 dark:text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-2 transition-colors border border-slate-200 dark:border-white/10 whitespace-nowrap shrink-0">
            <i data-lucide="folder-plus" class="w-4 h-4 text-blue-500"></i> New Folder
          </button>

          <button id="file-refresh-button" onclick="refreshFileManager()" class="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 p-2 rounded-lg transition-colors border border-slate-200 dark:border-white/10 disabled:opacity-50 disabled:cursor-not-allowed shrink-0" title="Refresh">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
          </button>
        </div>

        <div id="bulk-actions" class="hidden flex flex-wrap items-center gap-2 min-w-0">
          <button onclick="handleBulkDelete()" class="bg-red-500/10 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors border border-red-500/25 whitespace-nowrap">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete (<span id="selected-count">0</span>)
          </button>
          <button onclick="openCompressModal()" class="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors border border-slate-200 dark:border-white/10 whitespace-nowrap">
            <i data-lucide="archive" class="w-3.5 h-3.5"></i> Compress
          </button>
          <button onclick="openMoveSelectedPrompt()" class="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors border border-slate-200 dark:border-white/10 whitespace-nowrap">
            <i data-lucide="folder-input" class="w-3.5 h-3.5"></i> Move
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end min-w-0">
          <div class="relative flex-1 sm:flex-initial min-w-[160px]">
            <i data-lucide="search" class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
            <input type="text" id="file-search-input" value="${escapeHtml(AppState.searchQuery || '')}" oninput="handleFileSearch(event)" placeholder="Filter directory..." class="w-full sm:w-44 pitch-input rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none">
          </div>

          <select id="file-sort-select" onchange="handleFileSortChange(this.value)" class="pitch-input rounded-lg px-2.5 py-1.5 text-xs focus:outline-none cursor-pointer">
            <option value="name-asc" ${AppState.sortBy === 'name-asc' ? 'selected' : ''}>Name (A–Z)</option>
            <option value="name-desc" ${AppState.sortBy === 'name-desc' ? 'selected' : ''}>Name (Z–A)</option>
            <option value="size-desc" ${AppState.sortBy === 'size-desc' ? 'selected' : ''}>Size (Largest)</option>
            <option value="mtime-desc" ${AppState.sortBy === 'mtime-desc' ? 'selected' : ''}>Modified (Newest)</option>
          </select>

          <div class="flex bg-slate-100 dark:bg-[#09090b] p-0.5 rounded-lg border border-slate-200 dark:border-white/10 shrink-0" id="file-view-toggle-group">
            <button id="view-mode-grid-btn" onclick="setFileViewMode('grid')" class="p-1.5 rounded-md transition-all ${AppState.viewMode === 'grid' ? 'bg-blue-600 text-white font-semibold shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}" title="Grid View">
              <i data-lucide="grid" class="w-4 h-4"></i>
            </button>
            <button id="view-mode-list-btn" onclick="setFileViewMode('list')" class="p-1.5 rounded-md transition-all ${AppState.viewMode === 'list' ? 'bg-blue-600 text-white font-semibold shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}" title="List View">
              <i data-lucide="list" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Remote File Ingestion (Wget) -->
      <div class="glass-card p-4 rounded-xl">
        <div class="flex items-start gap-3 mb-3">
          <div class="w-8 h-8 rounded-lg zencloud-logo-badge shrink-0">
            <i data-lucide="cloud-download" class="w-4 h-4"></i>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-slate-900 dark:text-white">Remote URL Ingestion</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Fetch files directly into this directory via background server transfer.</p>
          </div>
        </div>
        <form onsubmit="startUrlDownload(event)" class="grid grid-cols-1 lg:grid-cols-[1fr_220px_auto] gap-2">
          <input id="url-download-link" type="url" required placeholder="https://example.com/archive.zip" class="w-full pitch-input rounded-lg px-3 py-2 text-xs focus:outline-none">
          <input id="url-download-filename" type="text" placeholder="Custom filename (optional)" maxlength="240" class="w-full pitch-input rounded-lg px-3 py-2 text-xs focus:outline-none">
          <button type="submit" class="zencloud-btn-primary text-xs px-4 py-2 rounded-lg flex items-center justify-center gap-2 whitespace-nowrap">
            <i data-lucide="download" class="w-3.5 h-3.5"></i> Start Fetch
          </button>
        </form>
        <div id="url-download-jobs" class="mt-3"></div>
      </div>

      <!-- Breadcrumbs Path Navigator -->
      <div id="file-breadcrumbs" class="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 glass-card px-4 py-2.5 rounded-xl overflow-x-auto whitespace-nowrap custom-scrollbar max-w-full"></div>

      <!-- Upload Progress Container -->
      <div id="upload-progress-container" class="hidden glass-card p-4 rounded-xl border border-blue-500/30">
        <div class="flex justify-between text-xs font-semibold text-slate-900 dark:text-white mb-1.5">
          <span id="upload-status-text">Uploading files...</span>
          <span id="upload-percentage" class="font-mono tabular-nums text-blue-600 dark:text-blue-400">0%</span>
        </div>
        <div class="w-full bg-slate-200 dark:bg-white/10 h-2 rounded-full overflow-hidden">
          <div id="upload-progress-bar" class="bg-blue-600 dark:bg-blue-500 h-full transition-all" style="width: 0%"></div>
        </div>
      </div>

      <!-- Drag & Drop File Explorer Surface -->
      <div id="file-dropzone-wrapper" class="relative rounded-xl transition-all">
        <div id="file-dropzone-hint" class="hidden pointer-events-none absolute inset-0 z-20 rounded-xl border-2 border-dashed border-blue-500 bg-blue-500/10 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 text-blue-600 dark:text-blue-300">
          <i data-lucide="upload-cloud" class="w-8 h-8"></i>
          <span class="text-sm font-semibold">Drop files to upload to ${escapeHtml(AppState.currentPath || '/')}</span>
        </div>
        <div id="file-list-container" class="min-h-[300px]">
          <div class="flex items-center justify-center p-12 text-slate-500 text-xs">
            <i data-lucide="loader-2" class="w-5 h-5 animate-spin mr-2 text-blue-500"></i> Loading directory...
          </div>
        </div>
      </div>
    </div>
  `;

  setupFileDropzone();
  updateFileRefreshButton();
  fetchFileList();
  loadUrlDownloadJobs();
  if (isAdmin) {
    loadAdminUserDirectoryDropdown();
  }
  if (window.lucide) lucide.createIcons();
}

function setupFileDropzone() {
  const wrapper = document.getElementById('file-dropzone-wrapper');
  const hint = document.getElementById('file-dropzone-hint');
  if (!wrapper || wrapper.dataset.dropReady) return;
  wrapper.dataset.dropReady = '1';
  let dragDepth = 0;

  wrapper.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    wrapper.classList.add('dropzone-active');
    if (hint) hint.classList.remove('hidden');
  });
  wrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  wrapper.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      wrapper.classList.remove('dropzone-active');
      if (hint) hint.classList.add('hidden');
    }
  });
  wrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    wrapper.classList.remove('dropzone-active');
    if (hint) hint.classList.add('hidden');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      uploadFilesList(files);
    }
  });
}

async function fetchFileList({ clearSelection = true } = {}) {
  try {
    const cacheBust = Date.now();
    let url = `/files/list?path=${encodeURIComponent(AppState.currentPath)}&_=${cacheBust}`;
    if (AppState.user && AppState.user.role === 'admin' && AppState.targetUserId) {
      url += `&targetUserId=${encodeURIComponent(AppState.targetUserId)}`;
    }
    const data = await apiRequest(url);
    AppState.files = Array.isArray(data.files) ? data.files : [];
    if (clearSelection) AppState.selectedPaths = [];
    renderBreadcrumbs(data.currentPath || AppState.currentPath);
    renderFileItems();
    updateBulkActionVisibility();
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

function updateFileRefreshButton() {
  const button = document.getElementById('file-refresh-button');
  if (!button) return;

  const remaining = Math.max(0, AppState.fileRefreshLockedUntil - Date.now());
  if (remaining > 0) {
    button.disabled = true;
    button.title = `Refresh available in ${Math.ceil(remaining / 1000)}s`;
  } else {
    button.disabled = false;
    button.title = 'Refresh';
    if (AppState.fileRefreshCountdownTimer) {
      clearInterval(AppState.fileRefreshCountdownTimer);
      AppState.fileRefreshCountdownTimer = null;
    }
  }
}

function startFileRefreshCooldown() {
  AppState.fileRefreshLockedUntil = Date.now() + 10000;
  updateFileRefreshButton();
  if (AppState.fileRefreshCountdownTimer) clearInterval(AppState.fileRefreshCountdownTimer);
  AppState.fileRefreshCountdownTimer = setInterval(() => {
    updateFileRefreshButton();
    if (Date.now() >= AppState.fileRefreshLockedUntil) {
      clearInterval(AppState.fileRefreshCountdownTimer);
      AppState.fileRefreshCountdownTimer = null;
    }
  }, 250);
}

async function refreshFileManager() {
  const button = document.getElementById('file-refresh-button');
  if (!button || button.disabled || Date.now() < AppState.fileRefreshLockedUntil) {
    updateFileRefreshButton();
    return;
  }

  button.disabled = true;
  button.classList.add('opacity-60', 'cursor-wait');
  const spinUntil = Date.now() + 1000;
  const spinTimer = window.setInterval(() => {
    const currentButton = document.getElementById('file-refresh-button');
    const currentIcon = currentButton?.querySelector('svg');
    if (currentIcon) currentIcon.classList.toggle('animate-spin', Date.now() < spinUntil);
    if (Date.now() >= spinUntil) {
      window.clearInterval(spinTimer);
      currentIcon?.classList.remove('animate-spin');
      currentButton?.classList.remove('cursor-wait');
    }
  }, 100);
  startFileRefreshCooldown();

  try {
    await fetchFileList({ clearSelection: true });
    showToast('File list refreshed.', 'success');
  } catch (_) {
    // fetchFileList already shows the error toast.
  } finally {
    window.setTimeout(() => {
      const currentButton = document.getElementById('file-refresh-button');
      currentButton?.querySelector('svg')?.classList.remove('animate-spin');
      currentButton?.classList.remove('opacity-60', 'cursor-wait');
      updateFileRefreshButton();
    }, 1000);
  }
}

function renderBreadcrumbs(currentPath) {
  const container = document.getElementById('file-breadcrumbs');
  if (!container) return;

  const parts = currentPath.split('/').filter(Boolean);
  let html = `<button onclick="navigateToPath('/')" class="hover:text-black dark:hover:text-white font-semibold flex items-center gap-1"><i data-lucide="home" class="w-3.5 h-3.5"></i> Root</button>`;

  let accumPath = '';
  parts.forEach((p, idx) => {
    accumPath += '/' + p;
    const target = accumPath;
    html += ` <span class="text-slate-400 dark:text-slate-600">/</span> <button onclick="navigateToPath(decodeURIComponent('${encodeURIComponent(target)}'))" class="hover:text-black dark:hover:text-white font-semibold">${escapeHtml(p)}</button>`;
  });

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function navigateToPath(targetPath) {
  AppState.currentPath = targetPath;
  fetchFileList();
}

function handleFileSortChange(val) {
  AppState.sortBy = val || 'name-asc';
  localStorage.setItem('vps_sort_by', AppState.sortBy);
  renderFileItems();
}

function renderFileItems() {
  const container = document.getElementById('file-list-container');
  if (!container) return;

  const query = (AppState.searchQuery || '').toLowerCase();
  const filtered = AppState.files
    .filter(f => f.name.toLowerCase().includes(query))
    .slice()
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      switch (AppState.sortBy) {
        case 'name-desc':
          return String(b.name).localeCompare(String(a.name));
        case 'size-desc':
          return (Number(b.size) || 0) - (Number(a.size) || 0);
        case 'mtime-desc':
          return new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime();
        case 'name-asc':
        default:
          return String(a.name).localeCompare(String(b.name));
      }
    });

  if (filtered.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center p-16 text-center text-slate-500 glass-card rounded-xl">
        <i data-lucide="folder-open" class="w-10 h-10 mb-3 text-slate-400 opacity-70"></i>
        <p class="text-sm font-semibold text-slate-900 dark:text-white">${query ? 'No matching files found' : 'This directory is empty'}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${query ? 'Try a different filter or clear search.' : 'Drag and drop files here, or upload to get started.'}</p>
        <button onclick="triggerNavbarFileUpload()" class="mt-4 zencloud-btn-primary px-4 py-2 rounded-lg text-xs inline-flex items-center gap-1.5">
          <i data-lucide="upload-cloud" class="w-4 h-4"></i> Upload Files
        </button>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (AppState.viewMode === 'grid') {
    container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5';
    container.innerHTML = filtered.map(file => {
      const isSelected = AppState.selectedPaths.includes(file.path);
      const icon = file.isDirectory ? 'folder' : getFileIcon(file.name);
      const iconColor = file.isDirectory ? 'text-blue-500' : 'text-slate-600 dark:text-slate-300';
      const encodedPath = encodeURIComponent(file.path);

      return `
        <div class="file-grid-card p-4 rounded-xl relative group cursor-pointer ${isSelected ? 'ring-2 ring-blue-500 bg-blue-500/10' : ''}" onclick="toggleSelectFile(decodeURIComponent('${encodedPath}'), event)">
          <div class="flex items-center justify-between mb-3">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelectFile(decodeURIComponent('${encodedPath}'))" class="w-4 h-4 rounded border-slate-300 dark:border-slate-700 accent-blue-600 cursor-pointer">
            <button onclick="event.stopPropagation(); openFileContextMenu(decodeURIComponent('${encodedPath}'), ${file.isDirectory ? 'true' : 'false'}, event)" class="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-opacity">
              <i data-lucide="more-vertical" class="w-4 h-4"></i>
            </button>
          </div>
          <div class="flex flex-col items-center text-center" onclick="event.stopPropagation(); ${file.isDirectory ? `navigateToPath(decodeURIComponent('${encodedPath}'))` : `handleFileClick(decodeURIComponent('${encodedPath}'))`}">
            <i data-lucide="${icon}" class="w-9 h-9 ${iconColor} mb-2"></i>
            <div class="text-xs font-semibold text-slate-900 dark:text-white truncate w-full" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
            <div class="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-1">${file.isDirectory ? 'Folder' : formatBytes(file.size)}</div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    container.className = 'glass-card rounded-xl overflow-hidden divide-y divide-slate-200 dark:divide-white/5';
    container.innerHTML = `
      <div class="px-4 py-2.5 bg-slate-50 dark:bg-[#0d0d12] flex items-center text-xs font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">
        <span class="w-8"></span>
        <span class="flex-1">Name</span>
        <span class="w-32 text-right pr-4">Size</span>
        <span class="w-36 text-right pr-4 hidden sm:inline">Modified</span>
        <span class="w-16 text-right">Actions</span>
      </div>
      ${filtered.map(file => {
        const isSelected = AppState.selectedPaths.includes(file.path);
        const icon = file.isDirectory ? 'folder' : getFileIcon(file.name);
        const iconColor = file.isDirectory ? 'text-blue-500' : 'text-slate-600 dark:text-slate-300';
        const encodedPath = encodeURIComponent(file.path);

        return `
          <div class="file-list-row px-4 py-2.5 flex items-center text-xs ${isSelected ? 'bg-blue-500/10' : ''}">
            <div class="w-8 shrink-0">
              <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="toggleSelectFile(decodeURIComponent('${encodedPath}'))" class="w-4 h-4 rounded border-slate-300 dark:border-slate-700 accent-blue-600 cursor-pointer">
            </div>
            <div class="flex-1 min-w-0 flex items-center gap-2.5 cursor-pointer" onclick="${file.isDirectory ? `navigateToPath(decodeURIComponent('${encodedPath}'))` : `handleFileClick(decodeURIComponent('${encodedPath}'))`}">
              <i data-lucide="${icon}" class="w-4 h-4 ${iconColor} shrink-0"></i>
              <span class="font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate">${escapeHtml(file.name)}</span>
            </div>
            <span class="w-32 text-right pr-4 font-mono tabular-nums text-slate-600 dark:text-slate-400 shrink-0">${file.isDirectory ? '—' : formatBytes(file.size)}</span>
            <span class="w-36 text-right pr-4 font-mono tabular-nums text-slate-500 dark:text-slate-400 hidden sm:inline shrink-0">${file.mtime ? new Date(file.mtime).toLocaleDateString() : '—'}</span>
            <div class="w-16 text-right shrink-0">
              <button onclick="event.stopPropagation(); openFileContextMenu(decodeURIComponent('${encodedPath}'), ${file.isDirectory ? 'true' : 'false'}, event)" class="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors" title="Options">
                <i data-lucide="more-vertical" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    `;
  }
  if (window.lucide) lucide.createIcons();
}

function getFileIcon(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archive';
  if (['mp4', 'mkv', 'avi', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac'].includes(ext)) return 'music';
  if (['pdf'].includes(ext)) return 'file-text';
  if (['js', 'ts', 'html', 'css', 'json', 'py', 'sh'].includes(ext)) return 'code';
  return 'file';
}

function updateBulkActionVisibility() {
  const bulkDiv = document.getElementById('bulk-actions');
  const countSpan = document.getElementById('selected-count');
  if (!bulkDiv) return;
  if (AppState.selectedPaths.length > 0) {
    bulkDiv.classList.remove('hidden');
    if (countSpan) countSpan.innerText = AppState.selectedPaths.length;
  } else {
    bulkDiv.classList.add('hidden');
    if (countSpan) countSpan.innerText = '0';
  }
}

function toggleSelectFile(filePath) {
  const idx = AppState.selectedPaths.indexOf(filePath);
  if (idx > -1) {
    AppState.selectedPaths.splice(idx, 1);
  } else {
    AppState.selectedPaths.push(filePath);
  }
  updateBulkActionVisibility();
  renderFileItems();
}

function setFileViewMode(mode) {
  AppState.viewMode = mode;
  localStorage.setItem('vps_view_mode', mode);
  const gridBtn = document.getElementById('view-mode-grid-btn');
  const listBtn = document.getElementById('view-mode-list-btn');
  if (gridBtn && listBtn) {
    const active = 'p-1.5 rounded-md transition-all bg-blue-600 text-white font-semibold shadow-sm';
    const inactive = 'p-1.5 rounded-md transition-all text-slate-500 hover:text-slate-900 dark:hover:text-white';
    gridBtn.className = mode === 'grid' ? active : inactive;
    listBtn.className = mode === 'list' ? active : inactive;
  }
  renderFileItems();
}

function handleFileSearch(e) {
  AppState.searchQuery = e.target.value;
  renderFileItems();
}

async function uploadFilesList(files) {
  if (!files || files.length === 0) return;
  const formData = new FormData();
  formData.append('targetDir', AppState.currentPath);
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }
  const progContainer = document.getElementById('upload-progress-container');
  const progBar = document.getElementById('upload-progress-bar');
  const progPct = document.getElementById('upload-percentage');
  if (progContainer) progContainer.classList.remove('hidden');
  if (progBar) progBar.style.width = '0%';
  if (progPct) progPct.innerText = '0%';

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload', true);
    if (AppState.token) xhr.setRequestHeader('Authorization', `Bearer ${AppState.token}`);
    if (AppState.user && AppState.user.role === 'admin' && AppState.targetUserId) {
      xhr.setRequestHeader('x-target-user-id', String(AppState.targetUserId));
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        if (progBar) progBar.style.width = `${percent}%`;
        if (progPct) progPct.innerText = `${percent}%`;
      }
    };
    xhr.onload = () => {
      if (progContainer) progContainer.classList.add('hidden');
      if (xhr.status === 200) {
        showToast('Files uploaded successfully!', 'success');
        fetchFileList();
        updateQuotaWidget();
      } else {
        const res = JSON.parse(xhr.responseText || '{}');
        showToast(res.error || 'Upload failed', 'error');
      }
    };
    xhr.send(formData);
  } catch (err) {
    if (progContainer) progContainer.classList.add('hidden');
    showToast(err.message, 'error');
  }
}

async function handleFileUpload(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  await uploadFilesList(files);
  e.target.value = '';
}

// ==========================================
// 4. MODALS & CONTEXT MENUS (Create Folder, Share Link, Extract)
// ==========================================
function openCreateFolderModal() {
  const name = prompt('Enter new folder name:');
  if (!name || !name.trim()) return;

  const targetPath = AppState.currentPath.endsWith('/')
    ? AppState.currentPath + name.trim()
    : AppState.currentPath + '/' + name.trim();

  apiRequest('/files/create-folder', {
    method: 'POST',
    body: { path: targetPath }
  })
  .then(() => {
    showToast('Folder created!', 'success');
    fetchFileList();
  })
  .catch(err => showToast(err.message, 'error'));
}

// ==========================================
// 4b. INBUILT MULTI-FILE CODE & TEXT EDITOR
// Supports .html, .txt, .js, .css, .json, .md, .sh, .py, .sql, .yaml, etc.
// With Live HTML & Markdown Preview, Code Formatting, Syntax Modes
// ==========================================

const EDITABLE_EXTENSIONS = [
  'html', 'htm', 'txt', 'text', 'log', 'env', 'ini', 'conf', 'cfg',
  'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx',
  'css', 'scss', 'less',
  'json', 'json5',
  'md', 'markdown',
  'xml', 'svg',
  'sh', 'bash', 'zsh',
  'sql',
  'py', 'php', 'rb',
  'yaml', 'yml',
  'dockerfile', 'dockerignore', 'gitignore'
];

function isEditableFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const fileName = filePath.split('/').pop().toLowerCase();
  if (fileName === 'dockerfile' || fileName.startsWith('.env') || fileName.startsWith('.git') || fileName.endsWith('rc')) return true;
  const ext = fileName.includes('.') ? fileName.split('.').pop() : '';
  return EDITABLE_EXTENSIONS.includes(ext);
}

function getFileExtension(filePath) {
  if (!filePath) return '';
  const fileName = filePath.split('/').pop().toLowerCase();
  return fileName.includes('.') ? fileName.split('.').pop() : '';
}

function detectAceMode(filePath) {
  const ext = getFileExtension(filePath);
  const name = (filePath.split('/').pop() || '').toLowerCase();
  if (ext === 'html' || ext === 'htm') return 'html';
  if (['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx'].includes(ext)) return 'javascript';
  if (['css', 'scss', 'less'].includes(ext)) return 'css';
  if (['json', 'json5'].includes(ext)) return 'json';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (['xml', 'svg'].includes(ext)) return 'xml';
  if (['sh', 'bash', 'zsh'].includes(ext) || name === 'dockerfile') return 'sh';
  if (ext === 'sql') return 'sql';
  if (ext === 'py') return 'python';
  if (['yaml', 'yml'].includes(ext)) return 'yaml';
  return 'text';
}

function getFriendlyFileTypeName(filePath) {
  const mode = detectAceMode(filePath);
  const map = {
    html: 'HTML5 Web Page',
    javascript: 'JavaScript / TypeScript',
    css: 'CSS Stylesheet',
    json: 'JSON Data',
    markdown: 'Markdown Document',
    xml: 'XML / SVG Vector',
    sh: 'Shell Script',
    sql: 'SQL Database Script',
    python: 'Python Script',
    yaml: 'YAML Configuration',
    text: 'Plain Text File'
  };
  return map[mode] || 'Text Document';
}

function handleFileClick(filePath) {
  if (isEditableFile(filePath)) {
    openFileEditor(filePath);
  } else {
    openFilePreview(filePath);
  }
}

let activeAceInstance = null;
let livePreviewDebounceTimer = null;
let activeEditorPath = '';
let activeEditorOriginalContent = '';
let activeEditorIsDirty = false;
let activeEditorViewMode = 'code'; // 'code', 'split', 'preview'
let activeEditorMode = 'text';
let activeEditorFontSize = 14;
let activeEditorWrap = true;

const FILE_STARTER_PRESETS = {
  html: {
    name: 'index.html',
    desc: 'HTML5 Web Document with modern starter boilerplate',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZenStorage Webpage</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 2.5rem 1.5rem;
      background: #000000;
      color: #ffffff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 80vh;
      text-align: center;
    }
    .hero-card {
      background: #080808;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 1.25rem;
      padding: 2.5rem 3rem;
      box-shadow: 0 12px 36px -8px rgba(0, 0, 0, 0.9);
      max-width: 540px;
    }
    h1 {
      color: #ffffff;
      margin-top: 0;
      font-size: 2rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    p { color: #a3a3a3; line-height: 1.6; }
    .badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.25);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }
    .action-btn {
      background: #ffffff;
      color: #000000;
      border: 0;
      padding: 0.75rem 1.75rem;
      border-radius: 0.75rem;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(255, 255, 255, 0.3);
      transition: all 0.2s;
    }
    .action-btn:hover {
      background: #e5e5e5;
      transform: translateY(-1px);
    }
  </style>
</head>
<body>
  <div class="hero-card">
    <div class="badge">🚀 Built with ZenStorage Editor</div>
    <h1>Hello World!</h1>
    <p>This page is hosted on ZenStorage VPS Cloud and edited with the inbuilt live editor.</p>
    <button class="action-btn" onclick="alert('Hello from ZenStorage!')">Click Me</button>
  </div>
</body>
</html>`
  },
  text: {
    name: 'notes.txt',
    desc: 'Plain text file for quick notes, logs, or keys',
    content: `ZenStorage Storage - Project Notes\nCreated: ${new Date().toLocaleString()}\n\n- File created with the ZenStorage Inbuilt Editor\n- Add your notes, documentation, or lists here.\n`
  },
  javascript: {
    name: 'app.js',
    desc: 'Modern JavaScript application module',
    content: `// ZenStorage Application Script\nconsole.log('ZenStorage app module initialized at:', new Date().toISOString());\n\nfunction main() {\n  console.log('Running main process...');\n}\n\nmain();\n`
  },
  css: {
    name: 'style.css',
    desc: 'CSS Stylesheet with modern design tokens',
    content: `/* ZenStorage Stylesheet */\n:root {\n  --primary: #ffffff;\n  --bg-dark: #000000;\n  --card-bg: #080808;\n  --text-main: #ffffff;\n}\n\nbody {\n  background: var(--bg-dark);\n  color: var(--text-main);\n  font-family: system-ui, -apple-system, sans-serif;\n  margin: 0;\n  padding: 1.5rem;\n}\n`
  },
  json: {
    name: 'config.json',
    desc: 'JSON Configuration document with formatted object',
    content: `{\n  "serviceName": "zenstorage-instance",\n  "version": "1.0.0",\n  "environment": "production",\n  "storage": {\n    "enabled": true,\n    "protocol": "sftp",\n    "features": [\n      "inbuilt-editor",\n      "live-preview",\n      "s3-cluster"\n    ]\n  }\n}\n`
  },
  markdown: {
    name: 'README.md',
    desc: 'Markdown Documentation with formatted headings and lists',
    content: `# Project Documentation\n\nWelcome to your project hosted on **ZenStorage**.\n\n## 🌟 Features\n- **Inbuilt Code & Text Editor** with syntax highlighting for HTML, JS, CSS, JSON, Markdown, and more.\n- **Real-Time Live HTML & Markdown Preview** split screen.\n- **Secure SFTP Storage** with granular quota management.\n- **AWS S3 & Vercel Blob API Cluster** compatibility.\n\n## 🛠 Quick Start\n1. Edit this file or create your own \`.html\` and \`.txt\` files.\n2. Preview changes live side-by-side.\n3. Save with \`Ctrl + S\`.\n`
  },
  sh: {
    name: 'deploy.sh',
    desc: 'Bash Shell script with execution safeguards',
    content: `#!/usr/bin/env bash\nset -euo pipefail\n\necho "=== ZenStorage Deployment Script ==="\necho "Timestamp: $(date)"\necho "Deployment completed successfully!"\n`
  }
};

function openCreateNewFileModal() {
  const existing = document.getElementById('zencloud-new-file-modal') || document.getElementById('zenova-new-file-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'zencloud-new-file-modal';
  modal.className = 'fixed inset-0 bg-black/75 backdrop-blur-sm z-[90] flex items-center justify-center p-4 modal-backdrop-enter';
  modal.onclick = (e) => { if (e.target === modal) closeNewFileModal(); };
  modal.innerHTML = `
    <div class="glass-card w-full max-w-xl rounded-2xl p-6 shadow-2xl modal-box-enter" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-5 pb-4 border-b border-slate-200 dark:border-white/10">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl zencloud-logo-badge"><i data-lucide="file-plus" class="w-5 h-5"></i></div>
          <div>
            <h3 class="font-bold text-base text-slate-900 dark:text-white">Create New File</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">Choose a starter preset or enter any custom file extension</p>
          </div>
        </div>
        <button onclick="closeNewFileModal()" class="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>

      <div class="mb-5">
        <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">Starter Templates</label>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button type="button" onclick="selectNewFilePreset('html')" class="preset-card p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500 text-left transition-all">
            <div class="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"><i data-lucide="code" class="w-3.5 h-3.5 text-blue-500"></i> HTML5</div>
            <div class="text-[11px] text-slate-500 font-mono mt-1 truncate">index.html</div>
          </button>
          <button type="button" onclick="selectNewFilePreset('text')" class="preset-card p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500 text-left transition-all">
            <div class="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"><i data-lucide="file-text" class="w-3.5 h-3.5 text-emerald-500"></i> Text</div>
            <div class="text-[11px] text-slate-500 font-mono mt-1 truncate">notes.txt</div>
          </button>
          <button type="button" onclick="selectNewFilePreset('javascript')" class="preset-card p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500 text-left transition-all">
            <div class="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"><i data-lucide="file-code" class="w-3.5 h-3.5 text-amber-500"></i> JavaScript</div>
            <div class="text-[11px] text-slate-500 font-mono mt-1 truncate">app.js</div>
          </button>
          <button type="button" onclick="selectNewFilePreset('css')" class="preset-card p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500 text-left transition-all">
            <div class="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"><i data-lucide="palette" class="w-3.5 h-3.5 text-blue-500"></i> CSS</div>
            <div class="text-[11px] text-slate-500 font-mono mt-1 truncate">style.css</div>
          </button>
          <button type="button" onclick="selectNewFilePreset('json')" class="preset-card p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500 text-left transition-all">
            <div class="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"><i data-lucide="braces" class="w-3.5 h-3.5 text-violet-500"></i> JSON</div>
            <div class="text-[11px] text-slate-500 font-mono mt-1 truncate">config.json</div>
          </button>
          <button type="button" onclick="selectNewFilePreset('markdown')" class="preset-card p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500 text-left transition-all">
            <div class="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"><i data-lucide="file-edit" class="w-3.5 h-3.5 text-pink-500"></i> Markdown</div>
            <div class="text-[11px] text-slate-500 font-mono mt-1 truncate">README.md</div>
          </button>
          <button type="button" onclick="selectNewFilePreset('sh')" class="preset-card p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500 text-left transition-all">
            <div class="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"><i data-lucide="terminal" class="w-3.5 h-3.5 text-teal-500"></i> Shell</div>
            <div class="text-[11px] text-slate-500 font-mono mt-1 truncate">deploy.sh</div>
          </button>
          <button type="button" onclick="selectNewFilePreset('custom')" class="preset-card p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500 text-left transition-all">
            <div class="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"><i data-lucide="file" class="w-3.5 h-3.5 text-slate-400"></i> Custom</div>
            <div class="text-[11px] text-slate-500 font-mono mt-1 truncate">Any name</div>
          </button>
        </div>
      </div>

      <form onsubmit="handleCreateNewFileSubmit(event)" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">File Name & Extension</label>
          <input type="text" id="zencloud-new-filename-input" required placeholder="e.g. index.html or notes.txt" class="w-full pitch-input rounded-xl px-4 py-2.5 text-sm focus:outline-none font-mono" value="index.html">
          <div class="flex items-center justify-between text-[11px] text-slate-500 mt-1.5">
            <span>Location: <span class="font-mono text-slate-900 dark:text-white">${escapeHtml(AppState.currentPath || '/')}</span></span>
            <span id="preset-desc-hint" class="text-blue-600 dark:text-blue-400 font-medium">HTML5 Web Document starter</span>
          </div>
        </div>
        <input type="hidden" id="zencloud-new-file-preset-key" value="html">
        <div class="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-white/10">
          <button type="button" onclick="closeNewFileModal()" class="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">Cancel</button>
          <button type="submit" class="zencloud-btn-primary px-5 py-2 rounded-xl text-xs flex items-center gap-2">
            <i data-lucide="check" class="w-4 h-4"></i> Create & Open in Studio
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
  const input = document.getElementById('zencloud-new-filename-input');
  if (input) {
    input.focus();
    input.select();
  }
}

function selectNewFilePreset(presetKey) {
  const input = document.getElementById('zencloud-new-filename-input') || document.getElementById('zenova-new-filename-input');
  const hidden = document.getElementById('zencloud-new-file-preset-key') || document.getElementById('zenova-new-file-preset-key');
  const hint = document.getElementById('preset-desc-hint');
  if (hidden) hidden.value = presetKey;

  if (presetKey === 'custom') {
    if (input) {
      input.value = '';
      input.placeholder = 'e.g. script.py, data.yaml, .env';
      input.focus();
    }
    if (hint) hint.textContent = 'Custom file with any extension';
    return;
  }

  const preset = FILE_STARTER_PRESETS[presetKey];
  if (preset && input) {
    input.value = preset.name;
    if (hint) hint.textContent = preset.desc;
    input.focus();
    input.select();
  }
}

function closeNewFileModal() {
  const modal = document.getElementById('zencloud-new-file-modal') || document.getElementById('zenova-new-file-modal');
  if (modal) modal.remove();
}

async function handleCreateNewFileSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('zencloud-new-filename-input') || document.getElementById('zenova-new-filename-input');
  const presetKey = (document.getElementById('zencloud-new-file-preset-key') || document.getElementById('zenova-new-file-preset-key'))?.value || 'custom';
  let fileName = (input?.value || '').trim();
  if (!fileName) return showToast('Please enter a file name.', 'error');

  if (fileName.includes('/') || fileName.includes('\\')) {
    return showToast('File name cannot contain slashes. Folders are created with New Folder.', 'error');
  }

  const currentDir = AppState.currentPath || '/';
  const filePath = currentDir === '/' ? `/${fileName}` : `${currentDir.replace(/\/+$/, '')}/${fileName}`;
  const initialContent = FILE_STARTER_PRESETS[presetKey]?.content || '';

  try {
    await apiRequest('/files/create-file', {
      method: 'POST',
      body: { path: filePath, content: initialContent }
    });

    closeNewFileModal();
    showToast(`Created ${fileName}!`, 'success');
    await fetchFileList();

    openFileEditor(filePath, initialContent);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openFileEditor(filePath, preloadContent = null) {
  try {
    if (!AppState.token) throw new Error('Your session has expired. Please log in again.');
    if (!filePath) return;

    const fileName = filePath.split('/').filter(Boolean).pop() || 'Untitled';
    const mode = detectAceMode(filePath);
    const friendlyTypeName = getFriendlyFileTypeName(filePath);
    const isHtmlOrMd = ['html', 'markdown', 'xml'].includes(mode);

    activeEditorPath = filePath;
    activeEditorMode = mode;
    activeEditorIsDirty = false;
    activeEditorViewMode = isHtmlOrMd && window.innerWidth >= 900 ? 'split' : 'code';

    let content = preloadContent;
    if (content === null) {
      setLoading('Loading file into editor...', true);
      const res = await apiRequest(`/files/content?path=${encodeURIComponent(filePath)}`);
      setLoading('', false);
      content = res.content || '';
    }
    activeEditorOriginalContent = content;

    const existing = document.getElementById('zencloud-editor-modal') || document.getElementById('zenova-editor-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'zencloud-editor-modal';
    modal.className = 'fixed inset-0 z-[100] flex flex-col theme-main-bg text-slate-900 dark:text-slate-100 overflow-hidden tab-pane-enter';
    modal.innerHTML = `
      <header class="h-14 theme-header border-b px-4 flex items-center justify-between gap-3 shrink-0 select-none">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-lg zencloud-logo-badge shrink-0">
            <i data-lucide="${mode === 'html' ? 'code-2' : mode === 'json' ? 'braces' : mode === 'markdown' ? 'file-edit' : mode === 'javascript' ? 'file-code' : 'file-text'}" class="w-4 h-4"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-bold text-sm text-slate-900 dark:text-white truncate max-w-[180px] sm:max-w-xs md:max-w-md" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
              <span id="zencloud-editor-dirty-badge" class="hidden items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                Unsaved
              </span>
              <span id="zencloud-editor-saved-badge" class="hidden items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                Saved
              </span>
            </div>
            <div class="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
              <span>${escapeHtml(filePath)}</span>
              <span aria-hidden="true">·</span>
              <span class="font-sans font-medium">${friendlyTypeName}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          ${isHtmlOrMd ? `
            <div class="hidden sm:flex bg-slate-100 dark:bg-[#0d0d12] p-1 rounded-lg border border-slate-200 dark:border-white/10" id="editor-view-mode-group">
              <button onclick="setEditorViewMode('code')" id="view-mode-code-btn" class="px-2.5 py-1 rounded-md text-xs transition-all ${activeEditorViewMode === 'code' ? 'bg-blue-600 text-white font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}">
                <span class="flex items-center gap-1.5"><i data-lucide="code" class="w-3.5 h-3.5"></i> Code</span>
              </button>
              <button onclick="setEditorViewMode('split')" id="view-mode-split-btn" class="px-2.5 py-1 rounded-md text-xs transition-all ${activeEditorViewMode === 'split' ? 'bg-blue-600 text-white font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}">
                <span class="flex items-center gap-1.5"><i data-lucide="columns-2" class="w-3.5 h-3.5"></i> Split View</span>
              </button>
              <button onclick="setEditorViewMode('preview')" id="view-mode-preview-btn" class="px-2.5 py-1 rounded-md text-xs transition-all ${activeEditorViewMode === 'preview' ? 'bg-blue-600 text-white font-semibold shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}">
                <span class="flex items-center gap-1.5"><i data-lucide="eye" class="w-3.5 h-3.5"></i> Preview</span>
              </button>
            </div>
          ` : ''}

          <button onclick="formatEditorCode()" class="hidden md:flex items-center gap-1.5 pitch-input hover:border-blue-500/40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all" title="Format Code">
            <i data-lucide="wand-2" class="w-3.5 h-3.5 text-blue-500"></i> Format
          </button>

          <select onchange="setEditorSyntaxMode(this.value)" id="editor-syntax-select" class="hidden lg:block pitch-input text-xs rounded-lg px-2.5 py-1.5 focus:outline-none">
            <option value="html" ${mode === 'html' ? 'selected' : ''}>HTML5</option>
            <option value="javascript" ${mode === 'javascript' ? 'selected' : ''}>JavaScript</option>
            <option value="css" ${mode === 'css' ? 'selected' : ''}>CSS</option>
            <option value="json" ${mode === 'json' ? 'selected' : ''}>JSON</option>
            <option value="markdown" ${mode === 'markdown' ? 'selected' : ''}>Markdown</option>
            <option value="text" ${mode === 'text' ? 'selected' : ''}>Plain Text</option>
            <option value="sh" ${mode === 'sh' ? 'selected' : ''}>Shell Script</option>
            <option value="python" ${mode === 'python' ? 'selected' : ''}>Python</option>
            <option value="sql" ${mode === 'sql' ? 'selected' : ''}>SQL</option>
            <option value="yaml" ${mode === 'yaml' ? 'selected' : ''}>YAML</option>
            <option value="xml" ${mode === 'xml' ? 'selected' : ''}>XML / SVG</option>
          </select>

          <button onclick="toggleEditorWordWrap()" id="editor-wrap-btn" class="hidden md:flex items-center gap-1 pitch-input px-2.5 py-1.5 rounded-lg text-xs font-medium" title="Toggle Word Wrap">
            <i data-lucide="wrap-text" class="w-3.5 h-3.5 text-blue-500"></i> Wrap
          </button>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button onclick="saveEditorContent()" id="zencloud-editor-save-btn" class="zencloud-btn-primary flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs cursor-pointer">
            <i data-lucide="save" class="w-3.5 h-3.5"></i>
            <span class="hidden sm:inline">Save</span>
            <span class="text-[10px] opacity-75 font-mono hidden md:inline">Ctrl+S</span>
          </button>

          <button onclick="saveAndCloseEditor()" class="hidden sm:flex items-center gap-1.5 pitch-input hover:border-blue-500/40 px-3 py-2 rounded-lg text-xs font-semibold transition-all">
            Save & Exit
          </button>

          <button onclick="downloadEditorFile()" class="hidden md:flex p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/10" title="Download copy">
            <i data-lucide="download" class="w-4 h-4"></i>
          </button>

          <button onclick="closeFileEditor()" class="p-2 text-slate-500 hover:text-white rounded-lg hover:bg-red-600 transition-colors" title="Close editor">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
      </header>

      <div id="zencloud-editor-workspace" class="flex-1 flex flex-col md:flex-row min-h-0 w-full overflow-hidden relative">
        <div id="zencloud-code-pane" class="flex-1 h-full min-h-0 flex flex-col bg-white dark:bg-[#09090b] relative overflow-hidden">
          <div id="zencloud-code-editor" class="w-full h-full"></div>
          <textarea id="zencloud-textarea-fallback" class="hidden w-full h-full p-4 bg-white dark:bg-[#09090b] text-slate-900 dark:text-slate-100 font-mono text-xs leading-relaxed focus:outline-none resize-none"></textarea>
        </div>

        <div id="zencloud-preview-pane" class="${isHtmlOrMd && activeEditorViewMode !== 'code' ? 'flex' : 'hidden'} flex-1 h-full min-h-0 flex-col bg-slate-50 dark:bg-[#0d0d12] border-l border-slate-200 dark:border-white/10 overflow-hidden">
          <div class="h-9 px-3 bg-white dark:bg-[#0d0d12] border-b border-slate-200 dark:border-white/10 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 shrink-0 select-none">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-slate-900 dark:text-white text-[11px]">Live Preview</span>
              <span aria-hidden="true">·</span>
              <span id="preview-render-type" class="text-[11px] font-mono">${mode.toUpperCase()}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button onclick="updateLivePreview()" class="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-white/10" title="Refresh Live Preview">
                <i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i>
              </button>
              ${mode === 'html' ? `
                <button onclick="openLivePreviewInNewTab()" class="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-white/10" title="Open in browser window">
                  <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                </button>
              ` : ''}
            </div>
          </div>

          <div class="flex-1 min-h-0 w-full overflow-auto relative">
            <iframe id="zencloud-live-preview-iframe" class="${mode === 'html' ? 'block' : 'hidden'} w-full h-full border-0 bg-white" sandbox="allow-scripts allow-modals allow-forms"></iframe>
            <div id="zencloud-markdown-preview-pane" class="${mode === 'markdown' ? 'block' : 'hidden'} w-full h-full p-6 overflow-auto markdown-body bg-white dark:bg-[#09090b]"></div>
            <div id="zencloud-svg-preview-pane" class="${mode === 'xml' ? 'flex' : 'hidden'} w-full h-full p-6 overflow-auto items-center justify-center bg-white dark:bg-[#09090b]"></div>
          </div>
        </div>
      </div>

      <footer class="h-7 bg-white dark:bg-[#0d0d12] border-t border-slate-200 dark:border-white/10 px-4 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 shrink-0 font-mono tabular-nums select-none">
        <div class="flex items-center gap-4">
          <span id="editor-cursor-pos">Ln 1, Col 1</span>
          <span class="hidden sm:inline opacity-40">|</span>
          <span id="editor-lines-count" class="hidden sm:inline">Lines: 1</span>
          <span class="hidden md:inline opacity-40">|</span>
          <span id="editor-chars-count" class="hidden md:inline">Chars: 0</span>
        </div>
        <div class="flex items-center gap-2.5">
          <span class="text-blue-600 dark:text-blue-400 font-semibold" id="editor-status-mode">${mode.toUpperCase()}</span>
          <span aria-hidden="true">·</span>
          <span>UTF-8</span>
          <span class="hidden lg:inline" aria-hidden="true">·</span>
          <span class="hidden lg:inline">Spaces: 2</span>
        </div>
      </footer>
    `;

    document.body.appendChild(modal);
    if (window.lucide) lucide.createIcons();

    initAceEditorInstance(content, mode);
    setEditorViewMode(activeEditorViewMode);
    setupEditorKeyboardShortcuts();
  } catch (err) {
    setLoading('', false);
    showToast(err.message, 'error');
  }
}

function initAceEditorInstance(content, mode) {
  const container = document.getElementById('zencloud-code-editor') || document.getElementById('zenova-code-editor');
  const fallback = document.getElementById('zencloud-textarea-fallback') || document.getElementById('zenova-textarea-fallback');

  if (window.ace && container) {
    try {
      const editor = ace.edit(container);
      editor.setTheme(AppState.isDarkMode ? 'ace/theme/tomorrow_night_eighties' : 'ace/theme/chrome');
      editor.session.setMode(`ace/mode/${mode}`);
      editor.setValue(content || '', -1);
      editor.setFontSize(activeEditorFontSize);
      editor.session.setUseWrapMode(activeEditorWrap);
      editor.setOptions({
        enableBasicAutocompletion: true,
        enableLiveAutocompletion: true,
        enableSnippets: true,
        showPrintMargin: false,
        highlightActiveLine: true,
        tabSize: 2,
        useSoftTabs: true
      });

      editor.commands.addCommand({
        name: 'saveFile',
        bindKey: { win: 'Ctrl-S', mac: 'Command-S' },
        exec: function() {
          saveEditorContent();
        }
      });

      editor.session.on('change', () => {
        markEditorDirty(true);
        updateEditorMetrics();
        if (['html', 'markdown', 'xml'].includes(activeEditorMode)) {
          triggerDebouncedLivePreview();
        }
      });

      editor.selection.on('changeCursor', () => {
        const pos = editor.getCursorPosition();
        const cursorEl = document.getElementById('editor-cursor-pos');
        if (cursorEl) cursorEl.textContent = `Ln ${pos.row + 1}, Col ${pos.column + 1}`;
      });

      activeAceInstance = editor;
      updateEditorMetrics();
      if (['html', 'markdown', 'xml'].includes(mode)) {
        updateLivePreview();
      }
      setTimeout(() => editor.focus(), 100);
      return;
    } catch (aceErr) {
      console.warn('Ace init failed, falling back to textarea:', aceErr);
    }
  }

  activeAceInstance = null;
  if (container) container.classList.add('hidden');
  if (fallback) {
    fallback.classList.remove('hidden');
    fallback.value = content || '';
    fallback.oninput = () => {
      markEditorDirty(true);
      updateEditorMetrics();
      if (['html', 'markdown', 'xml'].includes(activeEditorMode)) {
        triggerDebouncedLivePreview();
      }
    };
    updateEditorMetrics();
  }
}

function getEditorCurrentValue() {
  if (activeAceInstance) {
    return activeAceInstance.getValue();
  }
  const fallback = document.getElementById('zencloud-textarea-fallback') || document.getElementById('zenova-textarea-fallback');
  return fallback ? fallback.value : '';
}

function setEditorCurrentValue(newContent) {
  if (activeAceInstance) {
    activeAceInstance.setValue(newContent, -1);
  } else {
    const fallback = document.getElementById('zencloud-textarea-fallback') || document.getElementById('zenova-textarea-fallback');
    if (fallback) fallback.value = newContent;
  }
}

function updateLivePreview() {
  const content = getEditorCurrentValue();
  if (activeEditorMode === 'html') {
    const iframe = document.getElementById('zencloud-live-preview-iframe') || document.getElementById('zenova-live-preview-iframe');
    if (iframe) {
      iframe.srcdoc = content;
    }
  } else if (activeEditorMode === 'markdown') {
    const pane = document.getElementById('zencloud-markdown-preview-pane') || document.getElementById('zenova-markdown-preview-pane');
    if (pane) {
      pane.innerHTML = window.marked ? marked.parse(content) : `<pre>${escapeHtml(content)}</pre>`;
    }
  } else if (activeEditorMode === 'xml') {
    const pane = document.getElementById('zencloud-svg-preview-pane') || document.getElementById('zenova-svg-preview-pane');
    if (pane) {
      if (content.trim().startsWith('<svg')) {
        pane.innerHTML = content;
      } else {
        pane.innerHTML = `<pre class="text-xs text-slate-400 font-mono">${escapeHtml(content)}</pre>`;
      }
    }
  }
}

function triggerDebouncedLivePreview() {
  if (livePreviewDebounceTimer) clearTimeout(livePreviewDebounceTimer);
  livePreviewDebounceTimer = setTimeout(() => {
    updateLivePreview();
  }, 250);
}

function openLivePreviewInNewTab() {
  const content = getEditorCurrentValue();
  const blob = new Blob([content], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

function setEditorViewMode(mode) {
  activeEditorViewMode = mode;
  const codePane = document.getElementById('zencloud-code-pane') || document.getElementById('zenova-code-pane');
  const previewPane = document.getElementById('zencloud-preview-pane') || document.getElementById('zenova-preview-pane');
  const codeBtn = document.getElementById('view-mode-code-btn');
  const splitBtn = document.getElementById('view-mode-split-btn');
  const previewBtn = document.getElementById('view-mode-preview-btn');

  const activeBtnClass = 'px-2.5 py-1 rounded-md text-xs transition-all bg-blue-600 text-white font-semibold shadow-sm';
  const inactiveBtnClass = 'px-2.5 py-1 rounded-md text-xs transition-all text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';

  if (codeBtn) codeBtn.className = mode === 'code' ? activeBtnClass : inactiveBtnClass;
  if (splitBtn) splitBtn.className = mode === 'split' ? activeBtnClass : inactiveBtnClass;
  if (previewBtn) previewBtn.className = mode === 'preview' ? activeBtnClass : inactiveBtnClass;

  if (mode === 'code') {
    if (codePane) { codePane.classList.remove('hidden'); codePane.style.display = 'flex'; codePane.style.flex = '1'; }
    if (previewPane) { previewPane.classList.add('hidden'); previewPane.style.display = 'none'; }
  } else if (mode === 'preview') {
    if (codePane) { codePane.classList.add('hidden'); codePane.style.display = 'none'; }
    if (previewPane) { previewPane.classList.remove('hidden'); previewPane.style.display = 'flex'; previewPane.style.flex = '1'; }
    updateLivePreview();
  } else {
    if (codePane) { codePane.classList.remove('hidden'); codePane.style.display = 'flex'; codePane.style.flex = '1'; }
    if (previewPane) { previewPane.classList.remove('hidden'); previewPane.style.display = 'flex'; previewPane.style.flex = '1'; }
    updateLivePreview();
  }

  if (activeAceInstance) {
    setTimeout(() => activeAceInstance.resize(), 50);
  }
}

function formatEditorCode() {
  const content = getEditorCurrentValue();
  if (activeEditorMode === 'json') {
    try {
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      setEditorCurrentValue(formatted);
      showToast('JSON formatted successfully!', 'success');
      markEditorDirty(true);
    } catch (err) {
      showToast(`Invalid JSON: ${err.message}`, 'error');
    }
  } else {
    showToast(`Code formatted for ${activeEditorMode.toUpperCase()}`, 'info');
  }
}

function setEditorSyntaxMode(newMode) {
  activeEditorMode = newMode;
  if (activeAceInstance) {
    activeAceInstance.session.setMode(`ace/mode/${newMode}`);
  }
  const statusMode = document.getElementById('editor-status-mode');
  if (statusMode) statusMode.textContent = newMode.toUpperCase();

  const iframe = document.getElementById('zencloud-live-preview-iframe') || document.getElementById('zenova-live-preview-iframe');
  const mdPane = document.getElementById('zencloud-markdown-preview-pane') || document.getElementById('zenova-markdown-preview-pane');
  const svgPane = document.getElementById('zencloud-svg-preview-pane') || document.getElementById('zenova-svg-preview-pane');
  const renderType = document.getElementById('preview-render-type');
  if (renderType) renderType.textContent = `(${newMode.toUpperCase()})`;

  if (iframe) iframe.className = newMode === 'html' ? 'block w-full h-full border-0 bg-white' : 'hidden';
  if (mdPane) mdPane.className = newMode === 'markdown' ? 'block w-full h-full p-6 overflow-auto markdown-body bg-[#000000]' : 'hidden';
  if (svgPane) svgPane.className = newMode === 'xml' ? 'flex w-full h-full p-6 overflow-auto items-center justify-center bg-[#000000]' : 'hidden';

  updateLivePreview();
}

function toggleEditorWordWrap() {
  activeEditorWrap = !activeEditorWrap;
  if (activeAceInstance) {
    activeAceInstance.session.setUseWrapMode(activeEditorWrap);
  }
  const btn = document.getElementById('editor-wrap-btn');
  if (btn) {
    btn.classList.toggle('bg-white', activeEditorWrap);
    btn.classList.toggle('text-black', activeEditorWrap);
    btn.classList.toggle('font-bold', activeEditorWrap);
  }
  showToast(`Word wrap: ${activeEditorWrap ? 'On' : 'Off'}`, 'info');
}

async function saveEditorContent() {
  const content = getEditorCurrentValue();
  const saveBtn = document.getElementById('zencloud-editor-save-btn') || document.getElementById('zenova-editor-save-btn');
  const originalText = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Saving...`;
  }

  try {
    await apiRequest('/files/save-content', {
      method: 'POST',
      body: {
        path: activeEditorPath,
        content: content
      }
    });

    activeEditorOriginalContent = content;
    markEditorDirty(false);
    showToast(`Saved ${activeEditorPath.split('/').pop()} successfully!`, 'success');

    if (AppState.currentTab === 'files') {
      fetchFileList();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function saveAndCloseEditor() {
  await saveEditorContent();
  closeFileEditor(true);
}

function closeFileEditor(force = false) {
  if (!force && activeEditorIsDirty) {
    const confirmClose = confirm('You have unsaved changes in this file. Discard changes and exit editor?');
    if (!confirmClose) return;
  }

  const modal = document.getElementById('zencloud-editor-modal') || document.getElementById('zenova-editor-modal');
  if (modal) modal.remove();

  if (activeAceInstance) {
    try {
      activeAceInstance.destroy();
    } catch (_) {}
    activeAceInstance = null;
  }
  activeEditorPath = '';
  activeEditorIsDirty = false;
}

function markEditorDirty(isDirty) {
  activeEditorIsDirty = isDirty;
  const dirtyBadge = document.getElementById('zencloud-editor-dirty-badge') || document.getElementById('zenova-editor-dirty-badge');
  const savedBadge = document.getElementById('zencloud-editor-saved-badge') || document.getElementById('zenova-editor-saved-badge');
  if (dirtyBadge) dirtyBadge.classList.toggle('hidden', !isDirty);
  if (savedBadge) savedBadge.classList.toggle('hidden', isDirty);
}

function updateEditorMetrics() {
  const content = getEditorCurrentValue();
  const lines = content.split('\n').length;
  const chars = content.length;
  const linesEl = document.getElementById('editor-lines-count');
  const charsEl = document.getElementById('editor-chars-count');
  if (linesEl) linesEl.textContent = `Lines: ${lines.toLocaleString()}`;
  if (charsEl) charsEl.textContent = `Chars: ${chars.toLocaleString()}`;
}

function downloadEditorFile() {
  const content = getEditorCurrentValue();
  const fileName = activeEditorPath.split('/').pop() || 'file.txt';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setupEditorKeyboardShortcuts() {
  const handler = (e) => {
    const modal = document.getElementById('zencloud-editor-modal') || document.getElementById('zenova-editor-modal');
    if (!modal) {
      window.removeEventListener('keydown', handler);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveEditorContent();
    }
    if (e.key === 'Escape') {
      closeFileEditor();
    }
  };
  window.addEventListener('keydown', handler);
}

function openFileContextMenu(filePath, isDirectory, e) {
  const existing = document.getElementById('file-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'file-context-menu';
  menu.className = 'fixed glass-card rounded-xl shadow-2xl p-1.5 z-50 text-xs w-52 space-y-0.5';

  const ext = filePath.toLowerCase();
  const isArchive = ext.endsWith('.zip') || ext.endsWith('.tar') || ext.endsWith('.tar.gz') || ext.endsWith('.7z');
  const canEdit = !isDirectory && isEditableFile(filePath);
  const encodedPath = encodeURIComponent(filePath);

  menu.innerHTML = `
    ${canEdit ? `
      <button onclick="openFileEditor(decodeURIComponent('${encodedPath}'))" class="w-full text-left px-3 py-2 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold mb-1 transition-colors">
        <i data-lucide="code-2" class="w-4 h-4"></i> Edit in Studio
      </button>
    ` : ''}
    <button onclick="downloadSingleFile(decodeURIComponent('${encodedPath}'))" class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2 text-slate-700 dark:text-slate-200">
      <i data-lucide="download" class="w-3.5 h-3.5 text-slate-500"></i> Download
    </button>
    <button onclick="openEmbedLinkModal(decodeURIComponent('${encodedPath}'))" class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2 text-slate-700 dark:text-slate-200">
      <i data-lucide="link-2" class="w-3.5 h-3.5 text-blue-500"></i> Direct Embed URL
    </button>
    <button onclick="createShareLinkModal(decodeURIComponent('${encodedPath}'))" class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2 text-slate-700 dark:text-slate-200">
      <i data-lucide="share-2" class="w-3.5 h-3.5 text-emerald-500"></i> Create Share Link
    </button>
    <button onclick="renameFilePrompt(decodeURIComponent('${encodedPath}'))" class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2 text-slate-700 dark:text-slate-200">
      <i data-lucide="edit-3" class="w-3.5 h-3.5 text-amber-500"></i> Rename
    </button>
    <button onclick="moveFilePrompt(decodeURIComponent('${encodedPath}'))" class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2 text-slate-700 dark:text-slate-200">
      <i data-lucide="folder-input" class="w-3.5 h-3.5 text-slate-500"></i> Move to...
    </button>
    ${isArchive ? `
      <button onclick="extractArchivePrompt(decodeURIComponent('${encodedPath}'))" class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2 text-slate-700 dark:text-slate-200">
        <i data-lucide="file-archive" class="w-3.5 h-3.5 text-blue-500"></i> Extract Archive
      </button>
    ` : ''}
    <div class="my-1 border-t border-slate-200 dark:border-white/10"></div>
    <button onclick="deleteSingleFile(decodeURIComponent('${encodedPath}'))" class="w-full text-left px-3 py-2 rounded-lg hover:bg-red-500/10 flex items-center gap-2 text-red-600 dark:text-red-400">
      <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete
    </button>
  `;

  document.body.appendChild(menu);
  if (window.lucide) lucide.createIcons();

  const gap = 8;
  const menuRect = menu.getBoundingClientRect();
  let left = e.clientX;
  let top = e.clientY;
  if (left + menuRect.width > window.innerWidth - gap) left = Math.max(gap, e.clientX - menuRect.width);
  if (top + menuRect.height > window.innerHeight - gap) top = Math.max(gap, window.innerHeight - menuRect.height - gap);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const dismiss = () => {
    menu.remove();
    document.removeEventListener('click', dismiss);
  };
  setTimeout(() => document.addEventListener('click', dismiss), 50);
}

async function downloadSingleFile(filePath) {
  try {
    if (!AppState.token) throw new Error('Your session has expired. Please log in again.');

    // IMPORTANT: do not fetch() + blob() here. That forces the browser to wait
    // for the ENTIRE large file before starting the download and can consume
    // huge amounts of RAM. A normal same-origin attachment URL lets Chromium
    // stream the file directly to its download manager immediately.
    const downloadUrl = getEffectiveDownloadUrl(filePath);
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.setAttribute('aria-hidden', 'true');
    frame.src = downloadUrl;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 120000);

    const filename = filePath.split('/').filter(Boolean).pop() || 'download';
    showToast(`Download started: ${filename}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openMoveSelectedPrompt() {
  if (!AppState.selectedPaths.length) return showToast('Select at least one file or folder first.', 'error');
  const destinationDir = prompt('Enter destination directory (example: / or /Testing):', AppState.currentPath || '/');
  if (destinationDir === null) return;
  const normalized = destinationDir.trim() || '/';

  apiRequest('/files/move', {
    method: 'POST',
    body: { items: [...AppState.selectedPaths], destinationDir: normalized }
  })
    .then(() => {
      showToast(`Selected items moved to ${normalized}`, 'success');
      AppState.selectedPaths = [];
      fetchFileList();
      updateQuotaWidget();
    })
    .catch(err => showToast(err.message, 'error'));
}

function moveFilePrompt(filePath) {
  const currentDir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
  const destinationDir = prompt('Enter destination directory (example: / or /Testing):', AppState.currentPath || currentDir);
  if (destinationDir === null) return;
  const normalized = destinationDir.trim() || '/';

  apiRequest('/files/move', {
    method: 'POST',
    body: { items: [filePath], destinationDir: normalized }
  })
    .then(() => {
      showToast(`Moved to ${normalized}`, 'success');
      AppState.selectedPaths = AppState.selectedPaths.filter(p => p !== filePath);
      fetchFileList();
      updateQuotaWidget();
    })
    .catch(err => showToast(err.message, 'error'));
}

function renameFilePrompt(oldPath) {
  const oldName = oldPath.split('/').pop();
  const newName = prompt('Enter new name:', oldName);
  if (!newName || newName === oldName) return;

  const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
  const newPath = parentDir.endsWith('/') ? parentDir + newName : parentDir + '/' + newName;

  apiRequest('/files/rename', {
    method: 'POST',
    body: { oldPath, newPath }
  })
  .then(() => {
    showToast('Item renamed!', 'success');
    fetchFileList();
  })
  .catch(err => showToast(err.message, 'error'));
}

function deleteSingleFile(filePath) {
  if (!confirm(`Are you sure you want to delete ${filePath.split('/').pop()}?`)) return;

  apiRequest('/files/delete', {
    method: 'POST',
    body: { paths: [filePath] }
  })
  .then(() => {
    showToast('Deleted successfully!', 'success');
    fetchFileList();
    updateQuotaWidget();
  })
  .catch(err => showToast(err.message, 'error'));
}

function handleBulkDelete() {
  if (AppState.selectedPaths.length === 0) return;
  if (!confirm(`Delete ${AppState.selectedPaths.length} selected items permanently?`)) return;

  apiRequest('/files/delete', {
    method: 'POST',
    body: { paths: AppState.selectedPaths }
  })
  .then(() => {
    showToast('Selected items deleted!', 'success');
    fetchFileList();
    updateQuotaWidget();
  })
  .catch(err => showToast(err.message, 'error'));
}

function openCompressModal() {
  const archiveName = prompt('Enter archive filename (e.g. backup.zip):', 'archive.zip');
  if (!archiveName) return;

  apiRequest('/files/compress', {
    method: 'POST',
    body: {
      items: AppState.selectedPaths,
      archiveName,
      format: archiveName.endsWith('.tar.gz') ? 'tar.gz' : archiveName.split('.').pop()
    }
  })
  .then(() => {
    showToast('Archive created successfully!', 'success');
    fetchFileList();
    updateQuotaWidget();
  })
  .catch(err => showToast(err.message, 'error'));
}

function extractArchivePrompt(archivePath) {
  const targetDir = prompt('Extract to directory (leave blank for current directory):', AppState.currentPath);
  if (targetDir === null) return;

  apiRequest('/files/extract', {
    method: 'POST',
    body: { archivePath, targetDir: targetDir || AppState.currentPath }
  })
  .then(() => {
    showToast('Archive extracted successfully!', 'success');
    fetchFileList();
    updateQuotaWidget();
  })
  .catch(err => showToast(err.message, 'error'));
}

function openEmbedLinkModal(filePath) {
  const cleanPath = String(filePath || '').replace(/^\/+/, '').replace(/^s3_storage\//, '');
  const fileName = cleanPath.split('/').pop() || 'file';
  const origin = window.location.origin;
  const encodedPath = encodeURIComponent(cleanPath).replace(/%2F/g, '/');
  const directEmbedUrl = `${origin}/api/v1/blob/${encodedPath}`;
  const directDownloadUrl = `${origin}/api/v1/blob/${encodedPath}?download=1`;
  const htmlImgTag = `<img src="${directEmbedUrl}" alt="${fileName}" />`;
  const markdownTag = `![${fileName}](${directEmbedUrl})`;

  const modal = document.createElement('div');
  modal.id = 'embed-link-modal';
  modal.className = 'fixed inset-0 bg-black/75 backdrop-blur-sm z-[100] flex items-center justify-center p-4 modal-backdrop-enter';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="glass-card rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl modal-box-enter" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 font-bold text-base text-slate-900 dark:text-white">
          <i data-lucide="link-2" class="w-5 h-5 text-blue-500"></i>
          Direct Embed & CDN Link
        </div>
        <button onclick="document.getElementById('embed-link-modal').remove()" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        Direct link with full CORS and inline rendering for web apps, HTML, React, and Markdown.
      </p>
      <div class="space-y-3 text-xs">
        <div>
          <label class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Direct Embed URL (Inline)</label>
          <div class="flex gap-2">
            <input type="text" readonly value="${directEmbedUrl}" class="flex-1 pitch-input rounded-lg px-3 py-2 font-mono text-[11px] focus:outline-none">
            <button onclick="copyToClipboard('${directEmbedUrl}', this, 'Copied Direct URL!')" class="zencloud-btn-primary px-3 py-2 rounded-lg text-xs shrink-0">Copy</button>
          </div>
        </div>
        <div>
          <label class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">HTML Image Tag</label>
          <div class="flex gap-2">
            <input type="text" readonly value="${escapeHtml(htmlImgTag)}" class="flex-1 pitch-input rounded-lg px-3 py-2 font-mono text-[11px] focus:outline-none">
            <button onclick="copyToClipboard('${escapeHtml(htmlImgTag).replace(/'/g, "\\'")}', this, 'Copied HTML!')" class="px-3 py-2 border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200 rounded-lg font-semibold shrink-0 transition-colors">Copy</button>
          </div>
        </div>
        <div>
          <label class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Markdown Embed</label>
          <div class="flex gap-2">
            <input type="text" readonly value="${escapeHtml(markdownTag)}" class="flex-1 pitch-input rounded-lg px-3 py-2 font-mono text-[11px] focus:outline-none">
            <button onclick="copyToClipboard('${escapeHtml(markdownTag).replace(/'/g, "\\'")}', this, 'Copied Markdown!')" class="px-3 py-2 border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200 rounded-lg font-semibold shrink-0 transition-colors">Copy</button>
          </div>
        </div>
        <div>
          <label class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Direct Download Link (?download=1)</label>
          <div class="flex gap-2">
            <input type="text" readonly value="${directDownloadUrl}" class="flex-1 pitch-input rounded-lg px-3 py-2 font-mono text-[11px] focus:outline-none">
            <button onclick="copyToClipboard('${directDownloadUrl}', this, 'Copied Download URL!')" class="px-3 py-2 border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200 rounded-lg font-semibold shrink-0 transition-colors">Copy</button>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-white/10">
        <a href="${directEmbedUrl}" target="_blank" rel="noopener noreferrer" class="px-3.5 py-2 border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors">
          <i data-lucide="external-link" class="w-3.5 h-3.5 text-blue-500"></i> Open in New Tab
        </a>
        <button onclick="document.getElementById('embed-link-modal').remove()" class="zencloud-btn-primary px-4 py-2 text-xs rounded-lg">
          Done
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

function createShareLinkModal(filePath) {
  const durationStr = prompt('Link expiration duration in hours (e.g. 1, 24, 168 for 7 days, 0 for unlimited):', '24');
  if (durationStr === null) return;

  apiRequest('/share/create', {
    method: 'POST',
    body: { filePath, durationHours: parseInt(durationStr, 10) }
  })
  .then(data => {
    prompt('Public Share Link Created! Copy your link below:', data.shareUrl);
  })
  .catch(err => showToast(err.message, 'error'));
}

async function openFilePreview(filePath) {
  try {
    if (!AppState.token) throw new Error('Your session has expired. Please log in again.');

    const fileName = filePath.split('/').filter(Boolean).pop() || 'Preview';
    const previewUrl = getEffectivePreviewUrl(filePath, `&_=${Date.now()}`);
    const encodedPath = encodeURIComponent(filePath);
    const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif'];
    const videoExts = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'ogv'];
    const isImage = imageExts.includes(ext);
    const isVideo = videoExts.includes(ext);

    closeFilePreview();
    const drawer = document.createElement('div');
    drawer.id = 'file-preview-drawer';
    drawer.className = 'fixed right-0 top-0 h-full shadow-2xl z-[80] flex flex-col translate-x-0';
    drawer.innerHTML = `
      <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d0d12] shrink-0">
        <div class="min-w-0">
          <div class="text-xs text-slate-500 dark:text-slate-400">Preview</div>
          <div class="text-sm font-semibold text-slate-900 dark:text-white truncate" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
        </div>
        <div class="flex items-center gap-2">
          ${isEditableFile(filePath) ? `
            <button onclick="closeFilePreview(); openFileEditor(decodeURIComponent('${encodedPath}'))" class="zencloud-btn-primary px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
              <i data-lucide="code-2" class="w-3.5 h-3.5"></i> Edit
            </button>
          ` : ''}
          <button onclick="closeFilePreview()" class="p-2 rounded-lg bg-slate-100 dark:bg-white/10 hover:bg-red-600 text-slate-600 dark:text-slate-300 hover:text-white shrink-0 transition-colors" title="Close preview">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
      <div id="file-preview-body" class="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100/70 dark:bg-[#09090b]">
        ${isImage
          ? `<img src="${previewUrl}" alt="${escapeHtml(fileName)}" class="preview-media mx-auto" />`
          : isVideo
            ? createVideoPlayerMarkup('file-preview-video', previewUrl, fileName)
            : `<div class="text-sm text-slate-500 flex items-center gap-2"><i data-lucide="loader-2" class="w-4 h-4 animate-spin text-blue-500"></i> Loading preview...</div>`}
      </div>
      <div class="px-4 py-3 border-t border-slate-200 dark:border-white/10 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
        Read-only preview. Use Edit to open Code Studio or Download to save locally.
      </div>
    `;
    document.body.appendChild(drawer);
    if (window.lucide) lucide.createIcons();

    if (isVideo) {
      setupVideoPlayer(
        'file-preview-video',
        previewUrl,
        getEffectiveTranscodedUrl(filePath),
        getEffectiveTranscodedUrl(filePath, true),
        getEffectiveDownloadUrl(filePath)
      );
    }

    if (isImage || isVideo) return;

    const res = await fetch(previewUrl, { headers: { Authorization: `Bearer ${AppState.token}` }, cache: 'no-store' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Preview could not be loaded.');
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const body = document.getElementById('file-preview-body');
    if (!body) return;

    if (contentType === 'application/pdf') {
      body.innerHTML = `<iframe src="${previewUrl}" class="w-full h-full min-h-[70vh] rounded-xl bg-white border border-slate-200 dark:border-white/10"></iframe>`;
    } else if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('javascript') || isEditableFile(filePath)) {
      const text = await res.text();
      body.innerHTML = `
        <div class="w-full h-full flex flex-col p-1 space-y-2">
          <div class="flex justify-between items-center px-1">
            <span class="text-xs text-slate-500 dark:text-slate-400 font-mono">${escapeHtml(fileName)}</span>
            <button onclick="closeFilePreview(); openFileEditor(decodeURIComponent('${encodedPath}'))" class="zencloud-btn-primary px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Open in Studio
            </button>
          </div>
          <pre class="flex-1 w-full whitespace-pre-wrap break-words text-xs leading-5 text-slate-800 dark:text-slate-200 bg-white dark:bg-[#111116] border border-slate-200 dark:border-white/10 rounded-xl p-4 overflow-auto font-mono">${escapeHtml(text)}</pre>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    } else {
      body.innerHTML = `<div class="text-center text-slate-500 text-sm p-6"><i data-lucide="file-question" class="w-10 h-10 mx-auto mb-3 opacity-60"></i><p>This file type cannot be previewed.</p></div>`;
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    const body = document.getElementById('file-preview-body');
    if (body) body.innerHTML = `<div class="text-center text-red-500 dark:text-red-400 text-sm p-6">${escapeHtml(err.message)}</div>`;
    else showToast(err.message, 'error');
  }
}

function closeFilePreview() {
  const drawer = document.getElementById('file-preview-drawer');
  if (drawer) drawer.remove();
  if (AppState.previewObjectUrl) {
    URL.revokeObjectURL(AppState.previewObjectUrl);
    AppState.previewObjectUrl = null;
  }
}

async function startUrlDownload(event) {
  event.preventDefault();
  const urlInput = document.getElementById('url-download-link');
  const nameInput = document.getElementById('url-download-filename');
  const url = urlInput?.value.trim();
  const filename = nameInput?.value.trim() || '';

  if (!url) return showToast('Enter a direct download URL.', 'error');

  try {
    const data = await apiRequest('/files/download-from-url', {
      method: 'POST',
      body: { url, filename, targetDir: AppState.currentPath }
    });
    showToast(`Download started: ${data.job.filename}`, 'success');
    if (urlInput) urlInput.value = '';
    if (nameInput) nameInput.value = '';
    await loadUrlDownloadJobs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function formatEta(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

function formatDownloadSpeed(bytesPerSec) {
  return bytesPerSec ? `${formatBytes(bytesPerSec)}/s` : '—';
}

async function removeUrlDownloadJob(jobId) {
  try {
    await apiRequest(`/files/download-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    await loadUrlDownloadJobs();
    showToast('Removed from recent downloads.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function clearUrlDownloadJobs() {
  try {
    await apiRequest('/files/download-jobs', { method: 'DELETE' });
    await loadUrlDownloadJobs();
    showToast('Download history cleared.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadUrlDownloadJobs() {
  const container = document.getElementById('url-download-jobs');
  if (!container) return;

  try {
    const jobs = await apiRequest('/files/download-jobs');
    const active = jobs.some(j => j.status === 'queued' || j.status === 'running');

    if (!jobs.length) {
      container.innerHTML = '';
    } else {
      container.innerHTML = `
        <div class="flex items-center justify-between gap-3 mb-2 pt-2 border-t border-slate-200 dark:border-white/10">
          <div class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Recent URL Downloads</div>
          <button type="button" onclick="clearUrlDownloadJobs()" class="text-[11px] font-medium text-slate-500 hover:text-red-500 transition-colors">Clear finished</button>
        </div>
        <div class="space-y-2">
          ${jobs.slice(0, 20).map(j => {
            const progress = Math.max(0, Math.min(100, Number(j.progress || 0)));
            const statusClass = j.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : j.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400';
            const bytes = Number(j.bytes || 0);
            const total = Number(j.total_bytes || 0);
            const speed = Number(j.speed_bytes_per_sec || 0);
            const eta = Number(j.eta_seconds || 0);
            const statusText = j.status === 'completed' ? 'Completed' : j.status === 'failed' ? `Failed: ${escapeHtml(j.error || 'Unknown error')}` : (j.status === 'queued' ? 'Queued' : 'Downloading');
            const detail = j.status === 'running' ? `${formatBytes(bytes)}${total ? ` / ${formatBytes(total)}` : ''} · ${formatDownloadSpeed(speed)} · ETA ${formatEta(eta)}` : (j.status === 'completed' ? `${formatBytes(bytes)} downloaded` : '');
            return `
              <div class="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] p-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="text-xs font-semibold text-slate-900 dark:text-white truncate" title="${escapeHtml(j.filename)}">${escapeHtml(j.filename)}</div>
                    <div class="text-[11px] text-slate-500 font-mono truncate">${escapeHtml(j.target_path)}</div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="text-[11px] font-semibold ${statusClass} text-right">${statusText}</span>
                    <button type="button" onclick="removeUrlDownloadJob('${escapeHtml(j.id)}')" class="p-1 rounded-lg text-slate-400 hover:text-red-500 transition" title="Remove">
                      <i data-lucide="x" class="w-3.5 h-3.5"></i>
                    </button>
                  </div>
                </div>
                ${j.status === 'running' || j.status === 'queued' ? `
                  <div class="mt-2 flex items-center justify-between gap-3 text-[11px] font-mono tabular-nums">
                    <span class="text-slate-500 dark:text-slate-400">${j.status === 'queued' ? 'Waiting to start…' : detail}</span>
                    <span class="text-blue-600 dark:text-blue-400 font-semibold">${progress}%</span>
                  </div>
                  <div class="mt-1.5 h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                    <div class="h-full bg-blue-600 dark:bg-blue-500 transition-[width] duration-300" style="width:${progress}%"></div>
                  </div>` : ''}
                ${j.status === 'completed' ? `<div class="mt-1 text-[11px] font-mono tabular-nums text-slate-500">${detail}</div>` : ''}
              </div>`;
          }).join('')}
        </div>`;
      if (window.lucide) lucide.createIcons();
    }

    if (active) {
      if (AppState.downloadJobsTimer) clearTimeout(AppState.downloadJobsTimer);
      AppState.downloadJobsTimer = setTimeout(loadUrlDownloadJobs, 1000);
    } else if (AppState.downloadJobsTimer) {
      clearTimeout(AppState.downloadJobsTimer);
      AppState.downloadJobsTimer = null;
    }

    if (jobs.some(j => j.status === 'completed' && Date.now() - new Date(j.updated_at).getTime() < 5000)) {
      fetchFileList({ clearSelection: false }).catch(() => {});
      updateQuotaWidget();
    }
  } catch (err) {
  }
}

// ==========================================
// 4.5. S3 & VERCEL BLOB API CLUSTER COMPONENT
// ==========================================
let currentCodeSnippetTab = 'curl';
let currentPlaygroundMode = 'blob';
let playgroundSelectedFile = null;

async function renderS3ClusterTab(container) {
  const origin = window.location.origin;
  const s3Endpoint = `${origin}/api/s3`;
  const blobEndpoint = `${origin}/api/v1/blob`;
  const installCmd = `curl -fsSL ${origin}/install.sh | sudo bash`;
  container.innerHTML = `
    <div class="space-y-6 tab-pane-enter">
      <!-- Enterprise Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-white/10 pb-5">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">S3 &amp; Vercel Blob Cluster</h1>
          <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span>AWS S3 v4 Compatible</span>
            <span aria-hidden="true">·</span>
            <span>Vercel Blob SDK Drop-in</span>
            <span aria-hidden="true">·</span>
            <span class="text-emerald-600 dark:text-emerald-400 font-medium">Zero Egress Fees</span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="openCreateApiKeyModal()" class="zencloud-btn-primary text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 whitespace-nowrap">
            <i data-lucide="key" class="w-3.5 h-3.5"></i>
            <span>Create API Key</span>
          </button>
          <button onclick="renderS3ClusterTab(document.getElementById('tab-content-area'))" class="p-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-600 dark:text-slate-300 hover:border-blue-500/40 transition-colors" title="Refresh">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
          </button>
        </div>
      </div>

      <!-- Quick VPS Installer Banner -->
      <div class="glass-card p-5 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <i data-lucide="terminal" class="w-4 h-4"></i>
          </div>
          <div>
            <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Dedicated VPS Node Installer</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Deploy this storage cluster onto any Ubuntu/Debian VPS using the one-line bootstrap command.</p>
          </div>
        </div>
        <div class="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 max-w-full overflow-x-auto">
          <code class="text-[11px] font-mono text-slate-800 dark:text-blue-300 whitespace-nowrap select-all">${escapeHtml(installCmd)}</code>
          <button onclick="copyToClipboard('${escapeHtml(installCmd)}', this, 'Installer command copied!')" class="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors" title="Copy Command">
            <i data-lucide="copy" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>

      <!-- 4-Card Cluster Telemetry & Endpoints -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-medium text-slate-500 dark:text-slate-400">S3 Cluster API</span>
              <span class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Live</span>
            </div>
            <div class="text-sm font-semibold text-slate-900 dark:text-white mb-1">AWS S3 Compatible</div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mb-3">PutObject, GetObject, ListObjectsV2, Range Requests, Cyberduck &amp; Boto3.</p>
          </div>
          <div class="p-2 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-2">
            <span class="font-mono text-[11px] text-slate-800 dark:text-slate-200 truncate">${s3Endpoint}</span>
            <button onclick="copyToClipboard('${s3Endpoint}', this, 'Copied S3 Endpoint!')" class="text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 p-1 transition-colors shrink-0" title="Copy S3 Endpoint">
              <i data-lucide="copy" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>

        <div class="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Vercel Blob API</span>
              <span class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Ready</span>
            </div>
            <div class="text-sm font-semibold text-slate-900 dark:text-white mb-1">Blob SDK Ready</div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mb-3">Drop-in substitute for @vercel/blob with streaming uploads &amp; token access.</p>
          </div>
          <div class="p-2 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-2">
            <span class="font-mono text-[11px] text-slate-800 dark:text-slate-200 truncate">${blobEndpoint}</span>
            <button onclick="copyToClipboard('${blobEndpoint}', this, 'Copied Blob Endpoint!')" class="text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 p-1 transition-colors shrink-0" title="Copy Blob Endpoint">
              <i data-lucide="copy" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>

        <div class="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Cluster Storage</span>
              <i data-lucide="database" class="w-4 h-4 text-blue-500"></i>
            </div>
            <div class="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mb-1" id="cluster-storage-stat">Loading...</div>
          </div>
          <div>
            <div class="w-full bg-slate-200 dark:bg-white/10 h-1.5 rounded-full overflow-hidden mb-2">
              <div id="cluster-storage-bar" class="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
            <p class="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400" id="cluster-quota-detail">Shared with your account quota</p>
          </div>
        </div>

        <div class="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-medium text-slate-500 dark:text-slate-400">API Activity</span>
              <i data-lucide="activity" class="w-4 h-4 text-emerald-500"></i>
            </div>
            <div class="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mb-1" id="cluster-requests-stat">0</div>
          </div>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">Total programmatic calls served across S3 and Blob gateways.</p>
        </div>
      </div>

      <!-- API Keys Management Section -->
      <div id="api-keys-section" class="glass-card p-6 rounded-xl scroll-mt-20">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h2 class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <i data-lucide="shield-check" class="w-4 h-4 text-blue-500"></i>
              <span>API Access Keys</span>
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Authenticate requests using Bearer tokens, x-api-key, or AWS S3 Signature credentials.</p>
          </div>
          <button onclick="openCreateApiKeyModal()" class="zencloud-btn-primary text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i>
            <span>New API Key</span>
          </button>
        </div>
        <div id="api-keys-table-container" class="overflow-x-auto">
          <div class="py-8 text-center text-xs text-slate-500">Loading API keys...</div>
        </div>
      </div>

      <!-- Interactive In-Browser API Playground -->
      <div class="glass-card p-6 rounded-xl">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h2 class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <i data-lucide="play-circle" class="w-4 h-4 text-blue-500"></i>
              <span>Live In-Browser API Playground</span>
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Test real upload and retrieval requests against your cluster right now.</p>
          </div>
          <div class="flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 rounded-lg self-start sm:self-auto">
            <button onclick="switchPlaygroundMode('blob')" id="btn-pg-blob" class="px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white shadow-sm transition-all whitespace-nowrap">
              Vercel Blob PUT
            </button>
            <button onclick="switchPlaygroundMode('s3')" id="btn-pg-s3" class="px-3 py-1.5 text-xs font-medium rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all whitespace-nowrap">
              AWS S3 PutObject
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Playground Input Form -->
          <div class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5" id="pg-path-label">Destination Path / Filename</label>
              <input type="text" id="pg-filename" value="test-uploads/hello-zen.txt" class="w-full pitch-input rounded-lg px-3.5 py-2 text-xs font-mono">
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Content or Payload</label>
              <textarea id="pg-payload" rows="4" class="w-full pitch-input rounded-lg px-3.5 py-2.5 text-xs font-mono" placeholder="Enter text payload or select a file below...">Hello from ZenStorage S3 &amp; Blob Cluster! Timestamp: ${new Date().toISOString()}</textarea>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <label class="px-3 py-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg cursor-pointer flex items-center gap-2 transition-colors">
                <i data-lucide="file-up" class="w-3.5 h-3.5 text-blue-500"></i>
                <span>Choose Local File (Optional)</span>
                <input type="file" id="pg-local-file" class="hidden" onchange="handlePlaygroundFileSelect(event)">
              </label>
              <span id="pg-file-name-preview" class="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[220px]">No file chosen (using text payload)</span>
            </div>
            <button onclick="executePlaygroundUpload()" id="btn-pg-submit" class="w-full zencloud-btn-primary text-xs py-2.5 rounded-lg flex items-center justify-center gap-2">
              <i data-lucide="send" class="w-4 h-4"></i>
              <span>Execute API Upload Request</span>
            </button>
          </div>

          <!-- Playground Output Response -->
          <div class="flex flex-col justify-between p-4 rounded-xl bg-slate-900 dark:bg-[#09090d] text-slate-100 border border-slate-800 dark:border-white/10">
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Live Response Payload</span>
                <span id="pg-res-status" class="text-xs font-mono font-semibold text-slate-400">Ready</span>
              </div>
              <pre id="pg-res-json" class="text-[11px] font-mono text-slate-100 bg-slate-950 dark:bg-[#050508] p-3 rounded-lg border border-slate-800 dark:border-white/5 overflow-x-auto max-h-[200px] custom-scrollbar">// Click "Execute API Upload Request" to test live endpoint...</pre>
            </div>

            <div id="pg-preview-action" class="mt-3 pt-3 border-t border-slate-800 dark:border-white/10 hidden space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                  <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
                  <span>Direct Embed Link Ready</span>
                </span>
                <a id="pg-preview-link" href="#" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-[11px] font-semibold transition-colors">
                  <i data-lucide="external-link" class="w-3 h-3"></i> View Inline
                </a>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
                <button id="btn-copy-direct-url" onclick="" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-medium rounded-md flex items-center justify-center gap-1.5 border border-white/10 transition-colors">
                  <i data-lucide="link" class="w-3 h-3 text-blue-400"></i> Direct URL
                </button>
                <button id="btn-copy-html-tag" onclick="" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-medium rounded-md flex items-center justify-center gap-1.5 border border-white/10 transition-colors">
                  <i data-lucide="code" class="w-3 h-3 text-emerald-400"></i> HTML &lt;img&gt;
                </button>
                <button id="btn-copy-markdown-tag" onclick="" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-medium rounded-md flex items-center justify-center gap-1.5 border border-white/10 transition-colors col-span-2 sm:col-span-1">
                  <i data-lucide="file-text" class="w-3 h-3 text-amber-400"></i> Markdown
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Code Snippets & SDK Guides Section -->
      <div id="code-snippets-section" class="glass-card p-6 rounded-xl scroll-mt-20">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <i data-lucide="code-2" class="w-4 h-4 text-blue-500"></i>
              <span>Integration Code Examples</span>
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Copy production-ready code for your stack.</p>
          </div>
          <div class="flex flex-wrap gap-1 p-1 bg-slate-100 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 rounded-lg">
            <button onclick="switchCodeSnippetTab('curl')" id="tab-code-curl" class="px-3 py-1 text-xs font-semibold rounded-md bg-blue-600 text-white shadow-sm transition-all whitespace-nowrap">cURL</button>
            <button onclick="switchCodeSnippetTab('blob-js')" id="tab-code-blob-js" class="px-3 py-1 text-xs font-medium rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all whitespace-nowrap">Vercel Blob (JS)</button>
            <button onclick="switchCodeSnippetTab('s3-python')" id="tab-code-s3-python" class="px-3 py-1 text-xs font-medium rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all whitespace-nowrap">Python (Boto3)</button>
            <button onclick="switchCodeSnippetTab('s3-node')" id="tab-code-s3-node" class="px-3 py-1 text-xs font-medium rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all whitespace-nowrap">AWS SDK v3 (Node)</button>
            <button onclick="switchCodeSnippetTab('nextjs')" id="tab-code-nextjs" class="px-3 py-1 text-xs font-medium rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all whitespace-nowrap">Next.js</button>
          </div>
        </div>
        <div class="relative">
          <pre id="code-snippet-pre" class="text-xs font-mono text-slate-100 bg-slate-900 dark:bg-[#050508] p-4 rounded-xl border border-slate-800 dark:border-white/10 overflow-x-auto max-h-[300px] custom-scrollbar"></pre>
          <button onclick="copyCurrentCodeSnippet(this)" class="absolute top-3 right-3 text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-white/10 flex items-center gap-1.5 transition-colors">
            <i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy Code
          </button>
        </div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  await loadS3ClusterData();
  switchCodeSnippetTab(currentCodeSnippetTab);
  if (AppState.pendingScrollTarget) {
    const targetId = AppState.pendingScrollTarget;
    AppState.pendingScrollTarget = null;
    setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }
}

async function loadS3ClusterData() {
  const container = document.getElementById('api-keys-table-container');
  try {
    const data = await apiRequest('/keys');
    const keys = data.keys || [];
    const stats = data.stats || {};
    const used = Number(stats.storageUsed || AppState.user.usedStorageBytes || 0);
    const total = Number(stats.storageQuota || AppState.user.storage_quota_bytes || 10737418240);
    const percent = Math.min(100, Math.round((used / total) * 100));
    const sStorageStat = document.getElementById('cluster-storage-stat');
    const sStorageBar = document.getElementById('cluster-storage-bar');
    const sQuotaDetail = document.getElementById('cluster-quota-detail');
    const sRequestsStat = document.getElementById('cluster-requests-stat');
    if (sStorageStat) sStorageStat.innerText = formatBytes(used);
    if (sStorageBar) sStorageBar.style.width = `${percent}%`;
    if (sQuotaDetail) sQuotaDetail.innerText = `${formatBytes(used)} of ${formatBytes(total)} (${percent}%)`;
    if (sRequestsStat) sRequestsStat.innerText = Number(stats.totalRequests || 0).toLocaleString();
    if (!container) return;
    if (!keys.length) {
      container.innerHTML = `
        <div class="py-10 text-center">
          <div class="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 mx-auto mb-3">
            <i data-lucide="key" class="w-5 h-5"></i>
          </div>
          <h3 class="text-sm font-semibold text-slate-900 dark:text-white">No API Keys Generated Yet</h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1 mb-4">Create your first API key to connect applications, upload via cURL, or mount S3 storage.</p>
          <button onclick="openCreateApiKeyModal()" class="zencloud-btn-primary text-xs px-4 py-2 rounded-lg">
            Create API Key
          </button>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }
    container.innerHTML = `
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="border-b border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
            <th class="py-3 px-3">Name</th>
            <th class="py-3 px-3">Access Key ID</th>
            <th class="py-3 px-3">Permissions</th>
            <th class="py-3 px-3">Requests</th>
            <th class="py-3 px-3">Created</th>
            <th class="py-3 px-3">Last Used</th>
            <th class="py-3 px-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-white/5">
          ${keys.map(k => `
            <tr class="hover:bg-blue-500/5 transition-colors">
              <td class="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                <div class="flex items-center gap-2">
                  <i data-lucide="key" class="w-3.5 h-3.5 text-blue-500"></i>
                  <span>${escapeHtml(k.name)}</span>
                </div>
              </td>
              <td class="py-3 px-3 font-mono text-slate-800 dark:text-slate-200">
                <span class="bg-slate-100 dark:bg-[#09090d] px-2 py-1 rounded border border-slate-200 dark:border-white/10 inline-flex items-center gap-1.5">
                  ${escapeHtml(k.key_id)}
                  <button onclick="copyToClipboard('${escapeHtml(k.key_id)}', this, 'Key ID copied!')" class="text-slate-400 hover:text-blue-600 dark:hover:text-blue-400">
                    <i data-lucide="copy" class="w-3 h-3"></i>
                  </button>
                </span>
              </td>
              <td class="py-3 px-3">
                <span class="text-[11px] font-semibold ${k.permissions === 'full' ? 'text-blue-600 dark:text-blue-400' : k.permissions === 'read_write' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}">
                  ${escapeHtml(k.permissions)}
                </span>
              </td>
              <td class="py-3 px-3 text-slate-700 dark:text-slate-300 font-mono tabular-nums">${Number(k.requests_count || 0).toLocaleString()}</td>
              <td class="py-3 px-3 text-slate-500 dark:text-slate-400 font-mono tabular-nums">${new Date(k.created_at).toLocaleDateString()}</td>
              <td class="py-3 px-3 text-slate-500 dark:text-slate-400 font-mono tabular-nums">${k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</td>
              <td class="py-3 px-3 text-right">
                <button onclick="revokeApiKey(${k.id}, '${escapeHtml(k.name)}')" class="text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 px-2.5 py-1 rounded-md font-medium transition-colors">
                  Revoke
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="p-4 text-xs text-rose-500">Failed to load API keys: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function openCreateApiKeyModal() {
  const existing = document.getElementById('active-custom-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'active-custom-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm modal-backdrop-enter';
  modal.innerHTML = `
    <div class="glass-card w-full max-w-md p-6 rounded-xl shadow-2xl modal-box-enter">
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3 mb-4">
        <h3 class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <i data-lucide="key" class="w-4 h-4 text-blue-500"></i>
          <span>Create New API Key</span>
        </h3>
        <button onclick="closeActiveModal()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <form onsubmit="handleCreateApiKey(event)" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Key Description / Name</label>
          <input type="text" id="new-key-name" required placeholder="e.g. Next.js Production, Backup Script" class="w-full pitch-input rounded-lg px-3.5 py-2 text-xs">
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Permissions Scope</label>
          <select id="new-key-permissions" class="w-full pitch-input rounded-lg px-3.5 py-2 text-xs">
            <option value="full">Full Access (Read, Write, Delete)</option>
            <option value="read_write">Read &amp; Write (Upload &amp; Download)</option>
            <option value="read">Read Only (Download Only)</option>
          </select>
        </div>
        <div class="p-3 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-300">
          Grants programmatic access to upload and manage objects in your S3 &amp; Blob storage cluster.
        </div>
        <div class="flex items-center justify-end gap-2 pt-2">
          <button type="button" onclick="closeActiveModal()" class="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button type="submit" id="submit-create-key" class="zencloud-btn-primary px-5 py-2 rounded-lg text-xs">
            Generate Key
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

function closeActiveModal() {
  const modal = document.getElementById('active-custom-modal');
  if (modal) modal.remove();
}

async function handleCreateApiKey(e) {
  e.preventDefault();
  const name = document.getElementById('new-key-name').value.trim();
  const permissions = document.getElementById('new-key-permissions').value;
  const submitBtn = document.getElementById('submit-create-key');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = 'Creating...'; }

  try {
    const data = await apiRequest('/keys', {
      method: 'POST',
      body: { name, permissions }
    });

    closeActiveModal();
    showNewApiKeyRevealedModal(data.key);
    await loadS3ClusterData();
  } catch (err) {
    showToast(err.message, 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Generate Key'; }
  }
}

function showNewApiKeyRevealedModal(key) {
  const modal = document.createElement('div');
  modal.id = 'active-custom-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm modal-backdrop-enter';
  modal.innerHTML = `
    <div class="glass-card w-full max-w-lg p-6 rounded-xl border border-emerald-500/30 shadow-2xl modal-box-enter">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/30">
            <i data-lucide="check-circle-2" class="w-4 h-4"></i>
          </div>
          <div>
            <h3 class="text-base font-semibold text-slate-900 dark:text-white">API Key Generated</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(key.name)}</p>
          </div>
        </div>
        <button onclick="closeActiveModal()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <div class="space-y-3 mb-5">
        <div class="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-500 shrink-0 mt-0.5"></i>
          <span><strong>Save your Secret Key now.</strong> For security, your secret key is only shown once and cannot be recovered later.</span>
        </div>
        <div>
          <label class="block text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Access Key ID</label>
          <div class="p-2.5 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-2">
            <span class="font-mono text-xs text-slate-900 dark:text-white select-all">${escapeHtml(key.key_id)}</span>
            <button onclick="copyToClipboard('${escapeHtml(key.key_id)}', this, 'Copied Key ID!')" class="px-2 py-1 bg-white dark:bg-[#15151d] hover:bg-slate-100 dark:hover:bg-[#1e1e28] text-xs text-slate-700 dark:text-slate-300 rounded border border-slate-200 dark:border-white/10 flex items-center gap-1">
              <i data-lucide="copy" class="w-3 h-3"></i> Copy
            </button>
          </div>
        </div>
        <div>
          <label class="block text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Secret Access Key (Token)</label>
          <div class="p-2.5 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-2">
            <span class="font-mono text-xs text-emerald-600 dark:text-emerald-300 select-all">${escapeHtml(key.secret_key)}</span>
            <button onclick="copyToClipboard('${escapeHtml(key.secret_key)}', this, 'Copied Secret Key!')" class="px-2 py-1 bg-white dark:bg-[#15151d] hover:bg-slate-100 dark:hover:bg-[#1e1e28] text-xs text-emerald-600 dark:text-emerald-300 rounded border border-slate-200 dark:border-white/10 flex items-center gap-1">
              <i data-lucide="copy" class="w-3 h-3"></i> Copy
            </button>
          </div>
        </div>
      </div>
      <div class="flex justify-end">
        <button onclick="closeActiveModal()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2.5 rounded-lg transition-colors">
          I Have Saved My Secret Key
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

async function revokeApiKey(keyId, keyName) {
  if (!confirm(`Are you sure you want to revoke API key "${keyName}"? Applications using this key will immediately lose access.`)) {
    return;
  }

  try {
    await apiRequest(`/keys/${keyId}`, { method: 'DELETE' });
    showToast('API key revoked successfully', 'success');
    await loadS3ClusterData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function copyToClipboard(text, btnElement, successMsg = 'Copied to clipboard!') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg, 'success');
      if (btnElement) {
        const originalText = btnElement.innerHTML;
        btnElement.classList.add('text-emerald-400');
        setTimeout(() => {
          btnElement.classList.remove('text-emerald-400');
        }, 1500);
      }
    }).catch(() => fallbackCopy(text, successMsg));
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(successMsg, 'success');
  } catch (e) {
    showToast('Failed to copy', 'error');
  }
  ta.remove();
}

function switchPlaygroundMode(mode) {
  currentPlaygroundMode = mode;
  const btnBlob = document.getElementById('btn-pg-blob');
  const btnS3 = document.getElementById('btn-pg-s3');
  const pathLabel = document.getElementById('pg-path-label');
  const fnInput = document.getElementById('pg-filename');
  const activeCls = 'px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white shadow-sm transition-all whitespace-nowrap';
  const inactiveCls = 'px-3 py-1.5 text-xs font-medium rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all whitespace-nowrap';
  if (mode === 'blob') {
    if (btnBlob) btnBlob.className = activeCls;
    if (btnS3) btnS3.className = inactiveCls;
    if (pathLabel) pathLabel.innerText = 'Destination Path (Vercel Blob /pathname)';
    if (fnInput && fnInput.value.includes('bucket')) fnInput.value = 'test-uploads/hello-zen.txt';
  } else {
    if (btnS3) btnS3.className = activeCls;
    if (btnBlob) btnBlob.className = inactiveCls;
    if (pathLabel) pathLabel.innerText = 'S3 Bucket & Object Key (bucket/key)';
    if (fnInput && !fnInput.value.includes('/')) fnInput.value = 'default/test-uploads/hello-zen.txt';
  }
}

function handlePlaygroundFileSelect(e) {
  const file = e.target.files[0];
  playgroundSelectedFile = file || null;
  const preview = document.getElementById('pg-file-name-preview');
  const fnInput = document.getElementById('pg-filename');
  if (file) {
    preview.innerText = `${file.name} (${formatBytes(file.size)})`;
    if (fnInput) {
      const parts = fnInput.value.split('/');
      parts[parts.length - 1] = file.name;
      fnInput.value = parts.join('/');
    }
  } else {
    preview.innerText = 'No file chosen (using text payload)';
  }
}

async function executePlaygroundUpload() {
  const submitBtn = document.getElementById('btn-pg-submit');
  const statusEl = document.getElementById('pg-res-status');
  const jsonEl = document.getElementById('pg-res-json');
  const previewAction = document.getElementById('pg-preview-action');
  const previewLink = document.getElementById('pg-preview-link');

  const filename = document.getElementById('pg-filename').value.trim();
  const textPayload = document.getElementById('pg-payload').value;

  if (!filename) {
    showToast('Please specify a filename or path', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Uploading...';
  if (window.lucide) lucide.createIcons();

  statusEl.innerText = 'Sending...';
  statusEl.className = 'text-xs font-mono font-bold text-amber-400';

  const startTime = performance.now();

  try {
    let url = '';
    let bodyData = null;
    let headers = {
      'Authorization': `Bearer ${AppState.token}`
    };

    if (playgroundSelectedFile) {
      bodyData = playgroundSelectedFile;
      headers['Content-Type'] = playgroundSelectedFile.type || 'application/octet-stream';
    } else {
      bodyData = textPayload;
      headers['Content-Type'] = 'text/plain; charset=utf-8';
    }

    if (currentPlaygroundMode === 'blob') {
      url = `/api/v1/blob/${encodeURIComponent(filename)}`;
    } else {
      let parts = filename.split('/');
      let bucket = 'default';
      let key = filename;
      if (parts.length > 1) {
        bucket = parts[0];
        key = parts.slice(1).join('/');
      }
      url = `/api/s3/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`;
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: bodyData
    });

    const elapsed = Math.round(performance.now() - startTime);
    const data = await res.json().catch(() => ({ status: res.statusText }));

    statusEl.innerText = `${res.status} ${res.statusText} (${elapsed}ms)`;
    statusEl.className = res.ok ? 'text-xs font-mono font-bold text-emerald-400' : 'text-xs font-mono font-bold text-red-400';

    jsonEl.innerText = JSON.stringify(data, null, 2);

    if (res.ok) {
      showToast('API Upload Successful!', 'success');
      const directUrl = data.url || data.downloadUrl || (window.location.origin + url);
      const downloadUrl = data.downloadUrl || (directUrl + '?download=1');
      const fileName = (data.pathname || filename || 'file').split('/').pop();
      const htmlTag = `<img src="${directUrl}" alt="${fileName}" />`;
      const markdownTag = `![${fileName}](${directUrl})`;

      if (previewAction && previewLink) {
        previewLink.href = directUrl;
        previewAction.classList.remove('hidden');

        const btnCopyUrl = document.getElementById('btn-copy-direct-url');
        if (btnCopyUrl) {
          btnCopyUrl.onclick = function() { copyToClipboard(directUrl, this, 'Copied Direct URL!'); };
        }

        const btnCopyHtml = document.getElementById('btn-copy-html-tag');
        if (btnCopyHtml) {
          btnCopyHtml.onclick = function() { copyToClipboard(htmlTag, this, 'Copied HTML <img> tag!'); };
        }

        const btnCopyMd = document.getElementById('btn-copy-markdown-tag');
        if (btnCopyMd) {
          btnCopyMd.onclick = function() { copyToClipboard(markdownTag, this, 'Copied Markdown code!'); };
        }
      }
      loadS3ClusterData().catch(() => {});
      updateQuotaWidget().catch(() => {});
    } else {
      showToast(`Upload failed: ${data.error || res.statusText}`, 'error');
    }
  } catch (err) {
    statusEl.innerText = 'Request Failed';
    statusEl.className = 'text-xs font-mono font-bold text-red-400';
    jsonEl.innerText = `Error: ${err.message}`;
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i> Execute API Upload Request';
    if (window.lucide) lucide.createIcons();
  }
}

function switchCodeSnippetTab(tab) {
  currentCodeSnippetTab = tab;
  const tabs = ['curl', 'blob-js', 's3-python', 's3-node', 'nextjs'];
  tabs.forEach(t => {
    const el = document.getElementById(`tab-code-${t}`);
    if (el) {
      if (t === tab) {
        el.className = 'px-3 py-1 text-xs font-semibold rounded-md bg-blue-600 text-white shadow-sm transition-all whitespace-nowrap';
      } else {
        el.className = 'px-3 py-1 text-xs font-medium rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all whitespace-nowrap';
      }
    }
  });
  const pre = document.getElementById('code-snippet-pre');
  if (!pre) return;
  const origin = window.location.origin;

  if (tab === 'curl') {
    pre.innerText = `# 1. Upload via Vercel Blob API (Binary PUT)
curl -X PUT "${origin}/api/v1/blob/images/avatar.png" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: image/png" \\
  --data-binary @"./avatar.png"

# 2. Upload via AWS S3 PutObject API
curl -X PUT "${origin}/api/s3/my-bucket/documents/report.pdf" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/pdf" \\
  --data-binary @"./report.pdf"

# 3. Download Object
curl -O "${origin}/api/s3/my-bucket/documents/report.pdf" \\
  -H "Authorization: Bearer YOUR_API_KEY"`;
  } else if (tab === 'blob-js') {
    pre.innerText = `// Drop-in Vercel Blob replacement (Client or Server)
import { put } from '@vercel/blob';

// Option A: Direct Fetch to your Zen Blob Cluster
async function uploadToBlob(file) {
  const response = await fetch('${origin}/api/v1/blob/' + file.name, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + process.env.ZEN_BLOB_TOKEN,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: file
  });
  
  const blob = await response.json();
  console.log('Uploaded Blob URL:', blob.url);
  return blob;
}`;
  } else if (tab === 's3-python') {
    pre.innerText = `import boto3
from botocore.config import Config

# Connect to your free self-hosted VPS S3 Cluster
s3_client = boto3.client(
    's3',
    endpoint_url='${origin}/api/s3',
    aws_access_key_id='YOUR_KEY_ID',
    aws_secret_access_key='YOUR_SECRET_KEY',
    config=Config(s3={'addressing_style': 'path'})
)

# Upload file
s3_client.upload_file(
    Filename='local_data.csv',
    Bucket='analytics',
    Key='2026/report.csv'
)
print("File successfully uploaded to VPS S3 cluster!")`;
  } else if (tab === 's3-node') {
    pre.innerText = `import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "${origin}/api/s3",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.ZEN_S3_KEY_ID,
    secretAccessKey: process.env.ZEN_S3_SECRET_KEY
  }
});

// Upload object
await s3.send(new PutObjectCommand({
  Bucket: "uploads",
  Key: "file.json",
  Body: JSON.stringify({ status: "success" }),
  ContentType: "application/json"
}));`;
  } else if (tab === 'nextjs') {
    pre.innerText = `// app/api/upload/route.ts (Next.js App Router)
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // Forward to your Zen S3 / Blob Cluster
  const uploadRes = await fetch('${origin}/api/v1/blob/' + file.name, {
    method: 'PUT',
    headers: {
      'Authorization': \`Bearer \${process.env.ZEN_STORAGE_TOKEN}\`,
      'Content-Type': file.type
    },
    body: Buffer.from(await file.arrayBuffer())
  });

  const data = await uploadRes.json();
  return NextResponse.json(data);
}`;
  }
}

function copyCurrentCodeSnippet(btn) {
  const pre = document.getElementById('code-snippet-pre');
  if (pre) {
    copyToClipboard(pre.innerText, btn, 'Code snippet copied!');
  }
}

// ==========================================
// 5. SHARE LINKS TAB COMPONENT
// ==========================================
async function renderShareLinksTab(container) {
  container.innerHTML = `
    <div class="space-y-6 tab-pane-enter">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-white/10 pb-5">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Active Share Links</h1>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Manage public share tokens, view counts, and expiration windows.</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="navigateTab('files')" class="zencloud-btn-primary text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 whitespace-nowrap">
            <i data-lucide="folder" class="w-3.5 h-3.5"></i>
            <span>Browse Files</span>
          </button>
          <button onclick="renderShareLinksTab(document.getElementById('tab-content-area'))" class="p-2 bg-white dark:bg-[#111116] text-slate-600 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-white/10 hover:border-blue-500/40 transition-colors" title="Refresh">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
      <div id="share-links-list" class="glass-card rounded-xl overflow-hidden">
        <div class="p-8 text-center text-slate-500 text-xs">Loading share links...</div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  try {
    const links = await apiRequest('/share/my-links');
    const listDiv = document.getElementById('share-links-list');
    if (!listDiv) return;
    if (links.length === 0) {
      listDiv.innerHTML = `
        <div class="p-12 text-center text-slate-500">
          <div class="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 mx-auto mb-3">
            <i data-lucide="link" class="w-5 h-5"></i>
          </div>
          <p class="text-sm font-semibold text-slate-900 dark:text-white">No share links created yet</p>
          <p class="text-xs mt-1 mb-4 text-slate-500 dark:text-slate-400">Open Files &amp; Studio and choose Share from any file menu to create a public URL.</p>
          <button onclick="navigateTab('files')" class="zencloud-btn-primary text-xs px-4 py-2 rounded-lg">
            Navigate to Files
          </button>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }
    listDiv.innerHTML = `
      <div class="overflow-x-auto">
        <div class="min-w-[680px] divide-y divide-slate-100 dark:divide-white/5">
          <div class="px-5 py-3 bg-slate-50 dark:bg-[#0c0c12] flex items-center text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">
            <span class="flex-1">File Path</span>
            <span class="w-36">Expires</span>
            <span class="w-24 text-center">Views</span>
            <span class="w-24 text-center">Status</span>
            <span class="w-28 text-right">Actions</span>
          </div>
          ${links.map(l => `
            <div class="px-5 py-3 flex items-center text-xs hover:bg-blue-500/5 transition-colors">
              <div class="flex-1 min-w-0 pr-3 truncate font-semibold text-slate-900 dark:text-white">
                ${escapeHtml(l.file_path)}
              </div>
              <span class="w-36 font-mono tabular-nums text-slate-500 dark:text-slate-400">${l.expires_at ? new Date(l.expires_at).toLocaleDateString() : 'Never'}</span>
              <span class="w-24 text-center font-mono tabular-nums font-semibold text-slate-900 dark:text-white">${l.view_count}</span>
              <span class="w-24 text-center font-semibold">
                ${l.is_active && !l.isExpired
                  ? '<span class="text-emerald-600 dark:text-emerald-400">Active</span>'
                  : '<span class="text-rose-500">Expired</span>'}
              </span>
              <div class="w-28 text-right flex items-center justify-end gap-1.5">
                <button onclick="copyToClipboard('${escapeHtml(l.shareUrl)}', this, 'Share URL copied!')" class="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors" title="Copy Link">
                  <i data-lucide="copy" class="w-4 h-4"></i>
                </button>
                <button onclick="revokeShareLink('${l.id}')" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors" title="Revoke Link">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function revokeShareLink(token) {
  if (!confirm('Revoke this share link?')) return;
  apiRequest('/share/revoke', {
    method: 'POST',
    body: { token }
  })
  .then(() => {
    showToast('Share link revoked!', 'success');
    renderShareLinksTab(document.getElementById('tab-content-area'));
  })
  .catch(err => showToast(err.message, 'error'));
}

// ==========================================
// 6. DASHBOARD & PROFILE COMPONENT
// ==========================================
// ==========================================
// 6. DASHBOARD & PROFILE COMPONENT (VERCEL DASHBOARD PATTERN)
// ==========================================
async function renderDashboardTab(container) {
  const userName = AppState.user ? (AppState.user.name || AppState.user.username) : 'Operator';

  container.innerHTML = `
    <div class="space-y-6 tab-pane-enter">
      <!-- Enterprise Console Greeting Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-white/10 pb-5">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Welcome back, ${escapeHtml(userName)}</h1>
          <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span>Workspace Storage Console</span>
            <span aria-hidden="true">·</span>
            <span>S3 v4 & Vercel Blob Cluster</span>
            <span aria-hidden="true">·</span>
            <span id="dash-bandwidth-reset" class="font-mono tabular-nums">Monthly Cycle</span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <button onclick="triggerNavbarFileUpload()" class="zencloud-btn-primary px-3.5 py-2 text-xs rounded-lg flex items-center gap-1.5 whitespace-nowrap">
            <i data-lucide="upload-cloud" class="w-3.5 h-3.5"></i>
            <span>Upload Files</span>
          </button>
          <button onclick="openCreateFolderModal()" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-200 hover:border-blue-500/40 flex items-center gap-1.5 transition-colors whitespace-nowrap">
            <i data-lucide="folder-plus" class="w-3.5 h-3.5 text-blue-500"></i>
            <span>New Folder</span>
          </button>
          <button onclick="navigateTabToSection('s3cluster', 'api-keys-section')" class="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-200 hover:border-blue-500/40 flex items-center gap-1.5 transition-colors whitespace-nowrap">
            <i data-lucide="key" class="w-3.5 h-3.5 text-blue-500"></i>
            <span>API Keys</span>
          </button>
        </div>
      </div>

      <!-- 4-Column Telemetry KPI Strip -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Storage Used</span>
              <i data-lucide="hard-drive" class="w-4 h-4 text-blue-500"></i>
            </div>
            <div class="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mb-3" id="dash-storage-text">Loading...</div>
          </div>
          <div>
            <div class="w-full bg-slate-200 dark:bg-white/10 h-1.5 rounded-full overflow-hidden mb-2">
              <div id="dash-storage-bar" class="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              <span id="dash-storage-percent">0% allocated</span>
              <span id="dash-storage-remaining">—</span>
            </div>
          </div>
        </div>

        <div onclick="navigateTab('files')" class="glass-card pitch-card-hover p-5 rounded-xl cursor-pointer flex flex-col justify-between group">
          <div>
            <div class="flex items-center justify-between mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Stored Objects</span>
              <i data-lucide="folder" class="w-4 h-4 text-blue-500"></i>
            </div>
            <div class="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mb-3" id="dash-files-count">...</div>
          </div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-1 border-t border-slate-200/70 dark:border-white/5">
            <span>Root directory items</span>
            <span class="text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1">Browse <i data-lucide="arrow-right" class="w-3 h-3"></i></span>
          </div>
        </div>

        <div class="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Monthly Bandwidth</span>
              <i data-lucide="activity" class="w-4 h-4 text-emerald-500"></i>
            </div>
            <div class="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mb-3" id="dash-bandwidth-text">0 / 15 GB</div>
          </div>
          <div>
            <div class="w-full bg-slate-200 dark:bg-white/10 h-1.5 rounded-full overflow-hidden mb-2">
              <div id="dash-bandwidth-bar" class="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              <span>Zero Egress</span>
              <span id="dash-bandwidth-cap">15 GB Limit</span>
            </div>
          </div>
        </div>

        <div class="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Monthly API Calls</span>
              <i data-lucide="zap" class="w-4 h-4 text-blue-500"></i>
            </div>
            <div class="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mb-3" id="dash-api-text">0 / 100k</div>
          </div>
          <div>
            <div class="w-full bg-slate-200 dark:bg-white/10 h-1.5 rounded-full overflow-hidden mb-2">
              <div id="dash-api-bar" class="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              <span id="dash-api-percent">0% used</span>
              <span id="dash-api-cap">100,000 Limit</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Real-Data SVG Utilization Overview + Cluster Gateways -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Real-Data SVG Utilization Ring -->
        <div class="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Storage Allocation</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">Live capacity breakdown</p>
            </div>
            <span class="text-xs font-mono tabular-nums text-blue-600 dark:text-blue-400 font-semibold" id="dash-svg-ratio">0%</span>
          </div>

          <div class="flex items-center gap-5 my-auto py-2">
            <div class="relative w-28 h-28 shrink-0">
              <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="10" class="text-slate-200 dark:text-white/10"></circle>
                <circle id="dash-svg-ring-arc" cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" stroke-width="10" stroke-linecap="round" stroke-dasharray="251.2" stroke-dashoffset="251.2" class="transition-all duration-500"></circle>
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span id="dash-svg-ring-pct" class="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">0%</span>
                <span class="text-[10px] text-slate-500 dark:text-slate-400">Used</span>
              </div>
            </div>

            <div class="flex-1 min-w-0 space-y-2.5 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-slate-500 dark:text-slate-400">Allocated Used</span>
                <span id="dash-svg-used" class="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">0 Bytes</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-500 dark:text-slate-400">Available Free</span>
                <span id="dash-svg-free" class="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">—</span>
              </div>
              <div class="pt-2 border-t border-slate-200 dark:border-white/10 flex items-center justify-between">
                <span class="text-slate-500 dark:text-slate-400">Cycle Transfer</span>
                <span id="dash-svg-bw-val" class="font-mono tabular-nums text-blue-600 dark:text-blue-400 font-semibold">0 Bytes</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Active Infrastructure Gateways -->
        <div class="lg:col-span-2 glass-card p-5 rounded-xl flex flex-col justify-between space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Infrastructure Gateways</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">Connected file system and object protocol endpoints</p>
            </div>
            <div class="relative w-full sm:w-56">
              <i data-lucide="search" class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
              <input type="text" id="dash-search-input" oninput="filterDashboardVolumes(this.value)" placeholder="Filter gateways..." class="w-full pitch-input rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none">
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5" id="dash-volume-cards">
            <div onclick="navigateTab('files')" class="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500/40 transition-colors cursor-pointer flex flex-col justify-between gap-3">
              <div>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-semibold text-slate-900 dark:text-white truncate">Workspace SFTP</span>
                  <span class="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Online</span>
                </div>
                <div class="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate" id="dash-card-file-count">Scanning files...</div>
              </div>
              <div class="pt-2.5 border-t border-slate-200 dark:border-white/10 flex items-center justify-between text-[11px]">
                <span id="dash-volume-usage-text" class="font-mono tabular-nums text-slate-600 dark:text-slate-300 truncate">0 Bytes</span>
                <span class="text-blue-600 dark:text-blue-400 font-semibold shrink-0">Open</span>
              </div>
            </div>

            <div onclick="navigateTab('s3cluster')" class="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500/40 transition-colors cursor-pointer flex flex-col justify-between gap-3">
              <div>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-semibold text-slate-900 dark:text-white truncate">Vercel Blob API</span>
                  <span class="text-[11px] font-medium text-blue-600 dark:text-blue-400">Ready</span>
                </div>
                <div class="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">/api/v1/blob</div>
              </div>
              <div class="pt-2.5 border-t border-slate-200 dark:border-white/10 flex items-center justify-between text-[11px]">
                <span class="text-slate-500 dark:text-slate-400 truncate">put · del · list · head</span>
                <span class="text-blue-600 dark:text-blue-400 font-semibold shrink-0">Docs</span>
              </div>
            </div>

            <div onclick="navigateTab('s3cluster')" class="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d0d12] hover:border-blue-500/40 transition-colors cursor-pointer flex flex-col justify-between gap-3">
              <div>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-semibold text-slate-900 dark:text-white truncate">AWS S3 v4 Gateway</span>
                  <span class="text-[11px] font-medium text-blue-600 dark:text-blue-400">Ready</span>
                </div>
                <div class="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">/api/s3</div>
              </div>
              <div class="pt-2.5 border-t border-slate-200 dark:border-white/10 flex items-center justify-between text-[11px]">
                <span class="text-slate-500 dark:text-slate-400 truncate">Boto3 · SDK v3</span>
                <span class="text-blue-600 dark:text-blue-400 font-semibold shrink-0">Keys</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Workspace Files & Security Activity -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 glass-card rounded-xl overflow-hidden">
          <div class="px-5 py-3.5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <i data-lucide="clock" class="w-4 h-4 text-blue-500"></i>
              <h3 class="text-xs font-semibold text-slate-900 dark:text-white">Recent Workspace Files</h3>
            </div>
            <button onclick="navigateTab('files')" class="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
              View All <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
            </button>
          </div>
          <div id="dash-recent-files">
            <div class="p-6 text-center text-xs text-slate-500">Loading recent workspace files...</div>
          </div>
        </div>

        <div class="space-y-4">
          <div class="glass-card rounded-xl overflow-hidden">
            <div class="px-5 py-3.5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <i data-lucide="shield-check" class="w-4 h-4 text-emerald-500"></i>
                <h3 class="text-xs font-semibold text-slate-900 dark:text-white">Security & Logins</h3>
              </div>
              <span class="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate" id="dash-ip-badge">Detecting IP...</span>
            </div>
            <div id="dash-recent-logins" class="p-4 text-xs text-slate-600 dark:text-slate-400">
              Loading recent login records...
            </div>
          </div>
          <div id="dash-contact-details" class="space-y-3"></div>
        </div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();

  try {
    const [profile, fileData] = await Promise.all([
      apiRequest('/auth/profile'),
      apiRequest('/files/list?path=/').catch(() => ({ files: [] }))
    ]);

    const used = Number(profile.user.usedStorageBytes || 0);
    const total = Math.max(1, Number(profile.user.storage_quota_bytes || 10737418240));
    const pct = Math.min(100, Math.round((used / total) * 100));
    const remaining = Math.max(0, total - used);

    const storageTextEl = document.getElementById('dash-storage-text');
    if (storageTextEl) storageTextEl.innerText = `${formatBytes(used)} / ${formatBytes(total)}`;
    const storageBarEl = document.getElementById('dash-storage-bar');
    if (storageBarEl) storageBarEl.style.width = `${pct}%`;
    const storagePctEl = document.getElementById('dash-storage-percent');
    if (storagePctEl) storagePctEl.innerText = `${pct}% allocated`;
    const storageRemEl = document.getElementById('dash-storage-remaining');
    if (storageRemEl) storageRemEl.innerText = `${formatBytes(remaining)} free`;

    // Real-Data SVG Utilization Ring
    const ringArc = document.getElementById('dash-svg-ring-arc');
    const ringPct = document.getElementById('dash-svg-ring-pct');
    const svgRatio = document.getElementById('dash-svg-ratio');
    const svgUsed = document.getElementById('dash-svg-used');
    const svgFree = document.getElementById('dash-svg-free');
    const circumference = 251.2;
    if (ringArc) ringArc.style.strokeDashoffset = String(circumference - (circumference * pct) / 100);
    if (ringPct) ringPct.innerText = `${pct}%`;
    if (svgRatio) svgRatio.innerText = `${pct}% used`;
    if (svgUsed) svgUsed.innerText = formatBytes(used);
    if (svgFree) svgFree.innerText = formatBytes(remaining);

    const volumeUsageEl = document.getElementById('dash-volume-usage-text');
    if (volumeUsageEl) volumeUsageEl.innerText = `${formatBytes(used)} (${pct}%)`;

    const files = Array.isArray(fileData.files) ? fileData.files : [];
    const filesCountEl = document.getElementById('dash-files-count');
    if (filesCountEl) filesCountEl.innerText = `${files.length} items`;
    const cardFileCountEl = document.getElementById('dash-card-file-count');
    if (cardFileCountEl) cardFileCountEl.innerText = `${files.length} objects in root`;

    const recentFilesDiv = document.getElementById('dash-recent-files');
    if (recentFilesDiv) {
      if (files.length === 0) {
        recentFilesDiv.innerHTML = `
          <div class="p-8 text-center text-slate-500 text-xs space-y-3">
            <div>No files in your workspace root yet.</div>
            <button onclick="triggerNavbarFileUpload()" class="zencloud-btn-primary px-4 py-2 rounded-lg text-xs inline-flex items-center gap-1.5">
              <i data-lucide="upload-cloud" class="w-3.5 h-3.5"></i> Upload First File
            </button>
          </div>`;
      } else {
        const topFiles = files.slice(0, 6);
        recentFilesDiv.innerHTML = `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 dark:bg-[#0d0d12] text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-white/10">
                <tr>
                  <th class="px-4 py-2.5">Name</th>
                  <th class="px-4 py-2.5 text-right">Size</th>
                  <th class="px-4 py-2.5 text-right">Modified</th>
                  <th class="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200 dark:divide-white/5">
                ${topFiles.map(f => {
                  const icon = f.isDirectory ? 'folder' : getFileIcon(f.name);
                  const iconColor = f.isDirectory ? 'text-blue-500' : 'text-slate-500 dark:text-slate-300';
                  const encodedPath = encodeURIComponent(f.path);
                  return `
                    <tr class="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer" onclick="${f.isDirectory ? `navigateToPath(decodeURIComponent('${encodedPath}'))` : `handleFileClick(decodeURIComponent('${encodedPath}'))`}">
                      <td class="px-4 py-2.5 font-medium text-slate-900 dark:text-white flex items-center gap-2 truncate max-w-[240px]">
                        <i data-lucide="${icon}" class="w-4 h-4 ${iconColor} shrink-0"></i>
                        <span class="truncate" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
                      </td>
                      <td class="px-4 py-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        ${f.isDirectory ? 'Folder' : formatBytes(f.size)}
                      </td>
                      <td class="px-4 py-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        ${f.mtime ? new Date(f.mtime).toLocaleDateString() : '—'}
                      </td>
                      <td class="px-4 py-2.5 text-right whitespace-nowrap">
                        <button onclick="event.stopPropagation(); ${f.isDirectory ? `navigateToPath(decodeURIComponent('${encodedPath}'))` : `handleFileClick(decodeURIComponent('${encodedPath}'))`}" class="text-blue-600 dark:text-blue-400 hover:underline font-semibold">
                          ${f.isDirectory ? 'Open' : 'View'}
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    }

    if (profile.currentIp && profile.currentIp.ipV4) {
      const ipBadge = document.getElementById('dash-ip-badge');
      if (ipBadge) ipBadge.innerText = `IP: ${profile.currentIp.ipV4}`;
    }

    const usage = profile.usage || profile.user?.usage;
    if (usage) {
      if (usage.bandwidth) {
        const bwEl = document.getElementById('dash-bandwidth-text');
        if (bwEl) bwEl.innerText = `${usage.bandwidth.formattedUsed} / ${usage.bandwidth.formattedLimit}`;
        const bwCapEl = document.getElementById('dash-bandwidth-cap');
        if (bwCapEl) bwCapEl.innerText = `${usage.bandwidth.formattedLimit} Cap`;
        const bwBarEl = document.getElementById('dash-bandwidth-bar');
        if (bwBarEl) bwBarEl.style.width = `${Math.min(100, usage.bandwidth.percentUsed)}%`;
        const svgBw = document.getElementById('dash-svg-bw-val');
        if (svgBw) svgBw.innerText = usage.bandwidth.formattedUsed || '0 Bytes';
        if (usage.bandwidth.isExceeded && bwEl) bwEl.classList.add('text-red-500');
      }
      if (usage.apiRequests) {
        const apiEl = document.getElementById('dash-api-text');
        if (apiEl) apiEl.innerText = `${usage.apiRequests.formattedUsed} / ${usage.apiRequests.formattedLimit}`;
        const apiCapEl = document.getElementById('dash-api-cap');
        if (apiCapEl) apiCapEl.innerText = `${usage.apiRequests.formattedLimit} Cap`;
        const apiBarEl = document.getElementById('dash-api-bar');
        if (apiBarEl) apiBarEl.style.width = `${Math.min(100, usage.apiRequests.percentUsed)}%`;
        const apiPctEl = document.getElementById('dash-api-percent');
        if (apiPctEl) apiPctEl.innerText = `${usage.apiRequests.percentUsed}% used`;
        if (usage.apiRequests.isExceeded && apiEl) apiEl.classList.add('text-red-500');
      }
      if (usage.daysUntilReset !== undefined) {
        const resetEl = document.getElementById('dash-bandwidth-reset');
        if (resetEl) resetEl.innerText = `Cycle resets in ${usage.daysUntilReset}d`;
      }
    }

    const loginDiv = document.getElementById('dash-recent-logins');
    if (loginDiv) {
      const activity = profile.recentActivity || [];
      if (activity.length === 0) {
        loginDiv.innerHTML = '<div class="text-slate-500 py-2">No recent login records.</div>';
      } else {
        loginDiv.innerHTML = `
          <div class="divide-y divide-slate-200 dark:divide-white/5">
            ${activity.slice(0, 4).map(a => `
              <div class="py-2.5 flex items-center justify-between gap-2 text-xs">
                <span class="font-mono tabular-nums text-slate-800 dark:text-slate-200 font-semibold truncate">${escapeHtml(a.ip_v4 || 'Unknown IP')}</span>
                <span class="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">${new Date(a.timestamp).toLocaleDateString()}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
    }

    const publicSettings = await fetch('/api/public/settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const details = document.getElementById('dash-contact-details');
    if (details && publicSettings) {
      const cards = [];
      if (publicSettings.discordEnabled && publicSettings.discordJoinUrl) {
        cards.push(`
          <div class="glass-card p-4 rounded-xl flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 shrink-0">
                <i data-lucide="message-circle" class="w-4 h-4"></i>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-slate-900 dark:text-white">Discord Community</div>
                <div class="text-[11px] text-slate-500 truncate">Developer support & updates</div>
              </div>
            </div>
            <a href="${escapeHtml(publicSettings.discordJoinUrl)}" target="_blank" rel="noopener noreferrer" class="zencloud-btn-primary text-xs px-3 py-1.5 rounded-lg shrink-0">Join</a>
          </div>
        `);
      }
      if (publicSettings.contactEmailEnabled && publicSettings.contactEmail) {
        cards.push(`
          <div class="glass-card p-4 rounded-xl flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 shrink-0">
                <i data-lucide="mail" class="w-4 h-4"></i>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-slate-900 dark:text-white">Support Contact</div>
                <div class="text-[11px] text-slate-500 truncate">${escapeHtml(publicSettings.contactEmail)}</div>
              </div>
            </div>
            <a href="mailto:${escapeHtml(publicSettings.contactEmail)}" class="border border-slate-200 dark:border-white/10 hover:border-blue-500/40 text-slate-900 dark:text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shrink-0">Email</a>
          </div>
        `);
      }
      details.innerHTML = cards.join('');
    }
    if (window.lucide) lucide.createIcons();
  } catch (err) {}
}

function filterDashboardVolumes(query) {
  const q = (query || '').toLowerCase().trim();
  const cards = document.querySelectorAll('#dash-volume-cards > div');
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}

// ==========================================
// VERCEL SETTINGS COMPONENT (SUB-NAV & VERCEL CARDS)
// ==========================================
async function renderProfileTab(container) {
  let usage = null;
  try {
    const profile = await apiRequest('/auth/profile');
    usage = profile.usage;
    AppState.profileUsage = usage;
  } catch (err) {}
  container.innerHTML = `
    <div class="space-y-6 tab-pane-enter max-w-5xl">
      <div class="border-b border-slate-200 dark:border-white/10 pb-5">
        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Account Settings</h1>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Manage your identity, security credentials, and monthly resource limits.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-6 lg:gap-8">
        <!-- Left Sub-Navigation -->
        <div class="md:col-span-1 space-y-1">
          <button onclick="switchSettingsSection('general')" id="set-tab-general" class="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 transition-colors">
            General
          </button>
          <button onclick="switchSettingsSection('security')" id="set-tab-security" class="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
            Security &amp; Auth
          </button>
          <button onclick="switchSettingsSection('usage')" id="set-tab-usage" class="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
            Usage &amp; Limits
          </button>
          <button onclick="navigateTabToSection('s3cluster', 'api-keys-section')" class="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors flex items-center justify-between">
            <span>S3 &amp; Tokens</span>
            <i data-lucide="external-link" class="w-3 h-3 text-slate-400"></i>
          </button>
        </div>

        <!-- Right Cards -->
        <div class="md:col-span-3 space-y-6" id="settings-content-pane">
          <div class="glass-card rounded-xl overflow-hidden">
            <div class="p-6 space-y-4">
              <div>
                <h2 class="text-base font-semibold text-slate-900 dark:text-white">Display Name</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Enter your full name or operator label displayed across your workspace.</p>
              </div>
              <div>
                <input type="text" id="prof-name" value="${escapeHtml(AppState.user.name || '')}" class="w-full sm:w-80 pitch-input rounded-lg px-3 py-2 text-xs" placeholder="Your Full Name">
              </div>
            </div>
            <div class="border-t border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-[#09090d] px-6 py-3 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
              <span>Maximum 32 characters recommended.</span>
              <button onclick="handleSaveName()" class="zencloud-btn-primary px-3.5 py-1.5 rounded-lg text-xs">Save</button>
            </div>
          </div>

          <div class="glass-card rounded-xl overflow-hidden">
            <div class="p-6 space-y-4">
              <div>
                <h2 class="text-base font-semibold text-slate-900 dark:text-white">Username</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Your URL namespace and SFTP/bucket owner identifier within the cluster.</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono text-slate-500 dark:text-slate-400">zenstorage.io/</span>
                <input type="text" id="prof-username" value="${escapeHtml(AppState.user.username)}" class="w-full sm:w-64 pitch-input rounded-lg px-3 py-2 text-xs font-mono">
              </div>
            </div>
            <div class="border-t border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-[#09090d] px-6 py-3 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
              <span>Must be alphanumeric.</span>
              <button onclick="handleSaveUsername()" class="zencloud-btn-primary px-3.5 py-1.5 rounded-lg text-xs">Save</button>
            </div>
          </div>

          <div class="glass-card rounded-xl overflow-hidden">
            <div class="p-6 space-y-4">
              <div>
                <h2 class="text-base font-semibold text-slate-900 dark:text-white">Email Address</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Current email: <strong class="text-slate-900 dark:text-white font-mono">${escapeHtml(AppState.user.email)}</strong></p>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">New Email</label>
                  <input type="email" id="email-new-input" class="w-full pitch-input rounded-lg px-3 py-2 text-xs" placeholder="newemail@example.com">
                </div>
                <div>
                  <label class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Current Password Verification</label>
                  <input type="password" id="email-pass-input" class="w-full pitch-input rounded-lg px-3 py-2 text-xs" placeholder="••••••••">
                </div>
              </div>
            </div>
            <div class="border-t border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-[#09090d] px-6 py-3 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
              <span>Verification link will be sent to the new address.</span>
              <button onclick="handleEmailChangeDirect()" class="zencloud-btn-primary px-3.5 py-1.5 rounded-lg text-xs">Send Verification</button>
            </div>
          </div>

          <div class="glass-card rounded-xl overflow-hidden">
            <div class="p-6 space-y-4">
              <div>
                <h2 class="text-base font-semibold text-slate-900 dark:text-white">Password</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Rotate your password across SFTP and dashboard sessions.</p>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Current Password</label>
                  <input type="password" id="prof-curr-pass" class="w-full pitch-input rounded-lg px-3 py-2 text-xs">
                </div>
                <div>
                  <label class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">New Password</label>
                  <input type="password" id="prof-new-pass" class="w-full pitch-input rounded-lg px-3 py-2 text-xs">
                </div>
              </div>
            </div>
            <div class="border-t border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-[#09090d] px-6 py-3 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
              <span>Minimum 8 characters.</span>
              <button onclick="handleSavePassword()" class="zencloud-btn-primary px-3.5 py-1.5 rounded-lg text-xs">Change Password</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

function switchSettingsSection(section) {
  const tabs = ['general', 'security', 'usage'];
  tabs.forEach(t => {
    const el = document.getElementById(`set-tab-${t}`);
    if (el) {
      if (t === section) {
        el.className = 'w-full text-left px-3 py-2 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 transition-colors';
      } else {
        el.className = 'w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors';
      }
    }
  });
  const pane = document.getElementById('settings-content-pane');
  if (!pane) return;
  if (section === 'general') {
    renderProfileTab(document.getElementById('tab-content-area'));
  } else if (section === 'security') {
    pane.innerHTML = `
      <div class="glass-card rounded-xl overflow-hidden">
        <div class="p-6 space-y-4">
          <div>
            <h2 class="text-base font-semibold text-slate-900 dark:text-white">Password</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Change your account password to maintain security across SFTP and console sessions.</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Current Password</label>
              <input type="password" id="prof-curr-pass" class="w-full pitch-input rounded-lg px-3 py-2 text-xs">
            </div>
            <div>
              <label class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">New Password</label>
              <input type="password" id="prof-new-pass" class="w-full pitch-input rounded-lg px-3 py-2 text-xs">
            </div>
          </div>
        </div>
        <div class="border-t border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-[#09090d] px-6 py-3 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
          <span>Minimum 8 characters.</span>
          <button onclick="handleSavePassword()" class="zencloud-btn-primary px-3.5 py-1.5 rounded-lg text-xs">Change Password</button>
        </div>
      </div>
      <div class="glass-card rounded-xl overflow-hidden">
        <div class="p-6">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h2 class="text-base font-semibold text-slate-900 dark:text-white">Security Review &amp; OTP Challenge</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Automated 4-digit security challenge triggered when suspicious activity or review flags occur.</p>
            </div>
            <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
              <i data-lucide="shield-check" class="w-4 h-4"></i>
              <span>Active</span>
            </span>
          </div>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  } else if (section === 'usage') {
    const usage = AppState.profileUsage || {};
    const bwUsed = usage.bandwidth?.formattedUsed || '0 Bytes';
    const bwLimit = usage.bandwidth?.formattedLimit || '15.00 GB';
    const bwPct = Math.min(100, Math.max(0, Number(usage.bandwidth?.percentUsed || 0)));
    const apiUsed = usage.apiRequests?.formattedUsed || '0';
    const apiLimit = usage.apiRequests?.formattedLimit || '100,000';
    const apiPct = Math.min(100, Math.max(0, Number(usage.apiRequests?.percentUsed || 0)));
    const resetDays = usage.daysUntilReset !== undefined ? `Resets in ${usage.daysUntilReset} days` : 'Monthly billing cycle';
    pane.innerHTML = `
      <div class="glass-card rounded-xl overflow-hidden">
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <h2 class="text-base font-semibold text-slate-900 dark:text-white">Monthly Bandwidth Policy</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">High-speed CDN transfer allocation · ${escapeHtml(resetDays)}</p>
            </div>
            <span class="font-mono tabular-nums text-xs font-semibold text-blue-600 dark:text-blue-400">${bwPct.toFixed(1)}%</span>
          </div>
          <div class="p-4 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 space-y-2">
            <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span class="font-medium text-slate-800 dark:text-slate-200">Bandwidth Consumption</span>
              <span class="font-mono tabular-nums">${escapeHtml(bwUsed)} / ${escapeHtml(bwLimit)}</span>
            </div>
            <div class="w-full bg-slate-200 dark:bg-white/10 h-1.5 rounded-full overflow-hidden">
              <div class="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300" style="width: ${bwPct}%"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="glass-card rounded-xl overflow-hidden">
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <h2 class="text-base font-semibold text-slate-900 dark:text-white">S3 &amp; Blob API Requests Policy</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Monthly API calls allocated for PUT, GET, DELETE, and multipart operations.</p>
            </div>
            <span class="font-mono tabular-nums text-xs font-semibold text-blue-600 dark:text-blue-400">${apiPct.toFixed(1)}%</span>
          </div>
          <div class="p-4 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 space-y-2">
            <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span class="font-medium text-slate-800 dark:text-slate-200">API Requests</span>
              <span class="font-mono tabular-nums">${escapeHtml(String(apiUsed))} / ${escapeHtml(String(apiLimit))}</span>
            </div>
            <div class="w-full bg-slate-200 dark:bg-white/10 h-1.5 rounded-full overflow-hidden">
              <div class="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300" style="width: ${apiPct}%"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }
}

async function handleSaveName() {
  const name = document.getElementById('prof-name')?.value.trim();
  try {
    await apiRequest('/auth/profile', {
      method: 'PUT',
      body: { name, username: AppState.user.username }
    });
    AppState.user.name = name;
    localStorage.setItem('vps_user', JSON.stringify(AppState.user));
    showToast('Name saved successfully', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSaveUsername() {
  const username = document.getElementById('prof-username')?.value.trim();
  try {
    await apiRequest('/auth/profile', {
      method: 'PUT',
      body: { name: AppState.user.name, username }
    });
    AppState.user.username = username;
    localStorage.setItem('vps_user', JSON.stringify(AppState.user));
    showToast('Username saved successfully', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSavePassword() {
  const currentPassword = document.getElementById('prof-curr-pass')?.value;
  const newPassword = document.getElementById('prof-new-pass')?.value;
  if (!currentPassword || !newPassword) {
    showToast('Please provide both current and new password', 'error');
    return;
  }
  try {
    await apiRequest('/auth/profile', {
      method: 'PUT',
      body: { 
        name: AppState.user.name, 
        username: AppState.user.username,
        currentPassword, 
        newPassword 
      }
    });
    showToast('Password updated successfully', 'success');
    if (document.getElementById('prof-curr-pass')) document.getElementById('prof-curr-pass').value = '';
    if (document.getElementById('prof-new-pass')) document.getElementById('prof-new-pass').value = '';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleEmailChangeDirect() {
  const newEmail = document.getElementById('email-new-input')?.value.trim();
  const password = document.getElementById('email-pass-input')?.value;
  if (!newEmail || !password) {
    showToast('Please enter new email and current password', 'error');
    return;
  }
  try {
    const data = await apiRequest('/auth/email/request-change', {
      method: 'POST',
      body: { newEmail, password }
    });
    showToast(data.message || 'Verification link sent', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleProfileUpdate(e) {
  e.preventDefault();
  const name = document.getElementById('prof-name').value;
  const username = document.getElementById('prof-username').value;
  const currentPassword = document.getElementById('prof-curr-pass').value;
  const newPassword = document.getElementById('prof-new-pass').value;

  try {
    await apiRequest('/auth/profile', {
      method: 'PUT',
      body: { name, username, currentPassword, newPassword }
    });
    AppState.user.name = name;
    AppState.user.username = username;
    localStorage.setItem('vps_user', JSON.stringify(AppState.user));
    showToast('Profile updated!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleEmailChangeRequest(e) {
  e.preventDefault();
  const newEmail = document.getElementById('email-new-input').value;
  const password = document.getElementById('email-pass-input').value;

  try {
    const data = await apiRequest('/auth/email/request-change', {
      method: 'POST',
      body: { newEmail, password }
    });
    showToast(data.message, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 7. SYSTEM ADMIN PORTAL (VPS PTY Console, Users, SMTP, Logs)
// ==========================================
function filterAdminUsersTable(query) {
  AppState.adminUserSearch = query || '';
  const q = AppState.adminUserSearch.trim().toLowerCase();
  const rows = document.querySelectorAll('#admin-users-rows > [data-user-row]');
  let visible = 0;
  rows.forEach(row => {
    const hay = (row.getAttribute('data-user-search') || '').toLowerCase();
    const match = !q || hay.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  const countEl = document.getElementById('admin-users-visible-count');
  if (countEl) countEl.textContent = `${visible} shown`;
}

async function renderAdminPortalTab(container) {
  const getTabClass = (tabKey) => {
    const isActive = AppState.adminTab === tabKey;
    if (isActive) {
      return 'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-blue-600 text-white shadow-sm whitespace-nowrap';
    }
    return 'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-white dark:bg-[#111116] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10 hover:border-blue-500/40 whitespace-nowrap';
  };
  const isConsoleActive = AppState.adminTab === 'console';
  container.innerHTML = `
    <div class="space-y-6 tab-pane-enter">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">System Admin Console</h1>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Global tenant management, disk quotas, SMTP relays, security logs, and root shell.</p>
        </div>
      </div>

      <!-- Admin Navigation Sub-Tabs -->
      <div id="admin-subtab-nav" class="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-white/10 pb-3">
        <button data-admin-subtab="overview" onclick="switchAdminSubTab('overview')" class="${getTabClass('overview')}">Overview</button>
        <button data-admin-subtab="users" onclick="switchAdminSubTab('users')" class="${getTabClass('users')}">User Management</button>
        <button data-admin-subtab="storage" onclick="switchAdminSubTab('storage')" class="${getTabClass('storage')}">Storage</button>
        <button data-admin-subtab="download-monitor" onclick="switchAdminSubTab('download-monitor')" class="${getTabClass('download-monitor')}">URL Downloads</button>
        <button data-admin-subtab="ip-history" onclick="switchAdminSubTab('ip-history')" class="${getTabClass('ip-history')}">IP Tracking</button>
        <button data-admin-subtab="smtp" onclick="switchAdminSubTab('smtp')" class="${getTabClass('smtp')}">SMTP Config</button>
        <button data-admin-subtab="email-templates" onclick="switchAdminSubTab('email-templates')" class="${getTabClass('email-templates')}">Email Templates</button>
        <button data-admin-subtab="details" onclick="switchAdminSubTab('details')" class="${getTabClass('details')}">Details</button>
        <button data-admin-subtab="settings" onclick="switchAdminSubTab('settings')" class="${getTabClass('settings')}">App Settings</button>
        <button data-admin-subtab="audit-logs" onclick="switchAdminSubTab('audit-logs')" class="${getTabClass('audit-logs')}">Audit Logs</button>

        <button data-admin-subtab="console" onclick="switchAdminSubTab('console')" class="ml-auto ${isConsoleActive ? 'bg-blue-600 text-white shadow-sm' : 'bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10 hover:border-blue-500/40'} px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap">
          <i data-lucide="terminal" class="w-3.5 h-3.5"></i>
          <span>VPS SSH Console</span>
        </button>
      </div>
      <div id="admin-subtab-area"></div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  renderAdminSubTabContent();
}

function switchAdminSubTab(tab) {
  AppState.adminTab = tab;
  const navContainer = document.getElementById('admin-subtab-nav');
  if (navContainer) {
    const buttons = navContainer.querySelectorAll('[data-admin-subtab]');
    buttons.forEach(btn => {
      const subtab = btn.getAttribute('data-admin-subtab');
      if (subtab === tab) {
        if (subtab === 'console') {
          btn.className = 'ml-auto bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap';
        } else {
          btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-blue-600 text-white shadow-sm whitespace-nowrap';
        }
      } else {
        if (subtab === 'console') {
          btn.className = 'ml-auto bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10 hover:border-blue-500/40 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap';
        } else {
          btn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-white dark:bg-[#111116] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10 hover:border-blue-500/40 whitespace-nowrap';
        }
      }
    });
  }
  renderAdminSubTabContent();
}

async function renderAdminSubTabContent() {
  const area = document.getElementById('admin-subtab-area');
  if (!area) return;
  area.innerHTML = '<div class="glass-card p-6 rounded-xl text-xs text-slate-500">Loading...</div>';
  try {
    if (AppState.adminTab === 'overview') {
      const stats = await apiRequest('/admin/stats');
      area.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="glass-card p-5 rounded-xl"><div class="text-xs text-slate-500 dark:text-slate-400 font-medium">Total Users</div><div class="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">${stats.totalUsers}</div></div>
          <div class="glass-card p-5 rounded-xl"><div class="text-xs text-slate-500 dark:text-slate-400 font-medium">Active Users</div><div class="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">${stats.activeUsers}</div></div>
          <div class="glass-card p-5 rounded-xl"><div class="text-xs text-slate-500 dark:text-slate-400 font-medium">Suspended Users</div><div class="text-2xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400 mt-1">${stats.suspendedUsers}</div></div>
          <div class="glass-card p-5 rounded-xl"><div class="text-xs text-slate-500 dark:text-slate-400 font-medium">Suspicious Flagged</div><div class="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">${stats.suspiciousAccounts}</div></div>
        </div>
        <div class="grid lg:grid-cols-2 gap-4 mt-4">
          <div class="glass-card p-5 rounded-xl">
            <h2 class="text-sm font-semibold text-slate-900 dark:text-white mb-3">Recent Registrations</h2>
            <div class="space-y-2">${(stats.recentRegistrations || []).map(u => `<div class="flex justify-between gap-3 text-xs py-1 border-b border-slate-100 dark:border-white/5 last:border-0"><span class="text-slate-800 dark:text-slate-200 font-medium truncate">${escapeHtml(u.username)}</span><span class="font-mono tabular-nums text-slate-500">${new Date(u.created_at).toLocaleDateString()}</span></div>`).join('') || '<div class="text-xs text-slate-500">No registrations yet.</div>'}</div>
          </div>
          <div class="glass-card p-5 rounded-xl">
            <h2 class="text-sm font-semibold text-slate-900 dark:text-white mb-3">Recent Logins</h2>
            <div class="space-y-2">${(stats.recentLogins || []).map(l => `<div class="flex justify-between gap-3 text-xs py-1 border-b border-slate-100 dark:border-white/5 last:border-0"><span class="text-slate-800 dark:text-slate-200 truncate">${escapeHtml(l.username)} · ${escapeHtml(l.status)}</span><span class="font-mono tabular-nums text-slate-500">${escapeHtml(l.ip_v4 || l.ip_v6 || 'unknown')}</span></div>`).join('') || '<div class="text-xs text-slate-500">No logins yet.</div>'}</div>
          </div>
        </div>`;
    } else if (AppState.adminTab === 'users') {
      const users = await apiRequest('/admin/users');
      AppState.adminUsers = users;
      area.innerHTML = `
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900 dark:text-white">User Management (${users.length})</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage storage quotas, monthly bandwidth, API limits, OTP security flags, and status.</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <div class="relative">
                <i data-lucide="search" class="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"></i>
                <input id="admin-users-search" type="text" value="${escapeHtml(AppState.adminUserSearch || '')}" oninput="filterAdminUsersTable(this.value)" placeholder="Filter users..." class="pitch-input rounded-lg pl-8 pr-3 py-1.5 text-xs w-48 sm:w-56">
              </div>
              <span id="admin-users-visible-count" class="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">${users.length} shown</span>
              <button onclick="openCreateUserModal()" class="zencloud-btn-primary text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 whitespace-nowrap">
                <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
                <span>Create User</span>
              </button>
            </div>
          </div>
          <div class="glass-card rounded-xl overflow-hidden">
            <div class="admin-table-scroll"><div class="min-w-[1360px]">
              <div class="px-4 py-3 bg-slate-50 dark:bg-[#0c0c12] flex items-center text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">
                <span class="w-12">ID</span><span class="flex-1">User</span><span class="w-28">Role</span><span class="w-36">Storage</span><span class="w-36">Bandwidth</span><span class="w-32">API Calls</span><span class="w-44 text-center">Status</span><span class="w-64 text-right">Actions</span>
              </div>
              <div id="admin-users-rows" class="divide-y divide-slate-100 dark:divide-white/5">
                ${users.map(u => {
                  const isSelf = AppState.user && Number(u.id) === Number(AppState.user.id);
                  const searchKey = `${u.name || ''} ${u.username || ''} ${u.email || ''} ${u.role || ''}`.toLowerCase();
                  return `
                  <div data-user-row data-user-search="${escapeHtml(searchKey)}" class="px-4 py-3 flex items-center text-xs hover:bg-blue-500/5 transition-colors">
                    <span class="w-12 font-mono tabular-nums text-slate-500">#${u.id}</span>
                    <div class="flex-1 min-w-0 pr-3">
                      <div class="font-semibold text-slate-900 dark:text-white truncate">${escapeHtml(u.name)} (${escapeHtml(u.username)}) ${isSelf ? '<span class="text-[10px] text-blue-600 dark:text-blue-400 font-semibold ml-1">YOU</span>' : ''}</div>
                      <div class="text-slate-500 dark:text-slate-400 truncate">${escapeHtml(u.email)}</div>
                    </div>
                    <div class="w-28">
                      <select ${isSelf ? 'disabled' : ''} onchange="changeUserRole('${u.id}', this.value)" class="pitch-input rounded-lg px-2 py-1 text-xs ${isSelf ? 'opacity-50 cursor-not-allowed' : ''}">
                        <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                      </select>
                    </div>
                    <span class="w-36 font-mono tabular-nums ${u.isOverQuota ? 'text-rose-500 font-bold' : 'text-slate-700 dark:text-slate-300'}">${formatBytes(u.realUsedBytes)} / ${formatBytes(u.storage_quota_bytes)}</span>
                    <span class="w-36 font-mono tabular-nums text-slate-700 dark:text-slate-300">${u.bandwidthFormattedUsed} / ${u.bandwidthFormattedLimit}</span>
                    <span class="w-32 font-mono tabular-nums text-blue-600 dark:text-blue-400">${u.apiRequestsFormattedUsed} / ${u.apiRequestsFormattedLimit}</span>
                    <span class="w-44 text-center">
                      ${u.is_suspended
                        ? `<span class="text-[11px] font-semibold text-rose-600 dark:text-rose-400 cursor-help" title="${u.suspension_reason ? 'Suspended: ' + escapeHtml(u.suspension_reason) : 'Suspended'}">Suspended</span>`
                        : (u.requires_otp_verification || u.is_suspicious)
                          ? `<span class="text-[11px] font-semibold text-amber-600 dark:text-amber-400 inline-flex items-center gap-1 cursor-help" title="Security verification required. OTP code: ${escapeHtml(u.otp_code || 'Sent')} | Reason: ${escapeHtml(u.otp_reason || u.suspicious_reason || 'Security check')}"><i data-lucide="shield-alert" class="w-3 h-3"></i> Verification (${u.otp_code || 'OTP'})</span>`
                          : `<span class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Active</span>`
                      }
                    </span>
                    <div class="w-64 text-right flex items-center justify-end gap-1">
                      <button onclick="inspectUserDirectory('${u.id}', decodeURIComponent('${encodeURIComponent(u.username)}'))" class="p-1.5 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg transition-colors" title="Browse / Inspect ${escapeHtml(u.username)}'s Directory"><i data-lucide="folder-open" class="w-4 h-4"></i></button>
                      <button onclick="openEditUserModal('${u.id}')" class="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors" title="Edit User &amp; Quotas"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                      <button onclick="resetUserUsagePrompt('${u.id}', decodeURIComponent('${encodeURIComponent(u.username)}'))" class="p-1.5 text-slate-500 dark:text-slate-400 hover:text-emerald-500 rounded-lg transition-colors" title="Reset Monthly Bandwidth &amp; API Cycle"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>
                      <button onclick="editUserQuotaPrompt('${u.id}', '${u.storage_quota_bytes}')" class="p-1.5 text-slate-500 dark:text-slate-400 hover:text-blue-500 rounded-lg transition-colors" title="Edit Storage Quota"><i data-lucide="hard-drive" class="w-4 h-4"></i></button>
                      ${!isSelf ? (u.requires_otp_verification
                        ? `
                          <button onclick="handleLiftVerification('${u.id}', decodeURIComponent('${encodeURIComponent(u.username)}'))" class="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors" title="Lift 4-Digit OTP Verification"><i data-lucide="shield-check" class="w-4 h-4"></i></button>
                          <button onclick="handleAdminResendOtp('${u.id}', decodeURIComponent('${encodeURIComponent(u.username)}'))" class="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors" title="Resend 4-Digit OTP Code via Email"><i data-lucide="mail" class="w-4 h-4"></i></button>
                        `
                        : `
                          <button onclick="openPutOnVerificationModal('${u.id}', decodeURIComponent('${encodeURIComponent(u.username)}'), decodeURIComponent('${encodeURIComponent(u.email || '')}'), decodeURIComponent('${encodeURIComponent(u.name || '')}'))" class="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors" title="Put on 4-Digit OTP Security Verification"><i data-lucide="shield-alert" class="w-4 h-4 text-amber-500"></i></button>
                        `
                      ) : ''}
                      ${!isSelf ? (u.is_suspended
                        ? `<button onclick="openUnsuspendUserModal('${u.id}', decodeURIComponent('${encodeURIComponent(u.username)}'), decodeURIComponent('${encodeURIComponent(u.email || '')}'), decodeURIComponent('${encodeURIComponent(u.name || '')}'))" class="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors" title="Unsuspend / Reactivate User"><i data-lucide="check-circle" class="w-4 h-4"></i></button>`
                        : `<button onclick="openSuspendUserModal('${u.id}', decodeURIComponent('${encodeURIComponent(u.username)}'), decodeURIComponent('${encodeURIComponent(u.email || '')}'), decodeURIComponent('${encodeURIComponent(u.name || '')}'))" class="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors" title="Suspend User (with Reason &amp; Auto Mail)"><i data-lucide="ban" class="w-4 h-4"></i></button>`
                      ) : ''}
                      ${!isSelf ? `<button onclick="deleteUserPrompt('${u.id}', decodeURIComponent('${encodeURIComponent(u.username)}'))" class="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg transition-colors" title="Delete User"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div></div>
          </div>
        </div>
      `;
      if (AppState.adminUserSearch) filterAdminUsersTable(AppState.adminUserSearch);
    } else if (AppState.adminTab === 'storage') {
      const data = await apiRequest('/admin/storage');
      const fsd = data.filesystem || {};
      const summary = data.summary || {};
      const pct = Math.min(100, Math.max(0, Number(fsd.usagePercent || 0)));
      const fmt = b => formatBytes(Number(b || 0));
      const r = 42;
      const circ = 2 * Math.PI * r;
      const offset = circ * (1 - pct / 100);
      area.innerHTML = `
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Storage Overview</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Live VPS filesystem utilization and user quota consumption.</p>
            </div>
            <button onclick="renderAdminSubTabContent()" class="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-200 text-xs font-medium hover:border-blue-500/40 transition-colors">Refresh</button>
          </div>
          <div class="glass-card p-5 rounded-xl flex flex-col sm:flex-row sm:items-center gap-6">
            <div class="relative w-24 h-24 shrink-0">
              <svg class="w-full h-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="${r}" fill="none" stroke="currentColor" stroke-width="8" class="text-slate-200 dark:text-white/10"></circle>
                <circle cx="50" cy="50" r="${r}" fill="none" stroke="${pct >= 90 ? '#ef4444' : '#3b82f6'}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <span class="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">${pct.toFixed(0)}%</span>
              </div>
            </div>
            <div class="flex-1 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-slate-900 dark:text-white">VPS Filesystem Volume</span>
                <span class="text-xs font-mono tabular-nums font-semibold ${pct >= 90 ? 'text-rose-500' : 'text-blue-600 dark:text-blue-400'}">${pct.toFixed(1)}% utilized</span>
              </div>
              <div class="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                <div class="h-full ${pct >= 90 ? 'bg-rose-500' : 'bg-blue-600 dark:bg-blue-500'}" style="width:${pct}%"></div>
              </div>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div><div class="text-slate-500 dark:text-slate-400">Total</div><div class="text-slate-900 dark:text-white font-mono tabular-nums font-semibold mt-0.5">${fmt(fsd.totalBytes)}</div></div>
                <div><div class="text-slate-500 dark:text-slate-400">Used</div><div class="text-slate-900 dark:text-white font-mono tabular-nums font-semibold mt-0.5">${fmt(fsd.usedBytes)}</div></div>
                <div><div class="text-slate-500 dark:text-slate-400">Free</div><div class="text-slate-900 dark:text-white font-mono tabular-nums font-semibold mt-0.5">${fmt(fsd.freeBytes)}</div></div>
                <div><div class="text-slate-500 dark:text-slate-400">Available</div><div class="text-slate-900 dark:text-white font-mono tabular-nums font-semibold mt-0.5">${fmt(fsd.availableBytes)}</div></div>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="glass-card p-4 rounded-xl"><div class="text-xs text-slate-500 dark:text-slate-400">Total Users</div><div class="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">${summary.totalUsers || 0}</div></div>
            <div class="glass-card p-4 rounded-xl"><div class="text-xs text-slate-500 dark:text-slate-400">Total Allocated</div><div class="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">${fmt(summary.totalAllocatedBytes)}</div></div>
            <div class="glass-card p-4 rounded-xl"><div class="text-xs text-slate-500 dark:text-slate-400">Total User Used</div><div class="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">${fmt(summary.totalUsedBytes)}</div></div>
            <div class="glass-card p-4 rounded-xl"><div class="text-xs text-slate-500 dark:text-slate-400">Total Remaining</div><div class="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">${fmt(summary.totalRemainingBytes)}</div></div>
          </div>
          <div class="glass-card rounded-xl overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-200 dark:border-white/10"><h3 class="text-sm font-semibold text-slate-900 dark:text-white">User Storage</h3><p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Actual files versus configured quota.</p></div>
            <div class="admin-table-scroll"><table class="min-w-[1050px] w-full text-xs"><thead><tr class="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0c0c12]"><th class="p-3">User</th><th class="p-3">Email</th><th class="p-3">Role</th><th class="p-3">Allocated</th><th class="p-3">Used</th><th class="p-3">Remaining</th><th class="p-3">Usage</th><th class="p-3">Status</th></tr></thead><tbody class="divide-y divide-slate-100 dark:divide-white/5">
              ${(data.users || []).map(u => `<tr class="hover:bg-blue-500/5 transition-colors"><td class="p-3 font-semibold text-slate-900 dark:text-white">${escapeHtml(u.username)}</td><td class="p-3 text-slate-500 dark:text-slate-400">${escapeHtml(u.email)}</td><td class="p-3 text-slate-700 dark:text-slate-300">${escapeHtml(u.role)}</td><td class="p-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">${fmt(u.allocatedBytes)}</td><td class="p-3 font-mono tabular-nums ${u.isOverQuota ? 'text-rose-500 font-bold' : 'text-slate-800 dark:text-slate-200'}">${fmt(u.usedBytes)}${u.isOverQuota ? ` · Overused by ${fmt(u.overageBytes)}` : ''}</td><td class="p-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">${fmt(u.remainingBytes)}</td><td class="p-3 font-mono tabular-nums ${u.isOverQuota ? 'text-rose-500 font-bold' : 'text-slate-700 dark:text-slate-300'}">${Number(u.usagePercent || 0).toFixed(1)}%</td><td class="p-3 text-slate-700 dark:text-slate-300">${escapeHtml(u.status)}</td></tr>`).join('') || '<tr><td colspan="8" class="p-8 text-center text-slate-500">No users found.</td></tr>'}
            </tbody></table></div>
          </div>
        </div>`;
    } else if (AppState.adminTab === 'download-monitor') {
      const result = await apiRequest('/admin/download-monitor-logs?limit=50&page=1');
      const logs = result.items || [];
      area.innerHTML = `
        <div class="glass-card rounded-xl overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div><h2 class="text-sm font-semibold text-slate-900 dark:text-white">URL Download Monitoring</h2><p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Download/share endpoint metadata only; file contents are never stored in logs.</p></div>
            <div class="flex items-center gap-2"><span class="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">${result.total || 0} records</span><button onclick="clearAdminLogs('download-monitor')" class="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">Clear Logs</button></div>
          </div>
          <div class="admin-table-scroll"><table class="min-w-[1500px] w-full text-xs"><thead><tr class="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0c0c12]"><th class="p-3">Time</th><th class="p-3">User</th><th class="p-3">IP</th><th class="p-3">File</th><th class="p-3">Size</th><th class="p-3">Endpoint</th><th class="p-3">Status</th><th class="p-3">HTTP</th><th class="p-3">Completed</th><th class="p-3">Error</th></tr></thead><tbody class="divide-y divide-slate-100 dark:divide-white/5">
          ${logs.map(l => `<tr class="hover:bg-blue-500/5 transition-colors"><td class="p-3 text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap">${new Date(l.started_at).toLocaleString()}</td><td class="p-3 text-slate-800 dark:text-slate-200">${escapeHtml(l.username || 'Public')}</td><td class="p-3 font-mono text-slate-800 dark:text-white">${escapeHtml(l.ip_address || '—')}</td><td class="p-3 text-slate-900 dark:text-white font-medium">${escapeHtml(l.file_name || l.file_path || '—')}</td><td class="p-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">${fmtBytesForAdmin(l.file_size_bytes)}</td><td class="p-3 text-slate-500 dark:text-slate-400 max-w-[350px] truncate" title="${escapeHtml(l.requested_url || '')}">${escapeHtml(l.endpoint || l.requested_url || '—')}</td><td class="p-3 ${l.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : l.status === 'failed' ? 'text-rose-500' : 'text-amber-500'} font-semibold">${escapeHtml(l.status)}</td><td class="p-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">${escapeHtml(String(l.http_status || '—'))}</td><td class="p-3 text-slate-500 dark:text-slate-400 font-mono tabular-nums">${l.completed_at ? new Date(l.completed_at).toLocaleString() : '—'}</td><td class="p-3 text-rose-500 max-w-[300px] truncate">${escapeHtml(l.error || '—')}</td></tr>`).join('') || '<tr><td colspan="10" class="p-8 text-center text-slate-500">No download records found.</td></tr>'}
          </tbody></table></div>
        </div>`;
    } else if (AppState.adminTab === 'ip-history') {
      const historyResult = await apiRequest('/admin/ip-history?limit=50&page=1');
      const loginHistory = historyResult.items || [];
      area.innerHTML = `
        <div class="glass-card p-5 rounded-xl">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h2 class="text-sm font-semibold text-slate-900 dark:text-white">IP Tracking</h2><p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Known registration and login IP addresses.</p></div><div class="flex items-center gap-2"><span class="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">${historyResult.total || 0} records</span><button onclick="clearAdminLogs('ip-history')" class="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">Clear Logs</button></div></div>
          <div class="admin-table-scroll"><table class="min-w-[820px] w-full text-xs"><thead><tr class="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10"><th class="py-3 pr-3">User</th><th class="py-3 pr-3">IPv4</th><th class="py-3 pr-3">IPv6</th><th class="py-3 pr-3">Action</th><th class="py-3">Time</th></tr></thead><tbody class="divide-y divide-slate-100 dark:divide-white/5">
            ${loginHistory.map(r => `<tr class="hover:bg-blue-500/5 transition-colors"><td class="py-3 pr-3"><div class="font-semibold text-slate-900 dark:text-white">${escapeHtml(r.username)}</div><div class="text-slate-500 dark:text-slate-400">${escapeHtml(r.email)}</div></td><td class="py-3 pr-3 font-mono text-slate-800 dark:text-white">${escapeHtml(r.ip_v4 || '—')}</td><td class="py-3 pr-3 font-mono text-slate-600 dark:text-slate-300">${escapeHtml(r.ip_v6 || '—')}</td><td class="py-3 pr-3"><span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 font-medium">${escapeHtml(r.action)}</span></td><td class="py-3 font-mono tabular-nums text-slate-500 dark:text-slate-400">${new Date(r.timestamp).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="5" class="p-8 text-center text-slate-500">No IP records found.</td></tr>'}
          </tbody></table></div>
        </div>`;
    } else if (AppState.adminTab === 'smtp') {
      const smtp = await apiRequest('/admin/smtp');
      area.innerHTML = `
        <div class="max-w-xl glass-card p-6 rounded-xl space-y-4">
          <h2 class="text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">SMTP Server Settings</h2>
          <form onsubmit="handleSaveSmtp(event)" class="space-y-3 text-xs">
            <div><label class="block text-slate-600 dark:text-slate-400 font-medium mb-1">SMTP Host</label><input type="text" id="smtp-host" value="${escapeHtml(smtp.host)}" class="w-full pitch-input rounded-lg px-3 py-2"></div>
            <div class="grid grid-cols-2 gap-3"><div><label class="block text-slate-600 dark:text-slate-400 font-medium mb-1">Port</label><input type="number" id="smtp-port" value="${smtp.port || 587}" class="w-full pitch-input rounded-lg px-3 py-2 font-mono tabular-nums"></div><div><label class="block text-slate-600 dark:text-slate-400 font-medium mb-1">Encryption</label><select id="smtp-enc" class="w-full pitch-input rounded-lg px-3 py-2"><option value="STARTTLS" ${smtp.encryption === 'STARTTLS' ? 'selected' : ''}>STARTTLS</option><option value="SSL/TLS" ${smtp.encryption === 'SSL/TLS' ? 'selected' : ''}>SSL/TLS</option><option value="NONE" ${smtp.encryption === 'NONE' ? 'selected' : ''}>None</option></select></div></div>
            <div><label class="block text-slate-600 dark:text-slate-400 font-medium mb-1">Username</label><input type="text" id="smtp-user" value="${escapeHtml(smtp.username)}" class="w-full pitch-input rounded-lg px-3 py-2"></div>
            <div><label class="block text-slate-600 dark:text-slate-400 font-medium mb-1">From Email</label><input type="email" id="smtp-from-email" value="${escapeHtml(smtp.from_email || smtp.username || '')}" placeholder="support@example.com" class="w-full pitch-input rounded-lg px-3 py-2"><p class="text-[11px] text-slate-500 mt-1">For Zoho, use the same mailbox/domain address allowed to send mail.</p></div>
            <div><label class="block text-slate-600 dark:text-slate-400 font-medium mb-1">From Name</label><input type="text" id="smtp-from-name" value="${escapeHtml(smtp.from_name || '')}" class="w-full pitch-input rounded-lg px-3 py-2"></div>
            <div><label class="block text-slate-600 dark:text-slate-400 font-medium mb-1">Password</label><input type="password" id="smtp-pass" placeholder="Leave blank to keep current password" class="w-full pitch-input rounded-lg px-3 py-2"></div>
            <div class="flex flex-wrap gap-2 pt-2"><button type="submit" class="zencloud-btn-primary px-4 py-2 rounded-lg text-xs">Save Settings</button><button type="button" onclick="testSmtpPrompt()" class="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-200 font-semibold hover:border-blue-500/40 transition-colors">Send Test Email</button></div>
          </form>
        </div>`;
    } else if (AppState.adminTab === 'email-templates') {
      const templates = await apiRequest('/admin/email-templates');
      area.innerHTML = `
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Email Notification Templates</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage automated emails for suspensions, reactivations, welcomes, and OTP alerts.</p>
            </div>
            <button onclick="renderAdminSubTabContent()" class="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1.5 hover:border-blue-500/40 transition-colors">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Refresh
            </button>
          </div>
          <div class="grid md:grid-cols-2 gap-4">
            ${templates.map(t => {
              const isSuspendTpl = t.slug === 'user_suspended';
              const isUnsuspendTpl = t.slug === 'user_unsuspended';
              const slugColor = isSuspendTpl ? 'text-rose-500' : isUnsuspendTpl ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400';
              return `
              <div class="glass-card p-5 rounded-xl flex flex-col justify-between gap-4">
                <div>
                  <div class="flex items-center justify-between gap-2 mb-2">
                    <span class="font-semibold text-sm text-slate-900 dark:text-white">${escapeHtml(t.name)}</span>
                    <span class="font-mono text-[11px] font-semibold ${slugColor}">${escapeHtml(t.slug)}</span>
                  </div>
                  <div class="text-xs text-slate-500 dark:text-slate-400 mb-1"><strong>Subject:</strong> <span class="text-slate-800 dark:text-slate-200">${escapeHtml(t.subject)}</span></div>
                </div>
                <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-white/10">
                  <button onclick="openEditEmailTemplateModal('${escapeHtml(t.slug)}')" class="zencloud-btn-primary px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Edit Template
                  </button>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    } else if (AppState.adminTab === 'settings') {
      const settings = await apiRequest('/admin/settings');
      const enabled = String(settings.anti_multi_account_enabled) === 'true';
      const quotaGb = (parseInt(settings.default_storage_quota_bytes || '10737418240', 10) / 1073741824).toFixed(2);
      area.innerHTML = `
        <form onsubmit="handleSaveAppSettings(event)" class="max-w-2xl space-y-4">
          <div class="glass-card p-6 rounded-xl space-y-4">
            <div><h2 class="text-sm font-semibold text-slate-900 dark:text-white">Application Settings</h2><p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Changes are stored in the database and used system-wide.</p></div>
            <label class="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10"><span><span class="block text-xs font-semibold text-slate-900 dark:text-white">Anti multi-account protection</span><span class="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Block registrations from a known IP.</span></span><input id="setting-anti-multi" type="checkbox" ${enabled ? 'checked' : ''} class="w-4 h-4 accent-blue-600"></label>
            <div class="grid sm:grid-cols-2 gap-4"><div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Application Name</label><input id="setting-app-name" value="${escapeHtml(settings.app_name || '')}" class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div><div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Website Title</label><input id="setting-website-title" value="${escapeHtml(settings.website_title || settings.app_name || '')}" class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div></div>
            <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Application URL</label><input id="setting-app-url" value="${escapeHtml(settings.app_url || '')}" class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono"></div>
            <div class="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10"><div class="w-12 h-12 rounded-lg bg-white dark:bg-[#111116] border border-slate-200 dark:border-white/10 flex items-center justify-center overflow-hidden shrink-0">${settings.website_icon_url ? `<img src="${escapeHtml(settings.website_icon_url)}" alt="Website icon" class="w-full h-full object-contain">` : '<i data-lucide="image" class="w-5 h-5 text-slate-400"></i>'}</div><div class="flex-1 min-w-[180px]"><div class="text-sm font-semibold text-slate-900 dark:text-white">Website Icon</div><div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">PNG, JPG, WEBP, GIF or ICO, maximum 2 MB.</div></div><input id="setting-website-icon-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,.ico" class="hidden" onchange="uploadWebsiteIcon(event)"><button type="button" onclick="document.getElementById('setting-website-icon-file').click()" class="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-200 font-semibold text-xs hover:border-blue-500/40 transition-colors">Upload Icon</button></div>
            <div class="grid sm:grid-cols-3 gap-4"><div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Default Storage (GB)</label><input id="setting-quota-gb" type="number" min="1" step="0.01" value="${quotaGb}" class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono tabular-nums"></div><div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Max Share Links/User</label><input id="setting-max-shares" type="number" min="1" value="${escapeHtml(settings.max_share_links_per_user || '3')}" class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono tabular-nums"></div><div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Session Timeout (Hours)</label><input id="setting-timeout" type="number" min="1" value="${escapeHtml(settings.session_timeout_hours || '24')}" class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono tabular-nums"></div></div>
            <button type="submit" class="zencloud-btn-primary px-4 py-2.5 rounded-lg text-xs">Save Application Settings</button>
          </div>
        </form>`;
    } else if (AppState.adminTab === 'details') {
      const settings = await apiRequest('/admin/settings');
      area.innerHTML = `
        <form onsubmit="handleSaveAdminDetails(event)" class="max-w-2xl space-y-4">
          <div class="glass-card p-6 rounded-xl space-y-4">
            <div><h2 class="text-sm font-semibold text-slate-900 dark:text-white">Details</h2><p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Control which support links appear on the workspace dashboard.</p></div>
            <label class="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10"><span><span class="block text-xs font-semibold text-slate-900 dark:text-white">Show Discord section</span><span class="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Show the Discord server join button on the dashboard.</span></span><input id="details-discord-enabled" type="checkbox" ${String(settings.discord_enabled) === 'true' ? 'checked' : ''} class="w-4 h-4 accent-blue-600"></label>
            <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Discord Join Link</label><input id="details-discord-url" type="url" value="${escapeHtml(settings.discord_join_url || '')}" placeholder="https://discord.gg/yourserver" class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div>
            <label class="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10"><span><span class="block text-xs font-semibold text-slate-900 dark:text-white">Show Contact Email</span><span class="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Show a contact email card on the dashboard.</span></span><input id="details-contact-enabled" type="checkbox" ${String(settings.contact_email_enabled) === 'true' ? 'checked' : ''} class="w-4 h-4 accent-blue-600"></label>
            <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Contact Email</label><input id="details-contact-email" type="email" value="${escapeHtml(settings.contact_email || '')}" placeholder="support@example.com" class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div>
            <button type="submit" class="zencloud-btn-primary px-4 py-2.5 rounded-lg text-xs">Save Details</button>
          </div>
        </form>`;
    } else if (AppState.adminTab === 'audit-logs') {
      const auditResult = await apiRequest('/admin/audit-logs?limit=50&page=1');
      const logs = auditResult.items || [];
      area.innerHTML = `
        <div class="glass-card rounded-xl overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-sm font-semibold text-slate-900 dark:text-white">Audit Logs</h2><p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Recent administrative and user security events.</p></div><div class="flex items-center gap-2"><span class="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">${auditResult.total || 0} records</span><button onclick="clearAdminLogs('audit-logs')" class="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">Clear Logs</button></div></div>
          <div class="admin-table-scroll"><table class="min-w-[900px] w-full text-xs"><thead><tr class="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0c0c12]"><th class="p-3">Time</th><th class="p-3">User</th><th class="p-3">Action</th><th class="p-3">IP</th><th class="p-3">Details</th></tr></thead><tbody class="divide-y divide-slate-100 dark:divide-white/5">
            ${logs.map(log => `<tr class="hover:bg-blue-500/5 transition-colors"><td class="p-3 text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap">${new Date(log.timestamp).toLocaleString()}</td><td class="p-3 text-slate-900 dark:text-slate-200 font-medium">${escapeHtml(log.username || 'System')}</td><td class="p-3"><span class="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">${escapeHtml(log.action)}</span></td><td class="p-3 font-mono text-slate-800 dark:text-white">${escapeHtml(log.ip_address || '—')}</td><td class="p-3 text-slate-500 dark:text-slate-400 max-w-[420px] truncate" title="${escapeHtml(log.details || '')}">${escapeHtml(log.details || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="p-8 text-center text-slate-500">No audit logs found.</td></tr>'}
          </tbody></table></div>
        </div>`;
    } else if (AppState.adminTab === 'console') {
      renderTerminalConsole(area);
      return;
    } else {
      area.innerHTML = '<div class="glass-card p-6 rounded-xl text-xs text-slate-500">This admin section is not available yet.</div>';
    }
  } catch (err) {
    area.innerHTML = `<div class="glass-card p-6 rounded-xl border border-rose-500/20 bg-rose-500/5"><div class="text-sm font-semibold text-rose-500">Failed to load this admin section</div><div class="text-xs text-slate-500 dark:text-slate-400 mt-1">${escapeHtml(err.message)}</div><button onclick="renderAdminSubTabContent()" class="mt-4 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-200 text-xs font-semibold">Retry</button></div>`;
  }
  if (window.lucide) lucide.createIcons();
}

function fmtBytesForAdmin(value) {
  const n = Number(value || 0);
  if (!n) return '—';
  return formatBytes(n);
}

async function clearAdminLogs(type) {
  const messages = {
    'audit-logs': 'Are you sure you want to permanently clear all audit logs? This action cannot be undone.',
    'ip-history': 'Are you sure you want to permanently clear all IP tracking logs? This action cannot be undone.',
    'download-monitor': 'Are you sure you want to permanently clear all URL download monitoring logs? This action cannot be undone.'
  };
  const endpoints = {
    'audit-logs': '/admin/audit-logs',
    'ip-history': '/admin/ip-history',
    'download-monitor': '/admin/download-monitor-logs'
  };
  if (!confirm(messages[type])) return;
  try {
    await apiRequest(endpoints[type], { method: 'DELETE' });
    showToast('Logs cleared successfully.', 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message || 'Failed to clear logs.', 'error');
  }
}

async function uploadWebsiteIcon(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) return showToast('Please select an image file.', 'error');
  if (file.size > 2 * 1024 * 1024) return showToast('Website icon must be 2 MB or smaller.', 'error');

  const formData = new FormData();
  formData.append('icon', file);
  try {
    const result = await apiRequest('/admin/settings/icon', { method: 'POST', body: formData });
    showToast('Website icon uploaded!', 'success');
    applyWebsiteBranding(result.iconUrl, document.getElementById('setting-website-title')?.value.trim());
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function applyWebsiteBranding(iconUrl, title) {
  if (title) document.title = title;
  if (iconUrl) {
    let link = document.querySelector('link[data-site-favicon]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.dataset.siteFavicon = 'true';
      document.head.appendChild(link);
    }
    link.href = `${iconUrl}?v=${Date.now()}`;
  }
}

async function handleSaveAppSettings(e) {
  e.preventDefault();
  const quotaGb = parseFloat(document.getElementById('setting-quota-gb')?.value || '0');
  if (!(quotaGb > 0)) return showToast('Storage quota must be greater than 0.', 'error');

  try {
    await apiRequest('/admin/settings', {
      method: 'POST',
      body: {
        anti_multi_account_enabled: document.getElementById('setting-anti-multi').checked ? 'true' : 'false',
        default_storage_quota_bytes: String(Math.round(quotaGb * 1073741824)),
        max_share_links_per_user: String(Math.max(1, parseInt(document.getElementById('setting-max-shares').value || '1', 10))),
        app_name: document.getElementById('setting-app-name').value.trim(),
        website_title: document.getElementById('setting-website-title').value.trim(),
        app_url: document.getElementById('setting-app-url').value.trim(),
        session_timeout_hours: String(Math.max(1, parseInt(document.getElementById('setting-timeout').value || '24', 10)))
      }
    });
    applyWebsiteBranding(null, document.getElementById('setting-website-title').value.trim());
    showToast('Application settings saved!', 'success');
    renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderTerminalConsole(container) {
  const currentMode = activeTerminalMode;
  const modeActiveCls = 'bg-blue-600 text-white font-semibold shadow-sm';
  const modeIdleCls = 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
  container.innerHTML = `
    <div class="glass-card p-5 rounded-xl space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-white/10 pb-3">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <i data-lucide="terminal" class="w-4 h-4"></i>
          </div>
          <div>
            <h2 class="text-sm font-semibold text-slate-900 dark:text-white">VPS SSH Terminal Session</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400">Interactive live bash shell for administrative server control.</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2.5">
          <div class="flex items-center bg-slate-100 dark:bg-[#09090d] p-1 rounded-lg border border-slate-200 dark:border-white/10 text-xs">
            <button onclick="setConsoleTerminalMode('auto')" class="px-2.5 py-1 rounded-md transition-colors ${currentMode === 'auto' ? modeActiveCls : modeIdleCls}" title="Auto: Tries WebSocket, falls back instantly to HTTP Stream if blocked">
              Auto (WS + Fallback)
            </button>
            <button onclick="setConsoleTerminalMode('http')" class="px-2.5 py-1 rounded-md transition-colors ${currentMode === 'http' ? modeActiveCls : modeIdleCls}" title="HTTP Stream: Reliable streaming through Cloudflare & restrictive reverse proxies">
              HTTP Stream
            </button>
            <button onclick="setConsoleTerminalMode('ws')" class="px-2.5 py-1 rounded-md transition-colors ${currentMode === 'ws' ? modeActiveCls : modeIdleCls}" title="WebSocket: Pure low-latency WebSocket connection">
              WebSocket
            </button>
          </div>
          <span id="terminal-status-badge" class="text-xs text-amber-600 dark:text-amber-400 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
            Connecting...
          </span>
          <button onclick="initXtermTerminal()" class="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111116] text-slate-700 dark:text-slate-200 hover:border-blue-500/40 text-xs font-semibold flex items-center gap-1.5 transition-colors">
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Reconnect
          </button>
        </div>
      </div>
      <div id="terminal-container" class="w-full h-[460px] bg-black rounded-xl p-3 border border-slate-800 dark:border-white/10 overflow-hidden shadow-xl"></div>
      <!-- VPS Troubleshooting Helper Card -->
      <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-3.5">
        <details class="group">
          <summary class="flex items-center justify-between cursor-pointer list-none text-xs font-bold text-slate-700 dark:text-slate-300">
            <span class="flex items-center gap-2">
              <i data-lucide="help-circle" class="w-4 h-4 text-white"></i>
              VPS Deployment Notice: Solving "WebSocket Disconnected" on Custom Domains (Nginx / Cloudflare)
            </span>
            <span class="transition group-open:rotate-180 text-slate-400">▾</span>
          </summary>
          <div class="mt-3 text-xs text-slate-600 dark:text-slate-400 space-y-2 leading-relaxed border-t border-slate-200 dark:border-slate-800 pt-3">
            <p>
              If your VPS console showed <span class="font-mono text-red-400">WebSocket Error</span>, ZenStorage now <b>automatically falls back to HTTP Streaming</b> so you can use the interactive shell right away!
            </p>
            <p>
              To enable high-speed direct <b>WebSockets</b> on your VPS Nginx reverse proxy:
            </p>
            <pre class="bg-slate-900 text-slate-200 p-3 rounded-lg overflow-x-auto text-[11px] font-mono border border-slate-800">
# In /etc/nginx/sites-available/vps-storage:
location /api/admin/console {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400s;
}
            </pre>
            <p class="text-[11px] text-slate-500">
              <b>Cloudflare tip:</b> If your domain (e.g. <code>storage.zendevelopment.in</code>) uses Cloudflare proxy, verify that <b>WebSockets</b> is enabled in your Cloudflare dashboard under <i>Network → WebSockets</i> (enabled by default on all Cloudflare accounts).
            </p>
          </div>
        </details>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    initXtermTerminal();
  }, 100);
}

let activeTerminalSocket = null;
let activeTerminalInstance = null;
let activeFitAddon = null;
let activeHttpConsoleAbort = null;
let activeHttpConsoleSessionId = null;
let activeTerminalMode = localStorage.getItem('zen_console_mode') || 'auto'; // 'auto', 'ws', 'http'

function setConsoleTerminalMode(mode) {
  activeTerminalMode = mode;
  localStorage.setItem('zen_console_mode', mode);
  const area = document.getElementById('tab-content-area');
  if (area && AppState.adminTab === 'console') {
    renderTerminalConsole(area);
  } else {
    initXtermTerminal();
  }
}

async function startHttpConsoleSession(term, badge, applyFit) {
  if (activeHttpConsoleAbort) {
    try { activeHttpConsoleAbort.abort(); } catch (_) {}
    activeHttpConsoleAbort = null;
  }
  if (activeHttpConsoleSessionId) {
    const sId = activeHttpConsoleSessionId;
    activeHttpConsoleSessionId = null;
    apiRequest('/admin/console/close', { method: 'POST', body: { sessionId: sId } }).catch(() => {});
  }

  if (badge) {
    badge.className = 'text-xs text-amber-500 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20';
    badge.innerHTML = 'Connecting via HTTP Stream...';
  }

  const abortController = new AbortController();
  activeHttpConsoleAbort = abortController;

  try {
    term.write('\r\n\x1b[36m[Connecting via Interactive HTTP Streaming Shell...]\x1b[0m\r\n');
    const token = AppState.token || '';
    const res = await fetch(`/api/admin/console/stream?token=${encodeURIComponent(token)}`, {
      signal: abortController.signal,
      cache: 'no-store'
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status} ${res.statusText}`);
    }

    let sessionId = res.headers.get('X-Console-Session-Id');

    if (badge) {
      badge.className = 'text-xs text-emerald-500 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Live SSH (HTTP Stream)';
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');

    // Attach keyboard listener
    term.onData(async (data) => {
      if (!activeHttpConsoleSessionId) return;
      try {
        await fetch('/api/admin/console/input', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AppState.token}`
          },
          body: JSON.stringify({ sessionId: activeHttpConsoleSessionId, data })
        });
      } catch (err) {
        console.warn('Console input write error:', err);
      }
    });

    // Attach resize listener
    term.onResize(async ({ cols, rows }) => {
      if (!activeHttpConsoleSessionId) return;
      try {
        await fetch('/api/admin/console/resize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AppState.token}`
          },
          body: JSON.stringify({ sessionId: activeHttpConsoleSessionId, cols, rows })
        });
      } catch (_) {}
    });

    applyFit();
    term.focus();

    // Stream reading loop
    let isFirstChunk = true;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let text = decoder.decode(value, { stream: true });
      if (isFirstChunk) {
        isFirstChunk = false;
        const match = text.match(/\[SESSION_ID:([a-f0-9]+)\]\r?\n?/);
        if (match) {
          sessionId = match[1];
          text = text.replace(/\[SESSION_ID:[a-f0-9]+\]\r?\n?/, '');
        }
        activeHttpConsoleSessionId = sessionId;
        if (term.cols && term.rows) {
          fetch('/api/admin/console/resize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AppState.token}` },
            body: JSON.stringify({ sessionId, cols: term.cols, rows: term.rows })
          }).catch(() => {});
        }
      }
      if (text) term.write(text);
    }

    if (badge) {
      badge.className = 'text-xs text-slate-400 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-500/10 border border-slate-500/20';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-slate-500"></span> Session Ended';
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (badge) {
      badge.className = 'text-xs text-red-500 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> Disconnected';
    }
    term.write(`\r\n\x1b[31m[HTTP Stream Connection Error: ${err.message}]\x1b[0m\r\n`);
  }
}

function initXtermTerminal() {
  const container = document.getElementById('terminal-container');
  const badge = document.getElementById('terminal-status-badge');
  if (!container) return;

  // Cleanup existing socket session if open
  if (activeTerminalSocket) {
    try { activeTerminalSocket.close(); } catch (e) {}
    activeTerminalSocket = null;
  }
  // Cleanup existing HTTP session if open
  if (activeHttpConsoleAbort) {
    try { activeHttpConsoleAbort.abort(); } catch (_) {}
    activeHttpConsoleAbort = null;
  }
  if (activeHttpConsoleSessionId) {
    const sId = activeHttpConsoleSessionId;
    activeHttpConsoleSessionId = null;
    apiRequest('/admin/console/close', { method: 'POST', body: { sessionId: sId } }).catch(() => {});
  }

  if (activeTerminalInstance) {
    try { activeTerminalInstance.dispose(); } catch (e) {}
    activeTerminalInstance = null;
  }
  container.innerHTML = '';

  const TermClass = window.Terminal || (window.Terminal && window.Terminal.Terminal);
  if (!TermClass) {
    container.innerHTML = '<div class="p-4 text-xs font-mono text-red-400 flex items-center gap-2"><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Loading terminal engine... Please click Reconnect in a moment.</div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  const term = new TermClass({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
    lineHeight: 1.25,
    convertEol: true,
    scrollback: 5000,
    theme: {
      background: '#040406',
      foreground: '#f1f5f9',
      cursor: '#38bdf8',
      cursorAccent: '#000000',
      selectionBackground: '#0284c7',
      selectionForeground: '#ffffff',
      black: '#1e293b',
      red: '#f87171',
      green: '#34d399',
      yellow: '#fbbf24',
      blue: '#38bdf8',
      magenta: '#e879f9',
      cyan: '#22d3ee',
      white: '#f8fafc',
      brightBlack: '#475569',
      brightRed: '#ef4444',
      brightGreen: '#10b981',
      brightYellow: '#f59e0b',
      brightBlue: '#0ea5e9',
      brightMagenta: '#d946ef',
      brightCyan: '#06b6d4',
      brightWhite: '#ffffff'
    }
  });

  activeTerminalInstance = term;

  let fitAddon = null;
  try {
    if (typeof FitAddon !== 'undefined' && FitAddon.FitAddon) {
      fitAddon = new FitAddon.FitAddon();
    } else if (typeof window.FitAddon !== 'undefined') {
      fitAddon = typeof window.FitAddon === 'function' ? new window.FitAddon() : new window.FitAddon.FitAddon();
    }
  } catch (e) {
    console.warn('FitAddon initialization fallback:', e);
  }

  activeFitAddon = fitAddon;

  if (fitAddon) {
    term.loadAddon(fitAddon);
  }

  term.open(container);

  const applyFit = () => {
    if (fitAddon && container.offsetWidth > 0) {
      try {
        fitAddon.fit();
        if (activeTerminalSocket && activeTerminalSocket.readyState === WebSocket.OPEN && term.cols && term.rows) {
          activeTerminalSocket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch (e) {}
    }
  };

  requestAnimationFrame(() => {
    applyFit();
    setTimeout(applyFit, 150);
  });

  container.addEventListener('click', () => {
    term.focus();
  });
  window.addEventListener('resize', applyFit);

  // If user selected Force HTTP Stream mode, jump straight to HTTP stream session
  if (activeTerminalMode === 'http') {
    startHttpConsoleSession(term, badge, applyFit);
    return;
  }

  // Otherwise, attempt WebSocket (with auto-fallback to HTTP stream if mode is 'auto')
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/admin/console?token=${encodeURIComponent(AppState.token || '')}`;

  if (badge) {
    badge.className = 'text-xs text-amber-500 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20';
    badge.innerHTML = 'Connecting via WebSocket...';
  }

  let wsOpened = false;
  let connectionTimeout = setTimeout(() => {
    if (!wsOpened && activeTerminalMode === 'auto') {
      try { if (activeTerminalSocket) activeTerminalSocket.close(); } catch (_) {}
      activeTerminalSocket = null;
      term.write('\r\n\x1b[33m[Notice: WebSocket handshake timed out on VPS. Switching to HTTP Stream console...]\x1b[0m\r\n');
      startHttpConsoleSession(term, badge, applyFit);
    }
  }, 3500);

  try {
    const ws = new WebSocket(wsUrl);
    activeTerminalSocket = ws;

    ws.onopen = () => {
      wsOpened = true;
      clearTimeout(connectionTimeout);
      if (badge) {
        badge.className = 'text-xs text-emerald-500 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Live SSH (WebSocket)';
      }
      applyFit();
      term.focus();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else if (event.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          term.write(new Uint8Array(reader.result));
        };
        reader.readAsArrayBuffer(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onerror = () => {
      clearTimeout(connectionTimeout);
      if (activeTerminalMode === 'auto' && !wsOpened) {
        try { ws.close(); } catch (_) {}
        activeTerminalSocket = null;
        term.write('\r\n\x1b[33m[Notice: WebSocket blocked by reverse proxy or Cloudflare. Auto-switching to HTTP Stream console...]\x1b[0m\r\n');
        startHttpConsoleSession(term, badge, applyFit);
        return;
      }

      if (badge) {
        badge.className = 'text-xs text-red-500 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> Disconnected';
      }
      term.write('\r\n\x1b[31m[WebSocket Error: Unable to establish live terminal connection]\x1b[0m\r\n');
      term.write('\x1b[36mTip: Click the "HTTP Stream" button above to connect immediately without WebSockets!\x1b[0m\r\n');
    };

    ws.onclose = () => {
      clearTimeout(connectionTimeout);
      if (badge && wsOpened) {
        badge.className = 'text-xs text-slate-400 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-500/10 border border-slate-500/20';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-slate-500"></span> Session Closed';
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

  } catch (err) {
    clearTimeout(connectionTimeout);
    if (activeTerminalMode === 'auto') {
      term.write(`\r\n\x1b[33m[WebSocket init error: ${err.message}. Switching to HTTP Stream console...]\x1b[0m\r\n`);
      startHttpConsoleSession(term, badge, applyFit);
    } else {
      if (badge) {
        badge.className = 'text-xs text-red-500 font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> Error';
      }
      term.write(`\r\n\x1b[31mFailed to initialize WebSocket: ${err.message}\x1b[0m\r\n`);
    }
  }
}

function openCreateUserModal() {
  const existing = document.getElementById('create-user-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'create-user-modal';
  modal.className = 'fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 modal-backdrop-enter';
  modal.innerHTML = `
    <div class="w-full max-w-lg glass-card rounded-xl shadow-2xl p-6 modal-box-enter">
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3 mb-5">
        <div>
          <h3 class="text-base font-semibold text-slate-900 dark:text-white">Create New User</h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Provision a standard user or administrator account.</p>
        </div>
        <button type="button" onclick="document.getElementById('create-user-modal')?.remove()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <form onsubmit="handleCreateUser(event)" class="space-y-3">
        <div class="grid sm:grid-cols-2 gap-3">
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Full Name</label><input id="create-user-name" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Username</label><input id="create-user-username" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono"></div>
        </div>
        <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Email</label><input id="create-user-email" type="email" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Password</label><input id="create-user-password" type="password" minlength="6" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Role</label><select id="create-user-role" class="w-full pitch-input rounded-lg px-3 py-2 text-sm"><option value="user">User</option><option value="admin">Admin</option></select></div>
        </div>
        <div class="grid sm:grid-cols-3 gap-3">
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Storage (GB)</label><input id="create-user-quota" type="number" min="0.01" step="0.01" value="10" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono tabular-nums"></div>
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Bandwidth (GB/mo)</label><input id="create-user-bw" type="number" min="1" step="1" value="15" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono tabular-nums"></div>
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">API Calls (/mo)</label><input id="create-user-api" type="number" min="1000" step="1000" value="100000" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono tabular-nums"></div>
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
          <button type="button" onclick="document.getElementById('create-user-modal')?.remove()" class="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">Cancel</button>
          <button type="submit" class="zencloud-btn-primary px-4 py-2 rounded-lg text-xs">Create User</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

async function handleCreateUser(e) {
  e.preventDefault();
  const quotaGb = parseFloat(document.getElementById('create-user-quota')?.value || '0');
  const bwGb = parseFloat(document.getElementById('create-user-bw')?.value || '15');
  const apiReqs = parseInt(document.getElementById('create-user-api')?.value || '100000', 10);
  if (!(quotaGb > 0)) return showToast('Storage quota must be greater than 0.', 'error');
  try {
    await apiRequest('/admin/users', {
      method: 'POST',
      body: {
        name: document.getElementById('create-user-name').value.trim(),
        username: document.getElementById('create-user-username').value.trim(),
        email: document.getElementById('create-user-email').value.trim(),
        password: document.getElementById('create-user-password').value,
        role: document.getElementById('create-user-role').value,
        storageQuotaBytes: Math.round(quotaGb * 1073741824),
        bandwidthLimitBytes: Math.round(bwGb * 1073741824),
        apiRequestsLimit: apiReqs
      }
    });
    document.getElementById('create-user-modal')?.remove();
    showToast('User created successfully.', 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openEditUserModal(userId) {
  const user = (AppState.adminUsers || []).find(u => Number(u.id) === Number(userId));
  if (!user) return showToast('User details could not be found.', 'error');
  document.getElementById('edit-user-modal')?.remove();
  const isSelf = AppState.user && Number(AppState.user.id) === Number(user.id);
  const bwGb = ((Number(user.bandwidth_limit_bytes) || 16106127360) / 1073741824).toFixed(1);
  const apiLimit = Number(user.api_requests_limit) || 100000;
  const modal = document.createElement('div');
  modal.id = 'edit-user-modal';
  modal.className = 'fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 modal-backdrop-enter';
  modal.innerHTML = `
    <div class="w-full max-w-lg glass-card rounded-xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto modal-box-enter">
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3 mb-5">
        <div>
          <h3 class="text-base font-semibold text-slate-900 dark:text-white">Edit User &amp; Quotas</h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Update profile, storage quota, bandwidth, and API request limits.</p>
        </div>
        <button type="button" onclick="document.getElementById('edit-user-modal')?.remove()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <form onsubmit="handleEditUser(event, ${Number(user.id)})" class="space-y-3">
        <div class="grid sm:grid-cols-2 gap-3">
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Full Name</label><input id="edit-user-name" value="${escapeHtml(user.name)}" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Username</label><input id="edit-user-username" value="${escapeHtml(user.username)}" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono"></div>
        </div>
        <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Email</label><input id="edit-user-email" type="email" value="${escapeHtml(user.email)}" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">New Password</label><input id="edit-user-password" type="password" minlength="6" placeholder="Leave blank to keep current" class="w-full pitch-input rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Role</label><select id="edit-user-role" ${isSelf ? 'disabled' : ''} class="w-full pitch-input rounded-lg px-3 py-2 text-sm"><option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option></select></div>
        </div>
        <div class="grid sm:grid-cols-3 gap-3">
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Storage (GB)</label><input id="edit-user-quota" type="number" min="0.01" step="0.01" value="${(Number(user.storage_quota_bytes || 0) / 1073741824).toFixed(2)}" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono tabular-nums"></div>
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Bandwidth (GB/mo)</label><input id="edit-user-bw" type="number" min="1" step="0.5" value="${bwGb}" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono tabular-nums"></div>
          <div><label class="block text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">API Calls (/mo)</label><input id="edit-user-api" type="number" min="1000" step="1000" value="${apiLimit}" required class="w-full pitch-input rounded-lg px-3 py-2 text-sm font-mono tabular-nums"></div>
        </div>
        <div class="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
          <button type="button" onclick="document.getElementById('edit-user-modal')?.remove()" class="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">Cancel</button>
          <button type="submit" class="zencloud-btn-primary px-4 py-2 rounded-lg text-xs">Save Changes</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

async function handleEditUser(e, userId) {
  e.preventDefault();
  const quotaGb = parseFloat(document.getElementById('edit-user-quota')?.value || '0');
  const bwGb = parseFloat(document.getElementById('edit-user-bw')?.value || '15');
  const apiReqs = parseInt(document.getElementById('edit-user-api')?.value || '100000', 10);
  if (!(quotaGb > 0)) return showToast('Storage quota must be greater than 0.', 'error');

  const password = document.getElementById('edit-user-password').value;
  const body = {
    name: document.getElementById('edit-user-name').value.trim(),
    username: document.getElementById('edit-user-username').value.trim(),
    email: document.getElementById('edit-user-email').value.trim(),
    storageQuotaBytes: Math.round(quotaGb * 1073741824),
    bandwidthLimitBytes: Math.round(bwGb * 1073741824),
    apiRequestsLimit: apiReqs
  };
  if (AppState.user && Number(AppState.user.id) !== Number(userId)) body.role = document.getElementById('edit-user-role').value;
  if (password) body.newPassword = password;

  try {
    await apiRequest(`/admin/users/${userId}`, { method: 'PUT', body });
    document.getElementById('edit-user-modal')?.remove();
    showToast('User updated successfully.', 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function resetUserUsagePrompt(userId, username) {
  if (!confirm(`Reset monthly bandwidth and API request usage cycle for @${username}?`)) return;
  try {
    await apiRequest(`/admin/users/${userId}/reset-usage`, { method: 'POST' });
    showToast(`Monthly usage for @${username} has been reset.`, 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function changeUserRole(userId, role) {
  try {
    await apiRequest(`/admin/users/${userId}`, { method: 'PUT', body: { role } });
    showToast(`User role changed to ${role}.`, 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
    await renderAdminSubTabContent();
  }
}

async function deleteUserPrompt(userId, username) {
  if (!confirm(`Delete user @${username} and all of their stored files? This cannot be undone.`)) return;
  try {
    await apiRequest(`/admin/users/${userId}`, { method: 'DELETE' });
    showToast('User deleted successfully.', 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function editUserQuotaPrompt(userId, currentQuota) {
  const gbStr = prompt('Enter new storage quota in GB:', (parseInt(currentQuota, 10) / 1073741824).toFixed(0));
  if (!gbStr) return;

  const bytes = parseInt(gbStr, 10) * 1073741824;
  apiRequest(`/admin/users/${userId}`, {
    method: 'PUT',
    body: { storageQuotaBytes: bytes }
  })
  .then(() => {
    showToast('Storage quota updated!', 'success');
    renderAdminSubTabContent();
  })
  .catch(err => showToast(err.message, 'error'));
}

function openPutOnVerificationModal(userId, username, email, name) {
  document.getElementById('put-verification-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'put-verification-modal';
  modal.className = 'fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 modal-backdrop-enter';
  modal.innerHTML = `
    <div class="w-full max-w-md glass-card rounded-xl border border-amber-500/30 shadow-2xl p-6 space-y-4 modal-box-enter">
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center">
            <i data-lucide="shield-alert" class="w-4 h-4"></i>
          </div>
          <div>
            <h3 class="text-base font-semibold text-slate-900 dark:text-white">Require Security Verification</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">Put @${escapeHtml(username)} on 4-Digit OTP verification</p>
          </div>
        </div>
        <button type="button" onclick="document.getElementById('put-verification-modal')?.remove()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
        Placing this account under verification locks dashboard and API access until the user enters the <strong>4-digit OTP code</strong> emailed to <strong>${escapeHtml(email || username)}</strong>.
      </p>
      <form onsubmit="handlePutOnVerification(event, ${Number(userId)})" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Reason for Security Review</label>
          <input type="text" id="verification-reason-input" required value="Suspicious account activity detected. Please verify your identity." class="w-full pitch-input rounded-lg px-3.5 py-2 text-xs">
          <p class="text-[11px] text-slate-500 mt-1">Included in the security alert email and OTP screen.</p>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
          <button type="button" onclick="document.getElementById('put-verification-modal')?.remove()" class="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">Cancel</button>
          <button type="submit" id="btn-submit-verification" class="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors flex items-center gap-1.5">
            <i data-lucide="send" class="w-3.5 h-3.5"></i>
            <span>Send OTP &amp; Require Verification</span>
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
}

async function handlePutOnVerification(e, userId) {
  e.preventDefault();
  const reason = document.getElementById('verification-reason-input')?.value.trim();
  const btn = document.getElementById('btn-submit-verification');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Placing on verification...`;
    if (window.lucide) lucide.createIcons();
  }

  try {
    const data = await apiRequest(`/admin/users/${userId}/require-verification`, {
      method: 'POST',
      body: { reason }
    });

    document.getElementById('put-verification-modal')?.remove();
    showToast(data.message || 'User placed on 4-digit OTP verification.', 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i> Send OTP & Require Verification`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function handleLiftVerification(userId, username) {
  if (!confirm(`Lift security OTP verification requirement for @${username}? The user will regain normal access immediately.`)) return;

  try {
    const data = await apiRequest(`/admin/users/${userId}/lift-verification`, {
      method: 'POST'
    });
    showToast(data.message || `Verification requirement lifted for @${username}.`, 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleAdminResendOtp(userId, username) {
  try {
    const data = await apiRequest(`/admin/users/${userId}/resend-otp`, {
      method: 'POST'
    });
    showToast(data.message || `New 4-digit OTP generated (Code: ${data.otpCode}) and email sent to @${username}.`, 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function toggleUserSuspend(userId, currentStatus) {
  const user = (AppState.adminUsers || []).find(u => Number(u.id) === Number(userId));
  if (!user) return showToast('User not found.', 'error');

  if (currentStatus) {
    openUnsuspendUserModal(user.id, user.username, user.email, user.name);
  } else {
    openSuspendUserModal(user.id, user.username, user.email, user.name);
  }
}

function openSuspendUserModal(userId, username, email, name) {
  document.getElementById('suspend-user-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'suspend-user-modal';
  modal.className = 'fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 modal-backdrop-enter';
  modal.innerHTML = `
    <div class="w-full max-w-lg glass-card rounded-xl border border-rose-500/30 shadow-2xl p-6 space-y-4 modal-box-enter">
      <div class="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-white/10 pb-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 shrink-0">
            <i data-lucide="ban" class="w-4 h-4"></i>
          </div>
          <div>
            <h3 class="text-base font-semibold text-slate-900 dark:text-white">Suspend User Account</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Restrict user access and dispatch automated suspension notice.</p>
          </div>
        </div>
        <button type="button" onclick="document.getElementById('suspend-user-modal')?.remove()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <div class="p-3.5 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 text-xs space-y-1">
        <div class="flex justify-between text-slate-600 dark:text-slate-300">
          <span class="text-slate-500">User:</span>
          <span class="font-semibold text-slate-900 dark:text-white">${escapeHtml(name)} (@${escapeHtml(username)})</span>
        </div>
        <div class="flex justify-between text-slate-600 dark:text-slate-300">
          <span class="text-slate-500">Email Address:</span>
          <span class="font-mono text-slate-900 dark:text-white">${escapeHtml(email)}</span>
        </div>
      </div>
      <form onsubmit="handleSuspendUserSubmit(event, ${Number(userId)}, '${escapeHtml(username)}')" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
            Reason for Suspension <span class="text-rose-500">*</span>
          </label>
          <textarea id="suspend-reason-input" required rows="3" class="w-full pitch-input rounded-lg p-3 text-xs resize-none" placeholder="Enter specific reason for suspension..."></textarea>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Recorded in audit logs and emailed directly to the user.</p>
        </div>
        <div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-200">
          <i data-lucide="mail" class="w-4 h-4 text-rose-500 shrink-0 mt-0.5"></i>
          <span>An automated SMTP suspension notification will be emailed to <strong>${escapeHtml(email)}</strong>.</span>
        </div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
          <button type="button" onclick="document.getElementById('suspend-user-modal')?.remove()" class="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">
            Cancel
          </button>
          <button type="submit" id="btn-submit-suspend" class="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors">
            <i data-lucide="ban" class="w-3.5 h-3.5"></i> Suspend User &amp; Send Mail
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
  setTimeout(() => document.getElementById('suspend-reason-input')?.focus(), 50);
}

async function handleSuspendUserSubmit(e, userId, username) {
  e.preventDefault();
  const reason = document.getElementById('suspend-reason-input')?.value.trim();
  if (!reason) return showToast('Please enter a suspension reason.', 'error');

  const submitBtn = document.getElementById('btn-submit-suspend');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Suspending...';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await apiRequest(`/admin/users/${userId}/suspend`, {
      method: 'POST',
      body: { reason }
    });
    document.getElementById('suspend-user-modal')?.remove();
    showToast(res.message || `User @${username} suspended and email sent!`, 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message || 'Failed to suspend user.', 'error');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="ban" class="w-4 h-4"></i> Suspend User & Send Mail';
      if (window.lucide) lucide.createIcons();
    }
  }
}

function openUnsuspendUserModal(userId, username, email, name) {
  document.getElementById('unsuspend-user-modal')?.remove();
  const userObj = (AppState.adminUsers || []).find(u => Number(u.id) === Number(userId));
  const priorReason = userObj ? userObj.suspension_reason : '';
  const modal = document.createElement('div');
  modal.id = 'unsuspend-user-modal';
  modal.className = 'fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 modal-backdrop-enter';
  modal.innerHTML = `
    <div class="w-full max-w-lg glass-card rounded-xl border border-emerald-500/30 shadow-2xl p-6 space-y-4 modal-box-enter">
      <div class="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-white/10 pb-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shrink-0">
            <i data-lucide="check-circle" class="w-4 h-4"></i>
          </div>
          <div>
            <h3 class="text-base font-semibold text-slate-900 dark:text-white">Reactivate User Account</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Lift suspension and dispatch automated reactivation email.</p>
          </div>
        </div>
        <button type="button" onclick="document.getElementById('unsuspend-user-modal')?.remove()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <div class="p-3.5 rounded-lg bg-slate-50 dark:bg-[#09090d] border border-slate-200 dark:border-white/10 text-xs space-y-1">
        <div class="flex justify-between text-slate-600 dark:text-slate-300">
          <span class="text-slate-500">User:</span>
          <span class="font-semibold text-slate-900 dark:text-white">${escapeHtml(name)} (@${escapeHtml(username)})</span>
        </div>
        <div class="flex justify-between text-slate-600 dark:text-slate-300">
          <span class="text-slate-500">Email Address:</span>
          <span class="font-mono text-slate-900 dark:text-white">${escapeHtml(email)}</span>
        </div>
        ${priorReason ? `
        <div class="pt-1 border-t border-slate-200 dark:border-white/10 text-[11px] text-amber-600 dark:text-amber-300">
          <span class="text-slate-500">Previous Suspension Reason:</span> ${escapeHtml(priorReason)}
        </div>` : ''}
      </div>
      <form onsubmit="handleUnsuspendUserSubmit(event, ${Number(userId)}, '${escapeHtml(username)}')" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
            Reactivation Message / Note
          </label>
          <textarea id="unsuspend-reason-input" rows="3" class="w-full pitch-input rounded-lg p-3 text-xs resize-none" placeholder="Optional message included in the reactivation email...">Your account suspension has been lifted and access has been restored.</textarea>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Included in the automated reactivation email sent to the user.</p>
        </div>
        <div class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-2.5 text-xs text-emerald-700 dark:text-emerald-200">
          <i data-lucide="mail" class="w-4 h-4 text-emerald-500 shrink-0 mt-0.5"></i>
          <span>An automated SMTP reactivation notification will be emailed to <strong>${escapeHtml(email)}</strong> with the login link.</span>
        </div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
          <button type="button" onclick="document.getElementById('unsuspend-user-modal')?.remove()" class="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">
            Cancel
          </button>
          <button type="submit" id="btn-submit-unsuspend" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors">
            <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Reactivate &amp; Send Mail
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) lucide.createIcons();
  setTimeout(() => document.getElementById('unsuspend-reason-input')?.focus(), 50);
}

async function handleUnsuspendUserSubmit(e, userId, username) {
  e.preventDefault();
  const reason = document.getElementById('unsuspend-reason-input')?.value.trim() || 'Your account suspension has been lifted and access has been restored.';

  const submitBtn = document.getElementById('btn-submit-unsuspend');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Reactivating...';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await apiRequest(`/admin/users/${userId}/unsuspend`, {
      method: 'POST',
      body: { reason }
    });
    document.getElementById('unsuspend-user-modal')?.remove();
    showToast(res.message || `User @${username} reactivated and email sent!`, 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message || 'Failed to unsuspend user.', 'error');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4"></i> Reactivate & Send Mail';
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function openEditEmailTemplateModal(slug) {
  try {
    const templates = await apiRequest('/admin/email-templates');
    const tpl = templates.find(t => t.slug === slug);
    if (!tpl) return showToast('Template not found.', 'error');
    document.getElementById('edit-template-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'edit-template-modal';
    modal.className = 'fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 modal-backdrop-enter';
    modal.innerHTML = `
      <div class="w-full max-w-2xl glass-card rounded-xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto space-y-4 modal-box-enter">
        <div class="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3">
          <div>
            <h3 class="text-base font-semibold text-slate-900 dark:text-white">Edit Email Template</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">${escapeHtml(tpl.name)} (<code class="font-mono">${escapeHtml(tpl.slug)}</code>)</p>
          </div>
          <button type="button" onclick="document.getElementById('edit-template-modal')?.remove()" class="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
        <form onsubmit="handleSaveEmailTemplate(event, '${escapeHtml(tpl.slug)}')" class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Subject Line</label>
            <input type="text" id="tpl-subject" value="${escapeHtml(tpl.subject)}" required class="w-full pitch-input rounded-lg px-3.5 py-2 text-xs">
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">HTML Body</label>
            <textarea id="tpl-body" rows="12" required class="w-full pitch-input rounded-lg p-3 font-mono text-xs leading-relaxed">${escapeHtml(tpl.body_html)}</textarea>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Placeholders: <code>{{name}}</code>, <code>{{username}}</code>, <code>{{reason}}</code>, <code>{{suspended_at}}</code>, <code>{{reactivated_at}}</code>, <code>{{login_url}}</code>, <code>{{app_name}}</code></p>
          </div>
          <div class="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
            <button type="button" onclick="document.getElementById('edit-template-modal')?.remove()" class="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">Cancel</button>
            <button type="submit" class="zencloud-btn-primary px-5 py-2 rounded-lg text-xs">Save Template</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSaveEmailTemplate(e, slug) {
  e.preventDefault();
  const subject = document.getElementById('tpl-subject')?.value.trim();
  const body_html = document.getElementById('tpl-body')?.value;

  try {
    await apiRequest(`/admin/email-templates/${slug}`, {
      method: 'PUT',
      body: { subject, body_html }
    });
    document.getElementById('edit-template-modal')?.remove();
    showToast('Email template updated successfully.', 'success');
    await renderAdminSubTabContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSaveAdminDetails(e) {
  e.preventDefault();
  const discordEnabled = document.getElementById('details-discord-enabled')?.checked;
  const discordUrl = document.getElementById('details-discord-url')?.value.trim() || '';
  const contactEnabled = document.getElementById('details-contact-enabled')?.checked;
  const contactEmail = document.getElementById('details-contact-email')?.value.trim() || '';
  if (discordEnabled && !discordUrl) return showToast('Enter a Discord join link or turn off the Discord checkbox.', 'error');
  if (contactEnabled && !contactEmail) return showToast('Enter a contact email or turn off the Contact Email checkbox.', 'error');
  try {
    await apiRequest('/admin/settings', {
      method: 'POST',
      body: {
        discord_enabled: discordEnabled ? 'true' : 'false',
        discord_join_url: discordUrl,
        contact_email_enabled: contactEnabled ? 'true' : 'false',
        contact_email: contactEmail
      }
    });
    showToast('Details saved successfully.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSaveSmtp(e) {
  e.preventDefault();
  const host = document.getElementById('smtp-host').value;
  const port = document.getElementById('smtp-port').value;
  const encryption = document.getElementById('smtp-enc').value;
  const username = document.getElementById('smtp-user').value;
  const password = document.getElementById('smtp-pass').value;
  const fromEmail = document.getElementById('smtp-from-email').value.trim();
  const fromName = document.getElementById('smtp-from-name').value.trim();

  try {
    await apiRequest('/admin/smtp', {
      method: 'POST',
      body: { host, port, encryption, username, password, fromEmail, fromName }
    });
    showToast('SMTP settings saved!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function testSmtpPrompt() {
  const email = prompt('Enter email address to send test message:');
  if (!email) return;

  apiRequest('/admin/smtp/test', {
    method: 'POST',
    body: { testEmail: email }
  })
  .then(res => showToast(res.message, 'success'))
  .catch(err => showToast(err.message, 'error'));
}

// Initial Boot Call
window.addEventListener('DOMContentLoaded', async () => {
  await loadPublicBranding();

  // If user has an active token, validate session and sync profile
  if (AppState.token) {
    try {
      const profileData = await apiRequest('/auth/profile');
      if (profileData && profileData.user) {
        AppState.user = profileData.user;
        localStorage.setItem('vps_user', JSON.stringify(profileData.user));
        
        // If user is verified and does not require OTP, ensure OTP sessions and hashes are cleared
        if (!profileData.user.requires_otp_verification) {
          AppState.otpSessionData = null;
          if (window.location.hash.startsWith('#otp-verification')) {
            if (window.history && window.history.replaceState) {
              window.history.replaceState(null, '', window.location.pathname + window.location.search);
            } else {
              window.location.hash = '';
            }
          }
        }
      }
    } catch (e) {
      if (e && e.requiresOtpVerification) {
        AppState.otpSessionData = e;
      }
    }
  }

  renderApp();
});

window.addEventListener('hashchange', () => {
  renderApp();
});
