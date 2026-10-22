import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 불러올 메신저 화면. 로컬 개발은 ADAM_WORKS_URL=http://localhost:3000/messenger */
export const APP_URL = process.env.ADAM_WORKS_URL || "https://works.adamv.kr/messenger";

/** 창 안에서 이동을 허용하는 출처 (그 외 링크는 기본 브라우저로 연다) */
export const APP_ORIGIN = new URL(APP_URL).origin;

/** 방 전용 창 주소 (seq를 주면 그 메시지로 이동) */
export function roomUrl(roomId: number, seq?: number): string {
  const base = `${APP_ORIGIN}/messenger/rooms/${roomId}`;
  return seq != null ? `${base}?seq=${seq}` : base;
}

export const APP_USER_MODEL_ID = "kr.adamv.works.messenger";

/** 자리비움 판단: 입력 없음 10분 */
export const IDLE_THRESHOLD_SECONDS = 600;
export const IDLE_POLL_MS = 15_000;

/** 화면을 못 불러왔을 때 다시 시도 간격 */
export const RELOAD_RETRY_MS = 5_000;

/** 자동 업데이트 확인 간격 (새 버전을 내려받으면 다시 시작하라고 안내) */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** 시작 화면을 띄운 뒤 웹이 준비 신호를 보내지 않아도 목록 창을 띄우는 시간 (이전 웹 호환·느린 네트워크) */
export const MAIN_REVEAL_FALLBACK_MS = 8_000;

/** 방 창: 준비 신호가 없어도 띄우는 시간 */
export const ROOM_REVEAL_FALLBACK_MS = 2_500;

/** 방 창을 연달아 열 때 겹치지 않게 비켜 놓는 간격 */
export const ROOM_WINDOW_CASCADE_PX = 28;

export const IPC = {
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

export function iconPath(name: string): string {
  // 패키징 후에도 app 경로 기준으로 build/icons에 들어 있다
  return path.join(app.getAppPath(), "build", "icons", name);
}

/** 앱에 들어 있는 로컬 화면 (시작 화면·연결 대기·설정) */
export function pagePath(name: string): string {
  return path.join(app.getAppPath(), "pages", name);
}

/** 로컬 화면 주소 접두사 (IPC 발신자 확인용) */
export function pagesUrlPrefix(): string {
  return pathToFileURL(path.join(app.getAppPath(), "pages") + path.sep).href;
}
