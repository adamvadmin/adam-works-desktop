import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  screen,
  shell,
  Tray,
  type BrowserWindowConstructorOptions,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { autoUpdater } from "electron-updater";
import fs from "node:fs";
import path from "node:path";
import {
  APP_ORIGIN,
  APP_URL,
  APP_USER_MODEL_ID,
  IDLE_POLL_MS,
  IDLE_THRESHOLD_SECONDS,
  IPC,
  MAIN_REVEAL_FALLBACK_MS,
  NEW_ROOM_URL,
  RELOAD_RETRY_MS,
  ROOM_REVEAL_FALLBACK_MS,
  ROOM_WINDOW_CASCADE_PX,
  UPDATE_CHECK_MS,
  iconPath,
  pagePath,
  pagesUrlPrefix,
  roomUrl,
  viewerUrl,
} from "./config";
import {
  initialBounds,
  readPreferences,
  readSettings,
  roomWindowSize,
  trackRoomWindowSize,
  trackViewerWindowSize,
  trackWindowState,
  viewerWindowSize,
  writePreferences,
  writeSettings,
} from "./window-state";

const APP_NAME = "V WORKS 메신저";
const SURFACE_COLOR = "#ffffff";
/** 미리보기 화면 배경 (웹 .gw-viewer) */
const VIEWER_COLOR = "#131313";

/** 메인 창 = 대화 목록 (닫으면 트레이로 숨김) */
let win: BrowserWindow | null = null;
/** 방 전용 창 (roomId → 창). 닫으면 없어진다 */
const roomWindows = new Map<number, BrowserWindow>();
/** 시작 화면 (목록 창이 준비되면 닫는다) */
let splash: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
/** 첨부 미리보기 창 (하나만 두고, 다른 첨부를 열면 내용을 바꾼다) */
let viewerWindow: BrowserWindow | null = null;
/** 새 대화 창 (하나만) */
let newRoomWindow: BrowserWindow | null = null;
/** 화면을 띄운 창 (웹의 준비 신호·대체 시간 중 먼저 온 쪽에서 한 번만 띄운다) */
const revealed = new WeakSet<BrowserWindow>();
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

/** 자동 실행(로그인 시 시작)은 트레이에만 두고 창은 띄우지 않는다 */
const startHidden = process.argv.includes("--hidden");

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
  if (isDevTarget) ensureDevShortcut();
  if (!startHidden) createSplash();
  createMainWindow();
  createTray();
  registerIpc();
  watchIdle();
  checkForUpdates();
}

/**
 * 개발 실행용 시작 메뉴 바로가기. 작업표시줄·알림은 앱 ID가 같은 바로가기의 아이콘을 쓰는데,
 * 없으면 Electron이 알림을 띄우며 "Electron.lnk"(원자 아이콘)를 만들어 작업표시줄에 그 아이콘이 나온다.
 */
function ensureDevShortcut() {
  if (process.platform !== "win32") return;
  const programs = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  const link = path.join(programs, `${APP_NAME} (개발).lnk`);
  try {
    shell.writeShortcutLink(link, fs.existsSync(link) ? "update" : "create", {
      target: process.execPath,
      args: `"${app.getAppPath()}"`,
      appUserModelId: `${APP_USER_MODEL_ID}.dev`,
      icon: iconPath("icon.ico"),
      iconIndex: 0,
      description: `${APP_NAME} 개발 실행`,
    });
    const electronLink = path.join(programs, "Electron.lnk");
    if (fs.existsSync(electronLink) && shell.readShortcutLink(electronLink).target === process.execPath) {
      fs.unlinkSync(electronLink);
    }
  } catch {
    // 바로가기를 못 만들어도 실행에는 지장 없다 (아이콘만 Electron 기본)
  }
}

