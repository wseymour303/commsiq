'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { toRadarItem } from '@/lib/radar';
import type { Assessment, CommunicationEvent, CustomerState, RadarFilter, RadarItem } from '@/lib/types';
import { ArrowIcon, CheckIcon, ClockIcon, RefreshIcon, SparkIcon } from './icons';

const rooftopId = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID;

const filters: { id: RadarFilter; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'buying', label: 'Buying now' },
  { id: 'waiting', label: 'Waiting on us' },
  { id: 'risk', label: 'At risk' },
  { id: 'future', label: 'Future' },
  { id: 'advocate', label: 'Advocates' }
];

const fallbackItems: RadarItem[] = [
  {
    customer: { id:'demo-1', rooftop_id:'demo', customer_key:'demo-1', customer_name:'Active buyer', salesperson:'Aaron Bergen', lead_status:'Working', lead_source:'Internet', first_activity_at:null, last_activity_at:new Date().toISOString(), last_inbound_at:new Date().toISOString(), last_outbound_at:null, last_human_outbound_at:null, inbound_count:2, outbound_count:2, automated_outbound_count:1, human_outbound_count:1, awaiting_human_response:true, minutes_waiting:18 },
    assessment: { id:'a1', customer_key:'demo-1', assessed_at:new Date().toISOString(), sentiment_score:12, sentiment_label:'Constructive', engagement_score:88, purchase_intent_score:94, communication_quality_score:76, risk_score:63, opportunity_score:94, overall_score:82, lifecycle_stage:'Negotiation', primary_intent:'Purchase', primary_objection:'Price', urgency:'high', summary:'Customer reaffirmed a firm out-the-door target and indicated willingness to visit if the deal can be made.', rationale:'High purchase intent with one explicit objection.', recommended_next_action:'Respond now using One Price positioning and convert the price discussion into a test drive or in-store appointment.', recommended_owner:'Salesperson', recommended_due_at:null },
    events: [], category:'waiting', priority:'high'
  },
  {
    customer: { id:'demo-2', rooftop_id:'demo', customer_key:'demo-2', customer_name:'Ownership follow-up', salesperson:'Aaron Bergen', lead_status:'Delivered', lead_source:'Digital Retail', first_activity_at:null, last_activity_at:new Date().toISOString(), last_inbound_at:new Date().toISOString(), last_outbound_at:new Date().toISOString(), last_human_outbound_at:new Date().toISOString(), inbound_count:1, outbound_count:1, automated_outbound_count:0, human_outbound_count:1, awaiting_human_response:false, minutes_waiting:null },
    assessment: { id:'a2', customer_key:'demo-2', assessed_at:new Date().toISOString(), sentiment_score:5, sentiment_label:'Neutral', engagement_score:66, purchase_intent_score:10, communication_quality_score:78, risk_score:61, opportunity_score:42, overall_score:71, lifecycle_stage:'Post-sale', primary_intent:'Parts status', primary_objection:null, urgency:'medium', summary:'Customer asked for the status of accessories and was promised a Monday parts check.', rationale:'A promised follow-up should be closed before the customer needs to ask again.', recommended_next_action:'Verify parts status first thing Monday and proactively update the customer.', recommended_owner:'Salesperson', recommended_due_at:null },
    events: [], category:'attention', priority:'medium'
  },
  {
    customer: { id:'demo-3', rooftop_id:'demo', customer_key:'demo-3', customer_name:'Future shopper', salesperson:'Assigned rep', lead_status:'Working', lead_source:'Internet', first_activity_at:null, last_activity_at:new Date().toISOString(), last_inbound_at:new Date().toISOString(), last_outbound_at:new Date().toISOString(), last_human_outbound_at:null, inbound_count:1, outbound_count:2, automated_outbound_count:2, human_outbound_count:0, awaiting_human_response:false, minutes_waiting:null },
    assessment: { id:'a3', customer_key:'demo-3', assessed_at:new Date().toISOString(), sentiment_score:0, sentiment_label:'Neutral', engagement_score:32, purchase_intent_score:35, communication_quality_score:62, risk_score:24, opportunity_score:38, overall_score:60, lifecycle_stage:'Future follow-up', primary_intent:'Shop later', primary_objection:'Timing', urgency:'low', summary:'Customer explicitly said they will not have time to shop until after September 26.', rationale:'Additional outreach before the stated date risks over-contact.', recommended_next_action:'Pause unnecessary automation and surface a salesperson follow-up for September 27.', recommended_owner:'Assigned salesperson', recommended_due_at:null },
    events: [], category:'future', priority:'low'
  }
];

