'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

const SCOPE_KEY = 'commsiq_rooftop_scope';
const ACCESS_KEY = 'commsiq_authorized_rooftops';
const DEFAULT_ROOFTOP = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID ?? '';

function selectedRooftops() {
  if (typeof window === 'undefined') return DEFAULT_ROOFTOP ? [DEFAULT_ROOFTOP] : [];
  let authorized: string[] = [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACCESS_KEY) ?? '[]');
    if (Array.isArray(parsed)) authorized = parsed.map(String).filter(Boolean);
  } catch {
    authorized = [];
  }
  const selected = window.localStorage.getItem(SCOPE_KEY);
  if (selected === 'all') return authorized;
  if (selected && authorized.includes(selected)) return [selected];
  if (DEFAULT_ROOFTOP && (!authorized.length || authorized.includes(DEFAULT_ROOFTOP))) return [DEFAULT_ROOFTOP];
  return authorized.slice(0, 1);
}

async function scopedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const requestUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  try {
    const url = new URL(requestUrl);
    const isCommunicationQuery = /\/rest\/v1\/communication_(?:customer_state|ai_assessments|events|action_items|ingest_batches)$/.test(url.pathname);
    const rooftopFilter = url.searchParams.get('rooftop_id');
    if (isCommunicationQuery && rooftopFilter === `eq.${DEFAULT_ROOFTOP}`) {
      const rooftops = selectedRooftops();
      if (rooftops.length === 1) url.searchParams.set('rooftop_id', `eq.${rooftops[0]}`);
      else if (rooftops.length > 1) url.searchParams.set('rooftop_id', `in.(${rooftops.join(',')})`);
      const rewritten = url.toString();
      if (input instanceof Request) return fetch(new Request(rewritten, input), init);
      return fetch(rewritten, init);
    }
  } catch {
    // Fall through to the original request. RLS remains the final authorization boundary.
  }

  return fetch(input, init);
}

export function getSupabaseBrowserClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    global: { fetch: scopedFetch }
  });
  return client;
}
