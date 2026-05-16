# Client PC install (Windal / APPTEST)

Use any drive. Example paths below use **`D:\windal`** — change if your folder is different.

## Folder layout (you already have oracle_bridge)

```
D:\windal\
  apptest\                    ← app (APPTEST): server.cjs, package.json, SRC, setup scripts
  oracle_bridge\
    instantclient_23_0\       ← Oracle Instant Client (required)
  sqlnet.ora                  ← if used (optional, in D:\windal)
  tnsnames.ora                ← if used (optional, in D:\windal)
```

`server.cjs` expects: `..\oracle_bridge\instantclient_23_0` from the `apptest` folder.  
Do **not** put `node_modules` on USB copy — setup installs it on the PC.

---

## Step 1 — Copy files to client

Copy the full **`apptest`** folder (or `APPTEST`) to `D:\windal\apptest`.

Include (minimum):

- `server.cjs`, `package.json`, `package-lock.json`
- `setup-client.ps1`, `setup-new-client-tunnel.ps1`
- `connection.config.json` (edit per client — see Step 3)
- `SRC`, `public`, batch/ps1 helpers

Exclude: `node_modules`, `dist` (optional — setup rebuilds)

---

## Step 2 — Install Node.js and Cloudflare (`cloudflared`)

Do this **once per client PC**. Path example: `D:\windal\apptest`.

### Check if already installed

Open **PowerShell** (normal window is OK for check):

```powershell
node --version
npm --version
cloudflared --version
```

You need **Node 18 or newer**. If all three commands work, skip to **Step 3**.

---

### Method A — Automatic (recommended)

`setup-client.ps1` installs both when missing (uses **winget** + internet).

1. Open **PowerShell as Administrator**.
2. Run:

```powershell
cd D:\windal\apptest

powershell -ExecutionPolicy Bypass -File .\setup-client.ps1 `
  -ClientKey "dal-pushkar" `
  -OraclePrimaryUser "DAL" `
  -OraclePrimaryPassword "YOUR_PASSWORD" `
  -OracleConnectString "XE"
```

3. Wait until you see **Node version** and **Cloudflared** in the summary.
4. **Close PowerShell and open a new window**, then run `node --version` again.

If winget is missing: install **App Installer** from Microsoft Store, then retry.

---

### Method B — Manual install with winget

**PowerShell as Administrator:**

```powershell
winget install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements
winget install --id Cloudflare.cloudflared --exact --accept-source-agreements --accept-package-agreements
```

Close PowerShell, open a **new** window, verify:

```powershell
node --version
npm --version
cloudflared --version
```

Then run `setup-client.ps1` (it will skip reinstall if already present).

---

### Method C — Manual install from websites (no winget)

**Node.js**

1. On the client PC, open https://nodejs.org/
2. Download **LTS** (64-bit Windows).
3. Run the installer → Next → accept defaults → Finish.
4. Open a **new** PowerShell: `node --version` and `npm --version`.

**Cloudflare Tunnel (`cloudflared`)**

1. Open https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Download **Windows 64-bit** installer (or MSI).
3. Install → Finish.
4. New PowerShell: `cloudflared --version`

Typical install location: `C:\Program Files\Cloudflared\cloudflared.exe`

---

### Cloudflare login (one time per PC / account)

After `cloudflared` is installed:

```powershell
cloudflared tunnel login
```

- Browser opens → log in to Cloudflare.
- Choose zone **`fasaccountingsoftware.in`**.
- This PC can now manage tunnels for that account.

**Tunnel `dal-pushkar` already exists?** You do **not** run `tunnel create` again. Only put **`config.yml`** + **`<uuid>.json`** in `apptest` (copy from dev PC), or run:

```powershell
cd D:\windal\apptest
powershell -ExecutionPolicy Bypass -File .\setup-new-client-tunnel.ps1 -ClientKey "dal-pushkar" -SkipClientSetup
```

---

### Other prerequisites

1. **Windows 10/11** 64-bit, internet for first install.
2. **Oracle** reachable; `D:\windal\oracle_bridge\instantclient_23_0` already in place.
3. **PowerShell as Administrator** — required only for Windows **scheduled task** (auto-start API).

---

## Step 3 — Edit `connection.config.json` (per client)

In `D:\windal\apptest\connection.config.json` set:

- `clientName` / `defaultClientKey` → e.g. **`dal-pushkar`**
- `oracle.primary` → user, password, `connectString` (e.g. `XE`)
- `oracle.secondaryOracle` → if dual hub is used

Example client key: **`dal-pushkar`**  
Public URLs (after tunnel): `https://dal-pushkar.fasaccountingsoftware.in` and `https://dal-pushkar-api.fasaccountingsoftware.in`

---

## Step 4 — Run setup (Administrator)

