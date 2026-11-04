/** Přihlášení magic linkem: e-mail → 6místný kód z e-mailu (odkaz z e-mailu je pro web). */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { errorText, requestCode, useApp, verifyCode } from '../store';
import { Button, Card, ErrorText, Field, Muted, s } from '../ui';

export default function Login() {
  const expired = useApp((st) => st.sessionExpired);
  const pending = useApp((st) => st.outbox.filter((i) => i.state === 'pending').length);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        {expired && (
          <Card style={{ borderColor: '#9a6700' }}>
            <Text style={s.text}>
              Přihlášení vypršelo. {pending ? `Ve frontě čeká ${pending} akcí — ` : ''}
              {pending ? 'po přihlášení se odešlou.' : 'Přihlaste se prosím znovu.'}
            </Text>
          </Card>
        )}
        <Card>
          <Text style={s.h1}>Přihlášení organizátora</Text>
          {step === 'email' ? (
            <>
              <Muted>Pošleme vám e-mail s přihlašovacím kódem.</Muted>
              <Field
                label="E-mail"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                placeholder="jmeno@example.com"
                onSubmitEditing={() =>
                  void run(async () => (await requestCode(email), setStep('code')))
                }
              />
              <Button
                title="Poslat kód"
                disabled={busy || !email.includes('@')}
                onPress={() => void run(async () => (await requestCode(email), setStep('code')))}
              />
            </>
          ) : (
            <>
              <Muted>Kód jsme poslali na {email}. Platí 15 minut.</Muted>
              <Field
                label="Kód z e-mailu"
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center' }}
                autoFocus
              />
              <Button
                title="Přihlásit"
                disabled={busy || code.length !== 6}
                onPress={() => void run(() => verifyCode(email, code))}
              />
              <Button title="Zpět" kind="secondary" onPress={() => setStep('email')} />
            </>
          )}
          <ErrorText>{error}</ErrorText>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
