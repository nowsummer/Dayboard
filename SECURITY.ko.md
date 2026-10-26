[English](SECURITY.md) · **한국어**

# 보안

Dayboard는 한 사람이 만드는 개인 프로젝트입니다. 보안 문제를 비공개로 알리는 방법, 앱이 PC에서 접근하는 것, 배포·업데이트 방식의 위험을 정리했습니다.

## 취약점 알리기

보안 문제는 공개 글로 올리지 마세요.

- 이 저장소의 **Security** 탭 → **Report a vulnerability**(GitHub 비공개 취약점 신고)를 이용해 주세요.
- 앱 버전(설정 맨 위), 발견한 내용, 재현 방법, 예상되는 영향을 적어 주세요.
- 비밀번호·토큰·앱 전용 암호·`cloud-credentials.bin`(과 그 `.corrupt-*` 사본)은 절대 보내지 마세요.
- 로그와 화면 캡처에서 계정 주소와 Windows 사용자 경로를 지워 주세요.

응답 시간은 보장하지 않습니다. 수정은 새 릴리스로 나가며 최신 릴리스만 지원합니다.

## 앱이 접근하는 것

### 파일

자기 폴더 `%APPDATA%\Dayboard`:

- `dayboard.json`: 할 일·일정·메모·목록·달력, 연결한 계정의 이름(대개 메일 주소), 설정, 위젯 위치.
  - 사본: 직전 저장본 `dayboard.previous.json`, 깨진 파일을 발견하면 남기는 `dayboard.recovery-*.json`.
  - **암호화하지 않은 JSON**입니다. 같은 Windows 계정으로 실행되는 프로그램과 관리자가 읽을 수 있습니다.
- `cloud-credentials.bin`: 연결한 계정의 로그인 토큰과 iCloud 앱 전용 암호.
  - Electron `safeStorage`(Windows 데이터 보호 API)로 암호화합니다. 그 키는 같은 폴더의 `Local State`에 보호해 둡니다.
  - 이 암호화는 **다른 Windows 계정과 다른 PC로 복사한 파일**만 막습니다. 같은 Windows 계정으로 실행되는 프로그램은 풀 수 있습니다.
  - 암호화를 쓸 수 없는 환경에서는 저장하지도 읽지도 않습니다. 읽을 수 없는 파일은 `cloud-credentials.bin.corrupt-*`로 이름을 바꿔 둡니다.
- 그 밖: `icons\`(시작 메뉴 바로 가기 아이콘), `update-alerts.json`(새 버전 알림 기록), Electron(Chromium)이 만드는 일반 프로필 파일.
- 0.2.0 설치형에는 업데이트 엔진이 만든 설치별 임의 ID `.updaterId`가 있습니다. 1.0.0부터는 만들지 않고 지웁니다.

폴더 밖:

- **바탕화면 그림**: 위젯 뒤 배경을 직접 그리려고 현재 바탕화면 그림 파일과 `%APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper`를 **읽기만** 합니다.
- **「데이터 백업」**: 사용자가 고른 위치에 JSON 파일 하나를 씁니다. 할 일·일정·메모·계정 이름이 들어가고 로그인 정보는 들어가지 않습니다.

### 네트워크

- **Microsoft**: `login.microsoftonline.com`(로그인), `graph.microsoft.com`(To Do·Outlook 달력).
  - 권한: `User.Read`, `Tasks.ReadWrite`, `Calendars.ReadWrite`, `offline_access`.
- **Google**: `accounts.google.com`, `oauth2.googleapis.com`, `openidconnect.googleapis.com`(로그인), `tasks.googleapis.com`, `www.googleapis.com`(Tasks·캘린더·드라이브).
  - 권한: `openid`, `email`, `profile`, `tasks`, `calendar.readonly`, `calendar.events`, `drive.appdata`.
- **Apple**: `caldav.icloud.com`과 Apple이 알려 주는 `icloud.com` 하위 서버(HTTPS만, iCloud 달력, CalDAV).
- **GitHub**: `github.com`과 GitHub 다운로드 서버(새 버전 확인과 설치 파일 내려받기).
  - 확인 요청에는 업데이트 단계 ID만 붙고, 이 값은 모든 설치본에서 같습니다(0.2.0은 설치마다 다른 임의 ID를 보냈음).
- **로그인하는 동안만, 이 PC 안**: `127.0.0.1`의 임의 포트에서 최대 3분 동안 브라우저의 로그인 응답을 기다립니다.
  - PKCE와 state를 확인하며, 다른 PC에서는 접속할 수 없습니다. Microsoft에는 주소를 `http://localhost`로 알립니다.
