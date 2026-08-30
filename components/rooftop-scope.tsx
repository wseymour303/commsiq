'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { rooftopName } from '@/lib/rooftops';

export type Role = 'user' | 'manager' | 'admin' | 'super_admin';
export type AccessRow = { rooftop_id: string; role: Role; active: boolean };

type RooftopScopeContextValue = {
  access: AccessRow[];
  selected: string;
  selectedIds: string[];
  selectedLabel: string;
  loading: boolean;
  revision: number;
  setSelected: (value: string) => void;
};

const STORAGE_KEY = 'commsiq_rooftop_scope';
const ACCESS_KEY = 'commsiq_authorized_rooftops';
const DEFAULT_ROOFTOP = process.env.NEXT_PUBLIC_COMMUNICATIONIQ_ROOFTOP_ID ?? '';
const RooftopScopeContext = createContext<RooftopScopeContextValue | null>(null);

export function RooftopScopeProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [selected, setSelectedState] = useState(DEFAULT_ROOFTOP || 'all');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return setLoading(false);
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;
        const { data } = await supabase
          .from('commsiq_access')
          .select('rooftop_id,role,active')
          .eq('user_id', userData.user.id)
          .eq('active', true);
        if (cancelled) return;
        const rows = (data ?? []) as AccessRow[];
        const ids = rows.map(row => row.rooftop_id);
        setAccess(rows);
        window.localStorage.setItem(ACCESS_KEY, JSON.stringify(ids));
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const fallback = ids.includes(DEFAULT_ROOFTOP) ? DEFAULT_ROOFTOP : ids[0] ?? 'all';
        const valid = stored === 'all' ? ids.length > 1 : Boolean(stored && ids.includes(stored));
        const next = valid ? stored! : fallback;
        setSelectedState(next);
        window.localStorage.setItem(STORAGE_KEY, next);
        setRevision(value => value + 1);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const selectedIds = useMemo(() => selected === 'all' ? access.map(row => row.rooftop_id) : access.some(row => row.rooftop_id === selected) ? [selected] : [], [access, selected]);
  const selectedLabel = selected === 'all' ? 'All Stores' : rooftopName(selected);

  function setSelected(value: string) {
    const valid = value === 'all' ? access.length > 1 : access.some(row => row.rooftop_id === value);
    if (!valid) return;
    setSelectedState(value);
    window.localStorage.setItem(STORAGE_KEY, value);
    window.localStorage.setItem(ACCESS_KEY, JSON.stringify(access.map(row => row.rooftop_id)));
    setRevision(value => value + 1);
  }

  return <RooftopScopeContext.Provider value={{ access, selected, selectedIds, selectedLabel, loading, revision, setSelected }}>{children}</RooftopScopeContext.Provider>;
}

export function useRooftopScope() {
  const value = useContext(RooftopScopeContext);
  if (!value) throw new Error('useRooftopScope must be used inside RooftopScopeProvider.');
  return value;
}

export function RooftopScopeBadge() {
  const { selectedLabel, loading } = useRooftopScope();
  return <div className="hidden max-w-[240px] truncate rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--muted)] lg:block">{loading ? 'Loading store…' : selectedLabel}</div>;
}
