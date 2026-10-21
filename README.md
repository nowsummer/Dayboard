# Dayboard

**Windows 바탕화면에 두고 쓰는 할 일·달력·메모 앱입니다.**
Microsoft To Do·Outlook 달력, Google Tasks·Google 캘린더, iCloud 달력을 한 화면에 모으고, 할 일·달력·메모를 바탕화면 위젯으로 띄워 둘 수 있습니다. 서버나 회원 가입이 없고, 데이터는 사용자의 PC에만 저장됩니다.

![Dayboard 할 일 화면](images/tasks-today.png)

## 설치

1. [최신 릴리스](https://github.com/nowsummer/Dayboard/releases/latest)에서 `Dayboard-<버전>.exe`를 내려받아 실행합니다.
2. 관리자 권한 없이 지금 쓰는 Windows 계정에 설치되고 바로 시작됩니다.
3. 새 버전은 Dayboard가 스스로 확인해 내려받아 두고, 설정의 「지금 다시 시작해 적용」(또는 알림 영역 메뉴)을 누를 때만 설치합니다.

- 서명되지 않은 새 설치 파일이라 Windows 스마트 앱 컨트롤이 실행을 막을 수 있습니다. 몇 분 뒤 다시 실행하면 열리는 경우가 많지만, 계속 막히는 PC도 있습니다.
- 버전별 변경 내용은 [릴리스](https://github.com/nowsummer/Dayboard/releases)에 있습니다. 앱 설정의 「업데이트 기록」도 이 페이지를 엽니다.

## 주요 기능

- **할 일**: 오늘·예정·전체·중요 모아보기, 목록별 색·아이콘·그룹, 드래그로 순서 정리, 알림 시각, "내일 치과"처럼 날짜를 넣어 바로 추가
- **달력**: 월 달력과 그날의 일정·할 일을 함께 보는 옆 패널, 반복 일정, 일정별 색
- **메모**: 짧은 기록을 최근 순으로 정리
- **바탕화면 위젯**: 할 일·달력·메모를 바탕화면에 두거나 항상 위에 표시, 유리 효과(투명~불투명) 조절
- **편의 기능**: 전체 검색(Ctrl+K), 새 항목 추가(Ctrl+N), 라이트·다크 테마, 한국어·영어, 오전·오후 또는 24시간 표시

## 연결할 수 있는 계정

- **Microsoft** (To Do·Outlook 달력): 할 일, 달력
- **Google** (Tasks·캘린더): 할 일, 달력
- **Apple iCloud**: 달력 (미리 알림은 지원하지 않음)
- **계정 없이**: 할 일, 달력, 메모를 이 PC에만 저장

연결한 할 일과 달력은 Dayboard에서 보고, 추가하고, 고치고, 지울 수 있으며 바꾼 내용은 각 서비스에도 반영됩니다. **메모는 어느 계정과도 동기화되지 않고 이 PC에만 저장됩니다.** 할 일에 적은 메모(설명)는 할 일과 함께 동기화됩니다.

- 달력에 일정을 적으려면 로그인할 때 달력 쓰기 권한에 동의해야 합니다. 공휴일 달력처럼 읽기만 허용된 달력에는 적을 수 없습니다.
- Google 로그인 중 「확인되지 않은 앱」 화면이 나오면 「고급」을 눌러 계속하세요. 개인이 만든 앱이라 Google 검증을 받지 않았습니다.
- iCloud는 Apple 계정에서 만든 앱 전용 암호로 연결합니다.

## 화면

### 할 일

![Dayboard 목록 화면](images/tasks-list.png)

### 달력

![Dayboard 달력 화면](images/calendar.png)

### 바탕화면 위젯

![할 일·달력·메모 위젯](images/widgets.png)

### 메모

![Dayboard 메모 화면](images/notes.png)

### 다크 테마

![Dayboard 다크 테마](images/tasks-today-dark.png)

> 화면의 할 일·일정·메모는 모두 예시 데이터입니다.

## 개인정보

- Dayboard는 서버를 운영하지 않습니다. 할 일·일정·메모는 PC의 `%APPDATA%\Dayboard` 폴더에 저장되고, 로그인 정보는 Windows 암호화로 보호합니다.
- 연결한 계정의 데이터는 각 서비스(Microsoft·Google·Apple)와 PC 사이에서만 오가며, 개발자나 제3자에게 보내지 않습니다. 업데이트는 GitHub에서 새 버전 정보와 설치 파일만 받아 옵니다.
- 앱을 제거해도 데이터 폴더와 업데이트 폴더는 남습니다. 남는 것과 지우는 방법은 [SECURITY.md](SECURITY.md)에 있습니다.
- 자세한 내용은 [개인정보처리방침](https://nowsummer.github.io/Dayboard/privacy.html)을, 앱이 접근하는 파일·주소와 알려진 위험은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 소스 코드

앱 소스 코드는 1.0.0부터 이 저장소에 MIT 라이선스로 공개합니다. 공개는 현재 코드부터이며, 이전 개발 이력은 포함하지 않습니다. 글꼴과 서비스 로고는 각자의 라이선스·상표를 따릅니다([알아 둘 점](#알아-둘-점)).

Windows x64에서 Git과 Node.js 22.12 이상으로 직접 빌드할 수 있습니다.

```powershell
git clone https://github.com/nowsummer/Dayboard.git
cd dayboard
npm ci
npm test           # 단위 테스트
npm start          # 소스로 실행
npm run package    # 앱 번들(앱\Dayboard-win32-x64)
npm run dist       # 서명 없는 설치 파일(dist\)
```

- **Google 연결**: 배포되는 설치 파일에는 배포자의 Google 로그인 클라이언트가 들어 있지만 이 저장소에는 없습니다. 직접 빌드한 앱에서 Google을 연결하면 자기 Google Cloud 프로젝트의 「데스크톱 앱」 OAuth 클라이언트 ID와 보안 비밀을 입력하는 화면이 나옵니다(앱 안 안내에 Tasks API·Calendar API 사용 설정 방법이 있음). 빌드에 넣으려면 `assets/google-oauth.example.json`을 `assets/google-oauth.json`으로 복사해 값을 채우세요. 이 파일은 `.gitignore`에 있어 커밋되지 않습니다.
- Microsoft·iCloud 연결은 배포본과 똑같이 동작합니다.
- 직접 빌드해 설치한 사본도 이 저장소의 새 릴리스를 내려받으며, 설치를 고르면 배포본으로 바뀝니다. 직접 빌드를 유지하려면 설정에서 「새 버전 자동 확인」을 끄세요.
- `npm run release`는 배포자 전용입니다(이 저장소에 릴리스를 올릴 권한이 필요함).

## 알아 둘 점

- Windows x64 전용입니다. iCloud 미리 알림은 지원하지 않습니다.
- Microsoft·Google·Apple과 관계없는 개인 프로젝트이며, 이들 회사가 보증하지 않습니다. 각 서비스의 정책이 바뀌면 연결이 멈출 수 있습니다.
- 제3자 구성 요소는 각자의 라이선스를 따릅니다: `docs/licenses/THIRD-PARTY.txt`, `renderer/fonts/OFL.txt`(Pretendard).
- 보안 문제는 공개 글 대신 [SECURITY.md](SECURITY.md)의 방법으로 알려 주세요. 비밀번호·로그인 토큰은 보내지 마세요.

## 이 저장소

Dayboard의 소스 코드, [소개 페이지](https://nowsummer.github.io/Dayboard/), [개인정보처리방침](https://nowsummer.github.io/Dayboard/privacy.html), 설치 파일과 업데이트 기록이 있는 [릴리스](https://github.com/nowsummer/Dayboard/releases)를 제공합니다.

---

<details>
<summary>English</summary>

**Dayboard** is a personal Windows desktop app for tasks, calendar and notes. It brings Microsoft To Do / Outlook calendar, Google Tasks / Google Calendar and iCloud calendar into one window, lets you add, edit and delete events in those calendars, and can pin tasks, calendar and notes to the desktop as widgets. iCloud Reminders are not supported, and notes stay on your PC: they are not synced with any account.

To install, download `Dayboard-<version>.exe` from the [latest release](https://github.com/nowsummer/Dayboard/releases/latest) and run it. It installs for the current Windows user without admin rights. New versions are downloaded in the background and installed only when you click "Restart now to update" in Settings (or the tray menu). Windows Smart App Control may block a new unsigned installer; it often runs after a few minutes, but some PCs keep blocking it.

There is no server and no sign-up: data stays in `%APPDATA%\Dayboard` on your PC, and sign-in tokens are protected by Windows encryption. See the [privacy policy](https://nowsummer.github.io/Dayboard/privacy.html) and [SECURITY.md](SECURITY.md). The screenshots use sample data.

**Source code.** The app source is in this repository under the MIT License, starting with 1.0.0 (current code only, without earlier development history). Build on Windows x64 with Git and Node.js 22.12 or later: `npm ci`, `npm test`, `npm start`, `npm run package`, `npm run dist`. Official installers include the publisher's Google sign-in client, which is not in this repository: a build of your own asks for your own Google Cloud "Desktop app" OAuth client when you connect Google, or you can copy `assets/google-oauth.example.json` to `assets/google-oauth.json` before building. A copy you build and install still offers the published releases; turn off "Check for new versions automatically" to stay on your own build. Fonts and service marks keep their own licenses (`docs/licenses/THIRD-PARTY.txt`). Dayboard is not affiliated with Microsoft, Google or Apple.

</details>
