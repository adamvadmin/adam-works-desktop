# V WORKS 메신저 (adam-works-desktop)

채팅 전용 Windows PC 프로그램. Electron 창에서 `https://works.adamv.kr/messenger`를 불러온다.
화면은 웹(`adam-works-fe`)에 있으므로 **화면 수정은 웹 배포만으로 반영**되고, 이 레포는 창·알림·트레이·업데이트만 담당한다.

설계: `adam-works-be/docs/chat/chat-design.md` §7

## 창 구성 (0.2.0+)

카카오톡처럼 **목록 창과 방 창을 나눈다.** 여러 방을 동시에 띄울 수 있다.

| 창 | 주소 | 동작 |
|---|---|---|
| 메인(목록) | `/messenger` | 대화 목록만. 닫으면 트레이로 숨김. 알림·배지를 맡는다 |
| 방 | `/messenger/rooms/{roomId}` | 방 하나. 목록에서 방을 누르거나 알림을 누르면 열린다. 이미 열려 있으면 앞으로. 닫으면 없어진다 |

- 방 창을 보고 있으면(포커스) 그 방 알림은 띄우지 않고, 보이기만 하면 그 창을 깜빡인다.
- 방 창 크기는 마지막으로 조절한 크기를 다음 방 창도 쓴다. 새 방 창은 메인 창 옆·이전 방 창 대각선 아래에 연다.
- 창마다 서버와 실시간 연결이 하나씩 생긴다 (사용자 20명 규모에서 문제없음).
- 0.1.0 설치본은 `openRoomWindow`가 없어 웹이 예전처럼 한 창 2단으로 보여 준다 (자동 업데이트 후 0.2.0 방식).

## 구성

| 파일 | 역할 |
|---|---|
| `src/main.ts` | 창, 트레이 상주, 중복 실행 방지, 알림·배지·깜빡임 IPC, 자리비움 감지, 자동 업데이트 |
| `src/preload.ts` | 웹에 `window.desktop` 노출 (웹 타입: `adam-works-fe/src/lib/chat/desktop.ts`) |
| `src/config.ts` | 불러올 주소·IPC 채널·주기 |
| `src/window-state.ts` | 창 위치·크기 기억 |
| `scripts/make-icons.mjs` | 아이콘 PNG 생성 (`build/icons`, 커밋하지 않음) |

### window.desktop

| API | 동작 |
|---|---|
| `notify({title, body, roomId})` | Windows 알림 (메인 창만 요청). 클릭하면 방 창을 연다 |
| `openRoomWindow(roomId)` | 방 창 열기 (이미 열려 있으면 앞으로) — 0.2.0+ |
| `setBadge(count)` | 작업표시줄 오버레이(빨간 점)·트레이 아이콘·툴팁 |
| `flashFrame()` | 창이 포커스가 아닐 때 작업표시줄 깜빡임 |
| `getVersion()` | 앱 버전 |
| `onIdleChange(cb)` | 입력 없음 10분·화면 잠금·절전 → `true` (자리비움) |
| `onOpenRoom(cb)` | 알림 클릭 시 방 ID — 0.1.0 호환용 (0.2.0은 방 창을 직접 연다) |

### 보안

- `contextIsolation`, `sandbox`, `nodeIntegration: false`. 웹에는 위 API만 노출한다.
- 메신저 출처 밖으로의 이동·새 창은 기본 브라우저로 연다.
- IPC는 메인 창·메신저 출처에서 온 것만 받는다.
- User-Agent의 제품명(한글)은 ASCII(`VWorksMessenger/버전`)로 바꾼다. 서버 방화벽이 ASCII가 아닌 헤더를 거부해 WebSocket 연결이 403이 되기 때문.

## 개발

```bash
npm install
npm start          # 운영 주소(works.adamv.kr/messenger)로 실행
npm run start:local  # 로컬 웹(localhost:3000/messenger)으로 실행 — adam-works-fe·be를 먼저 띄운다
```

다른 주소로 띄우려면 `ADAM_WORKS_URL` 환경변수를 준다. 이때는 사용자 데이터 폴더를 `…-dev`로 따로 써서, 설치본이 실행 중이어도 동시에 띄울 수 있다.

## 배포

1. `package.json`의 `version`을 올리고 커밋
2. 같은 버전으로 태그 push: `git tag v0.1.1 && git push origin v0.1.1`
3. GitHub Actions(`release.yml`)가 NSIS 설치 파일을 만들어 Releases에 올린다
4. 설치된 프로그램은 시작 시·6시간마다 Releases를 확인해 자동 업데이트한다

로컬에서 설치 파일만 만들려면 `npm run dist` → `release/VWORKS-Messenger-Setup-<버전>.exe`

### 코드 서명

아직 서명하지 않는다 (미결 사항). 첫 설치 때 Windows SmartScreen 경고("Windows의 PC 보호")가 뜨면 **추가 정보 → 실행**을 누른다.