function isAppUrl(url: string) {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function isLocalPageUrl(url: string) {
  return url.startsWith(pagesUrlPrefix());
}

function openExternal(url: string) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

/** 메인·방·미리보기 창 (웹 화면을 띄우는 창) */
function allWindows(): BrowserWindow[] {
  return [win, ...roomWindows.values(), viewerWindow, newRoomWindow].filter((w): w is BrowserWindow => w != null && !w.isDestroyed());
}

/** 제목 표시줄 없는 창의 공통 설정. 창 테두리·그림자·Windows 11 둥근 모서리·크기 조절은 유지된다 */
function framelessOptions(): BrowserWindowConstructorOptions {
  return {
    titleBarStyle: "hidden",
    show: false,
    icon: iconPath("icon.png"),
    backgroundColor: SURFACE_COLOR,
    autoHideMenuBar: true,
  };
}

/** 메인·방 창 공통: 보안 설정, 외부 링크, 오프라인 재시도, 우클릭 메뉴, 단축키, 창 상태 전달 */
function createAppWindow(options: BrowserWindowConstructorOptions, url: string): BrowserWindow {
  const window = new BrowserWindow({
    minWidth: 360,
    minHeight: 420,
    ...framelessOptions(),
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
    if (isAppUrl(target) || isLocalPageUrl(target)) return;
    event.preventDefault();
    openExternal(target);
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!isAppUrl(target)) openExternal(target);
    return { action: "deny" };
  });

  // 서버에 닿지 않으면 안내 화면을 띄우고 주기적으로 다시 시도
  window.webContents.on("did-fail-load", (_event, errorCode, _desc, _failedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ABORTED */) return;
    void window.loadFile(pagePath("offline.html"));
    reveal(window);
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

  // Ctrl+W = 창 닫기. 개발 실행에서만 Ctrl+Shift+I 개발자 도구.
  // 한글 입력 상태에서는 key가 "ㅈ"이 되므로 자판 위치(code)로 본다
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control) return;
    if (input.code === "KeyW" && !input.shift && !input.alt) {
      event.preventDefault();
      window.close();
    } else if (input.code === "KeyI" && input.shift && !app.isPackaged) {
      event.preventDefault();
      window.webContents.toggleDevTools();
    }
  });

  // 손가락 확대(핀치) 막기. 글자 크기는 설정의 화면 배율로만 바꾼다
  void window.webContents.setVisualZoomLevelLimits(1, 1);

  // 화면을 새로 불러오면 현재 자리비움 상태·창 상태·배율을 다시 맞춘다
  window.webContents.on("did-finish-load", () => {
    window.webContents.setZoomFactor(readPreferences().zoom);
    window.webContents.send(IPC.idle, idle);
    sendWindowState(window);
  });
  // 창이 닫히는 도중에도 focus·blur가 올 수 있다 (이미 파괴된 창을 건드리면 메인 프로세스 오류)
  window.on("focus", () => {
    if (!window.isDestroyed()) window.flashFrame(false);
  });
  const syncState = () => sendWindowState(window);
  window.on("maximize", syncState);
  window.on("unmaximize", syncState);
  window.on("restore", syncState);
  window.on("focus", syncState);
  window.on("blur", syncState);
  window.on("always-on-top-changed", syncState);

  void window.loadURL(url);
  return window;
}

function windowState(window: BrowserWindow) {
  return { maximized: window.isMaximized(), pinned: window.isAlwaysOnTop(), focused: window.isFocused() };
}

function sendWindowState(window: BrowserWindow) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(IPC.windowState, windowState(window));
}

