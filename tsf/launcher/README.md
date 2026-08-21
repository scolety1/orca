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

1. If Thousand Sunny Fleet is already running, `Launch-TSF.ps1` detects that via a
   named Mutex and just activates the existing window instead of opening a second one.
2. Otherwise it creates and shows a genuine dedicated window **immediately** (measured
   live: ~1 second from double-click) -- no waiting on Orca, the network, or anything
   else first. It loads the WebView2 SDK's managed assemblies (vendored in `webview2/`)
   directly into this `powershell.exe` process and creates a plain WinForms window with
   a `WebView2` control filling it, rather than shelling out to a browser or a separate
   compiled host exe. (An earlier attempt at a compiled .NET/WebView2 host `.exe` was
   hard-blocked by Windows Smart App Control on the real target machine -- see
   `docs/tsf/M14_DESKTOP_LAUNCH_REMEDIATION_V1.md` for the evidence. Hosting the control
   inside the already-trusted `powershell.exe` process instead sidesteps that entirely,
   since no second executable image is ever loaded.)
3. In the background, it fires `orca open` (non-blocking, retried a bounded number of
   times) to make sure Orca itself is coming up, and on the same retry cadence, fires
   `Invoke-TsfActivationNudge.ps1` -- Orca activates a dev plugin's worker process
   *lazily*, only the first time one of its commands is invoked or one of its
   subscribed events fires (confirmed by reading Orca's own plugin-service source),
   and none of TSF's subscribed events happen automatically at a bare cold start. This
   script invokes TSF's own already-registered `tsf-status` command directly against
   the running Orca instance, over the same local RPC mechanism the `orca` CLI itself
   uses (`%APPDATA%\orca\orca-runtime.json` + a named pipe) -- the real, supported fix,
   not just a longer wait. See `Invoke-TsfActivationNudge.ps1`'s own header and
   `docs/tsf/M14_DESKTOP_LAUNCH_REMEDIATION_V1.md` for the full evidence trail.
4. The window navigates straight to `first-run-setup.html`, which owns all of the
   actual waiting from here regardless: an immediate neutral "Starting…" state, a
   reassurance after 90 seconds that a longer wait can still be normal, a registration
   walkthrough revealed only past 5 minutes and framed as something to double-check
   rather than a diagnosis, and an honest "this is genuinely unusual" note past 10
   minutes -- polling indefinitely throughout and never giving up, then auto-navigating
   the same window to the real UI the instant the backend answers. With the activation
   nudge above, this is normally seconds, not minutes; the escalating messaging exists
   as a safety net for whatever this launcher has no control over, not the expected
   everyday path.
5. Any genuine failure anywhere in this sequence shows a real, visible error dialog --
   there is no silent-death path left.

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

- Windows 11 (or 10) with PowerShell (built in) and the Microsoft Edge WebView2
  Runtime (built in on Windows 11; auto-installed as part of Windows/Edge servicing
  on Windows 10, and evergreen once present).
- Orca installed, with the `orca` CLI on PATH (true for any normal Orca install).
- No Node.js install required on the machine running the launcher itself -- Node is
  only ever invoked by Orca's own bundled runtime to run `tsf/server`.
- No .NET SDK, npm, or package-restore step required either -- the WebView2 SDK files
  the launcher loads are vendored in `webview2/` (see its `NOTICE.md`).
