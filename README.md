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
| 새 대화 (0.4.0+) | `/messenger/new` | 목록의 ＋. 조직도에서 대화 상대를 골라 1:1·그룹 방을 만들고 그 방 창을 연 뒤 닫힌다. 하나만 |
| 방 정보·초대 (0.4.0+) | `/messenger/info/{roomId}`·`/messenger/invite/{roomId}` | 방 머리글 ⓘ → 정보(이름·알림·고정·참여자·나가기), 초대하기 → 초대 창. 종류마다 하나 |
| 미리보기 (0.4.0+) | `/messenger/viewer?room=&id=&name=…` | 첨부 미리보기(이미지·PDF·텍스트·오피스·동영상). 하나만 두고 다른 첨부를 열면 내용을 바꾼다. 실시간 연결 없음. 창 제목 = 파일명 |

- 방 창을 보고 있으면(포커스) 그 방 알림은 띄우지 않고, 보이기만 하면 그 창을 깜빡인다.
- 방 창 크기는 마지막으로 조절한 크기를 다음 방 창도 쓴다. 새 방 창은 메인 창 옆·이전 방 창 대각선 아래에 연다.
- 창마다 서버와 실시간 연결이 하나씩 생긴다 (사용자 20명 규모에서 문제없음).
- 0.1.0 설치본은 `openRoomWindow`가 없어 웹이 예전처럼 한 창 2단으로 보여 준다 (자동 업데이트 후 0.2.0 방식).

## 데스크톱 앱다운 화면 (0.4.0+)

웹 페이지를 띄운 티가 나지 않게 한다.

- **제목 표시줄 없는 창** (`titleBarStyle: "hidden"`): 상단바(로고·설정·항상 위·최소화·최대화·닫기)는 웹 `DesktopTitleBar`가 그린다. 창 테두리·그림자·Windows 11 둥근 모서리·크기 조절·스냅은 그대로다. 상단바와 대화 머리글 빈 곳을 끌어 창을 옮긴다.
- **시작 화면** (`pages/splash.html`): 목록 창은 웹이 `appReady()`를 보낼 때(목록을 받은 뒤·로그인 화면) 띄운다. 신호가 없으면 8초 뒤(방 창 2.5초) 띄운다 — 이전 웹 호환.
- **웹 동작 정리** (웹 `html.gw-desktop`): 입력창·메시지 본문만 글자 선택, 이미지·링크 끌기 막기, 기본 화살표 커서, 얇은 스크롤바, 시스템 글꼴(Segoe UI·맑은 고딕). Ctrl+휠·손가락 확대는 막고 글자 크기는 설정에서 바꾼다.
- **단축키**: Esc(방 창 닫기 — 모달·검색·답장·멘션이 열려 있으면 그쪽 먼저), Ctrl+W(창 닫기), Ctrl+N(새 대화), Ctrl+Tab·Ctrl+Shift+Tab(목록·방 창 옮겨 다니기), Ctrl+F(목록 검색·대화 검색). 한글 입력 상태에서도 자판 위치(code)로 판단.
- **설정 창** (`pages/settings.html`, 상단바·트레이 메뉴 "설정"): 자동 실행, 목록 창 닫기 동작(트레이로 숨기기/종료), 알림 표시·미리보기·소리, 글자 크기(90·100·110·125%), 버전·업데이트 확인. 트레이 메뉴에 "알림 끄기"도 있다.
- **연결 대기 화면** (`pages/offline.html`): 서버에 닿지 않으면 띄우고 5초마다 다시 연결한다.
- **설치 마법사**: 시작(그림·안내) → 설치 → 마침(바로 실행). 한국어, 설치 범위는 현재 사용자로 고정(`build/installer.nsh`). 자동 업데이트는 화면 없이 조용히 설치된다.

**배포 순서**: 웹(`DesktopTitleBar`)을 먼저 배포한 뒤 0.4.0 태그를 올린다. 0.4.0이 이전 웹을 띄우면 상단바가 없어 창을 옮기거나 닫을 수 없다. 반대로 0.3.x 설치본은 `windowControls`가 없어 웹이 상단바를 그리지 않으므로 그대로 쓸 수 있다.

## 구성

