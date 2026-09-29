import { DroneTelemetry, HotSwapStation, Incident, Participant, TacticalMarker } from '@/types/tarcza';
import { CANDIDATE_DRONES_POOL, createTelemetryFromCandidate } from '@/lib/mock-data';
import { haversineDistanceMeters } from '@/lib/offline-maps-data';

const STORAGE_KEY = 'tarcza_incidents_v2';
const CHANNEL_NAME = 'tarcza_incidents_channel';

type Listener = (incidents: Incident[]) => void;

function isBrowser() {
  return typeof window !== 'undefined';
}

export function loadIncidents(): Incident[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Incident[]) : [];
  } catch {
    return [];
  }
}

export function saveIncidents(incidents: Incident[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(incidents));
  } catch {
    // brak miejsca / tryb prywatny - ignorujemy
  }
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: 'incidents-changed' });
    channel.close();
  } catch {
    // BroadcastChannel niedostępny - zostaje zdarzenie "storage"
  }
}

export function getIncident(id: string): Incident | undefined {
  return loadIncidents().find((i) => i.id === id);
}

export function upsertIncident(incident: Incident): Incident[] {
  const all = loadIncidents();
  const idx = all.findIndex((i) => i.id === incident.id);
  const next = idx >= 0 ? all.map((i) => (i.id === incident.id ? incident : i)) : [incident, ...all];
  saveIncidents(next);
  return next;
}

export function removeIncident(id: string): Incident[] {
  const next = loadIncidents().filter((i) => i.id !== id);
  saveIncidents(next);
  return next;
}

export function subscribeIncidents(listener: Listener): () => void {
  if (!isBrowser()) return () => {};

  const notify = () => listener(loadIncidents());

  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) notify();
  };
  window.addEventListener('storage', onStorage);

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = notify;
  } catch {
    channel = null;
  }

  return () => {
    window.removeEventListener('storage', onStorage);
    channel?.close();
  };
}

export function createMarkerForParticipant(p: Participant): TacticalMarker {
  const equipmentText = p.equipment.length > 0 ? p.equipment.join(', ') : 'brak dodatkowego sprzętu';
  return {
    id: `UNIT-${p.id}`,
    type: 'FRIENDLY_UNIT',
    sector: 'STANOWISKO WŁASNE',
    coords: p.position,
    label: p.callsign,
    details: `Obsada: ${p.crewCount} os. · Woda: ${p.waterLiters} l · Linie: ${p.hoseLengthMeters} m · Sprzęt: ${equipmentText}.${
      p.positionNote ? ` Stanowisko: ${p.positionNote}.` : ''
    }`,
    status: 'NA STANOWISKU',
    currentTask: 'STANDBY',
    unitStatus: 'STANDBY',
    waterLevel: 100,
    crewCount: p.crewCount,
    reportStatus: `Jednostka zgłosiła gotowość na wskazanym stanowisku (${new Date(p.joinedAt).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    })}).`,
  };
}

export function addParticipantToIncident(
  incidentId: string,
  participant: Participant,
  hotSwap?: HotSwapStation
): Incident | null {
  const all = loadIncidents();
  const incident = all.find((i) => i.id === incidentId);
  if (!incident) return null;

  const updated: Incident = {
    ...incident,
    participants: [...(incident.participants || []).filter((p) => p.id !== participant.id), participant],
    tacticalMarkers:
      participant.unitType === 'KDR'
        ? incident.tacticalMarkers
        : [
            ...incident.tacticalMarkers.filter((m) => m.id !== `UNIT-${participant.id}`),
            createMarkerForParticipant(participant),
          ],
    hotSwapStations: hotSwap
      ? [...incident.hotSwapStations.filter((h) => h.id !== hotSwap.id), hotSwap]
      : incident.hotSwapStations,
    assignedUnitsCount: (incident.participants?.filter((p) => p.id !== participant.id).length ?? 0) + 1,
  };

  saveIncidents(all.map((i) => (i.id === incidentId ? updated : i)));
  return updated;
}

export function buildDronesFromIncident(incident: Incident, alreadyKnownIds: string[] = []): DroneTelemetry[] {
  const result: DroneTelemetry[] = [];
  let index = alreadyKnownIds.length;

  (incident.participants || []).forEach((p) => {
    p.droneIds.forEach((droneId) => {
      if (alreadyKnownIds.includes(droneId) || result.some((d) => d.id === droneId)) return;
      const candidate = CANDIDATE_DRONES_POOL.find((c) => c.id === droneId);
      if (!candidate) return;

      const own = incident.hotSwapStations.find((h) => h.id === p.hotSwapId);
      const nearest = [...incident.hotSwapStations].sort(
        (a, b) => haversineDistanceMeters(a.coords, p.position) - haversineDistanceMeters(b.coords, p.position)
      )[0];
      const launch = own?.coords || nearest?.coords || p.position;

      result.push({ ...createTelemetryFromCandidate(candidate, launch, index++), assignedHotSwapId: own?.id || nearest?.id });
    });
  });

  return result;
}