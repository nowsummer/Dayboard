<div align="center">

<img src="assets/icon.png" width="80" alt="">

# Dayboard

Clean like a Mac or iPhone. Quick on Windows.<br>Tasks, calendar and notes, with desktop widgets.

**English** · [한국어](README.ko.md)

[**Download for Windows**](https://github.com/nowsummer/Dayboard/releases/latest) · [Website](https://nowsummer.github.io/Dayboard/en/) · [Privacy](https://nowsummer.github.io/Dayboard/en/privacy.html)

<img src="images/en/demo.webp" width="860" alt="Adding and completing a task, dragging events in the month and week calendar, notes, then a widget put on the desktop and its glass adjusted in Dayboard">

</div>

## Why

The Reminders, Calendar and Notes apps on a Mac or iPhone, and their widgets, look good and are a pleasure to use. I wanted the same on Windows, so I built it. Two rules from the start: keep it clean, keep it quick.

- **Clean** — a tidy layout, glassy desktop widgets, light and dark mode.
- **Quick** — your data is kept on your PC, so screens open without waiting.
- **All in one place** — connect Microsoft, Google or iCloud and stay in sync with your other PCs and phones. Or use it with no account at all.
- **Private** — no server, no sign-up, no ads.

## Features

<table>
  <tr><td><b>Tasks</b></td><td>Smart lists · lists and groups · repeats and subtasks · drag to reorder · quick add: "tomorrow 3pm"</td></tr>
  <tr><td><b>Calendar</b></td><td>Day, week, month · drag to move or resize · edit in a side card · repeats and alerts · go to any date</td></tr>
  <tr><td><b>Notes</b></td><td>Grouped by date · pinning · find · earlier versions · synced across PCs via your Google account</td></tr>
  <tr><td><b>Widgets</b></td><td>Tasks, calendar and notes on the desktop, in Liquid Glass style</td></tr>
  <tr><td><b>Everyday</b></td><td>Search, undo and redo, shortcuts (press <kbd>?</kbd>), light and dark mode, English and Korean</td></tr>
</table>

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="images/en/tasks-list.png" alt="Tasks"></td>
    <td width="50%"><img src="images/en/calendar.png" alt="Month calendar"></td>
  </tr>
  <tr><td align="center">Tasks</td><td align="center">Calendar</td></tr>
  <tr>
    <td><img src="images/en/notes.png" alt="Notes"></td>
    <td><img src="images/en/tasks-today-dark.png" alt="Dark theme"></td>
  </tr>
  <tr><td align="center">Notes</td><td align="center">Dark theme</td></tr>
  <tr>
    <td><img src="images/en/calendar-week.png" alt="Week calendar"></td>
    <td><img src="images/en/help.png" alt="Shortcut help"></td>
  </tr>
  <tr><td align="center">Week view</td><td align="center">Shortcut help</td></tr>
</table>

<p align="center"><img src="images/en/widgets.png" width="860" alt="Notes, Today and calendar widgets on the desktop"><br>Desktop widgets</p>

## Install

1. Download `Dayboard-<version>.exe` from the [latest release](https://github.com/nowsummer/Dayboard/releases/latest) and run it. No admin rights needed.
2. Once installed, new versions download on their own. Choose **Restart now to update** in Settings to switch to the new version.

> [!NOTE]
> The installer isn't signed yet, so Windows Smart App Control may block it at first. Wait a moment and run it again. Windows x64 only.

**Connecting accounts**

- Google may say it hasn't verified the app. Choose **Advanced** to continue — it's a personal project.
- iCloud connects with an app-specific password from your Apple Account. iCloud Reminders aren't supported.

## Privacy

Tasks, events and notes stay on your PC (`%APPDATA%\Dayboard`), and data from connected accounts moves only between your PC and that service. Details: [Privacy policy](https://nowsummer.github.io/Dayboard/en/privacy.html) · [Security](SECURITY.md).

## Build from source

```powershell
git clone https://github.com/nowsummer/Dayboard.git
cd Dayboard
npm ci
npm test
npm start           # run from source
npm run package     # app bundle (needed by dist)
npm run dist        # unsigned installer in dist\
```

Needs Windows x64, Git and Node.js 22.12 or later.

- Official installers include the Google sign-in client. Your own build asks for your own Google Cloud OAuth client (see `assets/google-oauth.example.json`).
- Your own build still offers official releases. Turn off **Check for new versions automatically** to stay on it.

## License

[MIT](LICENSE). Fonts and service logos keep their own licenses ([notices](docs/licenses/THIRD-PARTY.txt)). Dayboard isn't affiliated with Microsoft, Google or Apple.
