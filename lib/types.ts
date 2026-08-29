export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type RadarFilter = 'attention' | 'buying' | 'waiting' | 'risk' | 'future' | 'advocate' | 'all';

export interface CustomerState {
  id: string;
  rooftop_id: string;
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
}

export interface Assessment {
  id: string;
  customer_key: string;
  assessed_at: string;
  sentiment_score: number | null;
  sentiment_label: string | null;
  engagement_score: number | null;
  purchase_intent_score: number | null;
  communication_quality_score: number | null;
  risk_score: number | null;
  opportunity_score: number | null;
  overall_score: number | null;
  lifecycle_stage: string | null;
  primary_intent: string | null;
  primary_objection: string | null;
  urgency: 'critical' | 'high' | 'medium' | 'low' | 'none' | null;
  summary: string | null;
  rationale: string | null;
  recommended_next_action: string | null;
  recommended_owner: string | null;
  recommended_due_at: string | null;
}

export interface CommunicationEvent {
  id: string;
  customer_key: string | null;
  customer_name: string;
  salesperson: string | null;
  activity_at: string;
  direction: 'Inbound' | 'Outbound';
  channel: string;
  communication_type: string | null;
  message_clean: string | null;
  actor_type: 'customer' | 'human' | 'automation';
}

export interface RadarItem {
  customer: CustomerState;
  assessment?: Assessment;
  events: CommunicationEvent[];
  category: RadarFilter;
  priority: Priority;
}