| 파일 | 역할 |
|---|---|
| `src/main.ts` | 창(목록·방·시작·설정), 트레이 상주, 중복 실행 방지, 알림·배지·깜빡임·창 버튼 IPC, 단축키, 자리비움 감지, 자동 업데이트 |
| `src/preload.ts` | 웹·로컬 화면에 `window.desktop` 노출 (웹 타입: `adam-works-fe/src/lib/chat/desktop.ts`) |
| `src/config.ts` | 불러올 주소·IPC 채널·주기 |
| `src/window-state.ts` | 창 위치·크기·항상 위, 설정값 저장 (`userData/settings.json`) |
| `pages/` | 앱 안 로컬 화면 (시작·연결 대기·설정) |
| `build/installer.nsh` | 설치 마법사 추가 설정 (UTF-8 BOM) |
| `scripts/make-icons.mjs` | 아이콘 PNG·설치 화면 BMP 생성 (`build/icons`·`build/installer`, 커밋하지 않음) |

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
| `appReady()` | 화면이 그려졌음을 알림 → 창을 띄운다 — 0.4.0+ |
| `openSettings()` | 설정 창 열기 — 0.4.0+ |
| `openNewRoomWindow()` | 새 대화 창 열기 — 0.4.0+. 없으면 웹이 목록 위에 모달로 띄운다 |
| `openRoomInfoWindow(roomId)`·`openInviteWindow(roomId)` | 방 정보·초대 창 — 0.4.0+. 없으면 웹이 모달로 띄운다 |
| `openViewerWindow(target)` | 첨부 미리보기 창 열기 (첨부 정보를 창 주소 쿼리로) — 0.4.0+. 없으면 웹이 대화 화면 위에 띄운다 |
| `windowControls` | `minimize`·`toggleMaximize`·`close`·`setPinned`·`getState`·`onStateChange` (웹 상단바용) — 0.4.0+ |
| `settings` | 설정 창 전용 (`get`·`set`·`checkUpdate`·`installUpdate`). 다른 화면에서 부르면 무시 |

### 보안

- `contextIsolation`, `sandbox`, `nodeIntegration: false`. 웹에는 위 API만 노출한다.
- 메신저 출처 밖으로의 이동·새 창은 기본 브라우저로 연다.
- IPC는 메인 창·메신저 출처에서 온 것만 받는다. 창 버튼은 우리 창의 메신저 출처·로컬 화면에서, 설정 API는 설정 창에서만 받는다.
- 웹 화면 권한은 알림·클립보드 쓰기·전체 화면만 허용하고 카메라·마이크·위치 등은 거부한다 (Electron은 기본으로 모두 허용).
- 허용 출처 밖으로의 이동·서버 리디렉션은 막고 기본 브라우저로 연다. 로컬 화면(`pages/`)은 `loadFile`로만 연다.
- Electron fuses (`electron-builder.yml`): `ELECTRON_RUN_AS_NODE`·`NODE_OPTIONS`·`--inspect` 차단, app.asar 무결성 검사·asar에서만 로드, 쿠키 암호화. `grantFileProtocolExtraPrivileges`는 로컬 화면(file://) 때문에 켜 둔다. 그래서 Playwright `_electron`(디버그 인자 사용)으로는 설치본을 띄울 수 없고, `--remote-debugging-port`로 붙는다.
- GitHub Actions는 커밋 해시로 고정한다.
- 서명하지 않으므로 업데이트는 "GitHub 릴리스가 진짜인지"에 기댄다. 계정 2단계 인증, 불변 릴리스(immutable releases), `v*` 태그 보호 규칙을 켜 둔다 (저장소 설정).
- 브리지 함수에는 복제 가능한 값만 넘긴다 (React 클릭 이벤트를 그대로 넘기면 "An object could not be cloned"로 실패).
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
3. GitHub Actions(`release.yml`)가 초안(draft) 릴리스를 먼저 만들고, NSIS 설치 파일·`latest.yml`·`.blockmap`을 올린 뒤 파일을 확인하고 공개한다. 저장소가 **불변 릴리스**라 공개된 릴리스에는 파일을 더할 수 없고 태그도 잠기므로, 실패한 버전은 다시 쓰지 말고 버전을 올린다 (0.4.0이 그렇게 비어 있다)
4. 설치된 프로그램은 시작 시·1시간마다 Releases를 확인해 새 버전을 내려받는다 (0.2.1+, 0.1.0·0.2.0은 6시간)
5. 내려받기가 끝나면 Windows 알림("누르면 다시 시작해 적용")과 트레이 메뉴 "업데이트 적용하고 다시 시작"이 나온다. 그냥 두면 트레이에서 **종료**할 때 설치된다 (창 닫기는 트레이로 숨김이라 종료가 아니다)

### 개발 실행 주의

`npm start`·`start:local`로 띄운 개발용 Electron이 Windows 알림을 띄우면 알림 센터·시작 메뉴(`Electron.lnk`)에 흔적이 남는다. `ADAM_WORKS_URL`을 주면 앱 ID를 `…messenger.dev`로 나눠 설치본과 섞이지 않는다 (같은 앱 ID면 작업표시줄 아이콘이 Electron 아이콘으로 보이고, 남은 알림을 누르면 Electron 기본 화면이 켜진다).

로컬에서 설치 파일만 만들려면 `npm run dist` → `release/VWORKS-Messenger-Setup-<버전>.exe`

### 코드 서명

서명하지 않는다 (2026-10-22 결정: Store·유료 인증서 대신 안내로). 첫 설치 때 Windows SmartScreen 경고("Windows의 PC 보호")가 뜨면 **추가 정보 → 실행**을 누른다. 자동 업데이트는 프로그램이 직접 받아 설치하므로 경고가 다시 뜨지 않는다. 설치 링크는 사내 공지로만 배포한다 (가짜 설치 파일에 같은 버튼을 누르는 습관 방지).
