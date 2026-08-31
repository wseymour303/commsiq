'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { rooftopName } from '@/lib/rooftops';
import type { AccessRow } from './rooftop-scope';

type Preference = {
  rooftop_id: string;
  enabled: boolean;
  digest_9am: boolean;
  digest_1pm: boolean;
  digest_6pm: boolean;
  critical_cx: boolean;
  customer_waiting: boolean;
  high_intent: boolean;
};

type PreferenceKey = Exclude<keyof Preference, 'rooftop_id'>;

function blankPreference(rooftopId: string): Preference {
  return {
    rooftop_id: rooftopId,
    enabled: false,
    digest_9am: true,
    digest_1pm: true,
    digest_6pm: true,
    critical_cx: true,
    customer_waiting: true,
    high_intent: true
  };
}

export function NotificationPreferences({ access }: { access: AccessRow[] }) {
  const [preferences, setPreferences] = useState<Record<string, Preference>>({});
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return setLoading(false);
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;
        const { data, error } = await supabase.from('commsiq_notification_preferences').select('rooftop_id,enabled,digest_9am,digest_1pm,digest_6pm,critical_cx,customer_waiting,high_intent').eq('user_id', userData.user.id);
        if (error) throw error;
        if (cancelled) return;
        setUserId(userData.user.id);
        const stored = new Map(((data ?? []) as Preference[]).map(row => [row.rooftop_id, row]));
        setPreferences(Object.fromEntries(access.map(row => [row.rooftop_id, stored.get(row.rooftop_id) ?? blankPreference(row.rooftop_id)])));
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load notification settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [access]);

  const rows = useMemo(() => access.map(row => preferences[row.rooftop_id] ?? blankPreference(row.rooftop_id)), [access, preferences]);

  function setValue(rooftopId: string, key: PreferenceKey, value: boolean) {
    setPreferences(current => ({ ...current, [rooftopId]: { ...(current[rooftopId] ?? blankPreference(rooftopId)), [key]: value } }));
    setMessage('');
  }

  async function save() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !userId) return;
    setSaving(true);
    setMessage('');
    try {
      const payload = rows.map(row => ({ ...row, user_id: userId, updated_at: new Date().toISOString() }));
      const { error } = await supabase.from('commsiq_notification_preferences').upsert(payload, { onConflict: 'user_id,rooftop_id' });
      if (error) throw error;
      setMessage('Notification preferences saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save notification settings.');
    } finally {
      setSaving(false);
    }
  }

  return <details className="group border-b border-[var(--border)]">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold"><span>Email notifications</span><span className="text-xs font-medium text-[var(--muted)] group-open:hidden">Digest controls</span><span className="hidden text-xs font-medium text-[var(--muted)] group-open:inline">Hide</span></summary>
    <div className="px-4 pb-4">
      <p className="text-[11px] leading-4 text-[var(--muted)]">Digests run at 9:00 AM, 1:00 PM, and 6:00 PM Mountain Time. Enable only the rooftops and categories you want.</p>
      {loading ? <div className="mt-3 text-xs text-[var(--muted)]">Loading notification settings…</div> : <div className="mt-3 space-y-3">{rows.map(row => <div key={row.rooftop_id} className="rounded-xl border border-[var(--border)] p-3">
        <div className="flex items-center justify-between gap-3"><div className="min-w-0 truncate text-xs font-semibold">{rooftopName(row.rooftop_id)}</div><Toggle checked={row.enabled} onChange={value => setValue(row.rooftop_id, 'enabled', value)} label="Enabled" /></div>
        <div className={`mt-3 space-y-3 ${row.enabled ? '' : 'pointer-events-none opacity-45'}`}>
          <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--muted-2)]">Digest times</div><div className="flex flex-wrap gap-2"><Chip checked={row.digest_9am} onChange={value => setValue(row.rooftop_id, 'digest_9am', value)} label="9 AM"/><Chip checked={row.digest_1pm} onChange={value => setValue(row.rooftop_id, 'digest_1pm', value)} label="1 PM"/><Chip checked={row.digest_6pm} onChange={value => setValue(row.rooftop_id, 'digest_6pm', value)} label="6 PM"/></div></div>
          <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--muted-2)]">Include</div><div className="flex flex-wrap gap-2"><Chip checked={row.critical_cx} onChange={value => setValue(row.rooftop_id, 'critical_cx', value)} label="Critical CX"/><Chip checked={row.customer_waiting} onChange={value => setValue(row.rooftop_id, 'customer_waiting', value)} label="Waiting"/><Chip checked={row.high_intent} onChange={value => setValue(row.rooftop_id, 'high_intent', value)} label="High Intent"/></div></div>
        </div>
      </div>)}</div>}
      {message && <div className="mt-3 text-[11px] font-medium text-[var(--muted)]">{message}</div>}
      <button type="button" disabled={loading || saving || !userId} onClick={() => void save()} className="mt-3 min-h-10 w-full rounded-xl bg-[var(--brand)] px-3 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save notification preferences'}</button>
    </div>
  </details>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="flex cursor-pointer items-center gap-2 text-[10px] font-semibold text-[var(--muted)]"><span>{label}</span><input type="checkbox" className="sr-only" checked={checked} onChange={event => onChange(event.target.checked)} /><span className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-[var(--success)]' : 'bg-[var(--border-strong)]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${checked ? 'left-[18px]' : 'left-0.5'}`} /></span></label>;
}

function Chip({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className={`cursor-pointer rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${checked ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--border)] text-[var(--muted)]'}`}><input type="checkbox" className="sr-only" checked={checked} onChange={event => onChange(event.target.checked)} />{label}</label>;
}
