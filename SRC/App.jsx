import React, { useState, useEffect, Suspense, lazy } from 'react';
import axios from 'axios';
import { IconSettings, IconVoice } from './components/ToolbarIcons';
import LoginSlide from './slides/LoginSlide';
import AppSessionLine from './components/AppSessionLine';
import { AppSessionContext } from './components/AppSessionContext';
import Slide1 from './slides/Slide1';
import Slide2 from './slides/slide2';
import Slide3 from './slides/Slide3';
import Slide4 from './slides/Slide4';
import Slide30TrialBalanceSummary from './slides/Slide30TrialBalanceSummary';
import Slide31TrialDateWise from './slides/Slide31TrialDateWise';
const Slide32ProductionEntry = lazy(() => import('./slides/Slide32ProductionEntry'));
import Slide5 from './slides/Slide5';
import Slide6 from './slides/Slide6';
import Slide7 from './slides/Slide7';
import Slide8 from './slides/Slide8';
import Slide9 from './slides/Slide9';
import Slide11 from './slides/Slide11';
import Slide12 from './slides/Slide12';
import Slide13 from './slides/Slide13';
import Slide14 from './slides/Slide14';
import Slide15 from './slides/Slide15';
import Slide16 from './slides/Slide16';
import Slide35StateWiseSales from './slides/Slide35StateWiseSales';
import Slide36StateWisePurchase from './slides/Slide36StateWisePurchase';
import Slide37PendingSalesOrder from './slides/Slide37PendingSalesOrder';
import Slide38PendingPurchaseOrder from './slides/Slide38PendingPurchaseOrder';
import Slide39PendingDispatchChallan from './slides/Slide39PendingDispatchChallan';
import Slide40CompleteLedger from './slides/Slide40CompleteLedger';
import Slide17TradingAc from './slides/Slide17TradingAc';
import Slide18PlProfitLoss from './slides/Slide18PlProfitLoss';
import Slide19BalanceSheet from './slides/Slide19BalanceSheet';
import Slide21SaleBill from './slides/Slide21SaleBill';
import Slide22DispatchChallan from './slides/Slide22DispatchChallan';
import Slide23SalesOrder from './slides/Slide23SalesOrder';
import Slide24PurchaseOrder from './slides/Slide24PurchaseOrder';
import Slide25PurchaseBill from './slides/Slide25PurchaseBill';
import Slide29Grn from './slides/Slide29Grn';
import Slide26AccountMaster from './slides/Slide26AccountMaster';
import Slide27ItemMaster from './slides/Slide27ItemMaster';
import Slide28VoucherEntry from './slides/Slide28VoucherEntry';
import Slide33SaleGraph from './slides/Slide33SaleGraph';
import Slide34OverdueCustomers from './slides/Slide34OverdueCustomers';
import { exitApp, performExitWindow } from './utils/exitApp';
import connectionConfig from '../connection.config.json';
import './App.css';
import './styles/fasFlowTheme.css';
import './styles/windalInitialFlow.css';
import './styles/windalDashboard.css';
import { getWindalDocumentTitle } from './utils/windalBrand';
import './saleEntryDesktop.css';
import './purchaseBillEntry.css';
import './styles/saleListScreen.css';
import './styles/ledgerFullBleed.css';
import './styles/ledgerMobile.css';
import './styles/trialBalanceMobile.css';
import './styles/trialBalanceDesktop.css';
import './styles/ledgerDesktop.css';

// Local: Vite dev uses '' so /api/* is proxied to port 5001 (see vite.config.js). Run `npm run server` in another terminal.
// Vite preview / static file open on localhost still calls :5001 directly.
function getSafeHostname() {
  try {
    return typeof window !== 'undefined' && window.location ? String(window.location.hostname || '') : '';
  } catch {
    return '';
  }
}

function safeStorageGet(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore storage failures on restricted mobile browsers */
  }
}

function safeStorageRemove(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch {
    /* ignore storage failures on restricted mobile browsers */
  }
}

function safeSetDocumentLang(lang) {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.lang = lang;
  } catch {
    /* ignore document access failures */
  }
}

function safeSetBodyViewMode(mode) {
  try {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.remove('force-mobile-view', 'force-desktop-view');
    if (mode === 'mobile') {
      document.body.classList.add('force-mobile-view');
    } else if (mode === 'desktop') {
      document.body.classList.add('force-desktop-view');
    }
  } catch {
    /* ignore body class failures */
  }
}

function safeClearBodyViewMode() {
  try {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.remove('force-mobile-view', 'force-desktop-view');
  } catch {
    /* ignore body class failures */
  }
}

const hostName = getSafeHostname();
const isLocalHost = hostName === 'localhost' || hostName === '127.0.0.1';

const rootDomain = connectionConfig.domain?.rootDomain || 'fasaccountingsoftware.in';
const apiSubdomainSuffix = connectionConfig.domain?.apiSubdomainSuffix || '-api';
const knownClients = connectionConfig.clients || {};
const configuredClientName = connectionConfig.clientName || connectionConfig.defaultClientKey || '';
const APP_DISPLAY_NAME = String(connectionConfig.product?.displayName || '').trim() || 'Windal Accounting';
const APP_DOCUMENT_TITLE = getWindalDocumentTitle(connectionConfig.product?.displayTitle);

