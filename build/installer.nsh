; electron-builder NSIS 설치 화면 추가 설정 (build/installer.nsh 는 자동으로 포함된다)
; 한글 문구가 있어 UTF-8 BOM으로 저장한다

; 설치 범위 선택 페이지(모든 사용자/현재 사용자)를 건너뛰고 항상 현재 사용자에 설치한다.
; 자동 업데이트가 관리자 권한 없이 같은 위치에 덮어쓰려면 사용자별 설치여야 한다.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; 시작 페이지 (업데이트로 실행될 때는 건너뛴다)
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "V WORKS 메신저 설치"
  !define MUI_WELCOMEPAGE_TEXT "사내 메신저 V WORKS 메신저를 이 PC에 설치합니다.$\r$\n$\r$\n설치가 끝나면 바로 실행되며, 새 버전은 자동으로 업데이트됩니다.$\r$\n$\r$\n계속하려면 [다음]을 누르세요."
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend
