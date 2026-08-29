'use client';

import Image from 'next/image';
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type Stage = 'restoring' | 'email' | 'code' | 'mfa';
type AccessRow = { role: 'user' | 'manager' | 'admin' | 'super_admin'; active: boolean };

const MFA_ROLES = new Set<AccessRow['role']>(['admin', 'super_admin']);
const RESTORE_TIMEOUT_MS = 12000;

export function AuthGate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<Stage>('restoring');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);

  const failClosed = useCallback(async (message?: string) => {
    const supabase = getSupabaseBrowserClient();
    await supabase?.auth.signOut().catch(() => undefined);
    setAuthorized(false);
    setFactorId('');
    setQrCode(null);
    setSecret(null);
    setMfaCode('');
    setCode('');
    setError(message ?? null);
    setStage('email');
  }, []);

  const resolveAccess = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new Error('Authentication is not configured.');

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error('Session unavailable.');

    const [{ data: profile, error: profileError }, { data: access, error: accessError }] = await Promise.all([
      supabase.from('profiles').select('status').eq('user_id', userData.user.id).maybeSingle(),
      supabase.from('commsiq_access').select('role,active').eq('user_id', userData.user.id).eq('active', true)
    ]);

    if (profileError || accessError || profile?.status !== 'active' || !access?.length) {
      throw new Error('This account is not approved for CommsIQ.');
    }

    const roles = (access as AccessRow[]).map((row) => row.role);
    const mfaRequired = roles.some((role) => MFA_ROLES.has(role));

    if (!mfaRequired) {
      setAuthorized(true);
      return;
    }

    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) throw aalError;
    if (aal.currentLevel === 'aal2') {
      setAuthorized(true);
      return;
    }

    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verified = factors.totp.find((factor) => factor.status === 'verified');

    if (verified) {
      setFactorId(verified.id);
      setQrCode(null);
      setSecret(null);
      setStage('mfa');
      return;
    }

    const { data: enrollment, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'CommsIQ'
    });
    if (enrollError) throw enrollError;
    setFactorId(enrollment.id);
    setQrCode(enrollment.totp.qr_code);
    setSecret(enrollment.totp.secret);
    setStage('mfa');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setStage('email');
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          if (!cancelled) setStage('email');
          return;
        }
        await Promise.race([
          resolveAccess(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Session restore timed out.')), RESTORE_TIMEOUT_MS))
        ]);
      } catch {
        if (!cancelled) await failClosed();
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [failClosed, resolveAccess]);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: normalized })
      });
      setEmail(normalized);
      setStage('code');
    } catch {
      setStage('code');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    const token = code.replace(/\D/g, '');
    if (token.length < 6) {
      setError('Enter the full sign-in code.');
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError('Authentication is not configured.');
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (verifyError) throw verifyError;
      await resolveAccess();
    } catch (err) {
      await failClosed(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault();
    const token = mfaCode.replace(/\D/g, '').slice(0, 6);
    if (token.length !== 6) {
      setError('Enter the full six-digit authenticator code.');
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !factorId) return setError('Authenticator setup is unavailable.');
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: token });
      if (verifyError) throw verifyError;
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError || aal.currentLevel !== 'aal2') throw aalError ?? new Error('Authenticator verification is incomplete.');
      setAuthorized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authenticator verification failed.');
    } finally {
      setBusy(false);
    }
  }

  if (authorized) return <>{children}</>;
  if (stage === 'restoring') return <RestoreScreen />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f9] px-4 py-7 text-[#172033]">
      <section className="w-full max-w-[404px] overflow-hidden rounded-[13px] border border-[#cdd5df] bg-white shadow-[0_20px_44px_rgba(16,24,40,0.10)]">
        <div className="flex h-[30px] items-center border-b border-[#d8dee7] bg-[#fbfcfd] px-3 text-[9px] font-bold uppercase tracking-[0.20em] text-[#52677f]">AUTHORIZED ACCESS // COMMSIQ</div>
        <div className="flex h-[148px] items-center justify-center bg-white px-7 pb-3 pt-7">
          <div className="relative h-[104px] w-[220px] max-w-[72%]">
            <Image src="/emich-automotive.png" alt="Emich Automotive" fill priority sizes="220px" className="object-contain" />
          </div>
        </div>
        <div className="px-7 pb-7">
          <h1 className="font-serif text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-[#0f172a]">Sign in</h1>
          <p className="mb-5 mt-1 text-[13px] leading-[1.45] text-[#667085]">Customer communication intelligence for Emich Automotive.</p>

          {stage === 'email' && (
            <form onSubmit={requestCode}>
              <FieldLabel htmlFor="email">EMAIL</FieldLabel>
              <input id="email" type="email" autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@emichauto.com" className="auth-input" />
              <p className="my-3 text-[13px] font-semibold leading-5 text-[#667085]">Invite-only access. Use your approved work email.</p>
              {error && <ErrorText>{error}</ErrorText>}
              <PrimaryButton busy={busy}>{busy ? 'Sending...' : 'Email me a code'}</PrimaryButton>
            </form>
          )}

          {stage === 'code' && (
            <form onSubmit={verifyCode}>
              <p className="mb-3 text-[13px] leading-5 text-[#667085]">If this work email is approved, a sign-in code has been sent.</p>
              <FieldLabel htmlFor="code">SIGN-IN CODE</FieldLabel>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e)=>setCode(e.target.value.replace(/\D/g,'').slice(0,10))} placeholder="000000" className="auth-input text-center tracking-[0.22em]" />
              <p className="my-3 text-[13px] font-semibold leading-5 text-[#667085]">Invite-only access. Use your approved work email.</p>
              {error && <ErrorText>{error}</ErrorText>}
              <PrimaryButton busy={busy}>{busy ? 'Verifying...' : 'Verify code'}</PrimaryButton>
              <button type="button" onClick={()=>{setError(null);setCode('');setStage('email');}} className="mt-3 w-full text-xs font-semibold text-[#52677f]">Change email</button>
            </form>
          )}

          {stage === 'mfa' && (
            <form onSubmit={verifyMfa}>
              {qrCode ? (
                <>
                  <p className="mb-3 text-[13px] leading-5 text-[#667085]">This CommsIQ role requires a second verification step. Scan this QR code with your authenticator app.</p>
                  {/* Supabase returns the QR as an SVG/data URL specifically for MFA enrollment. */}
                  <img src={qrCode} alt="CommsIQ authenticator QR code" className="mx-auto mb-3 w-full max-w-[210px] rounded-xl bg-white p-2" />
                  {secret && <details className="mb-3 text-xs text-[#667085]"><summary>Can't scan it?</summary><code className="mt-2 block break-all rounded-lg border border-[#d0d5dd] bg-[#f9fafb] p-2 text-[#172033]">{secret}</code></details>}
                </>
              ) : <p className="mb-3 text-[13px] leading-5 text-[#667085]">Enter the current six-digit code from your authenticator app.</p>}
              <FieldLabel htmlFor="mfa">AUTHENTICATOR CODE</FieldLabel>
              <input id="mfa" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(e)=>setMfaCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" className="auth-input text-center tracking-[0.22em]" />
              {error && <ErrorText>{error}</ErrorText>}
              <PrimaryButton busy={busy}>{busy ? 'Verifying...' : 'Verify authenticator'}</PrimaryButton>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

function RestoreScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f9] px-4 py-7 text-[#172033]">
      <section className="w-full max-w-[404px] rounded-[13px] border border-[#cdd5df] bg-white px-7 py-10 text-center shadow-[0_20px_44px_rgba(16,24,40,0.10)]">
        <div className="relative mx-auto h-[104px] w-[220px] max-w-[76%]"><Image src="/emich-automotive.png" alt="Emich Automotive" fill priority sizes="220px" className="object-contain" /></div>
        <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#667085]">COMMSIQ</div>
        <div className="mx-auto mt-5 h-10 w-10 animate-spin rounded-full border-[5px] border-[#dce4ed] border-b-[#1f4677]" aria-label="Restoring session" />
        <h1 className="mt-5 text-2xl font-bold tracking-[-0.03em] text-[#0f172a]">Restoring your session</h1>
        <p className="mt-2 text-sm text-[#667085]">Securely loading your CommsIQ workspace.</p>
      </section>
    </main>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.10em] text-[#344054]">{children}</label>;
}
function ErrorText({ children }: { children: ReactNode }) { return <p className="mb-3 text-[13px] font-semibold leading-5 text-[#d92d20]">{children}</p>; }
function PrimaryButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <button type="submit" disabled={busy} className="min-h-10 w-full rounded-lg bg-[#1f4677] px-4 py-2.5 text-[13px] font-bold text-white transition hover:bg-[#173b67] disabled:opacity-60">{children}</button>;
}