function mins(value: number | null) {
  if (value == null) return '—';
  if (value < 60) return `${value}m`;
  const h = Math.floor(value / 60); const m = value % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function scoreTone(score: number | null | undefined) {
  const s = score ?? 0;
  if (s >= 75) return 'text-[var(--success)]';
  if (s >= 50) return 'text-[var(--warning)]';
  return 'text-[var(--danger)]';
}

function priorityClass(priority: RadarItem['priority']) {
  if (priority === 'critical') return 'border-l-[var(--danger)] bg-[var(--danger-soft)]/55';
  if (priority === 'high') return 'border-l-[var(--warning)] bg-[var(--warning-soft)]/55';
  if (priority === 'medium') return 'border-l-[var(--accent)] bg-white';
  return 'border-l-[var(--border-strong)] bg-white';
}

export function ManagerRadar() {
  const [items, setItems] = useState<RadarItem[]>(fallbackItems);
  const [filter, setFilter] = useState<RadarFilter>('attention');
  const [selectedKey, setSelectedKey] = useState(fallbackItems[0].customer.customer_key);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !rooftopId) { setLive(false); return; }
    setLoading(true); setError(null);
    try {
      const { data: states, error: stateError } = await supabase
        .from('communication_customer_state').select('*').eq('rooftop_id', rooftopId).order('last_activity_at', { ascending: false }).limit(75);
      if (stateError) throw stateError;
      if (!states?.length) { setLive(false); return; }

      const keys = states.map((s: CustomerState) => s.customer_key);
      const { data: assessments } = await supabase.from('communication_ai_assessments').select('*').eq('rooftop_id', rooftopId).in('customer_key', keys).order('assessed_at', { ascending: false });
      const latest = new Map<string, Assessment>();
      for (const a of (assessments ?? []) as Assessment[]) if (!latest.has(a.customer_key)) latest.set(a.customer_key, a);

      const { data: eventRows } = await supabase.from('communication_events').select('id,customer_key,customer_name,salesperson,activity_at,direction,channel,communication_type,message_clean,actor_type').eq('rooftop_id', rooftopId).in('customer_key', keys).order('activity_at', { ascending: false }).limit(400);
      const eventsByKey = new Map<string, CommunicationEvent[]>();
      for (const e of (eventRows ?? []) as CommunicationEvent[]) {
        if (!e.customer_key) continue;
        const list = eventsByKey.get(e.customer_key) ?? [];
        if (list.length < 8) list.push(e);
        eventsByKey.set(e.customer_key, list);
      }

      const next = (states as CustomerState[]).map(s => toRadarItem(s, latest.get(s.customer_key), eventsByKey.get(s.customer_key) ?? []));
      setItems(next); setSelectedKey(next[0]?.customer.customer_key ?? ''); setLive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load live CommunicationIQ data.');
      setLive(false);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => Object.fromEntries(filters.map(f => [f.id, items.filter(i => i.category === f.id || (f.id === 'attention' && i.priority !== 'low')).length])), [items]);
  const filtered = useMemo(() => filter === 'attention' ? items.filter(i => i.priority !== 'low') : items.filter(i => i.category === filter), [filter, items]);
  const selected = items.find(i => i.customer.customer_key === selectedKey) ?? filtered[0] ?? items[0];
  const totalOutbound = items.reduce((n,i)=>n+i.customer.outbound_count,0);
  const autoOutbound = items.reduce((n,i)=>n+i.customer.automated_outbound_count,0);
  const automationShare = totalOutbound ? Math.round(autoOutbound / totalOutbound * 100) : 0;
  const waiting = items.filter(i=>i.customer.awaiting_human_response);
  const avgWait = waiting.length ? Math.round(waiting.reduce((n,i)=>n+(i.customer.minutes_waiting ?? 0),0)/waiting.length) : null;

  return (
    <div className="mx-auto w-full max-w-[1480px] px-3 pb-24 pt-3 sm:px-5 lg:px-7 lg:pb-8">
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted)]"><span className={`h-2 w-2 rounded-full ${live ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} /> {live ? 'Live intelligence' : 'Preview mode'}</div>
            <h1 className="mt-2 text-[clamp(1.45rem,3vw,2.1rem)] font-semibold tracking-[-0.04em]">What needs attention</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">Prioritized customer communications, manager risk signals, and the next best action.</p>
          </div>
          <button onClick={()=>void load()} disabled={loading} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 text-sm font-medium transition hover:bg-[var(--surface-subtle)] disabled:opacity-50"><RefreshIcon size={16} className={loading ? 'animate-spin' : ''}/><span className="hidden sm:inline">Refresh</span></button>
        </div>
        {error && <div className="mt-3 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}

        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-[var(--border)] pt-4 md:grid-cols-4">
          <Metric label="Needs attention" value={String(items.filter(i=>i.priority==='critical'||i.priority==='high').length)} detail="High priority" />
          <Metric label="Customer waiting" value={String(waiting.length)} detail={avgWait == null ? 'No open waits' : `Avg ${mins(avgWait)}`} />
          <Metric label="Human response" value={avgWait == null ? '—' : mins(avgWait)} detail="Open inbound queue" />
          <Metric label="Automation share" value={`${automationShare}%`} detail={`${autoOutbound} automated outbound`} />
        </div>
      </section>

      <div className="no-scrollbar -mx-3 mt-3 flex gap-2 overflow-x-auto px-3 sm:-mx-5 sm:px-5 lg:mx-0 lg:px-0">
        {filters.map(f => <button key={f.id} onClick={()=>setFilter(f.id)} className={`min-h-11 shrink-0 rounded-full border px-3.5 text-sm font-medium transition ${filter===f.id ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'}`}>{f.label}<span className={`ml-2 text-xs ${filter===f.id?'text-white/65':'text-[var(--muted-2)]'}`}>{counts[f.id] ?? 0}</span></button>)}
      </div>

      <section className="mt-3 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,.8fr)]">
        <div className="min-w-0 space-y-2.5">
          {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-white p-8 text-center"><CheckIcon className="mx-auto text-[var(--success)]"/><div className="mt-3 font-semibold">Nothing in this queue</div><p className="mt-1 text-sm text-[var(--muted)]">No current conversations match this filter.</p></div>}
          {filtered.map(item => <RadarCard key={item.customer.customer_key} item={item} active={selected?.customer.customer_key===item.customer.customer_key} onSelect={()=>setSelectedKey(item.customer.customer_key)} />)}
        </div>
        {selected && <IntelligencePanel item={selected} />}
      </section>
    </div>
  );
}

