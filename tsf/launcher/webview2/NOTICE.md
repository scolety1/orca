# Vendored: Microsoft Edge WebView2 SDK

These three files are redistributed, unmodified, from the official
`Microsoft.Web.WebView2` NuGet package (v1.0.2903.40), whose license
explicitly permits redistributing them alongside apps that embed WebView2 --
this is Microsoft's supported distribution model for the SDK, not a
third-party fork:

- `Microsoft.Web.WebView2.Core.dll` (`lib/net462`)
- `Microsoft.Web.WebView2.WinForms.dll` (`lib/net462`)
- `WebView2Loader.dll` (`runtimes/win-x64/native`)

Why `net462` rather than a modern .NET build: `Launch-TSF.ps1` runs under
Windows PowerShell 5.1 (`powershell.exe`, built into every Windows install --
see the README for why this launcher deliberately does not assume Tim has a
separate .NET/PowerShell 7 install), which is a classic .NET Framework host;
`net462` is the WebView2 SDK's build for that target.

Why vendored rather than restored via NuGet at install time: Tim's machine
has no requirement to reach nuget.org, and this keeps the launcher fully
self-contained -- no package restore step, no build step, just these three
files sitting next to `Launch-TSF.ps1`.

License: Microsoft Software License Terms for the Microsoft Edge WebView2 SDK
(see https://aka.ms/webview2/license). Source package:
https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.2903.40
