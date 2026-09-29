'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/tactical/Header';
import StartScreen from '@/components/tactical/StartScreen';
import SopModal from '@/components/tactical/SopModal';
import SupportModal from '@/components/tactical/SupportModal';
import { INITIAL_MACRO_THREATS } from '@/lib/mock-data';
import { MacroThreat } from '@/types/tarcza';

export default function Home() {
  const router = useRouter();
  const [threats, setThreats] = useState<MacroThreat[]>(INITIAL_MACRO_THREATS);
  const [isSopOpen, setIsSopOpen] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  useEffect(() => {
    // Check if user is already authenticated
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          router.push('/hub');
        }
      })
      .catch(() => {});

    // Fetch real live IMGW-PIB open data threats
    fetch('/api/threats/live')
      .then((res) => res.json())
      .then((data) => {
        if (data.threats && Array.isArray(data.threats)) {
          setThreats(data.threats);
        }
      })
      .catch(() => {});
  }, [router]);

  const handleLoginSuccess = (callsign: string) => {
    localStorage.setItem('tarcza_callsign', callsign);
    router.push('/hub');
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Header
          onOpenSop={() => setIsSopOpen(true)}
          onOpenSupport={() => setIsSupportOpen(true)}
        />
        <StartScreen
          onLoginSuccess={handleLoginSuccess}
          threats={threats}
        />
      </main>

      <SopModal isOpen={isSopOpen} onClose={() => setIsSopOpen(false)} />
      <SupportModal isOpen={isSupportOpen} onClose={() => setIsSupportOpen(false)} />
    </div>
  );
}
