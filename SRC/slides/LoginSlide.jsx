import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { exitApp } from '../utils/exitApp';
import FasFlowLayout from '../components/FasFlowLayout';

const MAX_LEN = 10;

function toHubUpper(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .slice(0, MAX_LEN);
}

export default function LoginSlide({ apiBase, onSuccess, onExit, appName = 'FAS Accounting', settingsSlot = null }) {
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const brand = useMemo(() => {
    const words = String(appName || '').trim().split(/\s+/).filter(Boolean);
    const short = words[0] || 'FAS';
    return { short, sub: 'ACCOUNTING SUITE' };
  }, [appName]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const u = toHubUpper(userName);
    const p = toHubUpper(password);
    if (!u || !p) {
      setError('Enter user name and password.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.post(
        `${apiBase}/api/login`,
        { user_name: u, pw: p },
        { withCredentials: true, timeout: 60000 }
      );
      if (data?.ok) {
        onSuccess({
          userName: data.user_name ?? u,
          comp_code: data.comp_code ?? data.COMP_CODE ?? '',
        });
      } else {
        setError('Login failed.');
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Login failed.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="slide slide-login slide-fas-flow">
      <FasFlowLayout
        mode="brand"
        step={1}
        logoLetter={brand.short.slice(0, 1).toUpperCase()}
        productName={brand.short}
        productSub={brand.sub}
        headerActions={settingsSlot}
      >
        <form onSubmit={handleSubmit} className="fas-flow-login-form">
          <div>
            <div className="fas-flow-title">Welcome back 👋</div>
            <div className="fas-flow-subtitle">Sign in to access your company accounts</div>
          </div>

          {error ? (
            <div className="fas-form-api-error" role="alert">
              <strong>Could not sign in.</strong> {error}
            </div>
          ) : null}

          <div className="fas-field-group">
            <div className="fas-field-label">User name</div>
            <div className="fas-field-input">
              <span className="fas-field-icon" aria-hidden="true">
                👤
              </span>
              <input
                id="login-user"
                name="user_name"
                type="text"
                autoComplete="username"
                maxLength={MAX_LEN}
                value={userName}
                onChange={(e) => setUserName(toHubUpper(e.target.value))}
                onFocus={() => {
                  try {
                    window.scrollTo(0, 0);
                    document.documentElement.scrollLeft = 0;
                    document.body.scrollLeft = 0;
                  } catch {
                    /* ignore */
                  }
                }}
                disabled={loading}
                placeholder=""
              />
            </div>
          </div>

          <div className="fas-field-group">
            <div className="fas-field-label">Password</div>
            <div className="fas-field-input">
              <span className="fas-field-icon" aria-hidden="true">
                🔒
              </span>
              <input
                id="login-pw"
                name="pw"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                spellCheck={false}
                maxLength={MAX_LEN}
                value={password}
                onChange={(e) => setPassword(toHubUpper(e.target.value))}
                onFocus={() => {
                  try {
                    window.scrollTo(0, 0);
                    document.documentElement.scrollLeft = 0;
                    document.body.scrollLeft = 0;
                  } catch {
                    /* ignore */
                  }
                }}
                disabled={loading}
              />
            </div>
          </div>

          <label className="fas-show-pass">
            <input
              type="checkbox"
              className="fas-toggle-input"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
              disabled={loading}
            />
            <span className="fas-toggle-switch" aria-hidden="true" />
            <span>Show password</span>
          </label>

          <div className="fas-info-tip">
            Username and password are case-sensitive and sent in <strong>UPPERCASE</strong> (same as legacy install).
          </div>

          <div className="fas-btn-row">
            <button
              type="button"
              className="fas-btn fas-btn-ghost"
              onClick={() => (onExit ? onExit() : exitApp())}
              disabled={loading}
              title="Closes the window when allowed; otherwise leaves a blank tab you can close."
            >
              Exit
            </button>
            <button type="submit" className="fas-btn fas-btn-primary" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </div>
        </form>
      </FasFlowLayout>
    </div>
  );
}
