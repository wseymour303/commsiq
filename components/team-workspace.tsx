'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import type { Assessment, CommunicationEvent, CustomerState } from '@/lib/types';
import { ArrowIcon, CheckIcon, ClockIcon, RefreshIcon, SparkIcon, UsersIcon } from './icons';

const rooftopId = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID;

type TeamSort = 'attention' | 'quality' | 'waiting' | 'risk' | 'opportunity';

type RepConversation = {
  customer: CustomerState;
  assessment?: Assessment;
  events: CommunicationEvent[];
};

type RepSummary = {
  name: string;
  conversations: RepConversation[];
  conversationCount: number;
  awaitingCount: number;
  highRiskCount: number;
  highIntentCount: number;
  avgWait: number | null;
  avgQuality: number | null;
  avgRisk: number | null;
  avgIntent: number | null;
  avgOpportunity: number | null;
  avgAIQ: number | null;
  humanOutbound: number;
  automatedOutbound: number;
  automationShare: number;
  coachingScore: number;
};

function average(values: Array<number | null | undefined>) {
  const clean = values.filter((value): value is number => typeof value === 'number');
  return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : null;
}

function mins(value: number | null) {
  if (value == null) return '—';
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function relativeTime(value: string | null) {
  if (!value) return 'Unknown';
  const deltaMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  if (deltaMinutes < 1440) return `${Math.floor(deltaMinutes / 60)}h ago`;
  return `${Math.floor(deltaMinutes / 1440)}d ago`;
}

function tone(value: number | null, inverse = false) {
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

function buildRepSummaries(states: CustomerState[], assessments: Map<string, Assessment>, eventsByKey: Map<string, CommunicationEvent[]>) {
  const grouped = new Map<string, RepConversation[]>();
  for (const customer of states) {
    const rep = customer.salesperson?.trim() || 'Unassigned';
    const list = grouped.get(rep) ?? [];
    list.push({ customer, assessment: assessments.get(customer.customer_key), events: eventsByKey.get(customer.customer_key) ?? [] });
    grouped.set(rep, list);
  }

  return [...grouped.entries()].map(([name, conversations]): RepSummary => {
    const awaiting = conversations.filter(item => item.customer.awaiting_human_response);
    const highRisk = conversations.filter(item => (item.assessment?.risk_score ?? 0) >= 65);
    const highIntent = conversations.filter(item => (item.assessment?.purchase_intent_score ?? 0) >= 75);
    const allEvents = conversations.flatMap(item => item.events);
    const humanOutbound = allEvents.filter(event => event.direction === 'Outbound' && event.actor_type === 'human').length;
    const automatedOutbound = allEvents.filter(event => event.direction === 'Outbound' && event.actor_type === 'automation').length;
    const totalOutbound = humanOutbound + automatedOutbound;
    const avgQuality = average(conversations.map(item => item.assessment?.communication_quality_score));
    const avgRisk = average(conversations.map(item => item.assessment?.risk_score));
    const avgIntent = average(conversations.map(item => item.assessment?.purchase_intent_score));
    const avgOpportunity = average(conversations.map(item => item.assessment?.opportunity_score));
    const avgAIQ = average(conversations.map(item => item.assessment?.overall_score));
    const avgWait = awaiting.length ? Math.round(awaiting.reduce((sum, item) => sum + (item.customer.minutes_waiting ?? 0), 0) / awaiting.length) : null;
    const automationShare = totalOutbound ? Math.round((automatedOutbound / totalOutbound) * 100) : 0;
    const coachingScore = Math.round(
      awaiting.length * 12 +
      highRisk.length * 9 +
      Math.max(0, 65 - (avgQuality ?? 65)) * 0.7 +
      Math.max(0, automationShare - 60) * 0.25 +
      highIntent.filter(item => item.customer.awaiting_human_response).length * 10
    );
    return {
      name,
      conversations: [...conversations].sort((a, b) => (b.assessment?.overall_score ?? 0) - (a.assessment?.overall_score ?? 0)),
      conversationCount: conversations.length,
      awaitingCount: awaiting.length,
      highRiskCount: highRisk.length,
      highIntentCount: highIntent.length,
      avgWait,
      avgQuality,
      avgRisk,
      avgIntent,
      avgOpportunity,
      avgAIQ,
      humanOutbound,
      automatedOutbound,
      automationShare,
      coachingScore
    };
  });
}

export function TeamWorkspace() {
  const [reps, setReps] = useState<RepSummary[]>([]);
  const [selectedRep, setSelectedRep] = useState('');
  const [sort, setSort] = useState<TeamSort>('attention');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !rooftopId) return;
    setLoading(true); setError(null);
    try {
      const { data: states, error: stateError } = await supabase.from('communication_customer_state').select('*').eq('rooftop_id', rooftopId).order('last_activity_at', { ascending: false }).limit(150);
      if (stateError) throw stateError;
      const customerStates = (states ?? []) as CustomerState[];
      if (!customerStates.length) { setReps([]); return; }

      const keys = customerStates.map(state => state.customer_key);
      const [{ data: assessmentRows, error: assessmentError }, { data: eventRows, error: eventError }] = await Promise.all([
        supabase.from('communication_ai_assessments').select('*').eq('rooftop_id', rooftopId).in('customer_key', keys).order('assessed_at', { ascending: false }),
        supabase.from('communication_events').select('id,customer_key,customer_name,salesperson,activity_at,direction,channel,communication_type,message_clean,actor_type').eq('rooftop_id', rooftopId).in('customer_key', keys).order('activity_at', { ascending: false }).limit(1200)
      ]);
      if (assessmentError) throw assessmentError;
      if (eventError) throw eventError;

      const latest = new Map<string, Assessment>();
      for (const assessment of (assessmentRows ?? []) as Assessment[]) if (!latest.has(assessment.customer_key)) latest.set(assessment.customer_key, assessment);
      const eventsByKey = new Map<string, CommunicationEvent[]>();
      for (const event of (eventRows ?? []) as CommunicationEvent[]) {
        if (!event.customer_key) continue;
        const list = eventsByKey.get(event.customer_key) ?? [];
        if (list.length < 20) list.push(event);
        eventsByKey.set(event.customer_key, list);
      }

      const summaries = buildRepSummaries(customerStates, latest, eventsByKey).filter(rep => rep.name !== 'Ava Virtual Assistant');
      setReps(summaries);
      setSelectedRep(current => current && summaries.some(rep => rep.name === current) ? current : summaries[0]?.name ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load team intelligence.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => [...reps].sort((a, b) => {
    if (sort === 'quality') return (b.avgQuality ?? -1) - (a.avgQuality ?? -1);
    if (sort === 'waiting') return b.awaitingCount - a.awaitingCount || (b.avgWait ?? 0) - (a.avgWait ?? 0);
    if (sort === 'risk') return (b.avgRisk ?? 0) - (a.avgRisk ?? 0);
    if (sort === 'opportunity') return (b.avgOpportunity ?? 0) - (a.avgOpportunity ?? 0);
    return b.coachingScore - a.coachingScore;
  }), [reps, sort]);

  const selected = reps.find(rep => rep.name === selectedRep) ?? sorted[0];
  const totalAwaiting = reps.reduce((sum, rep) => sum + rep.awaitingCount, 0);
  const avgTeamQuality = average(reps.map(rep => rep.avgQuality));
  const totalHighRisk = reps.reduce((sum, rep) => sum + rep.highRiskCount, 0);
  const avgAutomation = average(reps.map(rep => rep.automationShare));

  return <div className="mx-auto w-full max-w-[1500px] px-3 pb-24 pt-3 sm:px-5 lg:px-7 lg:pb-8">
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"><UsersIcon size={15}/> Live team intelligence</div><h1 className="mt-2 text-[clamp(1.55rem,3vw,2.25rem)] font-semibold tracking-[-0.045em]">Who needs coaching — and why</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">CommunicationIQ rolls customer-level intelligence up to the salesperson so managers can spot response gaps, quality issues, risk exposure, and opportunities that need help.</p></div>
        <button onClick={() => void load()} disabled={loading} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 text-sm font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"><RefreshIcon size={16} className={loading ? 'animate-spin' : ''}/> Refresh</button>
      </div>
      {error && <div className="mt-3 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}
      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-4"><Metric label="Salespeople" value={String(reps.length)} detail="With active conversations"/><Metric label="Awaiting human" value={String(totalAwaiting)} detail="Open inbound responses"/><Metric label="Team quality" value={avgTeamQuality == null ? '—' : String(avgTeamQuality)} detail="Average human communication"/><Metric label="CX risk" value={String(totalHighRisk)} detail={`Automation avg ${avgAutomation ?? 0}%`}/></div>
    </section>

    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-white p-3"><span className="mr-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Sort team</span>{([['attention','Coaching priority'],['quality','Best quality'],['waiting','Waiting'],['risk','Risk'],['opportunity','Opportunity']] as Array<[TeamSort,string]>).map(([id,label]) => <button key={id} onClick={() => setSort(id)} className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${sort === id ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'}`}>{label}</button>)}</div>

    <section className="mt-3 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,.9fr)_minmax(420px,1.1fr)]">
      <div className="space-y-2.5">{!loading && sorted.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-white p-9 text-center"><CheckIcon className="mx-auto text-[var(--success)]"/><div className="mt-3 font-semibold">No team activity yet</div></div>}{sorted.map((rep, index) => <RepCard key={rep.name} rep={rep} rank={index + 1} selected={selected?.name === rep.name} onSelect={() => setSelectedRep(rep.name)}/>)}</div>
      {selected && <RepDetail rep={selected}/>} 
    </section>
  </div>;
}

function Metric({ label, value, detail }: { label:string; value:string; detail:string }) { return <div><div className="text-xs font-medium text-[var(--muted)]">{label}</div><div className="mt-1 text-2xl font-semibold tracking-[-0.04em] tabular-nums">{value}</div><div className="mt-0.5 text-[11px] text-[var(--muted-2)]">{detail}</div></div>; }

function RepCard({ rep, rank, selected, onSelect }: { rep:RepSummary; rank:number; selected:boolean; onSelect:()=>void }) {
  return <button onClick={onSelect} className={`w-full rounded-2xl border bg-white p-4 text-left transition hover:border-[var(--border-strong)] hover:shadow-sm ${selected ? 'border-[var(--brand)] ring-1 ring-[var(--brand)]/10' : 'border-[var(--border)]'}`}>
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-2)]">#{rank} coaching queue</div><div className="mt-1 truncate text-base font-semibold">{rep.name}</div><div className="mt-1 text-xs text-[var(--muted)]">{rep.conversationCount} conversations · {rep.awaitingCount} waiting · {rep.highRiskCount} CX risk</div></div><div className="shrink-0 text-right"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-2)]">Quality</div><div className={`text-xl font-semibold tabular-nums ${tone(rep.avgQuality)}`}>{rep.avgQuality ?? '—'}</div></div></div>
    <div className="mt-3 grid grid-cols-4 gap-2 text-center"><Mini label="Wait" value={String(rep.awaitingCount)}/><Mini label="Intent" value={rep.avgIntent == null ? '—' : String(rep.avgIntent)}/><Mini label="Risk" value={rep.avgRisk == null ? '—' : String(rep.avgRisk)}/><Mini label="Auto" value={`${rep.automationShare}%`}/></div>
    <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--surface-subtle)] px-3 py-2 text-xs"><span className="font-medium">{rep.coachingScore >= 35 ? 'Manager review recommended' : rep.coachingScore >= 18 ? 'Watchlist' : 'Healthy communication pattern'}</span><ArrowIcon size={15} className="text-[var(--muted)]"/></div>
  </button>;
}

function Mini({ label, value }: { label:string; value:string }) { return <div className="rounded-lg border border-[var(--border)] bg-white px-2 py-2"><div className="text-[9px] uppercase tracking-wide text-[var(--muted-2)]">{label}</div><div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div></div>; }

function RepDetail({ rep }: { rep:RepSummary }) {
  const coachingNotes = [
    rep.awaitingCount > 0 ? `${rep.awaitingCount} customer${rep.awaitingCount === 1 ? '' : 's'} currently awaiting a human response${rep.avgWait != null ? ` (avg ${mins(rep.avgWait)})` : ''}.` : null,
    rep.avgQuality != null && rep.avgQuality < 60 ? `Human communication quality is averaging ${rep.avgQuality}; review CTA clarity, completeness, and ownership.` : null,
    rep.highRiskCount > 0 ? `${rep.highRiskCount} conversation${rep.highRiskCount === 1 ? '' : 's'} carry elevated customer-experience risk.` : null,
    rep.automationShare >= 70 ? `${rep.automationShare}% of loaded outbound activity is automated; check whether human follow-up is entering early enough.` : null,
    rep.highIntentCount > 0 ? `${rep.highIntentCount} customer${rep.highIntentCount === 1 ? '' : 's'} show strong purchase intent.` : null
  ].filter(Boolean) as string[];

  return <aside className="min-w-0 self-start rounded-2xl border border-[var(--border)] bg-white xl:sticky xl:top-[84px]">
    <div className="border-b border-[var(--border)] p-4 sm:p-5"><div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-2)]">Salesperson intelligence</div><h2 className="mt-1 text-2xl font-semibold tracking-[-0.035em]">{rep.name}</h2><div className="mt-1 text-xs text-[var(--muted)]">{rep.conversationCount} active customer conversations</div></div>
    <div className="p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Score label="Human quality" value={rep.avgQuality}/><Score label="AIQ" value={rep.avgAIQ}/><Score label="Intent" value={rep.avgIntent}/><Score label="Opportunity" value={rep.avgOpportunity}/><Score label="Risk" value={rep.avgRisk} inverse/><Score label="Automation" value={rep.automationShare} suffix="%" inverse={rep.automationShare >= 75}/></div>
      <div className="mt-4 rounded-2xl bg-[var(--surface-subtle)] p-4"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]"><SparkIcon size={15}/> Manager coaching read</div>{coachingNotes.length ? <ul className="mt-2 space-y-2 text-sm leading-5.5 text-[var(--text)]">{coachingNotes.map(note => <li key={note} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"/><span>{note}</span></li>)}</ul> : <p className="mt-2 text-sm text-[var(--text)]">No major coaching flags are visible in the current communication set.</p>}</div>
      <div className="mt-5"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Conversations to review</h3><span className="text-[11px] text-[var(--muted)]">Highest AIQ first</span></div><div className="mt-2 space-y-2">{rep.conversations.slice(0, 12).map(item => <ConversationRow key={item.customer.customer_key} item={item}/>)}</div></div>
    </div>
  </aside>;
}

