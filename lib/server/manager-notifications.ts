import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { rooftopName } from '@/lib/rooftops';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RESEND_API_URL = 'https://api.resend.com/emails';
const WAIT_THRESHOLD_MINUTES = 30;
const DEDUPE_WINDOW_MS = 4 * 60 * 60 * 1000;

type AssessmentRow = {
  id: string;
  customer_key: string;
  urgency: string;
  sentiment_score: number | null;
  purchase_intent_score: number | null;
  risk_score: number | null;
  opportunity_score: number | null;
  overall_score: number | null;
  summary: string | null;
  rationale: string | null;
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

type AlertCandidate = {
  type: AlertType;
  customerKey: string;
  customerName: string;
  salesperson: string | null;
  assessment: AssessmentRow;
  state: StateRow;
};

function adminClient() {
  if (!url || !serviceRoleKey) throw new Error('Supabase server configuration is incomplete.');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

function recipients() {
  return String(process.env.COMMSIQ_ALERT_TO_EMAILS ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

function fromEmail() {
  return String(process.env.COMMSIQ_ALERT_FROM_EMAIL ?? '').trim();
}

function resendKey() {
  return String(process.env.RESEND_API_KEY ?? '').trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function alertLabel(type: AlertType) {
  if (type === 'critical_cx') return 'Critical CX Risk';
  if (type === 'customer_waiting') return 'Customer Waiting on Us';
  return 'High-Intent Opportunity';
}

function buildCandidates(assessments: AssessmentRow[], states: StateRow[]) {
  const stateByKey = new Map(states.map(state => [state.customer_key, state]));
  const candidates: AlertCandidate[] = [];

  for (const assessment of assessments) {
    const state = stateByKey.get(assessment.customer_key);
    if (!state) continue;

    if (
      assessment.urgency === 'critical'
      || (assessment.risk_score ?? 0) >= 85
      || (assessment.sentiment_score ?? 0) <= -70
    ) {
      candidates.push({ type: 'critical_cx', customerKey: assessment.customer_key, customerName: state.customer_name, salesperson: state.salesperson, assessment, state });
    }

    if (state.awaiting_human_response && (state.minutes_waiting ?? 0) >= WAIT_THRESHOLD_MINUTES) {
      candidates.push({ type: 'customer_waiting', customerKey: assessment.customer_key, customerName: state.customer_name, salesperson: state.salesperson, assessment, state });
    }

    if (
      (assessment.purchase_intent_score ?? 0) >= 85
      && (assessment.opportunity_score ?? 0) >= 75
      && (assessment.urgency === 'high' || assessment.urgency === 'critical')
    ) {
      candidates.push({ type: 'high_intent', customerKey: assessment.customer_key, customerName: state.customer_name, salesperson: state.salesperson, assessment, state });
    }
  }

  return candidates;
}

function dedupeKey(rooftopId: string, candidate: AlertCandidate) {
  const bucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  return `${candidate.type}:${rooftopId}:${candidate.customerKey}:${bucket}`;
}

function subject(rooftopId: string, candidate: AlertCandidate) {
  return `CommsIQ: ${alertLabel(candidate.type)} — ${candidate.customerName} — ${rooftopName(rooftopId)}`;
}

function html(rooftopId: string, candidate: AlertCandidate) {
  const wait = candidate.state.minutes_waiting == null ? null : `${candidate.state.minutes_waiting} minutes`;
  const scoreRows = [
    ['AIQ', candidate.assessment.overall_score],
    ['Risk', candidate.assessment.risk_score],
    ['Purchase intent', candidate.assessment.purchase_intent_score],
    ['Opportunity', candidate.assessment.opportunity_score]
  ];

  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#17191d"><div style="max-width:640px;margin:0 auto;padding:28px 16px"><div style="background:#111827;color:white;border-radius:16px 16px 0 0;padding:20px 24px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.7">Emich Automotive</div><div style="font-size:24px;font-weight:700;margin-top:4px">CommsIQ</div></div><div style="background:white;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;padding:24px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">${escapeHtml(alertLabel(candidate.type))}</div><h1 style="font-size:24px;line-height:1.25;margin:8px 0 4px">${escapeHtml(candidate.customerName)}</h1><div style="font-size:13px;color:#6b7280">${escapeHtml(rooftopName(rooftopId))} · ${escapeHtml(candidate.salesperson ?? 'Unassigned')}${wait ? ` · Waiting ${escapeHtml(wait)}` : ''}</div><p style="font-size:15px;line-height:1.6;margin:20px 0">${escapeHtml(candidate.assessment.summary ?? 'Manager review recommended.')}</p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:18px 0">${scoreRows.map(([label, value]) => `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6b7280">${label}</div><div style="font-size:20px;font-weight:700;margin-top:3px">${value ?? '—'}</div></div>`).join('')}</div><div style="background:#f3f4f6;border-radius:12px;padding:16px"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">What should happen next</div><div style="font-size:15px;font-weight:600;line-height:1.5;margin-top:6px">${escapeHtml(candidate.assessment.recommended_next_action ?? 'Review the customer conversation in CommsIQ.')}</div><div style="font-size:12px;color:#6b7280;margin-top:8px">Owner: ${escapeHtml(candidate.assessment.recommended_owner ?? candidate.salesperson ?? 'Sales Manager')}</div></div><p style="font-size:11px;line-height:1.5;color:#9ca3af;margin:20px 0 0">This alert is generated from current CommsIQ communication intelligence. Review the source conversation before taking customer-facing action.</p></div></div></body></html>`;
}

async function sendResendEmail(input: { from: string; to: string; subject: string; html: string; apiKey: string }) {
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: input.from, to: [input.to], subject: input.subject, html: input.html })
  });

  const body = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? `Resend returned HTTP ${response.status}.`);
  return String(body.id ?? '');
}

