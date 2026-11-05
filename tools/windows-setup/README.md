# AFYX Windows Setup Bootstrapper

This folder contains the C# source for the Windows unified installer
(`SetupBootstrapper.cs`). The bootstrapper is a packaging/entrypoint layer
for the Kit's native PowerShell lifecycle, **not** an additional product engine.

## Supported boundary

The bootstrapper accepts help, extraction, verify, uninstall, and forwarded
setup options. A packaged `AfyxSetup.exe` should be evaluated from an
exact-source release artifact; the presence of C# source alone does not imply
a signed or publicly released installer.

The dedicated Windows installer GitHub Actions workflow passed on the
5 November 2026 `dev` engineering baseline documented in
[Development Status](../../docs/DEVELOPMENT_STATUS.md). Consult the
[Installation Guide](../../docs/INSTALLATION.md) for normal install/verify/
uninstall commands rather than invoking bootstrapper internals directly.
