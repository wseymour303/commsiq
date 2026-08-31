import 'server-only';

import { createClient } from '@supabase/supabase-js';

export type CommsIqAdminContext = {
  userId: string;
  admin: any;
};

function decodeAal(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aal?: string };
    return payload.aal ?? null;
  } catch {
    return null;
  }
}

export async function requireCommsIqSuperAdmin(request: Request): Promise<CommsIqAdminContext> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !serviceRoleKey) throw new Error('ADMIN_CONFIG_MISSING');

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) throw new Error('ADMIN_UNAUTHORIZED');
  if (decodeAal(token) !== 'aal2') throw new Error('ADMIN_MFA_REQUIRED');

  const verifier = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: userData, error: userError } = await verifier.auth.getUser(token);
  if (userError || !userData.user) throw new Error('ADMIN_UNAUTHORIZED');

  const admin: any = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: superAdminRows, error: accessError } = await admin
    .from('commsiq_access')
    .select('user_id')
    .eq('role', 'super_admin')
    .eq('active', true);
  if (accessError) throw accessError;

  const superAdminIds = [...new Set((superAdminRows ?? []).map((row: { user_id: string }) => String(row.user_id)))];
  if (superAdminIds.length !== 1 || superAdminIds[0] !== userData.user.id) throw new Error('ADMIN_SINGLETON_VIOLATION');

  return { userId: userData.user.id, admin };
}

export function adminErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'ADMIN_UNAUTHORIZED') return { status: 401, error: 'Unauthorized.' };
  if (message === 'ADMIN_MFA_REQUIRED') return { status: 403, error: 'A verified MFA session is required.' };
  if (message === 'ADMIN_SINGLETON_VIOLATION') return { status: 403, error: 'CommsIQ requires exactly one active super admin. Resolve the access configuration before using User Management.' };
  if (message === 'ADMIN_CONFIG_MISSING') return { status: 503, error: 'Admin server configuration is incomplete.' };
  return { status: 500, error: error instanceof Error ? error.message : 'Admin operation failed.' };
}
