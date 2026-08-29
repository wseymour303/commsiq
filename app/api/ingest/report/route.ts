import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { ingestCommunicationWorkbook } from '@/lib/server/ingest-report';

export const runtime = 'nodejs';

function bearer(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

function jwtAal(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aal?: string };
    return payload.aal ?? 'aal1';
  } catch {
    return 'aal1';
  }
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rooftopId = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID;
  if (!url || !publishableKey || !serviceRoleKey || !rooftopId) {
    return NextResponse.json({ error: 'Server configuration is incomplete.' }, { status: 503 });
  }

  const token = bearer(request);
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const auth = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: userResult, error: userError } = await auth.auth.getUser(token);
  if (userError || !userResult.user) return NextResponse.json({ error: 'Session is invalid.' }, { status: 401 });

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: access } = await admin
    .from('commsiq_access')
    .select('role,active')
    .eq('user_id', userResult.user.id)
    .eq('rooftop_id', rooftopId)
    .eq('active', true)
    .maybeSingle();

  if (!access || !['admin', 'super_admin'].includes(access.role)) {
    return NextResponse.json({ error: 'Admin access is required to ingest reports.' }, { status: 403 });
  }
  if (jwtAal(token) !== 'aal2') {
    return NextResponse.json({ error: 'Authenticator verification is required to ingest reports.' }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'An XLSX report file is required.' }, { status: 400 });
  if (!file.name.toLowerCase().endsWith('.xlsx')) return NextResponse.json({ error: 'Only .xlsx reports are accepted.' }, { status: 415 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Report exceeds the 10 MB upload limit.' }, { status: 413 });

  try {
    const result = await ingestCommunicationWorkbook({
      rooftopId,
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      source: 'secure_xlsx_upload'
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('CommunicationIQ report ingestion failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Report ingestion failed.' }, { status: 400 });
  }
}
