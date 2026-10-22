/**
 * 웹 화면(works.adamv.kr/messenger)과 앱 안 로컬 화면(pages/)에 노출하는 window.desktop.
 * 웹 쪽 타입: adam-works-fe/src/lib/chat/desktop.ts 와 맞춘다.
 * sandbox preload라 electron 모듈만 쓸 수 있다 (상수는 config.ts와 같은 값을 직접 둔다).
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const IPC = {
  notify: "desktop:notify",
  setBadge: "desktop:set-badge",
  flashFrame: "desktop:flash-frame",
  getVersion: "desktop:get-version",
  idle: "desktop:idle",
  openRoom: "desktop:open-room",
  openRoomWindow: "desktop:open-room-window",
  jumpToMessage: "desktop:jump-to-message",
  appReady: "desktop:app-ready",
  openSettings: "desktop:open-settings",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowSetPinned: "window:set-pinned",
  windowGetState: "window:get-state",
  windowState: "window:state",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsCheckUpdate: "settings:check-update",
  settingsInstallUpdate: "settings:install-update",
} as const;

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Ctrl+휠로 화면 전체가 확대되지 않게 한다 (글자 크기는 설정 창에서)
window.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) event.preventDefault();
  },
  { passive: false },
);

contextBridge.exposeInMainWorld("desktop", {
  notify: (notification: { title: string; body: string; roomId: number }) =>
    ipcRenderer.send(IPC.notify, {
      title: String(notification.title).slice(0, 200),
      body: String(notification.body).slice(0, 500),
      roomId: Number(notification.roomId),
    }),
  setBadge: (count: number) => ipcRenderer.send(IPC.setBadge, Math.max(0, Math.floor(Number(count) || 0))),
  flashFrame: () => ipcRenderer.send(IPC.flashFrame),
  getVersion: () => ipcRenderer.invoke(IPC.getVersion) as Promise<string>,
  onIdleChange: (callback: (idle: boolean) => void) => subscribe<boolean>(IPC.idle, callback),
  onOpenRoom: (callback: (roomId: number) => void) => subscribe<number>(IPC.openRoom, callback),
  openRoomWindow: (roomId: number, seq?: number) =>
    ipcRenderer.send(IPC.openRoomWindow, { roomId: Number(roomId), seq: seq == null ? undefined : Number(seq) }),
  onJumpToMessage: (callback: (seq: number) => void) => subscribe<number>(IPC.jumpToMessage, callback),
  appReady: () => ipcRenderer.send(IPC.appReady),
  openSettings: () => ipcRenderer.send(IPC.openSettings),
  windowControls: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    setPinned: (pinned: boolean) => ipcRenderer.send(IPC.windowSetPinned, Boolean(pinned)),
    getState: () => ipcRenderer.invoke(IPC.windowGetState),
    onStateChange: (callback: (state: unknown) => void) => subscribe(IPC.windowState, callback),
  },
  // 설정 창(pages/settings.html) 전용. 다른 화면에서 부르면 메인 프로세스가 무시한다
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke(IPC.settingsSet, patch),
    checkUpdate: () => ipcRenderer.invoke(IPC.settingsCheckUpdate),
    installUpdate: () => ipcRenderer.send(IPC.settingsInstallUpdate),
  },
});
