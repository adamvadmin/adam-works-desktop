import { app } from "electron";
import path from "node:path";

/** 불러올 메신저 화면. 로컬 개발은 ADAM_WORKS_URL=http://localhost:3000/messenger */
export const APP_URL = process.env.ADAM_WORKS_URL || "https://works.adamv.kr/messenger";

/** 창 안에서 이동을 허용하는 출처 (그 외 링크는 기본 브라우저로 연다) */
export const APP_ORIGIN = new URL(APP_URL).origin;

/** 방 전용 창 주소 */
export function roomUrl(roomId: number): string {
  return `${APP_ORIGIN}/messenger/rooms/${roomId}`;
}

export const APP_USER_MODEL_ID = "kr.adamv.works.messenger";

/** 자리비움 판단: 입력 없음 10분 */
export const IDLE_THRESHOLD_SECONDS = 600;
export const IDLE_POLL_MS = 15_000;

/** 화면을 못 불러왔을 때 다시 시도 간격 */
export const RELOAD_RETRY_MS = 5_000;

/** 자동 업데이트 확인 간격 */
export const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

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
} as const;

export function iconPath(name: string): string {
  // 패키징 후에도 app 경로 기준으로 build/icons에 들어 있다
  return path.join(app.getAppPath(), "build", "icons", name);
}
