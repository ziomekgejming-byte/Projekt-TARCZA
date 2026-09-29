'use client';

import React, { useState } from 'react';
import { X, BookOpen, CheckSquare, Square, AlertTriangle, ShieldCheck } from 'lucide-react';
import { SOP_PROCEDURES } from '@/lib/mock-data';
import { SopProcedure } from '@/types/tarcza';

interface SopModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SopModal({ isOpen, onClose }: SopModalProps) {
  const [selectedSop, setSelectedSop] = useState<SopProcedure>(SOP_PROCEDURES[0]);
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});

  if (!isOpen) return null;

  const toggleStep = (stepKey: string) => {
    setCheckedSteps(prev => ({
      ...prev,
      [stepKey]: !prev[stepKey]
    }));
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-4xl bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-amber-950/60 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                Standardowe Procedury Operacyjne (SOP)
                <span className="text-xs font-mono text-zinc-400 font-normal">| DUAL-USE EMERGENCY</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Protokoły postępowania dla Kierującego Działaniem Ratowniczym (KDR) i operatorów roju dronów
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-zinc-800 overflow-hidden">
          {/* List of SOPs */}
          <div className="p-4 overflow-y-auto space-y-2 bg-zinc-950/80">
            <span className="text-[11px] font-mono uppercase text-zinc-500 tracking-wider">
              Katalog Procedur Awaryjnych
            </span>
            {SOP_PROCEDURES.map((sop) => {
              const isSelected = selectedSop.id === sop.id;
              return (
                <button
                  key={sop.id}
                  onClick={() => setSelectedSop(sop)}
                  className={`w-full text-left p-3 rounded border transition-all text-xs ${
                    isSelected
                      ? 'bg-zinc-900 border-amber-500/60 text-zinc-100 shadow-sm'
                      : 'bg-zinc-900/30 border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[11px] font-semibold text-amber-400">{sop.code}</span>
                    <span className="text-[10px] font-mono text-zinc-400">{sop.priority}</span>
                  </div>
                  <div className="font-medium text-zinc-200 line-clamp-1">{sop.title}</div>
                  <div className="text-[11px] text-zinc-400 mt-1">{sop.category}</div>
                </button>
              );
            })}
          </div>

          {/* Details & Interactive Checklist */}
          <div className="p-6 md:col-span-2 overflow-y-auto flex flex-col justify-between space-y-6">
            <div>
              <div className="flex items-start justify-between border-b border-zinc-800/80 pb-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-amber-400 font-bold">{selectedSop.code}</span>
                    <span className="text-zinc-600">/</span>
                    <span className="text-xs text-zinc-400 uppercase tracking-wide">{selectedSop.category}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-100">{selectedSop.title}</h3>
                </div>
                <div className="text-right text-[11px] text-zinc-400 font-mono">
                  Aktualizacja: {selectedSop.lastUpdate}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="font-medium text-zinc-300">Lista Kontrolna Kroków Operacyjnych:</span>
                  <span className="text-[11px] font-mono text-zinc-400">
                    Kliknij krok, aby oznaczyć realizację
                  </span>
                </div>

                <div className="space-y-2">
                  {selectedSop.steps.map((step, idx) => {
                    const stepKey = `${selectedSop.id}-${idx}`;
                    const isChecked = !!checkedSteps[stepKey];
                    return (
                      <div
                        key={idx}
                        onClick={() => toggleStep(stepKey)}
                        className={`flex items-start gap-3 p-3 rounded border text-xs cursor-pointer select-none transition-colors ${
                          isChecked
                            ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                            : 'bg-zinc-900/40 border-zinc-800 text-zinc-300 hover:bg-zinc-900'
                        }`}
                      >
                        <div className="mt-0.5 text-zinc-400">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Square className="w-4 h-4 text-zinc-500" />
                          )}
                        </div>
                        <div className={`flex-1 ${isChecked ? 'line-through text-zinc-400' : ''}`}>
                          {step}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-3 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Zgodność z wytycznymi Komendy Głównej PSP i procedurą Bezpieczeństwa Roju TARCZA</span>
              </div>
              <button
                onClick={onClose}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded text-xs font-medium transition-colors"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
