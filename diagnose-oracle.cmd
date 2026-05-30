@echo off
cd /d "%~dp0"
echo === Windal Oracle diagnostic ===
echo App root: %CD%
echo Parent:   %CD%\..
echo.
where node 2>nul
node --version 2>nul
echo Node exe: 
for /f "delims=" %%i in ('where node 2^>nul') do echo   %%i
echo.
if exist "..\oracle_bridge\instantclient_23_0\oci.dll" (
  echo [OK] oci.dll found
) else (
  echo [FAIL] Missing ..\oracle_bridge\instantclient_23_0\oci.dll
)
if exist "..\tnsnames.ora" (
  echo [OK] tnsnames.ora in parent WINDAL folder
) else (
  echo [WARN] Missing ..\tnsnames.ora — copy from SQL*Plus NETWORK\ADMIN
)
echo.
echo Testing thick client init...
node -e "const o=require('oracledb');const p=require('path');const fs=require('fs');const r=p.resolve(__dirname,'..');const lib=p.join(r,'oracle_bridge','instantclient_23_0');process.env.PATH=lib+';'+process.env.PATH;if(!fs.existsSync(p.join(lib,'oci.dll'))){console.error('oci.dll missing');process.exit(1);}o.initOracleClient({libDir:lib,configDir:r});console.log('Thick OK:',o.oracleClientVersionString);o.getConnection({user:'DAL',password:'DAL',connectString:'XE'}).then(c=>{console.log('DB OK:',c.oracleServerVersionString);return c.close();}).catch(e=>{console.error('DB FAIL:',e.message);process.exit(1);});"
echo.
pause
