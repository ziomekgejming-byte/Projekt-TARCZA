'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { MacroThreat } from '@/types/tarcza';
import {
  KeyRound,
  HardDrive,
  MessageSquare,
  Mail,
  ShieldCheck,
  AlertCircle,
  Radio,
  Wifi,
  Server,
  ArrowRight,
  FileCheck
} from 'lucide-react';

const TacticalMacroMapDynamic = dynamic(
  () => import('./TacticalMacroMap'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-500 font-mono text-xs">
        <div className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin" />
          <span>Inicjalizacja podkładu kartograficznego...</span>
        </div>
      </div>
    ),
  }
);

interface StartScreenProps {
  onLoginSuccess: (callsign: string) => void;
  threats: MacroThreat[];
  onOpenSop?: () => void;
  onOpenSupport?: () => void;
}

export default function StartScreen({
  onLoginSuccess,
  threats,
}: StartScreenProps) {
  // Empty initial fields as specified in Etap 2
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

  // 4 second-factor methods: (1) Klucz sprzętowy, (2) Pendrive, (3) SMS, (4) E-mail
  const [secondFactorMethod, setSecondFactorMethod] = useState<'HARDWARE_KEY' | 'PENDRIVE' | 'SMS' | 'EMAIL'>('HARDWARE_KEY');
  const [mfaCode, setMfaCode] = useState('');
  const [selectedFileKeyName, setSelectedFileKeyName] = useState<string | null>(null);
  const [webAuthnStatus, setWebAuthnStatus] = useState<string | null>(null);

  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Dynamic tactical footer telemetry
  const [telemetryTick, setTelemetryTick] = useState(0);
  const [activeNodesCount, setActiveNodesCount] = useState('12/12 AKTYWNYCH (WAW, KRA, GDN)');
  const [radioAvailability, setRadioAvailability] = useState('868 MHz [99.4%] · 433 MHz [98.2%]');
  const [connectivityMode, setConnectivityMode] = useState('ONLINE (RTT 14ms)');

  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetryTick((prev) => {
        const next = prev + 1;
        if (next % 3 === 0) {
          const rtt = Math.floor(12 + Math.random() * 8);
          setConnectivityMode(`ONLINE (RTT ${rtt}ms)`);
        } else if (next % 3 === 1) {
          const quality868 = (98.5 + Math.random() * 1.4).toFixed(1);
          const quality433 = (97.5 + Math.random() * 1.8).toFixed(1);
          setRadioAvailability(`868 MHz [${quality868}%] · 433 MHz [${quality433}%]`);
        } else {
          setActiveNodesCount(next % 2 === 0 ? '12/12 AKTYWNYCH (KLASTER KDR)' : '12/12 WĘZŁÓW W SYNCHRONIZACJI');
        }
        return next;
      });
    }, 3500);

    return () => clearInterval(interval);
  }, []);

  // WebAuthn hardware key probe
  const handleProbeHardwareKey = async () => {
    setWebAuthnStatus('Oczekiwanie na interakcję z kluczem sprzętowym...');
    try {
      if (typeof window !== 'undefined' && window.PublicKeyCredential) {
        setWebAuthnStatus('Gotowy. Dotknij klucz tokenu sprzętowego FIDO2.');
      } else {
        setWebAuthnStatus('Brak natywnego API WebAuthn – użyj tokenu USB lub metody alternatywnej.');
      }
    } catch {
      setWebAuthnStatus('Klucz nie został potwierdzony. Spróbuj ponownie.');
    }
  };

  // Handle pendrive file upload
  const handleKeyFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFileKeyName(file.name);
      setAuthError(null);
    }
  };

  // Form submit handler with validation
  const handleSubmitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    // Validation: login and password required
    if (!login.trim()) {
      setAuthError('Wymagany identyfikator KDR.');
      return;
    }
    if (!password.trim()) {
      setAuthError('Wymagane hasło dostępowe.');
      return;
    }

    // Second-factor validations
    if (secondFactorMethod === 'PENDRIVE' && !selectedFileKeyName) {
      setAuthError('Wczytaj plik klucza kryptograficznego z pendrive (.key, .pem).');
      return;
    }

    if ((secondFactorMethod === 'SMS' || secondFactorMethod === 'EMAIL') && mfaCode.trim().length < 6) {
      setAuthError('Wprowadź 6-cyfrowy kod autoryzacji.');
      return;
    }

    setIsAuthenticating(true);

    if (secondFactorMethod === 'HARDWARE_KEY' && typeof window !== 'undefined' && window.PublicKeyCredential) {
      setWebAuthnStatus('Weryfikacja tokenu FIDO2...');
    }

    setTimeout(() => {
      setIsAuthenticating(false);
      onLoginSuccess(login.trim());
    }, 600);
  };

  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Pod headerem dwa panele: lewy 30%, prawy 70% (grid-cols-[30%_70%], na mobile jeden pod drugim) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[30%_70%] min-h-0 overflow-hidden">
        {/* Lewy panel = tylko formularz logowania */}
        <div className="border-b lg:border-b-0 lg:border-r border-zinc-800 bg-zinc-950 flex flex-col justify-between p-5 lg:p-6 overflow-y-auto">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200 tracking-wide font-mono uppercase mb-4 pb-2 border-b border-zinc-800">
              Autoryzacja Dostępowa
            </h2>

            {authError && (
              <div className="mb-4 p-2.5 bg-rose-950/40 border border-rose-500/50 rounded flex items-start gap-2 text-rose-300 text-xs">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitLogin} className="space-y-4">
              {/* Login Field */}
              <div>
                <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1">
                  Identyfikator KDR
                </label>
                <input
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="Wprowadź identyfikator KDR"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-1">
                  Hasło
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Wprowadź hasło"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              {/* Drugi składnik (wymagany): 4 opcje w prostym przełączniku */}
              <div className="pt-2">
                <label className="block text-[11px] font-mono uppercase text-zinc-400 mb-2">
                  Drugi Składnik Uwierzytelnienia (MFA)
                </label>
                <div className="grid grid-cols-2 gap-1.5 mb-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSecondFactorMethod('HARDWARE_KEY');
                      handleProbeHardwareKey();
                    }}
                    className={`flex items-center gap-1.5 p-2 rounded border text-left text-xs transition-colors cursor-pointer ${
                      secondFactorMethod === 'HARDWARE_KEY'
                        ? 'bg-zinc-800 border-emerald-500 text-emerald-300 font-medium'
                        : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <KeyRound className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Klucz sprzętowy</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSecondFactorMethod('PENDRIVE')}
                    className={`flex items-center gap-1.5 p-2 rounded border text-left text-xs transition-colors cursor-pointer ${
                      secondFactorMethod === 'PENDRIVE'
                        ? 'bg-zinc-800 border-emerald-500 text-emerald-300 font-medium'
                        : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <HardDrive className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Pendrive (plik)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSecondFactorMethod('SMS')}
                    className={`flex items-center gap-1.5 p-2 rounded border text-left text-xs transition-colors cursor-pointer ${
                      secondFactorMethod === 'SMS'
                        ? 'bg-zinc-800 border-emerald-500 text-emerald-300 font-medium'
                        : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">SMS</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSecondFactorMethod('EMAIL')}
                    className={`flex items-center gap-1.5 p-2 rounded border text-left text-xs transition-colors cursor-pointer ${
                      secondFactorMethod === 'EMAIL'
                        ? 'bg-zinc-800 border-emerald-500 text-emerald-300 font-medium'
                        : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">E-mail</span>
                  </button>
                </div>

                {/* Second Factor Interactive Inputs */}
                {secondFactorMethod === 'HARDWARE_KEY' && (
                  <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded text-xs space-y-1.5">
                    <div className="flex items-center gap-2 text-zinc-300 font-mono text-[11px]">
                      <KeyRound className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{webAuthnStatus || 'Wepnij klucz sprzętowy FIDO2 / U2F'}</span>
                    </div>
                  </div>
                )}

                {secondFactorMethod === 'PENDRIVE' && (
                  <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded text-xs space-y-2">
                    <label className="block text-[11px] font-mono text-zinc-400">
                      Wczytaj plik certyfikatu / klucza (.key, .pem):
                    </label>
                    <div className="relative">
                      <input
                        type="file"
                        accept=".key,.pem,.crt,.bin"
                        onChange={handleKeyFileUpload}
                        className="w-full text-xs text-zinc-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer"
                      />
                    </div>
                    {selectedFileKeyName && (
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
                        <FileCheck className="w-3.5 h-3.5" />
                        <span>Wczytano: {selectedFileKeyName}</span>
                      </div>
                    )}
                  </div>
                )}

                {(secondFactorMethod === 'SMS' || secondFactorMethod === 'EMAIL') && (
                  <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded text-xs space-y-1.5">
                    <label className="block text-[11px] font-mono text-zinc-400">
                      {secondFactorMethod === 'SMS' ? 'Kod SMS (6 cyfr):' : 'Kod z wiadomości E-mail (6 cyfr):'}
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-center text-xs font-mono tracking-widest text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>

              {/* PRZYCISK „Autoryzuj dostęp” */}
              <button
                type="submit"
                disabled={isAuthenticating}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded font-medium text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md cursor-pointer mt-2"
              >
                {isAuthenticating ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Weryfikacja tożsamości...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Autoryzuj dostęp</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Optional Demo Mode Button (hidden by default unless NEXT_PUBLIC_DEMO_MODE=true) */}
          {isDemoMode && (
            <div className="pt-4 border-t border-zinc-800/80 mt-4">
              <button
                type="button"
                onClick={() => onLoginSuccess('KDR-DEMO-WARSZAWA')}
                className="w-full py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded transition-colors cursor-pointer"
              >
                Logowanie demonstracyjne (Demo Mode)
              </button>
            </div>
          )}
        </div>

        {/* Prawy panel = tylko makro-mapa z Etapu 1 */}
        <div className="h-full min-h-0 overflow-hidden flex flex-col">
          <TacticalMacroMapDynamic threats={threats} />
        </div>
      </div>

      {/* Stopka taktyczna (NIE „copyright”): paski statusu, ale DYNAMICZNE (wartości zmieniają się co kilka sekund) */}
      <footer className="w-full bg-zinc-950 border-t border-zinc-800 px-4 py-2 select-none z-20 shrink-0">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          {/* Status 1: Status węzłów lokalnych */}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <div className="truncate">
              <span className="text-zinc-500 font-mono text-[10px] block leading-none">WĘZŁY LOKALNE:</span>
              <span className="text-zinc-300 font-mono text-[11px]">{activeNodesCount}</span>
            </div>
          </div>

          {/* Status 2: Dostępność pasm radiowych */}
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <div className="truncate">
              <span className="text-zinc-500 font-mono text-[10px] block leading-none">PASMA RADIOWE:</span>
              <span className="text-zinc-300 font-mono text-[11px]">{radioAvailability}</span>
            </div>
          </div>

          {/* Status 3: Tryb łączności */}
          <div className="flex items-center gap-2">
            <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <div className="truncate">
              <span className="text-zinc-500 font-mono text-[10px] block leading-none">TRYB ŁĄCZNOŚCI:</span>
              <span className="text-zinc-300 font-mono text-[11px]">{connectivityMode}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
