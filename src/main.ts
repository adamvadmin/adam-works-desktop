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
  type BrowserWindowConstructorOptions,
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
  ROOM_WINDOW_CASCADE_PX,
  UPDATE_CHECK_MS,
  iconPath,
  roomUrl,
} from "./config";
import {
  initialBounds,
  readSettings,
  roomWindowSize,
  trackRoomWindowSize,
  trackWindowState,
  writeSettings,
} from "./window-state";

/** 메인 창 = 대화 목록 (닫으면 트레이로 숨김) */
let win: BrowserWindow | null = null;
/** 방 전용 창 (roomId → 창). 닫으면 없어진다 */
const roomWindows = new Map<number, BrowserWindow>();
let tray: Tray | null = null;
let quitting = false;
let unreadCount = 0;
let idle = false;
/** 내려받아 둔 업데이트 버전 (다시 시작하면 적용) */
let readyUpdateVersion: string | null = null;
// 알림 객체는 닫힐 때까지 참조를 잡아 둔다 (GC되면 클릭 이벤트가 사라진다)
const activeNotifications = new Set<Notification>();

// 다른 주소(로컬 개발 등)로 띄우면 설치본과 데이터·중복 실행 잠금·앱 ID를 나눈다.
// 앱 ID가 같으면 개발 실행 때 띄운 Windows 알림을 눌렀을 때 개발용 electron.exe가 앱 없이 켜진다.
const isDevTarget = Boolean(process.env.ADAM_WORKS_URL);
if (isDevTarget) {
  app.setPath("userData", `${app.getPath("userData")}-dev`);
}

// —— 중복 실행 방지: 두 번째 실행은 기존 창을 띄운다 ——
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow(win));
  app.setAppUserModelId(isDevTarget ? `${APP_USER_MODEL_ID}.dev` : APP_USER_MODEL_ID);
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
  createMainWindow();
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

function allWindows(): BrowserWindow[] {
  return [win, ...roomWindows.values()].filter((w): w is BrowserWindow => w != null && !w.isDestroyed());
}

/** 메인·방 창 공통: 보안 설정, 외부 링크, 오프라인 재시도, 우클릭 메뉴 */
function createAppWindow(options: BrowserWindowConstructorOptions, url: string): BrowserWindow {
  const window = new BrowserWindow({
    minWidth: 360,
    minHeight: 420,
    show: false,
    icon: iconPath("icon.png"),
    backgroundColor: "#f7f8fa",
    autoHideMenuBar: true,
    ...options,
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

  // 허용 출처 밖으로 이동·새 창은 기본 브라우저로
  window.webContents.on("will-navigate", (event, target) => {
    if (isAppUrl(target)) return;
    event.preventDefault();
    openExternal(target);
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!isAppUrl(target)) openExternal(target);
    return { action: "deny" };
  });

  // 서버에 닿지 않으면 안내 화면을 띄우고 주기적으로 다시 시도
  window.webContents.on("did-fail-load", (_event, errorCode, _desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ABORTED */) return;
    void window.loadURL(offlinePage(failedUrl));
    setTimeout(() => {
      if (!window.isDestroyed()) void window.loadURL(url);
    }, RELOAD_RETRY_MS);
  });

  // 텍스트 선택·입력창 우클릭 메뉴 (Electron은 기본 메뉴가 없다)
  window.webContents.on("context-menu", (_event, params) => {
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
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window });
  });

  // 화면을 새로 불러오면 현재 자리비움 상태를 다시 알려 준다
  window.webContents.on("did-finish-load", () => window.webContents.send(IPC.idle, idle));
  window.on("focus", () => window.flashFrame(false));

  void window.loadURL(url);
  return window;
}

function createMainWindow() {
  const settings = readSettings();
  win = createAppWindow({ ...initialBounds(), title: "V WORKS 메신저" }, APP_URL);
  if (settings.maximized) win.maximize();
  trackWindowState(win);

  win.once("ready-to-show", () => {
    // 자동 실행(로그인 시 시작)은 트레이에만 두고 창은 띄우지 않는다
    if (!process.argv.includes("--hidden")) win?.show();
  });

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
}

/** 방 창 열기 (이미 열려 있으면 앞으로) */
function openRoomWindow(roomId: number) {
  const existing = roomWindows.get(roomId);
  if (existing && !existing.isDestroyed()) {
    showWindow(existing);
    return;
  }
  const size = roomWindowSize();
  const position = cascadePosition();
  const room = createAppWindow({ ...size, ...position, title: "V WORKS 메신저" }, roomUrl(roomId));
  roomWindows.set(roomId, room);
  trackRoomWindowSize(room);
  room.once("ready-to-show", () => showWindow(room));
  room.on("closed", () => roomWindows.delete(roomId));
}

