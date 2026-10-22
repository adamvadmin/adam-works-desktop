import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";

type Size = { width: number; height: number };

type Settings = {
  bounds?: Rectangle;
  maximized?: boolean;
  /** 방 창 크기 (마지막으로 조절한 크기를 모든 방 창이 쓴다) */
  roomSize?: Size;
  /** 첨부 미리보기 창 크기 */
  viewerSize?: Size;
  /** 닫기 = 트레이로 숨김 안내를 이미 보여 줬는지 */
  trayHintShown?: boolean;
  /** 목록 창 항상 위 */
  mainPinned?: boolean;
  preferences?: Partial<Preferences>;
};

/** 설정 창에서 바꾸는 값 */
export type Preferences = {
  /** 새 메시지 알림 표시 */
  notify: boolean;
  /** 알림에 보낸 사람·내용 표시 (끄면 "새 메시지가 있습니다"만) */
  preview: boolean;
  /** 알림 소리 */
  sound: boolean;
  /** 화면 배율 */
  zoom: number;
  /** 목록 창 닫기 = 트레이로 숨김 (끄면 프로그램 종료) */
  closeToTray: boolean;
};

export const ZOOM_LEVELS = [0.9, 1, 1.1, 1.25];

const DEFAULT_PREFERENCES: Preferences = { notify: true, preview: true, sound: true, zoom: 1, closeToTray: true };

/** 메인 창은 목록만 보이므로 카카오톡 목록처럼 좁게 시작한다 */
const DEFAULT_SIZE: Size = { width: 400, height: 720 };
const DEFAULT_ROOM_SIZE: Size = { width: 440, height: 680 };
const DEFAULT_VIEWER_SIZE: Size = { width: 900, height: 720 };

function file() {
  return path.join(app.getPath("userData"), "settings.json");
}

export function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf-8")) as Settings;
  } catch {
    return {};
  }
}

export function writeSettings(patch: Settings) {
  try {
    fs.writeFileSync(file(), JSON.stringify({ ...readSettings(), ...patch }, null, 2));
  } catch {
    // 설정 저장 실패는 무시 (다음 실행 때 기본값)
  }
}

/** 저장된 창 위치가 현재 모니터 안에 있으면 그대로, 아니면 기본 크기 */
export function initialBounds(): Partial<Rectangle> & Size {
  const saved = readSettings().bounds;
  if (!saved) return DEFAULT_SIZE;
  const visible = screen.getAllDisplays().some(({ workArea }) =>
    saved.x < workArea.x + workArea.width &&
    saved.x + saved.width > workArea.x &&
    saved.y < workArea.y + workArea.height &&
    saved.y + saved.height > workArea.y,
  );
  return visible ? saved : DEFAULT_SIZE;
}

export function trackWindowState(win: BrowserWindow) {
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    writeSettings({ maximized: win.isMaximized(), ...(win.isMaximized() ? {} : { bounds: win.getBounds() }) });
  };
  win.on("resized", save);
  win.on("moved", save);
  win.on("close", save);
}

export function roomWindowSize(): Size {
  return readSettings().roomSize ?? DEFAULT_ROOM_SIZE;
}

export function trackRoomWindowSize(win: BrowserWindow) {
  trackSize(win, "roomSize");
}

export function viewerWindowSize(): Size {
  return readSettings().viewerSize ?? DEFAULT_VIEWER_SIZE;
}

export function trackViewerWindowSize(win: BrowserWindow) {
  trackSize(win, "viewerSize");
}

/** 마지막으로 조절한 크기를 다음 창도 쓴다 */
function trackSize(win: BrowserWindow, key: "roomSize" | "viewerSize") {
  win.on("resized", () => {
    if (win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
    const [width, height] = win.getSize();
    writeSettings({ [key]: { width, height } });
  });
}

export function readPreferences(): Preferences {
  return { ...DEFAULT_PREFERENCES, ...readSettings().preferences };
}

/** 설정 창에서 받은 값 중 아는 키·형식만 저장한다 */
export function writePreferences(patch: Partial<Record<keyof Preferences, unknown>>): Preferences {
  const next = readPreferences();
  for (const key of ["notify", "preview", "sound", "closeToTray"] as const) {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  }
  if (typeof patch.zoom === "number" && ZOOM_LEVELS.includes(patch.zoom)) next.zoom = patch.zoom;
  writeSettings({ preferences: next });
  return next;
}
