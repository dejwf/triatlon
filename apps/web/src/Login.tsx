import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthUser } from '@triatlon/shared';
import { auth } from './api';

type Step = 'email' | 'sent' | 'verifying';

export function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linkHandled = useRef(false);

  // Příchod z odkazu v e-mailu: /prihlaseni?token=…
  useEffect(() => {
    const token = new URLSearchParams(location.search).get('token');
    if (!token || linkHandled.current) return;
    linkHandled.current = true;
    history.replaceState(null, '', '/prihlaseni');
    setStep('verifying');
    auth
      .verify({ token })
      .then(onLogin)
      .catch(() => {
        setError('Odkaz je neplatný, prošlý nebo už byl použit. Vyžádejte si nový.');
        setStep('email');
      });
  }, [onLogin]);

  async function submitEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.request(email);
      setStep('sent');
    } catch {
      setError('E-mail se nepodařilo odeslat. Zkontrolujte adresu a zkuste to znovu.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await auth.verify({ email, code }));
    } catch {
      setError('Kód je neplatný nebo prošlý.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'verifying') return <p>Přihlašuji…</p>;

  return (
    <section className="login">
      <h2>Přihlášení</h2>
      {error && <p role="alert">{error}</p>}
      {step === 'email' ? (
        <form onSubmit={submitEmail}>
          <label>
            E-mail
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button disabled={busy}>Poslat přihlašovací odkaz</button>
        </form>
      ) : (
        <form onSubmit={submitCode}>
          <p>
            Pokud je <strong>{email}</strong> v systému, poslali jsme na něj přihlašovací odkaz a
            kód. Klikněte na odkaz, nebo zadejte kód:
          </p>
          <label>
            Kód z e-mailu
            <input
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <button disabled={busy}>Přihlásit</button>
          <button type="button" onClick={() => setStep('email')}>
            Zadat jiný e-mail
          </button>
        </form>
      )}
    </section>
  );
}
