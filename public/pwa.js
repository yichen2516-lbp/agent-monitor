(function () {
  'use strict';

  const INSTALL_BUTTON_ID = 'install-app-btn';
  const STANDALONE_MEDIA = '(display-mode: standalone)';
  let deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia?.(STANDALONE_MEDIA)?.matches || window.navigator.standalone === true;
  }

  function isSafari() {
    const ua = navigator.userAgent || '';
    return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua);
  }

  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua);
  }

  function updateInstallButton() {
    const button = document.getElementById(INSTALL_BUTTON_ID);
    if (!button) return;

    if (isStandalone()) {
      button.textContent = '✓ Installed';
      button.disabled = true;
      button.title = 'Agent Monitor is already running as an installed app.';
      return;
    }

    if (deferredInstallPrompt) {
      button.textContent = '⬇︎ Install App';
      button.disabled = false;
      button.title = 'Install Agent Monitor to your desktop / dock.';
      return;
    }

    button.textContent = isSafari() ? 'Install Guide' : 'Install App';
    button.disabled = false;
    button.title = isSafari()
      ? 'Show Safari install steps.'
      : 'Show install steps for this browser.';
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
      await navigator.serviceWorker.register('/public/service-worker.js', { scope: '/' });
    } catch (error) {
      console.warn('[Agent-Monitor] service worker registration failed:', error.message);
    }
  }

  async function onInstallClick() {
    if (isStandalone()) return;

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try {
        await deferredInstallPrompt.userChoice;
      } catch (_) {}
      deferredInstallPrompt = null;
      updateInstallButton();
      return;
    }

    if (isSafari()) {
      const safariSteps = isIOS()
        ? 'Safari 安装：点分享按钮 → 选择“添加到主屏幕”。'
        : 'Safari 安装：浏览器菜单栏点“文件” → “添加到程序坞（Add to Dock）”。';
      alert(`${safariSteps}\n\n如果你在 Chrome：打开站点后点地址栏右侧安装图标，或浏览器菜单里的“安装 Agent Monitor”。`);
      return;
    }

    alert('如果浏览器没有自动弹出安装框：\n1. 打开浏览器菜单\n2. 找到“Install app / 安装应用 / 添加到桌面”\n3. 选择 Agent Monitor');
  }

  function bindInstallButton() {
    const button = document.getElementById(INSTALL_BUTTON_ID);
    if (!button || button.dataset.pwaBound === '1') return;
    button.dataset.pwaBound = '1';
    button.addEventListener('click', onInstallClick);
    updateInstallButton();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButton();
  });

  window.addEventListener('DOMContentLoaded', () => {
    registerServiceWorker();
    bindInstallButton();
    updateInstallButton();
  });
})();
