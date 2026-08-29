import 'server-only';

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openAiKey = process.env.OPENAI_API_KEY;
const model = process.env.COMMUNICATIONIQ_AI_MODEL || 'gpt-5.6-luna';

const MAX_CUSTOMERS_PER_CALL = 12;
const MAX_EVENTS_PER_CUSTOMER = 14;
const MAX_MESSAGE_CHARS = 1400;

const assessmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assessments'],
  properties: {
    assessments: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_CUSTOMERS_PER_CALL,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'customer_key',
          'sentiment_score',
          'sentiment_label',
          'engagement_score',
          'purchase_intent_score',
          'communication_quality_score',
          'risk_score',
          'opportunity_score',
          'overall_score',
          'lifecycle_stage',
          'primary_intent',
          'primary_objection',
          'urgency',
          'summary',
          'rationale',
          'recommended_next_action',
          'recommended_owner',
          'recommended_due_minutes',
          'evidence'
        ],
        properties: {
          customer_key: { type: 'string' },
          sentiment_score: { type: 'integer', minimum: -100, maximum: 100 },
          sentiment_label: {
            type: 'string',
            enum: ['very_negative', 'negative', 'neutral', 'positive', 'very_positive']
          },
          engagement_score: { type: 'integer', minimum: 0, maximum: 100 },
          purchase_intent_score: { type: 'integer', minimum: 0, maximum: 100 },
          communication_quality_score: { type: 'integer', minimum: 0, maximum: 100 },
          risk_score: { type: 'integer', minimum: 0, maximum: 100 },
          opportunity_score: { type: 'integer', minimum: 0, maximum: 100 },
          overall_score: { type: 'integer', minimum: 0, maximum: 100 },
          lifecycle_stage: {
            type: 'string',
            enum: [
              'new_lead',
              'engaged',
              'appointment',
              'negotiation',
              'future_follow_up',
              'post_sale',
              'inactive',
              'do_not_contact',
              'unknown'
            ]
          },
          primary_intent: { type: ['string', 'null'] },
          primary_objection: { type: ['string', 'null'] },
          urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          summary: { type: 'string', maxLength: 420 },
          rationale: { type: 'string', maxLength: 600 },
          recommended_next_action: { type: 'string', maxLength: 420 },
          recommended_owner: { type: 'string', maxLength: 100 },
          recommended_due_minutes: { type: ['integer', 'null'], minimum: 0, maximum: 10080 },
          evidence: {
            type: 'array',
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['event_id', 'activity_at', 'reason'],
              properties: {
                event_id: { type: 'string' },
                activity_at: { type: 'string' },
                reason: { type: 'string', maxLength: 260 }
              }
            }
          }
        }
      }
    }
  }
} as const;

type EventRow = {
  id: string;
  customer_key: string;
  customer_name: string;
  salesperson: string | null;
  activity_at: string;
  direction: string;
  channel: string;
  communication_type: string | null;
  interaction_result: string | null;
  lead_status: string | null;
  lead_source: string | null;
  message_clean: string | null;
  actor_type: string;
  is_automated: boolean;
};

type StateRow = {
  customer_key: string;
  customer_name: string;
  salesperson: string | null;
  lead_status: string | null;
  lead_source: string | null;
  first_activity_at: string | null;
  last_activity_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_human_outbound_at: string | null;
  inbound_count: number;
  outbound_count: number;
  automated_outbound_count: number;
  human_outbound_count: number;
  awaiting_human_response: boolean;
  minutes_waiting: number | null;
};

type ModelAssessment = {
  customer_key: string;
  sentiment_score: number;
  sentiment_label: string;
  engagement_score: number;
  purchase_intent_score: number;
  communication_quality_score: number;
  risk_score: number;
  opportunity_score: number;
  overall_score: number;
  lifecycle_stage: string;
  primary_intent: string | null;
  primary_objection: string | null;
  urgency: string;
  summary: string;
  rationale: string;
  recommended_next_action: string;
  recommended_owner: string;
  recommended_due_minutes: number | null;
  evidence: Array<{ event_id: string; activity_at: string; reason: string }>;
};

