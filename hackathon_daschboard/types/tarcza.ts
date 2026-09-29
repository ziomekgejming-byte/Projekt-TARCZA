export type ThreatLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface MacroThreat {
  id: string;
  title: string;
  type: 'FIRE' | 'FLOOD' | 'ROAD_BLOCK' | 'HAZMAT' | 'STORM';
  region: string;
  voivodeship: string;
  coords: [number, number]; // [lat, lng]
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
  battery: number; // 0 - 100
  altitude: number; // meters AGL
  speed: number; // km/h
  status: 'PATROL' | 'RETURNING_HOTSWAP' | 'HOVERING' | 'PAYLOAD_DEPLOYED' | 'BATTERY_CRITICAL';
  coords: [number, number]; // [lat, lng]
  vector: { dLat: number; dLng: number };
  payload: DronePayloadType;
  assignedHotSwapId?: string;
  cameraFeedUrl?: string;
  // Pairing & Hardware status
  pairingStatus?: 'CONNECTED' | 'PAIRING' | 'DISCONNECTED' | 'STANDBY';
  isPaired?: boolean;
  signalRssi?: number; // e.g. -54 dBm
  frequencyBand?: string; // '868 MHz FHSS' | '2.4 GHz AES'
  firmwareVersion?: string;
  // Movement Waypoint & Physics System
  targetWaypoint?: [number, number];
  hoverDurationRemaining?: number; // seconds remaining in HOVERING state
  patrolSector?: string;
  headingDeg?: number;
  // Dynamic External Swarm
  isExternalSupport?: boolean;
  // Dynamic Edge Wind Sensing
  observedWind?: {
    speedKmh: number;
    directionDeg: number;
    sectorVariation?: string;
    temperatureOffsetC?: number;
  };
}

export interface HotSwapStation {
  id: string;
  name: string;
  coords: [number, number]; // [lat, lng]
  radiusMeters?: number;
  availablePacks: number;
  chargingPacks: number;
  dronesInQueue: string[];
}

export interface FireCell {
  id: string;
  coords: [number, number]; // center of 10m x 10m cell
  bounds: [[number, number], [number, number]]; // lat/lng bounding box
  temperature: number; // in Celsius e.g. 150 - 950°C
  intensity: number; // 0.0 - 1.0
  fuelRemaining: number; // 0 - 100%
  isExtinguished?: boolean;
  sector?: string;
}

export interface TacticalMarker {
  id: string;
  type:
    | 'VICTIM'
    | 'VICTIM_OUTSIDE'
    | 'FIRE_ZONE'
    | 'HAZMAT'
    | 'COLLAPSE_RISK'
    | 'FRIENDLY_UNIT'
    | 'CLUE'
    | 'STRUCTURAL_DAMAGE'
    | 'HYDRANT'
    | 'KDR_STATION';
  sector: string;
  coords: [number, number]; // [lat, lng]
  label: string;
  details: string;
  severity?: ThreatLevel;
  vitals?: string;
  trappedCount?: number;
  temperature?: number; // for fire/thermal
  status?: string;
  radiusMeters?: number;
  // Visibility & Occlusion System
  isInsideBuilding?: boolean;
  buildingId?: string;
  isDiscovered?: boolean; // false until detected by thermal/LiDAR/unit
  detectionMethod?: 'OPTIC' | 'FLIR' | 'ACOUSTIC' | 'LIDAR' | 'RESCUE_TEAM' | 'NONE';
  // Survival timer & consequence
  timeLimitSeconds?: number;
  survivalSecondsLeft?: number;
  survivalTimer?: number; // alias
  isLost?: boolean;
  // Friendly unit tasks and reports
  currentTask?: 'FIRE_FIGHTING' | 'EVACUATION' | 'STANDBY';
  unitStatus?: 'ON_ROUTE' | 'INSIDE_BUILDING' | 'SEARCHING' | 'WATER_PUMPING' | 'EXTINGUISHING' | 'STANDBY' | 'TRAPPED';
  waterLevel?: number; // percent or liters
  crewCount?: number;
  reportStatus?: string;
  targetMarkerId?: string;
  insideBuildingId?: string;
  connectedWaterSourceId?: string;
  hasInfiniteWaterSupply?: boolean;
  navigationPath?: [number, number][];
  // Hose & Logistics
  hoseLineDistanceMeters?: number;
  hoseConnectedToHydrant?: boolean;
  isBlockedByDamage?: boolean;
  hoseRoute?: [number, number][];
  // Clues & Damage mapping
  clueType?: 'FOOTPRINT' | 'PERSONAL_ITEM' | 'BLOOD_TRACE' | 'VEHICLE_TRACK';
  damageLevel?: 'COLLAPSED_WALL' | 'ROOF_BREACH' | 'DEBRIS_FIELD' | 'CRATER';
}

export interface FriendlyUnit {
  id: string;
  callsign: string;
  type: 'PSP_GBA' | 'PSP_GCBA' | 'OSP' | 'ZRM' | 'SOP';
  coords: [number, number];
  sector: string;
  currentTask: 'FIRE_FIGHTING' | 'EVACUATION' | 'STANDBY';
  unitStatus?: 'ON_ROUTE' | 'INSIDE_BUILDING' | 'SEARCHING' | 'WATER_PUMPING' | 'EXTINGUISHING' | 'STANDBY' | 'TRAPPED';
  waterLevel: number;
  crewCount: number;
  reportStatus?: string;
  operationalZone?: string;
  maxHoseLengthMeters?: number;
  currentHoseLengthMeters?: number;
  connectedHydrantId?: string;
  connectedWaterSourceId?: string;
  hasInfiniteWaterSupply?: boolean;
  insideBuildingId?: string;
  isBlocked?: boolean;
  navigationPath?: [number, number][];
}

export interface TacticalZone {
  id: string;
  name: string;
  type: 'DANGER_ZONE' | 'NO_FLY' | 'SEARCH_AREA' | 'WATER_CURTAIN' | 'COMMAND_BUFFER' | 'DAMAGE_ZONE';
  polygon: [number, number][]; // Precyzyjny wielokąt wyznaczony przez KDR
  bounds?: [[number, number], [number, number]]; // Opcjonalny prostokąt ograniczający
  color: string;
  createdAt: string;
  assignedUnit?: string;
  damageDescription?: string;
  isExtinguished?: boolean;
  extinguishProgress?: number; // 0 - 100%
  areaM2?: number;
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
  windDirectionDeg: number; // 0 = N, 90 = E, 180 = S, 270 = W
  windDirectionName: string; // e.g. "SW (Południowo-Zachodni)"
  temperatureC: number;
  humidityPercent: number;
  sectorVariations?: Record<string, { speedKmh: number; directionDeg: number; gustKmh: number }>;
}

export interface Incident {
  id: string;
  code: string;
  name: string;
  threatType: IncidentThreatType;
  status: 'ACTIVE' | 'STANDBY' | 'CONTAINED' | 'ARCHIVED';
  severity: ThreatLevel;
  locationName: string;
  centerCoords: [number, number]; // [lat, lng]
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
  // Logistics & Command setup
  hasHydrantAccess?: boolean;
  kdrPosition?: [number, number];
  temperatureGrid?: FireCell[];

  participants?: Participant[];
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

export interface Participant {
  id: string;
  callsign: string;
  unitType: 'KDR' | 'PSP' | 'OSP' | 'ZRM' | 'INNE';
  position: [number, number];
  crewCount: number;
  waterLiters: number;
  hoseLengthMeters: number;
  equipment: string[];
  positionNote?: string;
  joinedAt: string;
  droneIds: string[];
  hotSwapId?: string;
}