```powershell
cd D:\windal\apptest

powershell -ExecutionPolicy Bypass -File .\setup-client.ps1 `
  -ClientKey "dal-pushkar" `
  -OraclePrimaryUser "DAL" `
  -OraclePrimaryPassword "YOUR_PASSWORD" `
  -OracleSecondaryUser "DAL" `
  -OracleSecondaryPassword "YOUR_PASSWORD" `
  -OracleConnectString "XE"
```

This will:

- Update `connection.config.json`
- Install Node / cloudflared if missing (winget)
- `npm install` and `npm run build`
- Create scheduled task **`FAS-dal-pushkar-API`** (API auto-start on reboot)
- Log: `logs\server.log`

If **Access is denied** on the task: run PowerShell **as Administrator**, or use `-AutoStartMode none` and start services manually.

Close and reopen PowerShell after Node install if `node` is not recognized.

---

## Step 5 — Cloudflare tunnel (dal-pushkar)

### If tunnel **already created** (your case)

You do **not** need to create the tunnel again. On the **client PC** you only need:

1. **`config.yml`** in `apptest`
2. **`<tunnel-uuid>.json`** credentials in the same folder (same UUID as in `config.yml`)

**Option A — Copy from the PC where tunnel was set up**

Copy these into `D:\windal\apptest\`:

- `config.yml`
- `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json`

Edit `config.yml` on the client if needed — web service must be **`http://localhost:5174`**:

```yaml
tunnel: <your-tunnel-uuid>
credentials-file: ./<your-tunnel-uuid>.json

ingress:
  - hostname: dal-pushkar.fasaccountingsoftware.in
    service: http://localhost:5174
  - hostname: dal-pushkar-api.fasaccountingsoftware.in
    service: http://localhost:5001
  - service: http_status:404
```

**Option B — Regenerate config on client** (same Cloudflare account, tunnel already named `dal-pushkar`):

```powershell
cloudflared tunnel login
cd D:\windal\apptest
powershell -ExecutionPolicy Bypass -File .\setup-new-client-tunnel.ps1 -ClientKey "dal-pushkar" -SkipClientSetup
```

That reuses tunnel **dal-pushkar**, refreshes DNS routes if needed, and writes `config.yml` + JSON. It does **not** create a second tunnel.

**Check tunnel exists:**

```powershell
cloudflared tunnel list
```

Look for `dal-pushkar` and note the UUID.

---

### If tunnel does **not** exist yet

```powershell
cloudflared tunnel login
cd D:\windal\apptest
powershell -ExecutionPolicy Bypass -File .\setup-new-client-tunnel.ps1 -ClientKey "dal-pushkar" -SkipClientSetup
```

---

## Step 6 — Start services (first test)

**Option A — script (3 windows):**

```powershell
cd D:\windal\apptest
.\start-apptest-services.ps1
```

**Option B — manual (3 PowerShell windows):**

```powershell
cd D:\windal\apptest
npm.cmd run server
```

```powershell
cd D:\windal\apptest
npm.cmd run dev -- --host 0.0.0.0 --port 5174
```

```powershell
cd D:\windal\apptest
cloudflared tunnel --config .\config.yml run
```

**Option C — batch (Admin):**

```powershell
cd D:\windal\apptest
.\run-all-services.cmd
```

---

## Step 7 — Verify

| Check | Expected |
|--------|----------|
| Local API | http://localhost:5001 |
| Local web | http://localhost:5174 |
| Public app | https://dal-pushkar.fasaccountingsoftware.in |
| Public API | https://dal-pushkar-api.fasaccountingsoftware.in |
| API log | `D:\windal\apptest\logs\server.log` |
| Oracle | Server window shows “Oracle Bridge” OK |

---

## Auto-start after reboot (optional)

| Task name | What it starts |
|-----------|----------------|
| `FAS-dal-pushkar-API` | API only (from Step 4) |
| `FAS-dal-pushkar-AllServices` | API + Vite + tunnel — run `.\setup-scheduled-task-all-services.ps1` as Admin |
| `FAS-dal-pushkar-AppStack` | Same via `setup-scheduled-task-app-stack.ps1` |

Use only **one** auto-start method to avoid port conflicts (5001 / 5174).

---

## Updates from Git (later)

```powershell
cd D:\windal\apptest
# Stop processes (adjust path if different):
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*D:\windal\apptest*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-Process node,esbuild,cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
.\update-from-git.ps1 -Branch main
.\start-apptest-services.ps1
```

---

## Troubleshooting

- **`node` / `npm` not found** — Reopen PowerShell after setup; or `$env:Path += ";C:\Program Files\nodejs"`.
- **Oracle init error** — Confirm `D:\windal\oracle_bridge\instantclient_23_0` exists; TNS files in `D:\windal\`.
- **Tunnel credentials missing** — `config.yml` + `<uuid>.json` in `apptest` folder; run tunnel setup again.
- **Wrong app on public URL** — Vite must be on **5174**; `config.yml` ingress must match.

See also: `tunnel_setup_command_powershell.txt`, `TUNNEL_SETUP_STEPS.txt`, `git_update_command_from_powershell.txt`.
