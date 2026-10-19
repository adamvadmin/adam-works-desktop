import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";

type Size = { width: number; height: number };

type Settings = {
  bounds?: Rectangle;
  maximized?: boolean;
  /** 방 창 크기 (마지막으로 조절한 크기를 모든 방 창이 쓴다) */
  roomSize?: Size;
  /** 닫기 = 트레이로 숨김 안내를 이미 보여 줬는지 */
  trayHintShown?: boolean;
};

/** 메인 창은 목록만 보이므로 카카오톡 목록처럼 좁게 시작한다 */
const DEFAULT_SIZE: Size = { width: 400, height: 720 };
const DEFAULT_ROOM_SIZE: Size = { width: 440, height: 680 };

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
  win.on("resized", () => {
    if (win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
    const [width, height] = win.getSize();
    writeSettings({ roomSize: { width, height } });
  });
}