/** 시작 화면: 목록 창이 서버에서 화면을 받아 그릴 때까지 띄워 둔다 (빈 창·로딩 글자 대신) */
function createSplash() {
  splash = new BrowserWindow({
    width: 300,
    height: 340,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    icon: iconPath("icon.png"),
    backgroundColor: SURFACE_COLOR,
    title: APP_NAME,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  splash.once("ready-to-show", () => splash?.show());
  splash.on("closed", () => {
    splash = null;
  });
  void splash.loadFile(pagePath("splash.html"));
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
}

/** 창을 처음 띄운다. 웹의 준비 신호(appReady)·연결 실패·대체 시간 중 먼저 오는 쪽에서 한 번만 */
function reveal(window: BrowserWindow) {
  if (window.isDestroyed() || revealed.has(window)) return;
  revealed.add(window);
  if (window === win) {
    closeSplash();
    if (startHidden) return;
    if (readSettings().maximized) window.maximize();
    showWindow(window);
    return;
  }
  showWindow(window);
}

function createMainWindow() {
  const settings = readSettings();
  win = createAppWindow({ ...initialBounds(), title: APP_NAME }, APP_URL);
  if (settings.mainPinned) win.setAlwaysOnTop(true);
  trackWindowState(win);

  const main = win;
  setTimeout(() => reveal(main), MAIN_REVEAL_FALLBACK_MS);

  // 목록 창이 로그인 화면으로 가면(로그아웃·세션 만료) 방·미리보기 창을 닫는다
  const closeOthersOnLogin = (_event: unknown, url: string) => {
    if (!isAppUrl(url) || !new URL(url).pathname.startsWith("/login")) return;
    for (const window of allWindows()) if (window !== main) window.close();
    setBadge(0);
  };
  win.webContents.on("did-navigate", closeOthersOnLogin);
  win.webContents.on("did-navigate-in-page", closeOthersOnLogin);

  // 닫기 = 트레이로 숨김 (설정에서 "닫으면 종료"를 고르면 종료)
  win.on("close", (event) => {
    if (quitting) return;
    if (!readPreferences().closeToTray) {
      quitting = true;
      app.quit();
      return;
    }
    event.preventDefault();
    win?.hide();
    if (!readSettings().trayHintShown) {
      writeSettings({ trayHintShown: true });
      new Notification({
        title: APP_NAME,
        body: "트레이에서 계속 실행 중입니다. 종료하려면 트레이 아이콘을 우클릭하세요.",
      }).show();
    }
  });
}

/** 방 창 열기 (이미 열려 있으면 앞으로). seq를 주면 그 메시지로 이동 */
function openRoomWindow(roomId: number, seq?: number) {
  const existing = roomWindows.get(roomId);
  if (existing && !existing.isDestroyed()) {
    showWindow(existing);
    if (seq != null) existing.webContents.send(IPC.jumpToMessage, seq);
    return;
  }
  const size = roomWindowSize();
  const position = cascadePosition();
  const room = createAppWindow({ ...size, ...position, title: APP_NAME }, roomUrl(roomId, seq));
  roomWindows.set(roomId, room);
  trackRoomWindowSize(room);
  setTimeout(() => reveal(room), ROOM_REVEAL_FALLBACK_MS);
  room.on("closed", () => roomWindows.delete(roomId));
}

/** 첨부 미리보기 창 열기. 이미 열려 있으면 그 창에 새 첨부를 띄운다. 마우스가 있는 화면 가운데에 연다 */
function openViewerWindow(query: URLSearchParams) {
  const url = viewerUrl(query);
  // 창 제목 = 파일명 (웹은 페이지 제목을 "V WORKS"로 덮어쓰므로 여기서 고정한다)
  const title = query.get("name") || APP_NAME;
  if (viewerWindow && !viewerWindow.isDestroyed()) {
    viewerWindow.setTitle(title);
    void viewerWindow.loadURL(url);
    showWindow(viewerWindow);
    return;
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const saved = viewerWindowSize();
  const width = Math.min(saved.width, area.width);
  const height = Math.min(saved.height, area.height);
  const viewer = createAppWindow(
    {
      width,
      height,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      minHeight: 320,
      title,
      backgroundColor: VIEWER_COLOR,
    },
    url,
  );
  viewerWindow = viewer;
  viewer.on("page-title-updated", (event) => event.preventDefault());
  trackViewerWindowSize(viewer);
  setTimeout(() => reveal(viewer), ROOM_REVEAL_FALLBACK_MS);
  viewer.on("closed", () => {
    if (viewerWindow === viewer) viewerWindow = null;
  });
}

/** 새 대화 창 열기 (이미 열려 있으면 앞으로). 목록 창 가운데 위에 연다 */
function openNewRoomWindow() {
  if (newRoomWindow && !newRoomWindow.isDestroyed()) {
    showWindow(newRoomWindow);
    return;
  }
  const width = 420;
  const height = 640;
  const position: { x?: number; y?: number } = {};
  if (win && !win.isDestroyed() && win.isVisible()) {
    const bounds = win.getBounds();
    position.x = Math.round(bounds.x + (bounds.width - width) / 2);
    position.y = Math.round(bounds.y + Math.max(0, (bounds.height - height) / 2));
  }
  const window = createAppWindow({ width, height, ...position, minHeight: 480, title: APP_NAME }, NEW_ROOM_URL);
  newRoomWindow = window;
  setTimeout(() => reveal(window), ROOM_REVEAL_FALLBACK_MS);
  window.on("closed", () => {
    if (newRoomWindow === window) newRoomWindow = null;
  });
}

/** 미리보기 창 요청 검증 → 창 주소 쿼리 */
function viewerQuery(payload: unknown): URLSearchParams | null {
  if (payload == null || typeof payload !== "object") return null;
  const target = payload as Record<string, unknown>;
  const roomId = Number(target.roomId);
  const attachmentId = Number(target.attachmentId);
  if (!Number.isInteger(roomId) || roomId <= 0 || !Number.isInteger(attachmentId) || attachmentId <= 0) return null;
  const text = (value: unknown, max: number) => String(value ?? "").slice(0, max);
  return new URLSearchParams({
    room: String(roomId),
    id: String(attachmentId),
    name: text(target.fileName, 255),
    ext: text(target.ext, 20),
    mime: text(target.mime, 100),
    size: String(Math.max(0, Number(target.sizeBytes) || 0)),
    preview: target.previewable === true ? "1" : "0",
    by: text(target.senderName, 100),
    at: text(target.createdAt, 40),
  });
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

/** 설정 창 (앱 안 로컬 화면). 하나만 띄운다 */
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    showWindow(settingsWindow);
    return;
  }
  settingsWindow = new BrowserWindow({
    ...framelessOptions(),
    width: 400,
    height: 660,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: `${APP_NAME} 설정`,
    parent: win && win.isVisible() ? win : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  const window = settingsWindow;
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && (input.key === "Escape" || (input.control && input.code === "KeyW"))) {
      event.preventDefault();
      window.close();
    }
  });
  window.on("focus", () => sendWindowState(window));
  window.on("blur", () => sendWindowState(window));
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    settingsWindow = null;
  });
  void window.loadFile(pagePath("settings.html"));
}

