'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { toRadarItem } from '@/lib/radar';
import type { Assessment, CommunicationEvent, CustomerState, RadarItem } from '@/lib/types';
import { ArrowIcon, ClockIcon, RefreshIcon, SparkIcon } from './icons';

const rooftopId = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID;
type SortKey = 'recent' | 'aiq' | 'risk' | 'intent' | 'waiting';

function relativeTime(value: string | null) {
  if (!value) return 'Unknown';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function mins(value: number | null) {
  if (value == null) return '—';
  if (value < 60) return `${value}m`;
  const h = Math.floor(value / 60); const m = value % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function dueLabel(value: string | null | undefined) {
  if (!value) return 'No deadline set';
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return 'Due now';
  if (minutes < 60) return `Due in ${minutes}m`;
  if (minutes < 1440) return `Due in ${Math.ceil(minutes / 60)}h`;
  return `Due ${new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function scoreTone(value: number | null | undefined, inverse = false) {
  const score = value ?? 0;
  if (inverse) return score >= 70 ? 'text-[var(--danger)]' : score >= 45 ? 'text-[var(--warning)]' : 'text-[var(--success)]';
  return score >= 75 ? 'text-[var(--success)]' : score >= 50 ? 'text-[var(--warning)]' : 'text-[var(--danger)]';
}

export function ConversationsWorkspace() {
  const [items, setItems] = useState<RadarItem[]>([]);
  const [query, setQuery] = useState('');
  const [salesperson, setSalesperson] = useState('all');
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !rooftopId) return;
    setLoading(true); setError(null);
    try {
      const { data: states, error: stateError } = await supabase.from('communication_customer_state').select('*').eq('rooftop_id', rooftopId).order('last_activity_at', { ascending: false }).limit(250);
      if (stateError) throw stateError;
      const customerStates = (states ?? []) as CustomerState[];
      if (!customerStates.length) { setItems([]); return; }
      const keys = customerStates.map(row => row.customer_key);
      const [{ data: assessments, error: assessmentError }, { data: events, error: eventError }] = await Promise.all([
        supabase.from('communication_ai_assessments').select('*').eq('rooftop_id', rooftopId).in('customer_key', keys).order('assessed_at', { ascending: false }),
        supabase.from('communication_events').select('id,customer_key,customer_name,salesperson,activity_at,direction,channel,communication_type,message_clean,actor_type').eq('rooftop_id', rooftopId).in('customer_key', keys).order('activity_at', { ascending: false }).limit(1500)
      ]);
      if (assessmentError) throw assessmentError;
      if (eventError) throw eventError;
      const latest = new Map<string, Assessment>();
      for (const a of (assessments ?? []) as Assessment[]) if (!latest.has(a.customer_key)) latest.set(a.customer_key, a);
      const byKey = new Map<string, CommunicationEvent[]>();
      for (const event of (events ?? []) as CommunicationEvent[]) {
        if (!event.customer_key) continue;
        const list = byKey.get(event.customer_key) ?? [];
        if (list.length < 20) list.push(event);
        byKey.set(event.customer_key, list);
      }
      setItems(customerStates.map(state => toRadarItem(state, latest.get(state.customer_key), byKey.get(state.customer_key) ?? [])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load conversations.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const salespeople = useMemo(() => [...new Set(items.map(i => i.customer.salesperson).filter(Boolean) as string[])].sort(), [items]);
  const statuses = useMemo(() => [...new Set(items.map(i => i.customer.lead_status).filter(Boolean) as string[])].sort(), [items]);
  const sources = useMemo(() => [...new Set(items.map(i => i.customer.lead_source).filter(Boolean) as string[])].sort(), [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = items.filter(item => {
      const c = item.customer; const a = item.assessment;
      if (salesperson !== 'all' && c.salesperson !== salesperson) return false;
      if (status !== 'all' && c.lead_status !== status) return false;
      if (source !== 'all' && c.lead_source !== source) return false;
      if (!needle) return true;
      const haystack = [c.customer_name,c.salesperson,c.lead_status,c.lead_source,a?.summary,a?.primary_intent,a?.primary_objection,...item.events.map(e => e.message_clean)].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
    return [...result].sort((a,b) => {
      if (sort === 'aiq') return (b.assessment?.overall_score ?? -1) - (a.assessment?.overall_score ?? -1);
      if (sort === 'risk') return (b.assessment?.risk_score ?? -1) - (a.assessment?.risk_score ?? -1);
      if (sort === 'intent') return (b.assessment?.purchase_intent_score ?? -1) - (a.assessment?.purchase_intent_score ?? -1);
      if (sort === 'waiting') return (b.customer.minutes_waiting ?? -1) - (a.customer.minutes_waiting ?? -1);
      return new Date(b.customer.last_activity_at ?? 0).getTime() - new Date(a.customer.last_activity_at ?? 0).getTime();
    });
  }, [items, query, salesperson, status, source, sort]);

  const selectedIndex = filtered.findIndex(i => i.customer.customer_key === selectedKey);
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : undefined;
  const reset = () => { setQuery(''); setSalesperson('all'); setStatus('all'); setSource('all'); setSort('recent'); };

  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedKey('');
      if (event.key === 'ArrowLeft' && selectedIndex > 0) setSelectedKey(filtered[selectedIndex - 1].customer.customer_key);
      if (event.key === 'ArrowRight' && selectedIndex < filtered.length - 1) setSelectedKey(filtered[selectedIndex + 1].customer.customer_key);
    };
    window.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', key); };
  }, [filtered, selected, selectedIndex]);

  const waitingCount = filtered.filter(i => i.customer.awaiting_human_response).length;
  const assessedCount = filtered.filter(i => i.assessment).length;

  return <>
    <div className="mx-auto w-full max-w-[1500px] px-3 pb-24 pt-3 sm:px-5 lg:px-7 lg:pb-8">
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div><div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Conversation workspace</div><h1 className="mt-2 text-[clamp(1.55rem,3vw,2.25rem)] font-semibold tracking-[-0.045em]">Every customer conversation</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">Search the communication record, filter by ownership and lead context, and open any customer directly into the focused intelligence view.</p></div>
          <button onClick={() => void load()} disabled={loading} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 text-sm font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"><RefreshIcon size={16} className={loading ? 'animate-spin' : ''}/> Refresh</button>
        </div>
        {error && <div className="mt-3 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-4"><Metric label="Visible conversations" value={String(filtered.length)} /><Metric label="Awaiting human" value={String(waitingCount)} /><Metric label="AI assessed" value={`${assessedCount}/${filtered.length}`} /><Metric label="Salespeople" value={String(new Set(filtered.map(i => i.customer.salesperson).filter(Boolean)).size)} /></div>
      </section>

      <section className="mt-3 rounded-2xl border border-[var(--border)] bg-white p-3 sm:p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(240px,1.4fr)_repeat(4,minmax(145px,.7fr))_auto]">
          <input aria-label="Search conversations" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search customer, salesperson, objection, message…" className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--brand)]" />
          <Select value={salesperson} onChange={setSalesperson} label="All salespeople" options={salespeople}/>
          <Select value={status} onChange={setStatus} label="All statuses" options={statuses}/>
          <Select value={source} onChange={setSource} label="All sources" options={sources}/>
          <select value={sort} onChange={e=>setSort(e.target.value as SortKey)} className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3 text-sm"><option value="recent">Newest activity</option><option value="aiq">Highest AIQ</option><option value="risk">Highest risk</option><option value="intent">Highest intent</option><option value="waiting">Longest waiting</option></select>
          <button onClick={reset} className="min-h-11 rounded-xl border border-[var(--border)] px-3 text-sm font-medium text-[var(--muted)] hover:bg-[var(--surface-subtle)]">Reset</button>
        </div>
      </section>

      <section className="mt-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
        <div className="hidden grid-cols-[minmax(220px,1.3fr)_minmax(150px,.8fr)_110px_90px_90px_110px_34px] gap-3 border-b border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] md:grid"><span>Customer</span><span>Salesperson / status</span><span>Last activity</span><span>AIQ</span><span>Risk</span><span>Intent</span><span/></div>
        {!loading && filtered.length === 0 && <div className="p-10 text-center text-sm text-[var(--muted)]">No conversations match these filters.</div>}
        {filtered.map(item => <ConversationRow key={item.customer.customer_key} item={item} onOpen={()=>setSelectedKey(item.customer.customer_key)}/>)}
      </section>
    </div>
    {selected && <ConversationOverlay item={selected} position={selectedIndex+1} count={filtered.length} onBack={()=>setSelectedKey('')} onPrevious={()=>selectedIndex>0&&setSelectedKey(filtered[selectedIndex-1].customer.customer_key)} onNext={()=>selectedIndex<filtered.length-1&&setSelectedKey(filtered[selectedIndex+1].customer.customer_key)} />}
  </>;
}

function Metric({label,value}:{label:string;value:string}) { return <div><div className="text-xs text-[var(--muted)]">{label}</div><div className="mt-1 text-2xl font-semibold tracking-[-0.04em]">{value}</div></div>; }
function Select({value,onChange,label,options}:{value:string;onChange:(v:string)=>void;label:string;options:string[]}) { return <select value={value} onChange={e=>onChange(e.target.value)} className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3 text-sm"><option value="all">{label}</option>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>; }

function ConversationRow({item,onOpen}:{item:RadarItem;onOpen:()=>void}) {
  const {customer:c,assessment:a}=item;
  return <button onClick={onOpen} className="grid w-full gap-2 border-b border-[var(--border)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--surface-subtle)] md:grid-cols-[minmax(220px,1.3fr)_minmax(150px,.8fr)_110px_90px_90px_110px_34px] md:items-center md:gap-3">
    <div className="min-w-0"><div className="truncate text-sm font-semibold">{c.customer_name}</div><div className="mt-0.5 line-clamp-1 text-xs text-[var(--muted)]">{a?.summary ?? 'Assessment pending'}</div></div>
    <div className="min-w-0 text-xs text-[var(--muted)]"><div className="truncate text-[var(--text)]">{c.salesperson ?? 'Unassigned'}</div><div className="truncate">{c.lead_status ?? c.lead_source ?? '—'}</div></div>
    <div className="text-xs text-[var(--muted)]">{relativeTime(c.last_activity_at)}</div>
    <ScoreCell label="AIQ" value={a?.overall_score}/><ScoreCell label="Risk" value={a?.risk_score} inverse/><ScoreCell label="Intent" value={a?.purchase_intent_score}/><ArrowIcon size={16} className="hidden text-[var(--muted)] md:block"/>
  </button>;
}
function ScoreCell({label,value,inverse=false}:{label:string;value:number|null|undefined;inverse?:boolean}) { return <div className="flex items-center gap-2 text-xs md:block"><span className="text-[10px] uppercase text-[var(--muted-2)] md:hidden">{label}</span><span className={`font-semibold tabular-nums ${scoreTone(value,inverse)}`}>{value ?? '—'}</span></div>; }

function ConversationOverlay({item,position,count,onBack,onPrevious,onNext}:{item:RadarItem;position:number;count:number;onBack:()=>void;onPrevious:()=>void;onNext:()=>void}) {
  const {customer:c,assessment:a,events}=item;
  return <div className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-[2px] sm:p-3 lg:p-5">
    <section className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:rounded-2xl sm:border sm:border-[var(--border)]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-white px-3 py-3 sm:px-5">
        <button onClick={onBack} className="min-h-10 rounded-xl border border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--surface-subtle)]">← Back to Conversations</button>
        <div className="hidden text-xs text-[var(--muted)] sm:block">{position} of {count}</div>
        <div className="flex gap-2"><button onClick={onPrevious} disabled={position<=1} className="min-h-10 rounded-xl border border-[var(--border)] px-3 text-sm disabled:opacity-35">← Previous</button><button onClick={onNext} disabled={position>=count} className="min-h-10 rounded-xl border border-[var(--border)] px-3 text-sm disabled:opacity-35">Next →</button></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:py-7">
          <div className="flex flex-col gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Focused conversation intelligence</div><h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{c.customer_name}</h2><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--muted)]"><span>{c.salesperson ?? 'Unassigned'}</span>{c.lead_status&&<span>{c.lead_status}</span>}{c.lead_source&&<span>{c.lead_source}</span>}<span>{relativeTime(c.last_activity_at)}</span></div></div><div className="rounded-2xl border border-[var(--border)] px-5 py-3 text-center"><div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">AIQ score</div><div className="text-3xl font-semibold">{a?.overall_score ?? '—'}</div></div></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
            <div className="rounded-2xl bg-[var(--surface-subtle)] p-4 sm:p-5"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]"><SparkIcon size={15}/> CommsIQ read</div><p className="mt-2 text-sm leading-6">{a?.summary ?? 'Assessment pending.'}</p>{a?.rationale&&<p className="mt-3 border-t border-[var(--border)] pt-3 text-xs leading-5 text-[var(--muted)]">Why: {a.rationale}</p>}</div>
            <div className="rounded-2xl border border-[var(--brand)]/15 bg-[var(--brand-soft)]/55 p-4 sm:p-5"><div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand)]">What should happen next</div><div className="mt-2 text-base font-semibold leading-6">{a?.recommended_next_action ?? 'Review this conversation and determine the next customer-facing action.'}</div><div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--muted)]"><span>Owner: <strong className="text-[var(--text)]">{a?.recommended_owner ?? c.salesperson ?? 'Sales Manager'}</strong></span><span className="flex items-center gap-1"><ClockIcon size={13}/>{dueLabel(a?.recommended_due_at)}</span></div></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"><DetailScore label="Intent" value={a?.purchase_intent_score}/><DetailScore label="Opportunity" value={a?.opportunity_score}/><DetailScore label="Risk" value={a?.risk_score} inverse/><DetailScore label="Engagement" value={a?.engagement_score}/><DetailScore label="Human quality" value={a?.communication_quality_score}/><DetailScore label="Sentiment" value={a?.sentiment_score}/></div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Fact label="Primary intent" value={a?.primary_intent ?? 'Not detected'}/><Fact label="Primary objection" value={a?.primary_objection ?? 'None detected'}/><Fact label="Lifecycle" value={(a?.lifecycle_stage ?? 'Unknown').replaceAll('_',' ')}/><Fact label="Waiting" value={c.awaiting_human_response ? mins(c.minutes_waiting) : 'No'}/></div>
          <div className="mt-6"><div className="flex items-center justify-between"><h3 className="text-base font-semibold">Conversation timeline</h3><span className="text-xs text-[var(--muted)]">Latest {events.length}</span></div><div className="mt-3 space-y-2">{events.map(e=><Timeline key={e.id} event={e}/>)}</div></div>
        </div>
      </div>
    </section>
  </div>;
}
function DetailScore({label,value,inverse=false}:{label:string;value:number|null|undefined;inverse?:boolean}) { return <div className="rounded-xl border border-[var(--border)] p-3"><div className="text-[10px] text-[var(--muted)]">{label}</div><div className={`mt-1 text-xl font-semibold ${scoreTone(value,inverse)}`}>{value ?? '—'}</div></div>; }
function Fact({label,value}:{label:string;value:string}) { return <div className="rounded-xl border border-[var(--border)] p-3"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-2)]">{label}</div><div className="mt-1 text-sm font-medium capitalize">{value}</div></div>; }
function Timeline({event}:{event:CommunicationEvent}) { const actor=event.direction==='Inbound'?'Customer':event.actor_type==='automation'?'Ava automation':'Human outbound'; return <div className="rounded-xl border border-[var(--border)] p-3 sm:p-4"><div className="flex justify-between gap-3 text-[10px] text-[var(--muted)]"><span className="font-semibold uppercase tracking-wide">{actor}</span><span>{relativeTime(event.activity_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{event.message_clean || `${event.channel} communication`}</p></div>; }
