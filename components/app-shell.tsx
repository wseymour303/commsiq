'use client';

import { useMemo, useState } from 'react';
import { Brand } from './brand';
import { ChartIcon, MessageIcon, RadarIcon, UsersIcon } from './icons';
import { ManagerRadar } from './manager-radar';
import { ConversationsWorkspace } from './conversations-workspace';
import { TeamWorkspace } from './team-workspace';
import { AccountMenu } from './account-menu';
import { UserManagement } from './user-management';
import { RooftopScopeBadge, RooftopScopeProvider, useRooftopScope } from './rooftop-scope';

type NavId = 'radar' | 'conversations' | 'team' | 'insights' | 'admin';
const baseNav: Array<{ id: NavId; label: string; icon: typeof RadarIcon }> = [
  { id:'radar', label:'Radar', icon:RadarIcon },
  { id:'conversations', label:'Conversations', icon:MessageIcon },
  { id:'team', label:'Team', icon:UsersIcon },
  { id:'insights', label:'Insights', icon:ChartIcon }
];

export function AppShell() {
  return <RooftopScopeProvider><ScopedAppShell /></RooftopScopeProvider>;
}

function ScopedAppShell() {
  const [active,setActive]=useState<NavId>('radar');
  const { revision, access } = useRooftopScope();
  const isSuperAdmin = access.some(row => row.active && row.role === 'super_admin');
  const nav = useMemo(() => isSuperAdmin ? [...baseNav, { id:'admin' as const, label:'Admin', icon:UsersIcon }] : baseNav, [isSuperAdmin]);
  const visibleActive = !isSuperAdmin && active === 'admin' ? 'radar' : active;

  return <div className="min-h-screen">
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/88"><div className="mx-auto flex h-[72px] max-w-[1480px] items-center justify-between px-3 sm:px-5 lg:px-7"><Brand/><nav className="hidden items-center gap-1 md:flex">{nav.map(n=><button key={n.id} onClick={()=>setActive(n.id)} className={`min-h-10 rounded-lg px-3 text-sm font-medium transition ${visibleActive===n.id?'bg-[var(--surface-subtle)] text-[var(--text)]':'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]'}`}>{n.label}</button>)}</nav><div className="flex items-center gap-2"><RooftopScopeBadge/><AccountMenu/></div></div></header>
    <main key={`${visibleActive}:${revision}`}>{visibleActive==='radar'?<ManagerRadar/>:visibleActive==='conversations'?<ConversationsWorkspace/>:visibleActive==='team'?<TeamWorkspace/>:visibleActive==='admin'&&isSuperAdmin?<UserManagement/>:<Placeholder active={visibleActive}/>}</main>
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid border-t border-[var(--border)] bg-white/95 px-2 pt-1.5 backdrop-blur md:hidden" style={{gridTemplateColumns:`repeat(${nav.length},minmax(0,1fr))`}}>{nav.map(n=>{const Icon=n.icon;return <button key={n.id} onClick={()=>setActive(n.id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium ${visibleActive===n.id?'text-[var(--text)]':'text-[var(--muted)]'}`}><Icon size={19}/><span>{n.label}</span></button>})}</nav>
  </div>;
}

function Placeholder({active}:{active:string}) { return <div className="mx-auto max-w-[1480px] px-4 py-10 sm:px-6 lg:px-8"><div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-white p-10 text-center"><div className="text-lg font-semibold capitalize">{active}</div><p className="mt-2 text-sm text-[var(--muted)]">This module is next in the CommunicationIQ roadmap.</p></div></div>; }
