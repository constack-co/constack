'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import { api, setCsrfToken, type SessionResponse } from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('admin@constack.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);

  useEffect(() => {
    void api<{ oidcEnabled: boolean }>('/auth/options')
      .then((options) => setOidcEnabled(options.oidcEnabled))
      .catch(() => undefined);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await api<SessionResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setCsrfToken(session.csrfToken);
      window.location.assign('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed');
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark brand-mark-logo">
            <img src="/brand/constack-logo.png" alt="" draggable={false} />
          </span>
          <span>CONSTACK</span>
        </div>
        <div className="story-copy">
          <span className="eyebrow">KUBERNETES, MADE VISIBLE</span>
          <h1>
            Your infrastructure.
            <br />
            <em>Alive in three dimensions.</em>
          </h1>
          <p>
            Observe topology, follow incidents, and understand the systems behind your workloads
            without changing them.
          </p>
        </div>
        <div className="security-note">
          <ShieldCheck size={17} />
          <span>Read-only by default. Secret values never enter the topology.</span>
        </div>
      </section>
      <section className="login-panel">
        <form onSubmit={submit} className="login-form">
          <div>
            <span className="eyebrow">SECURE ACCESS</span>
            <h2>Welcome back</h2>
            <p>Sign in to open the operations console.</p>
          </div>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              required
            />
          </label>
          {error && (
            <div className="error-banner">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? 'Signing in…' : 'Open console'}
            <ArrowRight size={16} />
          </button>
          {oidcEnabled && (
            <a className="oidc-link" href="/api/v1/auth/oidc/start">
              Continue with organization SSO
            </a>
          )}
        </form>
      </section>
    </main>
  );
}
