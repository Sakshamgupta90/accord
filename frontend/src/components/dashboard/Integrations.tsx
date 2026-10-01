'use client';

import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CATEGORIES, TOOLS, type ToolCategory } from '@/lib/tools';
import { useSelectedTools } from '@/lib/useSelectedTools';
import { LogoTile } from '../TechIcon';
import { StatusBadge } from './Overview';

export function Integrations() {
  const { selected, toggle } = useSelectedTools();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ToolCategory | 'All'>('All');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TOOLS.filter((tool) => (category === 'All' || tool.category === category) && (!q || `${tool.name} ${tool.description}`.toLowerCase().includes(q)));
  }, [query, category]);

  return (
    <div className="pb-24">
      <header>
        <p className="text-[13px] font-medium text-violet-600">Integrations</p>
        <h1 className="mt-1 text-[1.6rem] font-semibold sm:text-[1.75rem] tracking-[-0.03em] text-zinc-900">Choose the tools Accord can use</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-zinc-600">
          Select where your team makes decisions and where your code and data live. Accord only ever reads from these tools.
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1">
          {(['All', ...CATEGORIES] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              aria-pressed={category === item}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${category === item ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <span className="sr-only">Search tools</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools"
            className="h-10 w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-3 text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-[14px] text-zinc-500">No tools match “{query}”.</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((tool) => {
            const isSelected = selected.includes(tool.id);
            return (
              <li key={tool.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  onClick={() => toggle(tool.id)}
                  className={`group flex h-full w-full flex-col rounded-2xl border bg-white p-5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                    isSelected ? 'border-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.15)]' : 'border-zinc-200 hover:border-zinc-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <LogoTile name={tool.name} logo={tool.logo} tile={tool.tile} />
                    <span className={`flex h-6 w-6 items-center justify-center rounded-md border transition ${isSelected ? 'border-violet-600 bg-violet-600 text-white' : 'border-zinc-300 bg-white text-transparent'}`}>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <span className="text-[15.5px] font-semibold text-zinc-900">{tool.name}</span>
                    <StatusBadge status={tool.status} />
                  </div>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">{tool.description}</p>
                  <span className="mt-auto pt-4 text-[12px] text-zinc-400">{tool.category}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 border-t border-zinc-200 bg-white/90 backdrop-blur lg:bottom-0 lg:left-[248px]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-10">
          <p className="text-[13.5px] text-zinc-600">
            <b className="font-semibold text-zinc-900">{selected.length}</b> {selected.length === 1 ? 'tool' : 'tools'} selected
            <span className="hidden text-zinc-400 sm:inline"> · saved in this browser</span>
          </p>
          <p className="hidden text-right text-[12.5px] text-zinc-500 sm:block">Pilot tools are connected with our team; others open as they ship.</p>
        </div>
      </div>
    </div>
  );
}
