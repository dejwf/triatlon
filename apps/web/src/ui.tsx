import type { ReactNode } from 'react';
import { errorText } from './api';

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="error">
      {errorText(error)}
    </p>
  );
}

export function Loading() {
  return <p className="muted">Načítám…</p>;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
