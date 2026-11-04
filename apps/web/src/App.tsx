import { useEffect, useState } from 'react';

export default function App() {
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/time')
      .then((r) => r.json() as Promise<{ now: string }>)
      .then((d) => setServerTime(d.now))
      .catch(() => setError(true));
  }, []);

  return (
    <main>
      <h1>Vlkančický triatlon</h1>
      <p>Systém pro zaznamenávání závodů — kostra aplikace (F0).</p>
      <p>
        Spojení s API:{' '}
        {error ? 'nedostupné' : serverTime ? `OK (čas serveru ${serverTime})` : 'ověřuji…'}
      </p>
    </main>
  );
}
