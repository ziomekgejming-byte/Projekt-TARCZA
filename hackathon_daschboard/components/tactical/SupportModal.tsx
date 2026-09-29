'use client';

import React, { useState } from 'react';
import { X, Radio, Phone, Satellite, ShieldAlert, Cpu, Send, CheckCircle2 } from 'lucide-react';
import { TECHNICAL_SUPPORT_INFO } from '@/lib/mock-data';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SupportModal({ isOpen, onClose }: SupportModalProps) {
  const [supportMessage, setSupportMessage] = useState('');
  const [isSent, setIsSent] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportMessage.trim()) return;
    setIsSent(true);
    setTimeout(() => {
      setIsSent(false);
      setSupportMessage('');
      onClose();
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                Wsparcie Techniczne Łączności & SOP
              </h2>
              <p className="text-xs text-zinc-400">
                Całodobowy punkt wsparcia systemów łączności kryzysowej i kryptografii
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

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Direct channels grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded bg-zinc-900/50 border border-zinc-800 text-xs">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
                <Phone className="w-3.5 h-3.5" />
                <span>Dyspozytura Główna (24/7)</span>
              </div>
              <p className="font-mono text-zinc-200">{TECHNICAL_SUPPORT_INFO.phonePrimary}</p>
              <p className="text-[11px] text-zinc-400 mt-1">Połączenie priorytetowe z dyżurnym inżynierem łączności</p>
            </div>

            <div className="p-3 rounded bg-zinc-900/50 border border-zinc-800 text-xs">
              <div className="flex items-center gap-2 text-cyan-400 font-semibold mb-1">
                <Satellite className="w-3.5 h-3.5" />
                <span>Łączność Satelitarna (Iridium)</span>
              </div>
              <p className="font-mono text-zinc-200">{TECHNICAL_SUPPORT_INFO.satelliteIridium}</p>
              <p className="text-[11px] text-zinc-400 mt-1">Dostępne w przypadku odcięcia BTS i światłowodów</p>
            </div>

            <div className="p-3 rounded bg-zinc-900/50 border border-zinc-800 text-xs">
              <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1">
                <Radio className="w-3.5 h-3.5" />
                <span>Kanał Awaryjny VHF/UHF</span>
              </div>
              <p className="font-mono text-zinc-200">{TECHNICAL_SUPPORT_INFO.radioEmergencyChannel}</p>
              <p className="text-[11px] text-zinc-400 mt-1">Podkanał CTCSS 67.0 Hz | Wywołanie KDR</p>
            </div>

            <div className="p-3 rounded bg-zinc-900/50 border border-zinc-800 text-xs">
              <div className="flex items-center gap-2 text-purple-400 font-semibold mb-1">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Centrum Kluczy Kryptograficznych</span>
              </div>
              <p className="font-mono text-zinc-200">{TECHNICAL_SUPPORT_INFO.cryptoDeskEmail}</p>
              <p className="text-[11px] text-zinc-400 mt-1">Weryfikacja certyfikatów FIDO2 i tokenów roju</p>
            </div>
          </div>

          {/* Quick Dispatch Message */}
          <div className="border-t border-zinc-800/80 pt-4">
            <span className="text-xs font-semibold text-zinc-200 block mb-1">
              Pilny Meldunek do Dyżurnego Systemu Łączności
            </span>
            <p className="text-[11px] text-zinc-400 mb-3">
              Jeśli podejrzewasz celowe zakłócanie pasma radiowego lub awarię węzła kasetowego, wyślij natychmiastowe zgłoszenie.
            </p>

            {isSent ? (
              <div className="p-4 bg-emerald-950/30 border border-emerald-500/40 rounded flex items-center gap-3 text-emerald-300 text-xs">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-semibold">Meldunek przyjęty do dyspozytury</div>
                  <div className="text-[11px] text-zinc-400">Wygenerowano bilet łączności T-KDR-8812. Inżynier weryfikuje widmo radiowe.</div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <textarea
                  value={supportMessage}
                  onChange={(e) => setSupportMessage(e.target.value)}
                  placeholder="Opisz problem (np. zanik telemetrii roju w kwadrancie C2, zakłócenia pasma 2.4 GHz)..."
                  rows={3}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded p-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                />
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-zinc-400 font-mono flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Szyfrowanie: {TECHNICAL_SUPPORT_INFO.encryptionStandard}</span>
                  </div>
                  <button
                    type="submit"
                    disabled={!supportMessage.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Wyślij Meldunek</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
