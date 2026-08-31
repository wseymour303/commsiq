'use client';

import { useEffect, useMemo, useState } from 'react';
import { COMMSIQ_ROOFTOPS, rooftopName } from '@/lib/rooftops';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { RefreshIcon, UsersIcon } from './icons';

type Role = 'user' | 'manager' | 'admin' | 'super_admin';
type Membership = { rooftopId: string; role: Role; active: boolean };
type UserRow = {
  userId: string;
  email: string;
  fullName: string;
  title: string | null;
  profileStatus: string | null;
  authExists: boolean;
  emailConfirmed: boolean;
  lastSignInAt: string | null;
  mfaVerified: boolean;
  memberships: Membership[];
};
type DraftMembership = { enabled: boolean; role: Role };
type UserDraft = {
  userId?: string;
  email: string;
  fullName: string;
  title: string;
  memberships: Record<string, DraftMembership>;
};

const ASSIGNABLE_ROLES: Array<{ value: Exclude<Role, 'super_admin'>; label: string }> = [
  { value: 'user', label: 'User' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' }
];

function blankMemberships() {
  return Object.fromEntries(COMMSIQ_ROOFTOPS.map(row => [row.id, { enabled: false, role: 'manager' as Role }])) as Record<string, DraftMembership>;
}

function blankDraft(): UserDraft {
  return { email: '', fullName: '', title: '', memberships: blankMemberships() };
}

function draftFromUser(user: UserRow): UserDraft {
  const memberships = blankMemberships();
  for (const row of user.memberships) memberships[row.rooftopId] = { enabled: row.active, role: row.role };
  return { userId: user.userId, email: user.email, fullName: user.fullName, title: user.title ?? '', memberships };
}

function relativeDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<UserDraft>(blankDraft());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function adminRequest(path: string, init?: RequestInit) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new Error('Authentication is not configured.');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Your session has expired.');
    const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body?.error ?? `Request failed (${response.status}).`));
    return body;
  }

  async function load() {
    setLoading(true); setError(null);
    try {
      const body = await adminRequest('/api/admin/users');
      const rows = (body.users ?? []) as UserRow[];
      setUsers(rows);
      setSelectedId(current => current && rows.some(user => user.userId === current) ? current : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load users.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(user => [user.fullName, user.email, user.title, ...user.memberships.map(row => rooftopName(row.rooftopId))].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [query, users]);

  const selected = users.find(user => user.userId === selectedId) ?? null;

  function selectUser(user: UserRow) {
    setSelectedId(user.userId);
    setDraft(draftFromUser(user));
    setNotice(null); setError(null);
  }

  function newUser() {
    setSelectedId('');
    setDraft(blankDraft());
    setNotice(null); setError(null);
  }

  function membershipPayload() {
    return Object.entries(draft.memberships).filter(([, value]) => value.enabled).map(([rooftopId, value]) => ({ rooftopId, role: value.role }));
  }

  async function save() {
    setSaving(true); setError(null); setNotice(null);
    try {
      const editing = Boolean(draft.userId);
      const body = await adminRequest('/api/admin/users', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ userId: draft.userId, email: draft.email, fullName: draft.fullName, title: draft.title, memberships: membershipPayload() })
      });
      setNotice(editing ? 'User access updated.' : body.invited ? 'Invitation sent and CommsIQ access granted.' : 'Existing AutomotiveIQ user added to CommsIQ.');
      await load();
      if (!editing) newUser();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save user.');
    } finally { setSaving(false); }
  }

  return <div className="mx-auto w-full max-w-[1500px] px-3 pb-24 pt-3 sm:px-5 lg:px-7 lg:pb-8">
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"><UsersIcon size={15}/> Super-admin workspace</div><h1 className="mt-2 text-[clamp(1.55rem,3vw,2.25rem)] font-semibold tracking-[-0.045em]">CommsIQ user management</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">Invite users, assign rooftop access and roles, or remove CommsIQ access without deleting their shared AutomotiveIQ account.</p></div>
        <div className="flex gap-2"><button onClick={newUser} className="min-h-11 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white">Add user</button><button onClick={() => void load()} disabled={loading} className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 text-sm font-medium disabled:opacity-50"><RefreshIcon size={16} className={loading ? 'animate-spin' : ''}/> Refresh</button></div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-4"><Metric label="CommsIQ users" value={String(users.length)}/><Metric label="Active access" value={String(users.filter(user => user.memberships.some(row => row.active)).length)}/><Metric label="Super admins" value={String(users.filter(user => user.memberships.some(row => row.active && row.role === 'super_admin')).length)}/><Metric label="MFA verified" value={String(users.filter(user => user.mfaVerified).length)}/></div>
    </section>

    {error && <div className="mt-3 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}
    {notice && <div className="mt-3 rounded-xl border border-[var(--success)]/20 bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">{notice}</div>}

    <section className="mt-3 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,.85fr)_minmax(480px,1.15fr)]">
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
        <div className="border-b border-[var(--border)] p-3"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, email, store…" className="min-h-11 w-full rounded-xl border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--brand)]"/></div>
        <div className="max-h-[calc(100vh-250px)] overflow-y-auto">{!loading && filtered.length === 0 && <div className="p-8 text-center text-sm text-[var(--muted)]">No users match this search.</div>}{filtered.map(user => <button key={user.userId} onClick={()=>selectUser(user)} className={`w-full border-b border-[var(--border)] p-4 text-left last:border-b-0 hover:bg-[var(--surface-subtle)] ${selectedId === user.userId ? 'bg-[var(--brand-soft)]' : ''}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{user.fullName || user.email}</div><div className="truncate text-xs text-[var(--muted)]">{user.email}</div></div><span className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase ${user.memberships.some(row=>row.active) ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--surface-subtle)] text-[var(--muted)]'}`}>{user.memberships.some(row=>row.active) ? 'Active' : 'No access'}</span></div><div className="mt-2 flex flex-wrap gap-1">{user.memberships.filter(row=>row.active).map(row=><span key={row.rooftopId} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)]">{shortRooftop(row.rooftopId)} · {roleLabel(row.role)}</span>)}</div></button>)}</div>
      </div>

      <div className="self-start rounded-2xl border border-[var(--border)] bg-white xl:sticky xl:top-[84px]">
        <div className="border-b border-[var(--border)] p-4 sm:p-5"><div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-2)]">{selected ? 'Edit user' : 'Add user'}</div><h2 className="mt-1 text-xl font-semibold">{selected ? selected.fullName || selected.email : 'Invite to CommsIQ'}</h2>{selected && <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]"><span>Last sign-in: {relativeDate(selected.lastSignInAt)}</span><span>·</span><span>{selected.emailConfirmed ? 'Email confirmed' : 'Email pending'}</span><span>·</span><span>{selected.mfaVerified ? 'MFA verified' : 'MFA not verified'}</span></div>}</div>
        <div className="max-h-[calc(100vh-170px)] overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Full name"><input value={draft.fullName} onChange={e=>setDraft({...draft,fullName:e.target.value})} className="admin-input"/></Field><Field label="Title"><input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} className="admin-input" placeholder="Optional"/></Field></div>
          <Field label="Work email"><input type="email" disabled={Boolean(draft.userId)} value={draft.email} onChange={e=>setDraft({...draft,email:e.target.value})} className="admin-input disabled:bg-[var(--surface-subtle)] disabled:text-[var(--muted)]"/><div className="mt-1 text-[11px] text-[var(--muted)]">{draft.userId ? 'Email is tied to the shared AutomotiveIQ Auth account and is not edited here.' : 'Existing AutomotiveIQ users are reused; new users receive a Supabase invitation.'}</div></Field>

          <div className="mt-5"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Rooftop access</div><div className="mt-2 space-y-2">{COMMSIQ_ROOFTOPS.map(rooftop=>{const row=draft.memberships[rooftop.id];const lockedSuperAdmin=row.role==='super_admin';return <div key={rooftop.id} className="rounded-xl border border-[var(--border)] p-3"><div className="flex items-center justify-between gap-3"><label className="flex min-w-0 items-center gap-2"><input type="checkbox" disabled={lockedSuperAdmin} checked={row.enabled} onChange={e=>setDraft({...draft,memberships:{...draft.memberships,[rooftop.id]:{...row,enabled:e.target.checked}}})}/><span className="truncate text-sm font-medium">{rooftop.name}</span></label>{lockedSuperAdmin ? <span className="rounded-lg bg-[var(--brand)] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[.06em] text-white">Super Admin · Locked</span> : <select disabled={!row.enabled} value={row.role} onChange={e=>setDraft({...draft,memberships:{...draft.memberships,[rooftop.id]:{...row,role:e.target.value as Role}}})} className="min-h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-xs disabled:opacity-40">{ASSIGNABLE_ROLES.map(role=><option key={role.value} value={role.value}>{role.label}</option>)}</select>}</div></div>})}</div></div>

          <div className="mt-5 rounded-xl bg-[var(--surface-subtle)] p-3 text-xs leading-5 text-[var(--muted)]">Super Admin is reserved for the existing sole CommsIQ super admin and cannot be assigned to another user. Locked Super Admin rooftop access cannot be removed or downgraded here. Removing all rooftop selections for any other user disables that person’s CommsIQ access only; it does not delete or disable their shared AutomotiveIQ Auth account.</div>
          <button onClick={()=>void save()} disabled={saving || !draft.fullName.trim() || (!draft.userId && !draft.email.trim())} className="mt-4 min-h-11 w-full rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : selected ? 'Save user access' : 'Invite and grant access'}</button>
        </div>
      </div>
    </section>
  </div>;
}

function roleLabel(role: Role) { return role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'User'; }
function shortRooftop(id:string) { const name=rooftopName(id); return name.replace('Emich Volkswagen of ','VW ').replace('Emich ',''); }
function Metric({label,value}:{label:string;value:string}) { return <div><div className="text-xs text-[var(--muted)]">{label}</div><div className="mt-1 text-2xl font-semibold tracking-[-0.04em]">{value}</div></div>; }
function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="mt-3 block text-xs font-semibold text-[var(--muted)]">{label}<div className="mt-1">{children}</div></label>; }
