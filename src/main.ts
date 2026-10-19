import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { autoUpdater } from "electron-updater";
import path from "node:path";
import {
  APP_ORIGIN,
  APP_URL,
  APP_USER_MODEL_ID,
  IDLE_POLL_MS,
  IDLE_THRESHOLD_SECONDS,
  IPC,
  RELOAD_RETRY_MS,
  UPDATE_CHECK_MS,
  iconPath,
} from "./config";
import { initialBounds, readSettings, trackWindowState, writeSettings } from "./window-state";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let unreadCount = 0;
let idle = false;
// 알림 객체는 닫힐 때까지 참조를 잡아 둔다 (GC되면 클릭 이벤트가 사라진다)
const activeNotifications = new Set<Notification>();

// —— 중복 실행 방지: 두 번째 실행은 기존 창을 띄운다 ——
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.setAppUserModelId(APP_USER_MODEL_ID);
  app.whenReady().then(start);
}

/**
 * 기본 User-Agent에는 제품명("V WORKS 메신저")이 들어가는데,
 * 서버(Spring Security 방화벽)가 ASCII가 아닌 헤더 값을 거부해 WebSocket 핸드셰이크가 403이 된다.
 */
function asciiUserAgent() {
  return app.userAgentFallback
    .split(" ")
    .map((token) => (/[^\x20-\x7e]/.test(token) ? `VWorksMessenger/${app.getVersion()}` : token))
    .join(" ");
}

function start() {
  app.userAgentFallback = asciiUserAgent();
  Menu.setApplicationMenu(null);
  createWindow();
  createTray();
  registerIpc();
  watchIdle();
  checkForUpdates();
}

function isAppUrl(url: string) {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function openExternal(url: string) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function createWindow() {
  const settings = readSettings();
  win = new BrowserWindow({
    ...initialBounds(),
    minWidth: 380,
    minHeight: 480,
    show: false,
    title: "V WORKS 메신저",
    icon: iconPath("icon.png"),
    backgroundColor: "#f7f8fa",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // 첨부 PDF 미리보기(iframe)용 내장 뷰어
      plugins: true,
    },
  });
  if (settings.maximized) win.maximize();
  trackWindowState(win);

  win.once("ready-to-show", () => {
    // 자동 실행(로그인 시 시작)은 트레이에만 두고 창은 띄우지 않는다
    if (!process.argv.includes("--hidden")) win?.show();
  });

  // 허용 출처 밖으로 이동·새 창은 기본 브라우저로
  win.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) openExternal(url);
    return { action: "deny" };
  });

  // 서버에 닿지 않으면 안내 화면을 띄우고 주기적으로 다시 시도
  win.webContents.on("did-fail-load", (_event, errorCode, _desc, url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ABORTED */) return;
    void win?.loadURL(offlinePage(url));
    setTimeout(() => void win?.loadURL(APP_URL), RELOAD_RETRY_MS);
  });

  // 텍스트 선택·입력창 우클릭 메뉴 (Electron은 기본 메뉴가 없다)
  win.webContents.on("context-menu", (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      items.push({ role: "cut", label: "잘라내기" }, { role: "copy", label: "복사" }, { role: "paste", label: "붙여넣기" });
      items.push({ type: "separator" }, { role: "selectAll", label: "전체 선택" });
    } else if (params.selectionText) {
      items.push({ role: "copy", label: "복사" });
    }
    if (params.linkURL && /^https?:/i.test(params.linkURL)) {
      items.push({ label: "링크 열기", click: () => openExternal(params.linkURL) });
    }
    if (items.length > 0) Menu.buildFromTemplate(items).popup();
  });

  win.on("focus", () => win?.flashFrame(false));

  // 닫기 = 트레이로 숨김 (종료는 트레이 메뉴)
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
    if (!readSettings().trayHintShown) {
      writeSettings({ trayHintShown: true });
      new Notification({
        title: "V WORKS 메신저",
        body: "트레이에서 계속 실행 중입니다. 종료하려면 트레이 아이콘을 우클릭하세요.",
      }).show();
    }
  });

  void win.loadURL(APP_URL);
}

