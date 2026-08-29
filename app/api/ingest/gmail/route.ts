import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { ingestCommunicationWorkbook } from '@/lib/server/ingest-report';

export const runtime = 'nodejs';

function safeSecretMatch(received: string, expected: string) {
  const left = createHash('sha256').update(received).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rooftopId = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID;
  const ingestSecret = process.env.COMMSIQ_INGEST_SECRET;

  if (!serviceRoleKey || !url || !rooftopId || !ingestSecret) {
    return NextResponse.json({ error: 'Server configuration is incomplete.' }, { status: 503 });
  }

  const receivedSecret = request.headers.get('x-commsiq-ingest-secret') ?? '';
  if (!receivedSecret || !safeSecretMatch(receivedSecret, ingestSecret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const sourceMessageId = (request.headers.get('x-gmail-message-id') ?? '').trim();
  if (!sourceMessageId || sourceMessageId.length > 255) {
    return NextResponse.json({ error: 'A Gmail message ID is required.' }, { status: 400 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: prior, error: priorError } = await admin
    .from('communication_ingest_batches')
    .select('id,status,row_count,inserted_count,duplicate_count,metadata')
    .eq('rooftop_id', rooftopId)
    .eq('source_message_id', sourceMessageId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priorError) {
    console.error('Unable to check Gmail ingestion idempotency', priorError);
    return NextResponse.json({ error: 'Unable to verify ingestion state.' }, { status: 500 });
  }

  if (prior) {
    return NextResponse.json({
      alreadyProcessed: true,
      batchId: prior.id,
      rows: prior.row_count,
      inserted: prior.inserted_count,
      updated: prior.duplicate_count,
      metadata: prior.metadata
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Multipart form data is required.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'An XLSX report file is required.' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Only .xlsx reports are accepted.' }, { status: 415 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Report exceeds the 10 MB upload limit.' }, { status: 413 });
  }

  try {
    const result = await ingestCommunicationWorkbook({
      rooftopId,
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      source: 'gmail_apps_script',
      sourceMessageId
    });

    return NextResponse.json({ alreadyProcessed: false, ...result });
  } catch (error) {
    console.error('CommunicationIQ Gmail ingestion failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Gmail report ingestion failed.' },
      { status: 400 }
    );
  }
}
