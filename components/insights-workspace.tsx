'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { useRooftopScope } from './rooftop-scope';
import { ChartIcon, ClockIcon, RefreshIcon, SparkIcon, UsersIcon } from './icons';

const rooftopId = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID;

type RangeDays = 7 | 30 | 90;
type InsightAssessment = {
  id: string;
  rooftop_id: string;
  customer_key: string;
  assessed_at: string;
  engagement_score: number | null;
  purchase_intent_score: number | null;
  communication_quality_score: number | null;
  risk_score: number | null;
  opportunity_score: number | null;
  overall_score: number | null;
  sentiment_score: number | null;
  primary_intent: string | null;
  primary_objection: string | null;
  urgency: string | null;
};
type InsightState = {
  rooftop_id: string;
  customer_key: string;
  customer_name: string;
  salesperson: string | null;
  awaiting_human_response: boolean;
  minutes_waiting: number | null;
  human_outbound_count: number;
  automated_outbound_count: number;
  last_activity_at: string | null;
};
type InsightEvent = {
  rooftop_id: string;
  customer_key: string | null;
  activity_at: string;
  direction: string;
  channel: string;
  actor_type: string;
  salesperson: string | null;
};
type ActionItem = {
  rooftop_id: string;
  status: string;
  priority: string;
  owner_name: string | null;
  created_at: string;
  resolved_at: string | null;
};
type TrendPoint = {
  label: string;
  aiq: number | null;
  quality: number | null;
  intent: number | null;
  risk: number | null;
  count: number;
};
type RepRow = {
  name: string;
  customers: number;
  awaiting: number;
  avgWait: number | null;
  aiq: number | null;
  quality: number | null;
  intent: number | null;
  risk: number | null;
  automationShare: number;
  coachingPriority: number;
};

type LoadState = {
  assessments: InsightAssessment[];
  states: InsightState[];
  events: InsightEvent[];
  actions: ActionItem[];
  loadedAt: Date;
};

function average(values: Array<number | null | undefined>) {
  const clean = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : null;
}

function deltaLabel(value: number | null) {
  if (value == null || value === 0) return 'No material change';
  return `${value > 0 ? '+' : ''}${value} pts vs earlier period`;
}

function scoreTone(value: number | null, inverse = false) {
  if (value == null) return 'text-[var(--muted)]';
  if (inverse) {
    if (value >= 70) return 'text-[var(--danger)]';
    if (value >= 45) return 'text-[var(--warning)]';
    return 'text-[var(--success)]';
  }
  if (value >= 75) return 'text-[var(--success)]';
  if (value >= 55) return 'text-[var(--warning)]';
  return 'text-[var(--danger)]';
}

