import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { rooftopName } from '@/lib/rooftops';

const RESEND_API_URL = 'https://api.resend.com/emails';
const WAIT_THRESHOLD_MINUTES = 30;

export type DigestWindow = '9am' | '1pm' | '6pm';

type PreferenceRow = {
  user_id: string;
  rooftop_id: string;
  enabled: boolean;
  digest_9am: boolean;
  digest_1pm: boolean;
  digest_6pm: boolean;
  critical_cx: boolean;
  customer_waiting: boolean;
  high_intent: boolean;
};

type ProfileRow = { user_id: string; email: string; status: string };
type AccessRow = { user_id: string; rooftop_id: string; active: boolean };
type AssessmentRow = {
  id: string;
  customer_key: string;
  urgency: string | null;
  sentiment_score: number | null;
  purchase_intent_score: number | null;
  risk_score: number | null;
  opportunity_score: number | null;
  overall_score: number | null;
  summary: string | null;
  recommended_next_action: string | null;
  recommended_owner: string | null;
  assessed_at: string;
};
type StateRow = {
  customer_key: string;
  customer_name: string;
  salesperson: string | null;
  awaiting_human_response: boolean;
  minutes_waiting: number | null;
};
type AlertType = 'critical_cx' | 'customer_waiting' | 'high_intent';
type Candidate = {
  type: AlertType;
  state: StateRow;
  assessment: AssessmentRow;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration is incomplete.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function enabledForWindow(preference: PreferenceRow, window: DigestWindow) {
  if (!preference.enabled) return false;
  if (window === '9am') return preference.digest_9am;
  if (window === '1pm') return preference.digest_1pm;
  return preference.digest_6pm;
}

function buildCandidates(assessments: AssessmentRow[], states: StateRow[]) {
  const stateByKey = new Map(states.map(state => [state.customer_key, state]));
  const candidates: Candidate[] = [];
  for (const assessment of assessments) {
    const state = stateByKey.get(assessment.customer_key);
    if (!state) continue;
    if (assessment.urgency === 'critical' || (assessment.risk_score ?? 0) >= 85 || (assessment.sentiment_score ?? 0) <= -70) {
      candidates.push({ type: 'critical_cx', state, assessment });
    }
    if (state.awaiting_human_response && (state.minutes_waiting ?? 0) >= WAIT_THRESHOLD_MINUTES) {
      candidates.push({ type: 'customer_waiting', state, assessment });
    }
    if ((assessment.purchase_intent_score ?? 0) >= 85 && (assessment.opportunity_score ?? 0) >= 75 && (assessment.urgency === 'high' || assessment.urgency === 'critical')) {
      candidates.push({ type: 'high_intent', state, assessment });
    }
  }
  return candidates;
}

function filterByPreference(candidates: Candidate[], preference: PreferenceRow) {
  return candidates.filter(candidate => {
    if (candidate.type === 'critical_cx') return preference.critical_cx;
    if (candidate.type === 'customer_waiting') return preference.customer_waiting;
    return preference.high_intent;
  });
}

function priority(candidate: Candidate) {
  if (candidate.type === 'critical_cx') return 3;
  if (candidate.type === 'high_intent') return 2;
  return 1;
}

function label(type: AlertType) {
  if (type === 'critical_cx') return 'Critical CX';
  if (type === 'customer_waiting') return 'Waiting on Us';
  return 'High Intent';
}

function digestHtml(rooftopId: string, window: DigestWindow, candidates: Candidate[]) {
  const counts = {
    critical: candidates.filter(item => item.type === 'critical_cx').length,
    waiting: candidates.filter(item => item.type === 'customer_waiting').length,
    intent: candidates.filter(item => item.type === 'high_intent').length
  };
  const uniqueCustomers = new Map<string, Candidate[]>();
  for (const candidate of [...candidates].sort((a, b) => priority(b) - priority(a) || (b.assessment.overall_score ?? 0) - (a.assessment.overall_score ?? 0))) {
    const list = uniqueCustomers.get(candidate.state.customer_key) ?? [];
    list.push(candidate);
    uniqueCustomers.set(candidate.state.customer_key, list);
  }
  const rows = [...uniqueCustomers.values()].slice(0, 15).map(items => {
    const first = items[0];
    const tags = [...new Set(items.map(item => label(item.type)))].join(' · ');
    const wait = first.state.minutes_waiting == null ? '' : ` · Waiting ${first.state.minutes_waiting}m`;
    return `<div style="padding:16px 0;border-bottom:1px solid #e5e7eb"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">${escapeHtml(tags)}</div><div style="margin-top:5px;font-size:16px;font-weight:700">${escapeHtml(first.state.customer_name)}</div><div style="margin-top:2px;font-size:12px;color:#6b7280">${escapeHtml(first.state.salesperson ?? 'Unassigned')}${escapeHtml(wait)}</div><p style="margin:9px 0 0;font-size:13px;line-height:1.55">${escapeHtml(first.assessment.summary ?? 'Manager review recommended.')}</p><div style="margin-top:8px;font-size:13px;font-weight:600">Next: ${escapeHtml(first.assessment.recommended_next_action ?? 'Review the conversation in CommsIQ.')}</div></div>`;
  }).join('');
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#17191d"><div style="max-width:680px;margin:0 auto;padding:28px 16px"><div style="background:#111827;color:#fff;border-radius:16px 16px 0 0;padding:20px 24px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.7">Emich Automotive</div><div style="font-size:24px;font-weight:700;margin-top:4px">CommsIQ Digest</div></div><div style="background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;padding:24px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b7280">${escapeHtml(rooftopName(rooftopId))} · ${window.toUpperCase()} Mountain</div><h1 style="font-size:24px;margin:8px 0 18px">What needs attention now</h1><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"><div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6b7280">Critical CX</div><div style="font-size:22px;font-weight:700;margin-top:3px">${counts.critical}</div></div><div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6b7280">Waiting</div><div style="font-size:22px;font-weight:700;margin-top:3px">${counts.waiting}</div></div><div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6b7280">High Intent</div><div style="font-size:22px;font-weight:700;margin-top:3px">${counts.intent}</div></div></div><div style="margin-top:18px">${rows}</div><p style="font-size:11px;line-height:1.5;color:#9ca3af;margin:20px 0 0">This digest reflects current CommsIQ communication intelligence for this rooftop. Review source conversations before customer-facing action.</p></div></div></body></html>`;
}

async function sendResendEmail(input: { to: string; subject: string; html: string }) {
  const apiKey = String(process.env.RESEND_API_KEY ?? '').trim();
  const from = String(process.env.COMMSIQ_ALERT_FROM_EMAIL ?? '').trim();
  if (!apiKey || !from) throw new Error('Resend digest configuration is incomplete.');
  const response = await fetch(RESEND_API_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }) });
  const body = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? `Resend returned HTTP ${response.status}.`);
  return String(body.id ?? '');
}

