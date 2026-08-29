'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { matchesRadarFilter, toRadarItem } from '@/lib/radar';
import type { Assessment, CommunicationEvent, CustomerState, RadarFilter, RadarItem } from '@/lib/types';
import { ArrowIcon, CheckIcon, ClockIcon, RefreshIcon, SparkIcon } from './icons';

const rooftopId = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID;

const filters: Array<{ id: RadarFilter; label: string }> = [
  { id: 'attention', label: 'Needs Attention' },
  { id: 'buying', label: 'Buying Now' },
  { id: 'waiting', label: 'Waiting on Us' },
  { id: 'price', label: 'Price / Payment' },
  { id: 'appointment', label: 'Appointments' },
  { id: 'risk', label: 'CX Risk' },
  { id: 'future', label: 'Future Follow-Up' },
  { id: 'overcontact', label: 'Over-Contact' },
  { id: 'dnc', label: 'Do Not Contact' },
  { id: 'advocate', label: 'Positive' },
  { id: 'all', label: 'All' }
];

const queueLabel: Record<RadarFilter, string> = {
  attention: 'Needs attention', buying: 'Buying now', waiting: 'Waiting on us', price: 'Price / payment', appointment: 'Appointment opportunity', future: 'Future follow-up', overcontact: 'Over-contact risk', advocate: 'Positive experience', risk: 'Customer experience risk', dnc: 'Do not contact', all: 'All conversations'
};

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

