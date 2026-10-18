const stageLabels = new Map([
  ['idle', '연결 대기'], ['opening', '연결 확인'], ['pairing', '연결 확인'],
  ['connected', '연결됨'], ['recovering', '연결 복구 중'],
  ['authorization_required', '연결 중단'], ['error', '연결 오류'], ['quitting', '종료 중'],
]);

/** Native UI dependencies are supplied by the main process; no renderer or account data enters this module. */
export function createConnectorTray({ Tray, Menu, nativeImage, productName, iconPath, platform, onOpen, onQuit, disabled = false }) {
  let tray, currentLabel, quitRequested = false, disposed = false;
  const available = () => !!tray && !disposed && !tray.isDestroyed();
  const open = () => { if (available() && !quitRequested) onOpen(); };
  const quit = () => { if (!available() || quitRequested) return; quitRequested = true; updateStage('quitting'); onQuit(); };
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (tray) {
      try { tray.removeAllListeners(); }
      finally { if (!tray.isDestroyed()) tray.destroy(); }
    }
  }
  function updateStage(stage) {
    if (!available()) return false;
    if (stage === 'quitting') quitRequested = true;
    const label = stageLabels.get(quitRequested ? 'quitting' : stage) ?? '연결 대기';
    if (label === currentLabel) return true;
    try {
      tray.setToolTip(`${productName} · ${label}`);
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: productName, enabled: false },
        { label, enabled: false },
        { type: 'separator' },
        { label: `${productName} 열기`, enabled: !quitRequested, click: open },
        { label: `${productName} 종료`, enabled: !quitRequested, click: quit },
      ]));
    } catch { try { dispose(); } catch { /* Keep the main window reachable if native UI fails. */ } return false; }
    currentLabel = label;
    return true;
  }
  if (!disabled) {
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        const size = platform === 'darwin' ? 18 : 32;
        const image = icon.resize({ width: size, height: size });
        if (platform === 'darwin') image.setTemplateImage(true);
        tray = new Tray(image);
        if (platform !== 'darwin') tray.on('click', open);
        updateStage('idle');
      }
    } catch { try { dispose(); } catch { /* Tray support is optional; it must not break startup. */ } }
  }
  return { get available() { return available(); }, updateStage, dispose };
}

export async function shutdownWithTray({ cleanup, tray, exit }) {
  try { await cleanup(); }
  finally {
    try { tray?.dispose(); }
    finally { exit(); }
  }
}

export function shouldHideWindowToTray({ platform, authorized, trayAvailable, quitting }) {
  // A Linux Tray object alone does not establish that the desktop displays it.
  return !quitting && authorized && trayAvailable && ['win32', 'darwin'].includes(platform);
}
