'use client';

import { useState } from 'react';
import { Brand } from './brand';
import { ChartIcon, MessageIcon, RadarIcon, UsersIcon } from './icons';
import { ManagerRadar } from './manager-radar';
import { ConversationsWorkspace } from './conversations-workspace';
import { TeamWorkspace } from './team-workspace';

const nav = [
  { id:'radar', label:'Radar', icon:RadarIcon },
  { id:'conversations', label:'Conversations', icon:MessageIcon },
  { id:'team', label:'Team', icon:UsersIcon },
  { id:'insights', label:'Insights', icon:ChartIcon }
] as const;

export function AppShell() {
  const [active,setActive]=useState<typeof nav[number]['id']>('radar');
  return <div className="min-h-screen">
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/88"><div className="mx-auto flex h-[72px] max-w-[1480px] items-center justify-between px-3 sm:px-5 lg:px-7"><Brand/><nav className="hidden items-center gap-1 md:flex">{nav.map(n=><button key={n.id} onClick={()=>setActive(n.id)} className={`min-h-10 rounded-lg px-3 text-sm font-medium transition ${active===n.id?'bg-[var(--surface-subtle)] text-[var(--text)]':'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]'}`}>{n.label}</button>)}</nav><div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-white text-xs font-semibold text-[var(--text)]">WS</div></div></header>
    <main>{active==='radar'?<ManagerRadar/>:active==='conversations'?<ConversationsWorkspace/>:active==='team'?<TeamWorkspace/>:<Placeholder active={active}/>}</main>
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[var(--border)] bg-white/95 px-2 pt-1.5 backdrop-blur md:hidden">{nav.map(n=>{const Icon=n.icon;return <button key={n.id} onClick={()=>setActive(n.id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium ${active===n.id?'text-[var(--text)]':'text-[var(--muted)]'}`}><Icon size={19}/><span>{n.label}</span></button>})}</nav>
  </div>;
}

function Placeholder({active}:{active:string}) { return <div className="mx-auto max-w-[1480px] px-4 py-10 sm:px-6 lg:px-8"><div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-white p-10 text-center"><div className="text-lg font-semibold capitalize">{active}</div><p className="mt-2 text-sm text-[var(--muted)]">This module is next in the CommunicationIQ roadmap.</p></div></div>; }