function adminClient() {
  if (!url || !serviceRoleKey) throw new Error('Supabase server configuration is incomplete.');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

function openAiClient() {
  if (!openAiKey) throw new Error('OPENAI_API_KEY is not configured.');
  return new OpenAI({ apiKey: openAiKey });
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function compactMessage(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_MESSAGE_CHARS
    ? `${normalized.slice(0, MAX_MESSAGE_CHARS)}…`
    : normalized;
}

function dueAt(minutes: number | null) {
  if (minutes == null) return null;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function affectedCustomerKeys(batchId: string, rooftopId: string, supabase: ReturnType<typeof adminClient>) {
  const { data, error } = await supabase
    .from('communication_events')
    .select('customer_key')
    .eq('rooftop_id', rooftopId)
    .eq('ingest_batch_id', batchId);
  if (error) throw error;
  return unique((data ?? []).map(row => String(row.customer_key)).filter(Boolean));
}

async function loadCustomerContext(
  rooftopId: string,
  customerKeys: string[],
  supabase: ReturnType<typeof adminClient>
) {
  const { data: states, error: stateError } = await supabase
    .from('communication_customer_state')
    .select('*')
    .eq('rooftop_id', rooftopId)
    .in('customer_key', customerKeys);
  if (stateError) throw stateError;

  const { data: eventRows, error: eventError } = await supabase
    .from('communication_events')
    .select('id,customer_key,customer_name,salesperson,activity_at,direction,channel,communication_type,interaction_result,lead_status,lead_source,message_clean,actor_type,is_automated')
    .eq('rooftop_id', rooftopId)
    .in('customer_key', customerKeys)
    .order('activity_at', { ascending: false });
  if (eventError) throw eventError;

  const eventsByKey = new Map<string, EventRow[]>();
  for (const event of (eventRows ?? []) as EventRow[]) {
    const list = eventsByKey.get(event.customer_key) ?? [];
    if (list.length < MAX_EVENTS_PER_CUSTOMER) list.push(event);
    eventsByKey.set(event.customer_key, list);
  }

  const stateByKey = new Map((states ?? []).map(state => [String(state.customer_key), state as StateRow]));
  return customerKeys
    .map(customerKey => {
      const state = stateByKey.get(customerKey);
      if (!state) return null;
      const recentEvents = (eventsByKey.get(customerKey) ?? []).reverse().map(event => ({
        id: event.id,
        activity_at: event.activity_at,
        direction: event.direction,
        channel: event.channel,
        communication_type: event.communication_type,
        interaction_result: event.interaction_result,
        actor: event.actor_type === 'automation' || event.is_automated ? 'automation' : 'human',
        salesperson: event.salesperson,
        message: compactMessage(event.message_clean)
      }));
      return { state, recent_events: recentEvents };
    })
    .filter(Boolean) as Array<{ state: StateRow; recent_events: Array<Record<string, unknown>> }>;
}

async function assessChunk(
  contexts: Array<{ state: StateRow; recent_events: Array<Record<string, unknown>> }>
): Promise<ModelAssessment[]> {
  const client = openAiClient();
  const allowedKeys = new Set(contexts.map(context => context.state.customer_key));

  const response = await client.responses.create({
    model,
    reasoning: { effort: 'low' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'communication_assessments',
        description: 'Structured dealership customer communication assessments for CommunicationIQ.',
        strict: true,
        schema: assessmentSchema
      }
    },
    input: [
      {
        role: 'system',
        content: `You are CommunicationIQ, an expert retail automotive sales communication analyst for Emich Automotive. Analyze only the supplied communication history and state. Do not invent facts, vehicle details, appointments, promises, objections, or customer intent that are not evidenced.

Scoring rules:
- sentiment_score: customer sentiment from -100 very negative to +100 very positive.
- engagement_score: how actively the customer is participating, 0-100.
- purchase_intent_score: evidence the customer is moving toward a vehicle purchase, 0-100. Do not mistake automated outbound volume for intent.
- communication_quality_score: quality of HUMAN dealership communication: responsiveness, clarity, empathy, question handling, CTA quality, promise-follow-through, and respect for customer preferences. Automation is context, not proof of human quality. Use about 50 when there is insufficient human communication to judge.
- risk_score: likelihood of losing the customer or creating a customer-experience/compliance problem, 0-100. STOP/opt-out requests, broken promises, unanswered inbound, repeated outreach after a stated future date, or poor handling can raise risk.
- opportunity_score: actionable near-term manager/sales opportunity, 0-100.
- overall_score: priority/intelligence score, 0-100, balancing opportunity, risk, urgency, and actionability. It is not an average.

Operating rules:
- Emich uses a transparent One Price sales model. Never recommend an unapproved discount or price concession. For price objections, recommend reinforcing value/transparency and converting the conversation toward the appropriate next step such as a visit or test drive.
- Distinguish Ava/automation from a human salesperson. Do not credit automation as human follow-up.
- If the customer explicitly asks to stop, lifecycle_stage must be do_not_contact and the next action should protect the opt-out.
- If the customer gives a clear future shopping date, avoid over-contact and recommend follow-up at or after that date.
- If the customer is awaiting a human response, urgency should generally be high unless the inbound message clearly requires no response.
- recommended_owner should normally be the assigned salesperson; use Sales Manager when escalation, pricing-policy reinforcement, complaint recovery, or assignment is needed.
- Evidence must reference only event IDs supplied in recent_events. Keep summaries and actions succinct and manager-usable.`
      },
      {
        role: 'user',
        content: `Assess every customer in this JSON array and return exactly one assessment per customer_key.\n\n${JSON.stringify(contexts)}`
      }
    ]
  });

  if (!response.output_text) throw new Error('OpenAI returned no structured assessment output.');
  const parsed = JSON.parse(response.output_text) as { assessments?: ModelAssessment[] };
  const assessments = parsed.assessments ?? [];

  if (assessments.length !== contexts.length) {
    throw new Error(`AI assessment count mismatch: expected ${contexts.length}, received ${assessments.length}.`);
  }
  for (const assessment of assessments) {
    if (!allowedKeys.has(assessment.customer_key)) {
      throw new Error(`AI returned an unexpected customer_key: ${assessment.customer_key}`);
    }
  }
  return assessments;
}

export async function assessCommunicationBatch(input: { rooftopId: string; batchId: string }) {
  const supabase = adminClient();
  const customerKeys = await affectedCustomerKeys(input.batchId, input.rooftopId, supabase);
  if (!customerKeys.length) {
    return { batchId: input.batchId, customers: 0, assessments: 0, model };
  }

  const context = await loadCustomerContext(input.rooftopId, customerKeys, supabase);
  const allAssessments: ModelAssessment[] = [];

  for (const group of chunks(context, MAX_CUSTOMERS_PER_CALL)) {
    const groupAssessments = await assessChunk(group);
    allAssessments.push(...groupAssessments);
  }

  const assessedAt = new Date().toISOString();
  const rows = allAssessments.map(assessment => ({
    rooftop_id: input.rooftopId,
    customer_key: assessment.customer_key,
    assessed_at: assessedAt,
    model,
    sentiment_score: assessment.sentiment_score,
    sentiment_label: assessment.sentiment_label,
    engagement_score: assessment.engagement_score,
    purchase_intent_score: assessment.purchase_intent_score,
    communication_quality_score: assessment.communication_quality_score,
    risk_score: assessment.risk_score,
    opportunity_score: assessment.opportunity_score,
    overall_score: assessment.overall_score,
    lifecycle_stage: assessment.lifecycle_stage,
    primary_intent: assessment.primary_intent,
    primary_objection: assessment.primary_objection,
    urgency: assessment.urgency,
    summary: assessment.summary,
    rationale: assessment.rationale,
    recommended_next_action: assessment.recommended_next_action,
    recommended_owner: assessment.recommended_owner,
    recommended_due_at: dueAt(assessment.recommended_due_minutes),
    evidence: assessment.evidence
  }));

  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await supabase
      .from('communication_ai_assessments')
      .insert(rows.slice(index, index + 100));
    if (error) throw error;
  }

  return {
    batchId: input.batchId,
    customers: customerKeys.length,
    assessments: rows.length,
    model
  };
}
