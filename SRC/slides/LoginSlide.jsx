import React, { useState } from 'react';
import axios from 'axios';
import { exitApp } from '../utils/exitApp';

const MAX_LEN = 10;

function toHubUpper(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .slice(0, MAX_LEN);
}

export default function LoginSlide({ apiBase, onSuccess, onExit }) {
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    <div className="slide slide-login">
      <h2>Sign in</h2>
      <p className="login-hint">
        Enter your credentials to continue to company selection. User name and password are sent in uppercase (same as
        legacy install).
      </p>

      <form onSubmit={handleSubmit} className="report-form login-form">
        {error ? (
          <div className="form-api-error" role="alert">
            <strong>Could not sign in.</strong> {error}
          </div>
        ) : null}

        <div className="form-group">
          <label htmlFor="login-user">User name</label>
          <input
            id="login-user"
            name="user_name"
            type="text"
            className="form-input"
            autoComplete="username"
            maxLength={MAX_LEN}
            value={userName}
            onChange={(e) => setUserName(toHubUpper(e.target.value))}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="login-pw">Password</label>
          <input
            id="login-pw"
            name="pw"
            type={showPassword ? 'text' : 'password'}
            className="form-input"
            autoComplete="current-password"
            spellCheck={false}
            maxLength={MAX_LEN}
            value={password}
            onChange={(e) => setPassword(toHubUpper(e.target.value))}
            disabled={loading}
          />
        </div>

        <div className="form-checkbox-row">
          <input
            id="login-show-pw"
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
            disabled={loading}
          />
          <label htmlFor="login-show-pw">Show password</label>
        </div>

        <div className="button-group button-group--with-exit">
          <button
            type="button"
            className="btn btn-secondary btn-exit"
            onClick={() => (onExit ? onExit() : exitApp())}
            disabled={loading}
            title="Closes the window when allowed; otherwise leaves a blank tab you can close."
          >
            Exit
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </div>
      </form>
    </div>
  );
}