function Score({ label, value, suffix = '', inverse = false }: { label:string; value:number|null; suffix?:string; inverse?:boolean }) { return <div className="rounded-xl border border-[var(--border)] p-3"><div className="text-[10px] text-[var(--muted)]">{label}</div><div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone(value, inverse)}`}>{value ?? '—'}{value != null ? suffix : ''}</div></div>; }

function ConversationRow({ item }: { item:RepConversation }) {
  const { customer, assessment } = item;
  return <div className="rounded-xl border border-[var(--border)] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{customer.customer_name}</div><div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">{customer.lead_status && <span>{customer.lead_status}</span>}<span>{relativeTime(customer.last_activity_at)}</span>{customer.awaiting_human_response && <span className="font-semibold text-[var(--danger)]">Waiting {mins(customer.minutes_waiting)}</span>}</div></div><div className="shrink-0 text-right"><div className="text-[9px] uppercase text-[var(--muted-2)]">AIQ</div><div className="font-semibold tabular-nums">{assessment?.overall_score ?? '—'}</div></div></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text)]">{assessment?.summary ?? 'Assessment pending.'}</p>{assessment?.recommended_next_action && <div className="mt-2 flex items-start gap-1.5 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]"><ClockIcon size={13} className="mt-0.5 shrink-0"/><span className="line-clamp-2">{assessment.recommended_next_action}</span></div>}</div>;
}