function Metric({ label, value, detail }: { label:string; value:string; detail:string }) {
  return <div className="min-w-0"><div className="text-xs font-medium text-[var(--muted)]">{label}</div><div className="mt-1 text-2xl font-semibold tracking-[-0.04em] tabular-nums">{value}</div><div className="mt-0.5 truncate text-[11px] text-[var(--muted-2)]">{detail}</div></div>;
}

function RadarCard({ item, active, onSelect }: { item:RadarItem; active:boolean; onSelect:()=>void }) {
  const a=item.assessment; const c=item.customer;
  return <button onClick={onSelect} className={`w-full rounded-2xl border border-l-[3px] border-[var(--border)] p-4 text-left transition hover:border-[var(--border-strong)] ${priorityClass(item.priority)} ${active ? 'ring-1 ring-[var(--brand)]/20' : ''}`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{item.priority} priority</span>{a?.primary_objection && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">{a.primary_objection}</span>}</div><div className="mt-1 truncate text-[15px] font-semibold tracking-[-0.015em]">{c.customer_name}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]"><span>{c.salesperson ?? 'Unassigned'}</span>{c.lead_status && <span>{c.lead_status}</span>}{c.lead_source && <span>{c.lead_source}</span>}</div></div>
      <div className="shrink-0 text-right"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-2)]">Opportunity</div><div className={`mt-0.5 text-xl font-semibold tabular-nums ${scoreTone(a?.opportunity_score)}`}>{a?.opportunity_score ?? '—'}</div></div>
    </div>
    <p className="mt-3 line-clamp-2 text-sm leading-5.5 text-[#34383f]">{a?.summary ?? (c.awaiting_human_response ? `Customer has been waiting ${mins(c.minutes_waiting)} for a human response.` : 'Conversation is active and ready for manager review.')}</p>
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-white/75 p-3"><div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]"><SparkIcon size={13}/> What should happen next</div><p className="mt-1 text-sm font-medium leading-5.5">{a?.recommended_next_action ?? 'Review the latest customer message and establish a clear next step.'}</p></div>
    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[var(--muted)]"><div className="flex items-center gap-1.5"><ClockIcon size={14}/>{c.awaiting_human_response ? `Waiting ${mins(c.minutes_waiting)}` : 'No unanswered inbound'}</div><span className="flex items-center gap-1 font-medium text-[var(--text)]">Review <ArrowIcon size={14}/></span></div>
  </button>;
}

