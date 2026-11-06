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
  openViewerWindow: "desktop:open-viewer-window",
  openNewRoomWindow: "desktop:open-new-room-window",
  openRoomInfoWindow: "desktop:open-room-info-window",
  openInviteWindow: "desktop:open-invite-window",
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
  downloadDone: "desktop:download-done",
  downloadOpen: "desktop:download-open",
  downloadShow: "desktop:download-show",
  notifyLink: "desktop:notify-link",
  openWorkWindow: "desktop:open-work-window",
} as const;

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/** 작업표시줄 안 읽음 배지: 짙은 남색 바탕(빨간 아이콘 위에서 구분되게) + 흰 숫자, 흰 테두리 */
const BADGE = { background: "#1f2937", text: "#ffffff", ring: "#ffffff" } as const;
const BADGE_FONT = '"Segoe UI Variable Text", "Segoe UI", "Malgun Gothic", Arial, sans-serif';
/** Windows 배지는 16px(배율 100%) 기준. 배율마다 따로 그려 줄일 때 번지지 않게 한다 */
const BADGE_SCALES = [1, 1.25, 1.5, 2] as const;
const BADGE_BASE_PX = 16;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 한 글자는 원, 두 글자 이상은 알약 모양. 그리지 못하면 null (메인 프로세스가 기본 그림을 쓴다) */
function drawBadge(text: string, size: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ring = Math.max(1, Math.round(size / 16));
  const single = text.length === 1;
  const top = single ? 0 : Math.round(size * 0.12);
  const height = single ? size : size - 2 * top;
  const shape = (inset: number) => {
    if (single) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - inset, 0, Math.PI * 2);
    } else {
      roundRect(ctx, inset, top + inset, size - 2 * inset, height - 2 * inset, height / 2 - inset);
    }
  };
  ctx.fillStyle = BADGE.ring;
  shape(0);
  ctx.fill();
  ctx.fillStyle = BADGE.background;
  shape(ring);
  ctx.fill();
  const fontPx = size * (single ? 0.72 : text.length === 2 ? 0.6 : 0.5);
  ctx.font = `700 ${fontPx}px ${BADGE_FONT}`;
  const maxWidth = size - 3 * ring;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) ctx.font = `700 ${(fontPx * maxWidth) / width}px ${BADGE_FONT}`;
  ctx.fillStyle = BADGE.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2 + size * 0.03);
  return canvas.toDataURL("image/png");
}

function badgeImages(count: number): { scaleFactor: number; dataURL: string }[] {
  if (count <= 0) return [];
  const text = count > 99 ? "99+" : String(count);
  try {
    return BADGE_SCALES.flatMap((scaleFactor) => {
      const dataURL = drawBadge(text, Math.round(BADGE_BASE_PX * scaleFactor));
      return dataURL ? [{ scaleFactor, dataURL }] : [];
    });
  } catch {
    return [];
  }
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
  // 결재·메일 등 알림 (0.5.0+). 누르면 업무 창에서 그 화면을 연다
  notifyLink: (notification: { title: string; body: string; path: string }) =>
    ipcRenderer.send(IPC.notifyLink, {
      title: String(notification.title).slice(0, 200),
      body: String(notification.body).slice(0, 500),
      path: String(notification.path ?? "").slice(0, 500),
    }),
  // 업무 창 열기 (0.5.0+). 이미 열려 있으면 그 화면으로 옮겨 앞으로 띄운다
  openWorkWindow: (path: string) => ipcRenderer.send(IPC.openWorkWindow, String(path ?? "").slice(0, 500)),
  setBadge: (count: number) => {
    const value = Math.max(0, Math.floor(Number(count) || 0));
    ipcRenderer.send(IPC.setBadge, { count: value, images: badgeImages(value) });
  },
  flashFrame: () => ipcRenderer.send(IPC.flashFrame),
  getVersion: () => ipcRenderer.invoke(IPC.getVersion) as Promise<string>,
  onIdleChange: (callback: (idle: boolean) => void) => subscribe<boolean>(IPC.idle, callback),
  onOpenRoom: (callback: (roomId: number) => void) => subscribe<number>(IPC.openRoom, callback),
  openRoomWindow: (roomId: number, seq?: number) =>
    ipcRenderer.send(IPC.openRoomWindow, { roomId: Number(roomId), seq: seq == null ? undefined : Number(seq) }),
  onJumpToMessage: (callback: (seq: number) => void) => subscribe<number>(IPC.jumpToMessage, callback),
  openViewerWindow: (target: Record<string, unknown>) =>
    ipcRenderer.send(IPC.openViewerWindow, {
      roomId: Number(target.roomId),
      attachmentId: Number(target.attachmentId),
      fileName: String(target.fileName ?? "").slice(0, 255),
      ext: String(target.ext ?? "").slice(0, 20),
      mime: String(target.mime ?? "").slice(0, 100),
      sizeBytes: Number(target.sizeBytes) || 0,
      previewable: Boolean(target.previewable),
      senderName: String(target.senderName ?? "").slice(0, 100),
      createdAt: String(target.createdAt ?? "").slice(0, 40),
    }),
  openNewRoomWindow: () => ipcRenderer.send(IPC.openNewRoomWindow),
  openRoomInfoWindow: (roomId: number) => ipcRenderer.send(IPC.openRoomInfoWindow, Number(roomId)),
  openInviteWindow: (roomId: number) => ipcRenderer.send(IPC.openInviteWindow, Number(roomId)),
  appReady: () => ipcRenderer.send(IPC.appReady),
  // 받은 파일 저장이 끝나면 알린다 (0.4.3+). id로 열기·폴더 보기를 요청한다
  onDownloadDone: (callback: (result: unknown) => void) => subscribe(IPC.downloadDone, callback),
  openDownload: (id: string) => ipcRenderer.invoke(IPC.downloadOpen, String(id)) as Promise<boolean>,
  showDownloadInFolder: (id: string) => ipcRenderer.send(IPC.downloadShow, String(id)),
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