/** 마지막으로 연 방 창(없으면 메인 창) 옆으로 비켜 놓는다 */
function cascadePosition(): { x?: number; y?: number } {
  const last = [...roomWindows.values()].filter((w) => !w.isDestroyed()).pop() ?? win;
  if (!last || last.isDestroyed() || !last.isVisible()) return {};
  const [x, y] = last.getPosition();
  if (last === win) {
    const [width] = last.getSize();
    return { x: x + width + 8, y };
  }
  return { x: x + ROOM_WINDOW_CASCADE_PX, y: y + ROOM_WINDOW_CASCADE_PX };
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

function showWindow(window: BrowserWindow | null | undefined) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath("tray.png")));
  tray.on("click", () => showWindow(win));
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  tray.setImage(nativeImage.createFromPath(iconPath(unreadCount > 0 ? "tray-unread.png" : "tray.png")));
  tray.setToolTip(unreadCount > 0 ? `V WORKS 메신저 · 안 읽은 메시지 ${unreadCount}` : "V WORKS 메신저");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "열기", click: () => showWindow(win) },
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
      readyUpdateVersion
        ? { label: `업데이트 적용하고 다시 시작 (${readyUpdateVersion})`, click: installUpdateNow }
        : { label: "업데이트 확인", enabled: app.isPackaged, click: checkUpdateNow },
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

/** 우리 창(메인·방)이 허용 출처에서 보낸 IPC만 받는다 */
function fromApp(event: IpcMainEvent | IpcMainInvokeEvent) {
  const url = event.senderFrame?.url ?? "";
  return allWindows().some((w) => w.webContents === event.sender) && isAppUrl(url);
}

function fromMainWindow(event: IpcMainEvent) {
  return fromApp(event) && event.sender === win?.webContents;
}

function registerIpc() {
  // 알림은 메인(목록) 창만 요청한다. 해당 방 창을 보고 있으면 알림 대신 아무것도 하지 않는다
  ipcMain.on(IPC.notify, (event, payload: { title: string; body: string; roomId: number }) => {
    if (!fromMainWindow(event)) return;
    const room = roomWindows.get(payload.roomId);
    if (room && !room.isDestroyed() && room.isVisible() && room.isFocused()) return;
    if (room && !room.isDestroyed() && room.isVisible()) room.flashFrame(true);
    else if (win && !win.isFocused()) win.flashFrame(true);
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: payload.title, body: payload.body, icon: iconPath("icon.png") });
    activeNotifications.add(notification);
    notification.on("click", () => {
      if (Number.isFinite(payload.roomId)) openRoomWindow(payload.roomId);
      else showWindow(win);
    });
    notification.on("close", () => activeNotifications.delete(notification));
    notification.show();
  });

  ipcMain.on(IPC.setBadge, (event, count: number) => {
    if (!fromMainWindow(event) || !win) return;
    unreadCount = count;
    win.setOverlayIcon(
      count > 0 ? nativeImage.createFromPath(iconPath("overlay.png")) : null,
      count > 0 ? `안 읽은 메시지 ${count}` : "",
    );
    refreshTray();
  });

  ipcMain.on(IPC.flashFrame, (event) => {
    if (!fromApp(event)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isFocused()) window.flashFrame(true);
  });

  ipcMain.on(IPC.openRoomWindow, (event, roomId: number) => {
    if (!fromApp(event) || !Number.isInteger(roomId) || roomId <= 0) return;
    openRoomWindow(roomId);
  });

  ipcMain.handle(IPC.getVersion, (event) => (fromApp(event) ? app.getVersion() : ""));
}

/** 입력 없음 10분 또는 화면 잠금이면 자리비움 (모든 창에 알린다) */
function watchIdle() {
  const update = (next: boolean) => {
    if (next === idle) return;
    idle = next;
    for (const window of allWindows()) window.webContents.send(IPC.idle, idle);
  };
  const poll = () => update(powerMonitor.getSystemIdleState(IDLE_THRESHOLD_SECONDS) !== "active");
  setInterval(poll, IDLE_POLL_MS);
  powerMonitor.on("lock-screen", () => update(true));
  powerMonitor.on("unlock-screen", poll);
  powerMonitor.on("suspend", () => update(true));
  powerMonitor.on("resume", poll);
}

/**
 * GitHub Releases 자동 업데이트 (설치본에서만).
 * 내려받기가 끝나면 알림·트레이 메뉴로 "다시 시작해 적용"을 안내한다.
 * 그냥 두어도 종료할 때 설치되지만, 창 닫기는 트레이로 숨김이라 종료가 드물다.
 */
function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.on("update-downloaded", (info) => {
    readyUpdateVersion = info.version;
    refreshTray();
    const notification = new Notification({
      title: "V WORKS 메신저 업데이트",
      body: `새 버전 ${info.version}이 준비됐습니다. 이 알림을 누르면 다시 시작해 적용합니다.`,
      icon: iconPath("icon.png"),
    });
    activeNotifications.add(notification);
    notification.on("click", installUpdateNow);
    notification.on("close", () => activeNotifications.delete(notification));
    notification.show();
  });
  checkUpdateNow();
  setInterval(checkUpdateNow, UPDATE_CHECK_MS);
}

function checkUpdateNow() {
  if (!app.isPackaged || readyUpdateVersion) return;
  void autoUpdater.checkForUpdates().catch(() => undefined);
}

function installUpdateNow() {
  if (!readyUpdateVersion) return;
  quitting = true;
  autoUpdater.quitAndInstall(true, true);
}

app.on("before-quit", () => {
  quitting = true;
});

// 트레이 상주: 창을 모두 닫아도 종료하지 않는다
app.on("window-all-closed", () => undefined);
