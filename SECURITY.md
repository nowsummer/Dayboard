**English** · [한국어](SECURITY.ko.md)

# Security

Dayboard is a one-person project. This page covers how to report a security problem privately, what the app touches on your PC, and the risks in how it ships and updates.

## Reporting a vulnerability

Please don't report security problems in public.

- Use this repository's **Security** tab → **Report a vulnerability** (GitHub private reporting).
- Include the app version (top of Settings), what you found, how to reproduce it, and the likely impact.
- Never send passwords, tokens, app-specific passwords or `cloud-credentials.bin` (or its `.corrupt-*` copies).
- Remove account addresses and Windows user paths from logs and screenshots.

Response times aren't guaranteed. Fixes ship as new releases, and only the latest release is supported.

## What the app touches

### Files

In its own folder, `%APPDATA%\Dayboard`:

- `dayboard.json` — tasks, events, notes, lists, calendars, connected account names (usually email addresses), settings and widget positions.
  - Copies: the previous save `dayboard.previous.json`, and `dayboard.recovery-*.json` when a damaged file is found.
  - It is **unencrypted JSON**. Programs running as the same Windows user, and administrators, can read it.
- `cloud-credentials.bin` — sign-in tokens for connected accounts and the iCloud app-specific password.
  - Encrypted with Electron `safeStorage` (Windows Data Protection API). The key is protected in `Local State` in the same folder.
  - This only stops **other Windows accounts and copies moved to another PC**. Programs running as the same Windows user can decrypt it.
  - If encryption isn't available, nothing is saved or read. A file that can't be read is renamed to `cloud-credentials.bin.corrupt-*`.
- Also: `icons\` (Start menu shortcut icon), `update-alerts.json` (new-version alert history) and the usual Electron (Chromium) profile files.
- 0.2.0 installs also have `.updaterId`, a random per-install ID made by the update engine. From 1.0.0, it's no longer created and any existing one is deleted.

Outside that folder:

- **Wallpaper** — to paint the backdrop behind widgets, the app **only reads** the current wallpaper image and `%APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper`.
- **Back up data** — writes one JSON file where you choose. It holds tasks, events, notes and account names, but no sign-in data.

### Network

- **Microsoft** — `login.microsoftonline.com` (sign-in), `graph.microsoft.com` (To Do, Outlook calendar).
  - Scopes: `User.Read`, `Tasks.ReadWrite`, `Calendars.ReadWrite`, `offline_access`.
- **Google** — `accounts.google.com`, `oauth2.googleapis.com`, `openidconnect.googleapis.com` (sign-in), `tasks.googleapis.com`, `www.googleapis.com` (Tasks, Calendar, Drive).
  - Scopes: `openid`, `email`, `profile`, `tasks`, `calendar.readonly`, `calendar.events`, `drive.appdata`.
- **Apple** — `caldav.icloud.com` and the `icloud.com` servers Apple points to (HTTPS only; iCloud calendars over CalDAV).
- **GitHub** — `github.com` and GitHub's download servers (checking for new versions, downloading installers).
  - Update checks carry only a staging ID that is the same for every install. (0.2.0 sent a random per-install ID.)
- **This PC, only while signing in** — a random port on `127.0.0.1` waits up to 3 minutes for the browser's sign-in response.
  - PKCE and state are checked, and other PCs can't connect. Microsoft is given the address `http://localhost`.
- No analytics, telemetry or error reporting. There is no developer-run server.

### Notes sync (Google Drive)

- Runs only while a Google account's **Notes** switch is on. It turns on by itself for the first Google account you connect. You can pick another account or turn it off in Accounts.
- Notes are stored as JSON files in that account's Google Drive **app data folder**.
- Each note has one latest copy, holding up to 10 earlier versions and whether it's in Recently Deleted. There can be two copies only while two PCs edit the same note at once.
- A deleted note leaves a content-free deletion mark for 90 days.
- The folder is hidden from the Drive interface and from other apps. The `drive.appdata` scope can't reach any Drive file outside it.
- Only Dayboard on your other PCs, signed in to the same Google account, reads it.

### Windows

- **Native calls** — through koffi, the app calls functions in `user32`, `gdi32`, `kernel32`, `ole32` and `advapi32` to attach widgets to the desktop and give them keyboard focus.
  - For example `SetParent`, `SetWindowPos`, `SetWindowRgn`, `SetFocus`, `IDesktopWallpaper` (reads the wallpaper), and `RegGetValueW` to read `HKCU\Control Panel\Desktop` and `Colors`.
  - These calls never write to the registry.
- **Start menu** — installed copies and the portable bundle rewrite the shortcut `Dayboard.lnk` at every start (Windows notifications need it).
- **Launch at Windows startup** — when on, adds a sign-in startup entry (`HKCU\...\Run`) and points it at the running copy at every start. If you turned it off in Task Manager, it's left alone.
- **Notifications** — task reminders show as Windows notifications. Windows may keep their content (such as task titles) in its notification history.
- **Installer**
  - Installs without admin rights to `%LOCALAPPDATA%\Programs\dayboard-desktop`. Uninstall info goes in `HKCU`.
  - When you run setup or uninstall yourself, it first asks any Dayboard running in this Windows session to quit normally (Dayboard asks about unsaved changes), then waits up to 20 seconds.
  - If Dayboard is still running, it asks you to quit it from the notification area. It force-closes Dayboard only if you choose **Ignore**.
  - Auto-updates start the installer after Dayboard has finished saving, so it closes any leftover processes (by force if needed) and installs.
  - Opening an installer for the same or an older version installs nothing and just opens the installed app.
