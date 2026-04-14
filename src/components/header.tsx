"use client";

import { useState } from "react";

export function Header() {
  const [search, setSearch] = useState("");

  return (
    <header className="h-16 flex items-center justify-between px-8 sticky top-0 bg-slate-50/80 backdrop-blur-xl z-40 shadow-xl shadow-neutral-900/5">
      <div className="flex items-center gap-4">
        <div className="relative group">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors">
            search
          </span>
          <input
            className="bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2 w-80 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
            placeholder="Buscar clientes ou segmentos..."
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="p-2 rounded-full text-on-surface-variant hover:bg-neutral-100 transition-colors">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <div className="h-8 w-[1px] bg-outline-variant/30 mx-2" />
        <div className="flex items-center gap-2 px-2 py-1 rounded-full hover:bg-neutral-100 transition-colors cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary text-xs font-bold">
            FP
          </div>
        </div>
      </div>
    </header>
  );
}
