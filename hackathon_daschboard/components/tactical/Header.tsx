'use client';

import React from 'react';
import { Shield, BookOpen, Radio } from 'lucide-react';

interface HeaderProps {
  onOpenSop: () => void;
  onOpenSupport: () => void;
}

export default function Header({
  onOpenSop,
  onOpenSupport,
}: HeaderProps) {
  return (
    <header className="w-full bg-zinc-950 border-b border-zinc-800 text-zinc-100 px-4 py-2.5 flex items-center justify-between select-none z-30 shrink-0">
      {/* LEWO: tylko logo + nazwa „TARCZA” */}
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
          <Shield className="w-4 h-4" />
        </div>
        <span className="font-bold tracking-widest text-lg text-zinc-100 font-mono">
          TARCZA
        </span>
      </div>

      {/* PRAWO: tylko linki pomocy: „Procedury SOP” i „Kontakt i wsparcie” */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={onOpenSop}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded transition-colors cursor-pointer"
          title="Procedury Operacyjne SOP"
        >
          <BookOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Procedury SOP</span>
        </button>

        <button
          onClick={onOpenSupport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded transition-colors cursor-pointer"
          title="Kontakt i Wsparcie Łączności"
        >
          <Radio className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>Kontakt i wsparcie</span>
        </button>
      </div>
    </header>
  );
}
