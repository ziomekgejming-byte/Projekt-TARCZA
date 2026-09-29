'use client';

import React, { useState } from 'react';
import Header from '@/components/tactical/Header';
import StartScreen from '@/components/tactical/StartScreen';
import IncidentHub from '@/components/tactical/IncidentHub';
import DashboardScreen from '@/components/tactical/DashboardScreen';
import SopModal from '@/components/tactical/SopModal';
import SupportModal from '@/components/tactical/SupportModal';
import { INITIAL_MACRO_THREATS, INITIAL_INCIDENTS } from '@/lib/mock-data';
import { Incident, DroneTelemetry } from '@/types/tarcza';

export default function Home() {
  const [currentView, setCurrentView] = useState<'START' | 'INCIDENT_HUB' | 'DASHBOARD'>('START');
  const [commanderCallsign, setCommanderCallsign] = useState<string>('KDR-WOLIN-04');
  const [activeIncident, setActiveIncident] = useState<Incident>(INITIAL_INCIDENTS[0]);
  const [activeDrones, setActiveDrones] = useState<DroneTelemetry[]>([]);

  // Modals state
  const [isSopOpen, setIsSopOpen] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  const handleLoginSuccess = (callsign: string) => {
    setCommanderCallsign(callsign);
    // Przejście do widoku pośredniego: Centrum Operacyjne (Standby)
    setCurrentView('INCIDENT_HUB');
  };

  const handleLaunchIncident = (incident: Incident, connectedDrones: DroneTelemetry[]) => {
    setActiveIncident(incident);
    setActiveDrones(connectedDrones);
    setCurrentView('DASHBOARD');
  };

  const handleBackToHub = () => {
    setCurrentView('INCIDENT_HUB');
  };

  const handleLogout = () => {
    setCurrentView('START');
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {currentView === 'START' && (
          <>
            {/* Header na Stronie Startowej: LEWO tylko logo + nazwa „TARCZA”, PRAWO tylko linki SOP i Wsparcie */}
            <Header
              onOpenSop={() => setIsSopOpen(true)}
              onOpenSupport={() => setIsSupportOpen(true)}
            />
            <StartScreen
              onLoginSuccess={handleLoginSuccess}
              threats={INITIAL_MACRO_THREATS}
            />
          </>
        )}

        {currentView === 'INCIDENT_HUB' && (
          <IncidentHub
            commanderCallsign={commanderCallsign}
            onLaunchIncident={handleLaunchIncident}
            onLogout={handleLogout}
            onOpenSop={() => setIsSopOpen(true)}
            onOpenSupport={() => setIsSupportOpen(true)}
          />
        )}

        {currentView === 'DASHBOARD' && activeIncident && (
          <DashboardScreen
            commanderCallsign={commanderCallsign}
            incident={activeIncident}
            initialDrones={activeDrones}
            onBackToHub={handleBackToHub}
            onLogout={handleLogout}
            onOpenSop={() => setIsSopOpen(true)}
            onOpenSupport={() => setIsSupportOpen(true)}
          />
        )}
      </main>

      {/* SOP Standard Operating Procedures Modal */}
      <SopModal isOpen={isSopOpen} onClose={() => setIsSopOpen(false)} />

      {/* Support & Tactical Communications Modal */}
      <SupportModal isOpen={isSupportOpen} onClose={() => setIsSupportOpen(false)} />
    </div>
  );
}