- 분석·원격 측정·오류 보고는 없습니다. 개발자가 운영하는 서버도 없습니다.

### 메모 동기화 (Google 드라이브)

- Google 계정의 「메모」 스위치가 켜졌을 때만 동작합니다. 처음 연결한 Google 계정 하나에서 저절로 켜지고, 계정 관리에서 고르거나 끌 수 있습니다.
- 메모를 그 계정의 Google 드라이브 **앱 데이터 폴더**에 JSON 파일로 둡니다.
- 메모마다 최신본 하나를 둡니다. 여기에 그 메모의 이전 버전 최대 10개와 「최근 삭제한 메모」 여부가 들어갑니다. 두 PC에서 같은 메모를 동시에 고치는 동안에만 둘이 됩니다.
- 지운 메모는 내용 없는 삭제 표시로 90일 남습니다.
- 이 폴더는 드라이브 화면과 다른 앱에서 보이지 않습니다. `drive.appdata` 권한은 이 폴더 밖의 드라이브 파일에 닿지 않습니다.
- 같은 Google 계정으로 로그인한 내 다른 PC의 Dayboard만 읽습니다.

### Windows

- **시스템 함수**: 위젯을 바탕화면에 붙이고 키보드 입력을 넘겨주려고 koffi로 `user32`·`gdi32`·`kernel32`·`ole32`·`advapi32`의 함수를 부릅니다.
  - 예: `SetParent`, `SetWindowPos`, `SetWindowRgn`, `SetFocus`, 바탕화면 그림을 읽는 `IDesktopWallpaper`, `RegGetValueW`로 `HKCU\Control Panel\Desktop`·`Colors` 읽기.
  - 이 호출로 레지스트리에 쓰지는 않습니다.
- **시작 메뉴**: 설치된 사본과 휴대용 번들은 시작할 때마다 바로 가기 `Dayboard.lnk`를 고쳐 씁니다(Windows 알림에 필요).
- **「Windows 시작 시 실행」**: 켜면 로그인 시작 항목(`HKCU\...\Run`)을 만들고, 시작할 때마다 지금 실행 중인 사본으로 맞춥니다. 작업 관리자에서 끈 경우는 그대로 둡니다.
- **알림**: 할 일 알림은 Windows 알림으로 뜹니다. Windows가 알림 기록에 그 내용(할 일 제목 등)을 남길 수 있습니다.
- **설치 프로그램**
  - 관리자 권한 없이 `%LOCALAPPDATA%\Programs\dayboard-desktop`에 설치하고, 제거 정보를 `HKCU`에 둡니다.
  - 직접 실행한 설치·제거는 이 Windows 세션에서 실행 중인 Dayboard에 먼저 평소처럼 종료하라고 요청하고(저장하지 않은 변경은 Dayboard가 물어봄) 최대 20초 기다립니다.
  - 그래도 실행 중이면 알림 영역에서 종료하도록 안내하고, 「무시」를 고를 때만 강제로 끝냅니다.
  - 자동 업데이트는 Dayboard가 저장을 마친 뒤 설치 프로그램을 실행하므로, 남은 프로세스를 닫고(필요하면 강제로) 설치합니다.
  - 같은 버전이나 더 낮은 버전의 설치 파일을 열면 설치하지 않고 설치된 앱만 엽니다.
