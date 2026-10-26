; Dayboard installer additions (electron-builder `nsis.include`), ported from Limit Tracker build/installer.nsh (2026-10-20).
;
; - Opening the installer on a PC that already has this version or a newer one just opens the installed program.
; - The installer carries the program's name (Dayboard.exe is also the portable launcher and the portable bundle),
;   so customCheckAppRunning closes every Dayboard.exe in this Windows session except this installer.
; - Uninstalling removes the Start menu shortcut Dayboard writes for Windows notifications (lib/startmenu.cjs);
;   a portable Dayboard that still runs writes it again at its next start. User data (%APPDATA%\Dayboard) is kept.
; Automatic updates (the app starts the installer with /S --updated --force-run) keep the normal path.
; - A manual install or uninstall asks a running Dayboard to quit the normal way first (DB_ASK_QUIT): it saves note drafts
;   and open event cards and asks about anything it cannot save. It is closed by force only when the user chooses Ignore
;   (Codex review 2026-10-26: Stop-Process without -Force is still a kill, so a repeating event's unsaved card was lost).
!include WordFunc.nsh

!macro customInit
  ${ifNot} ${Silent}
  ${andIfNot} ${isUpdated}
    ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${if} $R0 != ""
    ${andIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ; 0 = same version, 1 = installed is newer, 2 = this file is newer.
      ${VersionCompare} "$R0" "${VERSION}" $R1
      ${if} $R1 != 2
        ; Start in the install folder, not in the folder this file was opened
        ; from (which the program would otherwise keep locked while it runs).
        SetOutPath "$INSTDIR"
        Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
        Quit
      ${endIf}
    ${endIf}
  ${endIf}
!macroend

; $R0 = 0 when another process named like the program runs in this session.
!macro DB_FIND_APP
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "$$s = (Get-Process -Id $$PID).SessionId; if (@(Get-CimInstance -ClassName Win32_Process | ? { $$_.Name -eq '${APP_EXECUTABLE_FILENAME}' -and $$_.ProcessId -ne $R2 -and $$_.SessionId -eq $$s }).Count -gt 0) { exit 0 } else { exit 1 }"`
  ${else}
    nsExec::Exec `"$CmdPath" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FI "PID ne $R2" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  ${endIf}
  Pop $R0
!macroend

; Stops those processes; FORCE = 1 skips the polite close.
!macro DB_STOP_APP FORCE
  ${if} $IsPowerShellAvailable == 0
    ${if} ${FORCE} == 1
      nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "$$s = (Get-Process -Id $$PID).SessionId; Get-CimInstance -ClassName Win32_Process | ? { $$_.Name -eq '${APP_EXECUTABLE_FILENAME}' -and $$_.ProcessId -ne $R2 -and $$_.SessionId -eq $$s } | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    ${else}
      nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "$$s = (Get-Process -Id $$PID).SessionId; Get-CimInstance -ClassName Win32_Process | ? { $$_.Name -eq '${APP_EXECUTABLE_FILENAME}' -and $$_.ProcessId -ne $R2 -and $$_.SessionId -eq $$s } | % { Stop-Process -Id $$_.ProcessId -ErrorAction SilentlyContinue }"`
    ${endIf}
  ${else}
    ${if} ${FORCE} == 1
      nsExec::Exec `"$CmdPath" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $R2" /FI "USERNAME eq %USERNAME%"`
    ${else}
      nsExec::Exec `"$CmdPath" /C taskkill /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $R2" /FI "USERNAME eq %USERNAME%"`
    ${endIf}
  ${endIf}
  Pop $R3
!macroend

; Starts the running Dayboard's own exe again with --quit-for-install; the single-instance lock hands that to the running
; copy, which quits through its usual saving path (main.cjs), and waits up to 20 s for every Dayboard process to end, in one
; PowerShell (2026-10-26 review: polling once per PowerShell start made the "20 s" wait about 47 s). Electron's helper
; processes carry --type= and are skipped. An older Dayboard ignores the request; the question below then says what to do.
!macro DB_ASK_QUIT
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "$$s = (Get-Process -Id $$PID).SessionId; $$all = @(Get-CimInstance -ClassName Win32_Process | ? { $$_.Name -eq '${APP_EXECUTABLE_FILENAME}' -and $$_.ProcessId -ne $R2 -and $$_.SessionId -eq $$s }); $$p = $$all | ? { $$_.ExecutablePath -and $$_.CommandLine -notmatch '--type=' } | Select-Object -First 1; if ($$p) { Start-Process -FilePath $$p.ExecutablePath -ArgumentList '--quit-for-install'; Wait-Process -Id ($$all | % { $$_.ProcessId }) -Timeout 20 -ErrorAction SilentlyContinue }"`
    Pop $R3
  ${endIf}
!macroend

!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    ; When the installer runs the old version's uninstaller (always --updated),
    ; it has already closed the program. Checking again here could stop the
    ; installer itself, which also carries the program's name.
    ${if} ${isUpdated}
      Goto db_check_done
    ${endIf}
  !endif
  !insertmacro IS_POWERSHELL_AVAILABLE
  ; This process's own id, so the check never stops itself.
  System::Call 'kernel32::GetCurrentProcessId() i .R2'
  ${if} ${isUpdated}
    ; The program is already quitting to apply the update: it saved everything before it started this installer.
    Sleep 1000
    StrCpy $R1 0
    db_check_app:
      IntOp $R1 $R1 + 1
      !insertmacro DB_FIND_APP
      ${if} $R0 == 0
        DetailPrint "$(appClosing)"
        !insertmacro DB_STOP_APP 0
        Sleep 1500
        !insertmacro DB_FIND_APP
        ${if} $R0 == 0
          !insertmacro DB_STOP_APP 1
          Sleep 1000
          !insertmacro DB_FIND_APP
        ${endIf}
        ${if} $R0 == 0
          ${if} $R1 > 2
            MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY db_check_app
            Quit
          ${endIf}
          Goto db_check_app
        ${endIf}
      ${endIf}
  ${else}
    ; A manual install or uninstall: ask it to quit (waiting up to 20 s), then let the user decide. Ignore closes it by force.
    db_ask_app:
      !insertmacro DB_FIND_APP
      ${if} $R0 == 0
        DetailPrint "$(appClosing)"
        !insertmacro DB_ASK_QUIT
        Sleep 500
        !insertmacro DB_FIND_APP
        ${if} $R0 == 0
          ; Still running: it is asking about a change it could not save, or it is an older Dayboard. Quitting from the tray
          ; menu works in every version and still saves.
          ${if} $LANGUAGE == 1042
            MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "Dayboard가 아직 실행 중이에요.$\r$\n$\r$\n작업 표시줄 오른쪽 알림 영역의 Dayboard 아이콘을 오른쪽 클릭해 「Dayboard 종료」를 누른 뒤 「다시 시도」를 누르세요. 저장하지 않은 변경이 있으면 Dayboard가 먼저 물어봐요.$\r$\n$\r$\n「무시」를 누르면 강제로 닫아요. 저장하지 않은 변경은 사라져요." /SD IDABORT IDRETRY db_ask_app IDIGNORE db_force_app
          ${else}
            MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "Dayboard is still running.$\r$\n$\r$\nRight-click the Dayboard icon in the notification area, choose Quit Dayboard, then choose Retry. If it has unsaved changes, Dayboard asks first.$\r$\n$\r$\nChoose Ignore to close it by force; unsaved changes are lost." /SD IDABORT IDRETRY db_ask_app IDIGNORE db_force_app
          ${endIf}
          Quit
          db_force_app:
            !insertmacro DB_STOP_APP 1
            Sleep 1000
            Goto db_ask_app
        ${endIf}
      ${endIf}
  ${endIf}
  !ifdef BUILD_UNINSTALLER
    db_check_done:
  !endif
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    Delete "$SMPROGRAMS\Dayboard.lnk"
  ${endIf}
!macroend
