# Windal (`E:\WINDAL\APPTEST`)

- **UI:** Windal Accounting (no GRAINFAS / GRAIN branding).
- **Oracle:** **DAL / DAL @ XE** only — `connection.config.json` uses `dualHubEnabled: false` (no secondary hub).
- **Git:** `https://github.com/DBHATIA182/MYFAS_WINDAL.git`  
  One-time: `git init`, `git remote add origin <url>`, then push your first commit.
- **Tunnel client key:** `dal-rgind` → **https://dal-rgind.fasaccountingsoftware.in** and **https://dal-rgind-api.fasaccountingsoftware.in**  
  (Underscores are invalid in DNS; `dal_rgind` is represented as `dal-rgind`.)

## Oracle layout

Same as other installs: **`E:\WINDAL\oracle_bridge\instantclient_23_0`** and TNS files under **`E:\WINDAL`** (parent of APPTEST).

## Tunnel quick command

```powershell
cd E:\WINDAL\APPTEST
powershell -ExecutionPolicy Bypass -File .\setup-new-client-tunnel.ps1 -ClientKey "dal-rgind" -OraclePrimaryUser "DAL" -OraclePrimaryPassword "DAL" -OracleSecondaryUser "DAL" -OracleSecondaryPassword "DAL" -OracleConnectString "XE"
```

See **TUNNEL_SETUP_STEPS.txt** for details.