- **업데이트 파일**
  - `%LOCALAPPDATA%\dayboard-desktop-updater`에 설치 파일을 내려받습니다. 부분 내려받기에 쓰려고 설치 프로그램도 여기에 자기 사본을 둡니다.
  - 적용을 누르면 그 설치 파일을 실행합니다.
  - 0.2.0은 `%LOCALAPPDATA%\dayboard-updater`를 썼고, 1.0.0부터는 시작 1분 뒤 그 폴더를 지웁니다.
- **제거해도 남는 것**: `%APPDATA%\Dayboard`, `%LOCALAPPDATA%\dayboard-desktop-updater`, 「Windows 시작 시 실행」을 켰다면 그 시작 항목.
  - 모두 지우려면 제거 전에 「Windows 시작 시 실행」을 끄고, 제거 뒤 두 폴더를 지우세요.

## 알려진 위험

### Microsoft 로그인

- 별도 앱 등록 없이 로그인하려고 Microsoft가 공개한 「Microsoft Graph Command Line Tools」 클라이언트 ID를 씁니다.
- 로그인 화면과 계정의 앱 권한 목록에는 Dayboard 대신 그 이름이 보입니다.
- 같은 클라이언트를 쓰는 다른 도구(Microsoft Graph PowerShell 등)도 이 동의를 함께 씁니다.
- 회사·학교 계정은 관리자가 이 클라이언트를 막을 수 있고, Microsoft 정책이 바뀌면 동작이 멈출 수 있습니다.
- 그때는 연결 화면의 「직접 등록한 앱 사용」에 자기 앱 등록의 클라이언트 ID를 넣을 수 있습니다.

### Google 로그인

- 배포되는 설치 파일에는 배포자의 Google OAuth 데스크톱 클라이언트(ID와 보안 비밀)가 들어 있습니다.
- Google은 설치형 앱의 보안 비밀을 기밀로 보지 않지만, 이 저장소에는 넣지 않았습니다.
- 소스로 직접 빌드하면 Google을 연결할 때 자기 클라이언트 ID를 입력해야 합니다([README](README.ko.md) 참고).
- 앱이 Google 검증을 받지 않아 로그인 중 「확인되지 않은 앱」 화면이 나오고, Google이 새로 로그인하는 사용자 수를 100명까지로 제한합니다.

### iCloud

- Apple 계정 암호가 아니라 앱 전용 암호를 받습니다.
- 앱 전용 암호는 달력 외의 iCloud 데이터에도 쓰일 수 있습니다.

### 로컬 데이터

- 로그인 정보 말고는 암호화하지 않습니다.
- 같은 Windows 계정으로 실행되는 프로그램은 로그인 정보도 풀 수 있습니다.
- 악성 프로그램이나 PC를 같은 계정으로 함께 쓰는 사람은 할 일·일정·메모를 읽을 수 있습니다. 암호화하지 않은 PC 백업에도 그대로 남습니다.

### 연결 해제와 권한 회수

「연결 해제」는 이 PC의 로그인 정보만 지우고, 받아 둔 목록·일정은 「보관본」으로 남깁니다. 서비스 쪽 접근 권한까지 거두려면:

- **Google**: Google 계정 → 보안 → 타사 앱 및 서비스(`myaccount.google.com/connections`)에서 Dayboard를 삭제합니다.
- **Google 드라이브의 메모 파일**: 연결 해제만으로는 지워지지 않습니다.
  1. 먼저 모든 PC의 Dayboard에서 그 계정의 「메모」를 끄거나 연결을 해제합니다(켜 둔 PC는 메모를 다시 올림).
  2. Google 드라이브 웹 → 설정 → 앱 관리 → Dayboard의 「옵션」 → 「숨겨진 앱 데이터 삭제」를 누릅니다.