function offlinePage(url: string) {
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>연결 대기</title>
<body style="margin:0;display:flex;height:100vh;align-items:center;justify-content:center;font-family:'Malgun Gothic',sans-serif;background:#f7f8fa;color:#334155">
<div style="text-align:center"><p style="font-size:16px;font-weight:600">서버에 연결할 수 없습니다</p>
<p style="font-size:13px;color:#64748b">네트워크를 확인해 주세요. 잠시 후 자동으로 다시 시도합니다.</p>
<p style="font-size:11px;color:#94a3b8">${escapeHtml(url)}</p></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath("tray.png")));
  tray.on("click", showWindow);
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  tray.setImage(nativeImage.createFromPath(iconPath(unreadCount > 0 ? "tray-unread.png" : "tray.png")));
  tray.setToolTip(unreadCount > 0 ? `V WORKS 메신저 · 안 읽은 메시지 ${unreadCount}` : "V WORKS 메신저");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "열기", click: showWindow },
      { type: "separator" },
      {
        label: "Windows 시작 시 자동 실행",
        type: "checkbox",
        checked: openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
          refreshTray();
        },
      },
      { label: `버전 ${app.getVersion()}`, enabled: false },
      { type: "separator" },
      {
        label: "종료",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/** 이 창(허용 출처)에서 온 IPC만 받는다 */
function fromApp(event: IpcMainEvent | IpcMainInvokeEvent) {
  const url = event.senderFrame?.url ?? "";
  return event.sender === win?.webContents && isAppUrl(url);
}

function registerIpc() {
  ipcMain.on(IPC.notify, (event, payload: { title: string; body: string; roomId: number }) => {
    if (!fromApp(event) || !Notification.isSupported()) return;
    const notification = new Notification({ title: payload.title, body: payload.body, icon: iconPath("icon.png") });
    activeNotifications.add(notification);
    notification.on("click", () => {
      showWindow();
      if (Number.isFinite(payload.roomId)) win?.webContents.send(IPC.openRoom, payload.roomId);
    });
    notification.on("close", () => activeNotifications.delete(notification));
    notification.show();
  });

  ipcMain.on(IPC.setBadge, (event, count: number) => {
    if (!fromApp(event) || !win) return;
    unreadCount = count;
    win.setOverlayIcon(
      count > 0 ? nativeImage.createFromPath(iconPath("overlay.png")) : null,
      count > 0 ? `안 읽은 메시지 ${count}` : "",
    );
    refreshTray();
  });

  ipcMain.on(IPC.flashFrame, (event) => {
    if (!fromApp(event) || !win || win.isFocused()) return;
    win.flashFrame(true);
  });

  ipcMain.handle(IPC.getVersion, (event) => (fromApp(event) ? app.getVersion() : ""));
}

/** 입력 없음 10분 또는 화면 잠금이면 자리비움 */
function watchIdle() {
  const update = (next: boolean) => {
    if (next === idle) return;
    idle = next;
    win?.webContents.send(IPC.idle, idle);
  };
  const poll = () => update(powerMonitor.getSystemIdleState(IDLE_THRESHOLD_SECONDS) !== "active");
  setInterval(poll, IDLE_POLL_MS);
  powerMonitor.on("lock-screen", () => update(true));
  powerMonitor.on("unlock-screen", poll);
  powerMonitor.on("suspend", () => update(true));
  powerMonitor.on("resume", poll);
  // 화면을 새로 불러오면 현재 상태를 다시 알려 준다
  win?.webContents.on("did-finish-load", () => win?.webContents.send(IPC.idle, idle));
}

/** GitHub Releases 자동 업데이트 (설치본에서만) */
function checkForUpdates() {
  if (!app.isPackaged) return;
  const check = () => void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  check();
  setInterval(check, UPDATE_CHECK_MS);
}

app.on("before-quit", () => {
  quitting = true;
});

// 트레이 상주: 창을 모두 닫아도 종료하지 않는다
app.on("window-all-closed", () => undefined);
