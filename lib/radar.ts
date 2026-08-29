import type { Assessment, CustomerState, Priority, RadarFilter, RadarItem } from './types';

function normalizedAssessmentText(assessment?: Assessment) {
  return `${assessment?.lifecycle_stage ?? ''} ${assessment?.primary_intent ?? ''} ${assessment?.primary_objection ?? ''}`.toLowerCase();
}

export function matchesRadarFilter(item: RadarItem, filter: RadarFilter) {
  if (filter === 'all') return true;
  if (filter === 'attention') return item.priority === 'critical' || item.priority === 'high';

  const { customer, assessment } = item;
  const text = normalizedAssessmentText(assessment);
  const intent = assessment?.purchase_intent_score ?? 0;
  const risk = assessment?.risk_score ?? 0;
  const sentiment = assessment?.sentiment_score ?? 0;
  const engagement = assessment?.engagement_score ?? 0;
  const automationShare = customer.outbound_count > 0
    ? customer.automated_outbound_count / customer.outbound_count
    : 0;

  if (filter === 'dnc') return assessment?.lifecycle_stage === 'do_not_contact';
  if (filter === 'waiting') return customer.awaiting_human_response;
  if (filter === 'price') return /price|payment|monthly|budget|out.the.door|trade/.test(text);
  if (filter === 'appointment') return assessment?.lifecycle_stage === 'appointment' || /appointment|test drive|visit|come in|schedule/.test(text);
  if (filter === 'buying') return intent >= 75 || /negotiation|purchase|buying/.test(text);
  if (filter === 'risk') return risk >= 65 || sentiment <= -35;
  if (filter === 'future') return assessment?.lifecycle_stage === 'future_follow_up' || /future|later|not ready|next month/.test(text);
  if (filter === 'overcontact') {
    return assessment?.lifecycle_stage !== 'do_not_contact' && (
      (automationShare >= 0.7 && customer.automated_outbound_count >= 2 && engagement < 40) ||
      (assessment?.lifecycle_stage === 'future_follow_up' && customer.automated_outbound_count >= 2)
    );
  }
  if (filter === 'advocate') return sentiment >= 65 && risk < 35;
  return item.category === filter;
}

export function getCategory(customer: CustomerState, assessment?: Assessment): RadarFilter {
  const text = normalizedAssessmentText(assessment);
  const intent = assessment?.purchase_intent_score ?? 0;
  const risk = assessment?.risk_score ?? 0;
  const sentiment = assessment?.sentiment_score ?? 0;
  const engagement = assessment?.engagement_score ?? 0;
  const automationShare = customer.outbound_count > 0
    ? customer.automated_outbound_count / customer.outbound_count
    : 0;

  if (assessment?.lifecycle_stage === 'do_not_contact') return 'dnc';
  if (customer.awaiting_human_response) return 'waiting';
  if (/price|payment|monthly|budget|out.the.door|trade/.test(text)) return 'price';
  if (assessment?.lifecycle_stage === 'appointment' || /appointment|test drive|visit|come in|schedule/.test(text)) return 'appointment';
  if (intent >= 75 || /negotiation|purchase|buying/.test(text)) return 'buying';
  if (risk >= 65 || sentiment <= -35) return 'risk';
  if (assessment?.lifecycle_stage === 'future_follow_up' || /future|later|not ready|next month/.test(text)) return 'future';
  if ((automationShare >= 0.7 && customer.automated_outbound_count >= 2 && engagement < 40)) return 'overcontact';
  if (sentiment >= 65 && risk < 35) return 'advocate';
  return 'attention';
}

export function getPriority(customer: CustomerState, assessment?: Assessment): Priority {
  const risk = assessment?.risk_score ?? 0;
  const opportunity = assessment?.opportunity_score ?? 0;
  const intent = assessment?.purchase_intent_score ?? 0;
  const urgency = assessment?.urgency;

  if (assessment?.lifecycle_stage === 'do_not_contact') return risk >= 85 ? 'critical' : 'high';
  if (urgency === 'critical' || risk >= 85) return 'critical';
  if (urgency === 'high' || customer.awaiting_human_response || opportunity >= 80 || intent >= 85 || risk >= 65) return 'high';
  if (urgency === 'medium' || opportunity >= 55 || intent >= 65 || risk >= 40) return 'medium';
  return 'low';
}

export function toRadarItem(customer: CustomerState, assessment: Assessment | undefined, events: RadarItem['events']): RadarItem {
  return {
    customer,
    assessment,
    events,
    category: getCategory(customer, assessment),
    priority: getPriority(customer, assessment)
  };
}