function minutesLabel(value: number | null) {
  if (value == null) return '—';
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function titleCase(value: string | null | undefined) {
  const clean = String(value ?? '').trim();
  if (!clean) return 'Unspecified';
  return clean.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function countBy(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = String(raw ?? '').trim() || 'Unspecified';
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function latestAssessmentMap(assessments: InsightAssessment[]) {
  const map = new Map<string, InsightAssessment>();
  for (const row of [...assessments].sort((a, b) => new Date(b.assessed_at).getTime() - new Date(a.assessed_at).getTime())) {
    if (!map.has(row.customer_key)) map.set(row.customer_key, row);
  }
  return map;
}

function buildTrend(assessments: InsightAssessment[], days: RangeDays, start: Date): TrendPoint[] {
  const bucketDays = days === 7 ? 1 : days === 30 ? 3 : 7;
  const bucketCount = Math.ceil(days / bucketDays);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({ index, rows: [] as InsightAssessment[] }));
  const startMs = start.getTime();
  for (const assessment of assessments) {
    const elapsedDays = Math.max(0, (new Date(assessment.assessed_at).getTime() - startMs) / 86400000);
    const index = Math.min(bucketCount - 1, Math.floor(elapsedDays / bucketDays));
    buckets[index].rows.push(assessment);
  }
  return buckets.map(bucket => {
    const date = new Date(startMs + bucket.index * bucketDays * 86400000);
    return {
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      aiq: average(bucket.rows.map(row => row.overall_score)),
      quality: average(bucket.rows.map(row => row.communication_quality_score)),
      intent: average(bucket.rows.map(row => row.purchase_intent_score)),
      risk: average(bucket.rows.map(row => row.risk_score)),
      count: bucket.rows.length
    };
  });
}

function buildRepRows(states: InsightState[], latest: Map<string, InsightAssessment>) {
  const grouped = new Map<string, InsightState[]>();
  for (const state of states) {
    const rep = state.salesperson?.trim() || 'Unassigned';
    const list = grouped.get(rep) ?? [];
    list.push(state);
    grouped.set(rep, list);
  }
  return [...grouped.entries()].map(([name, customers]): RepRow => {
    const assessments = customers.map(row => latest.get(row.customer_key)).filter((value): value is InsightAssessment => Boolean(value));
    const awaiting = customers.filter(row => row.awaiting_human_response);
    const human = customers.reduce((sum, row) => sum + (row.human_outbound_count ?? 0), 0);
    const automation = customers.reduce((sum, row) => sum + (row.automated_outbound_count ?? 0), 0);
    const total = human + automation;
    const quality = average(assessments.map(row => row.communication_quality_score));
    const risk = average(assessments.map(row => row.risk_score));
    const intent = average(assessments.map(row => row.purchase_intent_score));
    const aiq = average(assessments.map(row => row.overall_score));
    const avgWait = awaiting.length ? Math.round(awaiting.reduce((sum, row) => sum + (row.minutes_waiting ?? 0), 0) / awaiting.length) : null;
    const automationShare = total ? Math.round((automation / total) * 100) : 0;
    const coachingPriority = Math.round(
      awaiting.length * 11 +
      Math.max(0, 65 - (quality ?? 65)) * 0.8 +
      Math.max(0, (risk ?? 0) - 55) * 0.65 +
      Math.max(0, automationShare - 65) * 0.2
    );
    return { name, customers: customers.length, awaiting: awaiting.length, avgWait, aiq, quality, intent, risk, automationShare, coachingPriority };
  }).sort((a, b) => b.coachingPriority - a.coachingPriority || a.name.localeCompare(b.name));
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
    <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--muted-2)]">{label}</div>
    <div className={`mt-2 text-3xl font-semibold tracking-[-0.05em] ${tone ?? ''}`}>{value}</div>
    <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</div>
  </div>;
}