async function rooftopCandidates(supabase: ReturnType<typeof adminClient>, rooftopId: string) {
  const { data: stateRows, error: stateError } = await supabase.from('communication_customer_state').select('customer_key,customer_name,salesperson,awaiting_human_response,minutes_waiting').eq('rooftop_id', rooftopId).order('last_activity_at', { ascending: false }).limit(250);
  if (stateError) throw stateError;
  const states = (stateRows ?? []) as StateRow[];
  if (!states.length) return [];
  const keys = states.map(state => state.customer_key);
  const { data: assessmentRows, error: assessmentError } = await supabase.from('communication_ai_assessments').select('id,customer_key,urgency,sentiment_score,purchase_intent_score,risk_score,opportunity_score,overall_score,summary,recommended_next_action,recommended_owner,assessed_at').eq('rooftop_id', rooftopId).in('customer_key', keys).order('assessed_at', { ascending: false });
  if (assessmentError) throw assessmentError;
  const latest = new Map<string, AssessmentRow>();
  for (const row of (assessmentRows ?? []) as AssessmentRow[]) if (!latest.has(row.customer_key)) latest.set(row.customer_key, row);
  return buildCandidates([...latest.values()], states);
}

export async function sendScheduledDigests(input: { window: DigestWindow; localDate: string }) {
  const supabase = adminClient();
  const { data: preferenceRows, error: preferenceError } = await supabase.from('commsiq_notification_preferences').select('*').eq('enabled', true);
  if (preferenceError) throw preferenceError;
  const preferences = ((preferenceRows ?? []) as PreferenceRow[]).filter(row => enabledForWindow(row, input.window));
  if (!preferences.length) return { eligible: 0, sent: 0, skipped: 0 };
  const userIds = [...new Set(preferences.map(row => row.user_id))];
  const [{ data: profileRows, error: profileError }, { data: accessRows, error: accessError }] = await Promise.all([
    supabase.from('profiles').select('user_id,email,status').in('user_id', userIds),
    supabase.from('commsiq_access').select('user_id,rooftop_id,active').in('user_id', userIds).eq('active', true)
  ]);
  if (profileError) throw profileError;
  if (accessError) throw accessError;
  const profiles = new Map(((profileRows ?? []) as ProfileRow[]).map(row => [row.user_id, row]));
  const allowed = new Set(((accessRows ?? []) as AccessRow[]).map(row => `${row.user_id}:${row.rooftop_id}`));
  const cache = new Map<string, Candidate[]>();
  let sent = 0;
  let skipped = 0;
  for (const preference of preferences) {
    const profile = profiles.get(preference.user_id);
    if (!profile || profile.status !== 'active' || !profile.email || !allowed.has(`${preference.user_id}:${preference.rooftop_id}`)) { skipped += 1; continue; }
    if (!cache.has(preference.rooftop_id)) cache.set(preference.rooftop_id, await rooftopCandidates(supabase, preference.rooftop_id));
    const candidates = filterByPreference(cache.get(preference.rooftop_id) ?? [], preference);
    if (!candidates.length) { skipped += 1; continue; }
    const dedupeKey = `digest:${preference.user_id}:${preference.rooftop_id}:${input.localDate}:${input.window}`;
    const subject = `CommsIQ ${input.window.toUpperCase()} Digest — ${rooftopName(preference.rooftop_id)} — ${candidates.length} flags`;
    const { data: delivery, error: insertError } = await supabase.from('commsiq_notification_deliveries').insert({ rooftop_id: preference.rooftop_id, user_id: preference.user_id, customer_key: 'digest', alert_type: 'digest', recipient_email: profile.email.toLowerCase(), dedupe_key: dedupeKey, digest_window: input.window, subject, status: 'pending' }).select('id').maybeSingle();
    if (insertError) { if (insertError.code === '23505') { skipped += 1; continue; } throw insertError; }
    if (!delivery) { skipped += 1; continue; }
    try {
      const resendId = await sendResendEmail({ to: profile.email, subject, html: digestHtml(preference.rooftop_id, input.window, candidates) });
      await supabase.from('commsiq_notification_deliveries').update({ status: 'sent', resend_id: resendId || null, sent_at: new Date().toISOString() }).eq('id', delivery.id);
      sent += 1;
    } catch (error) {
      await supabase.from('commsiq_notification_deliveries').update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Unknown digest error' }).eq('id', delivery.id);
      console.error('CommsIQ digest delivery failed', error);
    }
  }
  return { eligible: preferences.length, sent, skipped };
}
