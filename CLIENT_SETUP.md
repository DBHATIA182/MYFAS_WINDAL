# Client Setup Guide

Use this same software for every client. Only `connection.config.json` changes per client.
For a new client, you normally change only:

- `clientName` (example: `dal-platinum`)
- Oracle connect/user/password fields

## 1) What to copy to client machine

Copy the full app folder `APPTEST` to any drive/path, for example:

- `<APP_ROOT>`

Required inside `APPTEST`:

- `server.cjs`
- `package.json` and `package-lock.json`
- `connection.config.json`
- `setup-client.ps1`
- `SRC`
- `public` (if present)

Do not copy:

- `node_modules` (setup installs automatically)

Also keep Oracle Instant Client as sibling folder expected by `server.cjs`:

- `..\oracle_bridge\instantclient_23_0`

Example folder layout:

- `<APP_ROOT>`
- `<APP_PARENT>\oracle_bridge\instantclient_23_0`

## 2) One-time machine prerequisites

- Windows 10/11 x64
- Internet access for first-time install
- Open PowerShell as Administrator
- `winget` available (App Installer)

## 3) Step-by-step install on client machine

1. Open PowerShell as Administrator.
2. Go to app folder:

`cd <APP_ROOT>`

3. Run setup:

`powershell -ExecutionPolicy Bypass -File .\setup-client.ps1 -ClientKey dal-platinum -OracleConnectString "XE" -OraclePrimaryUser DAL -OraclePrimaryPassword DAL -OracleSecondaryUser DAL -OracleSecondaryPassword DAL -AutoStartMode task`

4. Wait for completion. Script will:

- Sets `connection.config.json` -> `clientName` and auto-builds domain/API pattern
- Auto-install Node.js LTS (if missing)
- Auto-install Cloudflare Tunnel (`cloudflared`) (if missing)
- Installs npm dependencies (`npm install`)
- Builds frontend (`npm run build`)
- Registers API auto-start on reboot using Windows Task Scheduler

5. Verify service/log:

- Task Scheduler task name: `FAS-dal-platinum-API`
- Log file: `<APP_ROOT>\logs\server.log`

## 4) Auto start on every restart

Default mode is `task` (recommended). It creates startup task:

- Name: `FAS-<client>-API`
- Runs: `run-backend.cmd`
- Logs: `logs\server.log`

Optional:

- Use `-AutoStartMode nssm` if you want Windows Service mode and you have `nssm.exe`
- Use `-AutoStartMode none` to skip auto-start
- Use `-AutoInstallNode $false` to skip Node auto-install
- Use `-AutoInstallCloudflared $false` to skip Cloudflare auto-install

## 5) Notes on PDF / WhatsApp / Print / QR

These features are part of the same frontend app and get installed by `npm install` from `package.json`.
No separate backend service is required for PDF, WhatsApp share, print, or QR rendering.

