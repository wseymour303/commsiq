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
  const { count, error: accessError } = await admin
    .from('commsiq_access')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userData.user.id)
    .eq('role', 'super_admin')
    .eq('active', true);
  if (accessError) throw accessError;
  if ((count ?? 0) < 1) throw new Error('ADMIN_FORBIDDEN');

  return { userId: userData.user.id, admin };
}

export function adminErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'ADMIN_UNAUTHORIZED') return { status: 401, error: 'Unauthorized.' };
  if (message === 'ADMIN_MFA_REQUIRED') return { status: 403, error: 'A verified MFA session is required.' };
  if (message === 'ADMIN_FORBIDDEN') return { status: 403, error: 'Super-admin access is required.' };
  if (message === 'ADMIN_CONFIG_MISSING') return { status: 503, error: 'Admin server configuration is incomplete.' };
  return { status: 500, error: error instanceof Error ? error.message : 'Admin operation failed.' };
}