function DistributionList({ title, subtitle, rows }: { title: string; subtitle: string; rows: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return <div className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
    <div className="text-sm font-semibold">{title}</div>
    <div className="mt-1 text-xs text-[var(--muted)]">{subtitle}</div>
    <div className="mt-4 space-y-3">{rows.length ? rows.slice(0, 7).map(row => <div key={row.label}>
      <div className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate font-medium">{titleCase(row.label)}</span><span className="shrink-0 text-[var(--muted)]">{row.count}</span></div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]"><div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.max(4, Math.round((row.count / max) * 100))}%` }} /></div>
    </div>) : <div className="rounded-xl bg-[var(--surface-subtle)] p-4 text-xs text-[var(--muted)]">No classified data in this period.</div>}</div>
  </div>;
}

function TrendPanel({ trend }: { trend: TrendPoint[] }) {
  const valid = trend.filter(point => point.count > 0);
  return <div className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
    <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold">AIQ performance trend</div><div className="mt-1 text-xs text-[var(--muted)]">Average AIQ, communication quality, purchase intent, and risk by period.</div></div><ChartIcon size={18}/></div>
    {valid.length ? <div className="mt-5 overflow-x-auto"><div className="min-w-[620px]">
      <div className="grid h-56 items-end gap-2" style={{ gridTemplateColumns: `repeat(${trend.length},minmax(34px,1fr))` }}>{trend.map((point, index) => <div key={`${point.label}-${index}`} className="flex h-full flex-col justify-end">
        <div className="flex flex-1 items-end justify-center gap-1">
          <div title={`AIQ ${point.aiq ?? '—'}`} className="w-[22%] rounded-t bg-[var(--brand)]" style={{ height: `${Math.max(2, point.aiq ?? 0)}%`, opacity: point.count ? 1 : .14 }} />
          <div title={`Quality ${point.quality ?? '—'}`} className="w-[22%] rounded-t bg-[var(--accent)]" style={{ height: `${Math.max(2, point.quality ?? 0)}%`, opacity: point.count ? .78 : .12 }} />
          <div title={`Risk ${point.risk ?? '—'}`} className="w-[22%] rounded-t bg-[var(--danger)]" style={{ height: `${Math.max(2, point.risk ?? 0)}%`, opacity: point.count ? .66 : .1 }} />
        </div>
        <div className="mt-2 truncate text-center text-[9px] text-[var(--muted-2)]">{point.label}</div>
      </div>)}</div>
      <div className="mt-4 flex flex-wrap gap-4 text-[10px] text-[var(--muted)]"><Legend label="AIQ" className="bg-[var(--brand)]"/><Legend label="Communication quality" className="bg-[var(--accent)]"/><Legend label="Risk" className="bg-[var(--danger)]"/></div>
    </div></div> : <div className="mt-5 rounded-xl bg-[var(--surface-subtle)] p-6 text-center text-sm text-[var(--muted)]">No assessment history in this period.</div>}
  </div>;
}

function Legend({ label, className }: { label: string; className: string }) { return <span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${className}`}/>{label}</span>; }

export function InsightsWorkspace() {
  const [range, setRange] = useState<RangeDays>(30);
  const [data, setData] = useState<LoadState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { selectedLabel } = useRooftopScope();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !rooftopId) { setError('Insights data source is not configured.'); setLoading(false); return; }
    const start = new Date(Date.now() - range * 86400000).toISOString();
    try {
      const [assessmentsResult, statesResult, eventsResult, actionsResult] = await Promise.all([
        supabase.from('communication_ai_assessments').select('id,rooftop_id,customer_key,assessed_at,engagement_score,purchase_intent_score,communication_quality_score,risk_score,opportunity_score,overall_score,sentiment_score,primary_intent,primary_objection,urgency').eq('rooftop_id', rooftopId).gte('assessed_at', start).order('assessed_at', { ascending: true }).limit(5000),
        supabase.from('communication_customer_state').select('rooftop_id,customer_key,customer_name,salesperson,awaiting_human_response,minutes_waiting,human_outbound_count,automated_outbound_count,last_activity_at').eq('rooftop_id', rooftopId).order('last_activity_at', { ascending: false }).limit(3000),
        supabase.from('communication_events').select('rooftop_id,customer_key,activity_at,direction,channel,actor_type,salesperson').eq('rooftop_id', rooftopId).gte('activity_at', start).order('activity_at', { ascending: true }).limit(10000),
        supabase.from('communication_action_items').select('rooftop_id,status,priority,owner_name,created_at,resolved_at').eq('rooftop_id', rooftopId).gte('created_at', start).order('created_at', { ascending: true }).limit(5000)
      ]);
      const firstError = assessmentsResult.error ?? statesResult.error ?? eventsResult.error ?? actionsResult.error;
      if (firstError) throw firstError;
      setData({ assessments: (assessmentsResult.data ?? []) as InsightAssessment[], states: (statesResult.data ?? []) as InsightState[], events: (eventsResult.data ?? []) as InsightEvent[], actions: (actionsResult.data ?? []) as ActionItem[], loadedAt: new Date() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load Insights.');
    } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => {
    if (!data) return null;
    const start = new Date(Date.now() - range * 86400000);
    const latest = latestAssessmentMap(data.assessments);
    const latestRows = [...latest.values()];
    const midpoint = new Date(Date.now() - (range / 2) * 86400000).getTime();
    const earlier = data.assessments.filter(row => new Date(row.assessed_at).getTime() < midpoint);
    const recent = data.assessments.filter(row => new Date(row.assessed_at).getTime() >= midpoint);
    const avgAIQ = average(latestRows.map(row => row.overall_score));
    const avgQuality = average(latestRows.map(row => row.communication_quality_score));
    const avgIntent = average(latestRows.map(row => row.purchase_intent_score));
    const avgRisk = average(latestRows.map(row => row.risk_score));
    const aiqDelta = average(recent.map(row => row.overall_score)) != null && average(earlier.map(row => row.overall_score)) != null ? (average(recent.map(row => row.overall_score)) as number) - (average(earlier.map(row => row.overall_score)) as number) : null;
    const qualityDelta = average(recent.map(row => row.communication_quality_score)) != null && average(earlier.map(row => row.communication_quality_score)) != null ? (average(recent.map(row => row.communication_quality_score)) as number) - (average(earlier.map(row => row.communication_quality_score)) as number) : null;
    const awaiting = data.states.filter(row => row.awaiting_human_response);
    const avgWait = awaiting.length ? Math.round(awaiting.reduce((sum, row) => sum + (row.minutes_waiting ?? 0), 0) / awaiting.length) : null;
    const humanOutbound = data.events.filter(row => row.direction === 'Outbound' && row.actor_type === 'human').length;
    const automatedOutbound = data.events.filter(row => row.direction === 'Outbound' && row.actor_type === 'automation').length;
    const totalOutbound = humanOutbound + automatedOutbound;
    const automationShare = totalOutbound ? Math.round((automatedOutbound / totalOutbound) * 100) : 0;
    const criticalRisk = latestRows.filter(row => row.urgency === 'critical' || (row.risk_score ?? 0) >= 85).length;
    const highIntent = latestRows.filter(row => (row.purchase_intent_score ?? 0) >= 80 && (row.opportunity_score ?? 0) >= 70).length;
    const resolvedActions = data.actions.filter(row => row.status === 'resolved' || Boolean(row.resolved_at)).length;
    const resolutionRate = data.actions.length ? Math.round((resolvedActions / data.actions.length) * 100) : null;
    return {
      latest,
      latestRows,
      avgAIQ,
      avgQuality,
      avgIntent,
      avgRisk,
      aiqDelta,
      qualityDelta,
      awaiting,
      avgWait,
      automationShare,
      humanOutbound,
      automatedOutbound,
      criticalRisk,
      highIntent,
      resolvedActions,
      resolutionRate,
      trend: buildTrend(data.assessments, range, start),
      objections: countBy(latestRows.map(row => row.primary_objection)),
      intents: countBy(latestRows.map(row => row.primary_intent)),
      channels: countBy(data.events.map(row => row.channel)),
      reps: buildRepRows(data.states, latest)
    };
  }, [data, range]);

  function downloadReport() {
    if (!model || !data) return;
    const rows: string[][] = [
      ['Scope', selectedLabel],
      ['Period', `Last ${range} days`],
      ['Generated', new Date().toISOString()],
      [],
      ['Executive metric', 'Value'],
      ['Average AIQ', String(model.avgAIQ ?? '')],
      ['Average communication quality', String(model.avgQuality ?? '')],
      ['Average purchase intent', String(model.avgIntent ?? '')],
      ['Average risk', String(model.avgRisk ?? '')],
      ['Customers waiting on us', String(model.awaiting.length)],
      ['Average active wait minutes', String(model.avgWait ?? '')],
      ['Automation share', `${model.automationShare}%`],
      ['Critical risk conversations', String(model.criticalRisk)],
      ['High-intent conversations', String(model.highIntent)],
      ['Action resolution rate', model.resolutionRate == null ? '' : `${model.resolutionRate}%`],
      [],
      ['Salesperson', 'Customers', 'Waiting', 'Avg wait', 'AIQ', 'Quality', 'Intent', 'Risk', 'Automation share', 'Coaching priority'],
      ...model.reps.map(rep => [rep.name, String(rep.customers), String(rep.awaiting), String(rep.avgWait ?? ''), String(rep.aiq ?? ''), String(rep.quality ?? ''), String(rep.intent ?? ''), String(rep.risk ?? ''), `${rep.automationShare}%`, String(rep.coachingPriority)])
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
    downloadText(`commsiq-insights-${range}d-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
  }

  return <div className="mx-auto w-full max-w-[1500px] px-3 pb-24 pt-3 sm:px-5 lg:px-7 lg:pb-8">
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"><SparkIcon size={15}/> Executive intelligence</div><h1 className="mt-2 text-[clamp(1.55rem,3vw,2.25rem)] font-semibold tracking-[-0.045em]">Communication Insights</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">Trend the quality of customer communication, find coaching drift, and measure where managers should intervene next.</p><div className="mt-2 text-xs text-[var(--muted-2)]">Scope: <span className="font-semibold text-[var(--text)]">{selectedLabel}</span>{data ? ` · Updated ${data.loadedAt.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}` : ''}</div></div>
        <div className="flex flex-wrap gap-2"><div className="flex rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-1">{([7,30,90] as RangeDays[]).map(days=><button key={days} onClick={()=>setRange(days)} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${range===days?'bg-white text-[var(--text)] shadow-sm':'text-[var(--muted)]'}`}>{days}D</button>)}</div><button onClick={downloadReport} disabled={!model} className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3 text-sm font-semibold disabled:opacity-40">Download CSV</button><button onClick={()=>void load()} disabled={loading} className="flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand)] px-3 text-sm font-semibold text-white disabled:opacity-50"><RefreshIcon size={16} className={loading?'animate-spin':''}/>{loading?'Loading…':'Refresh'}</button></div>
      </div>
    </section>

    {error && <div className="mt-3 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}

    {loading && !model ? <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Array.from({length:8},(_,i)=><div key={i} className="h-32 animate-pulse rounded-2xl border border-[var(--border)] bg-white"/>)}</div> : model ? <>
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="AIQ score" value={model.avgAIQ == null?'—':String(model.avgAIQ)} detail={deltaLabel(model.aiqDelta)} tone={scoreTone(model.avgAIQ)}/>
        <MetricCard label="Human communication quality" value={model.avgQuality == null?'—':String(model.avgQuality)} detail={deltaLabel(model.qualityDelta)} tone={scoreTone(model.avgQuality)}/>
        <MetricCard label="Customer waiting on us" value={String(model.awaiting.length)} detail={`Average active wait ${minutesLabel(model.avgWait)}`} tone={model.awaiting.length?'text-[var(--warning)]':'text-[var(--success)]'}/>
        <MetricCard label="Automation share" value={`${model.automationShare}%`} detail={`${model.humanOutbound} human · ${model.automatedOutbound} automated outbound`} />
        <MetricCard label="Purchase intent" value={model.avgIntent == null?'—':String(model.avgIntent)} detail={`${model.highIntent} high-intent conversations now`} tone={scoreTone(model.avgIntent)}/>
        <MetricCard label="CX risk" value={model.avgRisk == null?'—':String(model.avgRisk)} detail={`${model.criticalRisk} critical/elevated conversations`} tone={scoreTone(model.avgRisk,true)}/>
        <MetricCard label="Action resolution" value={model.resolutionRate == null?'—':`${model.resolutionRate}%`} detail={`${model.resolvedActions} of ${data?.actions.length ?? 0} actions resolved`} tone={model.resolutionRate == null?'':scoreTone(model.resolutionRate)}/>
        <MetricCard label="Assessed customers" value={String(model.latestRows.length)} detail={`${data?.assessments.length ?? 0} AI assessments in the selected period`} />
      </section>

      <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,.6fr)]">
        <TrendPanel trend={model.trend}/>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><DistributionList title="Top objections" subtitle="Latest AI-classified primary objection by customer." rows={model.objections}/><DistributionList title="Buying intent themes" subtitle="What customers are trying to accomplish." rows={model.intents}/></div>
      </section>

      <section className="mt-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
        <div className="flex flex-col gap-2 border-b border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><div className="flex items-center gap-2 text-sm font-semibold"><UsersIcon size={17}/> Salesperson coaching movement</div><div className="mt-1 text-xs text-[var(--muted)]">Current customer load scored against the latest assessment available in this reporting window.</div></div><div className="text-xs text-[var(--muted)]">Highest coaching priority first</div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[860px] border-collapse text-left text-xs"><thead><tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[10px] uppercase tracking-[.08em] text-[var(--muted)]"><th className="px-4 py-3">Salesperson</th><th className="px-3 py-3">Customers</th><th className="px-3 py-3">Waiting</th><th className="px-3 py-3">Avg wait</th><th className="px-3 py-3">AIQ</th><th className="px-3 py-3">Quality</th><th className="px-3 py-3">Intent</th><th className="px-3 py-3">Risk</th><th className="px-3 py-3">Automation</th></tr></thead><tbody>{model.reps.slice(0,20).map(rep=><tr key={rep.name} className="border-b border-[var(--border)] last:border-b-0"><td className="px-4 py-3"><div className="font-semibold">{rep.name}</div><div className="mt-0.5 text-[10px] text-[var(--muted)]">Priority {rep.coachingPriority}</div></td><td className="px-3 py-3">{rep.customers}</td><td className={`px-3 py-3 font-semibold ${rep.awaiting?'text-[var(--warning)]':''}`}>{rep.awaiting}</td><td className="px-3 py-3">{minutesLabel(rep.avgWait)}</td><td className={`px-3 py-3 font-semibold ${scoreTone(rep.aiq)}`}>{rep.aiq ?? '—'}</td><td className={`px-3 py-3 font-semibold ${scoreTone(rep.quality)}`}>{rep.quality ?? '—'}</td><td className="px-3 py-3">{rep.intent ?? '—'}</td><td className={`px-3 py-3 ${scoreTone(rep.risk,true)}`}>{rep.risk ?? '—'}</td><td className="px-3 py-3">{rep.automationShare}%</td></tr>)}</tbody></table></div>
      </section>

      <section className="mt-3 grid gap-3 md:grid-cols-2"><DistributionList title="Channel mix" subtitle="Communication volume across the selected reporting window." rows={model.channels}/><div className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5"><div className="flex items-center gap-2 text-sm font-semibold"><ClockIcon size={17}/> Manager read</div><div className="mt-4 space-y-3 text-sm leading-6"><InsightCallout title="Where to coach" value={model.reps[0] ? `${model.reps[0].name} currently has the highest coaching priority (${model.reps[0].coachingPriority}).` : 'No salesperson coaching signal is available yet.'}/><InsightCallout title="Where to intervene" value={model.awaiting.length ? `${model.awaiting.length} customers are currently waiting on a human response; average wait is ${minutesLabel(model.avgWait)}.` : 'No customers are currently flagged as waiting on a human response.'}/><InsightCallout title="Where opportunity sits" value={model.highIntent ? `${model.highIntent} customers currently combine high purchase intent with strong opportunity scores.` : 'No customers currently meet the high-intent opportunity threshold.'}/></div></div></section>
    </> : null}
  </div>;
}

function InsightCallout({title,value}:{title:string;value:string}) { return <div className="rounded-xl bg-[var(--surface-subtle)] p-3"><div className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--muted-2)]">{title}</div><div className="mt-1 text-sm font-medium leading-6">{value}</div></div>; }
