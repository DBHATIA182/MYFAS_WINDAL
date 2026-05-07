const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const oracledb = require('oracledb');
const cors = require('cors');
const connectionConfig = require('./connection.config.json');
const app = express();

/** Default 5001; override when busy: PowerShell `$env:PORT=5002; node server.cjs` */
const PORT = Number(process.env.PORT) || 5001;

/**
 * Oracle `callTimeout` for /api/sale-bill-print probes (ms). Set SALE_BILL_PRINT_QUERY_TIMEOUT_MS=0 to disable.
 * Prevents a single bad plan from hanging the UI indefinitely (retries still apply on ORA-00904).
 * Probing order: Nano tries each QR-column variant until one parses; skips the heavy Matrix when Oracle returns 0 rows (same filters as Matrix).
 */
function saleBillPrintCallTimeoutOpts() {
  const raw = process.env.SALE_BILL_PRINT_QUERY_TIMEOUT_MS;
  if (raw != null && String(raw).trim() === '0') return {};
  /** Default 45s so several matrix retries stay under common browser 180s timeouts. */
  const n = parseInt(String(raw != null && String(raw).trim() !== '' ? raw : '45000'), 10);
  if (!Number.isFinite(n) || n < 1000) return {};
  return { callTimeout: Math.min(n, 600000) };
}

function truthyEnv01(v) {
  const f = String(v ?? '').trim().toLowerCase();
  return f === '1' || f === 'true' || f === 'yes' || f === 'on';
}

/** Credit-note cross-ref on SALE (many schemas omit). Opt in: SALE_BILL_PRINT_SALE_SB_COLS=1 */
function saleBillPrintSbRefundColumnsSql() {
  if (truthyEnv01(process.env.SALE_BILL_PRINT_SALE_SB_COLS)) {
    return `A.SB_NO,
        A.SB_TYPE,
        A.SB_DATE`;
  }
  return `CAST(NULL AS VARCHAR2(40)) AS SB_NO,
        CAST(NULL AS VARCHAR2(40)) AS SB_TYPE,
        CAST(NULL AS DATE) AS SB_DATE`;
}

/** Gross / Dane weights on SALE line (optional). Opt in: SALE_BILL_PRINT_SALE_GD_WEIGHT_COLS=1 */
function saleBillPrintGdWeightColumnsSql() {
  if (truthyEnv01(process.env.SALE_BILL_PRINT_SALE_GD_WEIGHT_COLS)) {
    return `A.G_WEIGHT,
        A.D_WEIGHT`;
  }
  return `CAST(NULL AS NUMBER) AS G_WEIGHT,
        CAST(NULL AS NUMBER) AS D_WEIGHT`;
}

/** Line packing column on SALE (many schemas omit). Opt in: SALE_BILL_PRINT_SALE_PACKING_COL=1 */
function saleBillPrintPackingColumnSql() {
  if (truthyEnv01(process.env.SALE_BILL_PRINT_SALE_PACKING_COL)) {
    return 'A.PACKING';
  }
  return 'CAST(NULL AS VARCHAR2(30)) AS PACKING';
}

/**
 * WNDL / latest schemas: SALE.PLANT_CODE + PLANT master for dispatch block.
 * Legacy: SALE.GOD_CODE (aliased AS PLANT_CODE so merge logic stays one-shaped). SALE_BILL_PRINT_LEGACY_SALE_GOD_CODE=1
 */
function saleBillPrintSalePlantCodeSql() {
  if (truthyEnv01(process.env.SALE_BILL_PRINT_LEGACY_SALE_GOD_CODE)) {
    return 'A.GOD_CODE AS PLANT_CODE';
  }
  return 'A.PLANT_CODE';
}

// Oracle paths: parent folder of this app (e.g. \windal\apptest → ..\oracle_bridge, TNS in parent \windal)
const FAS_PARENT_ROOT = path.join(__dirname, '..');
const CLIENT_PATH = path.join(FAS_PARENT_ROOT, 'oracle_bridge', 'instantclient_23_0');
const TNS_PATH = FAS_PARENT_ROOT;

try {
    oracledb.initOracleClient({ libDir: CLIENT_PATH, configDir: TNS_PATH });
    console.log('✅ Oracle Bridge (instant client + TNS):', CLIENT_PATH, '|', TNS_PATH);
} catch (err) {
    if (!err.message.includes('already initialized')) {
        console.error("Oracle Init Error:", err.message);
    }
}

const rootDomain = connectionConfig.domain?.rootDomain || 'fasaccountingsoftware.in';
const localOrigin = connectionConfig.local?.webOrigin;
const configuredClientName = connectionConfig.clientName || connectionConfig.defaultClientKey || '';
const autoWebOrigin = configuredClientName ? `https://${configuredClientName}.${rootDomain}` : null;
const configuredClientOrigins = Object.values(connectionConfig.clients || {})
  .map((client) => client.webOrigin)
  .filter(Boolean);
const allowedOrigins = Array.from(
  new Set([localOrigin, autoWebOrigin, ...configuredClientOrigins].filter(Boolean))
);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return parsed.hostname === rootDomain || parsed.hostname.endsWith(`.${rootDomain}`);
  } catch (_) {
    return false;
  }
}

// --- 2. UPDATED CORS ---
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, origin || true);
    return callback(new Error(`CORS blocked for origin: ${origin || 'unknown'}`));
  },
  credentials: true
}));

app.use(express.json());

app.get('/api/client-identity', (req, res) => {
  res.json({
    ok: true,
    clientKey: String(configuredClientName || '').trim().toLowerCase(),
    rootDomain,
  });
});

/** Merge file overrides without letting JSON null / empty wipe credentials (spread alone can set password: null). */
function mergeOracleConn(defaults, fileOverride) {
  const o = fileOverride && typeof fileOverride === 'object' ? fileOverride : {};
  const pick = (key, def) => {
    const v = o[key];
    if (v === undefined || v === null) return def;
    const s = String(v).trim();
    if (key === 'password' && s === '') return def;
    if ((key === 'user' || key === 'connectString') && s === '') return def;
    return s;
  };
  return {
    user: pick('user', defaults.user),
    password: pick('password', defaults.password),
    connectString: pick('connectString', defaults.connectString),
  };
}

function envTrim(name) {
  const v = process.env[name];
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  return s;
}

/** True for 1, true, yes, on (case-insensitive). */
function envTruthy(name) {
  const v = envTrim(name);
  if (!v) return false;
  return /^(1|true|yes|on)$/i.test(v);
}

/** First non-empty non-comment line from a secret file. */
function readFirstSecretLine(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return (
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#')) || ''
  );
}

/**
 * In-app "Update to latest": env GFAS_DEPLOY_UPDATE_KEY or first line of a secret file (min 8 chars).
 * Tries deploy-update-secret.txt, then deploy-update-secret.txt.txt (Notepad "double .txt" mistake).
 */
function getDeployUpdateSecret() {
  const fromEnv = envTrim('GFAS_DEPLOY_UPDATE_KEY');
  if (fromEnv) return fromEnv;
  const candidates = ['deploy-update-secret.txt', 'deploy-update-secret.txt.txt'];
  for (const name of candidates) {
    try {
      const p = path.join(__dirname, name);
      if (fs.existsSync(p)) {
        return readFirstSecretLine(p);
      }
    } catch (_) {}
  }
  return '';
}

const DEPLOY_UPDATE_SECRET = getDeployUpdateSecret();

/**
 * Skip deploy key if GFAS_DEPLOY_UPDATE_SKIP_KEY=1/true/yes/on, or if a marker file exists next to
 * server.cjs (may be empty). Checks on each request so you can add the file without restarting Node.
 * Filenames: deploy-update-no-key.txt, deploy-update-no-key.txt.txt (Notepad), or deploy-update-no-key.
 * Use only on trusted LAN / VPN.
 */
let loggedDeploySkipKey = false;
function deployUpdateSkipKeyNow() {
  if (envTruthy('GFAS_DEPLOY_UPDATE_SKIP_KEY')) {
    if (!loggedDeploySkipKey) {
      console.log('Deploy update: key check disabled (GFAS_DEPLOY_UPDATE_SKIP_KEY).');
      loggedDeploySkipKey = true;
    }
    return true;
  }
  const markerNames = ['deploy-update-no-key.txt', 'deploy-update-no-key.txt.txt', 'deploy-update-no-key'];
  for (const name of markerNames) {
    try {
      if (fs.existsSync(path.join(__dirname, name))) {
        if (!loggedDeploySkipKey) {
          console.log(`Deploy update: key check disabled (marker file ${name}).`);
          loggedDeploySkipKey = true;
        }
        return true;
      }
    } catch (_) {}
  }
  loggedDeploySkipKey = false;
  return false;
}

function deployUpdateConfigured() {
  return deployUpdateSkipKeyNow() || (DEPLOY_UPDATE_SECRET && DEPLOY_UPDATE_SECRET.length >= 8);
}

function deployKeyMatches(provided) {
  if (!DEPLOY_UPDATE_SECRET || DEPLOY_UPDATE_SECRET.length < 8) return false;
  const a = String(provided ?? '').trim();
  if (!a) return false;
  return (
    crypto.createHash('sha256').update(DEPLOY_UPDATE_SECRET, 'utf8').digest('hex') ===
    crypto.createHash('sha256').update(a, 'utf8').digest('hex')
  );
}

let deployUpdateJobLock = false;
let deployUpdateSafetyTimer = null;
const DEPLOY_LOG_PATH = path.join(__dirname, 'logs', 'deploy-update.log');

function appendDeployLogLine(msg) {
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${String(msg || '').trim()}\n`;
    fs.appendFileSync(DEPLOY_LOG_PATH, line, 'utf8');
  } catch (_) {}
}

function readDeployUpdateLogLines(maxLines = 12) {
  try {
    if (!fs.existsSync(DEPLOY_LOG_PATH)) return [];
    const raw = fs.readFileSync(DEPLOY_LOG_PATH, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if (lines.length <= maxLines) return lines;
    return lines.slice(lines.length - maxLines);
  } catch (_) {
    return [];
  }
}

function inferDeployProgress(busy, lines) {
  const text = lines.join('\n');
  const has = (needle) => text.includes(needle);
  let statusLabel = busy ? 'Update is running...' : 'Idle';
  let pct = busy ? 5 : 0;
  let isFinished = false;
  let isError = false;

  if (has('ERROR')) {
    statusLabel = 'Update failed. Check deploy-update.log.';
    pct = 100;
    isError = true;
  } else if (has('--- deploy update finished ---')) {
    statusLabel = 'Update finished. Restart sequence done.';
    pct = 100;
    isFinished = true;
  } else if (has('Starting run-autostart-stack.cmd') || has('Launcher started.')) {
    statusLabel = 'Restarting services...';
    pct = busy ? 92 : 100;
  } else if (has('Stopping Node processes for this app')) {
    statusLabel = 'Stopping old processes...';
    pct = 80;
  } else if (has('update-from-git.ps1 finished OK')) {
    statusLabel = 'Update downloaded and built.';
    pct = 65;
  } else if (has('Running update-from-git.ps1')) {
    statusLabel = 'Pulling latest code and building...';
    pct = 35;
  } else if (has('--- deploy update started ---')) {
    statusLabel = 'Update started...';
    pct = 12;
  }

  if (busy && pct >= 100) pct = 95;
  return { progressPercent: pct, statusLabel, isFinished, isError };
}

function clearDeployUpdateSafetyTimer() {
  if (deployUpdateSafetyTimer) {
    clearTimeout(deployUpdateSafetyTimer);
    deployUpdateSafetyTimer = null;
  }
}

function releaseDeployUpdateJobLock(reason) {
  clearDeployUpdateSafetyTimer();
  deployUpdateJobLock = false;
  if (reason) console.log(`deploy-update: lock released (${reason}).`);
}

function spawnDeployUpdateJob() {
  const ps1 = path.join(__dirname, 'run-deploy-update.ps1');
  const cmdWrapper = path.join(__dirname, 'run-deploy-update.cmd');
  if (!fs.existsSync(ps1)) {
    throw new Error('run-deploy-update.ps1 is missing in the application folder.');
  }
  if (!fs.existsSync(cmdWrapper)) {
    throw new Error('run-deploy-update.cmd is missing in the application folder.');
  }
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const launcherCandidates = [
    { exe: cmdWrapper, args: [], label: 'cmd-wrapper-direct', useShell: true },
    { exe: 'cmd.exe', args: ['/d', '/c', cmdWrapper], label: 'cmd-wrapper-via-cmd' },
    {
      exe: process.env.WINDIR
        ? path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      label: 'powershell-direct',
    },
  ];
  let child = null;
  let lastSpawnErr = null;
  for (const c of launcherCandidates) {
    try {
      appendDeployLogLine(
        `Deploy spawn attempt using: ${c.label} -> ${c.exe} ${Array.isArray(c.args) ? c.args.join(' ') : ''}`
      );
      const spawnOpts = {
        cwd: __dirname,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: c.useShell === true,
      };
      child = spawn(c.exe, c.args, spawnOpts);
      lastSpawnErr = null;
      break;
    } catch (err) {
      lastSpawnErr = err;
      appendDeployLogLine(`Deploy spawn failed for ${c.label}: ${err.message}`);
    }
  }
  if (!child) {
    const msg = `Could not start PowerShell for deploy update: ${lastSpawnErr?.message || 'unknown error'}`;
    appendDeployLogLine(msg);
    throw new Error(msg);
  }
  let finished = false;
  function finish(detail) {
    if (finished) return;
    finished = true;
    child.removeListener('exit', onExit);
    child.removeListener('error', onSpawnErr);
    releaseDeployUpdateJobLock(detail);
  }
  function onExit(code, signal) {
    appendDeployLogLine(`deploy-update child exited: code=${code} signal=${signal || ''}`);
    finish(`script exit code ${code}${signal ? ` signal ${signal}` : ''}`);
  }
  function onSpawnErr(err) {
    console.error('deploy-update spawn error:', err.message);
    appendDeployLogLine(`deploy-update spawn error: ${err.message}`);
    finish('spawn error');
  }
  child.once('exit', onExit);
  child.once('error', onSpawnErr);
  // If 'exit' never fires (abnormal), allow retry after 15 minutes.
  clearDeployUpdateSafetyTimer();
  deployUpdateSafetyTimer = setTimeout(() => {
    deployUpdateSafetyTimer = null;
    if (!deployUpdateJobLock) return;
    console.warn('deploy-update: safety timeout cleared job lock (check logs\\deploy-update.log).');
    releaseDeployUpdateJobLock();
  }, 900000);
  child.unref();
}

// --- 3. DATABASE CONFIG (Using "XE" alias from TNS) ---
const oracleCfg = connectionConfig.oracle && typeof connectionConfig.oracle === 'object' ? connectionConfig.oracle : {};

/** When true, optional second Oracle hub (see secondaryOracle / legacy grain in JSON). Windal default: false (DAL/DAL@XE only). */
function isDualOracleHubEnabled() {
  if (oracleCfg.dualHubEnabled !== undefined) return Boolean(oracleCfg.dualHubEnabled);
  if (oracleCfg.grainHubEnabled !== undefined) return oracleCfg.grainHubEnabled !== false;
  return false;
}

/** If true, secondary hub login must succeed when DBA_USERS shows that user exists. */
function isDualOracleHubRequired() {
  return Boolean(oracleCfg.dualHubRequired || oracleCfg.requireGrainHub);
}

const DB_PRIMARY = mergeOracleConn(
  { user: 'DAL', password: 'DAL', connectString: 'XE' },
  oracleCfg.primary
);
/** Secondary hub (optional). Defaults match primary; override with oracle.secondaryOracle or legacy oracle.grain. */
const DB_SECONDARY = mergeOracleConn(
  {
    user: String(DB_PRIMARY.user || 'DAL'),
    password: String(DB_PRIMARY.password || 'DAL'),
    connectString: String(DB_PRIMARY.connectString || 'XE'),
  },
  oracleCfg.secondaryOracle ?? oracleCfg.grain
);
if (envTrim('FAS_ORACLE_SECONDARY_USER')) DB_SECONDARY.user = envTrim('FAS_ORACLE_SECONDARY_USER');
if (process.env.FAS_ORACLE_SECONDARY_PASSWORD !== undefined) {
  DB_SECONDARY.password = String(process.env.FAS_ORACLE_SECONDARY_PASSWORD);
}
if (envTrim('FAS_ORACLE_SECONDARY_CONNECT')) DB_SECONDARY.connectString = envTrim('FAS_ORACLE_SECONDARY_CONNECT');
const REQUIRE_SECONDARY_HUB = isDualOracleHubRequired();
const DUAL_ORACLE_HUB_ENABLED = isDualOracleHubEnabled();

let activeDbConfig = DB_PRIMARY;
const ORACLE_POOL_ENABLED = String(process.env.ORACLE_POOL_ENABLED ?? '1').trim() !== '0';
const ORACLE_POOL_MIN = Math.max(0, parseInt(process.env.ORACLE_POOL_MIN ?? '1', 10) || 1);
const ORACLE_POOL_MAX = Math.max(1, parseInt(process.env.ORACLE_POOL_MAX ?? '12', 10) || 12);
const ORACLE_POOL_INC = Math.max(1, parseInt(process.env.ORACLE_POOL_INC ?? '1', 10) || 1);
const ORACLE_POOL_TIMEOUT_SEC = Math.max(5, parseInt(process.env.ORACLE_POOL_TIMEOUT_SEC ?? '60', 10) || 60);
const ORACLE_STMT_CACHE_SIZE = Math.max(10, parseInt(process.env.ORACLE_STMT_CACHE_SIZE ?? '100', 10) || 100);
const oraclePools = new Map();
const oraclePoolCreates = new Map();

function maskOracleLog(conn) {
  if (!conn || typeof conn !== 'object') return '(no config)';
  const u = conn.user != null ? String(conn.user) : '';
  const cs = conn.connectString != null ? String(conn.connectString) : '';
  return `${u}/***@${cs}`;
}

function formatOracleConnectErr(err) {
  if (!err) return '';
  const n = err.errorNum != null ? ` ORA-${err.errorNum}` : '';
  return `${err.message || err}${n}`;
}

function oraclePoolKey(connCfg) {
  const u = String(connCfg?.user ?? '').trim().toUpperCase();
  const c = String(connCfg?.connectString ?? '').trim().toUpperCase();
  return `${u}|${c}`;
}

async function getOrCreateOraclePool(connCfg) {
  const key = oraclePoolKey(connCfg);
  const existing = oraclePools.get(key);
  if (existing) return existing;
  const inflight = oraclePoolCreates.get(key);
  if (inflight) return inflight;

  const creating = (async () => {
    const pool = await oracledb.createPool({
      user: connCfg.user,
      password: connCfg.password,
      connectString: connCfg.connectString,
      poolMin: ORACLE_POOL_MIN,
      poolMax: ORACLE_POOL_MAX,
      poolIncrement: ORACLE_POOL_INC,
      poolTimeout: ORACLE_POOL_TIMEOUT_SEC,
      stmtCacheSize: ORACLE_STMT_CACHE_SIZE,
    });
    oraclePools.set(key, pool);
    console.log(`📌 Oracle pool ready: ${String(connCfg.user || '').toUpperCase()}@${connCfg.connectString}`);
    return pool;
  })();

  oraclePoolCreates.set(key, creating);
  try {
    return await creating;
  } finally {
    oraclePoolCreates.delete(key);
  }
}

async function getDbConnection(connCfg) {
  if (!ORACLE_POOL_ENABLED) return oracledb.getConnection(connCfg);
  try {
    const pool = await getOrCreateOraclePool(connCfg);
    return pool.getConnection();
  } catch (err) {
    console.warn(`⚠️ Oracle pool fallback (direct connection): ${formatOracleConnectErr(err)}`);
    return oracledb.getConnection(connCfg);
  }
}

function isEffectiveCompUid(schema) {
  if (schema == null) return false;
  const s = String(schema).trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (low === 'null' || low === 'undefined') return false;
  return true;
}

function isDbaUsersProbeSkipped(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('ORA-00942') ||
    msg.includes('ORA-01031') ||
    /table or view does not exist/i.test(msg) ||
    /insufficient privileges/i.test(msg)
  );
}

/**
 * Bootstrap: connect primary hub, then optionally probe DBA_USERS for secondary hub user (dual-hub installs only).
 */
async function resolveActiveDbConfig() {
  let primaryConn;
  /** @type {boolean|null} null = could not read DBA_USERS */
  let secondaryUserInDba = null;

  try {
    primaryConn = await oracledb.getConnection(DB_PRIMARY);
    console.log(`📌 Hub Oracle bootstrap: primary hub as ${maskOracleLog(DB_PRIMARY)}`);

    if (!DUAL_ORACLE_HUB_ENABLED) {
      try {
        await primaryConn.close();
      } catch (closeErr) {
        console.warn('⚠️ Closing primary hub session:', closeErr.message);
      }
      primaryConn = null;
      console.log('📌 Dual Oracle hub disabled — primary hub only (no secondary hub attempt).');
      return DB_PRIMARY;
    }

    const secUser = String(DB_SECONDARY.user || '').trim();
    if (!secUser || secUser.toUpperCase() === String(DB_PRIMARY.user || '').trim().toUpperCase()) {
      try {
        await primaryConn.close();
      } catch (closeErr) {
        console.warn('⚠️ Closing primary hub session:', closeErr.message);
      }
      primaryConn = null;
      console.log('📌 Secondary hub user matches primary — using primary hub only.');
      return DB_PRIMARY;
    }

    try {
      const dba = await primaryConn.execute(
        `SELECT USERNAME FROM DBA_USERS WHERE UPPER(TRIM(USERNAME)) = UPPER(TRIM(:secUser))`,
        { secUser },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      secondaryUserInDba = Array.isArray(dba.rows) && dba.rows.length > 0;
      console.log(
        secondaryUserInDba
          ? `📌 DBA_USERS: Oracle user ${secUser} exists → secondary hub eligible.`
          : '📌 DBA_USERS: secondary Oracle user missing → hub stays primary.'
      );
    } catch (err) {
      if (isDbaUsersProbeSkipped(err)) {
        secondaryUserInDba = null;
        console.warn('⚠️ DBA_USERS not available to primary hub; secondary-hub check skipped:', err.message);
        console.warn('   Will attempt secondary hub anyway (if it fails, hub stays primary).');
      } else {
        throw err;
      }
    }

    try {
      await primaryConn.close();
    } catch (closeErr) {
      console.warn('⚠️ Closing primary hub session after DBA_USERS probe:', closeErr.message);
    }
    primaryConn = null;
  } catch (err) {
    if (primaryConn) {
      try {
        await primaryConn.close();
      } catch (_) {}
      primaryConn = null;
    }
    throw new Error(`Primary hub Oracle login failed: ${formatOracleConnectErr(err)}`);
  }

  if (secondaryUserInDba === false) {
    console.log('📌 Hub: primary only (no secondary Oracle account on this database per DBA_USERS).');
    return DB_PRIMARY;
  }

  let secondaryConn;
  try {
    secondaryConn = await oracledb.getConnection(DB_SECONDARY);
    console.log(
      `📌 Hub Oracle user: secondary as ${maskOracleLog(DB_SECONDARY)} — companies, years, login (USERS) until comp_uid is selected.`
    );
    return DB_SECONDARY;
  } catch (err) {
    const detail = formatOracleConnectErr(err);
    console.error('❌ Secondary Oracle hub login failed:', detail);
    console.error(`   Attempted secondary as ${maskOracleLog(DB_SECONDARY)}`);
    console.error(
      '   Fix: oracle.secondaryOracle, FAS_ORACLE_SECONDARY_*, sqlnet.ora next to oracle_bridge (SQLNET.ALLOWED_LOGON_VERSION_CLIENT=8 for Oracle 10g).'
    );
    const mustUseSecondary = REQUIRE_SECONDARY_HUB && secondaryUserInDba === true;
    if (mustUseSecondary) {
      throw new Error(
        `oracle.dualHubRequired: DBA_USERS shows secondary user exists but secondary hub login failed: ${detail}`
      );
    }
    if (REQUIRE_SECONDARY_HUB && secondaryUserInDba === null) {
      console.warn(
        '   oracle.dualHubRequired is true but DBA_USERS was not readable; allowing primary hub fallback. Fix secondary hub login or DBA_USERS access.'
      );
    }
    console.warn('   Falling back to primary hub.');
    return DB_PRIMARY;
  } finally {
    if (secondaryConn) {
      try {
        await secondaryConn.close();
      } catch (_) {}
    }
  }
}

// --- 4. runQuery: hub user (no 3rd arg) vs company year user comp_uid/comp_uid@XE (3rd arg) ---

async function runQuery(sql, binds = {}, schema = null, executeExtra = {}) {
  let conn;
  const extra = executeExtra && typeof executeExtra === 'object' ? executeExtra : {};
  const { suppressDbErrorLog = false, hubOverride = null, ...oracleExecuteExtra } = extra;
  const hubCfg =
    hubOverride && typeof hubOverride === 'object' && hubOverride.user != null ? hubOverride : activeDbConfig;
  try {
    const compUid = isEffectiveCompUid(schema) ? String(schema).trim() : null;
    const connCfg = compUid
      ? {
          user: compUid,
          password: compUid,
          connectString: activeDbConfig.connectString,
        }
      : hubCfg;

    conn = await getDbConnection(connCfg);

    const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT, ...oracleExecuteExtra };
    const result = await conn.execute(sql, binds, opts);
    return result.rows;
  } catch (err) {
    if (!suppressDbErrorLog) {
      console.error("❌ DB EXECUTION ERROR:", err.message);
    }
    throw err;
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error(e); }
    }
  }
}

// Consolidated Trading closing stock override (avoids schema-specific CLSTOCK write issues).
// Key format: "<comp_code>|<comp_uid>"
const tradingConsolidateOverride = new Map();
const startupCache = {
  companyByCode: new Map(),
  yearsByCompCode: new Map(),
  ttlMs: 2 * 60 * 1000,
};

function getStartupCached(map, key) {
  const item = map.get(key);
  if (!item) return null;
  if (Date.now() > item.expireAt) {
    map.delete(key);
    return null;
  }
  return item.value;
}

function setStartupCached(map, key, value) {
  map.set(key, { value, expireAt: Date.now() + startupCache.ttlMs });
}

/** True when connected as the configured primary hub user (e.g. DAL), before optional secondary-hub login retry. */
function isPrimaryHubUser(connCfg) {
  const u = String((connCfg || activeDbConfig).user || '').toUpperCase();
  const primary = String(DB_PRIMARY.user || '').toUpperCase();
  return primary !== '' && u === primary;
}

function isUnknownUsersColumnError(err) {
  const msg = String(err?.message || '');
  return msg.includes('ORA-00904') || /invalid identifier/i.test(msg);
}

function isLoginOptionalTableError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('ORA-00942') ||
    msg.includes('ORA-00904') ||
    /table or view does not exist/i.test(msg) ||
    /invalid identifier/i.test(msg)
  );
}

/**
 * App login: USERS (and optional schema-qualified USERS for legacy installs).
 */
async function lookupAppLoginRows(connCfg, user_name, pw) {
  const binds = { u: user_name, p: pw };
  const predStd = `UPPER(TRIM(USER_NAME)) = UPPER(TRIM(:u)) AND UPPER(TRIM(PW)) = UPPER(TRIM(:p))`;
  const tablesStd = ['USERS'];
  for (const t of tablesStd) {
    try {
      const sql = `SELECT USER_NAME, PW, COMP_CODE FROM ${t} WHERE ${predStd}`;
      const rows = await runQuery(sql, binds, null, { hubOverride: connCfg, suppressDbErrorLog: true });
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }
  }

  const predAlt = `UPPER(TRIM(USERNAME)) = UPPER(TRIM(:u)) AND UPPER(TRIM(PW)) = UPPER(TRIM(:p))`;
  const tablesAlt = ['USERS'];
  for (const t of tablesAlt) {
    try {
      const sql = `SELECT USERNAME AS USER_NAME, PW, COMP_CODE FROM ${t} WHERE ${predAlt}`;
      const rows = await runQuery(sql, binds, null, { hubOverride: connCfg, suppressDbErrorLog: true });
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }
  }

  return [];
}

/** USERS.COMP_CODE lookup (USER_NAME / USERNAME variants). */
async function lookupAuthorizedCompanyCode(connCfg, user_name) {
  const u = String(user_name || '').trim().toUpperCase();
  if (!u) return '';
  const binds = { u };
  const predStd = `UPPER(TRIM(USER_NAME)) = UPPER(TRIM(:u))`;
  const predAlt = `UPPER(TRIM(USERNAME)) = UPPER(TRIM(:u))`;
  const tables = ['USERS'];

  for (const t of tables) {
    try {
      const rows = await runQuery(`SELECT COMP_CODE FROM ${t} WHERE ${predStd}`, binds, null, {
        hubOverride: connCfg,
        suppressDbErrorLog: true,
      });
      const cc = rows?.[0]?.COMP_CODE ?? rows?.[0]?.comp_code ?? '';
      const s = String(cc || '').trim();
      if (s) return s;
      if (Array.isArray(rows) && rows.length > 0) return '';
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }
  }

  for (const t of tables) {
    try {
      const rows = await runQuery(`SELECT COMP_CODE FROM ${t} WHERE ${predAlt}`, binds, null, {
        hubOverride: connCfg,
        suppressDbErrorLog: true,
      });
      const cc = rows?.[0]?.COMP_CODE ?? rows?.[0]?.comp_code ?? '';
      const s = String(cc || '').trim();
      if (s) return s;
      if (Array.isArray(rows) && rows.length > 0) return '';
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }
  }

  return '';
}

async function fetchCompanyListRows(compCode = '') {
  const code = String(compCode || '').trim();
  if (code) {
    const sqlCandidates = [
      `SELECT COMP_NAME, COMP_CODE FROM COMPANY WHERE COMP_CODE = :comp_code`,
      `SELECT COMP_NAME, COMP_CODE FROM COMPDET WHERE COMP_CODE = :comp_code GROUP BY COMP_NAME, COMP_CODE`,
    ];
    let lastErr = null;
    for (const sql of sqlCandidates) {
      try {
        return await runQuery(sql, { comp_code: code }, null, { suppressDbErrorLog: true });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Company query failed');
  }

  const sqlCandidates = [
    `SELECT COMP_NAME, COMP_CODE FROM COMPANY ORDER BY COMP_CODE`,
    `SELECT COMP_CODE, COMP_NAME FROM COMPDET GROUP BY COMP_CODE, COMP_NAME ORDER BY COMP_CODE`,
  ];
  let lastErr = null;
  for (const sql of sqlCandidates) {
    try {
      return await runQuery(sql, {}, null, { suppressDbErrorLog: true });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Company list query failed');
}

/** Buffers (e.g. BLOB) → base64 strings so res.json() is safe and the client can show QR. */
function normalizeRowBuffers(row) {
  if (!row || typeof row !== 'object') return;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (Buffer.isBuffer(v)) {
      row[k] = v.toString('base64');
    } else if (v instanceof Uint8Array && !(v instanceof Buffer)) {
      row[k] = Buffer.from(v).toString('base64');
    }
  }
}

/** Merge QR payload from alternate column names (quoted identifiers / driver casing). */
function normalizeSignedQrColumn(row) {
  if (!row || typeof row !== 'object') return;
  let pick = row.SIGNED_QR_CODE;
  if (pick != null && typeof pick === 'object' && typeof pick.getData === 'function') pick = null;
  for (const [k, val] of Object.entries(row)) {
    if (val == null || val === '') continue;
    if (typeof val === 'object' && typeof val.getData === 'function') continue;
    const kl = k.toLowerCase();
    const compact = kl.replace(/_/g, '');
    if (
      kl === 'signed_qr_code' ||
      k === 'signed_Qr_code' ||
      compact === 'signedqrcode' ||
      (kl.includes('signed') && kl.includes('qr')) ||
      (compact.includes('signed') && compact.includes('qr')) ||
      (kl.includes('einvoice') && kl.includes('qr'))
    ) {
      if (pick == null || pick === '') pick = val;
    }
  }
  if (pick != null && pick !== '') row.SIGNED_QR_CODE = pick;
}

function rowValueCI(row, logicalName) {
  if (!row || logicalName == null) return null;
  const want = String(logicalName).toLowerCase();
  for (const k of Object.keys(row)) {
    if (String(k).toLowerCase() === want) return row[k];
  }
  return null;
}

/** True if an optional single-row SELECT has at least one non-blank column (skip all-null SALE_B_TYPE matches). */
function oracleCaptionRowHasText(row) {
  if (!row || typeof row !== 'object') return false;
  for (const v of Object.values(row)) {
    if (v == null || v === '') continue;
    if (v instanceof Date) continue;
    if (typeof v === 'object') continue;
    if (String(v).trim() !== '') return true;
  }
  return false;
}

function isOptionalPrintSqlError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('ORA-00942') ||
    msg.includes('ORA-00904') ||
    /table or view does not exist/i.test(msg) ||
    /invalid identifier/i.test(msg)
  );
}

/** Optional metadata probes are best-effort; keep logs quiet unless explicitly enabled. */
function optionalPrintWarnEnabled() {
  const v = String(process.env.OPTIONAL_PRINT_WARN ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

async function runOptionalSingleRow(sql, binds, schemaAttempts = []) {
  const attempts = Array.isArray(schemaAttempts) ? schemaAttempts : [schemaAttempts];
  let lastErr = null;
  for (const schema of attempts) {
    try {
      const rows = await runQuery(sql, binds, schema, { suppressDbErrorLog: true });
      return rows[0] ?? null;
    } catch (err) {
      lastErr = err;
      if (!isOptionalPrintSqlError(err)) throw err;
    }
  }
  if (lastErr && optionalPrintWarnEnabled()) {
    console.warn('⚠️ Optional print metadata query skipped:', lastErr.message);
  }
  return null;
}

/**
 * Sale bill “dispatch / godown caption” merged into `/api/sale-bill-print` lines (Fox `god_add1`, … UI “Dispatch From”).
 * Fox: SALE_B_TYPE G when NVL(TRIM(SALE.B_TYPE)) = GOD_B_TYPE — GOD_* + GOD_FSSAI_NO. Prefer G before PLANT probes.
 * Optional PLANT by PLANT_CODE (FSSAI on PLANT is optional — project as CAST NULL when column absent).
 * Last resort GODOWN.
 */
async function fetchSaleBillDispatchCaptionRow(comp_code, plant_code_raw, b_type_raw, comp_uid) {
  const pc = plant_code_raw != null ? String(plant_code_raw).trim() : '';
  const bt = b_type_raw != null ? String(b_type_raw).trim() : '';
  const schemas = [comp_uid, null];
  /** Oracle rejects extra bind keys (ORA-01036): each statement gets only its placeholders. */
  const plantBinds = { comp_code, plant_code: pc || ' ' };
  const saleBTypeBinds = { comp_code, b_type: bt || ' ' };

  if (bt !== '') {
    const saleBTypeCaptionSql = `
      SELECT G.GOD_ADD1 AS god_add1, G.GOD_ADD2 AS god_add2, G.GOD_GST_NO AS god_gst_no, G.GOD_STATE AS god_state,
             G.GOD_TEL_NO_1 AS god_tel_no_1, G.GOD_TEL_NO_2 AS god_tel_no_2, G.GOD_FSSAI_NO AS god_fssai_no
      FROM SALE_B_TYPE G
      WHERE G.COMP_CODE = :comp_code
        AND NVL(TRIM(G.GOD_B_TYPE), ' ') = NVL(TRIM(:b_type), ' ')
        AND ROWNUM = 1`;
    const gRow = await runOptionalSingleRow(saleBTypeCaptionSql, saleBTypeBinds, schemas);
    if (gRow != null && Object.keys(gRow).length > 0 && oracleCaptionRowHasText(gRow)) return gRow;
  }

  /** PLANT: avoid GOD_FSSAI_NO / PLANT_FSSAI_NO — many schemas only expose FSSAI on SALE_B_TYPE. */
  if (pc !== '') {
    const plantVariants = [
      `SELECT god_add1, god_add2, god_gst_no, god_tel_no_1, god_tel_no_2,
              CAST(NULL AS VARCHAR2(120)) AS god_fssai_no
       FROM PLANT
       WHERE comp_code = :comp_code
         AND NVL(TRIM(plant_code), ' ') = NVL(TRIM(:plant_code), ' ')
         AND ROWNUM = 1`,
      `SELECT plant_add1 AS god_add1, plant_add2 AS god_add2, plant_gst_no AS god_gst_no,
              plant_tel_no_1 AS god_tel_no_1, plant_tel_no_2 AS god_tel_no_2,
              CAST(NULL AS VARCHAR2(120)) AS god_fssai_no
       FROM PLANT
       WHERE comp_code = :comp_code
         AND NVL(TRIM(plant_code), ' ') = NVL(TRIM(:plant_code), ' ')
         AND ROWNUM = 1`,
      `SELECT add1 AS god_add1, add2 AS god_add2, gst_no AS god_gst_no,
              tel_no_1 AS god_tel_no_1, tel_no_2 AS god_tel_no_2,
              CAST(NULL AS VARCHAR2(120)) AS god_fssai_no
       FROM PLANT
       WHERE comp_code = :comp_code
         AND NVL(TRIM(plant_code), ' ') = NVL(TRIM(:plant_code), ' ')
         AND ROWNUM = 1`,
    ];
    for (const sql of plantVariants) {
      const row = await runOptionalSingleRow(sql, plantBinds, schemas);
      if (row != null && Object.keys(row).length > 0) return row;
    }
  }

  const godBinds = { comp_code, b_type: bt || ' ', god_code: pc || ' ' };
  const godownSql = `
    SELECT god_add1, god_add2, god_gst_no, god_tel_no_1, god_tel_no_2, god_fssai_no
    FROM godown
    WHERE comp_code = :comp_code
      AND NVL(TRIM(god_b_type), ' ') = NVL(TRIM(:b_type), ' ')
      AND NVL(TRIM(god_code), ' ') = NVL(TRIM(:god_code), ' ')
      AND ROWNUM = 1`;
  return await runOptionalSingleRow(godownSql, godBinds, schemas);
}

/**
 * COMPDET row: VFP uses COMP_CODE + COMP_YEAR; web also resolves by COMP_UID hub year.
 * @param {string|undefined} comp_year_opt  Oracle COMP_YEAR (login year / G_COMPYEAR).
 */
async function runCompdetHeaderRow(comp_code, comp_uid, comp_year_opt) {
  const cu = String(comp_uid ?? '').trim();
  const cyRaw =
    comp_year_opt != null && String(comp_year_opt).trim() !== '' ? Number(String(comp_year_opt).trim()) : NaN;
  const cyOk = Number.isFinite(cyRaw) && cyRaw > 0;

  const sqlYearUid = `
    SELECT * FROM (
      SELECT *
      FROM compdet
      WHERE comp_code = :comp_code
        AND NVL(comp_year, 0) = :comp_year
        AND TRIM(TO_CHAR(comp_uid)) = :comp_uid
      ORDER BY comp_uid DESC NULLS LAST
    ) WHERE ROWNUM = 1`;
  const sqlYearOnly = `
    SELECT * FROM (
      SELECT *
      FROM compdet
      WHERE comp_code = :comp_code
        AND NVL(comp_year, 0) = :comp_year
      ORDER BY comp_uid DESC NULLS LAST
    ) WHERE ROWNUM = 1`;

  const sqlExact = `
    SELECT
      *
    FROM compdet
    WHERE comp_code = :comp_code
      AND TRIM(TO_CHAR(comp_uid)) = :comp_uid`;
  const sqlLatest = `
    SELECT * FROM (
      SELECT
        *
      FROM compdet
      WHERE comp_code = :comp_code
      ORDER BY comp_year DESC NULLS LAST
    ) WHERE ROWNUM = 1`;

  const schemaAttempts = [comp_uid, null];

  if (cyOk) {
    for (const schema of schemaAttempts) {
      try {
        const rows = await runQuery(sqlYearUid, { comp_code, comp_year: cyRaw, comp_uid: cu }, schema);
        if (rows?.[0]) return rows[0];
      } catch (err) {
        if (!isOptionalPrintSqlError(err)) throw err;
      }
      try {
        const rows = await runQuery(sqlYearOnly, { comp_code, comp_year: cyRaw }, schema);
        if (rows?.[0]) return rows[0];
      } catch (err) {
        if (!isOptionalPrintSqlError(err)) throw err;
      }
    }
  }

  for (const schema of schemaAttempts) {
    try {
      const rows = await runQuery(sqlExact, { comp_code, comp_uid: cu }, schema);
      if (rows && rows[0]) return rows[0];
    } catch (err) {
      if (!isOptionalPrintSqlError(err)) throw err;
    }
    try {
      const rows = await runQuery(sqlLatest, { comp_code }, schema);
      if (rows && rows[0]) return rows[0];
    } catch (err) {
      if (!isOptionalPrintSqlError(err)) throw err;
    }
  }
  return null;
}

/** Sale / tax invoice print images: always from defvalue, never from compdet or SALE row blobs */
const SALE_PRINT_IMAGE_FIELD_LC = new Set(['sale_logo', 'sale_logo2', 'signature_file']);

function stripSalePrintImageFields(row) {
  if (!row || typeof row !== 'object') return;
  for (const k of Object.keys(row)) {
    if (SALE_PRINT_IMAGE_FIELD_LC.has(String(k).toLowerCase())) {
      delete row[k];
    }
  }
}

const DEFVALUE_SALE_PRINT_IMAGES_SQL = `
  SELECT sale_logo, sale_logo2, signature_file
  FROM defvalue
  WHERE comp_code = :comp_code
    AND ROWNUM = 1`;

/** Read logo/signature BLOBs from defvalue (company-wide) and assign onto targetRow */
async function mergeDefvalueSalePrintImageBlobs(comp_code, targetRow, schemaAttempts) {
  if (!targetRow || !comp_code) return;
  const row = await runOptionalSingleRow(DEFVALUE_SALE_PRINT_IMAGES_SQL, { comp_code }, schemaAttempts);
  if (!row) return;
  await drainOracleLobsInRows([row]);
  normalizeRowBuffers(row);
  Object.assign(targetRow, row);
}

function numVal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** MASTER / LEDGER / CLSTOCK account CODE (Oracle NUMBER). Undefined = no filter; allows 0. */
function parseMasterCodeForSql(raw) {
  if (raw == null) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** BrokerOs range: plain number or leading letters stripped (e.g. B26001 → 26001, B00001 → 1). */
function parseBrokerOsRangeNum(raw) {
  const direct = parseMasterCodeForSql(raw);
  if (direct !== undefined) return direct;
  const s = String(raw ?? '').trim();
  if (s === '') return undefined;
  const stripped = s.replace(/^[^0-9]+/, '');
  if (stripped === '') return undefined;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : undefined;
}

function parseDateOnly(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  }
  const s = String(raw).trim();
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/** VFP: G_FIN_YEAR = yy(start year) || yy(end year) from COMP_S_DT / COMP_E_DT (e.g. 2526). */
function computeGFinYearFromCompdetRow(row) {
  if (!row || typeof row !== 'object') return '';
  const sdt = parseDateOnly(rowValueCI(row, 'comp_s_dt'));
  const edt = parseDateOnly(rowValueCI(row, 'comp_e_dt'));
  if (!sdt || !edt) return '';
  const y1 = sdt.getFullYear() % 100;
  const y2 = edt.getFullYear() % 100;
  return String(y1).padStart(2, '0') + String(y2).padStart(2, '0');
}

/** VFP globals from COMPDET row for sale bill (salepnt_gst_bos.frx). */
function enrichCompdetSalePrintGlobals(row) {
  if (!row || typeof row !== 'object') return;
  const tv = (logical) => {
    const v = rowValueCI(row, logical);
    if (v == null || v === '') return '';
    if (v instanceof Date) return '';
    if (typeof v === 'object') return '';
    return String(v).trim();
  };
  const sdt = parseDateOnly(rowValueCI(row, 'comp_s_dt'));
  const edt = parseDateOnly(rowValueCI(row, 'comp_e_dt'));
  row.G_FIN_YEAR = computeGFinYearFromCompdetRow(row);
  if (sdt && !Number.isNaN(sdt.getTime())) {
    row.G_SDATE = sdt.toISOString().slice(0, 10);
  }
  if (edt && !Number.isNaN(edt.getTime())) {
    row.G_EDATE = edt.toISOString().slice(0, 10);
  }
  row.G_COMPNAME = tv('comp_name');
  row.G_COMPADD1 = tv('comp_add1');
  row.G_COMPADD2 = tv('comp_add2');
  row.G_COMPTIN = tv('comp_tin');
  row.G_COMPPAN = tv('comp_pan');
  row.G_COMPTEL1 = tv('comp_tel1');
  row.G_COMPTEL2 = tv('comp_tel2');
  row.G_COMPTEL3 = tv('comp_tel3');
  row.G_MOBILE = row.G_COMPTEL2 || tv('mobile');
  row.G_EMAIL = tv('comp_email');
  row.G_BANK_AC_NO = tv('bank_ac_no');
  const mp = tv('marka_prn');
  row.G_MARKA_PRN = mp || 'N';
  row.G_CIN_NO = tv('cin_no');
  row.G_COMP_GST_NO = tv('gst_no');
  row.G_COMP_STATE = tv('state');
  row.G_COMP_STATE_CODE = tv('state_code');
  row.G_SIGNATURE_FILE = tv('signature_file');
  row.G_MSME_NO = tv('msme_no');
  row.G_BANK_AC_NO2 = tv('bank_ac_no2');
  row.G_UDYAM_NO = tv('udyam_no');
}

function diffDays(endDate, startDate) {
  const e = parseDateOnly(endDate);
  const s = parseDateOnly(startDate);
  if (!e || !s) return 0;
  return Math.max(0, Math.floor((e.getTime() - s.getTime()) / 86400000));
}

function approxSchedule(value, target) {
  return Math.abs(numVal(value) - numVal(target)) < 0.0001;
}

function makeAgeingRanges(input) {
  const src = Array.isArray(input) ? input : [];
  return src.map((pair, idx) => {
    const from = numVal(pair?.from);
    const toRaw = pair?.to;
    const to = toRaw == null || toRaw === '' ? from : numVal(toRaw);
    return {
      idx,
      from: Math.max(0, Math.floor(from)),
      to: Math.max(Math.floor(to), Math.max(0, Math.floor(from))),
    };
  });
}

/** Normalise comp_uid from compdet / Oracle row for comparison */
function normCompUidFromRow(r) {
  const u = r?.comp_uid ?? r?.COMP_UID;
  if (u == null) return '';
  return String(u).trim();
}

/** Ordered ascending by financial year so the row before the selected comp_uid is the previous year */
async function fetchCompdetYearsOrderedAsc(comp_code, schemaHint) {
  const sql = `
    SELECT comp_uid, comp_year, comp_s_dt, comp_e_dt
    FROM compdet
    WHERE comp_code = :comp_code
    ORDER BY NVL(comp_year, 0) ASC, comp_s_dt ASC NULLS LAST`;
  const attempts = [];
  for (const s of [schemaHint, null]) {
    if (!attempts.includes(s)) attempts.push(s);
  }
  for (const schema of attempts) {
    try {
      const rows = await runQuery(
        sql,
        { comp_code },
        isEffectiveCompUid(schema) ? schema : null,
        { suppressDbErrorLog: true }
      );
      if (rows && rows.length) return rows;
    } catch (_) {
      /* try next schema */
    }
  }
  return [];
}

/** Previous year's Oracle schema (comp_uid) for the same company, or null */
async function resolvePreviousCompUid(comp_code, comp_uid) {
  const target = String(comp_uid ?? '').trim();
  if (!comp_code || !target) return null;
  const rows = await fetchCompdetYearsOrderedAsc(comp_code, comp_uid);
  const idx = rows.findIndex((r) => normCompUidFromRow(r) === target);
  if (idx <= 0) return null;
  const prev = rows[idx - 1];
  const pu = normCompUidFromRow(prev);
  return pu && pu !== target ? pu : null;
}

const AGEING_LEDGER_OP_EXCLUDE = `AND NVL(UPPER(TRIM(A.VR_TYPE)), ' ') <> 'OP'`;

/** Merge prior-year + current-year ledger lines for ageing (FIFO order). */
async function fetchAgeingLedgerRawRowsMerged({ comp_code, comp_uid, e_date, scheduleNum, codeFilter }) {
  const prevUid = await resolvePreviousCompUid(comp_code, comp_uid);
  const binds = { comp_code, e_date, schedule: scheduleNum };
  const codeN = parseMasterCodeForSql(codeFilter);
  const codeClause = codeN !== undefined ? `AND A.CODE = :code` : '';
  if (codeClause) binds.code = codeN;

  const baseSelect = `
        SELECT
          A.CODE,
          B.NAME,
          B.CITY,
          A.VR_TYPE,
          A.VR_DATE,
          A.VR_NO,
          NVL(A.DR_AMT,0) DR_AMT,
          NVL(A.CR_AMT,0) CR_AMT`;

  const detailCol = codeClause
    ? `,
          A.DETAIL`
    : '';

  const fromWhere = `
        FROM LEDGER A, MASTER B
        WHERE A.COMP_CODE = :comp_code
          AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
          ${codeClause}
          AND A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
          AND ROUND(NVL(B.SCHEDULE,0), 2) = :schedule`;

  const orderSummary = `ORDER BY B.NAME, A.CODE, A.VR_DATE, A.VR_NO, A.VR_TYPE`;
  const orderDetail = `ORDER BY A.VR_DATE, A.VR_NO, A.VR_TYPE`;

  const currentYearOpClause = prevUid ? AGEING_LEDGER_OP_EXCLUDE : '';

  const sqlCur = `${baseSelect}${detailCol}
        ${fromWhere}
          ${currentYearOpClause}
        ${codeClause ? orderDetail : orderSummary}`;

  const sqlPrev = `${baseSelect}${detailCol}
        ${fromWhere}
        ${codeClause ? orderDetail : orderSummary}`;

  const curRows = (await runQuery(sqlCur, binds, comp_uid)) || [];
  let prevRows = [];
  if (prevUid) {
    prevRows = (await runQuery(sqlPrev, binds, prevUid)) || [];
  }

  const merged = [...prevRows, ...curRows];
  const sortFn = codeClause ? cmpLedgerAgeingDetailMerge : cmpLedgerAgeingSummaryMerge;
  merged.sort(sortFn);
  return merged;
}

function cmpLedgerAgeingSummaryMerge(a, b) {
  const nameA = String(a.NAME ?? a.name ?? '');
  const nameB = String(b.NAME ?? b.name ?? '');
  const cn = nameA.localeCompare(nameB);
  if (cn !== 0) return cn;
  const codeA = String(a.CODE ?? a.code ?? '');
  const codeB = String(b.CODE ?? b.code ?? '');
  const cc = codeA.localeCompare(codeB);
  if (cc !== 0) return cc;
  const da = parseDateOnly(a.VR_DATE ?? a.vr_date);
  const db = parseDateOnly(b.VR_DATE ?? b.vr_date);
  const ta = da ? da.getTime() : 0;
  const tb = db ? db.getTime() : 0;
  if (ta !== tb) return ta - tb;
  const na = numVal(a.VR_NO ?? a.vr_no);
  const nb = numVal(b.VR_NO ?? b.vr_no);
  if (na !== nb) return na - nb;
  return String(a.VR_TYPE ?? a.vr_type ?? '').localeCompare(String(b.VR_TYPE ?? b.vr_type ?? ''));
}

function cmpLedgerAgeingDetailMerge(a, b) {
  const da = parseDateOnly(a.VR_DATE ?? a.vr_date);
  const db = parseDateOnly(b.VR_DATE ?? b.vr_date);
  const ta = da ? da.getTime() : 0;
  const tb = db ? db.getTime() : 0;
  if (ta !== tb) return ta - tb;
  const na = numVal(a.VR_NO ?? a.vr_no);
  const nb = numVal(b.VR_NO ?? b.vr_no);
  if (na !== nb) return na - nb;
  return String(a.VR_TYPE ?? a.vr_type ?? '').localeCompare(String(b.VR_TYPE ?? b.vr_type ?? ''));
}

function ageingBucketIndex(days, ranges) {
  const d = Math.max(0, Math.floor(numVal(days)));
  for (let i = 0; i < ranges.length; i += 1) {
    if (d >= ranges[i].from && d <= ranges[i].to) return i;
  }
  return ranges.length - 1;
}

function emptyAgeingBucketObject(ranges) {
  const out = {};
  ranges.forEach((_, idx) => {
    out[`RANGE_${idx + 1}`] = 0;
  });
  return out;
}

function buildAgeingLedgerResiduals(rows, explicitCreditMode = null) {
  const totalDr = (rows || []).reduce((sum, row) => sum + numVal(row.DR_AMT ?? row.dr_amt), 0);
  const totalCr = (rows || []).reduce((sum, row) => sum + numVal(row.CR_AMT ?? row.cr_amt), 0);
  const isCreditMode =
    explicitCreditMode == null ? totalCr > totalDr : Boolean(explicitCreditMode);
  let offsetPool = isCreditMode ? totalDr : totalCr;
  const residuals = [];
  for (const row of rows || []) {
    const targetAmt = isCreditMode ? numVal(row.CR_AMT ?? row.cr_amt) : numVal(row.DR_AMT ?? row.dr_amt);
    if (targetAmt <= 0) continue;
    if (offsetPool >= targetAmt) {
      offsetPool -= targetAmt;
      continue;
    }
    const pendingBal = targetAmt - offsetPool;
    offsetPool = 0;
    residuals.push({
      ...row,
      PENDING_BAL: pendingBal,
    });
  }
  return residuals;
}

/**
 * Ledger ageing visibility by schedule (natural balance sign from net DR−CR on included lines):
 * - Schedule 8.10: hide accounts with net balance &lt; 0 (credit / wrong side for debtors).
 * - Other schedules: hide accounts with net balance &gt; 0 (debit / wrong side for creditors).
 */
function shouldShowAgeingLedgerSummaryRow(scheduleNum, netDrMinusCr) {
  const bal = numVal(netDrMinusCr);
  const is810 = Math.round(numVal(scheduleNum) * 100) / 100 === 8.1;
  if (is810) return bal >= -1e-4;
  return bal <= 1e-4;
}

function netDrMinusCrFromLedgerLines(sourceRows) {
  return (sourceRows || []).reduce(
    (s, r) => s + numVal(r.DR_AMT ?? r.dr_amt) - numVal(r.CR_AMT ?? r.cr_amt),
    0
  );
}

function buildAgeingLedgerRows(rows, endDate, ranges, isCreditMode, scheduleNum = null) {
  const grouped = new Map();
  for (const row of rows || []) {
    const code = String(row.CODE ?? row.code ?? '').trim();
    if (!code) continue;
    if (!grouped.has(code)) {
      grouped.set(code, {
        CODE: code,
        NAME: row.NAME ?? row.name ?? '',
        CITY: row.CITY ?? row.city ?? '',
        sourceRows: [],
      });
    }
    const grp = grouped.get(code);
    grp.sourceRows.push(row);
  }

  return Array.from(grouped.values())
    .map((grp) => {
      const netDrMinusCr = netDrMinusCrFromLedgerLines(grp.sourceRows);
      const buckets = emptyAgeingBucketObject(ranges);
      let curBal = 0;
      const residuals = buildAgeingLedgerResiduals(grp.sourceRows, isCreditMode);
      residuals.forEach((item) => {
        const amt = numVal(item.PENDING_BAL);
        if (amt <= 0.0001) return;
        curBal += amt;
        const bIdx = ageingBucketIndex(diffDays(endDate, item.VR_DATE ?? item.vr_date), ranges);
        buckets[`RANGE_${bIdx + 1}`] += amt;
      });
      const row = { CODE: grp.CODE, NAME: grp.NAME, CITY: grp.CITY, CUR_BAL: curBal, ...buckets };
      if (scheduleNum == null) {
        return curBal > 0.0001 ? row : null;
      }
      if (!shouldShowAgeingLedgerSummaryRow(scheduleNum, netDrMinusCr)) return null;
      return curBal > 0.0001 ? row : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.NAME).localeCompare(String(b.NAME)) || String(a.CODE).localeCompare(String(b.CODE)));
}

function buildAgeingLedgerDetailRows(rows, isCreditMode) {
  return buildAgeingLedgerResiduals(rows, isCreditMode);
}

function buildAgeingBillRows(rows, endDate, ranges) {
  const grouped = new Map();
  (rows || []).forEach((row) => {
    const code = String(row.CODE ?? row.code ?? '').trim();
    if (!code) return;
    if (!grouped.has(code)) {
      grouped.set(code, {
        CODE: code,
        NAME: row.NAME ?? row.name ?? '',
        CITY: row.CITY ?? row.city ?? '',
        CUR_BAL: 0,
        ...emptyAgeingBucketObject(ranges),
      });
    }
    const out = grouped.get(code);
      const curBal = numVal(row.CUR_BAL ?? row.cur_bal ?? (numVal(row.DR_AMT ?? row.dr_amt) - numVal(row.CR_AMT ?? row.cr_amt)));
    if (curBal <= 0.0001) return;
    out.CUR_BAL += curBal;
    const bIdx = ageingBucketIndex(diffDays(endDate, row.BILL_DATE ?? row.bill_date ?? row.VR_DATE ?? row.vr_date), ranges);
    out[`RANGE_${bIdx + 1}`] += curBal;
  });
  return Array.from(grouped.values())
    .filter((row) => row.CUR_BAL > 0.0001)
    .sort((a, b) => String(a.NAME).localeCompare(String(b.NAME)) || String(a.CODE).localeCompare(String(b.CODE)));
}

function guessImageMimeFromPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function likelyBase64Image(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(s) || s.length < 32) return false;
  try {
    const compact = s.replace(/\s+/g, '');
    const buf = Buffer.from(compact, 'base64');
    if (!buf || buf.length < 4) return false;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true; // GIF
    if (
      buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    ) return true; // WEBP
    const textHead = buf.subarray(0, Math.min(buf.length, 64)).toString('utf8').trimStart();
    if (textHead.startsWith('<svg')) return true; // SVG
    return false;
  } catch (_) {
    return false;
  }
}

function buildImageCandidatePaths(rawPath) {
  const s = String(rawPath || '').trim();
  if (!s) return [];
  const normalized = s.replace(/\//g, path.sep).replace(/\\/g, path.sep);
  const fileName = path.basename(normalized);
  const workspaceRoot = __dirname;
  const appRoot = FAS_PARENT_ROOT;
  const commonFolders = [
    workspaceRoot,
    appRoot,
    path.join(workspaceRoot, 'public'),
    path.join(appRoot, 'public'),
    path.join(appRoot, 'images'),
    path.join(appRoot, 'image'),
    path.join(appRoot, 'img'),
    path.join(appRoot, 'logo'),
    path.join(appRoot, 'logos'),
    path.join(workspaceRoot, 'images'),
    path.join(workspaceRoot, 'image'),
    path.join(workspaceRoot, 'img'),
    path.join(workspaceRoot, 'logo'),
    path.join(workspaceRoot, 'logos'),
  ];
  const candidates = [];
  candidates.push(normalized);
  candidates.push(path.resolve(workspaceRoot, normalized));
  candidates.push(path.resolve(appRoot, normalized));
  for (const folder of commonFolders) {
    candidates.push(path.join(folder, normalized));
    candidates.push(path.join(folder, fileName));
  }
  return Array.from(new Set(candidates));
}

function resolveExistingImagePath(rawPath) {
  const candidates = buildImageCandidatePaths(rawPath);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (_) {
      // keep trying
    }
  }
  return null;
}

function getRowCiFieldName(row, logicalName) {
  if (!row || !logicalName) return null;
  const want = String(logicalName).toLowerCase();
  for (const k of Object.keys(row)) {
    if (String(k).toLowerCase() === want) return k;
  }
  return null;
}

async function hydrateImageFieldInRows(rows, logicalName) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  for (const row of rows) {
    const fieldName = getRowCiFieldName(row, logicalName);
    if (!fieldName) continue;
    const raw = row[fieldName];
    if (raw == null || raw === '') continue;
    const s = String(raw).trim();
    if (!s) continue;
    if (/^data:image\//i.test(s) || /^https?:\/\//i.test(s) || /^blob:/i.test(s)) continue;
    if (likelyBase64Image(s)) {
      row[fieldName] = `data:image/png;base64,${s.replace(/\s+/g, '')}`;
      continue;
    }
    const candidates = buildImageCandidatePaths(s);
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p)) continue;
        const buf = await fs.promises.readFile(p);
        row[fieldName] = `data:${guessImageMimeFromPath(p)};base64,${buf.toString('base64')}`;
        break;
      } catch (_) {
        // Try next candidate path.
      }
    }
    if (row[fieldName] === raw && /[./\\:]/.test(s)) {
      console.warn(`⚠️ Could not resolve ${logicalName} file path: ${s}`);
    }
  }
}

/** DEFVALUE merges the same logo paths onto every SALE line; disk reads only need to run once per bill. */
async function hydrateSaleBillPrintImagesOnce(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const first = rows[0];
  await hydrateImageFieldInRows([first], 'sale_logo');
  await hydrateImageFieldInRows([first], 'sale_logo2');
  await hydrateImageFieldInRows([first], 'signature_file');
  const fields = ['sale_logo', 'sale_logo2', 'signature_file'];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    for (const logical of fields) {
      const fk = getRowCiFieldName(first, logical);
      const rk = getRowCiFieldName(r, logical);
      if (fk && rk) r[rk] = first[fk];
    }
  }
}

app.get('/api/print-image', async (req, res) => {
  try {
    const rawPath = String(req.query.path || '').trim();
    if (!rawPath) return res.status(400).json({ error: 'path is required' });
    const resolved = resolveExistingImagePath(rawPath);
    if (!resolved) return res.status(404).json({ error: 'image file not found' });
    return res.sendFile(resolved);
  } catch (err) {
    console.error('❌ Print image error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * VFP: SALE.TYPE is numeric 1–9. Optional comma list (e.g. "3,1" for SL from ledger when DB uses 3 or 1).
 */
function parseSaleBillOracleTypeCandidates(oracleTypesRaw, typeStrRaw) {
  const raw = String(oracleTypesRaw ?? '').trim();
  if (raw) {
    const arr = raw
      .split(/[,; ]+/)
      .map((x) => parseInt(String(x).trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 9);
    if (arr.length) return [...new Set(arr)];
  }
  const t = String(typeStrRaw ?? '').trim();
  const u = t.toUpperCase();
  const n = parseInt(t, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 9) return [n];
  switch (u) {
    case 'CN':
      return [8];
    case 'SE':
      return [6];
    case 'CH':
      return [2];
    case 'RC':
      return [9];
    case 'SL':
    case 'S':
      // Retail (1) before tax invoice (3) — fewer wasted probes when oracle_types is omitted.
      return [1, 3];
    case 'Y':
      // Legacy stock ledger “Y” vouchers: probe common SALE.TYPE buckets if DB stores numeric type.
      return [3, 1, 4, 7];
    case 'W':
      // Stock credit-note style row: SALE often CN (8), returns (4–5), or voucher char type.
      return [8, 4, 5, 1, 3];
    default:
      return [];
  }
}

function saleBillQrFragmentsForTypeNum(saleTypeNum, taxNonZero, signedColAttempts) {
  const stn = Number(saleTypeNum);
  const useQr = stn === 3 || stn === 6 || stn === 9;
  if (!useQr) return ['CAST(NULL AS VARCHAR2(4000)) AS SIGNED_QR_CODE'];
  return signedColAttempts.map(
    (col) => `CASE WHEN ${taxNonZero} THEN ${col} ELSE CAST(NULL AS VARCHAR2(4000)) END AS SIGNED_QR_CODE`
  );
}

/**
 * Single-bill sale print SQL. VFP parity: A=SALE, B=party MASTER, C=broker MASTER (+), D=ITEMMAST, E=DELV MASTER (+),
 * F_OTH = other-charge MASTER on ADD_CODE (+), W–Z only when selecting OTH_EXP names (disOthMode=both).
 * Dispatch caption lines come from `/api/sale-bill-print` PLANT merge (GODOWN fallback for older DBs; Fox SALE_B_TYPE G parity).
 * disOthMode: 'both' | 'othQuoted' | 'none'; typeMatch: 'numeric' | 'varchar'
 */
function buildSaleBillPrintSql(qrSelectFragment, disOthMode, typeMatch, extraSaleLineCols, relaxBillDate = false) {
  let disOthLines = '';
  if (disOthMode === 'both') {
    disOthLines = `A.DIS_AMT,
        A.OTH_CD1,
        A.OTH_CD2,
        A.OTH_CD3,
        A.OTH_CD4,
        A.OTH_EXP1,
        A.OTH_EXP2,
        A.OTH_EXP3,
        A.OTH_EXP4,
        A.OTH_EXP5,
        W.NAME AS OTH_EXP_NAME1,
        X.NAME AS OTH_EXP_NAME2,
        Y.NAME AS OTH_EXP_NAME3,
        Z.NAME AS OTH_EXP_NAME4,
        `;
  } else if (disOthMode === 'othQuoted') {
    disOthLines = `A."oth_Exp5" AS OTH_EXP5,
        `;
  }
  const typeClause =
    typeMatch === 'numeric' ? `A.TYPE = :sale_type_num` : `UPPER(TRIM(A.TYPE)) = UPPER(TRIM(:type_char))`;

  const extraCols =
    extraSaleLineCols !== false ? `        A.V_DATE,\n        A.DAYS,\n        NVL(A.RATE_QW, 0) AS RATE_QW,\n` : '';

  /**
   * Optional: join MASTER for OTH_NAME via ADD_CODE (not all DBs benefit; extra join can worsen plans).
   * Enable: SALE_BILL_PRINT_JOIN_OTH_MASTER=1
   */
  const joinOthMaster = truthyEnv01(process.env.SALE_BILL_PRINT_JOIN_OTH_MASTER);
  const othNameJoinSnip = joinOthMaster
    ? `
      LEFT JOIN MASTER F_OTH ON A.COMP_CODE = F_OTH.COMP_CODE AND A.ADD_CODE = F_OTH.CODE`
    : '';
  const othNameSelect = joinOthMaster ? `F_OTH.NAME AS OTH_NAME` : `CAST(NULL AS VARCHAR2(500)) AS OTH_NAME`;

  const extPartyCols = `
        B.ADD3,
        B.TIN,
        B.TEL_NO_O,
        B.STATE,
        B.STATE_CODE,
        B.FSSAI_NO,
        B.BILL_COND,`;

  const extDelvCols = `
        E.ADD3 AS DELV_ADD3,
        E.TEL_NO_O AS DELV_TEL_NO_O,
        E.STATE AS DELV_STATE,
        E.STATE_CODE AS DELV_STATE_CODE,
        E.FSSAI_NO AS DELV_FSSAI_NO,`;

  /** VFP only uses W–Z for OTH_CD* labels; joining them on every probe was unnecessary work for the optimizer. */
  const masterOthCdJoinSnip =
    disOthMode === 'both'
      ? `
      LEFT JOIN MASTER W ON A.COMP_CODE = W.COMP_CODE AND A.OTH_CD1 = W.CODE
      LEFT JOIN MASTER X ON A.COMP_CODE = X.COMP_CODE AND A.OTH_CD2 = X.CODE
      LEFT JOIN MASTER Y ON A.COMP_CODE = Y.COMP_CODE AND A.OTH_CD3 = Y.CODE
      LEFT JOIN MASTER Z ON A.COMP_CODE = Z.COMP_CODE AND A.OTH_CD4 = Z.CODE`
      : '';

  return `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        ${saleBillPrintSalePlantCodeSql()},
        A.CODE,
        B.NAME,
        B.ADD1,
        B.ADD2,
${extPartyCols}
        B.CITY,
        B.PAN,
        B.GST_NO,
        A.DELV_CODE,
        E.NAME AS DELV_NAME,
        E.ADD1 AS DELV_ADD1,
        E.ADD2 AS DELV_ADD2,
${extDelvCols}
        E.CITY AS DELV_CITY,
        E.GST_NO AS DELV_GST_NO,
        E.PAN AS DELV_PAN,
        A.B_CODE,
        C.NAME AS BK_NAME,
        C.TEL_NO_O AS B_TEL_NO,
        ${othNameSelect},
        A.TRN_NO,
        A.ITEM_CODE,
        D.ITEM_NAME,
        D.HSN_CODE,
        D.UNIT_WGT,
        D.UNIT,
        D.BILL_PRINT_QW,
        ${saleBillPrintPackingColumnSql()},
        A.MARKA,
        A.STATUS,
        A.QNTY,
        ${saleBillPrintGdWeightColumnsSql()},
        A.WEIGHT,
${extraCols}        A.RATE,
        A.AMOUNT,
        A.DAMI_PER,
        A.DAMI,
        A.BK_AMT,
        A.TAXABLE,
        A.TAX_PER,
        A.TAX_AMT,
        A.TAX_TYPE,
        A.TAX_FORM,
        A.CGST_PER,
        A.CGST_AMT,
        A.SGST_PER,
        A.SGST_AMT,
        A.IGST_PER,
        A.IGST_AMT,
        A.DIS_PER,
        A.DIS_AMT,
        A.LP_AMT,
        A.LAB_AMT,
        A.BARD_AMT,
        A.FGT_AMT,
        A.INS_AMT,
        A.OTH_AMT,
        A.TCS_PER,
        A.TCS_AMT,
        A.FREIGHT,
        A.LABOUR,
        A.INS,
        A.OTH_EXP,
        A.BILL_AMT,
        A.TDS_PER,
        A.TDS_ON_AMT,
        A.TDS_AMT,
        A.PO_NO,
        A.SO_NO,
        A.RB_NO,
        A.RB_DATE,
        A.RB_TYPE,
        A.SALE_INV_NO,
        ${saleBillPrintSbRefundColumnsSql()},
        A.IRN_NO,
        A.ACK_NO,
        A.EWAY_NO,
        A.TRUCK_NO,
        A.TPT,
        A.GR_NO,
        A.DRIVER,
        A.DETAIL,
        A.POLICY_NO,
        A.CONTAINER_NO,
        A.SEAL_NO,
        ${disOthLines}${qrSelectFragment}
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.B_CODE = C.CODE
      JOIN ITEMMAST D ON A.COMP_CODE = D.COMP_CODE AND A.ITEM_CODE = D.ITEM_CODE
      LEFT JOIN MASTER E ON A.COMP_CODE = E.COMP_CODE AND A.DELV_CODE = E.CODE
      ${othNameJoinSnip}${masterOthCdJoinSnip}
      WHERE A.COMP_CODE = :comp_code
        AND ${typeClause}
        AND TRIM(TO_CHAR(A.BILL_NO)) = TRIM(TO_CHAR(:bill_no))
        AND NVL(TRIM(A.B_TYPE), ' ') = NVL(TRIM(:b_type), ' ')
        ${
          relaxBillDate
            ? ''
            : `AND A.BILL_DATE >= TO_DATE(:bill_date, 'DD-MM-YYYY')
        AND A.BILL_DATE < TO_DATE(:bill_date, 'DD-MM-YYYY') + 1`
        }
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
}

/** Fast probe path (matches former “Lean”: core joins only, no optional OTH-charge graphs). */
function buildSaleBillPrintSqlNano(qrSelectFragment, typeMatch, relaxBillDate = false) {
  const typeClause =
    typeMatch === 'numeric' ? `A.TYPE = :sale_type_num` : `UPPER(TRIM(A.TYPE)) = UPPER(TRIM(:type_char))`;
  return `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        ${saleBillPrintSalePlantCodeSql()},
        A.CODE,
        B.NAME,
        B.ADD1,
        B.ADD2,
        B.ADD3,
        B.TIN,
        B.TEL_NO_O,
        B.STATE,
        B.STATE_CODE,
        B.FSSAI_NO,
        B.BILL_COND,
        B.CITY,
        B.PAN,
        B.GST_NO,
        A.DELV_CODE,
        E.NAME AS DELV_NAME,
        E.ADD1 AS DELV_ADD1,
        E.ADD2 AS DELV_ADD2,
        E.ADD3 AS DELV_ADD3,
        E.TEL_NO_O AS DELV_TEL_NO_O,
        E.STATE AS DELV_STATE,
        E.STATE_CODE AS DELV_STATE_CODE,
        E.FSSAI_NO AS DELV_FSSAI_NO,
        E.CITY AS DELV_CITY,
        E.GST_NO AS DELV_GST_NO,
        E.PAN AS DELV_PAN,
        A.B_CODE,
        C.NAME AS BK_NAME,
        C.TEL_NO_O AS B_TEL_NO,
        CAST(NULL AS VARCHAR2(500)) AS OTH_NAME,
        A.TRN_NO,
        A.ITEM_CODE,
        D.ITEM_NAME,
        D.HSN_CODE,
        D.UNIT_WGT,
        D.UNIT,
        D.BILL_PRINT_QW,
        ${saleBillPrintPackingColumnSql()},
        A.MARKA,
        A.STATUS,
        A.QNTY,
        ${saleBillPrintGdWeightColumnsSql()},
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.DAMI_PER,
        A.DAMI,
        A.BK_AMT,
        A.TAXABLE,
        A.TAX_PER,
        A.TAX_AMT,
        A.TAX_TYPE,
        A.TAX_FORM,
        A.CGST_PER,
        A.CGST_AMT,
        A.SGST_PER,
        A.SGST_AMT,
        A.IGST_PER,
        A.IGST_AMT,
        A.DIS_PER,
        A.DIS_AMT,
        A.LP_AMT,
        A.LAB_AMT,
        A.BARD_AMT,
        A.FGT_AMT,
        A.INS_AMT,
        A.OTH_AMT,
        A.TCS_PER,
        A.TCS_AMT,
        A.FREIGHT,
        A.LABOUR,
        A.INS,
        A.OTH_EXP,
        A.BILL_AMT,
        A.TDS_PER,
        A.TDS_ON_AMT,
        A.TDS_AMT,
        A.PO_NO,
        A.SO_NO,
        A.RB_NO,
        A.RB_DATE,
        A.RB_TYPE,
        A.SALE_INV_NO,
        ${saleBillPrintSbRefundColumnsSql()},
        A.IRN_NO,
        A.ACK_NO,
        A.EWAY_NO,
        A.TRUCK_NO,
        A.TPT,
        A.GR_NO,
        A.DRIVER,
        A.DETAIL,
        A.POLICY_NO,
        A.CONTAINER_NO,
        A.SEAL_NO,
        ${qrSelectFragment}
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.B_CODE = C.CODE
      JOIN ITEMMAST D ON A.COMP_CODE = D.COMP_CODE AND A.ITEM_CODE = D.ITEM_CODE
      LEFT JOIN MASTER E ON A.COMP_CODE = E.COMP_CODE AND A.DELV_CODE = E.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${typeClause}
        AND TRIM(TO_CHAR(A.BILL_NO)) = TRIM(TO_CHAR(:bill_no))
        AND NVL(TRIM(A.B_TYPE), ' ') = NVL(TRIM(:b_type), ' ')
        ${
          relaxBillDate
            ? ''
            : `AND A.BILL_DATE >= TO_DATE(:bill_date, 'DD-MM-YYYY')
        AND A.BILL_DATE < TO_DATE(:bill_date, 'DD-MM-YYYY') + 1`
        }
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
}

async function runSaleBillPrintRows(binds, comp_uid) {
  const taxNonZero = '(NVL(A.CGST_AMT,0)+NVL(A.SGST_AMT,0)+NVL(A.IGST_AMT,0)) <> 0';
  /** Prefer unquoted identifier first — fewer probes when schema matches. */
  const signedColAttempts = [
    'A.SIGNED_QR_CODE',
    'A."SIGNED_QR_CODE"',
    'A."signed_QR_code"',
    'A."signed_qr_code"',
    'A."signed_Qr_code"',
  ];
  /**
   * Legacy Fox-era columns: quoted `oth_Exp5`, OTH_CD1–4, etc. Most Oracle SALE tables omit them — probing
   * throws ORA-00904 and pollutes lastErr. Default: `none` only.
   * SALE_BILL_PRINT_DIS_OTH_OTHQUOTED=1 → try `A."oth_Exp5" AS OTH_EXP5`
   * SALE_BILL_PRINT_DIS_OTH_BOTH=1 → also try OTH_CD* + OTH_EXP* + W–Z joins
   */
  const disOthProbeQuoted = truthyEnv01(process.env.SALE_BILL_PRINT_DIS_OTH_OTHQUOTED);
  const disOthProbeBoth = truthyEnv01(process.env.SALE_BILL_PRINT_DIS_OTH_BOTH);
  const disOthModes = ['none'];
  if (disOthProbeQuoted) disOthModes.push('othQuoted');
  if (disOthProbeBoth) disOthModes.push('both');
  const fullMatrixProbe = truthyEnv01(process.env.SALE_BILL_PRINT_FULL_MATRIX);
  const relaxBillDate = truthyEnv01(binds.relax_bill_date);
  /** When clauses omit :bill_date, binds must not include it — else ORA-01036 */
  const baseBinds = {
    comp_code: binds.comp_code,
    bill_no: String(binds.bill_no || '').trim(),
    b_type: binds.b_type != null ? String(binds.b_type).trim() : ' ',
    ...(relaxBillDate ? {} : { bill_date: binds.bill_date }),
  };
  const candidates = parseSaleBillOracleTypeCandidates(binds.oracle_types, binds.type);
  const typ = String(binds.type || '').trim().toUpperCase();
  const varcharType = typ && /^[A-Z]{1,4}$/.test(typ) ? typ : '';

  function qrFragmentsVarchar(typUpper) {
    return typUpper === 'SL' || typUpper === 'SE'
      ? signedColAttempts.map(
          (col) => `CASE WHEN ${taxNonZero} THEN ${col} ELSE CAST(NULL AS VARCHAR2(4000)) END AS SIGNED_QR_CODE`
        )
      : ['CAST(NULL AS VARCHAR2(4000)) AS SIGNED_QR_CODE'];
  }

  let lastErr;
  async function tryNano(typeMatch, queryBinds, qrFragments) {
    const timeoutOpts = saleBillPrintCallTimeoutOpts();
    const frags =
      Array.isArray(qrFragments) && qrFragments.length > 0
        ? qrFragments
        : ['CAST(NULL AS VARCHAR2(4000)) AS SIGNED_QR_CODE'];
    for (const frag of frags) {
      try {
        const sql = buildSaleBillPrintSqlNano(frag, typeMatch, relaxBillDate);
        const rows = await runQuery(sql, queryBinds, comp_uid, {
          suppressDbErrorLog: true,
          ...timeoutOpts,
        });
        if (Array.isArray(rows) && rows.length > 0) return rows;
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || '');
        if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw e;
      }
    }
    return null;
  }

  /** All variants share the same WHERE; first successful empty result means no bill — do not rescan. */
  async function runMatrix(typeMatch, queryBinds, qrFragments) {
    const timeoutOpts = saleBillPrintCallTimeoutOpts();
    const extraColOpts = fullMatrixProbe ? [false, true] : [false];
    const fragList =
      Array.isArray(qrFragments) && qrFragments.length > 0
        ? qrFragments
        : ['CAST(NULL AS VARCHAR2(4000)) AS SIGNED_QR_CODE'];
    probeVariants: for (const extraSaleLineCols of extraColOpts) {
      for (const dom of disOthModes) {
        for (const frag of fragList) {
          try {
            const sql = buildSaleBillPrintSql(frag, dom, typeMatch, extraSaleLineCols, relaxBillDate);
            const rows = await runQuery(sql, queryBinds, comp_uid, {
              suppressDbErrorLog: true,
              ...timeoutOpts,
            });
            if (Array.isArray(rows) && rows.length > 0) return rows;
            break probeVariants;
          } catch (e) {
            lastErr = e;
            const msg = String(e.message || '');
            if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw e;
          }
        }
      }
    }
    return null;
  }

  for (const stn of candidates) {
    const qrFrags = saleBillQrFragmentsForTypeNum(stn, taxNonZero, signedColAttempts);
    const numBinds = { ...baseBinds, sale_type_num: stn };
    let rows = await tryNano('numeric', numBinds, qrFrags);
    if (rows) return rows;
    rows = await runMatrix('numeric', numBinds, qrFrags);
    if (rows) return rows;
  }

  if (varcharType) {
    const vFrags = qrFragmentsVarchar(varcharType);
    const vchBinds = { ...baseBinds, type_char: varcharType };
    let rows = await tryNano('varchar', vchBinds, vFrags);
    if (rows) return rows;
    rows = await runMatrix('varchar', vchBinds, vFrags);
    if (rows) return rows;
  }

  if (lastErr) throw lastErr;
  throw new Error(
    'Sale bill print: no rows for this bill. Pass oracle_types (1–9) or a letter type (SL/SE/CN/…). Numeric SALE.TYPE must match.'
  );
}

/** oracledb 6 may return BLOB/CLOB as Lob; read to string/base64 before JSON. Thin mode may not pass instanceof Lob. */
async function drainOracleLobsInRows(rows) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (v == null || Buffer.isBuffer(v) || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        continue;
      if (v instanceof Date) continue;
      const hasGetData = typeof v.getData === 'function';
      const isLobClass = oracledb.Lob && v instanceof oracledb.Lob;
      if (!hasGetData && !isLobClass) continue;
      try {
        const data = await v.getData();
        if (data == null) continue;
        if (Buffer.isBuffer(data)) row[k] = data.toString('base64');
        else if (data instanceof Uint8Array) row[k] = Buffer.from(data).toString('base64');
        else row[k] = String(data);
      } catch (e) {
        console.error(`LOB read failed for column ${k}:`, e.message);
        row[k] = null;
      }
    }
  }
}

// --- ENDPOINTS ---

/** In-app update: enabled when deploy secret is set, or skip-key (env or deploy-update-no-key.txt). */
app.get('/api/deploy-update/status', (req, res) => {
  const skipKey = deployUpdateSkipKeyNow();
  const enabled = skipKey || (DEPLOY_UPDATE_SECRET && DEPLOY_UPDATE_SECRET.length >= 8);
  const requiresDeployKey = enabled && !skipKey;
  const recentLogLines = readDeployUpdateLogLines(10);
  const p = inferDeployProgress(deployUpdateJobLock, recentLogLines);
  res.json({
    enabled,
    requiresDeployKey,
    busy: deployUpdateJobLock,
    progressPercent: p.progressPercent,
    statusLabel: p.statusLabel,
    isFinished: p.isFinished,
    isError: p.isError,
    recentLogLines,
  });
});

/**
 * Pull latest from Git, npm ci, npm run build, restart Node stack (run-autostart-stack.cmd).
 * Body: { "deployKey": "<secret>" } unless skip-key mode (GFAS_DEPLOY_UPDATE_SKIP_KEY or deploy-update-no-key.txt).
 * Requires Node process user to be allowed to run PowerShell + git.
 */
app.post('/api/deploy-update', (req, res) => {
  try {
    if (!deployUpdateConfigured()) {
      return res.status(503).json({
        error:
          'In-app update is not configured. For no deploy key: set GFAS_DEPLOY_UPDATE_SKIP_KEY=1 or create an empty marker file next to server.cjs: deploy-update-no-key.txt (or deploy-update-no-key if extensions are hidden). Trusted networks only. Otherwise set GFAS_DEPLOY_UPDATE_KEY or deploy-update-secret.txt (first line, 8+ chars).',
      });
    }
    if (deployUpdateJobLock) {
      return res.status(429).json({
        error:
          'An update is already running. Wait for it to finish, check logs\\deploy-update.log, or restart the API if this message persists after the script has exited.',
      });
    }
    if (!deployUpdateSkipKeyNow()) {
      const key = String(req.body?.deployKey ?? req.body?.key ?? '').trim();
      if (!deployKeyMatches(key)) {
        return res.status(401).json({ error: 'Invalid deploy key.' });
      }
    }
    appendDeployLogLine('API request accepted: /api/deploy-update');
    deployUpdateJobLock = true;
    spawnDeployUpdateJob();
    res.json({
      ok: true,
      message:
        'Update and restart have been started in the background. Wait about 2–6 minutes, then refresh this page. If the site does not come back, check logs\\deploy-update.log on the server PC.',
    });
  } catch (err) {
    releaseDeployUpdateJobLock();
    console.error('deploy-update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** App login: USERS.USER_NAME (or USERNAME), USERS.PW — optional secondary Oracle hub when enabled in connection.config.json. */
app.post('/api/login', async (req, res) => {
  try {
    const user_name = String(req.body.user_name ?? req.body.USER_NAME ?? '')
      .trim()
      .toUpperCase();
    const pw = String(req.body.pw ?? req.body.PW ?? req.body.password ?? '')
      .trim()
      .toUpperCase();
    if (!user_name || !pw) {
      return res.status(400).json({ error: 'User name and password are required.' });
    }
    let rows = await lookupAppLoginRows(activeDbConfig, user_name, pw);
    if (
      DUAL_ORACLE_HUB_ENABLED &&
      (!rows || rows.length === 0) &&
      isPrimaryHubUser(activeDbConfig)
    ) {
      try {
        const secondaryRows = await lookupAppLoginRows(DB_SECONDARY, user_name, pw);
        if (secondaryRows && secondaryRows.length > 0) {
          rows = secondaryRows;
          activeDbConfig = DB_SECONDARY;
          console.log(
            `📌 Hub switched to secondary Oracle user (${String(DB_SECONDARY.user || '').toUpperCase()}) after login.`
          );
        }
      } catch (secondaryErr) {
        console.warn(
          '⚠️ Login retry as secondary Oracle hub failed:',
          formatOracleConnectErr(secondaryErr)
        );
      }
    }
    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: 'Invalid user name or password.' });
    }
    const row = rows[0];
    const name = row.USER_NAME ?? row.user_name ?? user_name;
    const compCode = String(row?.COMP_CODE ?? row?.comp_code ?? '').trim();
    res.json({ ok: true, user_name: String(name).trim().toUpperCase(), comp_code: compCode || null });
  } catch (err) {
    console.error('❌ Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 1. Get Company List
app.get('/api/companies', async (req, res) => {
  try {
    const userName = String(req.query.user_name ?? req.query.USER_NAME ?? '').trim().toUpperCase();
    const forcedCompCode = String(req.query.comp_code ?? req.query.COMP_CODE ?? '').trim();
    let authorizedCompCode = forcedCompCode;
    if (!authorizedCompCode && userName) {
      authorizedCompCode = await lookupAuthorizedCompanyCode(activeDbConfig, userName);
    }
    const cacheKey = `companies:${authorizedCompCode || 'ALL'}`;
    const cachedRows = getStartupCached(startupCache.companyByCode, cacheKey);
    if (cachedRows) return res.json(cachedRows);
    let rows = await fetchCompanyListRows(authorizedCompCode);

    // Fallback: if fast-path comp_code restriction yields no rows, retry with user lookup and then full list.
    if ((!rows || rows.length === 0) && forcedCompCode) {
      if (userName) {
        const lookedUpCompCode = await lookupAuthorizedCompanyCode(activeDbConfig, userName);
        if (lookedUpCompCode && lookedUpCompCode !== forcedCompCode) {
          rows = await fetchCompanyListRows(lookedUpCompCode);
        }
      }
      if (!rows || rows.length === 0) {
        rows = await fetchCompanyListRows('');
      }
    }

    setStartupCached(startupCache.companyByCode, cacheKey, rows || []);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Years for Company
app.get('/api/years', async (req, res) => {
  try {
    const compCode = String(req.query.comp_code ?? '').trim();
    const cacheKey = `years:${compCode}`;
    if (compCode) {
      const cachedRows = getStartupCached(startupCache.yearsByCompCode, cacheKey);
      if (cachedRows) return res.json(cachedRows);
    }
    const rows = await runQuery(
      "SELECT comp_uid, comp_year, comp_s_dt, comp_e_dt FROM compdet WHERE comp_code = :code ORDER BY comp_year DESC",
      { code: req.query.comp_code }
    );
    if (compCode) setStartupCached(startupCache.yearsByCompCode, cacheKey, rows);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Trial Balance (The Main Report)
// 3. Trial Balance (The Main Report with Totals)
app.get('/api/trial-balance', async (req, res) => {
  try {
    const { comp_code, e_date, schedule, comp_uid } = req.query;
    const schedVal = parseFloat(schedule) || 0;

    // We use ROLLUP on (schedule, code) to get subtotals
    // We use CASE to give names to the 'null' rows generated by ROLLUP
    let sql = `SELECT 
                 b.schedule, 
                 MAX(c.name) as sch_name, 
                 a.code, 
                 CASE 
                   WHEN a.code IS NULL AND b.schedule IS NOT NULL THEN 'TOTAL ' || NVL(MAX(c.name), 'SCHEDULE') || ' ' || TO_CHAR(b.schedule)
                   WHEN a.code IS NULL AND b.schedule IS NULL THEN '*** GRAND TOTAL ***'
                   ELSE MAX(b.name) 
                 END AS name,
                 MAX(b.city) as city, 
                 SUM(NVL(a.dr_amt,0)) dr_amt, 
                 SUM(NVL(a.cr_amt,0)) cr_amt,
                 CASE WHEN SUM(NVL(a.dr_amt,0) - NVL(a.cr_amt,0)) > 0 THEN SUM(NVL(a.dr_amt,0) - NVL(a.cr_amt,0)) ELSE 0 END AS closing_dr,
                 CASE WHEN SUM(NVL(a.dr_amt,0) - NVL(a.cr_amt,0)) < 0 THEN ABS(SUM(NVL(a.dr_amt,0) - NVL(a.cr_amt,0))) ELSE 0 END AS closing_cr
               FROM ledger a, master b, schedule c 
               WHERE a.comp_code = :comp_code 
               AND a.vr_date <= TO_DATE(:e_date, 'DD-MM-YYYY')
               AND a.comp_code = b.comp_code AND a.code = b.code
               AND b.comp_code = c.comp_code AND b.schedule = c.no`;

    const bindParams = { comp_code, e_date };
    if (schedVal !== 0) {
      sql += ` AND b.schedule = :schedule`;
      bindParams.schedule = schedVal;
    }

    // ROLLUP creates the sub-aggregates automatically
    sql += ` GROUP BY ROLLUP(b.schedule, a.code) 
             ORDER BY b.schedule NULLS LAST, a.code NULLS LAST`;

    const rows = await runQuery(sql, bindParams, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error("❌ Trial Balance SQL Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3A. Trial Balance for an explicit list of ledger codes
app.get('/api/trial-balance-by-codes', async (req, res) => {
  try {
    const { comp_code, comp_uid, e_date, codes } = req.query;
    if (!comp_code || !e_date) {
      return res.status(400).json({ error: 'comp_code and e_date are required' });
    }
    const rawCodes = String(codes || '')
      .split(',')
      .map((s) => String(s || '').trim())
      .filter((s) => /^\d+$/.test(s));
    const uniqCodes = Array.from(new Set(rawCodes));
    if (!uniqCodes.length) return res.json([]);

    const codeBindNames = uniqCodes.map((_, i) => `c${i}`);
    const inSql = codeBindNames.map((n) => `:${n}`).join(',');
    const bindParams = { comp_code, e_date };
    codeBindNames.forEach((n, i) => {
      bindParams[n] = Number(uniqCodes[i]);
    });

    const sql = `
      SELECT
        B.SCHEDULE AS SCHEDULE,
        NVL(MAX(C.NAME), '') AS SCH_NAME,
        B.CODE AS CODE,
        NVL(MAX(B.NAME), '') AS NAME,
        NVL(MAX(B.CITY), '') AS CITY,
        SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
        SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
        CASE WHEN SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) > 0
          THEN SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) ELSE 0 END AS CLOSING_DR,
        CASE WHEN SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) < 0
          THEN ABS(SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0))) ELSE 0 END AS CLOSING_CR
      FROM MASTER B
      LEFT JOIN LEDGER A
        ON A.COMP_CODE = B.COMP_CODE
       AND A.CODE = B.CODE
       AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
      LEFT JOIN SCHEDULE C
        ON C.COMP_CODE = B.COMP_CODE
       AND C.NO = B.SCHEDULE
      WHERE B.COMP_CODE = :comp_code
        AND B.CODE IN (${inSql})
      GROUP BY B.SCHEDULE, B.CODE
      ORDER BY B.SCHEDULE NULLS LAST, B.CODE
    `;

    const rows = await runQuery(sql, bindParams, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Trial Balance by codes SQL Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Ledger Account Report
app.get('/api/ledger', async (req, res) => {
  try {
    const { comp_code, code, s_date, e_date, comp_uid, voucher_wise_total } = req.query;
    const codeN = parseMasterCodeForSql(code);
    if (!comp_code || codeN === undefined || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, code (numeric), s_date, and e_date are required' });
    }
    const voucherWiseTotal = String(voucher_wise_total || 'N').trim().toUpperCase() === 'Y';

    const txnSelect = voucherWiseTotal
      ? `
        SELECT
               A.CODE,
               MAX(B.NAME) AS NAME,
               MAX(B.CITY) AS CITY,
               MAX(B.GST_NO) AS GST_NO,
               MAX(B.PAN) AS PAN,
               MAX(B.ADD1) AS ADD1,
               MAX(B.ADD2) AS ADD2,
               MAX(B.TEL_NO_O) AS TEL_NO_O,
               A.VR_DATE,
               A.V_DATE,
               A.VR_NO,
               A.VR_TYPE,
               A.TYPE,
               0 AS TRN_NO,
               A.DETAIL,
               SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
               SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
               NULL AS DC_CODE,
               NULL AS DC_NAME
        FROM LEDGER A, MASTER B
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
          AND A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
        GROUP BY A.CODE, A.VR_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.CHQ_NO, A.DETAIL, A.V_DATE
      `
      : `
        SELECT A.CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               A.VR_DATE, A.V_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.TRN_NO,
               A.DETAIL, A.DR_AMT, A.CR_AMT, A.DC_CODE, NULL AS DC_NAME
        FROM LEDGER A, MASTER B
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
          AND A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
      `;

    const sql = `
      WITH OP AS (
        SELECT SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OP_BAL
        FROM LEDGER
        WHERE COMP_CODE = :comp_code
          AND CODE = :code
          AND VR_DATE < TO_DATE(:s_date, 'DD-MM-YYYY')
      ),
      DATA AS (
        SELECT :code AS CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               TO_DATE(:s_date,'DD-MM-YYYY') AS VR_DATE,
               CAST(NULL AS DATE) AS V_DATE,
               0 AS VR_NO, 'OP' AS VR_TYPE, NULL AS TYPE, 0 AS TRN_NO, 'OPENING BALANCE' AS DETAIL,
               CASE WHEN OP.OP_BAL > 0 THEN OP.OP_BAL ELSE 0 END AS DR_AMT,
               CASE WHEN OP.OP_BAL < 0 THEN ABS(OP.OP_BAL) ELSE 0 END AS CR_AMT,
               NULL AS DC_CODE, NULL AS DC_NAME
        FROM OP, MASTER B
        WHERE B.COMP_CODE = :comp_code
          AND B.CODE = :code
        UNION ALL
        ${txnSelect}
      )
      SELECT DATA.*,
             SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OVER (
               ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS RUN_BAL
      FROM DATA
      ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO`;

    const bindParams = { 
      comp_code: comp_code, 
      code: codeN, 
      s_date: s_date, 
      e_date: e_date 
    };

    // Use our helper to switch to the correct year schema (comp_uid)
    const rows = await runQuery(sql, bindParams, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error("❌ Ledger Query Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4A. Ledger with Interest Report
app.get('/api/ledger-interest', async (req, res) => {
  try {
    const { comp_code, code, s_date, e_date, int_date, int_rate, grace_dr_days, grace_cr_days, comp_uid } = req.query;
    const codeN = parseMasterCodeForSql(code);
    if (!comp_code || codeN === undefined || !s_date || !e_date || !int_date) {
      return res.status(400).json({
        error: 'comp_code, code (numeric), s_date, e_date, and int_date are required',
      });
    }

    const rateNum = Number(int_rate);
    const graceDrNum = Number(grace_dr_days);
    const graceCrNum = Number(grace_cr_days);
    const safeRate = Number.isFinite(rateNum) ? rateNum : 0;
    const safeGraceDr = Number.isFinite(graceDrNum) ? graceDrNum : 0;
    const safeGraceCr = Number.isFinite(graceCrNum) ? graceCrNum : 0;

    const sql = `
      WITH OP AS (
        SELECT SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OP_BAL
        FROM LEDGER
        WHERE COMP_CODE = :comp_code
          AND CODE = :code
          AND VR_DATE < TO_DATE(:s_date, 'DD-MM-YYYY')
      ),
      DATA AS (
        SELECT :code AS CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               TO_DATE(:s_date,'DD-MM-YYYY') AS VR_DATE,
               CAST(NULL AS DATE) AS V_DATE,
               0 AS VR_NO, 'OP' AS VR_TYPE, NULL AS TYPE, 0 AS TRN_NO, 'OPENING BALANCE' AS DETAIL,
               CASE WHEN OP.OP_BAL > 0 THEN OP.OP_BAL ELSE 0 END AS DR_AMT,
               CASE WHEN OP.OP_BAL < 0 THEN ABS(OP.OP_BAL) ELSE 0 END AS CR_AMT,
               0 AS DR_DAYS, 0 AS CR_DAYS,
               0 AS DR_INTEREST, 0 AS CR_INTEREST,
               NULL AS DC_CODE, NULL AS DC_NAME
        FROM OP, MASTER B
        WHERE B.COMP_CODE = :comp_code
          AND B.CODE = :code
        UNION ALL
        SELECT A.CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               A.VR_DATE, A.V_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.TRN_NO,
               A.DETAIL, A.DR_AMT, A.CR_AMT,
               CASE
                 WHEN NVL(A.DR_AMT,0) > 0 THEN
                   GREATEST(
                     TRUNC(TO_DATE(:int_date,'DD-MM-YYYY')) - (TRUNC(NVL(A.V_DATE, A.VR_DATE)) + :grace_dr_days),
                     0
                   )
                 ELSE 0
               END AS DR_DAYS,
               CASE
                 WHEN NVL(A.CR_AMT,0) > 0 THEN
                   GREATEST(
                     TRUNC(TO_DATE(:int_date,'DD-MM-YYYY')) - (TRUNC(NVL(A.V_DATE, A.VR_DATE)) + :grace_cr_days),
                     0
                   )
                 ELSE 0
               END AS CR_DAYS,
               ROUND(
                 (
                   (NVL(A.DR_AMT,0) * :int_rate / 100) / 365
                 ) * GREATEST(
                   TRUNC(TO_DATE(:int_date,'DD-MM-YYYY')) - (TRUNC(NVL(A.V_DATE, A.VR_DATE)) + :grace_dr_days),
                   0
                 ),
                 2
               ) AS DR_INTEREST,
               ROUND(
                 (
                   (NVL(A.CR_AMT,0) * :int_rate / 100) / 365
                 ) * GREATEST(
                   TRUNC(TO_DATE(:int_date,'DD-MM-YYYY')) - (TRUNC(NVL(A.V_DATE, A.VR_DATE)) + :grace_cr_days),
                   0
                 ),
                 2
               ) AS CR_INTEREST,
               A.DC_CODE, NULL AS DC_NAME
        FROM LEDGER A, MASTER B
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
          AND A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
      )
      SELECT DATA.*,
             SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OVER (
               ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS RUN_BAL
      FROM DATA
      ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO`;

    const bindParams = {
      comp_code,
      code: codeN,
      s_date,
      e_date,
      int_date,
      int_rate: safeRate,
      grace_dr_days: safeGraceDr,
      grace_cr_days: safeGraceCr,
    };

    const rows = await runQuery(sql, bindParams, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Ledger interest query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** All LEDGER lines for one voucher (comp_code + vr_date + vr_type + vr_no). */
app.get('/api/ledger-voucher', async (req, res) => {
  try {
    const { comp_code, vr_type, vr_date, vr_no, comp_uid } = req.query;
    if (!comp_code || !vr_type || !vr_date || vr_no == null || vr_no === '') {
      return res.status(400).json({ error: 'comp_code, vr_type, vr_date, and vr_no are required' });
    }
    const vrNoNum = Number(vr_no);
    if (!Number.isFinite(vrNoNum)) {
      return res.status(400).json({ error: 'vr_no must be a number' });
    }

    const sql = `
      SELECT
        A.VR_DATE,
        A.VR_NO,
        A.VR_TYPE,
        A.TYPE,
        A.CODE,
        B.NAME,
        B.CITY,
        A.DR_AMT,
        A.CR_AMT,
        A.DETAIL,
        A.DC_CODE,
        (
          SELECT MAX(M.NAME)
          FROM MASTER M
          WHERE M.COMP_CODE = A.COMP_CODE
            AND M.CODE = A.DC_CODE
        ) AS DC_NAME
      FROM LEDGER A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_TYPE = :vr_type
        AND A.VR_DATE = TO_DATE(:vr_date, 'DD-MM-YYYY')
        AND A.VR_NO = :vr_no
      ORDER BY A.VR_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.TRN_NO`;

    const bindParams = {
      comp_code,
      vr_type: String(vr_type),
      vr_date: String(vr_date),
      vr_no: vrNoNum,
    };

    const rows = await runQuery(sql, bindParams, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Ledger voucher query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5 LEDGER HELP
// 5. Get Account Master List for Dropdown
app.get('/api/accounts', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    
    // Your exact query optimized for the helper
    const sql = `
      SELECT MAX(A.NAME) AS NAME,
             MAX(A.CITY) AS CITY,
             A.CODE,
             MAX(A.ADD1) AS ADD1,
             MAX(A.ADD2) AS ADD2,
             MAX(A.GST_NO) AS GST_NO,
             MAX(A.PAN) AS PAN,
             MAX(A.TEL_NO_O) AS TEL_NO_O,
             SUM(NVL(B.DR_AMT,0) - NVL(B.CR_AMT,0)) AS CUR_BAL
      FROM MASTER A, LEDGER B
      WHERE A.COMP_CODE = :comp_code
      AND A.COMP_CODE = B.COMP_CODE (+)
      AND A.CODE = B.CODE (+)
      GROUP BY A.CODE
      ORDER BY MAX(A.NAME), MAX(A.CITY)`;

    const rows = await runQuery(sql, { comp_code: comp_code }, comp_uid);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ageing', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      schedule,
      e_date,
      mlb,
      range1,
      range2,
      range3,
      range4,
      range5,
      range6,
      range7,
      range8,
      range9,
      range10,
    } = req.query;

    if (!comp_code || !comp_uid || !schedule || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, schedule, and e_date are required' });
    }

    const scheduleNum = Math.round(numVal(schedule) * 100) / 100;
    const mode = String(mlb || 'L').trim().toUpperCase() === 'B' ? 'B' : 'L';
    const ranges = makeAgeingRanges([
      { from: range1, to: range2 },
      { from: range3, to: range4 },
      { from: range5, to: range6 },
      { from: range7, to: range8 },
      { from: range9, to: range10 },
    ]);
    let rawRows = [];
    if (mode === 'L') {
      rawRows = await fetchAgeingLedgerRawRowsMerged({
        comp_code,
        comp_uid,
        e_date,
        scheduleNum,
        codeFilter: null,
      });
    } else {
      const sql = `
        SELECT
          A.CODE,
          B.NAME,
          B.CITY,
          A.BILL_DATE AS BILL_DATE,
          A.BILL_DATE AS VR_DATE,
          A.BILL_NO AS VR_NO,
          A.B_TYPE,
          SUM(NVL(A.DR_AMT,0)) DR_AMT,
          SUM(NVL(A.CR_AMT,0)) CR_AMT,
          SUM(NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0)) CUR_BAL
        FROM BILLS A, MASTER B
        WHERE A.COMP_CODE = :comp_code
          AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
          AND A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
          AND ROUND(NVL(B.SCHEDULE,0), 2) = :schedule
        GROUP BY A.CODE, B.NAME, B.CITY, A.BILL_DATE, A.BILL_NO, A.B_TYPE
        HAVING SUM(NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0)) > 0
        ORDER BY B.NAME, A.CODE, A.BILL_DATE, A.BILL_NO`;
      rawRows = await runQuery(sql, { comp_code, e_date, schedule: scheduleNum }, comp_uid);
    }

    const rows =
      mode === 'L'
        ? buildAgeingLedgerRows(rawRows, e_date, ranges, null, scheduleNum)
        : buildAgeingBillRows(rawRows, e_date, ranges);

    res.json(rows);
  } catch (err) {
    console.error('❌ Ageing report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ageing-bills-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, code, schedule, e_date } = req.query;
    const codeN = parseMasterCodeForSql(code);
    if (!comp_code || !comp_uid || codeN === undefined || !schedule || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, code (numeric), schedule, and e_date are required' });
    }

    const scheduleNum = Math.round(numVal(schedule) * 100) / 100;
    const sql = `
      SELECT
        A.CODE,
        B.NAME,
        B.CITY,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        SUM(NVL(A.DR_AMT,0)) DR_AMT,
        SUM(NVL(A.CR_AMT,0)) CR_AMT,
        SUM(NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0)) CUR_BAL
      FROM BILLS A, MASTER B
      WHERE A.COMP_CODE = :comp_code
        AND A.CODE = :code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND A.COMP_CODE = B.COMP_CODE
        AND A.CODE = B.CODE
        AND ROUND(NVL(B.SCHEDULE,0), 2) = :schedule
      GROUP BY A.CODE, B.NAME, B.CITY, A.BILL_DATE, A.BILL_NO, A.B_TYPE
      HAVING SUM(NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0)) > 0
      ORDER BY A.BILL_DATE, A.BILL_NO`;
    const rows = await runQuery(sql, { comp_code, code: codeN, e_date, schedule: scheduleNum }, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Ageing bills detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ageing-ledger-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, code, schedule, e_date } = req.query;
    const codeN = parseMasterCodeForSql(code);
    if (!comp_code || !comp_uid || codeN === undefined || !schedule || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, code (numeric), schedule, and e_date are required' });
    }

    const scheduleNum = Math.round(numVal(schedule) * 100) / 100;
    const rawRows = await fetchAgeingLedgerRawRowsMerged({
      comp_code,
      comp_uid,
      e_date,
      scheduleNum,
      codeFilter: codeN,
    });
    const detailRows = buildAgeingLedgerDetailRows(rawRows, null);
    const netDrMinusCr = netDrMinusCrFromLedgerLines(rawRows);
    const rows = shouldShowAgeingLedgerSummaryRow(scheduleNum, netDrMinusCr) ? detailRows : [];
    res.json(rows);
  } catch (err) {
    console.error('❌ Ageing ledger detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Customer / supplier parties for bill-wise ledger (schedules per legacy SQL*Plus) */
app.get('/api/bill-ledger-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const ledgerKind = String(req.query.ledger_kind || 'customer').trim().toLowerCase() === 'supplier' ? 'supplier' : 'customer';
    const scheduleFilter =
      ledgerKind === 'supplier'
        ? '(SCHEDULE = 11.10 OR ROUND(SCHEDULE, 2) = 11.1)'
        : '(SCHEDULE >= 8 AND SCHEDULE < 9)';
    const balExpr = ledgerKind === 'supplier' ? 'NVL(L.CR_AMT,0)-NVL(L.DR_AMT,0)' : 'NVL(L.DR_AMT,0)-NVL(L.CR_AMT,0)';
    const sql = `
      SELECT
        M.NAME,
        M.CITY,
        M.CODE,
        M.TEL_NO_O,
        NVL(SUM(${balExpr}), 0) AS CUR_BAL
      FROM MASTER M
      LEFT JOIN LEDGER L
        ON M.COMP_CODE = L.COMP_CODE
       AND M.CODE = L.CODE
      WHERE M.COMP_CODE = :comp_code
        AND ${scheduleFilter.replace(/SCHEDULE/g, 'M.SCHEDULE')}
      GROUP BY M.NAME, M.CITY, M.CODE, M.TEL_NO_O
      ORDER BY M.NAME, M.CITY, M.CODE`;
    const rows = await runQuery(sql, { comp_code }, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Bill ledger parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Bill-ledger interest defaults from DEFVALUE table: g_days, g_edays */
app.get('/api/bill-ledger-defaults', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code) {
      return res.status(400).json({ error: 'comp_code is required' });
    }
    const binds = { comp_code };
    const sqlCandidates = [
      `SELECT G_DAYS, G_EDAYS FROM DEFVALUE WHERE COMP_CODE = :comp_code`,
      `SELECT G_DAYS, G_EDAYS FROM DEFAULT WHERE COMP_CODE = :comp_code`,
      `SELECT G_DAYS, G_EDAYS FROM "DEFAULT" WHERE COMP_CODE = :comp_code`,
    ];
    let rows = [];
    let lastErr = null;
    for (const sql of sqlCandidates) {
      try {
        rows = await runQuery(sql, binds, comp_uid, { suppressDbErrorLog: true });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const pick = (up, low) => row?.[up] ?? row?.[low] ?? null;
    res.json({
      g_days: pick('G_DAYS', 'g_days'),
      g_edays: pick('G_EDAYS', 'g_edays'),
    });
  } catch (err) {
    console.error('❌ bill-ledger-defaults error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GETINT return format: LPAD(days,5,'0') || 'I' || TO_CHAR(amount) — legacy Oracle function (orafun). */
function parseOraGetintReturn(raw) {
  if (raw == null) return { interestDays: null, interestAmt: null };
  const s = String(raw).trim();
  if (!s) return { interestDays: null, interestAmt: null };
  const i = s.indexOf('I');
  if (i < 1) return { interestDays: null, interestAmt: null };
  const dayStr = s.slice(0, i).trim();
  const amtStr = s.slice(i + 1).trim().replace(/,/g, '');
  const interestDays = parseInt(dayStr, 10);
  const interestAmt = parseFloat(amtStr);
  return {
    interestDays: Number.isFinite(interestDays) ? interestDays : null,
    interestAmt: Number.isFinite(interestAmt) ? interestAmt : null,
  };
}

/**
 * Bill-wise ledger from BILLS; optional interest from GETINT (customer) or GETINT_SUP (supplier).
 * Query:
 * - ledger_kind=customer|supplier (default customer)
 * - include_interest=Y, int_indt (DD-MM-YYYY), gs_days, ged_days, group_cd, bombay_dhara
 */
app.get('/api/bill-ledger', async (req, res) => {
  try {
    const { comp_code, code, s_date, e_date, p_edt, mco, comp_uid } = req.query;
    const codeN = parseMasterCodeForSql(code);
    if (!comp_code || codeN === undefined || !s_date || !e_date || !p_edt) {
      return res.status(400).json({ error: 'comp_code, code (numeric), s_date, e_date, p_edt are required' });
    }
    const mode = String(mco || 'A').toUpperCase() === 'O' ? 'O' : 'A';
    const ledgerKind = String(req.query.ledger_kind || 'customer').trim().toLowerCase() === 'supplier' ? 'supplier' : 'customer';
    const balanceExpr = ledgerKind === 'supplier' ? 'lines.CR_AMT - lines.DR_AMT' : 'lines.DR_AMT - lines.CR_AMT';
    const outstandingExpr = ledgerKind === 'supplier' ? 'NVL(CR_AMT,0) - NVL(DR_AMT,0)' : 'NVL(DR_AMT,0) - NVL(CR_AMT,0)';
    const wantInt = String(req.query.include_interest ?? '')
      .trim()
      .toUpperCase()
      .startsWith('Y');
    const intIndt = wantInt ? String(req.query.int_indt ?? '').trim() : '';
    if (wantInt && !intIndt) {
      return res.status(400).json({
        error:
          'When include_interest=Y, int_indt is required (interest as-of date, DD-MM-YYYY, same format as other bill-ledger dates).',
      });
    }

    const linesCte = `
      WITH lines AS (
        SELECT
          A.CODE,
          B.NAME,
          A.BILL_NO,
          A.BILL_DATE,
          A.B_TYPE,
          A.VR_DATE,
          A.V_DATE,
          A.VR_NO,
          A.VR_TYPE,
          NVL(A.DR_AMT,0) DR_AMT,
          NVL(A.CR_AMT,0) CR_AMT
        FROM BILLS A, MASTER B
        WHERE A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
          AND A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND (
            A.BILL_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
            OR (
              NVL(A.DR_AMT,0) > 0
              AND TRIM(A.VR_TYPE) IN (
                'S','W','SL','SW','SI','SR',
                'DN','DR','DI',
                'PU','PI','PR'
              )
              AND A.VR_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
            )
          )
          AND (
            (B.SCHEDULE >= 8 AND B.SCHEDULE < 9 AND
              (
                (TRIM(A.VR_TYPE) IN (
                  'S','W','SL','SW','SI','SR',
                  'DN','DR','DI',
                  'PU','PI','PR'
                ) AND (
                  A.BILL_DATE <= TO_DATE(:e_date,'DD-MM-YYYY')
                  OR A.VR_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
                ))
                OR
                (TRIM(A.VR_TYPE) IN ('CV','BV','JV') AND A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY'))
              )
            )
            OR
            ((B.SCHEDULE = 11.10 OR ROUND(B.SCHEDULE, 2) = 11.1) AND
              (
                (TRIM(A.VR_TYPE) IN ('PU','DN','PI','PR') AND (
                  A.BILL_DATE <= TO_DATE(:e_date,'DD-MM-YYYY')
                  OR A.VR_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
                ))
                OR
                (TRIM(A.VR_TYPE) IN ('CV','BV','JV') AND A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY'))
              )
            )
          )
      ),
      filtered AS (
        SELECT
          lines.CODE,
          lines.NAME,
          lines.BILL_NO,
          lines.BILL_DATE,
          lines.B_TYPE,
          lines.VR_DATE,
          lines.V_DATE,
          lines.VR_NO,
          lines.VR_TYPE,
          lines.DR_AMT,
          lines.CR_AMT,
          SUM(${balanceExpr}) OVER (
            PARTITION BY lines.CODE, lines.BILL_NO
            ORDER BY lines.VR_DATE, lines.VR_NO
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) CL_BALANCE
        FROM lines
        WHERE (
          :mco = 'A'
          OR
          (:mco = 'O' AND lines.BILL_NO IN (
            SELECT BILL_NO
            FROM BILLS
            WHERE COMP_CODE = :comp_code2
              AND CODE = :code2
            GROUP BY BILL_NO
            HAVING SUM(${outstandingExpr}) <> 0
          ))
        )
      )`;

    const orderBy = `
      ORDER BY NVL(filtered.BILL_DATE, TRUNC(filtered.VR_DATE)), filtered.BILL_NO, filtered.VR_DATE, filtered.VR_NO`;

    let sql;
    const binds = {
      comp_code,
      code: codeN,
      s_date,
      e_date,
      p_edt,
      mco: mode,
      comp_code2: comp_code,
      code2: codeN,
    };

    if (wantInt) {
      const gs = req.query.gs_days != null && String(req.query.gs_days).trim() !== '' ? String(req.query.gs_days).trim() : '0';
      const ged = req.query.ged_days != null && String(req.query.ged_days).trim() !== '' ? String(req.query.ged_days).trim() : '30';
      const grp = req.query.group_cd != null && String(req.query.group_cd).trim() !== '' ? String(req.query.group_cd).trim() : '0';
      const bomb = req.query.bombay_dhara != null && String(req.query.bombay_dhara).trim() !== '' ? String(req.query.bombay_dhara).trim() : '0';
      binds.int_indt = intIndt;
      binds.gs_days = gs;
      binds.ged_days = ged;
      binds.group_cd = grp;
      binds.bombay_dhara = bomb;
      binds.comp_code_gi = String(comp_code).trim();
      // GETINT (customer): last arg is interest cutoff e_date (matches DB GETINT).
      // GETINT_SUP: T_EDT must be the row VR date (legacy ?VRDATE), not report e_date; B_TYPE like NVL(A.B_TYPE,'Z').
      const getintCustomerSql = `GETINT(
            TO_NUMBER(TRIM(:comp_code_gi)),
            bk.CODE,
            bk.BILL_DATE,
            bk.BILL_NO,
            TRIM(bk.B_TYPE),
            TO_DATE(:int_indt, 'DD-MM-YYYY'),
            TO_NUMBER(:gs_days),
            TO_NUMBER(:ged_days),
            TO_NUMBER(:group_cd),
            TO_NUMBER(:bombay_dhara),
            TO_DATE(:e_date, 'DD-MM-YYYY')
          )`;
      const getintSupPerRowSql = `GETINT_SUP(
            TO_NUMBER(TRIM(:comp_code_gi)),
            filtered.CODE,
            filtered.BILL_DATE,
            filtered.BILL_NO,
            NVL(TRIM(filtered.B_TYPE), 'Z'),
            TO_DATE(:int_indt, 'DD-MM-YYYY'),
            TO_NUMBER(:gs_days),
            TO_NUMBER(:ged_days),
            TO_NUMBER(:group_cd),
            TO_NUMBER(:bombay_dhara),
            filtered.VR_DATE
          )`;

      if (ledgerKind === 'supplier') {
        sql =
          linesCte +
          `
      SELECT
        filtered.CODE,
        filtered.NAME,
        filtered.BILL_NO,
        filtered.BILL_DATE,
        filtered.B_TYPE,
        filtered.VR_DATE,
        filtered.V_DATE,
        filtered.VR_NO,
        filtered.VR_TYPE,
        filtered.DR_AMT,
        filtered.CR_AMT,
        filtered.CL_BALANCE,
        ${getintSupPerRowSql} AS GETINT_RAW
      FROM filtered` + orderBy;
      } else {
        sql =
          linesCte +
          `,
      bill_keys AS (
        SELECT DISTINCT
          filtered.CODE,
          filtered.BILL_DATE,
          filtered.BILL_NO,
          filtered.B_TYPE
        FROM filtered
      ),
      bill_int AS (
        SELECT
          bk.CODE,
          bk.BILL_DATE,
          bk.BILL_NO,
          bk.B_TYPE,
          ${getintCustomerSql} AS GETINT_RAW
        FROM bill_keys bk
      )
      SELECT
        filtered.CODE,
        filtered.NAME,
        filtered.BILL_NO,
        filtered.BILL_DATE,
        filtered.B_TYPE,
        filtered.VR_DATE,
        filtered.V_DATE,
        filtered.VR_NO,
        filtered.VR_TYPE,
        filtered.DR_AMT,
        filtered.CR_AMT,
        filtered.CL_BALANCE,
        bi.GETINT_RAW
      FROM filtered
      LEFT JOIN bill_int bi ON
        filtered.CODE = bi.CODE
        AND NVL(TRUNC(filtered.BILL_DATE), DATE '1899-12-30') = NVL(TRUNC(bi.BILL_DATE), DATE '1899-12-30')
        AND NVL(TO_CHAR(filtered.BILL_NO), ' ') = NVL(TO_CHAR(bi.BILL_NO), ' ')
        AND NVL(TRIM(filtered.B_TYPE), ' ') = NVL(TRIM(bi.B_TYPE), ' ')` + orderBy;
      }
    } else {
      sql =
        linesCte +
        `
      SELECT
        filtered.CODE,
        filtered.NAME,
        filtered.BILL_NO,
        filtered.BILL_DATE,
        filtered.B_TYPE,
        filtered.VR_DATE,
        filtered.V_DATE,
        filtered.VR_NO,
        filtered.VR_TYPE,
        filtered.DR_AMT,
        filtered.CR_AMT,
        filtered.CL_BALANCE
      FROM filtered` +
        orderBy;
    }

    let rows = await runQuery(sql, binds, comp_uid);
    rows = rows || [];
    if (wantInt) {
      rows = rows.map((r) => {
        const raw = r.GETINT_RAW ?? r.getint_raw;
        const { interestDays, interestAmt } = parseOraGetintReturn(raw);
        const out = { ...r };
        delete out.GETINT_RAW;
        delete out.getint_raw;
        out.INTEREST_DAYS = interestDays;
        out.INTEREST_AMT = interestAmt;
        return out;
      });
    }
    rows = rows.map((r) => ({ ...r, LEDGER_KIND: ledgerKind }));
    res.json(rows);
  } catch (err) {
    console.error('❌ Bill ledger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Brokers for broker-wise outstanding: BILLS.B_CODE only (no BK_CODE — column may not exist on BILLS). */
app.get('/api/broker-os-brokers', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT DISTINCT M.NAME, M.CODE
      FROM BILLS A
      JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND A.B_CODE = M.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.B_CODE IS NOT NULL
        AND TRIM(A.VR_TYPE) IN ('S', 'SE', 'PU')
      ORDER BY M.CODE`;
    const rows = await runQuery(sql, { comp_code }, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Broker list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Customers / suppliers (C or S prefix) for optional party filter on broker OS */
app.get('/api/broker-os-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT NAME, CITY, CODE
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND (SUBSTR(TO_CHAR(CODE), 1, 1) = 'C' OR SUBSTR(TO_CHAR(CODE), 1, 1) = 'S')
      ORDER BY NAME, CITY, CODE`;
    const rows = await runQuery(sql, { comp_code }, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Broker OS parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Broker-wise outstanding (BILLS + MASTER).
 * Bills included only if they have a line with B_CODE in range and VR_TYPE in S, SE, PU.
 * Credits after payment end date are treated as zero in CR_AMT / balances (per legacy).
 */
app.get('/api/broker-outstanding', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      s_date,
      e_date,
      p_edt,
      brok_start,
      brok_end,
      party_code,
      mco,
    } = req.query;

    const mode = String(mco || 'A').toUpperCase() === 'O' ? 'O' : 'A';
    const n1 = parseBrokerOsRangeNum(String(brok_start ?? '').trim());
    const n2 = parseBrokerOsRangeNum(String(brok_end ?? '').trim());
    const brokLoFinal = n1 != null && n2 != null ? Math.min(n1, n2) : n1 ?? n2 ?? 26001;
    const brokHiFinal = n1 != null && n2 != null ? Math.max(n1, n2) : n1 ?? n2 ?? 26999;

    const partyBind = parseMasterCodeForSql(party_code);
    const partyFilter = partyBind !== undefined ? 'AND A.CODE = :party_code' : '';

    const sql = `
      SELECT *
      FROM (
        SELECT
          MAX(A.B_CODE) OVER (
            PARTITION BY A.COMP_CODE, A.CODE, A.BILL_NO, TRUNC(A.BILL_DATE)
          ) AS B_CODE,
          A.CODE,
          B.NAME,
          A.BILL_NO,
          A.BILL_DATE,
          A.VR_TYPE,
          A.VR_DATE,
          A.VR_NO,
          NVL(A.DR_AMT,0) AS DR_AMT,
          CASE
            WHEN A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY') THEN NVL(A.CR_AMT,0)
            ELSE 0
          END AS CR_AMT,
          CASE WHEN NVL(A.DR_AMT,0) > 0 THEN 1 ELSE 2 END AS DR_CR_FLAG,
          SUM(
            NVL(A.DR_AMT,0) -
            CASE
              WHEN A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY') THEN NVL(A.CR_AMT,0)
              ELSE 0
            END
          ) OVER (
            PARTITION BY A.COMP_CODE, A.CODE, A.BILL_NO, TRUNC(A.BILL_DATE)
            ORDER BY A.VR_DATE,
                     CASE WHEN NVL(A.DR_AMT,0) > 0 THEN 1 ELSE 2 END,
                     A.VR_NO
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS RUN_BAL,
          SUM(
            NVL(A.DR_AMT,0) -
            CASE
              WHEN A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY') THEN NVL(A.CR_AMT,0)
              ELSE 0
            END
          ) OVER (
            PARTITION BY A.COMP_CODE, A.CODE, A.BILL_NO, TRUNC(A.BILL_DATE)
          ) AS FINAL_BAL
        FROM BILLS A
        JOIN MASTER B
          ON A.COMP_CODE = B.COMP_CODE
         AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          ${partyFilter}
          AND EXISTS (
            SELECT 1
            FROM BILLS seed
            WHERE seed.COMP_CODE = A.COMP_CODE
              AND seed.CODE = A.CODE
              AND seed.BILL_NO = A.BILL_NO
              AND TRUNC(seed.BILL_DATE) = TRUNC(A.BILL_DATE)
              AND seed.B_CODE IS NOT NULL
              AND seed.B_CODE BETWEEN :brok_lo AND :brok_hi
              AND TRIM(seed.VR_TYPE) IN ('S','SE','PU')
          )
          AND A.BILL_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
      ) x
      WHERE :mco = 'A' OR (:mco = 'O' AND NVL(x.FINAL_BAL,0) <> 0)
      ORDER BY x.B_CODE, x.NAME, x.CODE, x.BILL_DATE, x.VR_DATE, x.DR_CR_FLAG, x.VR_NO`;

    const binds = {
      comp_code,
      s_date,
      e_date,
      p_edt,
      brok_lo: brokLoFinal,
      brok_hi: brokHiFinal,
      mco: mode,
    };
    if (partyBind !== undefined) binds.party_code = partyBind;

    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Broker outstanding error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** SALE line in period — this schema uses BILL_DATE only (no VR_DATE on SALE). */
const SALE_LIST_DATE_FILTER_SQL = `
          AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))`;

/**
 * VFP9 MVAR: AND A.TYPE = ?PTYPE with PTYPE NUMBER 1–9 on SALE.
 * Web "Mixed" (no ptype param) → TYPE BETWEEN 1 AND 9 (all document classes in one list).
 */
function saleListPtypeWhereSql(ptypeRaw) {
  const n = parseInt(String(ptypeRaw ?? '').trim(), 10);
  if (Number.isFinite(n) && n >= 1 && n <= 9) {
    return { sql: ' AND A.TYPE = :sale_ptype_num ', binds: { sale_ptype_num: n } };
  }
  return { sql: ' AND A.TYPE BETWEEN 1 AND 9 ', binds: {} };
}

function saleListBillNoRangeClause(sbRaw, ebRaw) {
  const sa = sbRaw != null ? String(sbRaw).trim() : '';
  const ea = ebRaw != null ? String(ebRaw).trim() : '';
  if (!sa && !ea) return { sql: '', binds: {} };
  const n1 = sa === '' ? null : Number(sa);
  const n2 = ea === '' ? null : Number(ea);
  if (n1 != null && Number.isFinite(n1) && n2 != null && Number.isFinite(n2)) {
    const lo = Math.min(n1, n2);
    const hi = Math.max(n1, n2);
    return { sql: ' AND A.BILL_NO BETWEEN :sale_sb_no AND :sale_eb_no ', binds: { sale_sb_no: lo, sale_eb_no: hi } };
  }
  const one = n1 != null && Number.isFinite(n1) ? n1 : n2 != null && Number.isFinite(n2) ? n2 : null;
  if (one != null) {
    return { sql: ' AND A.BILL_NO = :sale_sb_no ', binds: { sale_sb_no: one } };
  }
  return { sql: '', binds: {} };
}

/** VFP REVCHG: restrict to reverse-charge sale (TYPE 9) or exclude it. */
function saleBillPrintingRevchgClause(revchgRaw) {
  const r = String(revchgRaw ?? '').trim().toUpperCase();
  if (r === 'Y') return { sql: ' AND NVL(A.TYPE, 0) = 9 ', binds: {} };
  if (r === 'N') return { sql: ' AND NVL(A.TYPE, 0) <> 9 ', binds: {} };
  return { sql: '', binds: {} };
}

/**
 * Sale bill printing list: optional numeric ptype (1–9); else legacy letter bucket (SL→1+3, …);
 * empty → all types 1–9. Assumes SALE.TYPE is NUMBER (VFP SALETYPE).
 */
function saleBillPrintingTypeWhereSql(ptypeRaw, typeStrRaw) {
  const pTrim = String(ptypeRaw ?? '').trim();
  const n = parseInt(pTrim, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 9) {
    return { sql: ' AND A.TYPE = :sale_bp_ptype ', binds: { sale_bp_ptype: n } };
  }
  const u = String(typeStrRaw ?? '').trim().toUpperCase();
  if (!u) {
    return { sql: ' AND A.TYPE BETWEEN 1 AND 9 ', binds: {} };
  }
  const map = {
    SL: [1, 3],
    S: [1, 3],
    SE: [6],
    CN: [8],
    CH: [2],
    RC: [9],
  };
  const nums = map[u];
  if (nums && nums.length) {
    const keys = nums.map((_, i) => `sale_bp_n${i}`);
    const ph = keys.map((k) => `:${k}`).join(', ');
    const binds = {};
    keys.forEach((k, i) => {
      binds[k] = nums[i];
    });
    return { sql: ` AND A.TYPE IN (${ph}) `, binds };
  }
  return {
    sql: ` AND UPPER(TRIM(A.TYPE)) = UPPER(TRIM(:sale_bp_vc)) `,
    binds: { sale_bp_vc: u },
  };
}

/** Sale list — parties; date range: same pattern as SQL*Plus (SALE A, MASTER B, BILL_DATE, join on CODE). */
app.get('/api/salelist-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT NAME, CITY, CODE
      FROM MASTER
      WHERE COMP_CODE = :comp_code
      ORDER BY NAME, CITY, CODE`;
    const binds = { comp_code };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale list parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Sale list — brokers: VFP9 MASTER where SCHEDULE = 11.20 (broker schedule), not “code starts with B”. */
app.get('/api/salelist-brokers', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT NAME, CITY, CODE
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND ABS(NVL(SCHEDULE, 0) - 11.2) < 0.05
      ORDER BY NAME, CITY, CODE`;
    const binds = { comp_code };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale list brokers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Sale list — godowns / plants (VFP PLANT). */
app.get('/api/salelist-plants', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT PLANT_CODE, PLANT_NAME
      FROM PLANT
      WHERE COMP_CODE = :comp_code
      ORDER BY PLANT_NAME, PLANT_CODE`;
    const binds = { comp_code };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Sale list plants error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Distinct MARKA in SALE (optional date range for a shorter list). */
app.get('/api/salelist-markas', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date } = req.query;
    let extra = '';
    const binds = { comp_code };
    if (s_date && e_date) {
      extra = ` AND TRUNC(BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))`;
      binds.s_date = s_date;
      binds.e_date = e_date;
    }
    const sql = `
      SELECT DISTINCT TRIM(MARKA) AS MARKA
      FROM SALE
      WHERE COMP_CODE = :comp_code
        AND MARKA IS NOT NULL
        AND TRIM(MARKA) <> ' '
        ${extra}
      ORDER BY 1`;
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Sale list markas error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Distinct B_TYPE in SALE (optional date range). */
app.get('/api/salelist-btypes', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date } = req.query;
    let extra = '';
    const binds = { comp_code };
    if (s_date && e_date) {
      extra = ` AND TRUNC(BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))`;
      binds.s_date = s_date;
      binds.e_date = e_date;
    }
    const sql = `
      SELECT DISTINCT TRIM(B_TYPE) AS B_TYPE
      FROM SALE
      WHERE COMP_CODE = :comp_code
        AND B_TYPE IS NOT NULL
        AND TRIM(B_TYPE) <> ' '
        ${extra}
      ORDER BY 1`;
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Sale list b-types error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Sale list — items; same pattern: SALE A, ITEMMAST B, BILL_DATE range, join on ITEM_CODE. */
app.get('/api/salelist-items', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT ITEM_NAME, ITEM_CODE
      FROM ITEMMAST
      WHERE COMP_CODE = :comp_code
      ORDER BY ITEM_NAME`;
    const binds = { comp_code };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale list items error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Sale bill list (VFP9-style): PTYPE 1–9 → SALE.TYPE set; optional bill range, party, broker (SALE.B_CODE),
 * item, plant, marka, b_type. Omit ptype for legacy web mix SL + SE + CN only.
 */
app.get('/api/sale-list', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      s_date,
      e_date,
      mcode,
      bk_code,
      b_code,
      item_code,
      ptype,
      sb_no,
      eb_no,
      plant_code,
      marka,
      b_type,
    } = req.query;
    const mBind = parseMasterCodeForSql(mcode);
    const brokerRaw = b_code != null && String(b_code).trim() !== '' ? b_code : bk_code;
    const bBind = parseMasterCodeForSql(brokerRaw);
    const it = item_code != null ? String(item_code).trim() : '';
    const { sql: ptypeSql, binds: ptypeBinds } = saleListPtypeWhereSql(ptype);
    const { sql: billNoSql, binds: billNoBinds } = saleListBillNoRangeClause(sb_no, eb_no);
    const pc = plant_code != null ? String(plant_code).trim() : '';
    const mk = marka != null ? String(marka).trim() : '';
    const bt = b_type != null ? String(b_type).trim() : '';

    /* VFP9 MVAR sale bill list: B=party MASTER, C=ITEMMAST, D=broker MASTER (+), E=shipper MASTER (+), F=PLANT (+) */
    const sql = `
      SELECT
        A.TYPE,
        A.VR_TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.SO_NO,
        A.CH_NO,
        A.V_DATE,
        A.CODE,
        B.NAME,
        B.CITY,
        B.L_C,
        B.PAN,
        B.GST_NO,
        B.STATE_CODE,
        B.STATE,
        A.B_CODE,
        D.NAME AS BNAME,
        D.NAME AS BK_NAME,
        A.TRN_NO,
        A.S_CODE,
        E.NAME AS S_NAME,
        A.ITEM_CODE,
        NVL(C.ITEM_NAME, '') AS ITEM_NAME,
        A.QNTY,
        A.STATUS,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.BARD_AMT,
        A.LAB_AMT,
        A.FGT_AMT,
        A.INS_AMT,
        A.OTH_AMT,
        A.TAXABLE,
        A.DAMI,
        A.TAX_AMT,
        A.LABOUR,
        A.INS,
        A.FREIGHT,
        A.DIS_AMT,
        A.CGST_PER,
        A.SGST_PER,
        A.IGST_PER,
        A.CGST_AMT,
        A.SGST_AMT,
        A.IGST_AMT,
        A.TCS_PER,
        A.TCS_AMT,
        A.OTH_EXP,
        A.BILL_AMT,
        A.TDS_PER,
        A.TDS_ON_AMT,
        A.TDS_AMT,
        A.DAYS,
        A.PLANT_CODE,
        A.LP_AMT,
        A.DIS_PER,
        A.MARKA,
        NVL(C.CAT_CODE, '') AS CAT_CODE,
        NVL(C.CAT, '') AS CAT,
        A.TRUCK_NO,
        A.GR_NO,
        F.PLANT_CAT,
        F.PLANT_NAME,
        A.PO_NO,
        CAST(NULL AS VARCHAR2(40)) AS LOT,
        NVL(A.OTH_EXP, 0) AS OTH_EXP5
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      LEFT JOIN ITEMMAST C
        ON A.COMP_CODE = C.COMP_CODE
       AND TRIM(TO_CHAR(A.ITEM_CODE)) = TRIM(TO_CHAR(C.ITEM_CODE))
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.B_CODE = D.CODE
      LEFT JOIN MASTER E ON A.COMP_CODE = E.COMP_CODE AND A.S_CODE = E.CODE
      LEFT JOIN PLANT F ON A.COMP_CODE = F.COMP_CODE AND A.PLANT_CODE = F.PLANT_CODE
      WHERE A.COMP_CODE = :comp_code
        ${ptypeSql}
        ${SALE_LIST_DATE_FILTER_SQL}
        ${billNoSql}
        ${mBind !== undefined ? 'AND A.CODE = :mcode' : ''}
        ${bBind !== undefined ? 'AND A.B_CODE = :bk_code' : ''}
        ${it ? 'AND TRIM(TO_CHAR(A.ITEM_CODE)) = TRIM(:item_code)' : ''}
        ${pc ? 'AND TRIM(NVL(A.PLANT_CODE, \' \')) = TRIM(:plant_code)' : ''}
        ${mk ? 'AND TRIM(NVL(A.MARKA, \' \')) = TRIM(:marka)' : ''}
        ${bt ? 'AND NVL(TRIM(A.B_TYPE), \' \') = NVL(TRIM(:b_type), \' \')' : ''}
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;

    const binds = { comp_code, s_date, e_date, ...billNoBinds, ...ptypeBinds };
    if (mBind !== undefined) binds.mcode = mBind;
    if (bBind !== undefined) binds.bk_code = bBind;
    if (it) binds.item_code = it;
    if (pc) binds.plant_code = pc;
    if (mk) binds.marka = mk;
    if (bt) binds.b_type = bt;

    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Sale bill printing list — VFP-style: date range, bill no range, SALETYPE (ptype 1–9 or mixed),
 * BTYPE, party (mcode), broker (b_code), REVCHG (Y/N). Optional legacy `type` SL/SE/CN when ptype omitted.
 */
app.get('/api/sale-bill-printing-list', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      ptype,
      type,
      s_date,
      e_date,
      sb_no,
      eb_no,
      b_type,
      b_code,
      bk_code,
      mcode,
      revchg,
    } = req.query;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
      return res.status(400).json({ error: 'comp_code and comp_uid are required.' });
    }
    if (!s_date || !e_date) {
      return res.status(400).json({ error: 's_date and e_date are required (starting and ending bill dates).' });
    }

    const brokerRaw = b_code != null && String(b_code).trim() !== '' ? b_code : bk_code;
    const bt = b_type != null ? String(b_type).trim() : '';
    const { sql: typeSql, binds: typeBinds } = saleBillPrintingTypeWhereSql(ptype, type);
    const { sql: billNoSql, binds: billNoBinds } = saleListBillNoRangeClause(sb_no, eb_no);
    const mBind = parseMasterCodeForSql(mcode);
    const bBind = parseMasterCodeForSql(brokerRaw);
    const rev = saleBillPrintingRevchgClause(revchg);

    const sql = `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.CODE,
        B.NAME,
        B.CITY,
        MAX(NVL(A.BILL_AMT, 0)) AS BILL_AMT,
        SUM(NVL(A.CGST_AMT, 0) + NVL(A.SGST_AMT, 0) + NVL(A.IGST_AMT, 0)) AS TOTAL_TAX
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        ${typeSql}
        ${rev.sql}
        ${SALE_LIST_DATE_FILTER_SQL}
        ${billNoSql}
        ${bt ? 'AND NVL(TRIM(A.B_TYPE), \' \') = NVL(TRIM(:b_type), \' \')' : ''}
        ${mBind !== undefined ? 'AND A.CODE = :mcode' : ''}
        ${bBind !== undefined ? 'AND A.B_CODE = :bk_code' : ''}
      GROUP BY
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.CODE,
        B.NAME,
        B.CITY
      ORDER BY TRUNC(A.BILL_DATE) DESC, A.BILL_NO DESC, A.B_TYPE, A.CODE`;

    const binds = {
      comp_code,
      s_date: String(s_date).trim(),
      e_date: String(e_date).trim(),
      ...billNoBinds,
      ...typeBinds,
      ...rev.binds,
    };
    if (bt) binds.b_type = bt;
    if (mBind !== undefined) binds.mcode = mBind;
    if (bBind !== undefined) binds.bk_code = bBind;

    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Sale bill printing list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** All SALE lines for one bill (open sale bill) */
app.get('/api/sale-bill', async (req, res) => {
  try {
    const { comp_code, comp_uid, type, bill_no, bill_date } = req.query;
    const sql = `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.CODE,
        B.NAME,
        B.CITY,
        B.PAN,
        B.GST_NO,
        A.B_CODE,
        C.NAME AS BK_NAME,
        A.TRN_NO,
        A.ITEM_CODE,
        D.ITEM_NAME,
        A.LOT,
        A.STATUS,
        A.QNTY,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.BILL_AMT
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.B_CODE = C.CODE
      JOIN ITEMMAST D ON A.COMP_CODE = D.COMP_CODE AND A.ITEM_CODE = D.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.TYPE = :type
        AND A.BILL_NO = :bill_no
        AND TRUNC(A.BILL_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))
      ORDER BY A.B_TYPE, A.TRN_NO`;

    const rows = await runQuery(
      sql,
      { comp_code, type: String(type).trim(), bill_no: String(bill_no).trim(), bill_date },
      comp_uid
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale bill error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Company header for sale bill print (compdet in active hub schema — same as /api/years).
 *  Do not pass comp_uid as 3rd arg to runQuery here; year schema is comp_uid/comp_uid@XE only after year pick.
 *  Match comp_uid with TO_CHAR so string/number binds from the client both work. */
app.get('/api/compdet-print-header', async (req, res) => {
  try {
    const { comp_code, comp_uid, comp_year } = req.query;
    const one = await runCompdetHeaderRow(comp_code, comp_uid, comp_year);
    if (one) {
      enrichCompdetSalePrintGlobals(one);
      await drainOracleLobsInRows([one]);
      normalizeRowBuffers(one);
      await hydrateImageFieldInRows([one], 'sale_logo');
      await hydrateImageFieldInRows([one], 'sale_logo2');
      await hydrateImageFieldInRows([one], 'signature_file');
    }
    res.json(one);
  } catch (err) {
    console.error('❌ compdet print header error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Text-only company lines for ledger screen/PDF (no logos; avoids heavy print-header payload). */
app.get('/api/compdet-ledger-header', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const row = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!row) {
      return res.json({});
    }
    stripSalePrintImageFields(row);
    const textVal = (logical) => {
      const v = rowValueCI(row, logical);
      if (v == null || v === '') return '';
      if (typeof v === 'object') return '';
      return String(v).trim();
    };
    const gst = textVal('gst_no') || textVal('comp_gst') || textVal('gstin') || '';
    res.json({
      COMP_NAME: textVal('comp_name'),
      COMP_ADD1: textVal('comp_add1'),
      COMP_ADD2: textVal('comp_add2'),
      GST_NO: gst,
    });
  } catch (err) {
    console.error('❌ compdet ledger header error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Full sale bill lines for tax invoice / bill of supply print */
app.get('/api/sale-bill-print', async (req, res) => {
  const sbpT0 = Date.now();
  try {
    const { comp_code, comp_uid, type, bill_no, b_type, bill_date, oracle_types, fin_year, comp_year } = req.query;
    const bt = b_type != null ? String(b_type).trim() : '';
    let finYear = fin_year != null ? String(fin_year).trim() : '';
    const ot = oracle_types != null ? String(oracle_types).trim() : '';
    const relaxBillDate = truthyEnv01(req.query.relax_bill_date);
    const rows = await runSaleBillPrintRows(
      {
        comp_code,
        type: type != null ? String(type).trim() : '',
        oracle_types: ot,
        bill_no: String(bill_no).trim(),
        b_type: bt || ' ',
        bill_date,
        relax_bill_date: relaxBillDate ? '1' : '',
      },
      comp_uid
    );
    if (!finYear && comp_code && comp_uid != null && String(comp_uid).trim() !== '') {
      const cd = await runCompdetHeaderRow(comp_code, comp_uid, comp_year);
      finYear = computeGFinYearFromCompdetRow(cd);
    }
    const first = rows[0] ?? null;
    const rowBType = first ? rowValueCI(first, 'b_type') : null;
    const rowPlantCode = first ? rowValueCI(first, 'plant_code') : null;
    const hasPlantKey = rowPlantCode != null && String(rowPlantCode).trim() !== '';
    const hasBTypeKey = rowBType != null && String(rowBType).trim() !== '';

    const saleCondQueries = [
      `SELECT cond1, cond2, cond3, cond4, cond5, cond6, cond7
       FROM sale_cond
       WHERE comp_code = :comp_code
         AND ROWNUM = 1`,
      `SELECT cond_1 AS cond1, cond_2 AS cond2, cond_3 AS cond3, cond_4 AS cond4, cond_5 AS cond5, cond_6 AS cond6, cond_7 AS cond7
       FROM sale_cond
       WHERE comp_code = :comp_code
         AND ROWNUM = 1`,
    ];
    const defValueSql = `
      SELECT god_print_in_sale, sale_logo, sale_logo2, signature_file, g_weight AS print_g_weight, wgt_k_q, g_weight_header, d_weight_header, g_rate_header
      FROM defvalue
      WHERE comp_code = :comp_code
        AND ROWNUM = 1`;

    const saleCondPromise = (async () => {
      for (const q of saleCondQueries) {
        const row = await runOptionalSingleRow(q, { comp_code }, [comp_uid, null]);
        if (row) return row;
      }
      return null;
    })();

    const captionPromise =
      first != null && (hasPlantKey || hasBTypeKey)
        ? fetchSaleBillDispatchCaptionRow(comp_code, rowPlantCode, rowBType, comp_uid)
        : Promise.resolve(null);

    const [saleCondRow, captionRow, defValueRow] = await Promise.all([
      saleCondPromise,
      captionPromise,
      runOptionalSingleRow(defValueSql, { comp_code }, [comp_uid, null]),
    ]);

    const extra = {
      ...(saleCondRow || {}),
      ...(captionRow || {}),
      ...(defValueRow || {}),
    };
    if (Object.keys(extra).length > 0) {
      for (const r of rows) {
        stripSalePrintImageFields(r);
        Object.assign(r, extra);
      }
    } else {
      for (const r of rows) stripSalePrintImageFields(r);
    }

    for (const r of rows) {
      const rq = parseFloat(rowValueCI(r, 'rate_qw'));
      const rr = parseFloat(rowValueCI(r, 'rate'));
      const rqOk = Number.isFinite(rq) && Math.abs(rq) > 0.000001;
      r.DISPLAY_RATE = rqOk ? rq : Number.isFinite(rr) ? rr : 0;
      if (finYear) {
        const inv = rowValueCI(r, 'sale_inv_no');
        if (inv == null || String(inv).trim() === '') {
          const bty = rowValueCI(r, 'b_type');
          const bn = rowValueCI(r, 'bill_no');
          if (bn != null && String(bn).trim() !== '') {
            const bts = bty != null ? String(bty).trim() : '';
            r.SALE_INV_NO = `${bts}/${finYear}/${String(bn).trim()}`;
          }
        }
      }
    }

    await drainOracleLobsInRows(rows);
    for (const r of rows) {
      normalizeRowBuffers(r);
      normalizeSignedQrColumn(r);
    }
    await hydrateSaleBillPrintImagesOnce(rows);
    console.log(
      `[sale-bill-print] ${String(comp_code)} bill_no=${String(bill_no)} date=${String(bill_date || '')} oracle_types=${ot || '-'} ${Date.now() - sbpT0}ms lines=${rows.length}`
    );
    res.json(rows);
  } catch (err) {
    console.error(
      `❌ Sale bill print error (${Date.now() - sbpT0}ms comp=${String(req.query?.comp_code)} bill=${String(req.query?.bill_no)}):`,
      err.message
    );
    res.status(500).json({ error: err.message });
  }
});

/** StockSum lookups */
app.get('/api/stock-sum-items', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    let rows = await runQuery(
      `SELECT ITEM_NAME, ITEM_CODE, CAT_CODE, R_F
       FROM ITEMMAST
       WHERE COMP_CODE = :comp_code
       ORDER BY ITEM_NAME`,
      { comp_code },
      comp_uid
    );
    if ((!rows || rows.length === 0) && comp_uid != null && String(comp_uid).trim() !== '') {
      rows = await runQuery(
        `SELECT ITEM_NAME, ITEM_CODE, CAT_CODE, R_F
         FROM ITEMMAST
         WHERE COMP_CODE = :comp_code
         ORDER BY ITEM_NAME`,
        { comp_code },
        null
      );
    }
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockSum items error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stock-sum-plants', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    let rows = await runQuery(
      `SELECT PLANT_NAME, PLANT_CODE
       FROM PLANT
       WHERE COMP_CODE = :comp_code
       ORDER BY PLANT_NAME`,
      { comp_code },
      comp_uid
    );
    if ((!rows || rows.length === 0) && comp_uid != null && String(comp_uid).trim() !== '') {
      rows = await runQuery(
        `SELECT PLANT_NAME, PLANT_CODE
         FROM PLANT
         WHERE COMP_CODE = :comp_code
         ORDER BY PLANT_NAME`,
        { comp_code },
        null
      );
    }
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockSum plants error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** New StockSum report (STOCK + ITEMMAST + CAT) */
app.get('/api/stock-sum', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, item_code, plant_code, cat_code, r_f } = req.query;
    const binds = {
      comp_code,
      s_date,
      e_date,
      item_code: String(item_code ?? '').trim(),
      plant_code: String(plant_code ?? '').trim(),
      cat_code: String(cat_code ?? '').trim(),
      r_f: String(r_f ?? '').trim().toUpperCase(),
    };
    const sql = `
      SELECT
        C.MAIN_CAT,
        B.CAT_CODE,
        A.ITEM_CODE,
        B.ITEM_NAME,
        A.PLANT_CODE,
        B.R_F,
        SUM(CASE WHEN TRUNC(A.VR_DATE) < TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) THEN NVL(A.R_WEIGHT,0) - NVL(A.I_WEIGHT,0) ELSE 0 END) AS OP_BALANCE,
        SUM(CASE WHEN TRUNC(A.VR_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) AND A.TYPE <> 'JR' AND A.TYPE <> 'PR' AND A.TYPE <> 'W' AND A.TYPE <> 'R' AND NVL(A.R_WEIGHT,0) <> 0 THEN NVL(A.R_WEIGHT,0) ELSE 0 END) AS PUR_WT,
        SUM(CASE WHEN TRUNC(A.VR_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) AND A.TYPE = 'PR' AND NVL(A.R_WEIGHT,0) <> 0 THEN NVL(A.R_WEIGHT,0) ELSE 0 END) AS PROD_WT,
        SUM(CASE WHEN TRUNC(A.VR_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) AND (A.TYPE = 'JR' OR A.TYPE = 'RR') AND NVL(A.R_WEIGHT,0) <> 0 THEN NVL(A.R_WEIGHT,0) ELSE 0 END) AS JB_WT,
        SUM(CASE WHEN TRUNC(A.VR_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) AND (A.TYPE = 'JI' OR A.TYPE = 'RI') THEN NVL(A.I_WEIGHT,0) ELSE 0 END) AS JI_WT,
        SUM(CASE WHEN TRUNC(A.VR_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) AND A.TYPE = 'PR' AND NVL(A.I_WEIGHT,0) <> 0 THEN NVL(A.I_WEIGHT,0) ELSE 0 END) AS MILLING_WT,
        SUM(CASE WHEN TRUNC(A.VR_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) AND A.TYPE <> 'PR' AND A.TYPE <> 'PI' AND A.TYPE <> 'JR' AND A.TYPE <> 'JI' AND A.TYPE <> 'RR' AND A.TYPE <> 'RI' AND NVL(A.I_WEIGHT,0) <> 0 THEN NVL(A.I_WEIGHT,0) ELSE 0 END) AS SALE_WT,
        SUM(CASE WHEN TRUNC(A.VR_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) AND A.TYPE = 'W' AND NVL(A.R_WEIGHT,0) <> 0 THEN NVL(A.R_WEIGHT,0) ELSE 0 END) AS CNOTE_WT,
        SUM(CASE WHEN TRUNC(A.VR_DATE) <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) THEN NVL(A.R_WEIGHT,0) - NVL(A.I_WEIGHT,0) ELSE 0 END) AS CL_WT
      FROM STOCK A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      LEFT JOIN CAT C ON B.COMP_CODE = C.COMP_CODE AND B.CAT_CODE = C.CAT_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.VR_DATE) <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND A.ITEM_CODE = NVL(NULLIF(:item_code, ''), A.ITEM_CODE)
        AND NVL(A.PLANT_CODE, '') = NVL(NULLIF(:plant_code, ''), NVL(A.PLANT_CODE, ''))
        AND NVL(B.CAT_CODE, '') = NVL(NULLIF(:cat_code, ''), NVL(B.CAT_CODE, ''))
        AND UPPER(NVL(B.R_F, '')) = NVL(NULLIF(:r_f, ''), UPPER(NVL(B.R_F, '')))
      GROUP BY C.MAIN_CAT, B.CAT_CODE, A.ITEM_CODE, B.ITEM_NAME, A.PLANT_CODE, B.R_F
      ORDER BY C.MAIN_CAT, B.CAT_CODE, A.ITEM_CODE`;
    const schemaAttempts =
      comp_uid != null && String(comp_uid).trim() !== '' ? [String(comp_uid).trim(), null] : [null];
    let rows = [];
    let usedSchema = null;
    for (const sch of schemaAttempts) {
      const got = await runQuery(sql, binds, sch);
      if (Array.isArray(got) && got.length > 0) {
        rows = got;
        usedSchema = sch;
        break;
      }
      if (rows.length === 0) rows = Array.isArray(got) ? got : [];
    }
    console.log(
      `[stock-sum] comp=${String(comp_code)} s=${String(s_date)} e=${String(e_date)} item=${binds.item_code || '-'} plant=${binds.plant_code || '-'} cat=${binds.cat_code || '-'} rf=${binds.r_f || '-'} rows=${rows.length} schema=${usedSchema == null ? 'hub' : usedSchema}`
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Stock sum error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock ledger drill-down for StockSum row click */
app.get('/api/stock-sum-ledger', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, item_code, plant_code } = req.query;
    const binds = {
      comp_code,
      s_date,
      e_date,
      item_code: String(item_code ?? '').trim(),
      plant_code: String(plant_code ?? '').trim(),
    };
    const sql = `
      SELECT
        C.MAIN_CAT,
        B.CAT_CODE,
        A.ITEM_CODE,
        B.ITEM_NAME,
        A.PLANT_CODE,
        B.R_F,
        A.VR_DATE,
        A.VR_NO,
        A.TYPE,
        A.B_TYPE,
        NVL(A.R_WEIGHT, 0) AS R_WEIGHT,
        NVL(A.I_WEIGHT, 0) AS I_WEIGHT,
        CASE WHEN A.TYPE <> 'JR' AND A.TYPE <> 'PR' AND A.TYPE <> 'W' AND A.TYPE <> 'R' AND NVL(A.R_WEIGHT,0) <> 0 THEN NVL(A.R_WEIGHT,0) ELSE 0 END AS PUR_WT,
        CASE WHEN A.TYPE = 'PR' AND NVL(A.R_WEIGHT,0) <> 0 THEN NVL(A.R_WEIGHT,0) ELSE 0 END AS PROD_WT,
        CASE WHEN (A.TYPE = 'JR' OR A.TYPE = 'RR') AND NVL(A.R_WEIGHT,0) <> 0 THEN NVL(A.R_WEIGHT,0) ELSE 0 END AS JB_WT,
        CASE WHEN (A.TYPE = 'JI' OR A.TYPE = 'RI') THEN NVL(A.I_WEIGHT,0) ELSE 0 END AS JI_WT,
        CASE WHEN A.TYPE = 'PR' AND NVL(A.I_WEIGHT,0) <> 0 THEN NVL(A.I_WEIGHT,0) ELSE 0 END AS MILLING_WT,
        CASE WHEN A.TYPE <> 'PR' AND A.TYPE <> 'PI' AND A.TYPE <> 'JR' AND A.TYPE <> 'JI' AND A.TYPE <> 'RR' AND A.TYPE <> 'RI' AND NVL(A.I_WEIGHT,0) <> 0 THEN NVL(A.I_WEIGHT,0) ELSE 0 END AS SALE_WT,
        CASE WHEN A.TYPE = 'W' AND NVL(A.R_WEIGHT,0) <> 0 THEN NVL(A.R_WEIGHT,0) ELSE 0 END AS CNOTE_WT,
        SUM(NVL(A.R_WEIGHT,0) - NVL(A.I_WEIGHT,0)) OVER (
          ORDER BY A.VR_DATE, A.VR_NO, A.TYPE, NVL(A.B_TYPE, ' ')
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS CL_BAL
      FROM STOCK A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      LEFT JOIN CAT C ON B.COMP_CODE = C.COMP_CODE AND B.CAT_CODE = C.CAT_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.VR_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND A.ITEM_CODE = NVL(NULLIF(:item_code, ''), A.ITEM_CODE)
        AND NVL(A.PLANT_CODE, '') = NVL(NULLIF(:plant_code, ''), NVL(A.PLANT_CODE, ''))
      ORDER BY C.MAIN_CAT, B.CAT_CODE, A.ITEM_CODE, A.VR_DATE, A.VR_NO`;
    const schemaAttempts =
      comp_uid != null && String(comp_uid).trim() !== '' ? [String(comp_uid).trim(), null] : [null];
    let rows = [];
    for (const sch of schemaAttempts) {
      const got = await runQuery(sql, binds, sch);
      if (Array.isArray(got) && got.length > 0) {
        rows = got;
        break;
      }
      if (rows.length === 0) rows = Array.isArray(got) ? got : [];
    }
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Stock sum ledger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock ledger line → PROD breakdown (Fox: TYPE PR / PI) */
app.get('/api/stock-sum-ledger-prod', async (req, res) => {
  try {
    const { comp_code, comp_uid, vr_date, vr_no } = req.query;
    const vno = String(vr_no ?? '').trim();
    if (!comp_code || !vr_date || !vno) {
      return res.status(400).json({ error: 'comp_code, vr_date, and vr_no are required' });
    }
    const sql = `
      SELECT
        A.S_DATE,
        A.S_NO,
        A.TRN_NO,
        A.PLANT_CODE,
        A.ITEM,
        B.ITEM_NAME AS ITEM_NAME_IN,
        A.M_QNTY,
        A.M_STATUS,
        A.MILLING AS M_WEIGHT,
        A.ITEM_CODE,
        C.ITEM_NAME AS ITEM_NAME_CODE,
        A.PROD_PER,
        A.QNTY AS PROD_QNTY,
        A.WEIGHT AS PROD_WEIGHT,
        A.SHORT
      FROM PROD A, ITEMMAST B, ITEMMAST C
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.S_DATE) = TRUNC(TO_DATE(:vr_date, 'DD-MM-YYYY'))
        AND TRIM(TO_CHAR(A.S_NO)) = TRIM(TO_CHAR(:vr_no))
        AND A.COMP_CODE = B.COMP_CODE
        AND A.ITEM = B.ITEM_CODE
        AND A.COMP_CODE = C.COMP_CODE
        AND A.ITEM_CODE = C.ITEM_CODE
      ORDER BY A.S_DATE, A.S_NO, A.TRN_NO`;
    const binds = { comp_code, vr_date, vr_no: vno };
    const schemaAttempts =
      comp_uid != null && String(comp_uid).trim() !== '' ? [String(comp_uid).trim(), null] : [null];
    let rows = [];
    for (const sch of schemaAttempts) {
      const got = await runQuery(sql, binds, sch);
      if (Array.isArray(got) && got.length > 0) {
        rows = got;
        break;
      }
      if (rows.length === 0) rows = Array.isArray(got) ? got : [];
    }
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Stock sum ledger PROD error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock ledger line → JOBWORK lines (Fox: JR→R, JI→I, RR→Y, RI→X) */
app.get('/api/stock-sum-ledger-jobwork', async (req, res) => {
  try {
    const { comp_code, comp_uid, mtype, r_date, r_no, b_type } = req.query;
    const mt = String(mtype ?? '').trim().toUpperCase();
    const rno = String(r_no ?? '').trim();
    const btRaw = b_type != null ? String(b_type).trim() : '';
    const bt = btRaw === '' ? ' ' : btRaw;
    if (!comp_code || !mt || !r_date || !rno) {
      return res.status(400).json({ error: 'comp_code, mtype, r_date, and r_no are required' });
    }
    const sql = `
      SELECT
        A.TYPE,
        A.R_DATE,
        A.R_NO,
        A.B_TYPE,
        A.TRN_NO,
        A.ITEM_CODE,
        B.ITEM_NAME,
        A.STATUS,
        A.QNTY,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT
      FROM JOBWORK A, ITEMMAST B
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:mtype)
        AND TRUNC(A.R_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY'))
        AND TRIM(TO_CHAR(A.R_NO)) = TRIM(TO_CHAR(:r_no))
        AND TRIM(NVL(A.B_TYPE, CHR(32))) = TRIM(NVL(:b_type, CHR(32)))
        AND A.COMP_CODE = B.COMP_CODE
        AND A.ITEM_CODE = B.ITEM_CODE
      ORDER BY A.R_DATE, A.R_NO, A.B_TYPE, A.TRN_NO`;
    const binds = { comp_code, mtype: mt, r_date, r_no: rno, b_type: bt };
    const schemaAttempts =
      comp_uid != null && String(comp_uid).trim() !== '' ? [String(comp_uid).trim(), null] : [null];
    let rows = [];
    for (const sch of schemaAttempts) {
      const got = await runQuery(sql, binds, sch);
      if (Array.isArray(got) && got.length > 0) {
        rows = got;
        break;
      }
      if (rows.length === 0) rows = Array.isArray(got) ? got : [];
    }
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Stock sum ledger JOBWORK error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock lot movements for one item (running balance computed on client) */
app.get('/api/stock-sum-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, item_code, e_date, god_code } = req.query;
    const ic = String(item_code ?? '').trim();
    if (!ic) return res.status(400).json({ error: 'item_code is required' });
    const gc = god_code != null ? String(god_code).trim() : '';
    const godAll = gc === '' ? 1 : 0;
    const sql = `
      SELECT
        A.VR_DATE,
        A.VR_NO,
        A.VR_TYPE,
        A.TYPE,
        A.ITEM_CODE,
        A.LOT,
        A.STATUS,
        A.B_NO,
        A.GOD_CODE,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS R_QNTY,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS S_QNTY,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS R_WEIGHT,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS S_WEIGHT,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS R_G_WEIGHT,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS SG_WEIGHT
      FROM LOTSTOCK A
      WHERE A.COMP_CODE = :comp_code
        AND A.ITEM_CODE = :item_code
        AND A.VR_DATE <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND (:god_all = 1 OR NVL(A.GOD_CODE, '') = :god_code)
      ORDER BY A.VR_DATE, A.VR_NO`;
    const binds = {
      comp_code,
      item_code: ic,
      e_date,
      god_all: godAll,
      god_code: gc,
    };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Stock sum detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock lot search helps */
app.get('/api/stocklot-godowns', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT GOD_CODE, GOD_NAME FROM GODOWN WHERE COMP_CODE = :comp_code ORDER BY GOD_CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot godowns error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stocklot-items', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT ITEM_NAME, ITEM_CODE FROM ITEMMAST WHERE COMP_CODE = :comp_code ORDER BY ITEM_NAME`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot items error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stocklot-suppliers', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT NAME, CITY, CODE FROM MASTER WHERE COMP_CODE = :comp_code ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot suppliers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stocklot-costs', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT COST_CODE, COST_NAME FROM COST WHERE COMP_CODE = :comp_code ORDER BY COST_CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot costs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock lot summary by item/lot/bikri no/supplier */
app.get('/api/stock-lot', async (req, res) => {
  try {
    const { comp_code, comp_uid, e_date, god_code, item_code, sup_code, b_no, lot, cost_code, c_o } = req.query;
    const god = String(god_code ?? '').trim();
    const item = String(item_code ?? '').trim();
    const sup = String(sup_code ?? '').trim();
    const bikri = String(b_no ?? '').trim();
    const lotNo = String(lot ?? '').trim();
    const cost = String(cost_code ?? '').trim();
    const co = String(c_o ?? 'C').trim().toUpperCase() === 'O' ? 'O' : 'C';

    const sql = `
      SELECT
        A.ITEM_CODE,
        A.LOT,
        A.B_NO,
        A.SUP_CODE,
        B.ITEM_NAME,
        C.NAME AS SUP_NAME,
        MAX(C.SCHEDULE) AS SCHEDULE,
        A.GOD_CODE,
        MAX(D.GOD_NAME) AS GOD_NAME,
        MIN(A.VR_DATE) AS VR_DATE,
        MAX(A.COST_CODE) AS COST_CODE,
        MAX(A.REMARKS) AS REMARKS,
        MAX(A.MSUP_CODE) AS MSUP_CODE,
        MAX(A.MSUP_NAME) AS MSUP_NAME,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END) AS QNTY,
        SUM(CASE
              WHEN A.STATUS = 'B' AND A.E_TYPE = 'R' THEN NVL(A.QNTY, 0)
              WHEN A.STATUS = 'B' AND NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) * -1
              ELSE 0
            END) AS BAGS,
        SUM(CASE
              WHEN A.STATUS = 'K' AND A.E_TYPE = 'R' THEN NVL(A.QNTY, 0)
              WHEN A.STATUS = 'K' AND NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) * -1
              ELSE 0
            END) AS KATTA,
        SUM(CASE
              WHEN A.STATUS = 'H' AND A.E_TYPE = 'R' THEN NVL(A.QNTY, 0)
              WHEN A.STATUS = 'H' AND NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) * -1
              ELSE 0
            END) AS HKATTA,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) * -1 END) AS WEIGHT,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.G_WEIGHT, 0) ELSE NVL(A.G_WEIGHT, 0) * -1 END) AS G_WEIGHT
      FROM LOTSTOCK A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.SUP_CODE = C.CODE
      LEFT JOIN GODOWN D ON A.COMP_CODE = D.COMP_CODE AND A.GOD_CODE = D.GOD_CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND (:item_all = 1 OR A.ITEM_CODE = :item_code)
        AND (:sup_all = 1 OR NVL(A.SUP_CODE, '') = :sup_code)
        AND (:god_all = 1 OR NVL(A.GOD_CODE, '') = :god_code)
        AND (:bno_all = 1 OR TRIM(TO_CHAR(A.B_NO)) = :b_no)
        AND (:lot_all = 1 OR NVL(TRIM(A.LOT), '') = :lot)
        AND (:cost_all = 1 OR NVL(TRIM(A.COST_CODE), '') = :cost_code)
      GROUP BY A.ITEM_CODE, A.LOT, A.B_NO, A.SUP_CODE, B.ITEM_NAME, C.NAME, A.GOD_CODE
      HAVING (:c_o = 'C' OR SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) * -1 END) <> 0)
      ORDER BY A.ITEM_CODE, A.LOT, MIN(A.VR_DATE)`;

    const binds = {
      comp_code,
      e_date,
      item_all: item === '' ? 1 : 0,
      item_code: item,
      sup_all: sup === '' ? 1 : 0,
      sup_code: sup,
      god_all: god === '' ? 1 : 0,
      god_code: god,
      bno_all: bikri === '' ? 1 : 0,
      b_no: bikri,
      lot_all: lotNo === '' ? 1 : 0,
      lot: lotNo,
      cost_all: cost === '' ? 1 : 0,
      cost_code: cost,
      c_o: co,
    };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock lot date-wise detail for one selected lot row */
app.get('/api/stock-lot-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, e_date, item_code, lot, b_no, sup_code, god_code, cost_code } = req.query;
    const item = String(item_code ?? '').trim();
    const lotNo = String(lot ?? '').trim();
    if (!item) return res.status(400).json({ error: 'item_code is required' });
    if (!lotNo) return res.status(400).json({ error: 'lot is required' });
    const bikri = String(b_no ?? '').trim();
    const sup = String(sup_code ?? '').trim();
    const god = String(god_code ?? '').trim();
    const cost = String(cost_code ?? '').trim();

    const sql = `
      SELECT
        A.VR_DATE,
        A.VR_NO,
        A.VR_TYPE,
        A.TYPE,
        A.ITEM_CODE,
        A.LOT,
        A.STATUS,
        A.B_NO,
        A.GOD_CODE,
        A.SUP_CODE,
        A.COST_CODE,
        A.REMARKS,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS R_QNTY,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS S_QNTY,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS R_WEIGHT,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS S_WEIGHT,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS R_G_WEIGHT,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS SG_WEIGHT
      FROM LOTSTOCK A
      WHERE A.COMP_CODE = :comp_code
        AND A.ITEM_CODE = :item_code
        AND NVL(TRIM(A.LOT), '') = :lot
        AND A.VR_DATE <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND (:bno_all = 1 OR TRIM(TO_CHAR(A.B_NO)) = :b_no)
        AND (:sup_all = 1 OR NVL(A.SUP_CODE, '') = :sup_code)
        AND (:god_all = 1 OR NVL(A.GOD_CODE, '') = :god_code)
        AND (:cost_all = 1 OR NVL(TRIM(A.COST_CODE), '') = :cost_code)
      ORDER BY A.VR_DATE, A.VR_NO`;

    const binds = {
      comp_code,
      item_code: item,
      lot: lotNo,
      e_date,
      bno_all: bikri === '' ? 1 : 0,
      b_no: bikri,
      sup_all: sup === '' ? 1 : 0,
      sup_code: sup,
      god_all: god === '' ? 1 : 0,
      god_code: god,
      cost_all: cost === '' ? 1 : 0,
      cost_code: cost,
    };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Purchase list search helps */
app.get('/api/purchaselist-suppliers', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT NAME, CITY, CODE FROM MASTER WHERE COMP_CODE = :comp_code ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ PurchaseList suppliers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchaselist-items', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT ITEM_NAME, ITEM_CODE FROM ITEMMAST WHERE COMP_CODE = :comp_code ORDER BY ITEM_NAME`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ PurchaseList items error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchaselist-purcodes', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT NAME, CITY, CODE FROM MASTER WHERE COMP_CODE = :comp_code AND ROUND(NVL(SCHEDULE,0), 2) = 11.20 ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ PurchaseList purchase codes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchaselist-plants', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT PLANT_NAME, PLANT_CODE FROM PLANT WHERE COMP_CODE = :comp_code ORDER BY PLANT_CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ PurchaseList plants error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Purchase list */
app.get('/api/purchase-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, type, s_date, e_date, code, item_code, bk_code, plant_code } = req.query;
    const typeVal = String(type ?? '').trim().toUpperCase();
    const validTypes = ['PU', 'DN', 'DX', 'CX', 'EV'];
    if (!validTypes.includes(typeVal)) {
      return res.status(400).json({ error: 'type is required (PU, DN, DX, CX, EV)' });
    }
    const item = String(item_code ?? '').trim();
    const supBind = parseMasterCodeForSql(code);
    const brokerBind = parseMasterCodeForSql(bk_code);
    const plant = String(plant_code ?? '').trim();
    const sql = `
      SELECT
        A.TYPE,
        A.R_DATE,
        A.R_NO,
        A.BILL_DATE,
        A.BILL_NO,
        A.V_DATE,
        A.STK_DATE,
        A.CODE,
        B.NAME,
        B.CITY,
        B.PAN,
        B.GST_NO,
        A.BK_CODE,
        A.BK_CODE AS B_CODE,
        C.NAME AS BK_NAME,
        A.PLANT_CODE,
        A.TRN_NO,
        A.P_CODE,
        A.ITEM_CODE,
        D.ITEM_NAME,
        A.QNTY,
        A.STATUS,
        A.WEIGHT,
        A.STK_WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.DIS_AMT,
        A.TAXABLE,
        A.CGST_AMT,
        A.SGST_AMT,
        A.IGST_AMT,
        A.BILL_AMT,
        A.NTDS_AMT AS TDS_AMT
      FROM PURCHASE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.BK_CODE = C.CODE
      LEFT JOIN ITEMMAST D ON A.COMP_CODE = D.COMP_CODE AND A.ITEM_CODE = D.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.TYPE = :type
        AND A.R_DATE BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND A.CODE = DECODE(:code, 0, NVL(A.CODE, 0), :code)
        AND A.BK_CODE = DECODE(:bk_code, 0, NVL(A.BK_CODE, 0), :bk_code)
        AND A.ITEM_CODE = DECODE(:item_code, '', A.ITEM_CODE, :item_code)
        AND A.PLANT_CODE = DECODE(:plant_code, '', A.PLANT_CODE, :plant_code)
      ORDER BY A.R_DATE, A.R_NO`;

    const binds = {
      comp_code,
      type: typeVal,
      s_date,
      e_date,
      item_code: item,
      code: supBind === undefined ? 0 : supBind,
      bk_code: brokerBind === undefined ? 0 : brokerBind,
      plant_code: plant,
    };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Purchase list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Cash/Bank/Journal voucher list from VOUCHER joined with MASTER. */
app.get('/api/voucher-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, vr_type, s_date, e_date, code, dc_code, drcr_flag } = req.query;
    if (!comp_code || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, s_date, and e_date are required' });
    }
    const vrType = String(vr_type ?? '').trim().toUpperCase();
    const codeBind = parseMasterCodeForSql(code);
    const dcCodeVal = String(dc_code ?? '').trim().toUpperCase();
    const drcr = String(drcr_flag ?? '').trim().toUpperCase();
    let sql = `
      SELECT
        A.VR_TYPE,
        A.VR_DATE,
        A.VR_NO,
        A.TYPE,
        A.TRN_NO,
        A.V_DATE,
        A.CODE,
        B.NAME,
        B.CITY,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.DETAIL,
        A.DR_AMT,
        A.CR_AMT,
        A.CD_AMT,
        A.DC_CODE
      FROM VOUCHER A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')`;

    if (vrType) sql += ` AND A.VR_TYPE = :vr_type`;
    if (codeBind !== undefined) sql += ` AND A.CODE = :code`;
    if (dcCodeVal) sql += ` AND A.DC_CODE = :dc_code`;
    if (drcr === 'D') sql += ` AND NVL(A.DR_AMT,0) <> 0`;
    else if (drcr === 'C') sql += ` AND NVL(A.CR_AMT,0) <> 0`;

    sql += ` ORDER BY A.VR_TYPE, A.VR_DATE, A.VR_NO, A.TRN_NO`;
    const binds = {
      comp_code,
      s_date,
      e_date,
    };
    if (vrType) binds.vr_type = vrType;
    if (codeBind !== undefined) binds.code = codeBind;
    if (dcCodeVal) binds.dc_code = dcCodeVal;

    // VOUCHER data may live in hub schema on some installs; try selected year schema first, then hub fallback.
    let rows = await runQuery(sql, binds, comp_uid);
    if ((!rows || rows.length === 0) && comp_uid) {
      rows = await runQuery(sql, binds, null, { suppressDbErrorLog: true });
    }
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Voucher list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Purchase bill / debit note — all lines for one voucher (TYPE + R_DATE + R_NO) */
app.get('/api/purchase-bill-print', async (req, res) => {
  try {
    const { comp_code, comp_uid, type, r_date, r_no } = req.query;
    const typ = String(type ?? '').trim();
    const rno = String(r_no ?? '').trim();
    if (!comp_code || !typ || !r_date || !rno) {
      return res.status(400).json({ error: 'comp_code, type, r_date, and r_no are required' });
    }
    const sql = `
      SELECT
        A.TYPE,
        A.R_DATE,
        A.R_NO,
        A.BILL_DATE,
        A.BILL_NO,
        A.V_DATE,
        A.STK_DATE,
        A.CODE,
        PRT.NAME,
        PRT.CITY,
        PRT.PAN,
        PRT.GST_NO,
        A.BK_CODE,
        BK.NAME AS BK_NAME,
        A.PLANT_CODE,
        A.TRN_NO,
        A.P_CODE,
        A.ITEM_CODE,
        IT.ITEM_NAME,
        A.QNTY,
        A.STATUS,
        A.WEIGHT,
        A.STK_WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.DIS_AMT,
        A.TAXABLE,
        A.CGST_AMT,
        A.SGST_AMT,
        A.IGST_AMT,
        A.DAMIAMT AS OTH_EXP_1,
        A.MFEE_AMT AS OTH_EXP_2,
        A.LABOUR AS LABOUR_EXP,
        A.FREIGHT AS FREIGHT_PAID,
        A.ADDEXP AS OTH_EXP_3,
        A.LESSEXP AS OTH_EXP_4,
        A.BILL_AMT,
        A.NTDS_AMT AS TDS_AMT,
        A.TRUCK,
        A.GR_NO,
        A.TPT
      FROM PURCHASE A
      JOIN MASTER PRT ON A.COMP_CODE = PRT.COMP_CODE AND A.CODE = PRT.CODE
      LEFT JOIN MASTER BK ON A.COMP_CODE = BK.COMP_CODE AND A.BK_CODE = BK.CODE
      LEFT JOIN ITEMMAST IT ON A.COMP_CODE = IT.COMP_CODE AND A.ITEM_CODE = IT.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND TRUNC(A.R_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY'))
        AND TRIM(TO_CHAR(A.R_NO)) = TRIM(TO_CHAR(:r_no))
      ORDER BY A.R_DATE, A.R_NO, A.TRN_NO`;
    const rows = await runQuery(sql, { comp_code, type: typ, r_date, r_no: rno }, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Purchase bill print error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function hsnNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function hsnTxt(v) {
  return String(v ?? '').trim();
}
function hsnRate(row) {
  return +(hsnNum(row.CGST_PER) + hsnNum(row.SGST_PER) + hsnNum(row.IGST_PER)).toFixed(2);
}
function hsnMonthKey(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const m = d.getMonth() + 1;
  return `${d.getFullYear()}-${String(m).padStart(2, '0')}`;
}
function hsnMonthNameFromKey(k) {
  const [y, m] = String(k || '').split('-');
  const mm = Number(m);
  const yy = Number(y);
  if (!Number.isFinite(mm) || !Number.isFinite(yy) || mm < 1 || mm > 12) return '';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[mm - 1]}-${yy}`;
}

function hsnYmdLocal(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hsnRoundLineRow(r) {
  return {
    TYPE: hsnTxt(r.TYPE),
    BILL_DATE: hsnTxt(r.BILL_DATE),
    BILL_NO: hsnTxt(r.BILL_NO),
    B_TYPE: hsnTxt(r.B_TYPE),
    CODE: hsnTxt(r.CODE),
    NAME: hsnTxt(r.NAME),
    GST_NO: hsnTxt(r.GST_NO),
    STATE_CODE: hsnTxt(r.STATE_CODE),
    STATE: hsnTxt(r.STATE),
    ITEM_CODE: hsnTxt(r.ITEM_CODE),
    ITEM_NAME: hsnTxt(r.ITEM_NAME),
    HSN_CODE: hsnTxt(r.HSN_CODE),
    HSN_UNIT: hsnTxt(r.HSN_UNIT),
    SCHEDULE: +hsnNum(r.SCHEDULE).toFixed(2),
    QNTY: +hsnNum(r.QNTY).toFixed(3),
    WEIGHT: +hsnNum(r.WEIGHT).toFixed(3),
    TAXABLE: +hsnNum(r.TAXABLE).toFixed(2),
    CGST_AMT: +hsnNum(r.CGST_AMT).toFixed(2),
    SGST_AMT: +hsnNum(r.SGST_AMT).toFixed(2),
    IGST_AMT: +hsnNum(r.IGST_AMT).toFixed(2),
    CGST_PER: +hsnNum(r.CGST_PER).toFixed(2),
    SGST_PER: +hsnNum(r.SGST_PER).toFixed(2),
    IGST_PER: +hsnNum(r.IGST_PER).toFixed(2),
  };
}

async function buildHsnSalesFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule }) {
  const codePartyBind = parseMasterCodeForSql(code);
  const { sql: murcSchSql, scheduleBind } = hsnMurcScheduleSqlFragment({ m_r_u_c, schedule });
  const saleSql = `
    SELECT
      A.TYPE,
      A.BILL_DATE,
      A.BILL_NO,
      NVL(A.B_TYPE, 'N') AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(C.ITEM_CODE, '') AS ITEM_CODE,
      NVL(C.ITEM_NAME, '') AS ITEM_NAME,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_UNIT, '') AS HSN_UNIT,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(A.TAXABLE, 0) AS TAXABLE,
      NVL(A.CGST_AMT, 0) AS CGST_AMT,
      NVL(A.SGST_AMT, 0) AS SGST_AMT,
      NVL(A.IGST_AMT, 0) AS IGST_AMT,
      NVL(A.CGST_PER, 0) AS CGST_PER,
      NVL(A.SGST_PER, 0) AS SGST_PER,
      NVL(A.IGST_PER, 0) AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM SALE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.CODE = D.CODE
    WHERE A.COMP_CODE = :comp_code
      AND A.BILL_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.BILL_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      ${codePartyBind !== undefined ? 'AND A.CODE = :code' : ''}${murcSchSql}`;

  const binds = { comp_code, s_date, e_date };
  if (codePartyBind !== undefined) binds.code = codePartyBind;
  if (scheduleBind !== undefined) binds.hsn_sch_no = scheduleBind;
  const saleRows = await runQuery(saleSql, binds, comp_uid);

  function hsnSaleTypeNum(raw) {
    const s = hsnTxt(raw);
    if (!s) return NaN;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : NaN;
  }
  function hsnSaleRowAllowed(rawType) {
    const n = hsnSaleTypeNum(rawType);
    if (Number.isFinite(n)) return [0, 1, 3, 4, 7, 8].includes(n);
    const u = hsnTxt(rawType).toUpperCase();
    return ['SL', 'SE', 'CN', 'GN', 'CX'].includes(u);
  }
  function hsnSaleRowSign(rawType) {
    const n = hsnSaleTypeNum(rawType);
    if (Number.isFinite(n)) return n === 4 || n === 8 ? -1 : 1;
    const u = hsnTxt(rawType).toUpperCase();
    return ['CN', 'GN'].includes(u) ? -1 : 1;
  }

  const filteredSaleRows = (saleRows || []).filter((r) => hsnSaleRowAllowed(r.TYPE));

  return [...filteredSaleRows].map((r) => {
    const type = hsnTxt(r.TYPE).toUpperCase();
    const sign = hsnSaleRowSign(r.TYPE);
    const hsn = hsnTxt(r.HSN_CODE) || hsnTxt(r.IHSN_CODE);
    const dt = new Date(r.BILL_DATE);
    return {
      TYPE: type,
      BILL_DATE: Number.isNaN(dt.getTime()) ? '' : hsnYmdLocal(dt),
      BILL_NO: hsnTxt(r.BILL_NO),
      B_TYPE: hsnTxt(r.B_TYPE || 'N'),
      CODE: hsnTxt(r.CODE),
      NAME: hsnTxt(r.NAME),
      GST_NO: hsnTxt(r.GST_NO),
      STATE_CODE: hsnTxt(r.STATE_CODE),
      STATE: hsnTxt(r.STATE),
      ITEM_CODE: hsnTxt(r.ITEM_CODE),
      ITEM_NAME: hsnTxt(r.ITEM_NAME),
      HSN_CODE: hsn,
      HSN_UNIT: hsnTxt(r.HSN_UNIT),
      SCHEDULE: hsnNum(r.SCHEDULE),
      QNTY: sign * hsnNum(r.QNTY),
      WEIGHT: sign * hsnNum(r.WEIGHT),
      TAXABLE: sign * hsnNum(r.TAXABLE),
      CGST_AMT: sign * hsnNum(r.CGST_AMT),
      SGST_AMT: sign * hsnNum(r.SGST_AMT),
      IGST_AMT: sign * hsnNum(r.IGST_AMT),
      CGST_PER: hsnNum(r.CGST_PER),
      SGST_PER: hsnNum(r.SGST_PER),
      IGST_PER: hsnNum(r.IGST_PER),
      TAX_RATE: hsnRate(r),
      MONTH_KEY: Number.isNaN(dt.getTime()) ? '' : hsnMonthKey(dt),
      MONTH: Number.isNaN(dt.getTime()) ? '' : hsnMonthNameFromKey(hsnMonthKey(dt)),
    };
  });
}

async function buildHsnSalesSummaryRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule }) {
  const codePartyBind = parseMasterCodeForSql(code);
  const { sql: murcSchSql, scheduleBind } = hsnMurcScheduleSqlFragment({ m_r_u_c, schedule });
  const saleSql = `
    SELECT
      A.TYPE,
      A.BILL_DATE,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(A.TAXABLE, 0) AS TAXABLE,
      NVL(A.CGST_AMT, 0) AS CGST_AMT,
      NVL(A.SGST_AMT, 0) AS SGST_AMT,
      NVL(A.IGST_AMT, 0) AS IGST_AMT,
      NVL(A.CGST_PER, 0) AS CGST_PER,
      NVL(A.SGST_PER, 0) AS SGST_PER,
      NVL(A.IGST_PER, 0) AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM SALE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.CODE = D.CODE
    WHERE A.COMP_CODE = :comp_code
      AND A.BILL_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.BILL_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      ${codePartyBind !== undefined ? 'AND A.CODE = :code' : ''}${murcSchSql}`;

  const binds = { comp_code, s_date, e_date };
  if (codePartyBind !== undefined) binds.code = codePartyBind;
  if (scheduleBind !== undefined) binds.hsn_sch_no = scheduleBind;
  const saleRows = await runQuery(saleSql, binds, comp_uid);

  function hsnSaleTypeNum(raw) {
    const s = hsnTxt(raw);
    if (!s) return NaN;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : NaN;
  }
  function hsnSaleRowAllowed(rawType) {
    const n = hsnSaleTypeNum(rawType);
    if (Number.isFinite(n)) return [0, 1, 3, 4, 7, 8].includes(n);
    const u = hsnTxt(rawType).toUpperCase();
    return ['SL', 'SE', 'CN', 'GN', 'CX'].includes(u);
  }
  function hsnSaleRowSign(rawType) {
    const n = hsnSaleTypeNum(rawType);
    if (Number.isFinite(n)) return n === 4 || n === 8 ? -1 : 1;
    const u = hsnTxt(rawType).toUpperCase();
    return ['CN', 'GN'].includes(u) ? -1 : 1;
  }

  const filteredSaleRows = (saleRows || []).filter((r) => hsnSaleRowAllowed(r.TYPE));

  return [...filteredSaleRows].map((r) => {
    const type = hsnTxt(r.TYPE).toUpperCase();
    const sign = hsnSaleRowSign(r.TYPE);
    const hsn = hsnTxt(r.HSN_CODE) || hsnTxt(r.IHSN_CODE);
    const dt = new Date(r.BILL_DATE);
    return {
      TYPE: type,
      BILL_DATE: Number.isNaN(dt.getTime()) ? '' : hsnYmdLocal(dt),
      HSN_CODE: hsn,
      SCHEDULE: hsnNum(r.SCHEDULE),
      GST_NO: hsnTxt(r.GST_NO),
      QNTY: sign * hsnNum(r.QNTY),
      WEIGHT: sign * hsnNum(r.WEIGHT),
      TAXABLE: sign * hsnNum(r.TAXABLE),
      CGST_AMT: sign * hsnNum(r.CGST_AMT),
      SGST_AMT: sign * hsnNum(r.SGST_AMT),
      IGST_AMT: sign * hsnNum(r.IGST_AMT),
      CGST_PER: hsnNum(r.CGST_PER),
      SGST_PER: hsnNum(r.SGST_PER),
      IGST_PER: hsnNum(r.IGST_PER),
      TAX_RATE: hsnRate(r),
      MONTH_KEY: Number.isNaN(dt.getTime()) ? '' : hsnMonthKey(dt),
      MONTH: Number.isNaN(dt.getTime()) ? '' : hsnMonthNameFromKey(hsnMonthKey(dt)),
    };
  });
}

/** Extra WHERE lines for SALE/DBIKRI/JOBWORK (party = B, schedule supplier = D). Matches applyHsnBaseFilters. */
function hsnMurcScheduleSqlFragment({ m_r_u_c, schedule }) {
  const murc = hsnTxt(m_r_u_c || 'C').toUpperCase().slice(0, 1);
  const schNo = Number(schedule);
  const schFilterOn = Number.isFinite(schNo) && schNo !== 0;
  const lines = [];
  if (murc === 'R') lines.push("AND NVL(TRIM(B.GST_NO), '') <> ''");
  else if (murc === 'U') lines.push("AND NVL(TRIM(B.GST_NO), '') = ''");
  if (schFilterOn) lines.push('AND NVL(D.SCHEDULE, 0) = :hsn_sch_no');
  return {
    sql: lines.length ? `\n      ${lines.join('\n      ')}` : '',
    scheduleBind: schFilterOn ? schNo : undefined,
  };
}

function applyHsnBaseFilters(baseRows, { m_r_u_c, schedule }) {
  const murc = hsnTxt(m_r_u_c || 'C').toUpperCase().slice(0, 1);
  const schNo = Number(schedule);
  const schFilterOn = Number.isFinite(schNo) && schNo !== 0;
  let filtered = Array.isArray(baseRows) ? baseRows : [];
  if (schFilterOn) filtered = filtered.filter((r) => hsnNum(r.SCHEDULE) === schNo);
  if (murc === 'R') filtered = filtered.filter((r) => hsnTxt(r.GST_NO) !== '');
  if (murc === 'U') filtered = filtered.filter((r) => hsnTxt(r.GST_NO) === '');
  return filtered;
}

function hsnFastCmp(a, b) {
  const aa = hsnTxt(a);
  const bb = hsnTxt(b);
  if (aa === bb) return 0;
  return aa < bb ? -1 : 1;
}

/** HSN Sales report with 3 tab views: date-wise, monthly hsn-wise, hsn-wise monthly. */
app.get('/api/hsn-sales', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }

    const base = await buildHsnSalesSummaryRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule });

    const monthlyHsnMap = new Map();
    const hsnMonthlyMap = new Map();
    filtered.forEach((r) => {
      const mKey = hsnTxt(r.MONTH_KEY);
      if (!mKey) return;

      const mhKey = `${mKey}|${r.HSN_CODE}|${r.TAX_RATE}`;
      const mhRow = monthlyHsnMap.get(mhKey) || {
        MONTH: hsnMonthNameFromKey(mKey),
        MONTH_KEY: mKey,
        HSN_CODE: r.HSN_CODE,
        TAX_RATE: r.TAX_RATE,
        QNTY: 0,
        WEIGHT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
      };
      mhRow.QNTY += r.QNTY;
      mhRow.WEIGHT += r.WEIGHT;
      mhRow.TAXABLE += r.TAXABLE;
      mhRow.CGST_AMT += r.CGST_AMT;
      mhRow.SGST_AMT += r.SGST_AMT;
      mhRow.IGST_AMT += r.IGST_AMT;
      monthlyHsnMap.set(mhKey, mhRow);

      const hmKey = `${r.HSN_CODE}|${mKey}|${r.TAX_RATE}`;
      const hmRow = hsnMonthlyMap.get(hmKey) || {
        HSN_CODE: r.HSN_CODE,
        MONTH: hsnMonthNameFromKey(mKey),
        MONTH_KEY: mKey,
        TAX_RATE: r.TAX_RATE,
        QNTY: 0,
        WEIGHT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
      };
      hmRow.QNTY += r.QNTY;
      hmRow.WEIGHT += r.WEIGHT;
      hmRow.TAXABLE += r.TAXABLE;
      hmRow.CGST_AMT += r.CGST_AMT;
      hmRow.SGST_AMT += r.SGST_AMT;
      hmRow.IGST_AMT += r.IGST_AMT;
      hsnMonthlyMap.set(hmKey, hmRow);
    });

    const roundRows = (rows) =>
      rows.map((r) => ({
        ...r,
        QNTY: +hsnNum(r.QNTY).toFixed(3),
        WEIGHT: +hsnNum(r.WEIGHT).toFixed(3),
        TAXABLE: +hsnNum(r.TAXABLE).toFixed(2),
        CGST_AMT: +hsnNum(r.CGST_AMT).toFixed(2),
        SGST_AMT: +hsnNum(r.SGST_AMT).toFixed(2),
        IGST_AMT: +hsnNum(r.IGST_AMT).toFixed(2),
        TAX_RATE: +hsnNum(r.TAX_RATE).toFixed(2),
      }));

    const monthlyHsnWise = roundRows(Array.from(monthlyHsnMap.values())).sort(
      (a, b) =>
        hsnFastCmp(a.MONTH_KEY, b.MONTH_KEY) ||
        hsnFastCmp(a.HSN_CODE, b.HSN_CODE) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );
    const hsnWiseMonthly = roundRows(Array.from(hsnMonthlyMap.values())).sort(
      (a, b) =>
        hsnFastCmp(a.HSN_CODE, b.HSN_CODE) ||
        hsnFastCmp(a.MONTH_KEY, b.MONTH_KEY) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );

    res.json({
      ok: true,
      sheets: {
        dateWise: [],
        monthlyHsnWise: monthlyHsnWise.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
        hsnWiseMonthly: hsnWiseMonthly.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
      },
      dateWiseDeferred: true,
    });
  } catch (err) {
    console.error('❌ HSN sales error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-sales-datewise', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const base = await buildHsnSalesFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule });
    const rows = filtered
      .map(hsnRoundLineRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.B_TYPE, b.B_TYPE) ||
          hsnFastCmp(a.ITEM_CODE, b.ITEM_CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ HSN sales datewise error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-sales-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code, tab, month, hsn_code, tax_rate } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const tabName = hsnTxt(tab);
    if (!['monthlyHsnWise', 'hsnWiseMonthly'].includes(tabName)) {
      return res.status(400).json({ error: "tab must be 'monthlyHsnWise' or 'hsnWiseMonthly'" });
    }
    const monthKey = hsnTxt(month);
    const hsnCode = hsnTxt(hsn_code);
    const taxRate = hsnNum(tax_rate);
    if (!monthKey || !hsnCode) {
      return res.status(400).json({ error: 'month and hsn_code are required' });
    }
    const base = await buildHsnSalesFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule }).filter(
      (r) =>
        hsnTxt(r.MONTH_KEY) === monthKey &&
        hsnTxt(r.HSN_CODE) === hsnCode &&
        Math.abs(hsnNum(r.TAX_RATE) - taxRate) < 0.0001
    );
    const rows = filtered
      .map(hsnRoundLineRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.B_TYPE, b.B_TYPE) ||
          hsnFastCmp(a.ITEM_CODE, b.ITEM_CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ HSN sales detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-sales-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || !comp_uid) return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    const rows = await runQuery(
      `SELECT CODE, NAME, CITY FROM MASTER WHERE COMP_CODE = :comp_code ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ HSN sales parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function buildHsnPurchaseFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule }) {
  const codePartyBind = parseMasterCodeForSql(code);
  const { sql: murcSchSql, scheduleBind } = hsnMurcScheduleSqlFragment({ m_r_u_c, schedule });
  const sql = `
    SELECT
      A.TYPE,
      A.R_DATE AS BILL_DATE,
      A.R_NO AS BILL_NO,
      'N' AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(C.ITEM_CODE, '') AS ITEM_CODE,
      NVL(C.ITEM_NAME, '') AS ITEM_NAME,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_UNIT, '') AS HSN_UNIT,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(A.TAXABLE, 0) AS TAXABLE,
      NVL(A.CGST_AMT, 0) AS CGST_AMT,
      NVL(A.SGST_AMT, 0) AS SGST_AMT,
      NVL(A.IGST_AMT, 0) AS IGST_AMT,
      NVL(A.CGST_PER, 0) AS CGST_PER,
      NVL(A.SGST_PER, 0) AS SGST_PER,
      NVL(A.IGST_PER, 0) AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT,
      CAST(NULL AS VARCHAR2(1)) AS S_P
    FROM PURCHASE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.P_CODE = D.CODE
    WHERE A.COMP_CODE = :comp_code
      AND A.R_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.R_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      AND (
        UPPER(TRIM(A.TYPE)) = 'PU'
        OR (UPPER(TRIM(A.TYPE)) = 'EV' AND NVL(A.INPUT_YN,'Y') = 'Y')
        OR UPPER(TRIM(A.TYPE)) = 'DN'
        OR (UPPER(TRIM(A.TYPE)) = 'DX' AND NVL(A.INPUT_YN,'Y') <> 'N')
        OR (UPPER(TRIM(A.TYPE)) = 'CX' AND NVL(A.INPUT_YN,'Y') <> 'N')
      )
      ${codePartyBind !== undefined ? 'AND A.CODE = :code' : ''}${murcSchSql}`;
  const binds = { comp_code, s_date, e_date };
  if (codePartyBind !== undefined) binds.code = codePartyBind;
  if (scheduleBind !== undefined) binds.hsn_sch_no = scheduleBind;
  const rows = await runQuery(sql, binds, comp_uid);
  return (rows || []).map((r) => {
    const type = hsnTxt(r.TYPE).toUpperCase();
    const sp = hsnTxt(r.S_P).toUpperCase();
    const qtySign = type === 'DN' || type === 'DX' ? -1 : 1;
    const taxableSign = (type !== 'DN' && type !== 'DX') || (type === 'CX' && sp === 'P') ? 1 : -1;
    const hsn = hsnTxt(r.HSN_CODE) || hsnTxt(r.IHSN_CODE);
    const dt = new Date(r.BILL_DATE);
    return {
      TYPE: type,
      BILL_DATE: Number.isNaN(dt.getTime()) ? '' : hsnYmdLocal(dt),
      BILL_NO: hsnTxt(r.BILL_NO),
      B_TYPE: hsnTxt(r.B_TYPE || 'N'),
      CODE: hsnTxt(r.CODE),
      NAME: hsnTxt(r.NAME),
      GST_NO: hsnTxt(r.GST_NO),
      STATE_CODE: hsnTxt(r.STATE_CODE),
      STATE: hsnTxt(r.STATE),
      ITEM_CODE: hsnTxt(r.ITEM_CODE),
      ITEM_NAME: hsnTxt(r.ITEM_NAME),
      HSN_CODE: hsn,
      HSN_UNIT: hsnTxt(r.HSN_UNIT),
      SCHEDULE: hsnNum(r.SCHEDULE),
      QNTY: qtySign * hsnNum(r.QNTY),
      WEIGHT: qtySign * hsnNum(r.WEIGHT),
      TAXABLE: taxableSign * hsnNum(r.TAXABLE),
      CGST_AMT: qtySign * hsnNum(r.CGST_AMT),
      SGST_AMT: qtySign * hsnNum(r.SGST_AMT),
      IGST_AMT: qtySign * hsnNum(r.IGST_AMT),
      CGST_PER: hsnNum(r.CGST_PER),
      SGST_PER: hsnNum(r.SGST_PER),
      IGST_PER: hsnNum(r.IGST_PER),
      TAX_RATE: hsnRate(r),
      MONTH_KEY: Number.isNaN(dt.getTime()) ? '' : hsnMonthKey(dt),
      MONTH: Number.isNaN(dt.getTime()) ? '' : hsnMonthNameFromKey(hsnMonthKey(dt)),
    };
  });
}

async function buildHsnPurchaseSummaryRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule }) {
  const full = await buildHsnPurchaseFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
  return full.map((r) => ({
    TYPE: r.TYPE,
    BILL_DATE: r.BILL_DATE,
    HSN_CODE: r.HSN_CODE,
    SCHEDULE: r.SCHEDULE,
    GST_NO: r.GST_NO,
    QNTY: r.QNTY,
    WEIGHT: r.WEIGHT,
    TAXABLE: r.TAXABLE,
    CGST_AMT: r.CGST_AMT,
    SGST_AMT: r.SGST_AMT,
    IGST_AMT: r.IGST_AMT,
    CGST_PER: r.CGST_PER,
    SGST_PER: r.SGST_PER,
    IGST_PER: r.IGST_PER,
    TAX_RATE: r.TAX_RATE,
    MONTH_KEY: r.MONTH_KEY,
    MONTH: r.MONTH,
  }));
}

/** HSN Purchase report with 3 tab views: date-wise, monthly hsn-wise, hsn-wise monthly. */
app.get('/api/hsn-purchase', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const base = await buildHsnPurchaseSummaryRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule });
    const monthlyHsnMap = new Map();
    const hsnMonthlyMap = new Map();
    filtered.forEach((r) => {
      const mKey = hsnTxt(r.MONTH_KEY);
      if (!mKey) return;
      const mhKey = `${mKey}|${r.HSN_CODE}|${r.TAX_RATE}`;
      const mhRow = monthlyHsnMap.get(mhKey) || {
        MONTH: hsnMonthNameFromKey(mKey),
        MONTH_KEY: mKey,
        HSN_CODE: r.HSN_CODE,
        TAX_RATE: r.TAX_RATE,
        QNTY: 0,
        WEIGHT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
      };
      mhRow.QNTY += r.QNTY;
      mhRow.WEIGHT += r.WEIGHT;
      mhRow.TAXABLE += r.TAXABLE;
      mhRow.CGST_AMT += r.CGST_AMT;
      mhRow.SGST_AMT += r.SGST_AMT;
      mhRow.IGST_AMT += r.IGST_AMT;
      monthlyHsnMap.set(mhKey, mhRow);

      const hmKey = `${r.HSN_CODE}|${mKey}|${r.TAX_RATE}`;
      const hmRow = hsnMonthlyMap.get(hmKey) || {
        HSN_CODE: r.HSN_CODE,
        MONTH: hsnMonthNameFromKey(mKey),
        MONTH_KEY: mKey,
        TAX_RATE: r.TAX_RATE,
        QNTY: 0,
        WEIGHT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
      };
      hmRow.QNTY += r.QNTY;
      hmRow.WEIGHT += r.WEIGHT;
      hmRow.TAXABLE += r.TAXABLE;
      hmRow.CGST_AMT += r.CGST_AMT;
      hmRow.SGST_AMT += r.SGST_AMT;
      hmRow.IGST_AMT += r.IGST_AMT;
      hsnMonthlyMap.set(hmKey, hmRow);
    });
    const roundRows = (rows) =>
      rows.map((r) => ({
        ...r,
        QNTY: +hsnNum(r.QNTY).toFixed(3),
        WEIGHT: +hsnNum(r.WEIGHT).toFixed(3),
        TAXABLE: +hsnNum(r.TAXABLE).toFixed(2),
        CGST_AMT: +hsnNum(r.CGST_AMT).toFixed(2),
        SGST_AMT: +hsnNum(r.SGST_AMT).toFixed(2),
        IGST_AMT: +hsnNum(r.IGST_AMT).toFixed(2),
        TAX_RATE: +hsnNum(r.TAX_RATE).toFixed(2),
      }));
    const monthlyHsnWise = roundRows(Array.from(monthlyHsnMap.values())).sort(
      (a, b) =>
        hsnFastCmp(a.MONTH_KEY, b.MONTH_KEY) ||
        hsnFastCmp(a.HSN_CODE, b.HSN_CODE) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );
    const hsnWiseMonthly = roundRows(Array.from(hsnMonthlyMap.values())).sort(
      (a, b) =>
        hsnFastCmp(a.HSN_CODE, b.HSN_CODE) ||
        hsnFastCmp(a.MONTH_KEY, b.MONTH_KEY) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );
    res.json({
      ok: true,
      sheets: {
        dateWise: [],
        monthlyHsnWise: monthlyHsnWise.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
        hsnWiseMonthly: hsnWiseMonthly.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
      },
      dateWiseDeferred: true,
    });
  } catch (err) {
    console.error('❌ HSN purchase error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-purchase-datewise', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const base = await buildHsnPurchaseFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule });
    const rows = filtered
      .map(hsnRoundLineRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.B_TYPE, b.B_TYPE) ||
          hsnFastCmp(a.ITEM_CODE, b.ITEM_CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ HSN purchase datewise error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-purchase-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code, tab, month, hsn_code, tax_rate } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const tabName = hsnTxt(tab);
    if (!['monthlyHsnWise', 'hsnWiseMonthly'].includes(tabName)) {
      return res.status(400).json({ error: "tab must be 'monthlyHsnWise' or 'hsnWiseMonthly'" });
    }
    const monthKey = hsnTxt(month);
    const hsnCode = hsnTxt(hsn_code);
    const taxRate = hsnNum(tax_rate);
    if (!monthKey || !hsnCode) {
      return res.status(400).json({ error: 'month and hsn_code are required' });
    }
    const base = await buildHsnPurchaseFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule }).filter(
      (r) =>
        hsnTxt(r.MONTH_KEY) === monthKey &&
        hsnTxt(r.HSN_CODE) === hsnCode &&
        Math.abs(hsnNum(r.TAX_RATE) - taxRate) < 0.0001
    );
    const rows = filtered
      .map(hsnRoundLineRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.B_TYPE, b.B_TYPE) ||
          hsnFastCmp(a.ITEM_CODE, b.ITEM_CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ HSN purchase detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-purchase-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || !comp_uid) return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    const rows = await runQuery(
      `SELECT CODE, NAME, CITY FROM MASTER WHERE COMP_CODE = :comp_code ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ HSN purchase parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Trading A/C summary (API for new Trading A/C button). */
app.get('/api/trading-ac-accounts', async (req, res) => {
  try {
    const { comp_code, comp_uid, schedule } = req.query;
    if (!comp_code || !comp_uid || !schedule) {
      return res.status(400).json({ error: 'comp_code, comp_uid, schedule are required' });
    }
    const scheduleNumRaw = Number(String(schedule).trim());
    const scheduleNum = Number.isFinite(scheduleNumRaw) ? scheduleNumRaw : 0;
    let rows = await runQuery(
      `
      SELECT CODE, NVL(NAME,'') AS NAME
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
      ORDER BY UPPER(NVL(NAME,'')), CODE
      `,
      { comp_code, schedule_num: scheduleNum },
      comp_uid
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      rows = await runQuery(
        `
        SELECT CODE, NVL(NAME,'') AS NAME
        FROM MASTER
        WHERE COMP_CODE = :comp_code
          AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
        ORDER BY UPPER(NVL(NAME,'')), CODE
        `,
        { comp_code, schedule_num: scheduleNum },
        null,
        { suppressDbErrorLog: true }
      );
    }
    res.json({ ok: true, rows: rows || [] });
  } catch (err) {
    console.error('❌ Trading account list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trading-ac', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      schedule,
      code,
      edt,
      tdg_type,
      // accepted for parity with VFP call signature
      mcb,
      mwyn,
      cat_code_yn,
      m_short_pick,
      mfyn,
      manual_confirmed,
    } = req.query;
    void mcb;
    void mwyn;
    void cat_code_yn;
    void m_short_pick;
    void mfyn;

    if (!comp_code || !comp_uid || !edt) {
      return res.status(400).json({ error: 'comp_code, comp_uid, edt are required' });
    }

    const eDate = parseDateOnly(edt);
    if (!eDate) {
      return res.status(400).json({ error: 'edt must be a valid date (DD-MM-YYYY or YYYY-MM-DD)' });
    }
    const compdet = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!compdet) {
      return res.status(400).json({ error: 'Unable to resolve compdet row for comp_code / comp_uid' });
    }
    const sDate = parseDateOnly(compdet.COMP_S_DT ?? compdet.comp_s_dt);
    if (!sDate) {
      return res.status(400).json({ error: 'COMP_S_DT not found for selected company/year' });
    }

    const scheduleInput = String(schedule ?? '').trim();
    const scheduleNumRaw = Number(scheduleInput);
    const scheduleNum = Number.isFinite(scheduleNumRaw) ? scheduleNumRaw : 0;
    const scheduleTxt = scheduleInput
      ? (Number.isFinite(scheduleNumRaw) ? scheduleNumRaw.toFixed(2) : scheduleInput)
      : '';
    const codeFilterN = parseMasterCodeForSql(code);
    const codeFilterSql = codeFilterN === undefined ? null : codeFilterN;
    const mfynMode = String(mfyn || 'A').trim().toUpperCase();
    const manualConfirmed = String(manual_confirmed || 'N').trim().toUpperCase() === 'Y';
    const tdgTypeMode = String(tdg_type || 'C').trim().toUpperCase() === 'I' ? 'I' : 'C';
    const consolidateKey = `${String(comp_code || '').trim()}|${String(comp_uid || '').trim()}`;
    const consolidateOverride = Number(tradingConsolidateOverride.get(consolidateKey) ?? NaN);
    const needLedgerBase = mfynMode === 'A' && codeFilterN === undefined ? 1 : 0;
    void needLedgerBase;

    if (tdgTypeMode === 'I') {
      const seedRows = await runQuery(
        `
        SELECT
          NVL(A.CAT_CODE,'') AS CAT_CODE,
          A.ITEM_CODE,
          NVL(A.ITEM_NAME,'') AS ITEM_NAME,
          SUM(NVL(C.R_WEIGHT,0)-NVL(C.I_WEIGHT,0)) AS CL_WGT,
          MAX(NVL(B.RATE,0)) AS RATE,
          MAX(NVL(B.AMOUNT,0)) AS AMOUNT,
          MAX(NVL(A.S_CODE,0)) AS S_CODE,
          MAX(NVL(A.P_CODE,0)) AS P_CODE,
          MAX(NVL(A.CAT,'')) AS CAT
        FROM ITEMMAST A
        LEFT JOIN CLSTOCK B
          ON A.COMP_CODE = B.COMP_CODE
         AND A.ITEM_CODE = B.ITEM_CODE
        LEFT JOIN STOCK C
          ON A.COMP_CODE = C.COMP_CODE
         AND A.ITEM_CODE = C.ITEM_CODE
        WHERE A.COMP_CODE = :comp_code
          AND (C.VR_DATE IS NULL OR C.VR_DATE <= :e_date)
        GROUP BY A.CAT_CODE, A.ITEM_CODE, A.ITEM_NAME
        ORDER BY A.CAT_CODE, A.ITEM_CODE
        `,
        { comp_code, e_date: eDate },
        comp_uid
      );
      if (!manualConfirmed) {
        return res.json({
          ok: true,
          requiresManualEntry: true,
          rows: (seedRows || []).map((r) => ({
            CAT_CODE: String(r.CAT_CODE || ''),
            ITEM_CODE: String(r.ITEM_CODE || ''),
            ITEM_NAME: String(r.ITEM_NAME || ''),
            CL_WGT: Number(r.CL_WGT) || 0,
            RATE: Number(r.RATE) || 0,
            AMOUNT: Number(r.AMOUNT) || 0,
            S_CODE: Number(r.S_CODE) || 0,
            P_CODE: Number(r.P_CODE) || 0,
            CAT: String(r.CAT || ''),
          })),
          debug: { comp_code, comp_uid, tdg_type: tdgTypeMode, seed_count: (seedRows || []).length },
        });
      }

      const itemRows = await runQuery(
        `
        SELECT
          NVL(A.CAT_CODE,'') AS CAT_CODE,
          A.ITEM_CODE,
          NVL(B.ITEM_NAME,'') AS ITEM_NAME,
          NVL(A.P_CODE,0) AS P_CODE,
          NVL(A.S_CODE,0) AS S_CODE,
          MAX(NVL(A.RATE,0)) AS RATE,
          MAX(NVL(A.CL_WGT,0)) AS CL_WGT,
          MAX(NVL(A.AMOUNT,0)) AS CL_AMT,
          MAX(NVL(B.R_F,'F')) AS R_F,
          SUM(CASE WHEN C.TYPE='OP' THEN NVL(C.R_WEIGHT,0) ELSE 0 END) AS OPWGT,
          SUM(CASE WHEN C.TYPE='OP' THEN NVL(C.AMOUNT,0) ELSE 0 END) AS OPAMT,
          SUM(CASE WHEN C.VR_DATE >= :s_date THEN NVL(C.R_WEIGHT,0) ELSE 0 END) AS PWGT,
          SUM(CASE WHEN C.VR_DATE >= :s_date THEN NVL(C.I_WEIGHT,0) ELSE 0 END) AS SWGT
        FROM CLSTOCK A
        JOIN ITEMMAST B
          ON A.COMP_CODE = B.COMP_CODE
         AND A.ITEM_CODE = B.ITEM_CODE
        LEFT JOIN STOCK C
          ON A.COMP_CODE = C.COMP_CODE
         AND A.ITEM_CODE = C.ITEM_CODE
        WHERE A.COMP_CODE = :comp_code
        GROUP BY A.CAT_CODE, A.ITEM_CODE, B.ITEM_NAME, A.P_CODE, A.S_CODE
        `,
        { comp_code, s_date: sDate },
        comp_uid
      );

      const pxRows = await runQuery(
        `
        SELECT A.CODE, NVL(B.NAME,'') AS NAME, NVL(B.SCHEDULE,0) AS SCHEDULE,
               SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) AS CLBAL
        FROM LEDGER A
        JOIN MASTER B ON A.COMP_CODE=B.COMP_CODE AND A.CODE=B.CODE
        WHERE A.COMP_CODE=:comp_code
          AND A.VR_DATE BETWEEN :s_date AND :e_date
        GROUP BY A.CODE, B.NAME, B.SCHEDULE
        `,
        { comp_code, s_date: sDate, e_date: eDate },
        comp_uid
      );

      const ledgerByCode = new Map((pxRows || []).map((r) => [String(r.CODE || '').trim(), Number(r.CLBAL) || 0]));
      const touched = new Set();
      const stockRows = (itemRows || []).map((r) => {
        const pCode = String(r.P_CODE || '').trim();
        const sCode = String(r.S_CODE || '').trim();
        let pAmt = 0;
        let sAmt = 0;
        if (pCode && !touched.has(`P:${pCode}`)) {
          pAmt = Math.abs(ledgerByCode.get(pCode) || 0);
          touched.add(`P:${pCode}`);
        }
        if (sCode && !touched.has(`S:${sCode}`)) {
          sAmt = Math.abs(ledgerByCode.get(sCode) || 0);
          touched.add(`S:${sCode}`);
        }
        const opAmt = Number(r.OPAMT) || 0;
        const clAmt = Number(r.CL_AMT) || 0;
        const gpl = (opAmt + pAmt) - (sAmt + clAmt);
        return {
          CODE: String(r.ITEM_CODE || '').trim(),
          NAME: String(r.ITEM_NAME || '').trim(),
          OQTY: 0,
          OWGT: Number(r.OPWGT) || 0,
          OAMT: opAmt,
          PQTY: 0,
          PWGT: Number(r.PWGT) || 0,
          PAMT: pAmt,
          SQTY: 0,
          SWGT: Number(r.SWGT) || 0,
          SAMT: sAmt,
          SHORT: 0,
          CQTY: 0,
          CWGT: Number(r.CL_WGT) || 0,
          CAMT: clAmt,
          GPROFIT: gpl < 0 ? Math.abs(gpl) : 0,
          GLOSS: gpl > 0 ? gpl : 0,
          S_NO: Number(String(r.R_F || 'F').trim().toUpperCase() === 'R' ? 1 : 2),
          DR_AMT: 0,
          CR_AMT: 0,
          A_CODE: '',
          P_CODE: pCode,
          MILLING_YN: 'N',
          E_DATE: eDate,
          CAT_CODE: String(r.CAT_CODE || '').trim(),
          CAT_NAME: '',
        };
      });

      const expenseRows = (pxRows || [])
        .filter((r) => {
          const s = Number(r.SCHEDULE) || 0;
          // Expense detail requirement:
          // - schedule > 13 and < 14
          // - schedule > 15 and < 16
          // This keeps only 13.xx and 15.xx blocks (not 14.xx / 16.xx).
          return (s > 13 && s < 14) || (s > 15 && s < 16);
        })
        .map((r) => {
          const cl = Number(r.CLBAL) || 0;
          return {
            CODE: '000000',
            NAME: String(r.NAME || '').trim(),
            OQTY: 0, OWGT: 0, OAMT: 0,
            PQTY: 0, PWGT: 0, PAMT: cl > 0 ? cl : 0,
            SQTY: 0, SWGT: 0, SAMT: cl < 0 ? Math.abs(cl) : 0,
            SHORT: 0, CQTY: 0, CWGT: 0, CAMT: 0,
            GPROFIT: 0, GLOSS: 0,
            S_NO: 9,
            // Frontend Trading A/C uses DR_AMT / CR_AMT to render expense rows.
            DR_AMT: cl > 0 ? cl : 0,
            CR_AMT: cl < 0 ? Math.abs(cl) : 0,
            A_CODE: String(r.CODE || '').trim(),
            P_CODE: '',
            MILLING_YN: '',
            E_DATE: eDate,
            CAT_CODE: 'DEXP',
            CAT_NAME: '',
          };
        });

      const rows = [...stockRows, ...expenseRows];
      return res.json({
        ok: true,
        params: { comp_code, comp_uid, edt, tdg_type: tdgTypeMode },
        rows,
        debug: {
          comp_code,
          comp_uid,
          tdg_type: tdgTypeMode,
          stock_count: stockRows.length,
          expense_count: expenseRows.length,
        },
      });
    }

    if (tdgTypeMode === 'C' && !manualConfirmed) {
      let amount = Number.isFinite(consolidateOverride) ? consolidateOverride : 0;
      if (!Number.isFinite(consolidateOverride)) {
        let amtRows = [];
        try {
          amtRows = await runQuery(
            `SELECT NVL(MAX(NVL(AMOUNT,0)),0) AS AMOUNT FROM CLSTOCK WHERE COMP_CODE = :comp_code`,
            { comp_code },
            comp_uid,
            { suppressDbErrorLog: true }
          );
        } catch {
          amtRows = [];
        }
        amount = Number(amtRows?.[0]?.AMOUNT) || 0;
      }
      return res.json({
        ok: true,
        requiresManualEntry: true,
        rows: [{ AMOUNT: amount }],
        debug: { comp_code, comp_uid, tdg_type: tdgTypeMode },
      });
    }

    // Consolidated Trading after manual confirm:
    // use a schema-safe path (ledger + schedule joins only) to avoid install-specific
    // ITEMMAST/CLSTOCK numeric conversion issues.
    if (tdgTypeMode === 'C' && manualConfirmed) {
      const safeRun = async (sql, binds) => {
        try {
          return await runQuery(sql, binds, comp_uid, { suppressDbErrorLog: true });
        } catch {
          return [];
        }
      };

      const pRows = await safeRun(
        `
        SELECT NVL(SUM(NVL(A.DR_AMT,0)),0) AS PUR_AMT
        FROM LEDGER A
        JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.VR_DATE >= :s_date
          AND A.VR_DATE <= :e_date
          AND NVL(B.SCHEDULE,0) > 14
          AND NVL(B.SCHEDULE,0) < 15
        `,
        { comp_code, s_date: sDate, e_date: eDate }
      );
      const sRows = await safeRun(
        `
        SELECT NVL(SUM(NVL(A.CR_AMT,0)),0) AS SAL_AMT
        FROM LEDGER A
        JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.VR_DATE >= :s_date
          AND A.VR_DATE <= :e_date
          AND NVL(B.SCHEDULE,0) > 12
          AND NVL(B.SCHEDULE,0) < 13
        `,
        { comp_code, s_date: sDate, e_date: eDate }
      );

      let closingAmt = Number.isFinite(consolidateOverride) ? consolidateOverride : 0;
      if (!Number.isFinite(consolidateOverride)) {
        const cRows = await safeRun(
          `SELECT NVL(SUM(NVL(AMOUNT,0)),0) AS AMOUNT FROM CLSTOCK WHERE COMP_CODE = :comp_code`,
          { comp_code }
        );
        closingAmt = Number(cRows?.[0]?.AMOUNT) || 0;
      }

      const openingAmt = 0;
      const purchaseAmt = Number(pRows?.[0]?.PUR_AMT) || 0;
      const salesAmt = Number(sRows?.[0]?.SAL_AMT) || 0;
      const gpl = (openingAmt + purchaseAmt) - (salesAmt + closingAmt);

      const expRows = await safeRun(
        `
        SELECT B.CODE, NVL(B.NAME,'') AS NAME, NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0) AS CLBAL
        FROM LEDGER A
        JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.VR_DATE >= :s_date
          AND A.VR_DATE <= :e_date
          AND (
            (NVL(B.SCHEDULE,0) > 13 AND NVL(B.SCHEDULE,0) < 14)
            OR
            (NVL(B.SCHEDULE,0) > 15 AND NVL(B.SCHEDULE,0) < 16)
          )
        GROUP BY B.CODE, B.NAME
        HAVING ABS(NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0)) > 0.0001
        ORDER BY B.NAME, B.CODE
        `,
        { comp_code, s_date: sDate, e_date: eDate }
      );

      const stockRows = [
        {
          CODE: 'CONSOLIDATE',
          NAME: 'CONSOLIDATE',
          OQTY: 0, OWGT: 0, OAMT: openingAmt,
          PQTY: 0, PWGT: 0, PAMT: purchaseAmt,
          SQTY: 0, SWGT: 0, SAMT: salesAmt,
          SHORT: 0, CQTY: 0, CWGT: 0, CAMT: closingAmt,
          GPROFIT: gpl < 0 ? Math.abs(gpl) : 0,
          GLOSS: gpl > 0 ? gpl : 0,
          S_NO: 0, DR_AMT: 0, CR_AMT: 0,
          A_CODE: '', P_CODE: '', MILLING_YN: 'N',
          E_DATE: eDate, CAT_CODE: '', CAT_NAME: '',
        },
      ];

      const expenseRowsOut = (expRows || []).map((r) => {
        const cl = Number(r.CLBAL) || 0;
        return {
          CODE: '000000',
          NAME: String(r.NAME || '').trim(),
          OQTY: 0, OWGT: 0, OAMT: 0,
          PQTY: 0, PWGT: 0, PAMT: cl > 0 ? cl : 0,
          SQTY: 0, SWGT: 0, SAMT: cl < 0 ? Math.abs(cl) : 0,
          SHORT: 0, CQTY: 0, CWGT: 0, CAMT: 0,
          GPROFIT: 0, GLOSS: 0,
          S_NO: 9,
          DR_AMT: cl > 0 ? cl : 0,
          CR_AMT: cl < 0 ? Math.abs(cl) : 0,
          A_CODE: String(r.CODE || '').trim(),
          P_CODE: '',
          MILLING_YN: '',
          E_DATE: eDate,
          CAT_CODE: 'DEXP',
          CAT_NAME: '',
        };
      });

      return res.json({
        ok: true,
        params: { comp_code, comp_uid, edt, tdg_type: tdgTypeMode },
        rows: [...stockRows, ...expenseRowsOut],
        debug: {
          comp_code,
          comp_uid,
          tdg_type: tdgTypeMode,
          stock_count: stockRows.length,
          expense_count: expenseRowsOut.length,
          consolidate_mode: 'safe_ledger_path',
        },
      });
    }

    // On this schema CLSTOCK may not contain CODE/NAME; avoid code-wise rebuild here.
    const mustRebuildClstock = false;
    if (mustRebuildClstock) {
      // Exact VFP-style reset flow:
      // DELETE FROM CLSTOCK WHERE COMP_CODE=:COMP_CODE
      // INSERT INTO CLSTOCK(COMP_CODE,CODE) SELECT ... FROM MASTER WHERE ... SCHEDULE=:SCHEDULE
      await runQuery(`DELETE FROM CLSTOCK WHERE COMP_CODE = :comp_code`, { comp_code }, comp_uid, { autoCommit: true });
      await runQuery(
        `
        INSERT INTO CLSTOCK (COMP_CODE, CODE)
        SELECT COMP_CODE, CODE
        FROM MASTER
        WHERE COMP_CODE = :comp_code
          AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
          AND (:code_filter IS NULL OR CODE = :code_filter)
        `,
        { comp_code, schedule_num: scheduleNum, code_filter: codeFilterSql },
        comp_uid,
        { autoCommit: true }
      );
    }

    let baseMasterRows = await runQuery(
      `
      SELECT CODE, NVL(NAME,'') AS NAME, 0 AS OP_BALANCE
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
        AND (:code_filter IS NULL OR CODE = :code_filter)
      ORDER BY CODE
      `,
      { comp_code, schedule_num: scheduleNum, code_filter: codeFilterSql },
      comp_uid
    );
    let masterSource = 'comp_uid';
    if (!Array.isArray(baseMasterRows) || baseMasterRows.length === 0) {
      baseMasterRows = await runQuery(
        `
        SELECT CODE, NVL(NAME,'') AS NAME, 0 AS OP_BALANCE
        FROM MASTER
        WHERE COMP_CODE = :comp_code
          AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
          AND (:code_filter IS NULL OR CODE = :code_filter)
        ORDER BY CODE
        `,
        { comp_code, schedule_num: scheduleNum, code_filter: codeFilterSql },
        null,
        { suppressDbErrorLog: true }
      );
      masterSource = 'hub';
    }

    // Manual mode: first show CLSTOCK table for AMOUNT/SHORTAGE entry, then caller confirms and reruns.
    if (mfynMode === 'M' && !manualConfirmed) {
      let manualRows = await runQuery(
        `
        SELECT CODE, CAST('' AS VARCHAR2(120)) AS NAME, 0 AS OP_BALANCE, NVL(AMOUNT,0) AS AMOUNT, NVL(SHORTAGE,0) AS SHORTAGE
        FROM CLSTOCK
        WHERE COMP_CODE = :comp_code
          AND (:code_filter IS NULL OR CODE = :code_filter)
        ORDER BY CODE
        `,
        { comp_code, code_filter: codeFilterSql },
        comp_uid
      );
      const masterMap = new Map(
        (baseMasterRows || []).map((r) => [
          String(r.CODE || '').trim(),
          {
            CODE: String(r.CODE || '').trim(),
            NAME: String(r.NAME || ''),
            OP_BALANCE: Number(r.OP_BALANCE) || 0,
            AMOUNT: 0,
            SHORTAGE: 0,
          },
        ])
      );
      (manualRows || []).forEach((r) => {
        const k = String(r?.CODE || '').trim();
        if (!k || !masterMap.has(k)) return;
        const cur = masterMap.get(k);
        cur.AMOUNT = Number(r?.AMOUNT) || 0;
        cur.SHORTAGE = Number(r?.SHORTAGE) || 0;
        cur.OP_BALANCE = Number(r?.OP_BALANCE) || cur.OP_BALANCE;
        masterMap.set(k, cur);
      });
      manualRows = Array.from(masterMap.values());
      return res.json({
        ok: true,
        requiresManualEntry: true,
        rows: manualRows || [],
        debug: {
          comp_code,
          comp_uid,
          schedule_input: schedule,
          schedule_num: scheduleNum,
          master_count: (baseMasterRows || []).length,
          clstock_count: (manualRows || []).length,
          master_source: masterSource,
          sample_master_codes: (baseMasterRows || []).slice(0, 10).map((r) => `${String(r.CODE || '').trim()}:${String(r.NAME || '').trim()}`),
        },
      });
    }
    const baseAccounts = await runQuery(
      `
      SELECT
        M.CODE AS CODE,
        NVL(M.NAME,'') AS NAME,
        0 AS M_OP_BALANCE,
        0 AS M_SHORTAGE,
        0 AS C_OP_BALANCE,
        0 AS C_AMOUNT,
        0 AS C_SHORTAGE,
        M.CODE AS P_CODE,
        'W' AS TDG_Q_W,
        CAST('' AS VARCHAR2(6)) AS CAT_CODE,
        CAST('' AS VARCHAR2(40)) AS CAT_NAME
      FROM MASTER M
      WHERE M.COMP_CODE = :comp_code
        AND (
          :schedule_txt = ''
          OR ROUND(NVL(M.SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
          OR TRUNC(NVL(M.SCHEDULE,0)) = TRUNC(:schedule_num)
        )
        AND (:code_filter IS NULL OR M.CODE = :code_filter)
      ORDER BY M.CODE
      `,
      {
        comp_code,
        schedule_txt: scheduleTxt,
        schedule_num: scheduleNum,
        code_filter: codeFilterSql,
      },
      comp_uid
    );

    const runTradingOptionalRows = async (sql, binds) => {
      try {
        return await runQuery(sql, binds, comp_uid, { suppressDbErrorLog: true });
      } catch (err) {
        if (isOptionalPrintSqlError(err)) return [];
        throw err;
      }
    };

    const openingRows = await runTradingOptionalRows(
      `SELECT S_CODE AS CODE, SUM(NVL(BAGS,0)+NVL(KATTA,0)+NVL(HKATTA,0)) AS OQTY, SUM(NVL(WEIGHT,0)) AS OWGT
       FROM CPUR
       WHERE COMP_CODE = :comp_code AND R_DATE < :s_date
       GROUP BY S_CODE`,
      { comp_code, s_date: sDate }
    );
    const purchaseRows = await runTradingOptionalRows(
      `SELECT P_CODE AS CODE,
              SUM(CASE WHEN TYPE='DN' THEN NVL(QNTY,0)*-1 ELSE NVL(QNTY,0) END) AS PQTY,
              SUM(CASE WHEN TYPE='DN' THEN NVL(WEIGHT,0)*-1 ELSE NVL(WEIGHT,0) END) AS PWGT
       FROM PURCHASE
       WHERE COMP_CODE = :comp_code AND R_DATE <= :e_date AND TYPE IN ('PU','DN','PB')
       GROUP BY P_CODE`,
      { comp_code, e_date: eDate }
    );
    const saleTypeList = String(mcb || 'C').trim().toUpperCase() === 'C' ? `'SL','SE','CH'` : `'SL','SE'`;
    const saleRows = await runTradingOptionalRows(
      `SELECT S_CODE AS CODE, SUM(NVL(QNTY,0)) AS SQTY, SUM(NVL(WEIGHT,0)) AS SWGT
       FROM SALE
       WHERE COMP_CODE = :comp_code AND BILL_DATE <= :e_date AND TYPE IN (${saleTypeList})
       GROUP BY S_CODE`,
      { comp_code, e_date: eDate }
    );
    const cnRows = await runTradingOptionalRows(
      `SELECT S_CODE AS CODE, SUM(NVL(QNTY,0)) AS SQTY, SUM(NVL(WEIGHT,0)) AS SWGT
       FROM SALE
       WHERE COMP_CODE = :comp_code AND BILL_DATE <= :e_date AND TYPE = 'CN'
       GROUP BY S_CODE`,
      { comp_code, e_date: eDate }
    );
    const dbikriRows =
      String(mcb || 'C').trim().toUpperCase() === 'B'
        ? await runTradingOptionalRows(
            `SELECT S_CODE AS CODE, SUM(NVL(QNTY,0)) AS SQTY, SUM(NVL(WEIGHT,0)) AS SWGT
             FROM DBIKRI
             WHERE COMP_CODE = :comp_code AND SV_DATE <= :e_date
             GROUP BY S_CODE`,
            { comp_code, e_date: eDate }
          )
        : [];
    const ledgerRows = await runQuery(
      `SELECT CODE, SUM(NVL(DR_AMT,0)) AS DR_AMT, SUM(NVL(CR_AMT,0)) AS CR_AMT
       FROM LEDGER
       WHERE COMP_CODE = :comp_code
         AND VR_DATE >= :s_date
         AND VR_DATE <= :e_date
       GROUP BY CODE`,
      { comp_code, s_date: sDate, e_date: eDate },
      comp_uid
    );

    const toMap = (arr, key = 'CODE') => {
      const map = new Map();
      (arr || []).forEach((r) => map.set(String(r?.[key] ?? '').trim(), r || {}));
      return map;
    };
    const openingMap = toMap(openingRows);
    const purchaseMap = toMap(purchaseRows);
    const saleMap = toMap(saleRows);
    const cnMap = toMap(cnRows);
    const dbikriMap = toMap(dbikriRows);
    const ledgerMap = toMap(ledgerRows);

    const stockRows = (baseAccounts || [])
      .map((a) => {
        const codeKey = String(a.CODE || '').trim();
        const pCode = codeKey;
        const op = openingMap.get(codeKey) || {};
        const pur = purchaseMap.get(pCode) || {};
        const sale = saleMap.get(codeKey) || {};
        const cn = cnMap.get(codeKey) || {};
        const dbk = dbikriMap.get(codeKey) || {};
        const ledCode = ledgerMap.get(codeKey) || {};
        const ledP = codeKey === pCode ? {} : ledgerMap.get(pCode) || {};

        // As per VFP logic: opening amount comes from OP_BALANCE (master/code),
        // while opening qty/weight comes from CPUR before start date.
        const moamt = numVal(a.M_OP_BALANCE);
        const mshort = numVal(a.C_SHORTAGE) !== 0 ? numVal(a.C_SHORTAGE) : numVal(a.M_SHORTAGE);
        const moqty = numVal(op.OQTY);
        const mowgt = numVal(op.OWGT);
        const mpqty = numVal(pur.PQTY);
        const mpwgt = numVal(pur.PWGT);
        let msqty = numVal(sale.SQTY) - numVal(cn.SQTY) + numVal(dbk.SQTY);
        let mswgt = numVal(sale.SWGT) - numVal(cn.SWGT) + numVal(dbk.SWGT);
        const mpamt = numVal(ledCode.DR_AMT);
        const msamt = numVal(ledCode.CR_AMT);
        const mcqty = moqty + mpqty - msqty;
        const mcwgt = mowgt + mpwgt - (mswgt + mshort);
        let mcamt = numVal(a.C_AMOUNT);
        if (String(mfyn || 'A').trim().toUpperCase() !== 'M') {
          if (mcqty > 0 || mcwgt > 0) {
            if (mowgt !== 0 || mpwgt !== 0) {
              const rate = (moamt + mpamt) / (mowgt + mpwgt || 1);
              mcamt = mcwgt * rate;
            } else if (moqty !== 0 || mpqty !== 0) {
              const rate = (moamt + mpamt) / (moqty + mpqty || 1);
              mcamt = mcqty * rate;
            }
          } else {
            mcamt = 0;
          }
        }
        const mploss = (moamt + mpamt) - (msamt + mcamt);
        const gprofit = mploss < 0 ? Math.abs(mploss) : 0;
        const gloss = mploss > 0 ? mploss : 0;
        return {
          CODE: codeKey,
          NAME: String(a.NAME || '').trim(),
          OQTY: moqty,
          OWGT: mowgt,
          OAMT: moamt,
          PQTY: mpqty,
          PWGT: mpwgt,
          PAMT: mpamt,
          SQTY: msqty,
          SWGT: mswgt,
          SAMT: msamt,
          SHORT: mshort,
          CQTY: mcqty,
          CWGT: mcwgt,
          CAMT: mcamt,
          GPROFIT: gprofit,
          GLOSS: gloss,
          S_NO: 0,
          DR_AMT: 0,
          CR_AMT: 0,
          A_CODE: '',
          P_CODE: pCode,
          MILLING_YN: String(mwyn || '').trim().toUpperCase().slice(0, 1),
          E_DATE: eDate,
          CAT_CODE: String(a.CAT_CODE || '').trim(),
          CAT_NAME: String(a.CAT_NAME || '').trim(),
        };
      })
      .filter((r) => String(r.CODE || '').trim() !== '');

    const expenseRows = await runQuery(
      `
      SELECT
        '000000' AS CODE,
        NVL(B.NAME,'') AS NAME,
        0 AS OQTY, 0 AS OWGT, 0 AS OAMT,
        0 AS PQTY, 0 AS PWGT, 0 AS PAMT,
        0 AS SQTY, 0 AS SWGT, 0 AS SAMT,
        0 AS SHORT, 0 AS CQTY, 0 AS CWGT, 0 AS CAMT,
        NVL(SUM(NVL(A.CR_AMT,0)-NVL(A.DR_AMT,0)),0) AS GPROFIT,
        NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0) AS GLOSS,
        1 AS S_NO,
        CASE WHEN SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) > 0 THEN SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) ELSE 0 END AS DR_AMT,
        CASE WHEN SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) < 0 THEN ABS(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0))) ELSE 0 END AS CR_AMT,
        B.CODE AS A_CODE,
        CAST('' AS VARCHAR2(6)) AS P_CODE,
        CAST('' AS VARCHAR2(1)) AS MILLING_YN,
        :e_date AS E_DATE,
        CAST('' AS VARCHAR2(6)) AS CAT_CODE,
        CAST('' AS VARCHAR2(40)) AS CAT_NAME
      FROM LEDGER A
      JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= :e_date
        AND NVL(B.SCHEDULE,0) >= 13
        AND NVL(B.SCHEDULE,0) < 16
        AND TRUNC(NVL(B.SCHEDULE,0)) <> 14
      GROUP BY B.CODE, NVL(B.NAME,'')
      HAVING ABS(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0))) > 0.0001
      ORDER BY NAME
      `,
      { comp_code, e_date: eDate },
      comp_uid
    );

    let stockOut = stockRows || [];
    if (!stockOut.length) {
      const fallbackRows = await runQuery(
        `
        WITH BASE AS (
          SELECT
            M.CODE AS CODE,
            NVL(M.NAME,'') AS NAME,
            0 AS OAMT,
            0 AS CAMT,
            0 AS SHORT,
            NVL(I.P_CODE, 0) AS P_CODE,
            NVL(I.CAT_CODE, '') AS CAT_CODE,
            NVL(E.CAT_NAME, '') AS CAT_NAME
          FROM MASTER M
          LEFT JOIN (
            SELECT COMP_CODE, S_CODE AS S_CODE, MAX(NVL(P_CODE,0)) AS P_CODE, MAX(NVL(CAT_CODE,'')) AS CAT_CODE
            FROM ITEMMAST
            GROUP BY COMP_CODE, S_CODE
          ) I
            ON I.COMP_CODE = M.COMP_CODE
           AND I.S_CODE = M.CODE
          LEFT JOIN CATMAST E
            ON E.COMP_CODE = M.COMP_CODE
           AND E.CAT_CODE = I.CAT_CODE
          WHERE M.COMP_CODE = :comp_code
            AND (
              :schedule_txt = ''
              OR ROUND(NVL(M.SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
              OR TRUNC(NVL(M.SCHEDULE,0)) = TRUNC(:schedule_num)
            )
            AND (:code_filter IS NULL OR M.CODE = :code_filter)
        ),
        LED AS (
          SELECT CODE, SUM(NVL(DR_AMT,0)) AS PAMT, SUM(NVL(CR_AMT,0)) AS SAMT
          FROM LEDGER
          WHERE COMP_CODE = :comp_code
            AND VR_DATE >= :s_date
            AND VR_DATE <= :e_date
          GROUP BY CODE
        )
        SELECT
          B.CODE, B.NAME,
          0 AS OQTY, 0 AS OWGT, NVL(B.OAMT,0) AS OAMT,
          0 AS PQTY, 0 AS PWGT, NVL(L.PAMT,0) AS PAMT,
          0 AS SQTY, 0 AS SWGT, NVL(L.SAMT,0) AS SAMT,
          NVL(B.SHORT,0) AS SHORT, 0 AS CQTY, 0 AS CWGT, NVL(B.CAMT,0) AS CAMT,
          CASE WHEN ((NVL(B.OAMT,0)+NVL(L.PAMT,0))-(NVL(L.SAMT,0)+NVL(B.CAMT,0))) < 0 THEN ABS((NVL(B.OAMT,0)+NVL(L.PAMT,0))-(NVL(L.SAMT,0)+NVL(B.CAMT,0))) ELSE 0 END AS GPROFIT,
          CASE WHEN ((NVL(B.OAMT,0)+NVL(L.PAMT,0))-(NVL(L.SAMT,0)+NVL(B.CAMT,0))) > 0 THEN ((NVL(B.OAMT,0)+NVL(L.PAMT,0))-(NVL(L.SAMT,0)+NVL(B.CAMT,0))) ELSE 0 END AS GLOSS,
          0 AS S_NO, 0 AS DR_AMT, 0 AS CR_AMT,
          CAST('' AS VARCHAR2(6)) AS A_CODE,
          NVL(B.P_CODE, 0) AS P_CODE,
          CAST('' AS VARCHAR2(1)) AS MILLING_YN,
          :e_date AS E_DATE,
          NVL(B.CAT_CODE,'') AS CAT_CODE,
          NVL(B.CAT_NAME,'') AS CAT_NAME
        FROM BASE B
        LEFT JOIN LED L ON L.CODE = B.CODE
        ORDER BY B.CODE
        `,
        {
          comp_code,
          schedule_txt: scheduleTxt,
          schedule_num: scheduleNum,
          code_filter: codeFilterSql,
          s_date: sDate,
          e_date: eDate,
        },
        comp_uid
      );
      stockOut = fallbackRows || [];
    }
    if (!stockOut.length) {
      const masterOnlyRows = await runQuery(
        `
        SELECT CODE, NVL(NAME,'') AS NAME, NVL(SCHEDULE,0) AS SCHEDULE
        FROM MASTER
        WHERE COMP_CODE = :comp_code
          AND (
            :schedule_txt = ''
            OR ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
            OR TRUNC(NVL(SCHEDULE,0)) = TRUNC(:schedule_num)
          )
          AND (:code_filter IS NULL OR CODE = :code_filter)
        ORDER BY CODE
        `,
        { comp_code, schedule_txt: scheduleTxt, schedule_num: scheduleNum, code_filter: codeFilterSql },
        comp_uid
      );
      stockOut = (masterOnlyRows || []).map((r) => ({
        CODE: String(r.CODE || '').trim(),
        NAME: String(r.NAME || '').trim(),
        OQTY: 0,
        OWGT: 0,
        OAMT: 0,
        PQTY: 0,
        PWGT: 0,
        PAMT: 0,
        SQTY: 0,
        SWGT: 0,
        SAMT: 0,
        SHORT: 0,
        CQTY: 0,
        CWGT: 0,
        CAMT: 0,
        GPROFIT: 0,
        GLOSS: 0,
        S_NO: 0,
        DR_AMT: 0,
        CR_AMT: 0,
        A_CODE: '',
        P_CODE: '',
        MILLING_YN: String(mwyn || '').trim().toUpperCase().slice(0, 1),
        E_DATE: eDate,
        CAT_CODE: '',
        CAT_NAME: '',
      }));
    }
    if (String(cat_code_yn || 'N').trim().toUpperCase() === 'Y') {
      const grp = new Map();
      stockOut.forEach((r) => {
        const k = String(r.CAT_CODE || '').trim() || '__BLANK__';
        const cur = grp.get(k) || {
          ...r,
          CODE: r.CODE,
          NAME: String(r.CAT_NAME || r.NAME || '').trim(),
          OQTY: 0, OWGT: 0, OAMT: 0,
          PQTY: 0, PWGT: 0, PAMT: 0,
          SQTY: 0, SWGT: 0, SAMT: 0,
          SHORT: 0, CQTY: 0, CWGT: 0, CAMT: 0,
          GPROFIT: 0, GLOSS: 0,
        };
        cur.OQTY += numVal(r.OQTY); cur.OWGT += numVal(r.OWGT); cur.OAMT += numVal(r.OAMT);
        cur.PQTY += numVal(r.PQTY); cur.PWGT += numVal(r.PWGT); cur.PAMT += numVal(r.PAMT);
        cur.SQTY += numVal(r.SQTY); cur.SWGT += numVal(r.SWGT); cur.SAMT += numVal(r.SAMT);
        cur.SHORT += numVal(r.SHORT); cur.CQTY += numVal(r.CQTY); cur.CWGT += numVal(r.CWGT); cur.CAMT += numVal(r.CAMT);
        cur.GPROFIT += numVal(r.GPROFIT); cur.GLOSS += numVal(r.GLOSS);
        grp.set(k, cur);
      });
      stockOut = Array.from(grp.values());
    }

    // In consolidated mode, honor manual closing stock override (no DB dependency).
    if (tdgTypeMode === 'C' && Number.isFinite(consolidateOverride) && (stockOut || []).length) {
      const targetClosing = consolidateOverride;
      const currentClosing = (stockOut || []).reduce((s, r) => s + numVal(r?.CAMT), 0);
      const delta = targetClosing - currentClosing;
      if (Math.abs(delta) > 0.0001) {
        stockOut[0] = { ...stockOut[0], CAMT: numVal(stockOut[0]?.CAMT) + delta };
      }
    }

    const rows = [...stockOut, ...(expenseRows || [])];
    res.json({
      ok: true,
      params: {
        comp_code,
        comp_uid,
        schedule: scheduleNum,
        code: codeFilterN === undefined ? '' : codeFilterN,
        edt,
      },
      rows,
      debug: {
        comp_code,
        comp_uid,
        schedule_input: schedule,
        schedule_num: scheduleNum,
        stock_count: (stockOut || []).length,
        expense_count: (expenseRows || []).length,
      },
    });
  } catch (err) {
    console.error('❌ Trading A/C error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Profit & Loss (VFP PLACT-style): schedule ≥ 16 ledger balances as-of edt,
 * plus trading gross from SUM(GPROFIT)−SUM(GLOSS) passed from client (same as FTDG / web Trading A/C stock rows).
 */
app.get('/api/pl-profit-loss', async (req, res) => {
  try {
    const { comp_code, comp_uid, edt, sum_gprofit, sum_gloss } = req.query;
    if (!comp_code || !comp_uid || !edt) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and edt are required' });
    }
    const eDate = parseDateOnly(edt);
    if (!eDate) {
      return res.status(400).json({ error: 'edt must be a valid date' });
    }
    const dd = String(eDate.getDate()).padStart(2, '0');
    const mm = String(eDate.getMonth() + 1).padStart(2, '0');
    const yyyy = eDate.getFullYear();
    const eDateOracle = `${dd}-${mm}-${yyyy}`;

    const gProfit = numVal(sum_gprofit);
    const gLoss = numVal(sum_gloss);
    const mGpl = gProfit - gLoss;

    let tradingDrAmt = 0;
    let tradingCrAmt = 0;
    let tradingDrLabel = '';
    let tradingCrLabel = '';
    if (mGpl > 0) {
      tradingCrAmt = mGpl;
      tradingCrLabel = 'GROSS PROFIT';
    } else if (mGpl < 0) {
      tradingDrAmt = Math.abs(mGpl);
      tradingDrLabel = 'GROSS LOSS';
    }

    const x0 = await runQuery(
      `
      SELECT
        NVL(B.SCHEDULE, 0) AS SCHEDULE,
        NVL(TRIM(C.NAME), '') AS SCH_NAME,
        A.CODE AS CODE,
        NVL(TRIM(B.NAME), '') AS NAME,
        SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS CLBAL
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN SCHEDULE C ON B.COMP_CODE = C.COMP_CODE AND B.SCHEDULE = C.NO
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND NVL(C.NO, 0) >= 16
      GROUP BY B.SCHEDULE, C.NAME, A.CODE, B.NAME
      HAVING ABS(SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0))) > 0.0001
      ORDER BY NVL(B.SCHEDULE, 0), C.NAME, A.CODE, B.NAME
      `,
      { comp_code, e_date: eDateOracle },
      comp_uid
    );

    const accounts = (x0 || []).map((r) => {
      const clBal = numVal(r.CLBAL);
      const drAmt = clBal > 0 ? clBal : 0;
      const crAmt = clBal < 0 ? Math.abs(clBal) : 0;
      const drDetail = clBal > 0 ? String(r.NAME || '').trim() : '';
      const crDetail = clBal < 0 ? String(r.NAME || '').trim() : '';
      return {
        SCHEDULE: numVal(r.SCHEDULE),
        SCH_NAME: String(r.SCH_NAME || '').trim(),
        CODE: String(r.CODE || '').trim(),
        NAME: String(r.NAME || '').trim(),
        CLBAL: clBal,
        DR_AMT: drAmt,
        CR_AMT: crAmt,
        DR_DETAIL: drDetail,
        CR_DETAIL: crDetail,
      };
    });

    const scheduleBlocks = [];
    let curKey = null;
    let buf = [];
    let subDr = 0;
    let subCr = 0;
    const flush = () => {
      if (!buf.length) return;
      scheduleBlocks.push({
        schedule: buf[0].SCHEDULE,
        schName: buf[0].SCH_NAME,
        lines: buf,
        scheduleTotalDr: subDr,
        scheduleTotalCr: subCr,
      });
      buf = [];
      subDr = 0;
      subCr = 0;
    };
    for (const row of accounts) {
      const sk = `${row.SCHEDULE}|${row.SCH_NAME}`;
      if (curKey !== null && sk !== curKey) {
        flush();
      }
      curKey = sk;
      buf.push(row);
      subDr += numVal(row.DR_AMT);
      subCr += numVal(row.CR_AMT);
    }
    flush();

    const sumAcctDr = accounts.reduce((s, r) => s + numVal(r.DR_AMT), 0);
    const sumAcctCr = accounts.reduce((s, r) => s + numVal(r.CR_AMT), 0);
    const totalLeftDr = tradingDrAmt + sumAcctDr;
    const totalIncomeWithoutGp = sumAcctCr;
    const rightWithTrading = sumAcctCr + tradingCrAmt;
    const net = rightWithTrading - totalLeftDr;
    const netLoss = net < 0 ? -net : 0;
    const netProfit = net > 0 ? net : 0;
    const grandTotal = net < 0 ? totalLeftDr : rightWithTrading;

    res.json({
      ok: true,
      as_on: eDateOracle,
      trading: {
        SCHEDULE: 12.1,
        SCH_NAME: 'TRADING',
        DR_AMT: tradingDrAmt,
        CR_AMT: tradingCrAmt,
        DR_DETAIL: tradingDrLabel,
        CR_DETAIL: tradingCrLabel,
        M_G_PL: mGpl,
        SUM_GPROFIT: gProfit,
        SUM_GLOSS: gLoss,
      },
      accounts,
      scheduleBlocks,
      totals: {
        totalLeftDr,
        totalIncomeWithoutGp,
        rightWithTrading,
        netLoss,
        netProfit,
        grandTotal,
      },
    });
  } catch (err) {
    console.error('❌ P&L error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Balance Sheet (VFP bsheet-style):
 * - Uses CLSTOCK total for schedule 7 adjustment
 * - Uses PLACT-equivalent closing (M_G_PL) from schedules >=16 plus trading gross diff
 * - Maps schedule by NORM_BAL/CORR_NO and builds liability/asset tree for NO < 12
 */
app.get('/api/balance-sheet', async (req, res) => {
  try {
    const { comp_code, comp_uid, edt, sum_gprofit, sum_gloss } = req.query;
    if (!comp_code || !comp_uid || !edt) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and edt are required' });
    }
    const eDate = parseDateOnly(edt);
    if (!eDate) {
      return res.status(400).json({ error: 'edt must be a valid date' });
    }
    const dd = String(eDate.getDate()).padStart(2, '0');
    const mm = String(eDate.getMonth() + 1).padStart(2, '0');
    const yyyy = eDate.getFullYear();
    const eDateOracle = `${dd}-${mm}-${yyyy}`;

    // G_CLAMT = SUM(CLSTOCK.AMOUNT)
    const clstockRows = await runQuery(
      `SELECT NVL(SUM(NVL(AMOUNT,0)),0) AS AMOUNT FROM CLSTOCK WHERE COMP_CODE = :comp_code`,
      { comp_code },
      comp_uid
    );
    const gClAmt = numVal(clstockRows?.[0]?.AMOUNT);

    // PLACT-equivalent M_G_PL:
    // raw trading diff = SUM(GPROFIT)-SUM(GLOSS)
    // schedules>=16 net = SUM(DR-CR)
    // M_G_PL (as used in bsheet) = SUM(PLACT.DR_AMT-PLACT.CR_AMT)
    //                             = schedule16Net - rawTradingDiff
    const rawTradingDiff = numVal(sum_gprofit) - numVal(sum_gloss);
    const plSchedRows = await runQuery(
      `
      SELECT NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0) AS CLBAL
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN SCHEDULE C ON B.COMP_CODE = C.COMP_CODE AND B.SCHEDULE = C.NO
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND NVL(C.NO,0) >= 16
      `,
      { comp_code, e_date: eDateOracle },
      comp_uid
    );
    const sched16Net = numVal(plSchedRows?.[0]?.CLBAL);
    const mGPl = sched16Net - rawTradingDiff;

    // X1: code-wise CLBAL for NO<12 with corr/norm
    const codeRows = await runQuery(
      `
      SELECT
        A.CODE AS CODE,
        NVL(B.SCHEDULE,0) AS SCH_NO,
        MAX(NVL(C.CORR_NO,0)) AS CORR_NO,
        MAX(NVL(C.NORM_BAL,'')) AS NORM_BAL,
        NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0) AS CLBAL
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN SCHEDULE C ON B.COMP_CODE = C.COMP_CODE AND B.SCHEDULE = C.NO
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND NVL(C.NO,0) < 12
      GROUP BY A.CODE, B.SCHEDULE
      `,
      { comp_code, e_date: eDateOracle },
      comp_uid
    );

    const scheduleRows = await runQuery(
      `
      SELECT NVL(NO,0) AS NO, NVL(NAME,'') AS NAME, NVL(CORR_NO,0) AS CORR_NO, NVL(NORM_BAL,'') AS NORM_BAL
      FROM SCHEDULE
      WHERE COMP_CODE = :comp_code
      `,
      { comp_code },
      comp_uid
    );

    const scheduleMap = new Map();
    (scheduleRows || []).forEach((r) => {
      const no = numVal(r.NO);
      scheduleMap.set(no, {
        no,
        name: String(r.NAME || '').trim(),
        corrNo: numVal(r.CORR_NO),
        normBal: String(r.NORM_BAL || '').trim().toUpperCase(),
      });
    });

    // X2: remap sch_no using NORM_BAL/CORR_NO
    const x2 = (codeRows || []).map((r) => {
      const schNo = numVal(r.SCH_NO);
      const corrNo = numVal(r.CORR_NO);
      const normBal = String(r.NORM_BAL || '').trim().toUpperCase();
      const clBal = numVal(r.CLBAL);
      let eff = schNo;
      if (normBal) {
        if (normBal === 'D') {
          eff = clBal < 0 ? (corrNo !== 0 ? corrNo : schNo) : schNo;
        } else {
          eff = clBal > 0 ? (corrNo !== 0 ? corrNo : schNo) : schNo;
        }
      }
      return {
        code: String(r.CODE || '').trim(),
        schNo: eff,
        clBal,
      };
    });

    // X3: sum by effective schedule
    const x3Map = new Map();
    x2.forEach((r) => {
      const k = numVal(r.schNo);
      x3Map.set(k, numVal(x3Map.get(k)) + numVal(r.clBal));
    });

    // XX3/XX4 base tree for NO < 12
    const xx4 = Array.from(scheduleMap.values())
      .filter((s) => s.no < 12)
      .map((s) => {
        const no = numVal(s.no);
        const mainNo = no - Math.trunc(no) === 0 ? 0 : Math.trunc(no);
        const treeSchNo = no - Math.trunc(no) === 0 ? `${no.toFixed(2)}     ` : `${String(Math.trunc(no)).padStart(5, ' ')}${no.toFixed(2)}`;
        const schType = no >= 5 && no < 11 ? 'A' : 'L';
        return {
          schNo: no,
          mainNo,
          treeSchNo,
          schName: s.name,
          schType,
          clBal: numVal(x3Map.get(no)),
        };
      })
      .sort((a, b) => String(a.treeSchNo).localeCompare(String(b.treeSchNo)));

    // XX5: totals by main_no
    const xx5Map = new Map();
    xx4.forEach((r) => {
      if (numVal(r.mainNo) === 0) return;
      xx5Map.set(numVal(r.mainNo), numVal(xx5Map.get(numVal(r.mainNo))) + numVal(r.clBal));
    });

    // TREEBS
    const treeBs = [];
    xx4.forEach((a) => {
      const hasMainTotal = xx5Map.has(numVal(a.schNo));
      if (hasMainTotal) {
        const bClBal = numVal(xx5Map.get(numVal(a.schNo)));
        let outBal = bClBal;
        if (numVal(a.schNo) === 1) outBal = bClBal + numVal(mGPl);
        else if (numVal(a.schNo) === 7) outBal = bClBal + numVal(gClAmt);
        let outName = a.schName;
        if (numVal(a.schNo) === 1) outName = `${String(a.schName || '').trim()} ${numVal(mGPl).toFixed(2)}`;
        treeBs.push({
          schNo: a.schNo,
          mainNo: a.mainNo,
          schName: outName,
          treeSchNo: a.treeSchNo,
          schType: a.schType,
          clBal: outBal,
          level: 1,
        });
      } else {
        treeBs.push({
          schNo: a.schNo,
          mainNo: a.mainNo,
          schName: a.schName,
          treeSchNo: a.treeSchNo,
          schType: a.schType,
          clBal: numVal(a.clBal),
          level: numVal(a.mainNo) === 0 ? 1 : 2,
        });
      }
    });

    // Build liabilities + assets lists (BS cursor-style)
    const liabilities = [];
    const assets = [];
    let insertedProfitLoss = false;
    treeBs.forEach((r) => {
      if (r.schType === 'L') {
        if (numVal(r.mainNo) === 0) {
          liabilities.push({
            schNo: numVal(r.schNo),
            detail: String(r.schName || ''),
            amount: 0,
            grandAmount: numVal(r.clBal) * -1,
            level: 1,
          });
          if (Math.trunc(numVal(r.schNo)) === 1 && !insertedProfitLoss) {
            liabilities.push({
              schNo: 1.1,
              detail: '  PROFIT/LOSS',
              amount: numVal(mGPl),
              grandAmount: 0,
              level: 2,
            });
            insertedProfitLoss = true;
          }
        } else {
          liabilities.push({
            schNo: numVal(r.schNo),
            detail: `  ${String(r.schName || '')}`,
            amount: numVal(r.clBal) * -1,
            grandAmount: 0,
            level: 2,
          });
        }
      } else if (r.schType === 'A') {
        if (numVal(r.mainNo) === 0) {
          assets.push({
            schNo: numVal(r.schNo),
            detail: String(r.schName || ''),
            amount: 0,
            grandAmount: numVal(r.clBal),
            level: 1,
          });
        } else {
          assets.push({
            schNo: numVal(r.schNo),
            detail: `  ${String(r.schName || '')}`,
            amount: numVal(r.clBal),
            grandAmount: 0,
            level: 2,
          });
        }
      }
    });

    const sortBsSide = (arr) =>
      (arr || []).sort((a, b) => {
        const sa = numVal(a?.schNo);
        const sb = numVal(b?.schNo);
        const ma = Math.trunc(sa);
        const mb = Math.trunc(sb);
        if (ma !== mb) return ma - mb;
        const la = numVal(a?.level) === 1 ? 0 : 1;
        const lb = numVal(b?.level) === 1 ? 0 : 1;
        if (la !== lb) return la - lb;
        return sa - sb;
      });

    // Keep main schedule (x.00) first, then sub schedules (x.10, x.20 ...)
    sortBsSide(liabilities);
    sortBsSide(assets);

    const rowCount = Math.max(liabilities.length, assets.length);
    const rows = [];
    for (let i = 0; i < rowCount; i += 1) {
      const l = liabilities[i] || {};
      const a = assets[i] || {};
      rows.push({
        L_SCH_NO: numVal(l.schNo),
        L_DETAIL: String(l.detail || ''),
        L_AMOUNT: numVal(l.amount),
        CR_AMT: numVal(l.grandAmount),
        L_LEVEL: numVal(l.level),
        A_SCH_NO: numVal(a.schNo),
        A_DETAIL: String(a.detail || ''),
        A_AMOUNT: numVal(a.amount),
        DR_AMT: numVal(a.grandAmount),
        A_LEVEL: numVal(a.level),
      });
    }

    const liabilitiesTotal = rows.reduce((s, r) => s + numVal(r.CR_AMT), 0);
    const assetsTotal = rows.reduce((s, r) => s + numVal(r.DR_AMT), 0);
    res.json({
      ok: true,
      as_on: eDateOracle,
      rows,
      totals: {
        liabilitiesTotal,
        assetsTotal,
      },
      meta: {
        g_clamt: gClAmt,
        m_g_pl: mGPl,
      },
    });
  } catch (err) {
    console.error('❌ Balance Sheet error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Balance Sheet drilldown: accounts under one effective sub-schedule (e.g. 1.10)
 * using same NORM_BAL/CORR_NO remap logic as /api/balance-sheet.
 */
app.get('/api/balance-sheet-schedule-accounts', async (req, res) => {
  try {
    const { comp_code, comp_uid, edt, sch_no } = req.query;
    if (!comp_code || !comp_uid || !edt || sch_no == null || sch_no === '') {
      return res.status(400).json({ error: 'comp_code, comp_uid, edt, sch_no are required' });
    }
    const eDate = parseDateOnly(edt);
    if (!eDate) return res.status(400).json({ error: 'edt must be a valid date' });
    const targetSch = numVal(sch_no);
    if (!targetSch) return res.status(400).json({ error: 'sch_no must be numeric' });
    const dd = String(eDate.getDate()).padStart(2, '0');
    const mm = String(eDate.getMonth() + 1).padStart(2, '0');
    const yyyy = eDate.getFullYear();
    const eDateOracle = `${dd}-${mm}-${yyyy}`;

    const codeRows = await runQuery(
      `
      SELECT
        A.CODE AS CODE,
        NVL(TRIM(B.NAME),'') AS NAME,
        NVL(B.SCHEDULE,0) AS SCH_NO,
        MAX(NVL(C.CORR_NO,0)) AS CORR_NO,
        MAX(NVL(C.NORM_BAL,'')) AS NORM_BAL,
        NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0) AS CLBAL
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN SCHEDULE C ON B.COMP_CODE = C.COMP_CODE AND B.SCHEDULE = C.NO
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND NVL(C.NO,0) < 12
      GROUP BY A.CODE, B.NAME, B.SCHEDULE
      `,
      { comp_code, e_date: eDateOracle },
      comp_uid
    );

    const rows = (codeRows || [])
      .map((r) => {
        const schNo = numVal(r.SCH_NO);
        const corrNo = numVal(r.CORR_NO);
        const normBal = String(r.NORM_BAL || '').trim().toUpperCase();
        const clBal = numVal(r.CLBAL);
        let effSch = schNo;
        if (normBal) {
          if (normBal === 'D') effSch = clBal < 0 ? (corrNo !== 0 ? corrNo : schNo) : schNo;
          else effSch = clBal > 0 ? (corrNo !== 0 ? corrNo : schNo) : schNo;
        }
        return {
          CODE: String(r.CODE || '').trim(),
          NAME: String(r.NAME || '').trim(),
          SCH_NO: schNo,
          EFF_SCH_NO: effSch,
          CLBAL: clBal,
          DR_AMT: clBal > 0 ? clBal : 0,
          CR_AMT: clBal < 0 ? Math.abs(clBal) : 0,
        };
      })
      .filter((r) => Math.abs(numVal(r.EFF_SCH_NO) - targetSch) < 0.0001 && Math.abs(numVal(r.CLBAL)) > 0.0001)
      .sort((a, b) => String(a.NAME || '').localeCompare(String(b.NAME || '')) || String(a.CODE || '').localeCompare(String(b.CODE || '')));

    res.json({ ok: true, sch_no: targetSch, rows });
  } catch (err) {
    console.error('❌ Balance Sheet schedule accounts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trading-ac-category-codes', async (req, res) => {
  try {
    const { comp_code, comp_uid, cat_code } = req.query;
    if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
    const cat = String(cat_code || '').trim();
    if (!cat) return res.json({ ok: true, rows: [] });

    const rows = await runQuery(
      `
      SELECT CODE, SIDE, SCH
      FROM (
        SELECT DISTINCT
          M.CODE AS CODE,
          'S' AS SIDE,
          NVL(M.SCHEDULE,0) AS SCH
        FROM ITEMMAST I
        JOIN MASTER M
          ON I.COMP_CODE = M.COMP_CODE
         AND NVL(I.S_CODE,0) = M.CODE
        WHERE I.COMP_CODE = :comp_code
          AND (
            :cat_code = 'ALL'
            OR
            (:cat_code = 'UNCAT' AND TRIM(NVL(I.CAT_CODE,'')) = '')
            OR TRIM(NVL(I.CAT_CODE,'')) = :cat_code
          )
          AND NVL(I.S_CODE,0) <> 0
          AND NVL(M.SCHEDULE,0) > 12
          AND NVL(M.SCHEDULE,0) < 13
        UNION
        SELECT DISTINCT
          M.CODE AS CODE,
          'P' AS SIDE,
          NVL(M.SCHEDULE,0) AS SCH
        FROM ITEMMAST I
        JOIN MASTER M
          ON I.COMP_CODE = M.COMP_CODE
         AND NVL(I.P_CODE,0) = M.CODE
        WHERE I.COMP_CODE = :comp_code
          AND (
            :cat_code = 'ALL'
            OR
            (:cat_code = 'UNCAT' AND TRIM(NVL(I.CAT_CODE,'')) = '')
            OR TRIM(NVL(I.CAT_CODE,'')) = :cat_code
          )
          AND NVL(I.P_CODE,0) <> 0
          AND NVL(M.SCHEDULE,0) > 14
          AND NVL(M.SCHEDULE,0) < 15
      )
      ORDER BY SIDE, CODE
      `,
      { comp_code, cat_code: cat },
      comp_uid
    );

    res.json({
      ok: true,
      rows: (rows || []).map((r) => ({
        CODE: String(r.CODE || '').trim(),
        SIDE: String(r.SIDE || '').trim(),
        SCHEDULE: Number(r.SCH) || 0,
      })),
    });
  } catch (err) {
    console.error('❌ Trading category linked codes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trading-ac/manual-save', async (req, res) => {
  try {
    const { comp_code, comp_uid, rows, tdg_type } = req.body || {};
    if (!comp_code || !comp_uid) return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    const tdgTypeMode = String(tdg_type || 'C').trim().toUpperCase() === 'I' ? 'I' : 'C';
    const list = Array.isArray(rows) ? rows : [];
    if (tdgTypeMode === 'I') {
      const compdet = await runCompdetHeaderRow(comp_code, comp_uid);
      const compYear = String(compdet?.COMP_YEAR ?? compdet?.comp_year ?? '');
      const compUid = isEffectiveCompUid(comp_uid) ? String(comp_uid).trim() : null;
      const connCfg = compUid
        ? {
            user: compUid,
            password: compUid,
            connectString: activeDbConfig.connectString,
          }
        : activeDbConfig;
      let conn;
      try {
        conn = await getDbConnection(connCfg);
        await conn.execute(`DELETE FROM CLSTOCK WHERE COMP_CODE = :comp_code`, { comp_code }, { autoCommit: false });

        const bindRows = list
          .map((r) => {
            const itemCode = String(r?.item_code ?? r?.ITEM_CODE ?? '').trim();
            if (!itemCode) return null;
            return {
              comp_code,
              comp_year: compYear,
              cat_code: String(r?.cat_code ?? r?.CAT_CODE ?? ''),
              item_code: itemCode,
              rate: Number(r?.rate ?? r?.RATE ?? 0) || 0,
              amount: Number(r?.amount ?? r?.AMOUNT ?? 0) || 0,
              s_code: Number(r?.s_code ?? r?.S_CODE ?? 0) || 0,
              p_code: Number(r?.p_code ?? r?.P_CODE ?? 0) || 0,
              cat: String(r?.cat ?? r?.CAT ?? ''),
              cl_wgt: Number(r?.cl_wgt ?? r?.CL_WGT ?? 0) || 0,
            };
          })
          .filter(Boolean);

        if (bindRows.length > 0) {
          await conn.executeMany(
            `
            INSERT INTO CLSTOCK (COMP_CODE, COMP_YEAR, CAT_CODE, ITEM_CODE, RATE, AMOUNT, S_CODE, P_CODE, CAT, CL_WGT)
            VALUES (:comp_code, :comp_year, :cat_code, :item_code, :rate, :amount, :s_code, :p_code, :cat, :cl_wgt)
            `,
            bindRows,
            { autoCommit: false }
          );
        }
        await conn.commit();
      } catch (saveErr) {
        if (conn) {
          try { await conn.rollback(); } catch (_) {}
        }
        throw saveErr;
      } finally {
        if (conn) {
          try { await conn.close(); } catch (_) {}
        }
      }
      return res.json({ ok: true });
    }

    if (tdgTypeMode === 'C') {
      const first = list?.[0] || {};
      const amount = Number(first?.amount ?? first?.AMOUNT ?? 0);
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      const consolidateKey = `${String(comp_code || '').trim()}|${String(comp_uid || '').trim()}`;
      console.log('ℹ️ Trading consolidate save:', { comp_code, comp_uid, safeAmount, consolidateKey });
      tradingConsolidateOverride.set(consolidateKey, safeAmount);
      return res.json({ ok: true });
    }

    for (const r of list) {
      const code = parseMasterCodeForSql(r?.code ?? r?.CODE);
      if (code === undefined) continue;
      const amount = Number(r?.amount ?? r?.AMOUNT ?? 0);
      const shortage = Number(r?.shortage ?? r?.SHORTAGE ?? 0);
      const compdet = await runCompdetHeaderRow(comp_code, comp_uid);
      const compYear = Number(compdet?.COMP_YEAR ?? compdet?.comp_year ?? 0) || 0;
      await runQuery(
        `
        MERGE INTO CLSTOCK C
        USING (
          SELECT :comp_code AS COMP_CODE, :comp_year AS COMP_YEAR, :code AS CODE,
                 :amount AS AMOUNT, :shortage AS SHORTAGE
          FROM DUAL
        ) X
        ON (C.COMP_CODE = X.COMP_CODE AND C.CODE = X.CODE)
        WHEN MATCHED THEN
          UPDATE SET C.AMOUNT = X.AMOUNT, C.SHORTAGE = X.SHORTAGE
        WHEN NOT MATCHED THEN
          INSERT (COMP_CODE, COMP_YEAR, CODE, AMOUNT, SHORTAGE)
          VALUES (X.COMP_CODE, X.COMP_YEAR, X.CODE, X.AMOUNT, X.SHORTAGE)
        `,
        {
          comp_code,
          comp_year: compYear,
          code,
          amount: Number.isFinite(amount) ? amount : 0,
          shortage: Number.isFinite(shortage) ? shortage : 0,
        },
        comp_uid,
        { autoCommit: true }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Trading manual save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trading-ac-ledger', async (req, res) => {
  try {
    const { comp_code, comp_uid, code, edt, mcb } = req.query;
    const codeN = parseMasterCodeForSql(code);
    if (!comp_code || !comp_uid || codeN === undefined || !edt) {
      return res.status(400).json({ error: 'comp_code, comp_uid, code (numeric), edt are required' });
    }
    const compdet = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!compdet) return res.status(400).json({ error: 'Unable to resolve compdet row' });
    const sDate = parseDateOnly(compdet.COMP_S_DT ?? compdet.comp_s_dt);
    const eDate = parseDateOnly(edt);
    if (!sDate || !eDate) return res.status(400).json({ error: 'Invalid dates' });

    const saleTypes = String(mcb || 'C').trim().toUpperCase() === 'C' ? ['SL', 'SE', 'CH', 'CN'] : ['SL', 'SE', 'CN'];

    const [purchaseRows, saleRows, ledgerRows] = await Promise.all([
      runQuery(
        `
        SELECT 'PUR' AS SRC, TRIM(TYPE) AS VR_TYPE, TO_CHAR(TRUNC(R_DATE), 'YYYY-MM-DD') AS VR_DATE, R_NO AS VR_NO, TYPE,
               SUM(CASE WHEN TYPE='DN' THEN NVL(QNTY,0)*-1 ELSE NVL(QNTY,0) END) AS R_QNTY,
               SUM(CASE WHEN TYPE='DN' THEN NVL(WEIGHT,0)*-1 ELSE NVL(WEIGHT,0) END) AS R_WEIGHT,
               0 AS DR_AMOUNT, 0 AS S_QNTY, 0 AS S_WEIGHT, 0 AS CR_AMOUNT
        FROM PURCHASE
        WHERE COMP_CODE = :comp_code
          AND P_CODE = :code
          AND R_DATE >= :s_date
          AND R_DATE <= :e_date
          AND TYPE IN ('PU','DN','PB')
        GROUP BY TRUNC(R_DATE), R_NO, TYPE
        `,
        { comp_code, code: codeN, s_date: sDate, e_date: eDate },
        comp_uid
      ),
      runQuery(
        `
        SELECT 'SAL' AS SRC,
               TRIM(TYPE) AS VR_TYPE,
               TO_CHAR(TRUNC(BILL_DATE), 'YYYY-MM-DD') AS VR_DATE,
               BILL_NO AS VR_NO,
               TRIM(NVL(B_TYPE,'N')) AS TYPE,
               0 AS R_QNTY,
               0 AS R_WEIGHT,
               0 AS DR_AMOUNT,
               SUM(CASE WHEN TRIM(TYPE)='CN' THEN NVL(QNTY,0)*-1 ELSE NVL(QNTY,0) END) AS S_QNTY,
               SUM(
                 CASE
                   WHEN TRIM(TYPE)='CN'
                     THEN (NVL(WEIGHT,0) - (NVL(DANE_WGT,0)+NVL(PAPLOO3,0))) * -1
                   ELSE (NVL(WEIGHT,0) - (NVL(DANE_WGT,0)+NVL(PAPLOO3,0)))
                 END
               ) AS S_WEIGHT,
               SUM(CASE WHEN TRIM(TYPE)='CN' THEN NVL(BILL_AMT,0)*-1 ELSE NVL(BILL_AMT,0) END) AS CR_AMOUNT
        FROM SALE
        WHERE COMP_CODE = :comp_code
          AND S_CODE = :code
          AND BILL_DATE >= :s_date
          AND BILL_DATE <= :e_date
          AND TRIM(TYPE) IN (${saleTypes.map((_, i) => `:st${i}`).join(',')})
        GROUP BY TRUNC(BILL_DATE), BILL_NO, TRIM(TYPE), TRIM(NVL(B_TYPE,'N'))
        `,
        Object.assign({ comp_code, code: codeN, s_date: sDate, e_date: eDate }, ...saleTypes.map((t, i) => ({ [`st${i}`]: t }))),
        comp_uid
      ),
      runQuery(
        `
        SELECT 'LED' AS SRC, TRIM(VR_TYPE) AS VR_TYPE, TO_CHAR(TRUNC(VR_DATE), 'YYYY-MM-DD') AS VR_DATE, VR_NO, TYPE,
               0 AS R_QNTY, 0 AS R_WEIGHT,
               SUM(NVL(DR_AMT,0)) AS DR_AMOUNT,
               0 AS S_QNTY, 0 AS S_WEIGHT,
               SUM(NVL(CR_AMT,0)) AS CR_AMOUNT
        FROM LEDGER
        WHERE COMP_CODE = :comp_code
          AND CODE = :code
          AND VR_DATE >= :s_date
          AND VR_DATE <= :e_date
        GROUP BY TRUNC(VR_DATE), VR_NO, VR_TYPE, TYPE
        `,
        { comp_code, code: codeN, s_date: sDate, e_date: eDate },
        comp_uid
      ),
    ]);

    const allRows = [...(purchaseRows || []), ...(saleRows || []), ...(ledgerRows || [])]
      .map((r) => ({
        VR_TYPE: String(r.VR_TYPE || '').trim(),
        VR_DATE: r.VR_DATE,
        VR_NO: Number(r.VR_NO) || 0,
        TYPE: String(r.TYPE || '').trim(),
        R_QNTY: numVal(r.R_QNTY),
        R_WEIGHT: numVal(r.R_WEIGHT),
        DR_AMOUNT: numVal(r.DR_AMOUNT),
        S_QNTY: numVal(r.S_QNTY),
        S_WEIGHT: numVal(r.S_WEIGHT),
        CR_AMOUNT: numVal(r.CR_AMOUNT),
      }))
      .sort((a, b) => {
        const da = parseDateOnly(a.VR_DATE)?.getTime() || 0;
        const db = parseDateOnly(b.VR_DATE)?.getTime() || 0;
        if (da !== db) return da - db;
        if (a.VR_NO !== b.VR_NO) return a.VR_NO - b.VR_NO;
        return String(a.VR_TYPE).localeCompare(String(b.VR_TYPE));
      });

    let balQty = 0;
    let balWeight = 0;
    let clBalance = 0;
    const rows = allRows.map((r) => {
      balQty += numVal(r.R_QNTY) - numVal(r.S_QNTY);
      balWeight += numVal(r.R_WEIGHT) - numVal(r.S_WEIGHT);
      clBalance += numVal(r.DR_AMOUNT) - numVal(r.CR_AMOUNT);
      return {
        ...r,
        BAL_QNTY: balQty,
        BAL_WEIGHT: balWeight,
        CL_BALANCE: clBalance,
      };
    });

    const totals = rows.reduce(
      (a, r) => ({
        R_QNTY: a.R_QNTY + numVal(r.R_QNTY),
        R_WEIGHT: a.R_WEIGHT + numVal(r.R_WEIGHT),
        DR_AMOUNT: a.DR_AMOUNT + numVal(r.DR_AMOUNT),
        S_QNTY: a.S_QNTY + numVal(r.S_QNTY),
        S_WEIGHT: a.S_WEIGHT + numVal(r.S_WEIGHT),
        CR_AMOUNT: a.CR_AMOUNT + numVal(r.CR_AMOUNT),
        BAL_QNTY: numVal(r.BAL_QNTY),
        BAL_WEIGHT: numVal(r.BAL_WEIGHT),
        CL_BALANCE: numVal(r.CL_BALANCE),
      }),
      { R_QNTY: 0, R_WEIGHT: 0, DR_AMOUNT: 0, S_QNTY: 0, S_WEIGHT: 0, CR_AMOUNT: 0, BAL_QNTY: 0, BAL_WEIGHT: 0, CL_BALANCE: 0 }
    );

    res.json({ ok: true, rows, totals });
  } catch (err) {
    console.error('❌ Trading ledger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trading-ac-ledger-entry-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, vr_type, vr_date, vr_no, type } = req.query;
    if (!comp_code || !comp_uid || !vr_type || !vr_date || vr_no == null || vr_no === '') {
      return res.status(400).json({ error: 'comp_code, comp_uid, vr_type, vr_date, vr_no are required' });
    }
    const vrType = String(vr_type || '').trim().toUpperCase();
    const vrNoNum = Number(vr_no);
    if (!Number.isFinite(vrNoNum)) {
      return res.status(400).json({ error: 'vr_no must be numeric' });
    }
    const vrDateIso = String(vr_date || '').trim();
    const typeVal = String(type || '').trim();
    const saleTypes = ['SL', 'SE', 'CH', 'CN'];
    const purchaseTypes = ['PU', 'DN', 'DX', 'CX', 'PB'];

    if (saleTypes.includes(vrType)) {
      const saleSql = `
        SELECT
          TRIM(A.TYPE) AS TYPE,
          TO_CHAR(TRUNC(A.BILL_DATE), 'YYYY-MM-DD') AS VR_DATE,
          A.BILL_NO AS VR_NO,
          A.TRN_NO,
          A.CODE AS CODE,
          TRIM(NVL(B.NAME,'')) AS NAME,
          TRIM(NVL(B.CITY,'')) AS CITY,
          A.SUP_CODE AS SUP_CODE,
          TRIM(NVL(D.NAME,'')) AS SUP_NAME,
          TRIM(A.ITEM_CODE) AS ITEM_CODE,
          TRIM(NVL(C.ITEM_NAME,'')) AS ITEM_NAME,
          NVL(A.QNTY,0) AS QNTY,
          NVL(A.WEIGHT,0) AS WEIGHT,
          NVL(A.RATE,0) AS RATE,
          NVL(A.AMOUNT,0) AS AMOUNT,
          NVL(A.TAXABLE,0) AS TAXABLE
        FROM SALE A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
        LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND NVL(A.SUP_CODE, A.CODE) = D.CODE
        WHERE A.COMP_CODE = :comp_code
          AND TRIM(A.TYPE) = :vr_type
          AND TRUNC(A.BILL_DATE) = TO_DATE(:vr_date, 'YYYY-MM-DD')
          AND A.BILL_NO = :vr_no
          AND TRIM(NVL(A.B_TYPE,'N')) = :type
        ORDER BY A.TYPE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO
      `;
      const rows = await runQuery(
        saleSql,
        {
          comp_code,
          vr_type: vrType,
          vr_date: vrDateIso,
          vr_no: vrNoNum,
          type: typeVal || 'N',
        },
        comp_uid
      );
      return res.json({ ok: true, rows: rows || [] });
    }

    if (purchaseTypes.includes(vrType)) {
      const purchaseSql = `
        SELECT
          TRIM(A.TYPE) AS TYPE,
          TO_CHAR(TRUNC(A.R_DATE), 'YYYY-MM-DD') AS VR_DATE,
          A.R_NO AS VR_NO,
          A.TRN_NO,
          A.CODE AS CODE,
          TRIM(NVL(B.NAME,'')) AS NAME,
          TRIM(NVL(B.CITY,'')) AS CITY,
          NVL(A.P_CODE, A.SUP_CODE) AS SUP_CODE,
          TRIM(NVL(D.NAME,'')) AS SUP_NAME,
          TRIM(A.ITEM_CODE) AS ITEM_CODE,
          TRIM(NVL(C.ITEM_NAME,'')) AS ITEM_NAME,
          NVL(A.QNTY,0) AS QNTY,
          NVL(A.WEIGHT,0) AS WEIGHT,
          NVL(A.RATE,0) AS RATE,
          NVL(A.AMOUNT,0) AS AMOUNT,
          NVL(A.TAXABLE,0) AS TAXABLE
        FROM PURCHASE A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
        LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND NVL(A.SUP_CODE, A.P_CODE) = D.CODE
        WHERE A.COMP_CODE = :comp_code
          AND TRIM(A.TYPE) = :vr_type
          AND TRUNC(A.R_DATE) = TO_DATE(:vr_date, 'YYYY-MM-DD')
          AND A.R_NO = :vr_no
        ORDER BY A.TYPE, A.R_DATE, A.R_NO, A.TRN_NO
      `;
      const rows = await runQuery(
        purchaseSql,
        {
          comp_code,
          vr_type: vrType,
          vr_date: vrDateIso,
          vr_no: vrNoNum,
        },
        comp_uid
      );
      return res.json({ ok: true, rows: rows || [] });
    }

    return res.json({ ok: true, rows: [] });
  } catch (err) {
    console.error('❌ Trading ledger entry detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function gstrNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function gstrTxt(v) {
  return String(v ?? '').trim();
}
function gstrHas(v) {
  return gstrTxt(v) !== '';
}
function gstrRate(r) {
  return +(gstrNum(r).toFixed(2));
}
function gstrDt(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dd}-${mon[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`;
}
function fmtInvNo(row, opts) {
  const saleInv = gstrTxt(row.SALE_INV_NO ?? row.sale_inv_no);
  const billNoRaw = String(row.BILL_NO ?? row.bill_no ?? '').trim();
  const bType = gstrTxt(row.B_TYPE ?? row.b_type);
  let base = saleInv || billNoRaw;
  if (opts.bTypeYn === 'Y' && bType) base += bType;
  if (opts.zeroBeforeBillNo === 'Y') {
    const onlyNum = String(row.BILL_NO ?? '').replace(/\D/g, '');
    if (onlyNum) base = onlyNum.padStart(opts.billNoLength, '0') + (opts.bTypeYn === 'Y' && bType ? bType : '');
  }
  return base;
}
function keyOf(...parts) {
  return parts.map((p) => gstrTxt(p)).join('|');
}
function gstrRound2(v) {
  return +gstrNum(v).toFixed(2);
}
function gstrParseDispDate(s) {
  const t = gstrTxt(s);
  if (!t) return 0;
  const m = t.match(/^(\d{2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return 0;
  const monMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const dd = Number(m[1]);
  const mm = monMap[m[2]] ?? 0;
  const yy = Number(m[3]);
  const yyyy = 2000 + yy;
  return new Date(yyyy, mm, dd).getTime();
}
function gstrRoundAmountColumns(rows) {
  const amtRx = /(AMT|AMOUNT|VALUE|TAXABLE|TAX|IGST|CGST|SGST|CESS|FREIGHT|LABOUR|TOTAL)/i;
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const out = { ...row };
    Object.keys(out).forEach((k) => {
      if (!amtRx.test(k)) return;
      if (typeof out[k] !== 'number') return;
      out[k] = gstrRound2(out[k]);
    });
    return out;
  });
}

app.get('/api/gstr1', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      s_date,
      e_date,
      btype_yn,
      zero_before_bill_no,
      bill_no_length,
      btob_yn,
      btocl_yn,
      btocs_yn,
      b2cl_limit_mode,
    } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const opts = {
      bTypeYn: String(btype_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      zeroBeforeBillNo: String(zero_before_bill_no || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      billNoLength: Math.max(1, Math.min(12, Number(bill_no_length) || 6)),
      btobYn: String(btob_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      btoclYn: String(btocl_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      btocsYn: String(btocs_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      b2clLimit: String(b2cl_limit_mode || '1').trim() === '2' ? 100000 : 250000,
    };

    const saleSql = `
      SELECT
        A.TYPE, A.B_TYPE, A.BILL_DATE, A.BILL_NO, A.SALE_INV_NO,
        A.RB_NO AS SB_NO, A.RB_DATE AS SB_DATE, A.RB_TYPE AS SB_TYPE,
        A.CODE, M.NAME, M.GST_NO, M.L_C, M.STATE_CODE, M.STATE,
        I.HSN_CODE, I.ITEM_NAME, I.HSN_UNIT,
        A.QNTY, A.WEIGHT,
        CAST(NULL AS VARCHAR2(1)) AS INPUT_YN, CAST(NULL AS VARCHAR2(1)) AS SL_C, CAST(NULL AS NUMBER) AS SCHEDULE,
        A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT,
        A.CGST_PER, A.SGST_PER, A.IGST_PER,
        A.BILL_AMT, A.REMARKS, A.V_DATE
      FROM SALE A
      LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND A.CODE = M.CODE
      LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))`;
    const purchaseSql = `
      SELECT
        A.TYPE, CAST(NULL AS VARCHAR2(1)) AS S_P, A.R_DATE, A.R_NO, A.BILL_DATE, A.BILL_NO, CAST(NULL AS VARCHAR2(1)) AS B_TYPE,
        A.CODE, M.NAME, M.GST_NO, M.L_C, M.STATE_CODE, M.STATE,
        I.HSN_CODE, I.ITEM_NAME, I.HSN_UNIT,
        A.QNTY, A.WEIGHT, A.INPUT_YN, CAST(NULL AS VARCHAR2(5)) AS TAX_FORM, A.REMARKS, CAST(NULL AS VARCHAR2(1)) AS SHOW_IN_GSTR, A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT,
        A.CGST_PER, A.SGST_PER, A.IGST_PER
      FROM PURCHASE A
      LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND A.CODE = M.CODE
      LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.R_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))`;
    const binds = { comp_code, s_date, e_date };
    const saleRows = (await runQuery(saleSql, binds, comp_uid)) || [];
    const purRows = (await runQuery(purchaseSql, binds, comp_uid)) || [];

    const billTotals = new Map();
    saleRows.forEach((r) => {
      const k = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE);
      const inv = gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      billTotals.set(k, gstrNum(billTotals.get(k)) + inv);
    });

    /**
     * GSTR classification
     * New DBs: SALE.TYPE is numeric (VFP-style) instead of SL/SE/CN buckets.
     * - Outward invoices: 0,1,3
     * - Notes/returns: 4,7,8 (4 & 8 are negative for EXEMP/HSN/GSTR3B sign)
     *
     * Keep backward compatibility with legacy char TYPEs (SL/SE/CN/…).
     */
    function saleTypeNum(raw) {
      if (raw == null || raw === '') return NaN;
      if (typeof raw === 'number') return raw;
      const s = String(raw).trim();
      if (!s) return NaN;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : NaN;
    }
    function saleTypeUpper(raw) {
      return gstrTxt(raw).toUpperCase();
    }
    const isInvoiceTypeNum = (n) => n === 0 || n === 1 || n === 3;
    const isNoteTypeNum = (n) => n === 4 || n === 7 || n === 8;
    const isNegTypeNum = (n) => n === 4 || n === 8;
    const isExportTypeNum = (n) => n === 6;
    const isRcTypeNum = (n) => n === 9;

    const outwardSet = new Set(['SL', 'ST', 'SR', 'GT', 'GR', 'SX']);
    const outwardSetCn = new Set(['SL', 'ST', 'SR', 'GT', 'GR', 'SX', 'CN', 'GN', 'CX']);
    function isOutwardInvoiceRow(r) {
      const n = saleTypeNum(r?.TYPE);
      if (Number.isFinite(n)) return isInvoiceTypeNum(n);
      return outwardSet.has(saleTypeUpper(r?.TYPE));
    }
    function isOutwardOrNoteRow(r) {
      const n = saleTypeNum(r?.TYPE);
      if (Number.isFinite(n)) return isInvoiceTypeNum(n) || isNoteTypeNum(n);
      return outwardSetCn.has(saleTypeUpper(r?.TYPE));
    }
    function saleRowSignForGstr(r, { includeExport = true } = {}) {
      const n = saleTypeNum(r?.TYPE);
      if (Number.isFinite(n)) {
        if (isNegTypeNum(n)) return -1;
        return 1;
      }
      const tp = saleTypeUpper(r?.TYPE);
      if (!includeExport && tp === 'ER') return 1;
      return ['CN', 'GN', 'CX', 'ER'].includes(tp) ? -1 : 1;
    }
    const b2b = [];
    const b2bMap = new Map();
    const b2bBillTaxableMap = new Map();
    saleRows.forEach((r) => {
      if (!isOutwardInvoiceRow(r)) return;
      if (!gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const bk = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE);
      b2bBillTaxableMap.set(bk, gstrNum(b2bBillTaxableMap.get(bk)) + gstrNum(r.TAXABLE));
    });
    saleRows.forEach((r) => {
      const tp = saleTypeUpper(r.TYPE);
      if (!isOutwardInvoiceRow(r)) return;
      if (!gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const invNo = gstrTxt(r.SALE_INV_NO);
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.GST_NO, invNo, r.B_TYPE, r.BILL_DATE, rate);
      const item = b2bMap.get(k) || {
        GSTIN: gstrTxt(r.GST_NO),
        NAME: gstrTxt(r.NAME),
        INVOICE_NO: invNo,
        INVOICE_DATE: gstrDt(r.BILL_DATE),
        INVOICE_VALUE: 0,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        REVERSE_CHARGE: tp === 'RC' ? 'Y' : 'N',
        APPLICABLE_TAX: null,
        INVOICE_TYPE: 'Regular B2B',
        E_COMMERCE_GSTIN: '',
        RATE: rate,
        TAXABLE_VALUE: 0,
        CESS_AMT: 0,
        _TYPE: tp,
        _BILL_NO: gstrTxt(r.BILL_NO),
        _B_TYPE: gstrTxt(r.B_TYPE),
      };
      item.TAXABLE_VALUE += gstrNum(r.TAXABLE);
      item.INVOICE_VALUE = gstrNum(billTotals.get(keyOf(r.TYPE, r.BILL_NO, r.B_TYPE)));
      item.TAXABLE_VALUE = gstrNum(b2bBillTaxableMap.get(keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));
      b2bMap.set(k, item);
    });
    b2b.push(...Array.from(b2bMap.values()));
    b2b.sort((a, b) => {
      const d = gstrParseDispDate(a.INVOICE_DATE) - gstrParseDispDate(b.INVOICE_DATE);
      if (d !== 0) return d;
      return gstrTxt(a.INVOICE_NO).localeCompare(gstrTxt(b.INVOICE_NO), 'en', { numeric: true, sensitivity: 'base' });
    });

    const b2cl = [];
    const b2clMap = new Map();
    const b2clBillTotals = new Map();
    const b2clBillTaxable = new Map();
    saleRows.forEach((r) => {
      const tp = saleTypeUpper(r.TYPE);
      if (!isOutwardOrNoteRow(r)) return;
      if (gstrHas(r.GST_NO)) return;
      const sign = saleRowSignForGstr(r);
      const billKey = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE);
      const lineInv = gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      b2clBillTotals.set(billKey, gstrNum(b2clBillTotals.get(billKey)) + sign * lineInv);
      b2clBillTaxable.set(billKey, gstrNum(b2clBillTaxable.get(billKey)) + sign * gstrNum(r.TAXABLE));
    });
    saleRows.forEach((r) => {
      const tp = saleTypeUpper(r.TYPE);
      if (!isOutwardOrNoteRow(r)) return;
      if (gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btoclYn !== 'Y' && taxTotal === 0) return;
      const billAmt = gstrNum(r.BILL_AMT);
      if (!(billAmt > opts.b2clLimit)) return;
      const invNo = gstrTxt(r.SALE_INV_NO) || gstrTxt(r.BILL_NO);
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(invNo, r.BILL_DATE, rate, r.TYPE, r.B_TYPE);
      const sign = saleRowSignForGstr(r);
      const it = b2clMap.get(k) || {
        INVOICE_NO: invNo,
        INVOICE_DATE: gstrDt(r.BILL_DATE),
        INVOICE_VALUE: 0,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        APPLICABLE_TAX: 0,
        RATE: rate,
        TAXABLE_VALUE: 0,
        _TYPE: tp,
        _BILL_NO: gstrTxt(r.BILL_NO),
        _B_TYPE: gstrTxt(r.B_TYPE),
      };
      it.INVOICE_VALUE += sign * (gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT));
      it.TAXABLE_VALUE += sign * gstrNum(r.TAXABLE);
      it.INVOICE_VALUE = gstrNum(b2clBillTotals.get(keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));
      it.TAXABLE_VALUE = gstrNum(b2clBillTaxable.get(keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));
      b2clMap.set(k, it);
    });
    b2cl.push(...Array.from(b2clMap.values()));
    const b2clInvoiceWise = b2cl.map((r) => ({
      INVOICE_NO: gstrTxt(r.INVOICE_NO),
      INVOICE_DATE: gstrTxt(r.INVOICE_DATE),
      INVOICE_VALUE: gstrNum(r.INVOICE_VALUE),
      PLACE_OF_SUPPLY: gstrTxt(r.PLACE_OF_SUPPLY),
      APPLICABLE_TAX: 0,
      RATE: gstrNum(r.RATE),
      TAXABLE_VALUE: gstrNum(r.TAXABLE_VALUE),
      CESS_AMT: 0,
      E_COMMERCE_GSTIN: '',
      _TYPE: gstrTxt(r._TYPE),
      _BILL_NO: gstrTxt(r._BILL_NO),
      _B_TYPE: gstrTxt(r._B_TYPE),
    }));
    b2cl.length = 0;
    b2cl.push(...b2clInvoiceWise);
    b2cl.sort((a, b) => {
      const d = gstrParseDispDate(a.INVOICE_DATE) - gstrParseDispDate(b.INVOICE_DATE);
      if (d !== 0) return d;
      return gstrTxt(a.INVOICE_NO).localeCompare(gstrTxt(b.INVOICE_NO), 'en', { numeric: true, sensitivity: 'base' });
    });

    // --------- B2CS (VFP X1/X2/X3/X4/X5/X6/X7 equivalent) ---------
    const mdetRows = saleRows.filter((r) => {
      const tp = saleTypeUpper(r.TYPE);
      if (!isOutwardOrNoteRow(r)) return false;
      if (gstrHas(r.GST_NO)) return false;
      if (opts.btocsYn !== 'Y') {
        const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
        if (taxTotal === 0) return false;
      }
      return true;
    });

    // X1: grouped invoice/rate rows
    const x1Map = new Map();
    mdetRows.forEach((r) => {
      const tp = saleTypeUpper(r.TYPE);
      const sign = saleRowSignForGstr(r, { includeExport: false });
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const invNo = gstrTxt(r.BILL_NO);
      const invDt = gstrDt(r.BILL_DATE);
      const k = keyOf(invNo, invDt, rate, tp, r.B_TYPE);
      const it = x1Map.get(k) || {
        INVOICE_NO: invNo,
        INVOICE_DATE: invDt,
        INVOICE_VALUE: 0,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        RATE: rate,
        TAXABLE_VALUE: 0,
        TYPE: tp,
        B_TYPE: gstrTxt(r.B_TYPE),
      };
      it.INVOICE_VALUE += sign * (gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT));
      it.TAXABLE_VALUE += sign * gstrNum(r.TAXABLE);
      x1Map.set(k, it);
    });
    const x1 = Array.from(x1Map.values());

    // X2: grouped by bill + code + l_c (and tax condition when btocsYn != 'Y')
    const x2Map = new Map();
    mdetRows.forEach((r) => {
      const k = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, gstrDt(r.BILL_DATE), r.CODE, r.NAME, r.GST_NO, r.L_C);
      const it = x2Map.get(k) || {
        TYPE: gstrTxt(r.TYPE).toUpperCase(),
        BILL_NO: gstrTxt(r.BILL_NO),
        B_TYPE: gstrTxt(r.B_TYPE),
        BILL_DATE: gstrDt(r.BILL_DATE),
        CODE: gstrTxt(r.CODE),
        NAME: gstrTxt(r.NAME),
        GST_NO: gstrTxt(r.GST_NO),
        L_C: gstrTxt(r.L_C).toUpperCase(),
        BILL_AMT: 0,
        TAX_TOTAL: 0,
      };
      it.BILL_AMT += gstrNum(r.BILL_AMT);
      it.TAX_TOTAL += gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      x2Map.set(k, it);
    });
    let x2 = Array.from(x2Map.values());
    if (opts.btocsYn === 'Y') {
      x2 = x2.filter((r) => gstrNum(r.BILL_AMT) < opts.b2clLimit);
    } else {
      x2 = x2.filter((r) => gstrNum(r.TAX_TOTAL) !== 0);
    }

    // X3 + X4 => X5
    const x3 = x2.filter((r) => r.L_C === 'C' && gstrNum(r.BILL_AMT) <= opts.b2clLimit);
    const x4 = x2.filter((r) => r.L_C === 'L');
    const x5 = [...x3, ...x4];
    const x5Keys = new Set(x5.map((r) => keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));

    // X6: pick X1 entries that EXIST in X5 (type,bill_no,b_type,bill_date)
    const x6 = x1.filter((r) => x5Keys.has(keyOf(r.TYPE, r.INVOICE_NO, r.B_TYPE, r.INVOICE_DATE)));

    // X7: final b2cs grouped by place + rate
    const b2csMap = new Map();
    x6.forEach((r) => {
      const k = keyOf(r.PLACE_OF_SUPPLY, r.RATE);
      const it = b2csMap.get(k) || {
        TYPE: 'OE',
        PLACE_OF_SUPPLY: gstrTxt(r.PLACE_OF_SUPPLY),
        APPLICABLE_TAX: 0,
        RATE: gstrRate(r.RATE),
        TAXABLE_VALUE: 0,
      };
      it.TAXABLE_VALUE += gstrNum(r.TAXABLE_VALUE);
      b2csMap.set(k, it);
    });
    const b2cs = Array.from(b2csMap.values());

    const cdnrMap = new Map();
    saleRows.forEach((r) => {
      const n = saleTypeNum(r.TYPE);
      const tp = saleTypeUpper(r.TYPE);
      if (Number.isFinite(n)) {
        if (!isNoteTypeNum(n)) return;
      } else {
        if (!['CN', 'GN', 'CX'].includes(tp)) return;
      }
      if (!gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const noteType = Number.isFinite(n) ? (n === 7 ? 'D' : 'C') : tp === 'CX' ? 'D' : 'C';
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.GST_NO, r.BILL_NO, r.BILL_DATE, noteType, rate);
      const it = cdnrMap.get(k) || {
        GSTIN: gstrTxt(r.GST_NO),
        NAME: gstrTxt(r.NAME),
        NOTE_NUMBER: gstrTxt(r.BILL_NO),
        NOTE_DATE: gstrDt(r.BILL_DATE),
        DOCUMENT_TYPE: noteType,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        REV_CHARGE: 'N',
        NOTE_SUPPLY_TYPE: 'Regular',
        VOUCHER_VALUE: 0,
        APPLICABLE_TAX: 0,
        RATE: rate,
        TAXABLE_VALUE: 0,
        CESS: 0,
        _SOURCE: 'SALE',
        _TYPE: tp,
        _NOTE_NO: gstrTxt(r.BILL_NO),
        _NOTE_DATE: gstrDt(r.BILL_DATE),
        _B_TYPE: gstrTxt(r.SB_TYPE || r.B_TYPE),
      };
      it.VOUCHER_VALUE += gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      it.TAXABLE_VALUE += gstrNum(r.TAXABLE);
      cdnrMap.set(k, it);
    });
    purRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!['DN', 'DX', 'CX'].includes(tp)) return;
      if (!gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const noteType = tp === 'CX' ? 'C' : 'D';
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.GST_NO, r.R_NO, r.R_DATE, noteType, rate);
      const it = cdnrMap.get(k) || {
        GSTIN: gstrTxt(r.GST_NO),
        NAME: gstrTxt(r.NAME),
        NOTE_NUMBER: gstrTxt(r.R_NO),
        NOTE_DATE: gstrDt(r.R_DATE),
        DOCUMENT_TYPE: noteType,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        REV_CHARGE: 'N',
        NOTE_SUPPLY_TYPE: 'Regular',
        VOUCHER_VALUE: 0,
        APPLICABLE_TAX: 0,
        RATE: rate,
        TAXABLE_VALUE: 0,
        CESS: 0,
        _SOURCE: 'PURCHASE',
        _TYPE: tp,
        _NOTE_NO: gstrTxt(r.R_NO),
        _NOTE_DATE: gstrDt(r.R_DATE),
        _B_TYPE: gstrTxt(r.B_TYPE),
      };
      it.VOUCHER_VALUE += gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      it.TAXABLE_VALUE += gstrNum(r.TAXABLE);
      cdnrMap.set(k, it);
    });
    const cdnr = Array.from(cdnrMap.values());
    cdnr.sort((a, b) => {
      const d = gstrParseDispDate(a.NOTE_DATE) - gstrParseDispDate(b.NOTE_DATE);
      if (d !== 0) return d;
      return gstrTxt(a.NOTE_NUMBER).localeCompare(gstrTxt(b.NOTE_NUMBER), 'en', { numeric: true, sensitivity: 'base' });
    });

    const cdnur = [];
    const cdnurMap = new Map();
    saleRows.forEach((r) => {
      const n = saleTypeNum(r.TYPE);
      const tp = saleTypeUpper(r.TYPE);
      if (Number.isFinite(n)) {
        if (!isNoteTypeNum(n)) return;
      } else {
        if (!['CN', 'GN', 'CX'].includes(tp)) return;
      }
      if (gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const noteType = Number.isFinite(n) ? (n === 7 ? 'D' : 'C') : tp === 'CX' ? 'D' : 'C';
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.BILL_NO, r.BILL_DATE, noteType, rate);
      const it = cdnurMap.get(k) || {
        UR_TYPE: 'B2CL',
        NOTE_NUMBER: gstrTxt(r.BILL_NO),
        NOTE_DATE: gstrDt(r.BILL_DATE),
        DOCUMENT_TYPE: noteType,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        VOUCHER_VALUE: 0,
        APPLICABLE_TAX: 0,
        RATE: rate,
        TAXABLE_VALUE: 0,
        CESS: 0,
        PRE_GST: 'N',
        _SOURCE: 'SALE',
        _TYPE: tp,
        _NOTE_NO: gstrTxt(r.BILL_NO),
        _NOTE_DATE: gstrDt(r.BILL_DATE),
        _B_TYPE: gstrTxt(r.SB_TYPE || r.B_TYPE),
      };
      it.VOUCHER_VALUE += gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      it.TAXABLE_VALUE += gstrNum(r.TAXABLE);
      cdnurMap.set(k, it);
    });
    cdnur.push(...Array.from(cdnurMap.values()));
    cdnur.sort((a, b) => {
      const d = gstrParseDispDate(a.NOTE_DATE) - gstrParseDispDate(b.NOTE_DATE);
      if (d !== 0) return d;
      return gstrTxt(a.NOTE_NUMBER).localeCompare(gstrTxt(b.NOTE_NUMBER), 'en', { numeric: true, sensitivity: 'base' });
    });

    const expMap = new Map();
    saleRows.forEach((r) => {
      const n = saleTypeNum(r.TYPE);
      const tp = saleTypeUpper(r.TYPE);
      if (Number.isFinite(n)) {
        if (!isExportTypeNum(n)) return;
      } else {
        if (!['SE', 'ER'].includes(tp)) return;
      }
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.BILL_NO, r.BILL_DATE, rate);
      const sign = Number.isFinite(n) ? 1 : tp === 'ER' ? -1 : 1;
      const it = expMap.get(k) || {
        EXPORT_TYPE: rate === 0 ? 'WOPAY' : 'WPAY',
        INVOICE_NO: fmtInvNo(r, opts),
        INVOICE_DATE: gstrDt(r.BILL_DATE),
        INVOICE_VALUE: 0,
        PORT: gstrTxt(r.REMARKS1) || 'INDB91',
        SHIPPING_BILL_NO: gstrTxt(r.REMARKS),
        SHIPPING_BILL_DATE: gstrDt(r.V_DATE),
        RATE: rate,
        TAXABLE_VALUE: 0,
        _TYPE: tp,
        _BILL_NO: gstrTxt(r.BILL_NO),
        _B_TYPE: gstrTxt(r.B_TYPE),
      };
      it.INVOICE_VALUE += sign * (gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT));
      it.TAXABLE_VALUE += sign * gstrNum(r.TAXABLE);
      expMap.set(k, it);
    });
    const exp = Array.from(expMap.values());
    const expa = [];

    // EXEMP: keep VFP parity (compute only when BTOBYN <> 'Y')
    let exemp = [];
    if (opts.btobYn !== 'Y') {
      // X1
      const x1 = saleRows.filter((r) => {
        const n = saleTypeNum(r.TYPE);
        const tp = saleTypeUpper(r.TYPE);
        if (Number.isFinite(n)) {
          if (!(isInvoiceTypeNum(n) || isNoteTypeNum(n))) return false;
        } else {
          if (!['SL', 'ST', 'SR', 'GT', 'GR', 'SX', 'CN'].includes(tp)) return false;
        }
        const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
        return taxTotal === 0;
      });
      // X2/X3
      const x2 = x1.filter((r) => gstrHas(r.GST_NO)); // registered
      const x3 = x1.filter((r) => !gstrHas(r.GST_NO)); // unregistered

      const sumByLc = (rows) => {
        const out = new Map();
        rows.forEach((r) => {
          const lc = gstrTxt(r.L_C).toUpperCase() === 'L' ? 'L' : 'C';
          const n = saleTypeNum(r.TYPE);
          const tp = saleTypeUpper(r.TYPE);
          const amt = Number.isFinite(n) ? (isNegTypeNum(n) ? -gstrNum(r.TAXABLE) : gstrNum(r.TAXABLE)) : tp === 'CN' ? -gstrNum(r.TAXABLE) : gstrNum(r.TAXABLE);
          out.set(lc, gstrNum(out.get(lc)) + amt);
        });
        return out;
      };

      // X4 / X5
      const x4 = sumByLc(x2); // reg sale
      const x5 = sumByLc(x3); // ur sale

      const sumPurchaseByLc = (filterFn) => {
        const out = new Map();
        purRows.forEach((r) => {
          const tp = gstrTxt(r.TYPE).toUpperCase();
          if (!filterFn(tp, r)) return;
          const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
          if (taxTotal !== 0) return;
          const lc = gstrTxt(r.L_C).toUpperCase() === 'L' ? 'L' : 'C';
          out.set(lc, gstrNum(out.get(lc)) + gstrNum(r.TAXABLE));
        });
        return out;
      };

      // X41/X51 (CX, S_P<>'P')
      const x41 = sumPurchaseByLc((tp, r) => tp === 'CX' && gstrTxt(r.S_P).toUpperCase() !== 'P' && gstrHas(r.GST_NO));
      const x51 = sumPurchaseByLc((tp, r) => tp === 'CX' && gstrTxt(r.S_P).toUpperCase() !== 'P' && !gstrHas(r.GST_NO));
      // X42/X52 (DX, S_P='S')
      const x42 = sumPurchaseByLc((tp, r) => tp === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'S' && gstrHas(r.GST_NO));
      const x52 = sumPurchaseByLc((tp, r) => tp === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'S' && !gstrHas(r.GST_NO));

      let exmp_l_r = 0;
      let exmp_c_r = 0;
      let exmp_l_ur = 0;
      let exmp_c_ur = 0;

      exmp_l_r = gstrNum(x4.get('L'));
      exmp_c_r = gstrNum(x4.get('C'));
      exmp_l_r -= gstrNum(x41.get('L'));
      exmp_c_r -= gstrNum(x41.get('C'));
      exmp_l_r += gstrNum(x42.get('L'));
      exmp_c_r += gstrNum(x42.get('C'));

      exmp_l_ur = gstrNum(x5.get('L'));
      exmp_c_ur = gstrNum(x5.get('C'));
      exmp_l_ur -= gstrNum(x51.get('L'));
      exmp_c_ur -= gstrNum(x51.get('C'));
      exmp_l_ur += gstrNum(x52.get('L'));
      exmp_c_ur += gstrNum(x52.get('C'));

      exemp = [
        { DESCRIPTION: 'Inter-State supplies to registered persons', NIL_RATED: 0, EXMPTED: exmp_c_r, NON_GST_SUP: 0, _KEY: 'REG_INTER' },
        { DESCRIPTION: 'Intra-State supplies to registered persons', NIL_RATED: 0, EXMPTED: exmp_l_r, NON_GST_SUP: 0, _KEY: 'REG_INTRA' },
        { DESCRIPTION: 'Inter-State supplies to unregistered persons', NIL_RATED: 0, EXMPTED: exmp_c_ur, NON_GST_SUP: 0, _KEY: 'UR_INTER' },
        { DESCRIPTION: 'Intra-State supplies to unregistered persons', NIL_RATED: 0, EXMPTED: exmp_l_ur, NON_GST_SUP: 0, _KEY: 'UR_INTRA' },
      ];
    }

    const buildHsn = (registered) => {
      const m = new Map();
      saleRows.forEach((r) => {
        const isReg = gstrHas(r.GST_NO);
        if (isReg !== registered) return;
        const n = saleTypeNum(r.TYPE);
        const tp = saleTypeUpper(r.TYPE);
        const sign = Number.isFinite(n) ? (isNegTypeNum(n) ? -1 : 1) : ['CN', 'GN', 'CX', 'ER'].includes(tp) ? -1 : 1;
        const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
        const k = keyOf(r.HSN_CODE, rate);
        const it = m.get(k) || {
          HSN_CODE: gstrTxt(r.HSN_CODE),
          DESCRIPTION: gstrTxt(r.ITEM_NAME) || gstrTxt(r.HSN_CODE),
          UQC: gstrTxt(r.HSN_UNIT),
          TOTAL_QUANTITY: 0,
          TOTAL_VALUE: 0,
          TAX_RATE: rate,
          TAXABLE_VALUE: 0,
          IGST: 0,
          CGST: 0,
          SGST: 0,
          CESS_AMOUNT: 0,
        };
        it.TOTAL_QUANTITY += sign * gstrNum(r.WEIGHT ?? r.QNTY);
        it.TOTAL_VALUE += sign * (gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT));
        it.TAXABLE_VALUE += sign * gstrNum(r.TAXABLE);
        it.IGST += sign * gstrNum(r.IGST_AMT);
        it.CGST += sign * gstrNum(r.CGST_AMT);
        it.SGST += sign * gstrNum(r.SGST_AMT);
        m.set(k, it);
      });
      return Array.from(m.values());
    };
    const hsn_b2b = buildHsn(true);
    const hsn_b2c = buildHsn(false);

    // DOCS: count unique documents by TYPE+B_TYPE+BILL_DATE+BILL_NO,
    // then summarize by TYPE+B_TYPE for from/to/total.
    const uniqueDocs = new Map();
    saleRows.forEach((r) => {
      const tp = saleTypeUpper(r.TYPE);
      const bt = gstrTxt(r.B_TYPE);
      const billNo = gstrTxt(r.BILL_NO);
      const billDate = gstrDt(r.BILL_DATE);
      const k = keyOf(tp, bt, billDate, billNo);
      if (!uniqueDocs.has(k)) {
        uniqueDocs.set(k, { TYPE: tp, B_TYPE: bt, BILL_DATE: billDate, BILL_NO: billNo });
      }
    });
    const docsMap = new Map();
    Array.from(uniqueDocs.values()).forEach((d) => {
      const k = keyOf(d.TYPE, d.B_TYPE);
      const it = docsMap.get(k) || { TYPE: d.TYPE, B_TYPE: d.B_TYPE, from: d.BILL_NO, to: d.BILL_NO, total: 0 };
      it.total += 1;
      if (!it.from || gstrTxt(d.BILL_NO).localeCompare(gstrTxt(it.from), 'en', { numeric: true, sensitivity: 'base' }) < 0) it.from = d.BILL_NO;
      if (!it.to || gstrTxt(d.BILL_NO).localeCompare(gstrTxt(it.to), 'en', { numeric: true, sensitivity: 'base' }) > 0) it.to = d.BILL_NO;
      docsMap.set(k, it);
    });
    const docs = Array.from(docsMap.values()).map((d) => ({
      NATURE_OF_DOCUMENT:
        (() => {
          const n = saleTypeNum(d.TYPE);
          const tp = saleTypeUpper(d.TYPE);
          if (Number.isFinite(n)) {
            if (n === 8) return 'Credit note';
            if (n === 7) return 'Debit note';
            return 'Invoice for outward supply';
          }
          if (tp === 'CN') return 'Credit note';
          return 'Invoice for outward supply';
        })(),
      SR_NO_FROM: d.from,
      SR_NO_TO: d.to,
      TOTAL_NUMBER: d.total,
      CANCELLED: 0,
    }));

    // GSTR3B (VFP-aligned totals)
    const saleSign = (tp) => {
      const n = saleTypeNum(tp);
      if (Number.isFinite(n)) return isNegTypeNum(n) ? -1 : 1;
      return ['CN', 'GN', 'CX', 'ER'].includes(gstrTxt(tp).toUpperCase()) ? -1 : 1;
    };
    const saleSignNoEr = (tp) => {
      const n = saleTypeNum(tp);
      if (Number.isFinite(n)) return isNegTypeNum(n) ? -1 : 1;
      return ['CN', 'GN', 'CX'].includes(gstrTxt(tp).toUpperCase()) ? -1 : 1;
    };
    const sumSigned = (rows, signFn) => rows.reduce((a, r) => {
      const s = signFn(r.TYPE);
      a.taxable += s * gstrNum(r.TAXABLE);
      a.igst += s * gstrNum(r.IGST_AMT);
      a.cgst += s * gstrNum(r.CGST_AMT);
      a.sgst += s * gstrNum(r.SGST_AMT);
      return a;
    }, { taxable: 0, igst: 0, cgst: 0, sgst: 0 });
    const sumPlain = (rows) => rows.reduce((a, r) => {
      a.taxable += gstrNum(r.TAXABLE);
      a.igst += gstrNum(r.IGST_AMT);
      a.cgst += gstrNum(r.CGST_AMT);
      a.sgst += gstrNum(r.SGST_AMT);
      return a;
    }, { taxable: 0, igst: 0, cgst: 0, sgst: 0 });
    const taxTotal = (r) => gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);

    let CGST_PAYABLE = 0;
    let SGST_PAYABLE = 0;
    let IGST_PAYABLE = 0;
    let CGST_PAID = 0;
    let SGST_PAID = 0;
    let IGST_PAID = 0;

    const aBase = sumSigned(
      saleRows.filter((r) => {
        const n = saleTypeNum(r.TYPE);
        if (Number.isFinite(n)) return !isRcTypeNum(n) && taxTotal(r) !== 0;
        return gstrTxt(r.TYPE).toUpperCase() !== 'RC' && taxTotal(r) !== 0;
      }),
      saleSign
    );
    const aCx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'CX' && gstrTxt(r.S_P).toUpperCase() !== 'P' && taxTotal(r) !== 0));
    const aDx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'S' && taxTotal(r) !== 0));
    const row31a = {
      taxable: aBase.taxable - aCx.taxable + aDx.taxable,
      igst: aBase.igst - aCx.igst + aDx.igst,
      cgst: aBase.cgst - aCx.cgst + aDx.cgst,
      sgst: aBase.sgst - aCx.sgst + aDx.sgst,
    };
    CGST_PAYABLE = row31a.cgst;
    SGST_PAYABLE = row31a.sgst;
    IGST_PAYABLE = row31a.igst;

    const row31b = sumSigned(
      saleRows.filter((r) => {
        const n = saleTypeNum(r.TYPE);
        if (Number.isFinite(n)) return isExportTypeNum(n) && taxTotal(r) === 0;
        return ['SE', 'ER'].includes(gstrTxt(r.TYPE).toUpperCase()) && taxTotal(r) === 0;
      }),
      saleSign
    );

    const cBase = sumSigned(
      saleRows.filter((r) => {
        const n = saleTypeNum(r.TYPE);
        if (Number.isFinite(n)) return !isRcTypeNum(n) && !isExportTypeNum(n) && taxTotal(r) === 0;
        return !['RC', 'SE', 'ER'].includes(gstrTxt(r.TYPE).toUpperCase()) && taxTotal(r) === 0;
      }),
      saleSignNoEr
    );
    const cCx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'CX' && gstrTxt(r.S_P).toUpperCase() !== 'P' && taxTotal(r) === 0));
    const cDx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'S' && taxTotal(r) === 0));
    const row31c = {
      taxable: cBase.taxable - cCx.taxable + cDx.taxable,
      igst: cBase.igst - cCx.igst + cDx.igst,
      cgst: cBase.cgst - cCx.cgst + cDx.cgst,
      sgst: cBase.sgst - cCx.sgst + cDx.sgst,
    };

    const row31d = sumSigned(
      saleRows.filter((r) => {
        const n = saleTypeNum(r.TYPE);
        if (Number.isFinite(n)) return isRcTypeNum(n) && taxTotal(r) !== 0;
        return gstrTxt(r.TYPE).toUpperCase() === 'RC' && taxTotal(r) !== 0;
      }),
      saleSignNoEr
    );
    CGST_PAYABLE += row31d.cgst;
    SGST_PAYABLE += row31d.sgst;
    IGST_PAYABLE += row31d.igst;

    const row4a1 = sumPlain(purRows.filter((r) => gstrTxt(r.TAX_FORM).toUpperCase() === 'I'));
    IGST_PAID = row4a1.igst;
    SGST_PAID = row4a1.sgst;
    CGST_PAID = row4a1.cgst;
    const row4a2 = sumPlain(
      purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'EV' && gstrTxt(r.REMARKS).toUpperCase().startsWith('IS'))
    );
    IGST_PAID += row4a2.igst;
    SGST_PAID += row4a2.sgst;
    CGST_PAID += row4a2.cgst;
    const row4a3 = sumSigned(
      saleRows.filter((r) => {
        const n = saleTypeNum(r.TYPE);
        if (Number.isFinite(n)) return isRcTypeNum(n) && gstrTxt(r.INPUT_YN).toUpperCase() !== 'N' && taxTotal(r) !== 0;
        return gstrTxt(r.TYPE).toUpperCase() === 'RC' && gstrTxt(r.INPUT_YN).toUpperCase() !== 'N' && taxTotal(r) !== 0;
      }),
      saleSignNoEr
    );
    IGST_PAID += row4a3.igst;
    SGST_PAID += row4a3.sgst;
    CGST_PAID += row4a3.cgst;

    const row4a5Base = sumPlain(
      purRows.filter(
        (r) =>
          (gstrTxt(r.TYPE).toUpperCase() === 'PU' ||
            (gstrTxt(r.TYPE).toUpperCase() === 'EV' &&
              !gstrTxt(r.REMARKS).toUpperCase().startsWith('IS') &&
              gstrTxt(r.INPUT_YN).toUpperCase() !== 'N')) &&
          gstrTxt(r.TAX_FORM).toUpperCase() !== 'I' &&
          taxTotal(r) !== 0
      )
    );
    const row4a5Dn = sumPlain(purRows.filter((r) => (gstrTxt(r.TYPE).toUpperCase() === 'DN' || (gstrTxt(r.TYPE).toUpperCase() === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'P')) && taxTotal(r) !== 0));
    const row4a5Cx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'CX' && gstrTxt(r.S_P).toUpperCase() === 'P' && taxTotal(r) !== 0));
    const row4a5 = {
      taxable: row4a5Base.taxable - row4a5Dn.taxable + row4a5Cx.taxable,
      igst: row4a5Base.igst - row4a5Dn.igst + row4a5Cx.igst,
      cgst: row4a5Base.cgst - row4a5Dn.cgst + row4a5Cx.cgst,
      sgst: row4a5Base.sgst - row4a5Dn.sgst + row4a5Cx.sgst,
    };
    IGST_PAID -= row4a5Cx.igst;
    SGST_PAID -= row4a5Cx.sgst;
    CGST_PAID -= row4a5Cx.cgst;

    const sumLc = (rows) => rows.reduce((a, r) => {
      const isL = gstrTxt(r.L_C).toUpperCase() === 'L';
      if (isL) a.l += gstrNum(r.TAXABLE); else a.c += gstrNum(r.TAXABLE);
      return a;
    }, { l: 0, c: 0 });
    const exBase = sumLc(
      purRows.filter(
        (r) =>
          (gstrTxt(r.TYPE).toUpperCase() === 'PU' ||
            (gstrTxt(r.TYPE).toUpperCase() === 'EV' && gstrTxt(r.INPUT_YN).toUpperCase() === 'N')) &&
          gstrTxt(r.TAX_FORM).toUpperCase() !== 'I' &&
          taxTotal(r) === 0
      )
    );
    const exDn = sumLc(purRows.filter((r) => ['DX', 'DN'].includes(gstrTxt(r.TYPE).toUpperCase()) && taxTotal(r) === 0));
    const exCx = sumLc(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'CX' && gstrTxt(r.S_P).toUpperCase() === 'P' && taxTotal(r) === 0));
    const row5 = { l: exBase.l - exDn.l + exCx.l, c: exBase.c - exDn.c + exCx.c };

    const row51 = saleRows.reduce((a, r) => {
      if (Math.trunc(gstrNum(r.SCHEDULE)) !== 11) return a;
      const n = saleTypeNum(r.TYPE);
      const sign = Number.isFinite(n) ? (isNegTypeNum(n) ? -1 : 1) : gstrTxt(r.TYPE).toUpperCase() === 'CN' ? -1 : 1;
      const isL = gstrTxt(r.SL_C).toUpperCase() === 'L';
      if (isL) a.l += sign * gstrNum(r.TAXABLE); else a.c += sign * gstrNum(r.TAXABLE);
      return a;
    }, { l: 0, c: 0 });

    const gstr3b = [
      { PARTICULARS: 'OUTWARD SUPPLIES TAXABLE', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row31a.taxable, IGST: row31a.igst, CGST: row31a.cgst, SGST: row31a.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'OUTWARD SUPPLIES ZERO RATED', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row31b.taxable, IGST: 0, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'OUTWARD SUPPLIES EXEMPTED', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row31c.taxable, IGST: 0, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'REVERSE CHARGE', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row31d.taxable, IGST: row31d.igst, CGST: row31d.cgst, SGST: row31d.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'IMPORT OF GOODS', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row4a1.taxable, IGST: row4a1.igst, CGST: row4a1.cgst, SGST: row4a1.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'IMPORT OF SERVICES', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row4a2.taxable, IGST: row4a2.igst, CGST: row4a2.cgst, SGST: row4a2.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'REVERSE CHARGE', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row4a3.taxable, IGST: row4a3.igst, CGST: row4a3.cgst, SGST: row4a3.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'ALL OTHER ITC', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row4a5.taxable, IGST: row4a5.igst, CGST: row4a5.cgst, SGST: row4a5.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'NET ITC', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: IGST_PAID, CGST: CGST_PAID, SGST: SGST_PAID, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'FROM SUPPLIER EXEMPT', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: 0, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: row5.c, INTRA_STATE_SUPPLY: row5.l, TAX_PAYABLE: 0 },
      { PARTICULARS: 'CONSIGNMENT PURCHASE', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: 0, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: row51.c, INTRA_STATE_SUPPLY: row51.l, TAX_PAYABLE: 0 },
      { PARTICULARS: 'IGST', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: IGST_PAID, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: IGST_PAYABLE },
      { PARTICULARS: 'CGST', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: 0, CGST: CGST_PAID, SGST: 0, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: CGST_PAYABLE },
      { PARTICULARS: 'SGST', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: 0, CGST: 0, SGST: SGST_PAID, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: SGST_PAYABLE },
    ];

    const at = [];
    const atadj = [];
    const sheets = {
      b2b: gstrRoundAmountColumns(b2b),
      b2cl: gstrRoundAmountColumns(b2cl),
      b2cs: gstrRoundAmountColumns(b2cs),
      cdnr: gstrRoundAmountColumns(cdnr),
      cdnur: gstrRoundAmountColumns(cdnur),
      exp: gstrRoundAmountColumns(exp),
      expa: gstrRoundAmountColumns(expa),
      at: gstrRoundAmountColumns(at),
      atadj: gstrRoundAmountColumns(atadj),
      exemp: gstrRoundAmountColumns(exemp),
      'hsn(b2b)': gstrRoundAmountColumns(hsn_b2b),
      'hsn(b2c)': gstrRoundAmountColumns(hsn_b2c),
      docs: gstrRoundAmountColumns(docs),
      gstr3b: gstrRoundAmountColumns(gstr3b),
    };
    res.json({ ok: true, params: opts, period: { s_date, e_date }, sheets });
  } catch (err) {
    console.error('❌ GSTR1 report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-b2cs-detail', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      s_date,
      e_date,
      btocs_yn,
      b2cl_limit_mode,
      place_of_supply,
      rate,
    } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const targetPos = gstrTxt(place_of_supply);
    const targetRate = gstrRate(rate);
    const opts = {
      btocsYn: String(btocs_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      b2clLimit: String(b2cl_limit_mode || '1').trim() === '2' ? 100000 : 250000,
    };

    const saleSql = `
      SELECT
        A.TYPE, A.B_TYPE, A.BILL_DATE, A.BILL_NO, A.SALE_INV_NO,
        A.CODE, M.NAME, M.GST_NO, M.L_C, M.STATE_CODE, M.STATE,
        A.TRN_NO, A.ITEM_CODE, I.HSN_CODE, I.ITEM_NAME,
        A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT,
        A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT, A.BILL_AMT,
        A.CGST_PER, A.SGST_PER, A.IGST_PER
      FROM SALE A
      LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND A.CODE = M.CODE
      LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
    const rows = (await runQuery(saleSql, { comp_code, s_date, e_date }, comp_uid)) || [];

    function saleTypeNum(raw) {
      if (raw == null || raw === '') return NaN;
      if (typeof raw === 'number') return raw;
      const s = String(raw).trim();
      if (!s) return NaN;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : NaN;
    }
    const isInvoiceTypeNum = (n) => n === 0 || n === 1 || n === 3;
    const isNoteTypeNum = (n) => n === 4 || n === 7 || n === 8;
    const isNegTypeNum = (n) => n === 4 || n === 8;

    const outwardSetCn = new Set(['SL', 'ST', 'SR', 'GT', 'GR', 'SX', 'CN', 'GN', 'CX']);
    const mdetRows = rows.filter((r) => {
      const n = saleTypeNum(r.TYPE);
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (Number.isFinite(n)) {
        if (!(isInvoiceTypeNum(n) || isNoteTypeNum(n))) return false;
      } else if (!outwardSetCn.has(tp)) return false;
      if (gstrHas(r.GST_NO)) return false;
      if (opts.btocsYn !== 'Y') {
        const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
        if (taxTotal === 0) return false;
      }
      return true;
    });

    const x2Map = new Map();
    const billAmtSumMap = new Map();
    mdetRows.forEach((r) => {
      const billKey = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, gstrDt(r.BILL_DATE));
      billAmtSumMap.set(billKey, gstrNum(billAmtSumMap.get(billKey)) + gstrNum(r.BILL_AMT));
      const k = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, gstrDt(r.BILL_DATE), r.CODE, r.NAME, r.GST_NO, r.L_C);
      const it = x2Map.get(k) || {
        TYPE: gstrTxt(r.TYPE).toUpperCase(),
        BILL_NO: gstrTxt(r.BILL_NO),
        B_TYPE: gstrTxt(r.B_TYPE),
        BILL_DATE: gstrDt(r.BILL_DATE),
        L_C: gstrTxt(r.L_C).toUpperCase(),
        BILL_AMT: 0,
        TAX_TOTAL: 0,
      };
      it.BILL_AMT += gstrNum(r.BILL_AMT);
      it.TAX_TOTAL += gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      x2Map.set(k, it);
    });
    let x2 = Array.from(x2Map.values());
    if (opts.btocsYn === 'Y') x2 = x2.filter((r) => gstrNum(r.BILL_AMT) < opts.b2clLimit);
    else x2 = x2.filter((r) => gstrNum(r.TAX_TOTAL) !== 0);
    const x3 = x2.filter((r) => r.L_C === 'C' && gstrNum(r.BILL_AMT) <= opts.b2clLimit);
    const x4 = x2.filter((r) => r.L_C === 'L');
    const x5 = [...x3, ...x4];
    const x5Keys = new Set(x5.map((r) => keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));

    const detailMap = new Map();
    mdetRows.forEach((r) => {
      const type = gstrTxt(r.TYPE).toUpperCase();
      const invNo = gstrTxt(r.BILL_NO);
      const invDate = gstrDt(r.BILL_DATE);
      const bType = gstrTxt(r.B_TYPE);
      if (!x5Keys.has(keyOf(type, invNo, bType, invDate))) return;

      const pos = `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim();
      const rowRate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      if (targetPos && pos !== targetPos) return;
      if (gstrRate(rowRate) !== targetRate) return;

      const dk = keyOf(type, invDate, invNo, bType, pos, rowRate);
      const n = saleTypeNum(type);
      const sign = Number.isFinite(n) ? (isNegTypeNum(n) ? -1 : 1) : ['CN', 'GN', 'CX'].includes(type) ? -1 : 1;
      const item = detailMap.get(dk) || {
        TYPE: type,
        BILL_DATE: invDate,
        BILL_NO: invNo,
        B_TYPE: bType,
        SALE_INV_NO: gstrTxt(r.SALE_INV_NO),
        CODE: gstrTxt(r.CODE),
        NAME: gstrTxt(r.NAME),
        PLACE_OF_SUPPLY: pos,
        RATE: gstrRound2(rowRate),
        LINE_COUNT: 0,
        QNTY: 0,
        WEIGHT: 0,
        AMOUNT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
        BILL_AMT: gstrRound2(sign * gstrNum(billAmtSumMap.get(keyOf(type, invNo, bType, invDate)))),
      };
      item.LINE_COUNT += 1;
      item.QNTY += sign * gstrNum(r.QNTY);
      item.WEIGHT += sign * gstrNum(r.WEIGHT);
      item.AMOUNT += sign * gstrNum(r.AMOUNT);
      item.TAXABLE += sign * gstrNum(r.TAXABLE);
      item.CGST_AMT += sign * gstrNum(r.CGST_AMT);
      item.SGST_AMT += sign * gstrNum(r.SGST_AMT);
      item.IGST_AMT += sign * gstrNum(r.IGST_AMT);
      detailMap.set(dk, item);
    });
    const details = Array.from(detailMap.values())
      .map((r) => ({
        ...r,
        QNTY: gstrRound2(r.QNTY),
        WEIGHT: gstrRound2(r.WEIGHT),
        AMOUNT: gstrRound2(r.AMOUNT),
        TAXABLE: gstrRound2(r.TAXABLE),
        CGST_AMT: gstrRound2(r.CGST_AMT),
        SGST_AMT: gstrRound2(r.SGST_AMT),
        IGST_AMT: gstrRound2(r.IGST_AMT),
      }))
      .sort((a, b) => {
        const d = gstrParseDispDate(a.BILL_DATE) - gstrParseDispDate(b.BILL_DATE);
        if (d !== 0) return d;
        return gstrTxt(a.BILL_NO).localeCompare(gstrTxt(b.BILL_NO), 'en', { numeric: true, sensitivity: 'base' });
      });

    res.json({ ok: true, rows: details });
  } catch (err) {
    console.error('❌ gstr1-b2cs-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-sale-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, type, bill_no, b_type } = req.query;
    if (!comp_code || !comp_uid || !type || bill_no == null || bill_no === '') {
      return res.status(400).json({ error: 'comp_code, comp_uid, type, bill_no are required' });
    }
    const sql = `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.SALE_INV_NO,
        A.CODE,
        B.NAME,
        B.GST_NO,
        B.STATE_CODE,
        B.STATE,
        A.TRN_NO,
        A.ITEM_CODE,
        CAST(NULL AS VARCHAR2(30)) AS SALE_HSN_CODE,
        C.HSN_CODE,
        A.QNTY,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.TAXABLE,
        A.CGST_AMT,
        A.SGST_AMT,
        A.IGST_AMT,
        A.BILL_AMT
      FROM SALE A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND A.CODE = B.CODE
      LEFT JOIN ITEMMAST C
        ON A.COMP_CODE = C.COMP_CODE
       AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND TRIM(TO_CHAR(A.BILL_NO)) = TRIM(TO_CHAR(:bill_no))
        AND TRIM(NVL(A.B_TYPE, ' ')) = TRIM(NVL(:b_type, ' '))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;

    const rows = (await runQuery(sql, { comp_code, type, bill_no, b_type: b_type ?? ' ' }, comp_uid)) || [];
    const total = {
      line_count: rows.length,
      taxable_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
      amount_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.AMOUNT), 0)),
      cgst_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.CGST_AMT), 0)),
      sgst_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.SGST_AMT), 0)),
      igst_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.IGST_AMT), 0)),
      bill_total: gstrRound2(rows.reduce((m, r) => Math.max(m, gstrNum(r.BILL_AMT)), 0)),
    };

    const outRows = rows.map((r) => ({
      TYPE: gstrTxt(r.TYPE),
      BILL_DATE: gstrDt(r.BILL_DATE),
      BILL_NO: gstrTxt(r.BILL_NO),
      B_TYPE: gstrTxt(r.B_TYPE),
      SALE_INV_NO: gstrTxt(r.SALE_INV_NO),
      CODE: gstrTxt(r.CODE),
      NAME: gstrTxt(r.NAME),
      GST_NO: gstrTxt(r.GST_NO),
      STATE_CODE: gstrTxt(r.STATE_CODE),
      STATE: gstrTxt(r.STATE),
      TRN_NO: gstrNum(r.TRN_NO),
      ITEM_CODE: gstrTxt(r.ITEM_CODE),
      SALE_HSN_CODE: gstrTxt(r.SALE_HSN_CODE),
      HSN_CODE: gstrTxt(r.HSN_CODE),
      QNTY: gstrRound2(gstrNum(r.QNTY)),
      WEIGHT: gstrRound2(gstrNum(r.WEIGHT)),
      RATE: gstrRound2(gstrNum(r.RATE)),
      AMOUNT: gstrRound2(gstrNum(r.AMOUNT)),
      TAXABLE: gstrRound2(gstrNum(r.TAXABLE)),
      CGST_AMT: gstrRound2(gstrNum(r.CGST_AMT)),
      SGST_AMT: gstrRound2(gstrNum(r.SGST_AMT)),
      IGST_AMT: gstrRound2(gstrNum(r.IGST_AMT)),
      BILL_AMT: gstrRound2(gstrNum(r.BILL_AMT)),
    }));

    res.json({ ok: true, rows: outRows, total });
  } catch (err) {
    console.error('❌ gstr1-sale-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-note-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, source, type, note_no, note_date, b_type } = req.query;
    if (!comp_code || !comp_uid || !source || !type || note_no == null || note_no === '' || !note_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, source, type, note_no, note_date are required' });
    }

    const src = String(source).trim().toUpperCase();
    if (src === 'SALE') {
      const sql = `
        SELECT
          A.TYPE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.SALE_INV_NO,
          A.CODE, B.NAME, B.GST_NO, B.STATE_CODE, B.STATE,
          A.TRN_NO, A.ITEM_CODE, CAST(NULL AS VARCHAR2(30)) AS SALE_HSN_CODE, C.HSN_CODE,
          A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT, A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT, A.BILL_AMT
        FROM SALE A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
        WHERE A.COMP_CODE = :comp_code
          AND TRIM(A.TYPE) = TRIM(:type)
          AND TRIM(TO_CHAR(A.BILL_NO)) = TRIM(TO_CHAR(:note_no))
          AND TRUNC(A.BILL_DATE) = TRUNC(TO_DATE(:note_date,'DD-MON-YY'))
          AND TRIM(NVL(A.B_TYPE,' ')) = TRIM(NVL(:b_type,' '))
        ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
      const rows = (await runQuery(sql, { comp_code, type, note_no, note_date, b_type: b_type ?? ' ' }, comp_uid)) || [];
      const outRows = rows.map((r) => ({
        SOURCE: 'SALE',
        TYPE: gstrTxt(r.TYPE),
        NOTE_DATE: gstrDt(r.BILL_DATE),
        NOTE_NO: gstrTxt(r.BILL_NO),
        B_TYPE: gstrTxt(r.B_TYPE),
        SALE_INV_NO: gstrTxt(r.SALE_INV_NO),
        CODE: gstrTxt(r.CODE),
        NAME: gstrTxt(r.NAME),
        GST_NO: gstrTxt(r.GST_NO),
        STATE_CODE: gstrTxt(r.STATE_CODE),
        STATE: gstrTxt(r.STATE),
        TRN_NO: gstrNum(r.TRN_NO),
        ITEM_CODE: gstrTxt(r.ITEM_CODE),
        SALE_HSN_CODE: gstrTxt(r.SALE_HSN_CODE),
        HSN_CODE: gstrTxt(r.HSN_CODE),
        QNTY: gstrRound2(gstrNum(r.QNTY)),
        WEIGHT: gstrRound2(gstrNum(r.WEIGHT)),
        RATE: gstrRound2(gstrNum(r.RATE)),
        AMOUNT: gstrRound2(gstrNum(r.AMOUNT)),
        TAXABLE: gstrRound2(gstrNum(r.TAXABLE)),
        CGST_AMT: gstrRound2(gstrNum(r.CGST_AMT)),
        SGST_AMT: gstrRound2(gstrNum(r.SGST_AMT)),
        IGST_AMT: gstrRound2(gstrNum(r.IGST_AMT)),
        BILL_AMT: gstrRound2(gstrNum(r.BILL_AMT)),
      }));
      const total = {
        line_count: outRows.length,
        taxable_total: gstrRound2(outRows.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
        bill_total: gstrRound2(outRows.reduce((m, r) => Math.max(m, gstrNum(r.BILL_AMT)), 0)),
      };
      return res.json({ ok: true, rows: outRows, total });
    }

    const sql = `
      SELECT
        A.TYPE, A.R_DATE, A.R_NO, A.B_TYPE, A.BILL_DATE, A.BILL_NO,
        A.CODE, B.NAME, B.GST_NO, B.STATE_CODE, B.STATE,
        A.ITEM_CODE, C.HSN_CODE, A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT,
        A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT, A.BILL_AMT
      FROM PURCHASE A
      LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND TRIM(TO_CHAR(A.R_NO)) = TRIM(TO_CHAR(:note_no))
        AND TRUNC(A.R_DATE) = TRUNC(TO_DATE(:note_date,'DD-MON-YY'))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
    const rows = (await runQuery(sql, { comp_code, type, note_no, note_date }, comp_uid)) || [];
    const outRows = rows.map((r) => ({
      SOURCE: 'PURCHASE',
      TYPE: gstrTxt(r.TYPE),
      NOTE_DATE: gstrDt(r.R_DATE),
      NOTE_NO: gstrTxt(r.R_NO),
      B_TYPE: gstrTxt(r.B_TYPE),
      BILL_DATE: gstrDt(r.BILL_DATE),
      BILL_NO: gstrTxt(r.BILL_NO),
      CODE: gstrTxt(r.CODE),
      NAME: gstrTxt(r.NAME),
      GST_NO: gstrTxt(r.GST_NO),
      STATE_CODE: gstrTxt(r.STATE_CODE),
      STATE: gstrTxt(r.STATE),
      ITEM_CODE: gstrTxt(r.ITEM_CODE),
      HSN_CODE: gstrTxt(r.HSN_CODE),
      QNTY: gstrRound2(gstrNum(r.QNTY)),
      WEIGHT: gstrRound2(gstrNum(r.WEIGHT)),
      RATE: gstrRound2(gstrNum(r.RATE)),
      AMOUNT: gstrRound2(gstrNum(r.AMOUNT)),
      TAXABLE: gstrRound2(gstrNum(r.TAXABLE)),
      CGST_AMT: gstrRound2(gstrNum(r.CGST_AMT)),
      SGST_AMT: gstrRound2(gstrNum(r.SGST_AMT)),
      IGST_AMT: gstrRound2(gstrNum(r.IGST_AMT)),
      BILL_AMT: gstrRound2(gstrNum(r.BILL_AMT)),
    }));
    const total = {
      line_count: outRows.length,
      taxable_total: gstrRound2(outRows.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
      bill_total: gstrRound2(outRows.reduce((m, r) => Math.max(m, gstrNum(r.BILL_AMT)), 0)),
    };
    res.json({ ok: true, rows: outRows, total });
  } catch (err) {
    console.error('❌ gstr1-note-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-exemp-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, row_key } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date || !row_key) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date, row_key are required' });
    }
    const saleSql = `
      SELECT A.TYPE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.SALE_INV_NO, A.CODE, M.NAME, M.GST_NO, M.L_C,
             A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT, A.BILL_AMT
      FROM SALE A
      LEFT JOIN MASTER M ON A.COMP_CODE=M.COMP_CODE AND A.CODE=M.CODE
      WHERE A.COMP_CODE=:comp_code
        AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
    const rows = (await runQuery(saleSql, { comp_code, s_date, e_date }, comp_uid)) || [];
    function saleTypeNum(raw) {
      if (raw == null || raw === '') return NaN;
      if (typeof raw === 'number') return raw;
      const s = String(raw).trim();
      if (!s) return NaN;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : NaN;
    }
    const isInvoiceTypeNum = (n) => n === 0 || n === 1 || n === 3;
    const isNoteTypeNum = (n) => n === 4 || n === 7 || n === 8;
    const isNegTypeNum = (n) => n === 4 || n === 8;
    const key = String(row_key).trim().toUpperCase();
    const isReg = key.startsWith('REG_');
    const isIntra = key.endsWith('_INTRA');
    const details = rows
      .filter((r) => {
        const n = saleTypeNum(r.TYPE);
        const tp = gstrTxt(r.TYPE).toUpperCase();
        if (Number.isFinite(n)) return isInvoiceTypeNum(n) || isNoteTypeNum(n);
        return ['SL', 'ST', 'SR', 'GT', 'GR', 'SX', 'CN'].includes(tp);
      })
      .filter((r) => (gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT)) === 0)
      .filter((r) => (isReg ? gstrHas(r.GST_NO) : !gstrHas(r.GST_NO)))
      .filter((r) => (isIntra ? gstrTxt(r.L_C).toUpperCase() === 'L' : gstrTxt(r.L_C).toUpperCase() !== 'L'))
      .map((r) => {
        const n = saleTypeNum(r.TYPE);
        const tp = gstrTxt(r.TYPE).toUpperCase();
        const sign = Number.isFinite(n) ? (isNegTypeNum(n) ? -1 : 1) : tp === 'CN' ? -1 : 1;
        return {
          TYPE: gstrTxt(r.TYPE),
          BILL_DATE: gstrDt(r.BILL_DATE),
          BILL_NO: gstrTxt(r.BILL_NO),
          B_TYPE: gstrTxt(r.B_TYPE),
          SALE_INV_NO: gstrTxt(r.SALE_INV_NO),
          CODE: gstrTxt(r.CODE),
          NAME: gstrTxt(r.NAME),
          GST_NO: gstrTxt(r.GST_NO),
          L_C: gstrTxt(r.L_C),
          TAXABLE: gstrRound2(sign * gstrNum(r.TAXABLE)),
          BILL_AMT: gstrRound2(sign * gstrNum(r.BILL_AMT)),
        };
      });
    const total = {
      line_count: details.length,
      taxable_total: gstrRound2(details.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
      bill_total: gstrRound2(details.reduce((s, r) => s + gstrNum(r.BILL_AMT), 0)),
    };
    res.json({ ok: true, rows: details, total });
  } catch (err) {
    console.error('❌ gstr1-exemp-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-hsn-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, registered, hsn_code, tax_rate } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date || hsn_code == null || tax_rate == null) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date, hsn_code, tax_rate are required' });
    }
    const isReg = String(registered).trim().toUpperCase() === 'Y';
    const targetHsn = gstrTxt(hsn_code);
    const targetRate = gstrRate(tax_rate);
    const saleSql = `
      SELECT A.TYPE,A.BILL_DATE,A.BILL_NO,A.B_TYPE,A.SALE_INV_NO,A.CODE,M.NAME,M.GST_NO,
             A.TRN_NO,A.ITEM_CODE,I.ITEM_NAME,I.HSN_CODE,I.HSN_UNIT,
             A.QNTY,A.WEIGHT,A.RATE,A.AMOUNT,A.TAXABLE,A.CGST_AMT,A.SGST_AMT,A.IGST_AMT,A.CGST_PER,A.SGST_PER,A.IGST_PER
      FROM SALE A
      LEFT JOIN MASTER M ON A.COMP_CODE=M.COMP_CODE AND A.CODE=M.CODE
      LEFT JOIN ITEMMAST I ON A.COMP_CODE=I.COMP_CODE AND A.ITEM_CODE=I.ITEM_CODE
      WHERE A.COMP_CODE=:comp_code
        AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
    const rows = (await runQuery(saleSql, { comp_code, s_date, e_date }, comp_uid)) || [];
    function saleTypeNum(raw) {
      if (raw == null || raw === '') return NaN;
      if (typeof raw === 'number') return raw;
      const s = String(raw).trim();
      if (!s) return NaN;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : NaN;
    }
    const isNegTypeNum = (n) => n === 4 || n === 8;
    const details = rows
      .filter((r) => (isReg ? gstrHas(r.GST_NO) : !gstrHas(r.GST_NO)))
      .filter((r) => gstrTxt(r.HSN_CODE) === targetHsn)
      .filter((r) => gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER)) === targetRate)
      .map((r) => {
        const n = saleTypeNum(r.TYPE);
        const tp = gstrTxt(r.TYPE).toUpperCase();
        const sign = Number.isFinite(n) ? (isNegTypeNum(n) ? -1 : 1) : ['CN', 'GN', 'CX', 'ER'].includes(tp) ? -1 : 1;
        return {
          TYPE: gstrTxt(r.TYPE),
          BILL_DATE: gstrDt(r.BILL_DATE),
          BILL_NO: gstrTxt(r.BILL_NO),
          B_TYPE: gstrTxt(r.B_TYPE),
          TRN_NO: gstrNum(r.TRN_NO),
          ITEM_CODE: gstrTxt(r.ITEM_CODE),
          ITEM_NAME: gstrTxt(r.ITEM_NAME),
          HSN_CODE: gstrTxt(r.HSN_CODE),
          TAX_RATE: gstrRound2(targetRate),
          QNTY: gstrRound2(sign * gstrNum(r.QNTY)),
          WEIGHT: gstrRound2(sign * gstrNum(r.WEIGHT)),
          AMOUNT: gstrRound2(sign * gstrNum(r.AMOUNT)),
          TAXABLE: gstrRound2(sign * gstrNum(r.TAXABLE)),
          IGST_AMT: gstrRound2(sign * gstrNum(r.IGST_AMT)),
          CGST_AMT: gstrRound2(sign * gstrNum(r.CGST_AMT)),
          SGST_AMT: gstrRound2(sign * gstrNum(r.SGST_AMT)),
        };
      });
    const total = {
      line_count: details.length,
      taxable_total: gstrRound2(details.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
      amount_total: gstrRound2(details.reduce((s, r) => s + gstrNum(r.AMOUNT), 0)),
    };
    res.json({ ok: true, rows: details, total });
  } catch (err) {
    console.error('❌ gstr1-hsn-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

resolveActiveDbConfig()
  .then((cfg) => {
    activeDbConfig = cfg;
    const server = app.listen(PORT, () => {
      console.log(`🚀 API server on port ${PORT}`);
      console.log(`   App folder (cwd): ${process.cwd()}`);
      const ckLog = String(configuredClientName || '').trim();
      console.log(
        ckLog
          ? `   connection.config clientName: ${ckLog} → https://${ckLog}.${rootDomain}`
          : '   connection.config clientName: (none) — set clientName / defaultClientKey for tunnel host hints'
      );
      console.log(`   Oracle hub (before year schema): ${maskOracleLog(activeDbConfig)}`);
      if (!DUAL_ORACLE_HUB_ENABLED) {
        console.log('   oracle.dualHubEnabled: false — secondary Oracle hub is disabled for this install.');
      }
      if (REQUIRE_SECONDARY_HUB) {
        console.log(
          '   oracle.dualHubRequired: true — when DBA_USERS shows the secondary user exists, that login must succeed (no fallback).'
        );
      }
      console.log(
        '   Reports: /api/salelist-*, /api/stock-sum, /api/stock-sum-detail, /api/stocklot-*, /api/stock-lot, /api/sale-bill-print, /api/purchase-bill-print'
      );
      console.log(`✅ Ready for iPhone connections via Cloudflare Tunnel`);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `❌ Port ${PORT} is already in use (another process, often node.exe). Options:\n` +
            `   • Free the port: Task Manager → Details → end the other node.exe, or (Admin) taskkill /PID <pid> /F\n` +
            `   • Use another port:  $env:PORT=5002; node server.cjs   (then point the app / tunnel to that port)`
        );
        process.exit(1);
        return;
      }
      console.error(err);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('❌ Oracle startup failed:', err.message);
    process.exit(1);
  });