function showWindow(window: BrowserWindow | null | undefined) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** 작업표시줄 오버레이(빨간 점)·트레이 아이콘·툴팁 */
function setBadge(count: number) {
  unreadCount = count;
  if (win && !win.isDestroyed()) {
    win.setOverlayIcon(
      count > 0 ? nativeImage.createFromPath(iconPath("overlay.png")) : null,
      count > 0 ? `안 읽은 메시지 ${count}` : "",
    );
  }
  refreshTray();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath("tray.png")));
  tray.on("click", () => showWindow(win));
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const preferences = readPreferences();
  tray.setImage(nativeImage.createFromPath(iconPath(unreadCount > 0 ? "tray-unread.png" : "tray.png")));
  tray.setToolTip(unreadCount > 0 ? `${APP_NAME} · 안 읽은 메시지 ${unreadCount}` : APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "열기", click: () => showWindow(win) },
      { label: "설정", click: openSettingsWindow },
      { type: "separator" },
      {
        label: "알림 끄기",
        type: "checkbox",
        checked: !preferences.notify,
        click: (item) => {
          writePreferences({ notify: !item.checked });
          refreshTray();
        },
      },
      { type: "separator" },
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

function fromSettings(event: IpcMainEvent | IpcMainInvokeEvent) {
  return settingsWindow != null && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents;
}

/** 창 버튼: 우리 창이 웹 화면이나 앱 안 로컬 화면(연결 대기·설정)에서 보낸 것만 */
function controlledWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
  const url = event.senderFrame?.url ?? "";
  if (!isAppUrl(url) && !isLocalPageUrl(url)) return null;
  const window = BrowserWindow.fromWebContents(event.sender);
  const ours = window != null && (allWindows().includes(window) || window === settingsWindow);
  return ours && !window.isDestroyed() ? window : null;
}

function notificationContent(payload: { title: string; body: string }) {
  return readPreferences().preview
    ? { title: payload.title, body: payload.body }
    : { title: APP_NAME, body: "새 메시지가 있습니다." };
}

