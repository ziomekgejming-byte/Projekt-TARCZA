export type ThreatLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface MacroThreat {
  id: string;
  title: string;
  type: 'FIRE' | 'FLOOD' | 'ROAD_BLOCK' | 'HAZMAT' | 'STORM';
  region: string;
  voivodeship: string;
  coords: [number, number];
  severity: ThreatLevel;
  source: 'OSINT' | 'IMGW' | 'PSP' | 'SENTINEL-2' | 'POLICJA';
  timestamp: string;
  description: string;
  activeUnits: number;
}

export type DronePayloadType = 'THERMAL_FLIR' | 'FIRST_AID_DROP' | 'ACOUSTIC_MEGAPHONE' | 'LIDAR_STRUCTURAL';

export interface DroneTelemetry {
  id: string;
  callsign: string;
  model: string;
  battery: number;
  altitude: number;
  speed: number;
  status: 'PATROL' | 'RETURNING_HOTSWAP' | 'HOVERING' | 'PAYLOAD_DEPLOYED' | 'BATTERY_CRITICAL';
  coords: [number, number];
  vector: { dLat: number; dLng: number };
  payload: DronePayloadType;
  assignedHotSwapId?: string;
  cameraFeedUrl?: string;
  pairingStatus?: 'CONNECTED' | 'PAIRING' | 'DISCONNECTED' | 'STANDBY';
  isPaired?: boolean;
  signalRssi?: number;
  frequencyBand?: string;
  firmwareVersion?: string;
  targetWaypoint?: [number, number];
  hoverDurationRemaining?: number;
  patrolSector?: string;
  headingDeg?: number;
  isExternalSupport?: boolean;
}

export interface HotSwapStation {
  id: string;
  name: string;
  coords: [number, number];
  radiusMeters?: number;
  availablePacks: number;
  chargingPacks: number;
  dronesInQueue: string[];
}

export interface TacticalMarker {
  id: string;
  type: 'VICTIM' | 'FIRE_ZONE' | 'HAZMAT' | 'COLLAPSE_RISK' | 'FRIENDLY_UNIT';
  sector: string;
  coords: [number, number];
  label: string;
  details: string;
  severity?: ThreatLevel;
  vitals?: string;
  trappedCount?: number;
  temperature?: number;
  status?: string;
  radiusMeters?: number;
  isInsideBuilding?: boolean;
  buildingId?: string;
  isDiscovered?: boolean;
  detectionMethod?: 'OPTIC' | 'FLIR' | 'ACOUSTIC' | 'LIDAR' | 'RESCUE_TEAM' | 'NONE';
  timeLimitSeconds?: number;
  survivalSecondsLeft?: number;
  survivalTimer?: number;
  isLost?: boolean;
  currentTask?: 'FIRE_FIGHTING' | 'EVACUATION' | 'STANDBY';
  waterLevel?: number;
  crewCount?: number;
  reportStatus?: string;
  targetMarkerId?: string;
}

export interface FriendlyUnit {
  id: string;
  callsign: string;
  type: 'PSP_GBA' | 'PSP_GCBA' | 'OSP' | 'ZRM' | 'SOP';
  coords: [number, number];
  sector: string;
  currentTask: 'FIRE_FIGHTING' | 'EVACUATION' | 'STANDBY';
  waterLevel: number;
  crewCount: number;
  reportStatus?: string;
  operationalZone?: string;
}

export interface TacticalZone {
  id: string;
  name: string;
  type: 'DANGER_ZONE' | 'NO_FLY' | 'SEARCH_AREA' | 'WATER_CURTAIN' | 'COMMAND_BUFFER';
  bounds: [[number, number], [number, number]];
  polygon?: [number, number][];
  color: string;
  createdAt: string;
  assignedUnit?: string;
}

export interface DecisionAlert {
  id: string;
  timestamp: string;
  sector: string;
  title: string;
  description: string;
  severity: ThreatLevel;
  recommendedAction: string;
  source: 'EDGE_AI' | 'CLOUD_AI' | 'DRONE_SENSOR' | 'KDR_RADIO';
  actionTaken?: boolean;
}

export interface SopProcedure {
  id: string;
  code: string;
  title: string;
  category: string;
  priority: 'WYSOKI' | 'KRYTYCZNY' | 'STANDARD';
  steps: string[];
  lastUpdate: string;
}

export type IncidentThreatType = 'FIRE' | 'HAZMAT' | 'COLLAPSE' | 'SEARCH_RESCUE' | 'FLOOD' | 'TRANSPORT';

export interface WeatherCondition {
  windSpeedKmh: number;
  windDirectionDeg: number;
  windDirectionName: string;
  temperatureC: number;
  humidityPercent: number;
}

export interface Incident {
  id: string;
  code: string;
  name: string;
  threatType: IncidentThreatType;
  status: 'ACTIVE' | 'STANDBY' | 'CONTAINED' | 'ARCHIVED';
  severity: ThreatLevel;
  locationName: string;
  centerCoords: [number, number];
  createdAt: string;
  commanderCallsign: string;
  assignedUnitsCount: number;
  description: string;
  tacticalMarkers: TacticalMarker[];
  decisionAlerts: DecisionAlert[];
  hotSwapStations: HotSwapStation[];
  suggestedEvacuationCorridor?: string;
  zones?: TacticalZone[];
  weather?: WeatherCondition;
}

export interface ScannedDroneCandidate {
  id: string;
  callsign: string;
  model: string;
  macAddress: string;
  signalRssi: number;
  battery: number;
  payload: DronePayloadType;
  frequencyBand: string;
  isPairedPreviously?: boolean;
}