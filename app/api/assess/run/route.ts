import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { assessCommunicationBatch } from '@/lib/server/assess-communications';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CUSTOMERS_PER_REQUEST = 5;

function safeSecretMatch(received: string, expected: string) {
  const left = createHash('sha256').update(received).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function metadataCustomerKeys(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return [];
  const value = (metadata as { customer_keys?: unknown }).customer_keys;
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
}

export async function POST(request: Request) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rooftopId = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID;
  const ingestSecret = process.env.COMMSIQ_INGEST_SECRET;
  const openAiKey = process.env.OPENAI_API_KEY;

  if (!serviceRoleKey || !url || !rooftopId || !ingestSecret || !openAiKey) {
    return NextResponse.json({ error: 'AI assessment server configuration is incomplete.' }, { status: 503 });
  }

  const receivedSecret = request.headers.get('x-commsiq-ingest-secret') ?? '';
  if (!receivedSecret || !safeSecretMatch(receivedSecret, ingestSecret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: { batchId?: unknown };
  try {
    body = await request.json() as { batchId?: unknown };
  } catch {
    return NextResponse.json({ error: 'JSON body is required.' }, { status: 400 });
  }

  const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) {
    return NextResponse.json({ error: 'A valid batchId is required.' }, { status: 400 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: batch, error: batchError } = await admin
    .from('communication_ingest_batches')
    .select('id,status,created_at,metadata')
    .eq('id', batchId)
    .eq('rooftop_id', rooftopId)
    .maybeSingle();

  if (batchError) {
    console.error('Unable to validate CommunicationIQ assessment batch', batchError);
    return NextResponse.json({ error: 'Unable to validate assessment batch.' }, { status: 500 });
  }
  if (!batch || batch.status !== 'completed') {
    return NextResponse.json({ error: 'Completed ingestion batch not found.' }, { status: 404 });
  }

  let customerKeys = metadataCustomerKeys(batch.metadata);
  if (!customerKeys.length) {
    const { data: batchEvents, error: eventError } = await admin
      .from('communication_events')
      .select('customer_key')
      .eq('rooftop_id', rooftopId)
      .eq('ingest_batch_id', batchId);
    if (eventError) {
      return NextResponse.json({ error: 'Unable to resolve batch customers.' }, { status: 500 });
    }
    customerKeys = [...new Set((batchEvents ?? []).map(row => String(row.customer_key)).filter(Boolean))];
  }

  if (!customerKeys.length) {
    return NextResponse.json({
      alreadyAssessed: false,
      superseded: true,
      complete: true,
      batchId,
      customers: 0,
      assessments: 0,
      remaining: 0
    });
  }

  const { data: existing, error: existingError } = await admin
    .from('communication_ai_assessments')
    .select('customer_key')
    .eq('rooftop_id', rooftopId)
    .in('customer_key', customerKeys)
    .gte('assessed_at', batch.created_at);
  if (existingError) {
    return NextResponse.json({ error: 'Unable to verify assessment state.' }, { status: 500 });
  }

  const assessedKeys = new Set((existing ?? []).map(row => String(row.customer_key)));
  const pendingKeys = customerKeys.filter(customerKey => !assessedKeys.has(customerKey));

  if (!pendingKeys.length) {
    return NextResponse.json({
      alreadyAssessed: true,
      superseded: false,
      complete: true,
      batchId,
      customers: customerKeys.length,
      assessments: customerKeys.length,
      remaining: 0
    });
  }

  const currentKeys = pendingKeys.slice(0, CUSTOMERS_PER_REQUEST);

  try {
    const result = await assessCommunicationBatch({ rooftopId, batchId, customerKeys: currentKeys });
    const remaining = Math.max(0, pendingKeys.length - currentKeys.length);
    return NextResponse.json({
      alreadyAssessed: false,
      superseded: false,
      complete: remaining === 0,
      batchId,
      customers: customerKeys.length,
      assessedThisRequest: result.assessments,
      assessments: customerKeys.length - remaining,
      remaining,
      model: result.model
    });
  } catch (error) {
    console.error('CommunicationIQ AI assessment failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI assessment failed.' },
      { status: 500 }
    );
  }
}