function IntelligencePanel({ item }: { item:RadarItem }) {
  const a=item.assessment; const c=item.customer; const scores=[['Purchase intent',a?.purchase_intent_score],['Engagement',a?.engagement_score],['Communication quality',a?.communication_quality_score],['Risk',a?.risk_score]] as const;
  return <aside className="min-w-0 rounded-2xl border border-[var(--border)] bg-white p-4 xl:sticky xl:top-[74px] sm:p-5">
    <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Conversation intelligence</div><h2 className="mt-1 truncate text-lg font-semibold tracking-[-0.025em]">{c.customer_name}</h2><div className="mt-1 text-xs text-[var(--muted)]">{c.salesperson ?? 'Unassigned'} · {a?.lifecycle_stage ?? c.lead_status ?? 'Active'}</div></div><div className="shrink-0 text-right"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-2)]">CommunicationIQ</div><div className="mt-0.5 text-3xl font-semibold tracking-[-0.05em] tabular-nums">{a?.overall_score ?? '—'}</div></div></div>
    <div className="mt-5 space-y-3.5">{scores.map(([label,score])=><div key={label}><div className="flex justify-between text-xs"><span className="font-medium">{label}</span><span className="tabular-nums text-[var(--muted)]">{score ?? '—'}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]"><div className="h-full rounded-full bg-[var(--brand)] transition-[width]" style={{width:`${Math.max(0,Math.min(100,score??0))}%`}}/></div></div>)}</div>
    <div className="mt-5 border-t border-[var(--border)] pt-4"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">AI read</div><p className="mt-2 text-sm leading-6 text-[#34383f]">{a?.rationale ?? a?.summary ?? 'AI assessment will appear here as soon as this conversation has been scored.'}</p></div>
    <div className="mt-5 border-t border-[var(--border)] pt-4"><div className="flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Recent activity</div><div className="text-[10px] text-[var(--muted-2)]">{item.events.length} events</div></div><div className="mt-3 space-y-4">{item.events.length ? item.events.slice(0,5).map(e=><div key={e.id} className="grid grid-cols-[10px_minmax(0,1fr)] gap-3"><div className={`mt-1.5 h-2.5 w-2.5 rounded-full ${e.actor_type==='customer'?'bg-[var(--accent)]':e.actor_type==='human'?'bg-[var(--success)]':'bg-[var(--violet)]'}`}/><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium">{e.actor_type==='customer'?'Customer inbound':e.actor_type==='human'?'Human outbound':'Automated outbound'}</span><span className="text-[var(--muted-2)]">{e.channel}</span></div><p className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--muted)]">{e.message_clean ?? e.communication_type ?? 'Activity logged'}</p></div></div>) : <p className="text-sm text-[var(--muted)]">No event detail loaded for this preview conversation.</p>}</div></div>
  </aside>;
}