- **Update downloads**
  - Installers download to `%LOCALAPPDATA%\dayboard-desktop-updater`. The installer also keeps a copy of itself there for partial downloads.
  - Applying an update runs that installer.
  - 0.2.0 used `%LOCALAPPDATA%\dayboard-updater`. From 1.0.0 that folder is deleted a minute after start.
- **Left after uninstalling** — `%APPDATA%\Dayboard`, `%LOCALAPPDATA%\dayboard-desktop-updater` and, if Launch at Windows startup was on, its startup entry.
  - To remove everything, turn off Launch at Windows startup before uninstalling, then delete both folders.

## Known risks

### Microsoft sign-in

- To sign in without its own app registration, Dayboard uses Microsoft's public "Microsoft Graph Command Line Tools" client ID.
- The sign-in screen and your account's app permissions list show that name instead of Dayboard.
- Other tools using the same client (such as Microsoft Graph PowerShell) share this consent.
- Work or school admins can block this client, and a Microsoft policy change could stop it working.
- If that happens, enter your own app registration's client ID under **Use your own app registration** on the connect screen.

### Google sign-in

- Released installers include the publisher's Google OAuth desktop client (ID and secret).
- Google doesn't treat installed-app secrets as confidential, but they are not in this repository.
- If you build from source, you'll need to enter your own client ID when connecting Google (see the [README](README.md)).
- The app isn't verified by Google, so sign-in shows an "unverified app" screen, and Google caps new users at 100.

### iCloud

- Dayboard asks for an app-specific password, not your Apple Account password.
- An app-specific password can also be used for iCloud data beyond calendars.

### Local data

- Everything except sign-in data is stored unencrypted.
- Sign-in data isn't protected from programs running as the same Windows user either.
- Malware, anyone sharing your Windows account, and unencrypted PC backups can read your tasks, events and notes.

### Disconnecting and revoking access

**Disconnect** only deletes the sign-in data on this PC. Lists and events already synced stay as "archive" copies. To revoke access on the service side too:

- **Google** — remove Dayboard under Google Account → Security → Third-party apps & services (`myaccount.google.com/connections`).
- **Notes in Google Drive** — disconnecting doesn't delete them.
  1. On every PC, turn off **Notes** for that account in Dayboard, or disconnect it. (A PC with it on uploads the notes again.)
  2. In Google Drive on the web, go to Settings → Manage apps → Dayboard → Options → **Delete hidden app data**.
- **Microsoft personal account** — remove "Microsoft Graph Command Line Tools" at `account.live.com/consent/Manage`. This also removes the consent for other tools using the same client.
- **Microsoft work or school account** — use your organization's My Apps or ask your admin.
- **iCloud** — revoke Dayboard's password under Apple Account → Sign-In and Security → App-Specific Passwords.

## Updates and their risks

1. The installed copy checks GitHub for the latest release about 90 seconds after start, then every 6 hours.
2. New versions download in the background to `%LOCALAPPDATA%\dayboard-desktop-updater`.
3. They install only when you click **Restart now to update** in Settings or **Install Dayboard &lt;version&gt; and restart** in the notification-area menu. Nothing installs by itself at start, at exit or on a timer.

- Turning off **Check for new versions automatically** in Settings stops automatic checks and downloads.
- Running from source (`npm start`) and the portable bundle from `npm run package` (`앱\Dayboard-win32-x64`, a copy that runs without installing) don't update themselves. They only show a new-version alert and the releases page.

**Risks**

- Downloads are checked only against the SHA-512 in the same GitHub release's `latest.yml`, and the installers aren't code-signed.
- If the publisher's GitHub account or build PC were compromised, a malicious release would pass this check too.
- Waiting for your click gives you a chance to read the changes and hold off. It doesn't prove a release is genuine.

## The unsigned installer

- The installer has no code-signing certificate, so Windows SmartScreen or Smart App Control may warn about it or block it.
- Builds aren't reproducible, so you can't compare a downloaded installer byte-for-byte with one you build.

What you can do:

- **Compare the hash** — check the `sha256:` value next to each file on the [releases page](https://github.com/nowsummer/Dayboard/releases) against PowerShell's `Get-FileHash .\Dayboard-<version>.exe -Algorithm SHA256`.
  - A match means it's the file on the releases page. It doesn't prove it was built from this source.
- **Compare the installed code** — the installed app's code (`%LOCALAPPDATA%\Programs\dayboard-desktop\resources\app`) is plain, unbundled files, so you can compare it with the same version's code in this repository. (Inside the installer it's 7z-compressed.)
  - `package.json` has its scripts and devDependencies removed.
  - Added: `node_modules` and the publisher's Google client `assets\google-oauth.json`.
  - Left out (development files): `scripts`, `build`, `docs`, most of `tests`, `renderer\preview.js`, `assets\*.svg`, `assets\google-oauth.example.json`.
- **Build it yourself** — read the source and build it (see the [README](README.md)).
  - A copy you build and install still downloads new releases from this repository. Choosing to install one switches you to the published build.
  - To stay on your own build, turn off **Check for new versions automatically** in Settings.
