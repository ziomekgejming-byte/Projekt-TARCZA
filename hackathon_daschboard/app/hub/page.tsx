'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import IncidentHub from '@/components/tactical/IncidentHub';
import SopModal from '@/components/tactical/SopModal';
import SupportModal from '@/components/tactical/SupportModal';
import { Incident, DroneTelemetry } from '@/types/tarcza';

export default function HubPage() {
  const router = useRouter();
  const [commanderCallsign, setCommanderCallsign] = useState<string>('KDR-WOLIN-04');
  const [isSopOpen, setIsSopOpen] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  useEffect(() => {
    // Check real session from API
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user?.callsign) {
          setCommanderCallsign(data.user.callsign);
          localStorage.setItem('tarcza_callsign', data.user.callsign);
        } else {
          const stored = localStorage.getItem('tarcza_callsign');
          if (stored) setCommanderCallsign(stored);
        }
      })
      .catch(() => {
        const stored = localStorage.getItem('tarcza_callsign');
        if (stored) setCommanderCallsign(stored);
      });
  }, []);

  const handleLaunchIncident = (incident: Incident, connectedDrones: DroneTelemetry[]) => {
    // Save selected drones into session cache if needed
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(`tarcza_drones_${incident.id}`, JSON.stringify(connectedDrones));
    }
    router.push(`/dashboard/${incident.id}`);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    localStorage.removeItem('tarcza_callsign');
    router.push('/');
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <IncidentHub
          commanderCallsign={commanderCallsign}
          onLaunchIncident={handleLaunchIncident}
          onLogout={handleLogout}
          onOpenSop={() => setIsSopOpen(true)}
          onOpenSupport={() => setIsSupportOpen(true)}
        />
      </main>

      <SopModal isOpen={isSopOpen} onClose={() => setIsSopOpen(false)} />
      <SupportModal isOpen={isSupportOpen} onClose={() => setIsSupportOpen(false)} />
    </div>
  );
}
