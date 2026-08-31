import { NextResponse } from 'next/server';
import { COMMSIQ_ROOFTOPS } from '@/lib/rooftops';
import { adminErrorResponse, requireCommsIqSuperAdmin } from '@/lib/server/commsiq-admin';

export const runtime = 'nodejs';

type Role = 'user' | 'manager' | 'admin' | 'super_admin';
type MembershipInput = { rooftopId: string; role: Role };
const ROLES = new Set<Role>(['user','manager','admin','super_admin']);
const ROOFTOP_IDS = new Set<string>(COMMSIQ_ROOFTOPS.map(row => row.id));

function memberships(value: unknown) {
  if (!Array.isArray(value)) return [] as MembershipInput[];
  const map = new Map<string, MembershipInput>();
  for (const item of value) {
    const rooftopId = String((item as { rooftopId?: unknown })?.rooftopId ?? '');
    const role = String((item as { role?: unknown })?.role ?? '') as Role;
    if (ROOFTOP_IDS.has(rooftopId) && ROLES.has(role)) map.set(rooftopId, { rooftopId, role });
  }
  return [...map.values()];
}

async function authUsers(admin: Awaited<ReturnType<typeof requireCommsIqSuperAdmin>>['admin']) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users;
}

async function saveAccess(admin: Awaited<ReturnType<typeof requireCommsIqSuperAdmin>>['admin'], userId: string, rows: MembershipInput[]) {
  const selected = new Set(rows.map(row => row.rooftopId));
  const { data: existing, error: existingError } = await admin.from('commsiq_access').select('rooftop_id').eq('user_id', userId);
  if (existingError) throw existingError;
  const disable = (existing ?? []).map(row => String(row.rooftop_id)).filter(id => !selected.has(id));
  if (disable.length) {
    const { error } = await admin.from('commsiq_access').update({ active: false, updated_at: new Date().toISOString() }).eq('user_id', userId).in('rooftop_id', disable);
    if (error) throw error;
  }
  if (rows.length) {
    const { error } = await admin.from('commsiq_access').upsert(rows.map(row => ({ user_id: userId, rooftop_id: row.rooftopId, role: row.role, active: true, updated_at: new Date().toISOString() })), { onConflict: 'user_id,rooftop_id' });
    if (error) throw error;
  }
}

export async function GET(request: Request) {
  try {
    const { admin } = await requireCommsIqSuperAdmin(request);
    const { data: access, error: accessError } = await admin.from('commsiq_access').select('user_id,rooftop_id,role,active').order('created_at');
    if (accessError) throw accessError;
    const ids = [...new Set((access ?? []).map(row => String(row.user_id)))];
    if (!ids.length) return NextResponse.json({ users: [] });
    const [{ data: profiles, error: profileError }, users] = await Promise.all([
      admin.from('profiles').select('user_id,email,full_name,title,status').in('user_id', ids),
      authUsers(admin)
    ]);
    if (profileError) throw profileError;
    const profileMap = new Map((profiles ?? []).map(row => [String(row.user_id), row]));
    const authMap = new Map(users.map(user => [user.id, user]));
    return NextResponse.json({ users: ids.map(userId => {
      const profile = profileMap.get(userId);
      const auth = authMap.get(userId);
      const factors = ((auth as unknown as { factors?: Array<{ status?: string }> } | undefined)?.factors ?? []);
      return {
        userId,
        email: String(profile?.email ?? auth?.email ?? ''),
        fullName: String(profile?.full_name ?? ''),
        title: profile?.title ?? null,
        profileStatus: profile?.status ?? null,
        authExists: Boolean(auth),
        emailConfirmed: Boolean(auth?.email_confirmed_at),
        lastSignInAt: auth?.last_sign_in_at ?? null,
        mfaVerified: factors.some(factor => factor.status === 'verified'),
        memberships: (access ?? []).filter(row => String(row.user_id) === userId).map(row => ({ rooftopId: String(row.rooftop_id), role: row.role, active: Boolean(row.active) }))
      };
    }).sort((a,b) => (a.fullName || a.email).localeCompare(b.fullName || b.email)) });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}

export async function POST(request: Request) {
  try {
    const { admin } = await requireCommsIqSuperAdmin(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const email = String(body.email ?? '').trim().toLowerCase();
    const fullName = String(body.fullName ?? '').trim();
    const title = String(body.title ?? '').trim() || null;
    const access = memberships(body.memberships);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || !access.length) return NextResponse.json({ error: 'Email, full name, and at least one rooftop are required.' }, { status: 400 });

    const users = await authUsers(admin);
    let user = users.find(row => row.email?.toLowerCase() === email) ?? null;
    let invited = false;
    if (!user) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName, title } });
      if (error || !data.user) throw error ?? new Error('Unable to invite user.');
      user = data.user;
      invited = true;
    }
    const { data: existingProfile, error: lookupError } = await admin.from('profiles').select('status').eq('user_id', user.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (existingProfile?.status === 'disabled') return NextResponse.json({ error: 'This shared AutomotiveIQ profile is disabled. Reactivate it centrally before granting CommsIQ access.' }, { status: 409 });
    const { error: profileError } = await admin.from('profiles').upsert({ user_id: user.id, email, full_name: fullName, title, status: 'active', updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (profileError) throw profileError;
    await saveAccess(admin, user.id, access);
    return NextResponse.json({ userId: user.id, invited });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId: actorId, admin } = await requireCommsIqSuperAdmin(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const userId = String(body.userId ?? '').trim();
    const fullName = String(body.fullName ?? '').trim();
    const title = String(body.title ?? '').trim() || null;
    const access = memberships(body.memberships);
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !fullName) return NextResponse.json({ error: 'A valid user and full name are required.' }, { status: 400 });
    if (actorId === userId && !access.some(row => row.role === 'super_admin')) return NextResponse.json({ error: 'You cannot remove your own final CommsIQ super-admin access.' }, { status: 400 });
    const { data: profile, error: lookupError } = await admin.from('profiles').select('status').eq('user_id', userId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!profile) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    if (profile.status === 'disabled') return NextResponse.json({ error: 'This shared AutomotiveIQ profile is disabled and cannot be edited from CommsIQ.' }, { status: 409 });
    const { error: profileError } = await admin.from('profiles').update({ full_name: fullName, title, updated_at: new Date().toISOString() }).eq('user_id', userId);
    if (profileError) throw profileError;
    await saveAccess(admin, userId, access);
    return NextResponse.json({ updated: true });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
