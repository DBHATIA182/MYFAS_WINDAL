# dal-demo on phone (blank screen fix)

Desktop on `http://localhost:5174` can work while **https://dal-demo.fasaccountingsoftware.in** stays blank on mobile. Common causes:

1. **Vite dev** through Cloudflare — hundreds of small JS module requests; mobile browsers often fail silently.
2. **Stale cache** on the phone from earlier failed loads.
3. **API not running** on 5001 (login errors, not always blank).

## Recommended: production web for tunnel

From `E:\WINDAL\APPTEST`:

```cmd
Windal_Start_Services-Mobile.bat
```

Or PowerShell:

```powershell
.\Start-WindalStack.ps1 -ProductionWeb
```

This runs `npm run build` then **vite preview** on port **5174** (few bundled files — reliable on phone).

API must still run on **5001** (the script starts it).

## Manual (two terminals)

```cmd
cd /d E:\WINDAL\APPTEST
node server.cjs
npm run tunnel:web
cloudflared tunnel --config config.yml run
```

## On the phone

1. Use **https://dal-demo.fasaccountingsoftware.in** (not localhost).
2. **Clear site data** for that host (Safari: Settings → Safari → Advanced → Website Data; Chrome: site settings → Clear data).
3. Hard refresh or private tab once after redeploy.

## Quick checks (PC)

```cmd
curl http://127.0.0.1:5001/api/client-identity
curl https://dal-demo.fasaccountingsoftware.in/api/client-identity
```

Both should return JSON with `"clientKey":"dal-demo"`.

## Dev vs mobile

| Mode | Command | Phone |
|------|---------|-------|
| Dev (fast on PC) | `npm run dev` | Often blank / flaky |
| Tunnel mobile | `Windal_Start_Services-Mobile.bat` | Use this |

After code changes for phone testing, run **Mobile** batch again (rebuild).
