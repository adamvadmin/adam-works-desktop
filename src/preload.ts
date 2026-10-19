/**
 * 웹 화면(works.adamv.kr/messenger)에 노출하는 window.desktop.
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
} as const;

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

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
  openRoomWindow: (roomId: number) => ipcRenderer.send(IPC.openRoomWindow, Number(roomId)),
});
