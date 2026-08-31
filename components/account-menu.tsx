'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { rooftopName } from '@/lib/rooftops';
import { useRooftopScope, type Role } from './rooftop-scope';
import { NotificationPreferences } from './notification-preferences';

type ProfileRow = { full_name: string | null; email: string | null; title: string | null };

function roleLabel(role: Role) {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'admin') return 'Admin';
  if (role === 'manager') return 'Manager';
  return 'User';
}

function initials(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase() || 'IQ';
}

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [email, setEmail] = useState('');
  const [aal, setAal] = useState('aal1');
  const [loading, setLoading] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const { access, selected, selectedLabel, loading: scopeLoading, setSelected } = useRooftopScope();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return setLoading(false);
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;
        const [{ data: profileRow }, { data: assurance }] = await Promise.all([
          supabase.from('profiles').select('full_name,email,title').eq('user_id', userData.user.id).maybeSingle(),
          supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        ]);
        if (cancelled) return;
        setProfile((profileRow ?? null) as ProfileRow | null);
        setEmail(String(profileRow?.email ?? userData.user.email ?? ''));
        setAal(assurance?.currentLevel ?? 'aal1');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const highestRole = useMemo<Role>(() => {
    const rank: Record<Role, number> = { user: 1, manager: 2, admin: 3, super_admin: 4 };
    return access.reduce<Role>((best, row) => rank[row.role] > rank[best] ? row.role : best, 'user');
  }, [access]);

  const name = profile?.full_name?.trim() || email.split('@')[0] || 'CommsIQ User';
  const badge = initials(name, email);

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    window.localStorage.removeItem('commsiq_rooftop_scope');
    window.localStorage.removeItem('commsiq_authorized_rooftops');
    window.location.assign('/');
  }

  return <div ref={rootRef} className="relative">
    <button type="button" onClick={() => setOpen(value => !value)} aria-label="Open account menu" aria-expanded={open} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-white text-xs font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-subtle)]">{loading ? '…' : badge}</button>
    {open && <div className="absolute right-0 top-12 z-[90] max-h-[min(82vh,760px)] w-[min(94vw,400px)] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-white shadow-[0_20px_55px_rgba(15,23,42,.18)]">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-semibold text-white">{badge}</div><div className="min-w-0"><div className="truncate text-sm font-semibold">{name}</div><div className="truncate text-xs text-[var(--muted)]">{email || 'Work email unavailable'}</div></div></div>
        <div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--brand)]">{roleLabel(highestRole)}</span>{profile?.title && <span className="rounded-full bg-[var(--surface-subtle)] px-2.5 py-1 text-[10px] font-medium text-[var(--muted)]">{profile.title}</span>}</div>
      </div>

      <div className="border-b border-[var(--border)] p-4">
        <div className="flex items-end justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--muted-2)]">Data scope</div><div className="mt-1 text-xs text-[var(--muted)]">Choose which authorized rooftop powers Radar, Conversations, and Team.</div></div></div>
        <select value={selected} disabled={scopeLoading || !access.length} onChange={event => setSelected(event.target.value)} className="mt-3 min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-sm font-medium outline-none focus:border-[var(--brand)]">
          {access.length > 1 && <option value="all">All Stores</option>}
          {access.map(row => <option key={row.rooftop_id} value={row.rooftop_id}>{rooftopName(row.rooftop_id)}</option>)}
        </select>
        <div className="mt-2 text-[11px] text-[var(--muted-2)]">Currently viewing: <span className="font-semibold text-[var(--text)]">{selectedLabel}</span></div>
      </div>

      <NotificationPreferences access={access} />

      <div className="p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--muted-2)]">Authorized rooftops</div>
        <div className="mt-2 space-y-1.5">{access.length ? access.map(row => <div key={row.rooftop_id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2"><span className="min-w-0 truncate text-xs font-medium">{rooftopName(row.rooftop_id)}</span><span className="shrink-0 text-[10px] text-[var(--muted)]">{roleLabel(row.role)}</span></div>) : <div className="text-xs text-[var(--muted)]">No active rooftop memberships found.</div>}</div>
      </div>

      <div className="border-t border-[var(--border)] p-4">
        <div className="flex items-center justify-between rounded-xl bg-[var(--surface-subtle)] px-3 py-2.5"><div><div className="text-xs font-semibold">Security</div><div className="mt-0.5 text-[11px] text-[var(--muted)]">Authenticator assurance</div></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${aal === 'aal2' ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--warning-soft)] text-[var(--warning)]'}`}>{aal === 'aal2' ? 'MFA verified' : 'Standard session'}</span></div>
        <button type="button" onClick={() => void signOut()} className="mt-3 min-h-11 w-full rounded-xl border border-[var(--danger)]/25 bg-white px-4 text-sm font-semibold text-[var(--danger)] transition hover:bg-[var(--danger-soft)]">Sign out</button>
      </div>
    </div>}
  </div>;
}
