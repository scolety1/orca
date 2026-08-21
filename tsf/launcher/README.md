# Thousand Sunny Fleet — Desktop Launcher (M14)

Gives Tim a normal double-click launch experience for TSF: a Desktop and Start Menu
shortcut that ensure Orca is running, wait for the TSF backend, and open a dedicated
app window on the real UI -- no manual `npm run dev`, no typed localhost URL, no
opening Orca first.

This is a thin launcher, not a separate packaged app: TSF still runs from this
checkout (`tsf/server`, spawned by Orca's own TSF plugin, same as M6), and this folder
only adds the double-click entry points on top of that.

## One-time install

```powershell
cd tsf/launcher
powershell -ExecutionPolicy Bypass -File Install-TsfLauncher.ps1
```

Creates:
- Desktop shortcut: `%USERPROFILE%\Desktop\Thousand Sunny Fleet.lnk`
- Start Menu shortcut: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Thousand Sunny Fleet.lnk`

Both point at `Launch-TSF.ps1` in this folder (run hidden via
`powershell -WindowStyle Hidden`) -- nothing is copied elsewhere, so moving or
deleting this checkout removes the launcher's dependency too (the shortcuts would
simply stop resolving; re-run install after moving the checkout).

Re-running the install script is safe -- it only ever (re)writes these same two
`.lnk` files, and never touches any other Windows or Orca setting.

## Uninstall

```powershell
cd tsf/launcher
powershell -ExecutionPolicy Bypass -File Uninstall-TsfLauncher.ps1
```

Removes the two shortcuts above. Does not touch Orca, its settings, or this
checkout.

## What happens on launch

1. `Launch-TSF.ps1` runs `orca open` (idempotent -- safe whether Orca is already
   running or not) and waits for Orca's own runtime to be reachable.
2. It polls `http://127.0.0.1:4610/api/meta` (TSF's fixed server port) for up to 30
   seconds.
3. **Reachable** -> opens a dedicated app-mode window (Microsoft Edge's built-in
   `--app=` mode, with its own taskbar identity, no address bar/tabs, close/minimize
   like a normal app -- no Electron fork, no bundled browser) pointed at the real
   TSF UI.
4. **Not reachable** (most likely cause: Orca's plugin system hasn't been pointed at
   this checkout yet) -> opens the same kind of dedicated window on
   `first-run-setup.html` instead: a guided, one-time, three-step walkthrough of
   Orca's own Settings -> Plugins -> Development flow, with the exact folder path to
   paste and a copy button. This step runs once per machine; every later launch is a
   plain double-click.

Logs (for diagnosing "it didn't open" reports) are written to
`%LOCALAPPDATA%\ThousandSunnyFleet\launcher.log`.

## Regenerating the shortcut icon

`tsf.ico` is checked in and does not need regenerating for normal use. If the design
changes, edit `Generate-Icon.ps1` (draws the icon from TSF's own theme tokens via
.NET `System.Drawing` -- no external image asset) and re-run it:

```powershell
powershell -ExecutionPolicy Bypass -File Generate-Icon.ps1
```

## Requirements

- Windows 11 (or 10) with PowerShell (built in) and Microsoft Edge (built in; the
  launcher falls back to the OS default browser -- as a plain tab, not a dedicated
  window -- if Edge cannot be found).
- Orca installed, with the `orca` CLI on PATH (true for any normal Orca install).
- No Node.js install required on the machine running the launcher itself -- Node is
  only ever invoked by Orca's own bundled runtime to run `tsf/server`.
