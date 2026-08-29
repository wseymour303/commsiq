import type { Assessment, CustomerState, Priority, RadarFilter, RadarItem } from './types';

export function getCategory(customer: CustomerState, assessment?: Assessment): RadarFilter {
  const intent = assessment?.purchase_intent_score ?? 0;
  const risk = assessment?.risk_score ?? 0;
  const sentiment = assessment?.sentiment_score ?? 0;
  const stage = `${assessment?.lifecycle_stage ?? ''} ${assessment?.primary_intent ?? ''}`.toLowerCase();

  if (customer.awaiting_human_response) return 'waiting';
  if (intent >= 75 || stage.includes('buy') || stage.includes('appointment') || stage.includes('price')) return 'buying';
  if (risk >= 65 || sentiment <= -35) return 'risk';
  if (stage.includes('future') || stage.includes('later')) return 'future';
  if (sentiment >= 70 && risk < 30) return 'advocate';
  return 'attention';
}

export function getPriority(customer: CustomerState, assessment?: Assessment): Priority {
  const risk = assessment?.risk_score ?? 0;
  const opportunity = assessment?.opportunity_score ?? 0;
  const urgency = assessment?.urgency;
  if (urgency === 'critical' || risk >= 85) return 'critical';
  if (urgency === 'high' || customer.awaiting_human_response || opportunity >= 80 || risk >= 65) return 'high';
  if (urgency === 'medium' || opportunity >= 55 || risk >= 40) return 'medium';
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