function dueLabel(value: string | null | undefined) {
  if (!value) return 'No deadline set';
  const due = new Date(value);
  const minutes = Math.round((due.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return 'Due now';
  if (minutes < 60) return `Due in ${minutes}m`;
  if (minutes < 1440) return `Due in ${Math.ceil(minutes / 60)}h`;
  return `Due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function scoreTone(score: number | null | undefined, inverse = false) {
  const value = score ?? 0;
  if (inverse) {
    if (value >= 70) return 'text-[var(--danger)]';
    if (value >= 45) return 'text-[var(--warning)]';
    return 'text-[var(--success)]';
  }
  if (value >= 75) return 'text-[var(--success)]';
  if (value >= 50) return 'text-[var(--warning)]';
  return 'text-[var(--danger)]';
}

function priorityClass(priority: RadarItem['priority']) {
  if (priority === 'critical') return 'border-l-[var(--danger)] bg-[var(--danger-soft)]/45';
  if (priority === 'high') return 'border-l-[var(--warning)] bg-[var(--warning-soft)]/40';
  if (priority === 'medium') return 'border-l-[var(--accent)] bg-white';
  return 'border-l-[var(--border-strong)] bg-white';
}

function sortRadarItems(items: RadarItem[]) {
  const weight = { critical: 4, high: 3, medium: 2, low: 1 } as const;
  return [...items].sort((a, b) => {
    const priorityDelta = weight[b.priority] - weight[a.priority];
    if (priorityDelta) return priorityDelta;
    const aScore = (a.assessment?.overall_score ?? 0) + (a.assessment?.opportunity_score ?? 0) + (a.assessment?.risk_score ?? 0);
    const bScore = (b.assessment?.overall_score ?? 0) + (b.assessment?.opportunity_score ?? 0) + (b.assessment?.risk_score ?? 0);
    return bScore - aScore;
  });
}

export function ManagerRadar() {
  const [items, setItems] = useState<RadarItem[]>([]);
  const [filter, setFilter] = useState<RadarFilter>('attention');
  const [selectedKey, setSelectedKey] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !rooftopId) return;
    setLoading(true); setError(null);
    try {
      const { data: states, error: stateError } = await supabase.from('communication_customer_state').select('*').eq('rooftop_id', rooftopId).order('last_activity_at', { ascending: false }).limit(100);
      if (stateError) throw stateError;
      const customerStates = (states ?? []) as CustomerState[];
      if (!customerStates.length) { setItems([]); return; }

      const keys = customerStates.map(state => state.customer_key);
      const { data: assessments, error: assessmentError } = await supabase.from('communication_ai_assessments').select('*').eq('rooftop_id', rooftopId).in('customer_key', keys).order('assessed_at', { ascending: false });
      if (assessmentError) throw assessmentError;
      const latest = new Map<string, Assessment>();
      for (const assessment of (assessments ?? []) as Assessment[]) if (!latest.has(assessment.customer_key)) latest.set(assessment.customer_key, assessment);

      const { data: eventRows, error: eventError } = await supabase.from('communication_events').select('id,customer_key,customer_name,salesperson,activity_at,direction,channel,communication_type,message_clean,actor_type').eq('rooftop_id', rooftopId).in('customer_key', keys).order('activity_at', { ascending: false }).limit(800);
      if (eventError) throw eventError;
      const eventsByKey = new Map<string, CommunicationEvent[]>();
      for (const event of (eventRows ?? []) as CommunicationEvent[]) {
        if (!event.customer_key) continue;
        const list = eventsByKey.get(event.customer_key) ?? [];
        if (list.length < 12) list.push(event);
        eventsByKey.set(event.customer_key, list);
      }

      const next = sortRadarItems(customerStates.map(state => toRadarItem(state, latest.get(state.customer_key), eventsByKey.get(state.customer_key) ?? [])));
      setItems(next);
      setSelectedKey(current => current && next.some(item => item.customer.customer_key === current) ? current : next[0]?.customer.customer_key ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load CommsIQ intelligence.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => Object.fromEntries(filters.map(item => [item.id, items.filter(radarItem => matchesRadarFilter(radarItem, item.id)).length])), [items]);
  const filtered = useMemo(() => items.filter(item => matchesRadarFilter(item, filter)), [items, filter]);
  const selectedIndex = Math.max(0, filtered.findIndex(item => item.customer.customer_key === selectedKey));
  const selected = filtered[selectedIndex] ?? items.find(item => item.customer.customer_key === selectedKey) ?? filtered[0] ?? items[0];
  const highPriority = items.filter(item => item.priority === 'critical' || item.priority === 'high').length;
  const waiting = items.filter(item => item.customer.awaiting_human_response);
  const avgWait = waiting.length ? Math.round(waiting.reduce((sum, item) => sum + (item.customer.minutes_waiting ?? 0), 0) / waiting.length) : null;
  const buying = items.filter(item => matchesRadarFilter(item, 'buying')).length;
  const risk = items.filter(item => matchesRadarFilter(item, 'risk')).length;
  const assessed = items.filter(item => item.assessment).length;

  const openDetail = useCallback((customerKey: string) => {
    setSelectedKey(customerKey);
    setDetailOpen(true);
  }, []);

  const closeDetail = useCallback(() => setDetailOpen(false), []);

  const moveDetail = useCallback((direction: -1 | 1) => {
    if (!filtered.length) return;
    const currentIndex = filtered.findIndex(item => item.customer.customer_key === selectedKey);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.min(filtered.length - 1, Math.max(0, baseIndex + direction));
    setSelectedKey(filtered[nextIndex].customer.customer_key);
  }, [filtered, selectedKey]);

  useEffect(() => {
    if (!detailOpen) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail();
      if (event.key === 'ArrowLeft') moveDetail(-1);
      if (event.key === 'ArrowRight') moveDetail(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeDetail, detailOpen, moveDetail]);

  return (
    <>
      <div className="mx-auto w-full max-w-[1500px] px-3 pb-24 pt-3 sm:px-5 lg:px-7 lg:pb-8">
        <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"><span className="h-2 w-2 rounded-full bg-[var(--success)]" /> Live manager intelligence</div>
              <h1 className="mt-2 text-[clamp(1.55rem,3vw,2.25rem)] font-semibold tracking-[-0.045em]">What should happen next</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">CommsIQ reads the conversation, separates human follow-up from automation, and surfaces the customers where manager attention can change the outcome.</p>
            </div>
            <button onClick={() => void load()} disabled={loading} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 text-sm font-medium transition hover:bg-[var(--surface-subtle)] disabled:opacity-50"><RefreshIcon size={16} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          </div>
          {error && <div className="mt-3 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-5">
            <Metric label="Needs attention" value={String(highPriority)} detail="High + critical" />
            <Metric label="Buying now" value={String(buying)} detail="Strong purchase intent" />
            <Metric label="Waiting on us" value={String(waiting.length)} detail={avgWait == null ? 'No open waits' : `Avg ${mins(avgWait)}`} />
            <Metric label="CX risk" value={String(risk)} detail="Risk or negative sentiment" />
            <Metric label="AI coverage" value={`${assessed}/${items.length}`} detail="Latest customer states" />
          </div>
        </section>

        <div className="no-scrollbar -mx-3 mt-3 flex gap-2 overflow-x-auto px-3 sm:-mx-5 sm:px-5 lg:mx-0 lg:px-0">
          {filters.map(item => <button key={item.id} onClick={() => setFilter(item.id)} className={`min-h-11 shrink-0 rounded-full border px-3.5 text-sm font-medium transition ${filter === item.id ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'}`}>{item.label}<span className={`ml-2 text-xs ${filter === item.id ? 'text-white/65' : 'text-[var(--muted-2)]'}`}>{counts[item.id] ?? 0}</span></button>)}
        </div>

        <section className="mt-3 min-w-0">
          <div className="mb-2 flex items-center justify-between px-1 text-xs text-[var(--muted)]"><span>{queueLabel[filter]}</span><span>{filtered.length} conversations</span></div>
          {!loading && filtered.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-white p-9 text-center"><CheckIcon className="mx-auto text-[var(--success)]"/><div className="mt-3 font-semibold">Nothing in this queue</div><p className="mt-1 text-sm text-[var(--muted)]">No current conversations match this signal.</p></div>}
          <div className="space-y-2.5">{filtered.map(item => <RadarCard key={item.customer.customer_key} item={item} onSelect={() => openDetail(item.customer.customer_key)} />)}</div>
        </section>
      </div>

      {detailOpen && selected && <ConversationDetailOverlay item={selected} queueCount={filtered.length} queuePosition={selectedIndex + 1} canPrevious={selectedIndex > 0} canNext={selectedIndex < filtered.length - 1} onBack={closeDetail} onPrevious={() => moveDetail(-1)} onNext={() => moveDetail(1)} />}
    </>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0"><div className="text-xs font-medium text-[var(--muted)]">{label}</div><div className="mt-1 text-2xl font-semibold tracking-[-0.04em] tabular-nums">{value}</div><div className="mt-0.5 truncate text-[11px] text-[var(--muted-2)]">{detail}</div></div>;
}

function RadarCard({ item, onSelect }: { item: RadarItem; onSelect: () => void }) {
  const { customer, assessment } = item;
  return <button onClick={onSelect} className={`w-full rounded-2xl border border-l-[3px] border-[var(--border)] p-4 text-left transition hover:border-[var(--border-strong)] hover:shadow-sm ${priorityClass(item.priority)}`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{queueLabel[item.category]}</span><span className="rounded-full border border-[var(--border)] bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--muted)]">{item.priority}</span>{assessment?.primary_objection && <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">{assessment.primary_objection}</span>}</div><div className="mt-1.5 truncate text-[15px] font-semibold">{customer.customer_name}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]"><span>{customer.salesperson ?? 'Unassigned'}</span>{customer.lead_status && <span>{customer.lead_status}</span>}<span>{relativeTime(customer.last_activity_at)}</span></div></div>
      <div className="shrink-0 text-right"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-2)]">AIQ score</div><div className="mt-0.5 text-xl font-semibold tabular-nums">{assessment?.overall_score ?? '—'}</div></div>
    </div>
    <p className="mt-3 line-clamp-2 text-sm leading-5.5 text-[#34383f]">{assessment?.summary ?? 'AI assessment pending for this conversation.'}</p>
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/80 px-3 py-2.5"><div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-2)]">Next best action</div><div className="mt-0.5 line-clamp-1 text-xs font-medium text-[var(--text)]">{assessment?.recommended_next_action ?? 'Review conversation'}</div></div><ArrowIcon size={16} className="shrink-0 text-[var(--muted)]" /></div>
  </button>;
}

function ConversationDetailOverlay({ item, queueCount, queuePosition, canPrevious, canNext, onBack, onPrevious, onNext }: { item: RadarItem; queueCount: number; queuePosition: number; canPrevious: boolean; canNext: boolean; onBack: () => void; onPrevious: () => void; onNext: () => void }) {
  const { customer, assessment, events } = item;
  return <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#f6f7f9] text-[var(--text)] lg:inset-3 lg:rounded-2xl lg:border lg:border-[var(--border)] lg:shadow-[0_24px_70px_rgba(15,23,42,0.20)]" role="dialog" aria-modal="true" aria-label={`${customer.customer_name} conversation details`}>
    <header className="z-10 shrink-0 border-b border-[var(--border)] bg-white/95 px-3 py-3 backdrop-blur sm:px-5">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3">
        <button onClick={onBack} className="flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 text-sm font-semibold hover:bg-[var(--surface-subtle)]"><ArrowIcon size={15} className="rotate-180" /> <span className="hidden sm:inline">Back to Radar</span><span className="sm:hidden">Back</span></button>
        <div className="min-w-0 flex-1 text-center sm:text-left"><div className="truncate text-sm font-semibold sm:text-base">{customer.customer_name}</div><div className="hidden truncate text-xs text-[var(--muted)] sm:block">{customer.salesperson ?? 'Unassigned'} · {queueLabel[item.category]} · {item.priority} priority · AIQ {assessment?.overall_score ?? '—'}</div></div>
        <div className="flex shrink-0 items-center gap-2"><span className="hidden text-xs tabular-nums text-[var(--muted)] md:inline">{queuePosition} of {queueCount}</span><button onClick={onPrevious} disabled={!canPrevious} aria-label="Previous conversation" className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-white disabled:opacity-30"><ArrowIcon size={16} className="rotate-180" /></button><button onClick={onNext} disabled={!canNext} aria-label="Next conversation" className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-white disabled:opacity-30"><ArrowIcon size={16} /></button></div>
      </div>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <main className="mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-5 sm:py-5 lg:px-7">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
          <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">{queueLabel[item.category]}</span><span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-semibold uppercase text-[var(--muted)]">{item.priority}</span></div><h1 className="mt-3 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">{customer.customer_name}</h1><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]"><span>{customer.salesperson ?? 'Unassigned'}</span>{customer.lead_source && <span>{customer.lead_source}</span>}{customer.lead_status && <span>{customer.lead_status}</span>}<span>Last activity {relativeTime(customer.last_activity_at)}</span></div></div>
          <div className="text-right"><div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-2)]">AIQ score</div><div className="text-3xl font-semibold tabular-nums">{assessment?.overall_score ?? '—'}</div></div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,.95fr)_minmax(0,1.05fr)]">
          <section className="space-y-4">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-[var(--border)] sm:p-5"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]"><SparkIcon size={15} /> CommsIQ read</div><p className="mt-2 text-sm leading-6 text-[var(--text)]">{assessment?.summary ?? 'Assessment pending.'}</p>{assessment?.rationale && <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs leading-5 text-[var(--muted)]">Why: {assessment.rationale}</p>}</div>

            <div className="rounded-2xl border border-[var(--brand)]/15 bg-[var(--brand-soft)]/55 p-4 sm:p-5"><div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand)]">What should happen next</div><div className="mt-2 text-base font-semibold leading-6">{assessment?.recommended_next_action ?? 'Review this conversation and determine the next customer-facing action.'}</div><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--muted)]"><span>Owner: <strong className="font-medium text-[var(--text)]">{assessment?.recommended_owner ?? customer.salesperson ?? 'Sales Manager'}</strong></span><span className="flex items-center gap-1"><ClockIcon size={13} /> {dueLabel(assessment?.recommended_due_at)}</span></div></div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Score label="Intent" value={assessment?.purchase_intent_score} /><Score label="Opportunity" value={assessment?.opportunity_score} /><Score label="Risk" value={assessment?.risk_score} inverse /><Score label="Engagement" value={assessment?.engagement_score} /><Score label="Human quality" value={assessment?.communication_quality_score} /><Score label="Sentiment" value={assessment?.sentiment_score} sentiment /></div>

            <div className="grid grid-cols-2 gap-2 text-xs"><Fact label="Primary intent" value={assessment?.primary_intent ?? 'Not detected'} /><Fact label="Primary objection" value={assessment?.primary_objection ?? 'None detected'} /><Fact label="Lifecycle" value={(assessment?.lifecycle_stage ?? 'Unknown').replaceAll('_', ' ')} /><Fact label="Waiting" value={customer.awaiting_human_response ? mins(customer.minutes_waiting) : 'No'} /></div>
          </section>

          <section className="min-w-0 rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Conversation timeline</h2><p className="mt-0.5 text-xs text-[var(--muted)]">Customer, human salesperson, and Ava activity shown separately.</p></div><span className="shrink-0 text-[11px] text-[var(--muted)]">Latest {events.length}</span></div><div className="mt-4 space-y-2.5">{events.length === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted)]">No timeline events loaded.</div>}{events.map(event => <TimelineEvent key={event.id} event={event} />)}</div></section>
        </div>
      </main>
    </div>
  </div>;
}