function renderFatalStartupMessage(errorLike) {
  try {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('root');
    if (!root) return;
    const msg = String(errorLike?.message || errorLike || 'Unknown startup error');
    const safeTitle = APP_DISPLAY_NAME.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    root.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 24px; color: #1f2937;">
        <h2 style="margin: 0 0 12px;">${safeTitle}</h2>
        <p style="margin: 0 0 10px; font-weight: 600;">App could not start on this browser.</p>
        <p style="margin: 0 0 8px;">Please refresh once. If it still fails, clear browser site data/cache.</p>
        <pre style="white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 8px;">${msg}</pre>
      </div>
    `;
  } catch {
    /* last-resort fallback only */
  }
}

/** e.g. dal-demo.fasaccountingsoftware.in → dal-demo (not dal). */
function getClientKeyFromHost(host, domain) {
  if (!host || !domain) return null;
  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) return null;
  const subdomain = host.slice(0, -suffix.length).toLowerCase();
  if (!subdomain || subdomain.includes('.')) return null;
  return subdomain;
}

function normalizeClientKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildApiBase(clientKey) {
  if (!clientKey) return '';
  if (connectionConfig.apiBase) return connectionConfig.apiBase;
  const fromConfig = knownClients[clientKey]?.apiBase;
  if (fromConfig) return fromConfig;
  return `https://${clientKey}${apiSubdomainSuffix}.${rootDomain}`;
}

const hostClientKey = getClientKeyFromHost(hostName, rootDomain);
const remoteApiBase = buildApiBase(hostClientKey) || buildApiBase(configuredClientName);

/** Shown on sign-in loading screen. In Vite dev or on localhost, `local.connectingLabel` wins so clientName cannot show another tenant (e.g. marutiagro). */
function getConnectingClientLabel() {
  if (import.meta.env.DEV || isLocalHost) {
    const fixed = String(connectionConfig.local?.connectingLabel || '').trim();
    if (fixed) return fixed;
  }
  if (!isLocalHost && hostName && rootDomain && hostName.toLowerCase().endsWith(`.${rootDomain.toLowerCase()}`)) {
    return hostName;
  }
  const key = hostClientKey || configuredClientName;
  if (key && rootDomain) {
    return `${key}.${rootDomain}`;
  }
  return '';
}

const connectingClientDisplay = getConnectingClientLabel();

/** dal-demo.fasaccountingsoftware.in — use /api on same host (tunnel ingress); avoids mobile issues with dal-demo-api + Vite dev. */
const isTunnelPublicHost =
  !isLocalHost &&
  hostClientKey &&
  configuredClientName &&
  normalizeClientKey(hostClientKey) === normalizeClientKey(configuredClientName);

const API_BASE =
  import.meta.env.DEV || isTunnelPublicHost
    ? ''
    : isLocalHost
      ? connectionConfig.local?.apiBase || 'http://localhost:5001'
      : remoteApiBase;
const TOTAL_STEPS = 21;
const VIEW_MODE_STORAGE_KEY = 'gfas_view_mode';
const AUTH_STORAGE_KEY = 'gfas_auth_state_v1';

function readPersistedAuth() {
  return { authenticated: false, userName: '' };
}

if (import.meta.env.DEV && API_BASE === '') {
  console.info('API → Vite proxy → http://localhost:5001 — UI dev port 5174 — start backend: npm run server');
}
if (!import.meta.env.DEV && !isLocalHost && !API_BASE && !isTunnelPublicHost) {
  console.warn('No remote API base resolved. Check connection.config.json clientName/domain.');
}
console.log('Current API Base:', API_BASE || '(same origin /api proxy)');
console.log('UI branding:', APP_DISPLAY_NAME, '| Connecting label:', getConnectingClientLabel() || '(none)');

function App() {
  const renderMinimalHeaderActions = () => (
    <header className="app-header app-header--minimal">
      <div className="app-header-actions">{renderViewSettings()}</div>
    </header>
  );

  const initialAuth = readPersistedAuth();
  const [clientGuardChecked, setClientGuardChecked] = useState(false);
  const [clientGuardMismatch, setClientGuardMismatch] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    const saved = safeStorageGet(VIEW_MODE_STORAGE_KEY);
    return saved === 'desktop' || saved === 'mobile' ? saved : null;
  }); // 'desktop' | 'mobile'
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [authenticated, setAuthenticated] = useState(initialAuth.authenticated);
  const [currentSlide, setCurrentSlide] = useState(1);
  const [companies, setCompanies] = useState([]);
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    comp_code: null,
    comp_uid: null,
    comp_name: '',
    comp_year: '',
    comp_s_dt: '',
    comp_e_dt: '',
    reportType: 'trial-balance',
  });
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [loginUserName, setLoginUserName] = useState(initialAuth.userName);
  const [authorizedCompCode, setAuthorizedCompCode] = useState('');
  const [deployUpdateEnabled, setDeployUpdateEnabled] = useState(false);
  const [deployUpdateRequiresKey, setDeployUpdateRequiresKey] = useState(true);
  const [deployUpdateServerBusy, setDeployUpdateServerBusy] = useState(false);
  const [showDeployUpdateModal, setShowDeployUpdateModal] = useState(false);
  const [deployKeyInput, setDeployKeyInput] = useState('');
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployMessage, setDeployMessage] = useState('');
  const [deployMessageIsError, setDeployMessageIsError] = useState(false);
  const [deployProgressPct, setDeployProgressPct] = useState(0);
  const [deployProgressLabel, setDeployProgressLabel] = useState('');
  const [deployRecentLines, setDeployRecentLines] = useState([]);
  const [deployFinished, setDeployFinished] = useState(false);
  const [deployFailed, setDeployFailed] = useState(false);

  useEffect(() => {
    /* Temporarily disabled persisted-auth restore to verify mobile startup path. */
  }, []);

  /** Recover from a stuck print/picker leaving body unscrollable (mobile white screen). */
  useEffect(() => {
    try {
      if (typeof document === 'undefined' || !document.body) return;
      document.body.style.overflow = '';
      document.body.style.position = '';
    } catch (_) {}
  }, []);

  /** Dev: confirm Vite proxy hits the API from this repo (see server.cjs cwd + clientName logs). */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get('/api/client-identity', { timeout: 8000 });
        if (cancelled) return;
        const apiKey = normalizeClientKey(r.data?.clientKey);
        const uiKey = normalizeClientKey(configuredClientName);
        const warn =
          apiKey && uiKey && apiKey !== uiKey
            ? ' — WARNING: API clientKey differs from UI connection.config.json (wrong node cwd / other repo?)'
            : '';
        console.info('[Dev] /api/client-identity:', r.data, '| UI clientName:', configuredClientName || '(none)', warn);
      } catch (e) {
        if (!cancelled) {
          console.warn('[Dev] /api/client-identity failed — run API from E:\\WINDAL\\APPTEST (npm run server); UI is http://localhost:5174', e?.message || e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const expectedClient = normalizeClientKey(hostClientKey);
    if (import.meta.env.DEV || isLocalHost || !expectedClient) {
      setClientGuardChecked(true);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const base = API_BASE || '';
        const response = await axios.get(`${base}/api/client-identity`, { timeout: 10000 });
        const actualClient = normalizeClientKey(response?.data?.clientKey);
        if (!cancelled && actualClient && actualClient !== expectedClient) {
          setAuthenticated(false);
          setLoginUserName('');
          setAuthorizedCompCode('');
          setCompanies([]);
          setYears([]);
          setCurrentSlide(1);
          safeStorageRemove(AUTH_STORAGE_KEY);
          setClientGuardMismatch({ expectedClient, actualClient });
        }
      } catch {
        /* If identity endpoint is unreachable, do not block startup. */
      } finally {
        if (!cancelled) setClientGuardChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setVoiceSupported(typeof SR === 'function');
  }, []);

  useEffect(() => {
    safeSetDocumentLang('en-GB');
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined' && APP_DOCUMENT_TITLE) {
      document.title = APP_DOCUMENT_TITLE;
    }
  }, []);

  const syncDeployStatus = async () => {
    try {
      const base = API_BASE || '';
      const r = await axios.get(`${base}/api/deploy-update/status`);
      if (!r.data?.enabled) return;
      setDeployUpdateEnabled(true);
      setDeployUpdateRequiresKey(r.data?.requiresDeployKey !== false);
      setDeployUpdateServerBusy(r.data?.busy === true);
      setDeployProgressPct(Number(r.data?.progressPercent ?? 0) || 0);
      setDeployProgressLabel(String(r.data?.statusLabel ?? '').trim());
      setDeployRecentLines(Array.isArray(r.data?.recentLogLines) ? r.data.recentLogLines : []);
      setDeployFinished(r.data?.isFinished === true);
      setDeployFailed(r.data?.isError === true);
    } catch {
      /* feature off or API unreachable */
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = API_BASE || '';
        const r = await axios.get(`${base}/api/deploy-update/status`);
        if (!cancelled && r.data?.enabled) {
          setDeployUpdateEnabled(true);
          setDeployUpdateRequiresKey(r.data?.requiresDeployKey !== false);
          setDeployUpdateServerBusy(r.data?.busy === true);
          setDeployProgressPct(Number(r.data?.progressPercent ?? 0) || 0);
          setDeployProgressLabel(String(r.data?.statusLabel ?? '').trim());
          setDeployRecentLines(Array.isArray(r.data?.recentLogLines) ? r.data.recentLogLines : []);
          setDeployFinished(r.data?.isFinished === true);
          setDeployFailed(r.data?.isError === true);
        }
      } catch {
        /* feature off or API unreachable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showDeployUpdateModal) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await syncDeployStatus();
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [showDeployUpdateModal]);

  const handleDeployUpdateSubmit = async (e) => {
    e.preventDefault();
    setDeployMessage('');
    setDeployBusy(true);
    try {
      const base = API_BASE || '';
      const payload = deployUpdateRequiresKey ? { deployKey: deployKeyInput.trim() } : {};
      const r = await axios.post(`${base}/api/deploy-update`, payload);
      setDeployMessageIsError(false);
      setDeployMessage(r.data?.message || 'Started.');
      setDeployUpdateServerBusy(true);
      setDeployProgressPct(6);
      setDeployProgressLabel('Starting update...');
      setDeployFinished(false);
      setDeployFailed(false);
      setDeployRecentLines((prev) =>
        prev.length > 0 ? prev : ['Update started in background. Waiting for first log line...']
      );
      setDeployKeyInput('');
      await syncDeployStatus();
    } catch (err) {
      setDeployMessageIsError(true);
      const msg = err.response?.data?.error || err.message || 'Request failed';
      setDeployMessage(msg);
      if (err.response?.status === 429) setDeployUpdateServerBusy(true);
    } finally {
      setDeployBusy(false);
    }
  };

  const applyViewMode = (mode) => {
    if (mode !== 'desktop' && mode !== 'mobile') return;
    setViewMode(mode);
    safeStorageSet(VIEW_MODE_STORAGE_KEY, mode);
    setShowViewSettings(false);
  };

  useEffect(() => {
    safeSetBodyViewMode(viewMode);

    return () => {
      safeClearBodyViewMode();
    };
  }, [viewMode]);

  useEffect(() => {
    if (viewMode) return;
    const handleViewModeShortcut = (event) => {
      const key = String(event.key || '').toLowerCase();
      if (key === 'd') {
        event.preventDefault();
        applyViewMode('desktop');
      } else if (key === 'm') {
        event.preventDefault();
        applyViewMode('mobile');
      }
    };
    window.addEventListener('keydown', handleViewModeShortcut);
    return () => window.removeEventListener('keydown', handleViewModeShortcut);
  }, [viewMode]);

  useEffect(() => {
    if (!authenticated) return;
    const fetchCompanies = async () => {
      try {
        setLoading(true);
        const params = authorizedCompCode
          ? { comp_code: authorizedCompCode }
          : loginUserName
            ? { user_name: loginUserName }
            : undefined;
        const response = await axios.get(`${API_BASE}/api/companies`, { params });
        console.log('Company list received:', response.data);
        setCompanies(response.data || []);
      } catch (error) {
        console.error('Error fetching companies:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchCompanies();
  }, [authenticated, loginUserName, authorizedCompCode]);

  const handleLoginSuccess = (payload) => {
    const u = String(payload?.userName ?? payload?.user_name ?? '').trim().toUpperCase();
    const cc = String(payload?.comp_code ?? payload?.COMP_CODE ?? '').trim();
    setLoginUserName(u);
    setAuthorizedCompCode(cc);
    setAuthenticated(true);
    safeStorageSet(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        authenticated: true,
        userName: u,
        at: Date.now(),
      })
    );
  };

  const handleSlide1Next = async (data) => {
    const selectedCode = data.COMP_CODE || data.comp_code;
    const selectedComp = companies.find(c => String(c.COMP_CODE) === String(selectedCode));

    if (selectedComp) {
      setFormData(prev => ({ 
        ...prev, 
        comp_code: selectedCode,
        comp_name: selectedComp.COMP_NAME 
      }));

      try {
        setLoading(true);
        const response = await axios.get(`${API_BASE}/api/years`, {
          params: { comp_code: selectedCode }
        });
        setYears(response.data || []);
        setCurrentSlide(2);
      } catch (error) {
        alert("Error loading financial years. Is server running on port 5001?");
      } finally {
        setLoading(false);
      }
    } else {
      alert("Match failed. Selected: " + selectedCode);
    }
  };

  const handleSlide2Next = (data) => {
  // compdet row: accept UPPER or lower case keys from API / Oracle driver
  setFormData(prev => ({ 
    ...prev, 
    comp_uid: data.COMP_UID ?? data.comp_uid,
    comp_year: data.COMP_YEAR ?? data.comp_year,
    comp_s_dt: data.COMP_S_DT ?? data.comp_s_dt,
    comp_e_dt: data.COMP_E_DT ?? data.comp_e_dt,
    comp_name: prev.comp_name
  }));
  
  console.log("Saving Form Data:", data); // Watch this in your console!
  setCurrentSlide(3);
};

  const handleSlide3Next = (data) => {
    setFormData(prev => ({ ...prev, ...data }));
    const reportType = String(data?.reportType ?? '').trim().toLowerCase();
    if (reportType === 'ledger' || reportType === 'ledger-interest') setCurrentSlide(5);
    else if (reportType === 'complete-ledger') setCurrentSlide(40);
    else if (reportType === 'bill-ledger' || reportType === 'customer-ledger' || reportType === 'supplier-ledger') setCurrentSlide(6);
    else if (reportType === 'broker-os') setCurrentSlide(7);
    else if (reportType === 'sale-list') setCurrentSlide(8);
    else if (reportType === 'stock-sum') setCurrentSlide(9);
    else if (reportType === 'purchase-list') setCurrentSlide(11);
    else if (reportType === 'ageing') setCurrentSlide(12);
    else if (reportType === 'sale-bill-printing') setCurrentSlide(13);
    else if (reportType === 'voucher-list') setCurrentSlide(14);
    else if (reportType === 'gstr1') setCurrentSlide(15);
    else if (reportType === 'hsn-sales') setCurrentSlide(16);
    else if (reportType === 'hsn-purchase') setCurrentSlide(17);
    else if (reportType === 'state-wise-sales') setCurrentSlide(35);
    else if (reportType === 'state-wise-purchase') setCurrentSlide(36);
    else if (reportType === 'pending-sales-order') setCurrentSlide(37);
    else if (reportType === 'pending-purchase-order') setCurrentSlide(38);
    else if (reportType === 'pending-dispatch-challan') setCurrentSlide(39);
    else if (reportType === 'trading-ac') setCurrentSlide(18);
    else if (reportType === 'pl-profit-loss') setCurrentSlide(19);
    else if (reportType === 'balance-sheet') setCurrentSlide(20);
    else if (reportType === 'sale-bill-entry') setCurrentSlide(21);
    else if (reportType === 'dispatch-challan-entry') setCurrentSlide(22);
    else if (reportType === 'sales-order-entry') setCurrentSlide(23);
    else if (reportType === 'purchase-order-entry') setCurrentSlide(24);
    else if (reportType === 'grn-entry') setCurrentSlide(29);
    else if (reportType === 'purchase-bill-entry') setCurrentSlide(25);
    else if (reportType === 'account-master') setCurrentSlide(26);
    else if (reportType === 'item-master') setCurrentSlide(27);
    else if (reportType === 'voucher-entry') setCurrentSlide(28);
    else if (reportType === 'trial-balance-summary') setCurrentSlide(30);
    else if (reportType === 'trial-date-wise') setCurrentSlide(31);
    else if (reportType === 'production-entry') setCurrentSlide(32);
    else if (reportType === 'sale-chart' || reportType === 'sale-graph') setCurrentSlide(33);
    else if (reportType === 'overdue-customers') setCurrentSlide(34);
    else setCurrentSlide(4);
  };

  const openCustomerLedgerFromOverdue = (payload) => {
    setFormData((prev) => ({
      ...prev,
      reportType: 'customer-ledger',
      customerLedgerDrilldown: {
        code: payload.code,
        name: payload.name || '',
        city: payload.city || '',
        asOfDate: payload.asOfDate,
        returnReport: 'overdue-customers',
        returnSlide: 34,
        autoRun: true,
        at: Date.now(),
      },
    }));
    setCurrentSlide(6);
  };

  const backFromCustomerLedger = () => {
    if (formData.customerLedgerDrilldown?.returnReport === 'overdue-customers') {
      setFormData((prev) => {
        const { customerLedgerDrilldown, ...rest } = prev;
        return { ...rest, reportType: 'overdue-customers' };
      });
      setCurrentSlide(34);
      return;
    }
    setCurrentSlide(3);
  };

  const openSaleListFromChart = (payload) => {
    setFormData((prev) => ({
      ...prev,
      reportType: 'sale-list',
      saleChartDrilldown: {
        startDate: payload.startDate,
        endDate: payload.endDate,
        itemCode: payload.itemCode || '',
        itemName: payload.itemName || '',
        monthLabel: payload.monthLabel || '',
        autoRun: true,
        at: Date.now(),
      },
    }));
    setCurrentSlide(8);
  };

  const handlePrev = () => setCurrentSlide(prev => prev - 1);

  const handleExitApp = () => {
    if (!window.confirm('Exit the application?')) return;
    setAuthenticated(false);
    setLoginUserName('');
    setAuthorizedCompCode('');
    setCompanies([]);
    setYears([]);
    setCurrentSlide(1);
    safeStorageRemove(AUTH_STORAGE_KEY);
    performExitWindow();
  };

  const handleReset = () => {
    setCurrentSlide(1);
    setYears([]);
  };

  const handleVoiceCommand = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof SR !== 'function') {
      alert('Voice command is not supported on this device/browser.');
      return;
    }
    const recognition = new SR();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setVoiceListening(true);
    recognition.onend = () => setVoiceListening(false);
    recognition.onerror = () => {
      setVoiceListening(false);
      alert('Voice recognition failed. Please try again.');
    };
    recognition.onresult = (event) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || '').toLowerCase().trim();
      const normalized = transcript
        .replace(/[&]/g, ' and ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const openReportByVoice = (reportType, slideNo, title) => {
        if (!authenticated || !formData.comp_uid) {
          alert(`Please select company and financial year before opening ${title}.`);
          return true;
        }
        setFormData((prev) => ({ ...prev, reportType }));
        setCurrentSlide(slideNo);
        return true;
      };

      const voiceCommands = [
        { phrases: ['open trial balance', 'trial balance'], reportType: 'trial-balance', slideNo: 4, title: 'Trial Balance' },
        { phrases: ['open ledger with interest', 'ledger with interest'], reportType: 'ledger-interest', slideNo: 5, title: 'Ledger With Interest' },
        { phrases: ['open complete ledger', 'complete ledger'], reportType: 'complete-ledger', slideNo: 40, title: 'Complete Ledger' },
        { phrases: ['open ledger', 'ledger'], reportType: 'ledger', slideNo: 5, title: 'Ledger' },
        { phrases: ['open customer ledger', 'customer ledger'], reportType: 'customer-ledger', slideNo: 6, title: 'Customer Ledger' },
        { phrases: ['open supplier ledger', 'supplier ledger'], reportType: 'supplier-ledger', slideNo: 6, title: 'Supplier Ledger' },
        { phrases: ['open broker wise outstanding', 'broker wise outstanding', 'open broker outstanding', 'broker outstanding'], reportType: 'broker-os', slideNo: 7, title: 'Broker Wise Outstanding' },
        {
          phrases: [
            'open sale bill entry',
            'sale bill entry',
            'sale bill entry screen',
            'new sale bill',
            'sale bill add',
          ],
          reportType: 'sale-bill-entry',
          slideNo: 21,
          title: 'Sale bill entry',
        },
        {
          phrases: ['open dispatch challan', 'dispatch challan', 'dispatch challan entry'],
          reportType: 'dispatch-challan-entry',
          slideNo: 22,
          title: 'Dispatch challan entry',
        },
        { phrases: ['open sale bill printing', 'sale bill printing', 'open sale bill'], reportType: 'sale-bill-printing', slideNo: 13, title: 'Sale Bill Printing' },
        { phrases: ['open stock summary', 'stock summary', 'open stock sum', 'stock sum'], reportType: 'stock-sum', slideNo: 9, title: 'Stock Summary' },
        { phrases: ['open ageing report', 'ageing report', 'aging report', 'open aging report'], reportType: 'ageing', slideNo: 12, title: 'Ageing Report' },
        { phrases: ['open purchase list', 'purchase list'], reportType: 'purchase-list', slideNo: 11, title: 'Purchase List' },
        {
          phrases: ['open purchase order', 'purchase order', 'purchase order entry'],
          reportType: 'purchase-order-entry',
          slideNo: 24,
          title: 'Purchase Order',
        },
        {
          phrases: ['open purchase bill', 'purchase bill', 'purchase bill entry', 'new purchase bill'],
          reportType: 'purchase-bill-entry',
          slideNo: 25,
          title: 'Purchase Bill',
        },
        {
          phrases: ['open account master', 'account master', 'a c master', 'ac master', 'open a c master'],
          reportType: 'account-master',
          slideNo: 26,
          title: 'A/c Master',
        },
        {
          phrases: ['open item master', 'item master', 'open item mast'],
          reportType: 'item-master',
          slideNo: 27,
          title: 'Item Master',
        },
        {
          phrases: ['open voucher entry', 'voucher entry', 'cash voucher entry', 'bank voucher entry', 'journal voucher'],
          reportType: 'voucher-entry',
          slideNo: 28,
          title: 'Voucher entry',
        },
        { phrases: ['open voucher list', 'voucher list'], reportType: 'voucher-list', slideNo: 14, title: 'Voucher List' },
        { phrases: ['open gstr1', 'gstr1', 'open gstr 1', 'gstr 1'], reportType: 'gstr1', slideNo: 15, title: 'GSTR1' },
        { phrases: ['open hsn sales', 'hsn sales', 'open hsn sale', 'hsn sale'], reportType: 'hsn-sales', slideNo: 16, title: 'HSN Sales' },
        { phrases: ['open hsn purchase', 'hsn purchase', 'open hsn purchases', 'hsn purchases'], reportType: 'hsn-purchase', slideNo: 17, title: 'HSN Purchase' },
        { phrases: ['open pending sales order', 'pending sales order', 'pending sale order'], reportType: 'pending-sales-order', slideNo: 37, title: 'Pending Sales Order' },
        { phrases: ['open pending purchase order', 'pending purchase order', 'pending po'], reportType: 'pending-purchase-order', slideNo: 38, title: 'Pending Purchase Order' },
        { phrases: ['open pending dispatch challan', 'pending dispatch challan', 'pending challan'], reportType: 'pending-dispatch-challan', slideNo: 39, title: 'Pending Dispatch Challan' },
        { phrases: ['open state wise sales', 'state wise sales', 'state sales', 'open state sales'], reportType: 'state-wise-sales', slideNo: 35, title: 'State Wise Sales' },
        { phrases: ['open state wise purchase', 'state wise purchase', 'state purchase', 'open state purchase'], reportType: 'state-wise-purchase', slideNo: 36, title: 'State Wise Purchase' },
        { phrases: ['open trading account', 'trading account', 'open trading a c', 'trading a c'], reportType: 'trading-ac', slideNo: 18, title: 'Trading Account' },
        { phrases: ['open p and l', 'p and l', 'open profit and loss', 'profit and loss', 'open p l', 'p l'], reportType: 'pl-profit-loss', slideNo: 19, title: 'P&L' },
        { phrases: ['open balance sheet', 'balance sheet'], reportType: 'balance-sheet', slideNo: 20, title: 'Balance Sheet' },
      ];

      for (const cmd of voiceCommands) {
        if (cmd.phrases.some((phrase) => normalized.includes(phrase))) {
          openReportByVoice(cmd.reportType, cmd.slideNo, cmd.title);
          return;
        }
      }
      alert(`Voice command not recognized: ${transcript || 'no speech detected'}`);
    };
    recognition.start();
  };

  const renderViewSettings = () => (
    <div className="view-settings">
      <button
        type="button"
        className="toolbar-icon-btn toolbar-icon-btn--settings view-settings-btn"
        onClick={() => setShowViewSettings((prev) => !prev)}
        title="Settings"
        aria-label="Settings"
      >
        <IconSettings />
      </button>
      {showViewSettings ? (
        <div className="view-settings-menu">
          <button
            type="button"
            className={`view-settings-option${viewMode === 'desktop' ? ' is-active' : ''}`}
            onClick={() => applyViewMode('desktop')}
          >
            Desktop View
          </button>
          <button
            type="button"
            className={`view-settings-option${viewMode === 'mobile' ? ' is-active' : ''}`}
            onClick={() => applyViewMode('mobile')}
          >
            Mobile View
          </button>
          {/* Update button removed from Settings. */}
        </div>
      ) : null}
    </div>
  );

  const flowHeaderActions = (
    <>
      {renderViewSettings()}
      {voiceSupported ? (
        <button
          type="button"
          className={`toolbar-icon-btn toolbar-icon-btn--voice voice-command-btn${
            voiceListening ? ' voice-command-btn--listening toolbar-icon-btn--listening' : ''
          }`}
          onClick={handleVoiceCommand}
          title={voiceListening ? 'Listening…' : 'Voice command'}
          aria-label={voiceListening ? 'Listening for voice command' : 'Voice command'}
        >
          <IconVoice />
        </button>
      ) : null}
    </>
  );

  const renderDeployUpdateModal = () =>
    showDeployUpdateModal ? (
      <div
        className="deploy-update-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deploy-update-title"
        onClick={(ev) => {
          if (deployBusy) return;
          if (ev.target === ev.currentTarget) setShowDeployUpdateModal(false);
        }}
      >
        <div className="deploy-update-dialog" onClick={(e) => e.stopPropagation()}>
          <h2 id="deploy-update-title">Update to latest version</h2>
          <p className="deploy-update-hint">
            Pulls the latest code from Git, reinstalls dependencies, rebuilds the site, then restarts the app
            windows on this server.
            {deployUpdateRequiresKey
              ? ' Enter the same deploy key as in deploy-update-secret.txt (first line) on the server PC.'
              : ' This server is configured to start the update without a deploy key.'}
          </p>
          {deployUpdateServerBusy ? (
            <p className="deploy-update-msg deploy-update-msg--err">
              An update is already running on this server. Wait for it to finish, then open this dialog again, or check
              logs/deploy-update.log under the app folder. If nothing is running, restart the API once to clear a stuck lock.
            </p>
          ) : null}
          <form onSubmit={handleDeployUpdateSubmit}>
            {deployUpdateRequiresKey ? (
              <>
                <label className="deploy-update-label" htmlFor="deploy-key-input">
                  Deploy key
                </label>
                <input
                  id="deploy-key-input"
                  type="password"
                  className="deploy-update-input"
                  autoComplete="off"
                  value={deployKeyInput}
                  onChange={(e) => setDeployKeyInput(e.target.value)}
                  placeholder="Enter deploy key"
                  disabled={deployBusy || deployUpdateServerBusy}
                />
              </>
            ) : null}
            {deployMessage ? (
              <p className={`deploy-update-msg${deployMessageIsError ? ' deploy-update-msg--err' : ''}`}>{deployMessage}</p>
            ) : null}
            {(deployUpdateServerBusy || deployProgressPct > 0) ? (
              <div className="deploy-update-progress-wrap" aria-live="polite">
                <div className="deploy-update-progress-label">
                  {deployProgressLabel || (deployUpdateServerBusy ? 'Update is running...' : 'Update status')}
                  <span>{Math.max(0, Math.min(100, Math.round(deployProgressPct)))}%</span>
                </div>
                <div className="deploy-update-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, Math.round(deployProgressPct)))}>
                  <div className="deploy-update-progress-fill" style={{ width: `${Math.max(0, Math.min(100, deployProgressPct))}%` }} />
                </div>
                {deployRecentLines.length > 0 ? (
                  <div className="deploy-update-log">
                    {deployRecentLines.map((line, idx) => (
                      <div key={`${idx}-${line}`} className="deploy-update-log-line">
                        {line}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {deployFinished && !deployFailed ? (
              <p className="deploy-update-msg">
                Finished update. Restart browser now, then refresh this page.
              </p>
            ) : null}
            <div className="deploy-update-actions">
              <button type="button" className="btn btn-secondary" disabled={deployBusy} onClick={() => setShowDeployUpdateModal(false)}>
                {deployFinished ? 'Close' : 'Cancel'}
              </button>
              {!deployFinished ? (
                <button type="submit" className="btn btn-primary" disabled={deployBusy || deployUpdateServerBusy}>
                  {deployBusy ? 'Starting…' : deployUpdateServerBusy ? 'Update running…' : 'Update & restart'}
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    ) : null;

  if (!viewMode) {
    return (
      <>
      <div className="app app--selector">
        <main className="app-main">
          <section className="slide startup-mode-card">
            <h2>Choose View Mode</h2>
            <p className="startup-mode-subtitle">
              Select how you want to use the application in this session.
            </p>
            <p className="startup-mode-shortcut-hint">Keyboard shortcut: press D for Desktop or M for Mobile.</p>
            <div className="startup-mode-actions">
              <button type="button" className="btn btn-primary" onClick={() => applyViewMode('desktop')}>
                (D) Desktop View
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => applyViewMode('mobile')}>
                (M) Mobile View
              </button>
            </div>
          </section>
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  const hideAppHeaderChrome = authenticated && currentSlide >= 1;
  const useWindalInitial =
    !authenticated || (authenticated && currentSlide >= 1 && currentSlide <= 2);
  const useWindalDashboard = authenticated && currentSlide === 3;
  const useFasFlowFullScreen = authenticated && currentSlide > 3;
  const useLedgerFullBleed = authenticated && (currentSlide === 4 || currentSlide === 5);
  const appClassName = `app ${viewMode === 'desktop' ? 'app--desktop' : 'app--mobile'}${hideAppHeaderChrome ? ' app--no-header' : ''}${useWindalInitial ? ' app--windal-initial' : ''}${useWindalDashboard ? ' app--windal-dashboard' : ''}${useFasFlowFullScreen ? ' app--fas-flow' : ''}${useLedgerFullBleed ? ' app--ledger-full-bleed' : ''}`;

  if (!clientGuardChecked) {
    return (
      <>
      <div className={appClassName}>
        <main className="app-main">
          <div className="app-loading">
            <h2>Verifying client route...</h2>
          </div>
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  if (clientGuardMismatch) {
    return (
      <>
      <div className={appClassName}>
        <main className="app-main">
          <section className="slide startup-mode-card">
            <h2>Client Route Mismatch</h2>
            <p className="startup-mode-subtitle">
              This host is mapped to a different backend client. Access is blocked to avoid cross-client data mix.
            </p>
            <p><strong>Host client:</strong> {clientGuardMismatch.expectedClient}</p>
            <p><strong>Connected backend:</strong> {clientGuardMismatch.actualClient}</p>
            <p>Please fix Cloudflare/Tunnel hostname mapping for this domain.</p>
          </section>
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  if (!authenticated) {
    return (
      <>
      <div className={appClassName}>
        <main className="app-main">
          <LoginSlide
            apiBase={API_BASE}
            onSuccess={handleLoginSuccess}
            onExit={exitApp}
            settingsSlot={renderViewSettings()}
          />
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  if (loading && currentSlide === 1) {
    return (
      <>
      <div className={appClassName}>
        {renderMinimalHeaderActions()}
        <main className="app-main">
          <div className="app-loading">
            <h2>Connecting to client</h2>
            {connectingClientDisplay ? (
              <p className="app-loading-client-host">{connectingClientDisplay}</p>
            ) : null}
          </div>
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  return (
    <>
    <div className={appClassName}>
      {!hideAppHeaderChrome ? (
      <header className="app-header app-header--minimal">
        <div className="app-header-actions">{flowHeaderActions}</div>
      </header>
      ) : null}

      <AppSessionContext.Provider value={{ formData, userName: loginUserName, headerActions: flowHeaderActions }}>
      <main className={`app-main${useLedgerFullBleed ? ' app-main--ledger-full-bleed' : ''}`}>
        {currentSlide === 1 && (
          <Slide1
            companies={companies}
            onNext={handleSlide1Next}
            onExit={handleExitApp}
            userName={loginUserName}
            flowHeaderActions={flowHeaderActions}
          />
        )}
        {currentSlide === 2 && (
          <Slide2
            years={years}
            formData={formData}
            onPrev={handlePrev}
            onNext={handleSlide2Next}
            flowHeaderActions={flowHeaderActions}
          />
        )}
        {currentSlide === 3 && (
          <Slide3 formData={formData} onPrev={handlePrev} onNext={handleSlide3Next} onExit={handleExitApp} />
        )}
        {currentSlide === 4 && (
          <Slide4 apiBase={API_BASE} formData={formData} viewMode={viewMode} onPrev={handlePrev} onReset={handleReset} />
        )}
        {currentSlide === 30 && (
          <Slide30TrialBalanceSummary
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 31 && (
          <Slide31TrialDateWise
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 5 && (
          <Slide5 apiBase={API_BASE} formData={formData} viewMode={viewMode} onPrev={handlePrev} onReset={handleReset} />
        )}
        {currentSlide === 6 && (
          <Slide6 apiBase={API_BASE} formData={formData} onPrev={backFromCustomerLedger} onReset={handleReset} />
        )}
        {currentSlide === 7 && (
          <Slide7 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 8 && (
          <Slide8 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 9 && (
          <Slide9 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 11 && (
          <Slide11 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 12 && (
          <Slide12 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 13 && (
          <Slide13 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 14 && (
          <Slide14 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 15 && (
          <Slide15 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 16 && (
          <Slide16 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} reportMode="sales" />
        )}
        {currentSlide === 17 && (
          <Slide16 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} reportMode="purchase" />
        )}
        {currentSlide === 35 && (
          <Slide35StateWiseSales
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 36 && (
          <Slide36StateWisePurchase
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 37 && (
          <Slide37PendingSalesOrder
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 38 && (
          <Slide38PendingPurchaseOrder
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 39 && (
          <Slide39PendingDispatchChallan
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 40 && (
          <Slide40CompleteLedger
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 18 && (
          <Slide17TradingAc apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 19 && (
          <Slide18PlProfitLoss apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 20 && (
          <Slide19BalanceSheet apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 21 && (
          <Slide21SaleBill
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            viewMode={viewMode}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 22 && (
          <Slide22DispatchChallan
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 23 && (
          <Slide23SalesOrder
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 24 && (
          <Slide24PurchaseOrder
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 25 && (
          <Slide25PurchaseBill
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 29 && (
          <Slide29Grn
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 26 && (
          <Slide26AccountMaster
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 27 && (
          <Slide27ItemMaster
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 28 && (
          <Slide28VoucherEntry
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 32 && (
          <Suspense
            fallback={
              <div className="app-loading">
                <p>Loading production entry…</p>
              </div>
            }
          >
            <Slide32ProductionEntry
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
              onReset={handleReset}
            />
          </Suspense>
        )}
        {currentSlide === 33 && (
          <Slide33SaleGraph
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
            onOpenSaleList={openSaleListFromChart}
          />
        )}
        {currentSlide === 34 && (
          <Slide34OverdueCustomers
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
            onOpenCustomerLedger={openCustomerLedgerFromOverdue}
          />
        )}
      </main>
      </AppSessionContext.Provider>
    </div>
    {renderDeployUpdateModal()}
    </>
  );
}

export default App;