export async function sendManagerNotifications(input: { rooftopId: string; customerKeys: string[] }) {
  const toEmails = recipients();
  const from = fromEmail();
  const apiKey = resendKey();
  if (!toEmails.length || !from || !apiKey || !input.customerKeys.length) {
    return { candidates: 0, sent: 0, skipped: true };
  }

  const supabase = adminClient();
  const { data: assessmentRows, error: assessmentError } = await supabase
    .from('communication_ai_assessments')
    .select('id,customer_key,urgency,sentiment_score,purchase_intent_score,risk_score,opportunity_score,overall_score,summary,rationale,recommended_next_action,recommended_owner,assessed_at')
    .eq('rooftop_id', input.rooftopId)
    .in('customer_key', input.customerKeys)
    .order('assessed_at', { ascending: false });
  if (assessmentError) throw assessmentError;

  const latest = new Map<string, AssessmentRow>();
  for (const row of (assessmentRows ?? []) as AssessmentRow[]) if (!latest.has(row.customer_key)) latest.set(row.customer_key, row);

  const { data: stateRows, error: stateError } = await supabase
    .from('communication_customer_state')
    .select('customer_key,customer_name,salesperson,awaiting_human_response,minutes_waiting')
    .eq('rooftop_id', input.rooftopId)
    .in('customer_key', input.customerKeys);
  if (stateError) throw stateError;

  const candidates = buildCandidates([...latest.values()], (stateRows ?? []) as StateRow[]);
  let sent = 0;

  for (const candidate of candidates) {
    const alertSubject = subject(input.rooftopId, candidate);
    const key = dedupeKey(input.rooftopId, candidate);

    for (const recipientEmail of toEmails) {
      const { data: inserted, error: insertError } = await supabase
        .from('commsiq_notification_deliveries')
        .insert({
          rooftop_id: input.rooftopId,
          customer_key: candidate.customerKey,
          assessment_id: candidate.assessment.id,
          alert_type: candidate.type,
          recipient_email: recipientEmail,
          dedupe_key: key,
          subject: alertSubject,
          status: 'pending'
        })
        .select('id')
        .maybeSingle();

      if (insertError) {
        if (insertError.code === '23505') continue;
        throw insertError;
      }
      if (!inserted) continue;

      try {
        const resendId = await sendResendEmail({ from, to: recipientEmail, subject: alertSubject, html: html(input.rooftopId, candidate), apiKey });
        const { error: updateError } = await supabase
          .from('commsiq_notification_deliveries')
          .update({ status: 'sent', resend_id: resendId || null, sent_at: new Date().toISOString() })
          .eq('id', inserted.id);
        if (updateError) throw updateError;
        sent += 1;
      } catch (error) {
        await supabase
          .from('commsiq_notification_deliveries')
          .update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Unknown Resend error' })
          .eq('id', inserted.id);
        console.error('CommsIQ manager notification failed', error);
      }
    }
  }

  return { candidates: candidates.length, sent, skipped: false };
}