function registerIpc() {
  // 알림은 메인(목록) 창만 요청한다. 해당 방 창을 보고 있으면 알림 대신 아무것도 하지 않는다
  ipcMain.on(IPC.notify, (event, payload: { title: string; body: string; roomId: number }) => {
    if (!fromMainWindow(event)) return;
    const room = roomWindows.get(payload.roomId);
    if (room && !room.isDestroyed() && room.isVisible() && room.isFocused()) return;
    if (room && !room.isDestroyed() && room.isVisible()) room.flashFrame(true);
    else if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
    const preferences = readPreferences();
    if (!preferences.notify || !Notification.isSupported()) return;
    const notification = new Notification({
      ...notificationContent(payload),
      icon: iconPath("icon.png"),
      silent: !preferences.sound,
    });
    activeNotifications.add(notification);
    notification.on("click", () => {
      if (Number.isFinite(payload.roomId)) openRoomWindow(payload.roomId);
      else showWindow(win);
    });
    notification.on("close", () => activeNotifications.delete(notification));
    notification.show();
  });

  ipcMain.on(IPC.setBadge, (event, count: number) => {
    if (fromMainWindow(event)) setBadge(count);
  });

  ipcMain.on(IPC.flashFrame, (event) => {
    if (!fromApp(event)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isFocused()) window.flashFrame(true);
  });

  // 0.2.x 웹은 방 ID 숫자만, 0.3.0+는 { roomId, seq }를 보낸다
  ipcMain.on(IPC.openRoomWindow, (event, payload: number | { roomId: number; seq?: number }) => {
    if (!fromApp(event)) return;
    const roomId = typeof payload === "number" ? payload : payload?.roomId;
    const seq = typeof payload === "object" && Number.isInteger(payload?.seq) ? payload.seq : undefined;
    if (!Number.isInteger(roomId) || roomId <= 0) return;
    openRoomWindow(roomId, seq != null && seq > 0 ? seq : undefined);
  });

  ipcMain.on(IPC.openNewRoomWindow, (event) => {
    if (fromApp(event)) openNewRoomWindow();
  });

  ipcMain.on(IPC.openViewerWindow, (event, payload: unknown) => {
    if (!fromApp(event)) return;
    const query = viewerQuery(payload);
    if (query) openViewerWindow(query);
  });

  ipcMain.handle(IPC.getVersion, (event) => (fromApp(event) || fromSettings(event) ? app.getVersion() : ""));

  ipcMain.on(IPC.appReady, (event) => {
    if (!fromApp(event)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) reveal(window);
  });

  ipcMain.on(IPC.openSettings, (event) => {
    if (fromApp(event)) openSettingsWindow();
  });

  // —— 창 버튼 (웹이 그리는 제목 표시줄) ——
  ipcMain.on(IPC.windowMinimize, (event) => controlledWindow(event)?.minimize());
  ipcMain.on(IPC.windowToggleMaximize, (event) => {
    const window = controlledWindow(event);
    if (!window || !window.isMaximizable()) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on(IPC.windowClose, (event) => controlledWindow(event)?.close());
  ipcMain.on(IPC.windowSetPinned, (event, pinned: boolean) => {
    const window = controlledWindow(event);
    if (!window) return;
    window.setAlwaysOnTop(Boolean(pinned));
    if (window === win) writeSettings({ mainPinned: Boolean(pinned) });
    sendWindowState(window);
  });
  ipcMain.handle(IPC.windowGetState, (event) => {
    const window = controlledWindow(event);
    return window ? windowState(window) : null;
  });

  // —— 설정 창 ——
  ipcMain.handle(IPC.settingsGet, (event) => {
    if (!fromSettings(event)) return null;
    return {
      ...readPreferences(),
      openAtLogin: app.getLoginItemSettings().openAtLogin,
      version: app.getVersion(),
      packaged: app.isPackaged,
      readyUpdateVersion,
    };
  });
  ipcMain.handle(IPC.settingsSet, (event, patch: Record<string, unknown>) => {
    if (!fromSettings(event) || patch == null || typeof patch !== "object") return null;
    if (typeof patch.openAtLogin === "boolean") {
      app.setLoginItemSettings({ openAtLogin: patch.openAtLogin, args: ["--hidden"] });
    }
    const preferences = writePreferences(patch);
    for (const window of allWindows()) window.webContents.setZoomFactor(preferences.zoom);
    refreshTray();
    return { ...preferences, openAtLogin: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle(IPC.settingsCheckUpdate, async (event) => {
    if (!fromSettings(event)) return null;
    return checkUpdateForSettings();
  });
  ipcMain.on(IPC.settingsInstallUpdate, (event) => {
    if (fromSettings(event)) installUpdateNow();
  });
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
 * 내려받기가 끝나면 알림·트레이 메뉴·설정 창으로 "다시 시작해 적용"을 안내한다.
 * 그냥 두어도 종료할 때 설치되지만, 창 닫기는 트레이로 숨김이라 종료가 드물다.
 */
function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.on("update-downloaded", (info) => {
    readyUpdateVersion = info.version;
    refreshTray();
    const notification = new Notification({
      title: `${APP_NAME} 업데이트`,
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

/** 설정 창의 "업데이트 확인" 결과 */
async function checkUpdateForSettings(): Promise<{ state: "dev" | "ready" | "latest" | "downloading" | "error"; version?: string }> {
  if (!app.isPackaged) return { state: "dev" };
  if (readyUpdateVersion) return { state: "ready", version: readyUpdateVersion };
  try {
    const result = await autoUpdater.checkForUpdates();
    return result?.isUpdateAvailable
      ? { state: "downloading", version: result.updateInfo.version }
      : { state: "latest" };
  } catch {
    return { state: "error" };
  }
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
