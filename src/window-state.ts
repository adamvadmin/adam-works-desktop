import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";

type Settings = {
  bounds?: Rectangle;
  maximized?: boolean;
  /** 닫기 = 트레이로 숨김 안내를 이미 보여 줬는지 */
  trayHintShown?: boolean;
};

const DEFAULT_SIZE = { width: 1100, height: 760 };

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
export function initialBounds(): Partial<Rectangle> & { width: number; height: number } {
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
