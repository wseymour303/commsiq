import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const generic = { message: 'If this work email is approved, a sign-in code has been sent.' };

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !publishableKey || !serviceRoleKey) return NextResponse.json(generic);

  let email = '';
  try {
    const body = await request.json();
    email = String(body?.email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json(generic);
  }
  if (!email) return NextResponse.json(generic);

  try {
    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data: profile } = await admin
      .from('profiles')
      .select('user_id,status')
      .eq('email', email)
      .maybeSingle();

    if (profile?.user_id && profile.status === 'active') {
      const { count } = await admin
        .from('commsiq_access')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.user_id)
        .eq('active', true);

      if ((count ?? 0) > 0) {
        const auth = createClient(url, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      }
    }
  } catch {
    // Always return the same response so account approval cannot be enumerated.
  }

  return NextResponse.json(generic);
}
