import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { rooftopForDealer, rooftopName } from '@/lib/rooftops';
import { parseCommunicationWorkbook, type NormalizedCommunicationEvent } from './report-xlsx';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type StateEventRow = {
  customer_key: string;
  customer_name: string;
  salesperson: string | null;
  activity_at: string;
  direction: string;
  lead_status: string | null;
  lead_source: string | null;
  is_automated: boolean;
};

function adminClient() {
  if (!url || !serviceRoleKey) throw new Error('Supabase server configuration is incomplete.');
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function unique<T>(values: T[]) { return [...new Set(values)]; }

function latestNonNull<K extends keyof StateEventRow>(rows: StateEventRow[], key: K): StateEventRow[K] | null {
  for (const row of rows) {
    const value = row[key];
    if (value != null && value !== '') return value;
  }
  return null;
}

async function refreshCustomerStates(rooftopId: string, customerKeys: string[], supabase: ReturnType<typeof adminClient>) {
  if (!customerKeys.length) return;
  const { data, error } = await supabase.from('communication_events')
    .select('customer_key,customer_name,salesperson,activity_at,direction,lead_status,lead_source,is_automated')
    .eq('rooftop_id', rooftopId).in('customer_key', customerKeys).order('activity_at', { ascending: false });
  if (error) throw error;

  const grouped = new Map<string, StateEventRow[]>();
  for (const row of (data ?? []) as StateEventRow[]) {
    const list = grouped.get(row.customer_key) ?? [];
    list.push(row); grouped.set(row.customer_key, list);
  }

  const now = Date.now();
  const states = [...grouped.entries()].map(([customerKey, rows]) => {
    const ordered = [...rows].sort((a, b) => new Date(b.activity_at).getTime() - new Date(a.activity_at).getTime());
    const ascending = [...ordered].reverse();
    const inbound = ordered.filter(row => row.direction === 'Inbound');
    const outbound = ordered.filter(row => row.direction === 'Outbound');
    const humanOutbound = outbound.filter(row => !row.is_automated);
    const automatedOutbound = outbound.filter(row => row.is_automated);
    const lastInbound = inbound[0]?.activity_at ?? null;
    const lastHumanOutbound = humanOutbound[0]?.activity_at ?? null;
    const awaitingHumanResponse = Boolean(lastInbound && (!lastHumanOutbound || new Date(lastHumanOutbound).getTime() < new Date(lastInbound).getTime()));
    const salesperson = ordered.find(row => row.salesperson && !row.is_automated)?.salesperson ?? latestNonNull(ordered, 'salesperson');
    return {
      rooftop_id: rooftopId, customer_key: customerKey, customer_name: ordered[0]?.customer_name ?? 'Unknown customer', salesperson,
      lead_status: latestNonNull(ordered, 'lead_status'), lead_source: latestNonNull(ordered, 'lead_source'),
      first_activity_at: ascending[0]?.activity_at ?? null, last_activity_at: ordered[0]?.activity_at ?? null,
      last_inbound_at: lastInbound, last_outbound_at: outbound[0]?.activity_at ?? null, last_human_outbound_at: lastHumanOutbound,
      inbound_count: inbound.length, outbound_count: outbound.length, automated_outbound_count: automatedOutbound.length,
      human_outbound_count: humanOutbound.length, awaiting_human_response: awaitingHumanResponse,
      minutes_waiting: awaitingHumanResponse && lastInbound ? Math.max(0, Math.floor((now - new Date(lastInbound).getTime()) / 60000)) : null,
      updated_at: new Date().toISOString()
    };
  });

  if (states.length) {
    const { error: stateError } = await supabase.from('communication_customer_state').upsert(states, { onConflict: 'rooftop_id,customer_key' });
    if (stateError) throw stateError;
  }
}

async function ingestRooftopEvents(input: {
  rooftopId: string;
  events: NormalizedCommunicationEvent[];
  fileName: string;
  source: string;
  sourceMessageId?: string | null;
}, supabase: ReturnType<typeof adminClient>) {
  if (input.sourceMessageId) {
    const { data: prior, error: priorError } = await supabase.from('communication_ingest_batches')
      .select('id,row_count,inserted_count,duplicate_count,metadata').eq('rooftop_id', input.rooftopId)
      .eq('source_message_id', input.sourceMessageId).eq('status', 'completed').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (priorError) throw priorError;
    if (prior) return { batchId: prior.id, rooftopId: input.rooftopId, rooftopName: rooftopName(input.rooftopId), rows: prior.row_count, inserted: prior.inserted_count, updated: prior.duplicate_count, customers: Array.isArray(prior.metadata?.customer_keys) ? prior.metadata.customer_keys.length : 0, alreadyProcessed: true };
  }

  const fingerprints = input.events.map(event => event.source_fingerprint);
  const customerKeys = unique(input.events.map(event => event.customer_key));
  const { data: existing, error: existingError } = await supabase.from('communication_events').select('source_fingerprint')
    .eq('rooftop_id', input.rooftopId).in('source_fingerprint', fingerprints);
  if (existingError) throw existingError;
  const existingSet = new Set((existing ?? []).map(row => row.source_fingerprint));

  const { data: batch, error: batchError } = await supabase.from('communication_ingest_batches').insert({
    rooftop_id: input.rooftopId, source: input.source, source_file_name: input.fileName, source_message_id: input.sourceMessageId ?? null,
    row_count: input.events.length, inserted_count: 0, duplicate_count: 0, status: 'processing',
    metadata: { parser: 'commsiq-xlsx-v1', customer_keys: customerKeys }
  }).select('id').single();
  if (batchError) throw batchError;

  const rows = input.events.map(event => ({ ...event, rooftop_id: input.rooftopId, ingest_batch_id: batch.id }));
  try {
    for (let index = 0; index < rows.length; index += 100) {
      const { error } = await supabase.from('communication_events').upsert(rows.slice(index, index + 100), { onConflict: 'rooftop_id,source_fingerprint' });
      if (error) throw error;
    }
    await refreshCustomerStates(input.rooftopId, customerKeys, supabase);
    const insertedCount = input.events.filter(event => !existingSet.has(event.source_fingerprint)).length;
    const updatedCount = input.events.length - insertedCount;
    const { error: completeError } = await supabase.from('communication_ingest_batches').update({
      inserted_count: insertedCount, duplicate_count: updatedCount, status: 'completed',
      metadata: { parser: 'commsiq-xlsx-v1', updated_count: updatedCount, customer_keys: customerKeys }
    }).eq('id', batch.id);
    if (completeError) throw completeError;
    return { batchId: batch.id, rooftopId: input.rooftopId, rooftopName: rooftopName(input.rooftopId), rows: input.events.length, inserted: insertedCount, updated: updatedCount, customers: customerKeys.length, alreadyProcessed: false };
  } catch (error) {
    await supabase.from('communication_ingest_batches').update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Unknown ingestion error' }).eq('id', batch.id);
    throw error;
  }
}

export async function ingestCommunicationWorkbook(input: {
  rooftopId?: string;
  routeByDealer?: boolean;
  buffer: Buffer;
  fileName: string;
  source?: string;
  sourceMessageId?: string | null;
}) {
  const supabase = adminClient();
  const events = await parseCommunicationWorkbook(input.buffer);
  const groups = new Map<string, NormalizedCommunicationEvent[]>();

  if (input.routeByDealer) {
    const unknownDealers = new Set<string>();
    for (const event of events) {
      const rooftop = rooftopForDealer(event.dealer);
      if (!rooftop) { unknownDealers.add(event.dealer ?? '(blank)'); continue; }
      const list = groups.get(rooftop.id) ?? [];
      list.push(event); groups.set(rooftop.id, list);
    }
    if (unknownDealers.size) throw new Error(`Unmapped MotoSnap Dealer value(s): ${[...unknownDealers].join(', ')}`);
  } else {
    if (!input.rooftopId) throw new Error('A rooftopId is required for single-rooftop ingestion.');
    groups.set(input.rooftopId, events);
  }

  const batches = [];
  for (const [rooftopId, rooftopEvents] of groups) {
    batches.push(await ingestRooftopEvents({ rooftopId, events: rooftopEvents, fileName: input.fileName, source: input.source ?? 'xlsx_upload', sourceMessageId: input.sourceMessageId }, supabase));
  }

  return {
    rows: events.length,
    inserted: batches.reduce((sum, batch) => sum + batch.inserted, 0),
    updated: batches.reduce((sum, batch) => sum + batch.updated, 0),
    customers: batches.reduce((sum, batch) => sum + batch.customers, 0),
    batchId: batches[0]?.batchId ?? null,
    batchIds: batches.map(batch => batch.batchId),
    rooftops: batches
  };
}
