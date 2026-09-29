'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Zap, Navigation, ShieldAlert, Radio, Volume2, ArrowRight, CornerDownLeft } from 'lucide-react';

export type TacticalActionKey =
  | 'EVACUATE_SECTOR_B'
  | 'START_DRAW_HOTSWAP'
  | 'TOGGLE_EDGE_AI'
  | 'TRIGGER_VOICE_ASSISTANT'
  | 'RETREAT_FIREFIGHTERS'
  | 'SWITCH_FHSS_868'
  | string;

export type TacticalActionPayload =
  | { sector?: string; targetId?: string; priority?: 'KRYTYCZNY' | 'WYSOKI' | 'STANDARD' }
  | { coordinates?: [number, number]; radiusMeters?: number; label?: string }
  | { edgeEnabled?: boolean; targetHost?: string }
  | { frequencyMhz?: number; hopIntervalMs?: number }
  | Record<string, string | number | boolean | null | undefined>;

interface QuickActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteAction: (commandKey: TacticalActionKey, payload?: TacticalActionPayload) => void;
}

interface CommandItem {
  id: string;
  category: string;
  title: string;
  description: string;
  badge: string;
  badgeColor: string;
  actionKey: string;
}

const COMMANDS: CommandItem[] = [
  {
    id: 'CMD-01',
    category: 'EWAKUACJA & RATUNEK',
    title: 'Ewakuacja sektor B (3 poszkodowanych w oknie)',
    description: 'Uruchom algorytm korytarza ewakuacyjnego i zrzut radiotelefonu przez drona ALPHA-2.',
    badge: 'PRIORYTET KRYTYCZNY',
    badgeColor: 'text-rose-400 border-rose-500/30 bg-rose-950/30',
    actionKey: 'EVACUATE_SECTOR_B',
  },
  {
    id: 'CMD-02',
    category: 'ZARZĄDZANIE ROJEM',
    title: 'Wyznacz strefę lądowania Hot-Swap na mapie',
    description: 'Włącz narzędzie wyznaczania lądowiska wymiany baterii dla dronów z niskim stanem energii.',
    badge: 'HOT-SWAP',
    badgeColor: 'text-amber-400 border-amber-500/30 bg-amber-950/30',
    actionKey: 'START_DRAW_HOTSWAP',
  },
  {
    id: 'CMD-03',
    category: 'ROZPOZNANIE & AI',
    title: 'Przełącz silnik AI na lokalny Edge (NVIDIA Jetson)',
    description: 'Odcięcie od zewnętrznej chmury, autonomiczne wnioskowanie w dronach bez ryzyka zagłuszenia.',
    badge: 'RESILIENCE',
    badgeColor: 'text-emerald-400 border-emerald-500/30 bg-emerald-950/30',
    actionKey: 'TOGGLE_EDGE_AI',
  },
  {
    id: 'CMD-04',
    category: 'KOMUNIKACJA GŁOSOWA',
    title: 'Uruchom Asystenta Ewakuacji Głosowej (Megafon BRAVO-1)',
    description: 'Nadawanie zsyntetyzowanych instrukcji krok po kroku dla uwięzionych ludzi w sektorze B-2.',
    badge: 'AUDIO AI',
    badgeColor: 'text-cyan-400 border-cyan-500/30 bg-cyan-950/30',
    actionKey: 'TRIGGER_VOICE_ASSISTANT',
  },
  {
    id: 'CMD-05',
    category: 'BEZPIECZEŃSTWO ROT',
    title: 'Alarm wycofania rot gaśniczych z sektora B-4',
    description: 'Transmisja sygnału syreny alarmowej na aparaty powietrzne strażaków z powodu ryzyka zawalenia stropu.',
    badge: 'ALARM PSP',
    badgeColor: 'text-rose-400 border-rose-500/30 bg-rose-950/30',
    actionKey: 'RETREAT_FIREFIGHTERS',
  },
  {
    id: 'CMD-06',
    category: 'ŁĄCZNOŚĆ DUAL-USE',
    title: 'Wymuś Frequency Hopping (FHSS) na pasmo 868 MHz',
    description: 'Ominięcie wykrytych zakłóceń elektromagnetycznych w paśmie 2.4 GHz.',
    badge: 'RADIO FHSS',
    badgeColor: 'text-purple-400 border-purple-500/30 bg-purple-950/30',
    actionKey: 'SWITCH_FHSS_868',
  },
];

export default function QuickActionModal({ isOpen, onClose, onExecuteAction }: QuickActionModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        setSearchTerm('');
        setSelectedIndex(0);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const filteredCommands = COMMANDS.filter(cmd => {
    const q = searchTerm.toLowerCase();
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q)
    );
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filteredCommands.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % (filteredCommands.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        execute(filteredCommands[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const execute = (cmd: CommandItem) => {
    onExecuteAction(cmd.actionKey);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-start justify-center pt-20 bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-zinc-800 bg-zinc-900/80 gap-3">
          <Search className="w-5 h-5 text-emerald-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Wpisz komendę taktyczną (np. 'Ewakuacja sektor B', 'Hot-Swap', 'Megafon')..."
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none font-mono"
          />
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-200 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results list */}
        <div className="max-h-[380px] overflow-y-auto p-2 space-y-1">
          {filteredCommands.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 font-mono">
              Brak dopasowania do komendy &quot;{searchTerm}&quot;. Spróbuj &quot;Ewakuacja&quot; lub &quot;Dron&quot;.
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  onClick={() => execute(cmd)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`p-3 rounded border cursor-pointer transition-all flex items-start justify-between gap-3 text-xs ${
                    isSelected
                      ? 'bg-zinc-900 border-emerald-500/60 text-zinc-100 shadow-sm'
                      : 'bg-zinc-950/40 border-zinc-800/80 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
                  }`}
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase text-zinc-400 tracking-wider">
                        {cmd.category}
                      </span>
                      <span className={`text-[10px] font-mono border px-1.5 py-0.2 rounded ${cmd.badgeColor}`}>
                        {cmd.badge}
                      </span>
                    </div>
                    <div className="font-semibold text-zinc-100 text-xs">{cmd.title}</div>
                    <p className="text-[11px] text-zinc-400 leading-snug">{cmd.description}</p>
                  </div>

                  <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] font-mono shrink-0 mt-2">
                    {isSelected && (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <span>Wykonaj</span>
                        <CornerDownLeft className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Bottom Keyboard Shortcuts */}
        <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between text-[11px] font-mono text-zinc-400">
          <div className="flex items-center gap-3">
            <span>↑↓ Nawigacja</span>
            <span>↵ Wybierz</span>
            <span>ESC Zamknij</span>
          </div>
          <span className="text-emerald-400 font-semibold">TARCZA RAPID DISPATCH</span>
        </div>
      </div>
    </div>
  );
}