- **Microsoft 개인 계정**: `account.live.com/consent/Manage`에서 「Microsoft Graph Command Line Tools」를 제거합니다. 같은 클라이언트를 쓰는 다른 도구의 동의도 함께 없어집니다.
- **Microsoft 회사·학교 계정**: 조직의 My Apps에서 정리하거나 관리자에게 요청합니다.
- **iCloud**: Apple 계정 → 로그인 및 보안 → 앱 암호에서 Dayboard용 암호를 폐기합니다.

## 업데이트와 그 위험

1. 설치된 사본은 시작 약 90초 뒤와 6시간마다 GitHub의 최신 릴리스를 확인합니다.
2. 새 버전은 쓰는 동안 `%LOCALAPPDATA%\dayboard-desktop-updater`에 미리 내려받아 둡니다.
3. 설정의 「지금 다시 시작해 적용」이나 알림 영역 메뉴의 「Dayboard <버전> 업데이트 설치 후 다시 시작」을 누를 때만 설치합니다. 시작·종료·타이머로 저절로 설치하지 않습니다.

- 설정의 「새 버전 자동 확인」을 끄면 자동 확인과 내려받기를 멈춥니다.
- `npm start`로 실행한 소스와 `npm run package`로 만든 휴대용 번들(`앱\Dayboard-win32-x64`, 설치하지 않고 실행하는 사본)은 스스로 바뀌지 않습니다. 새 버전 알림과 릴리스 페이지만 보여 줍니다.

**위험**

- 내려받은 파일은 같은 GitHub 릴리스의 `latest.yml`에 적힌 SHA-512로만 확인하며, 설치 파일에는 코드 서명이 없습니다.
- 배포자의 GitHub 계정이나 빌드 PC가 뚫리면 악성 릴리스도 이 확인을 통과합니다.
- 누를 때까지 설치하지 않으니 변경 내용을 읽고 미룰 수는 있습니다. 그렇다고 릴리스가 진짜라는 보장은 아닙니다.

## 서명 없는 설치 파일

- 설치 파일에 코드 서명 인증서가 없어 Windows SmartScreen이나 스마트 앱 컨트롤이 경고하거나 막을 수 있습니다.
- 같은 소스로 빌드해도 바이트까지 똑같은 파일이 나오지 않아, 내려받은 설치 파일을 직접 빌드한 것과 비교할 수 없습니다.

할 수 있는 것:

- **해시 비교**: [릴리스 페이지](https://github.com/nowsummer/Dayboard/releases)의 각 파일 옆 `sha256:` 값과 PowerShell의 `Get-FileHash .\Dayboard-<버전>.exe -Algorithm SHA256` 결과를 비교하세요.
  - 같으면 릴리스 페이지의 그 파일이라는 뜻이지, 이 소스로 빌드됐다는 증명은 아닙니다.
- **설치된 코드 비교**: 설치된 앱의 코드(`%LOCALAPPDATA%\Programs\dayboard-desktop\resources\app`)는 하나로 묶지 않은 일반 파일이라 이 저장소의 같은 버전 코드와 비교할 수 있습니다(설치 파일 안에서는 7z로 압축돼 있음).
  - `package.json`: scripts·devDependencies가 빠져 있습니다.
  - 더해진 것: `node_modules`, 배포자 Google 클라이언트 `assets\google-oauth.json`.
  - 빠진 개발용 파일: `scripts`, `build`, `docs`, 대부분의 `tests`, `renderer\preview.js`, `assets\*.svg`, `assets\google-oauth.example.json`.
- **직접 빌드**: 소스를 읽고 직접 빌드하세요([README](README.ko.md) 참고).
  - 직접 빌드해 설치한 사본도 이 저장소의 새 릴리스를 내려받으며, 설치를 고르면 배포본으로 바뀝니다.
  - 직접 빌드를 유지하려면 설정에서 「새 버전 자동 확인」을 끄세요.
