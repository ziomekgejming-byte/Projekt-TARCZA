'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardScreen from '@/components/tactical/DashboardScreen';
import SopModal from '@/components/tactical/SopModal';
import SupportModal from '@/components/tactical/SupportModal';
import { INITIAL_INCIDENTS, CANDIDATE_DRONES_POOL, createTelemetryFromCandidate } from '@/lib/mock-data';
import { Incident, DroneTelemetry } from '@/types/tarcza';

export default function DashboardPage() {
  const params = useParams();
  const router = useRouter();
  const incidentId = (params?.incidentId as string) || INITIAL_INCIDENTS[0].id;

  const [commanderCallsign, setCommanderCallsign] = useState<string>('KDR-WOLIN-04');
  const [activeIncident, setActiveIncident] = useState<Incident>(() => {
    return INITIAL_INCIDENTS.find((i) => i.id === incidentId) || INITIAL_INCIDENTS[0];
  });
  const [activeDrones, setActiveDrones] = useState<DroneTelemetry[]>([]);
  const [isSopOpen, setIsSopOpen] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  useEffect(() => {
    // Read session
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user?.callsign) {
          setCommanderCallsign(data.user.callsign);
        } else {
          const stored = localStorage.getItem('tarcza_callsign');
          if (stored) setCommanderCallsign(stored);
        }
      })
      .catch(() => {
        const stored = localStorage.getItem('tarcza_callsign');
        if (stored) setCommanderCallsign(stored);
      });

    // Match incident by route parameter
    const matched = INITIAL_INCIDENTS.find((i) => i.id === incidentId);
    if (matched) {
      setActiveIncident(matched);
    }

    // Try reading cached drones from Hub launch
    try {
      const cached = sessionStorage.getItem(`tarcza_drones_${incidentId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setActiveDrones(parsed);
          return;
        }
      }
    } catch {
      // Fallback
    }

    // Jeśli brak dronów w sesji, wygeneruj drony domyślne dla tego incydentu
    const defaultDrones = CANDIDATE_DRONES_POOL.slice(0, 4).map((c, i) => 
      createTelemetryFromCandidate(c, matched ? matched.centerCoords : INITIAL_INCIDENTS[0].centerCoords, i)
    );
    setActiveDrones(defaultDrones);
  }, [incidentId]);

  const handleBackToHub = () => {
    router.push('/hub');
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
        <DashboardScreen
          commanderCallsign={commanderCallsign}
          incident={activeIncident}
          initialDrones={activeDrones}
          onBackToHub={handleBackToHub}
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