function Score({ label, value, inverse = false, sentiment = false }: { label: string; value: number | null | undefined; inverse?: boolean; sentiment?: boolean }) {
  const tone = sentiment ? (value != null && value < -20 ? 'text-[var(--danger)]' : value != null && value > 30 ? 'text-[var(--success)]' : 'text-[var(--warning)]') : scoreTone(value, inverse);
  return <div className="rounded-xl border border-[var(--border)] bg-white p-3"><div className="text-[10px] text-[var(--muted)]">{label}</div><div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{value ?? '—'}</div></div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[var(--border)] bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-[var(--muted-2)]">{label}</div><div className="mt-1 line-clamp-2 font-medium capitalize text-[var(--text)]">{value}</div></div>;
}

function TimelineEvent({ event }: { event: CommunicationEvent }) {
  const automated = event.actor_type === 'automation';
  const inbound = event.direction === 'Inbound';
  return <div className="rounded-xl border border-[var(--border)] p-3.5"><div className="flex items-center justify-between gap-3 text-[10px] text-[var(--muted)]"><span className="font-semibold uppercase tracking-wide">{inbound ? 'Customer' : automated ? 'Ava automation' : 'Human outbound'}</span><span>{relativeTime(event.activity_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--text)]">{event.message_clean || `${event.channel} communication`}</p></div>;
}