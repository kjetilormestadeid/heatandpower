// Utdrag av Mill-API-typene (kun feltene siten bruker). Se openapi.json for fullstendig skjema.

export type Mode = 'weekly_program' | 'comfort' | 'sleep' | 'away' | 'vacation' | 'normal' | 'always_heating' | 'off';
export type OverrideMode = 'comfort' | 'sleep' | 'away' | 'normal' | 'always_heating' | 'off';

export interface House {
  id: string;
  name: string;
  timezone: string;
  mode: Mode | null;
  isVacationModeActive: boolean;
}

export interface HousesResponse {
  ownHouses: House[];
  sharedHouses: { house: House; permissions: { changeTemperature: boolean } }[];
}

export interface Room {
  id: string;
  name: string;
  houseId: string;
  roomComfortTemperature: number | null;
  roomSleepTemperature: number | null;
  roomAwayTemperature: number | null;
  mode: Mode | null;
  activeModeFromWeeklyProgram: Exclude<Mode, 'weekly_program' | 'vacation'> | null;
  overrideModeType: 'not_continuous' | 'continuous' | null;
  overrideEndDate: number | null;
  roomProgramId: string | null;
  roomProgramName: string | null;
  averageTemperature: number | null;
  roomHumidity: number | null;
  roomHeatStatus: boolean;
  roomOpenWindowStatus: boolean;
  isRoomOnline: boolean;
  roomOnlineDevicesNumber: number;
  roomTotalDevicesNumber: number;
  roomEnergyUsage: number;
  roomMaxTemperature: string | null;
  changeTemperature: boolean;
}

export interface RoomsResponse {
  rooms: Room[];
  independentDeviceIds: string[];
}

export interface Device {
  deviceId: string;
  customName: string | null;
  houseId: string | null;
  /** null = uavhengig enhet (ikke i et rom) – kreves for timere */
  roomId: string | null;
  isConnected: boolean;
  isEnabled: boolean | null;
  deviceType: { childType: { id: string; name: string }; parentType: { id: string; name: string } };
  lastMetrics: {
    temperatureAmbient?: number;
    currentPower?: number;
    humidity?: number;
    heaterFlag?: number;
    powerStatus?: number;
  } | null;
  energyUsageForCurrentDay: number;
}

export interface RoomDevicesResponse extends Room {
  devices: Device[];
}

export const PROGRAM_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type ProgramDay = (typeof PROGRAM_DAYS)[number];
export type ProgramMode = 'comfort' | 'sleep' | 'away' | 'normal' | 'always_heating' | 'off';
/** startTime i formatet "H:mm"; første punkt hver dag er alltid "0:00" */
export interface ProgramEntry {
  startTime: string;
  temperatureType: ProgramMode;
}
export interface RoomProgram {
  id: string;
  name: string;
  houseId: string;
  data: Partial<Record<ProgramDay, ProgramEntry[]>>;
  isDefault: boolean;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type TimerSetting =
  | 'normal' | 'off' | 'always_heating' | 'HARD_OFF' | 'SOFT_OFF' | 'AUTO' | 'SLEEP' | 'BOOST' | 'TURN_ON'
  | 'MANUAL' | 'MANUAL_LEVEL1' | 'MANUAL_LEVEL2' | 'MANUAL_LEVEL3' | 'MANUAL_LEVEL4' | 'MANUAL_LEVEL5'
  | 'MANUAL_LEVEL6' | 'MANUAL_LEVEL7' | 'MANUAL_LEVEL8' | 'turn_on_with_night_mode' | 'turn_off_night_mode';

export interface DeviceTimer {
  id: string;
  name: string;
  deviceId: string;
  /** Minutter siden midnatt, lokal tid (0–1440) */
  activationTime: number;
  /** Utelatt = engangstimer */
  repeatOn?: Weekday[];
  setting: TimerSetting;
  isActive: boolean;
  createdAt: string;
}

export type NewTimer = Omit<DeviceTimer, 'id' | 'deviceId' | 'createdAt'>;

export interface StatItem {
  startTimestamp: number;
  endTimestamp: number;
  startPeriod: string;
  value: number;
  lostStatisticData: boolean;
}

export interface HouseStatistics {
  houseId: string;
  valueTotal: number;
  electricityPriceTotal: number;
  pricePerKWhAvg: number | null;
  energyUsage: { items: StatItem[] };
  roomList: { roomId: string; roomName: string; valueTotal: number; percent: number }[];
}

// --- Tibber ---
export type PriceLevel = 'VERY_CHEAP' | 'CHEAP' | 'NORMAL' | 'EXPENSIVE' | 'VERY_EXPENSIVE';
export interface TibberPrice {
  total: number;
  energy: number;
  tax: number;
  startsAt: string;
  level: PriceLevel;
  currency: string;
}
export interface TibberConsumption {
  from: string;
  to: string;
  cost: number | null;
  unitPrice: number | null;
  consumption: number | null;
  consumptionUnit: string;
  currency: string;
}
export interface TibberHomeSummary {
  id: string;
  appNickname: string | null;
  address: { address1: string | null } | null;
}
export interface TibberOverview {
  id: string;
  timeZone: string;
  appNickname: string | null;
  currentSubscription: {
    status: string;
    priceInfo: { current: TibberPrice | null; today: TibberPrice[]; tomorrow: TibberPrice[] };
  } | null;
  daily: { nodes: TibberConsumption[] };
  /** siste 30 timer */
  hourly: { nodes: TibberConsumption[] };
}

// --- Easee ---
export interface EaseeCharger {
  id: string;
  name: string | null;
  productCode: number | null;
}
export interface EaseeState {
  /** 0 offline, 1 ikke tilkoblet, 2 venter på start, 3 lader, 4 ferdig, 5 feil, 6 klar, 7 venter på autorisering */
  chargerOpMode: number;
  /** kW */
  totalPower: number;
  /** kWh */
  sessionEnergy: number;
  outputCurrent: number | null;
  dynamicChargerCurrent: number | null;
  cableLocked: boolean | null;
  isOnline: boolean;
  latestPulse: string | null;
}
export interface EaseeChargerData {
  state: EaseeState;
  /** totalEnergy i kWh per time i dag */
  hourly: { from: string; to: string; totalEnergy: number }[];
}
export type EaseeCommand = 'start' | 'stop' | 'pause' | 'resume';

// --- Philips Hue ---
export interface HueLight {
  id: string;
  name: string;
  room: string | null;
  on: boolean;
  /** 0–100, null for lamper uten dimming */
  brightness: number | null;
}
export interface HueGroup {
  /** grouped_light-id */
  id: string;
  name: string;
  kind: 'home' | 'room' | 'zone';
  /** minst én lampe i gruppen er på */
  on: boolean;
  lights: number;
  /** room-/zone-id for å endre navn (null for hele hjemmet) */
  resourceId: string | null;
  /** snitt-lysstyrke 0–100, null om gruppen ikke kan dimmes */
  brightness: number | null;
}
export interface TibberLive {
  timestamp: string;
  /** W forbruk nå */
  power: number;
  /** kWh siden midnatt */
  accumulatedConsumption: number;
  /** kr siden midnatt */
  accumulatedCost: number | null;
  minPower: number;
  averagePower: number;
  maxPower: number;
  currency: string | null;
}

// --- TP-Link Deco ---
export interface DecoClient {
  mac: string;
  name: string;
  ip: string | null;
  /** phone, pc, tablet, iot_device, … (Deco sin gjetning) */
  type: string | null;
  wired: boolean;
  /** Deco-enheten klienten er koblet til */
  deco: string | null;
  /** kB/s */
  down: number;
  up: number;
  guest: boolean;
  /** '2.4' | '5' | '6' | null (kablet/ukjent) */
  band: string | null;
}
export interface Person {
  name: string;
  macs: string[];
  home: boolean;
  /** ISO – sist en av enhetene var på nettet */
  lastSeen: string | null;
}
export interface DecoOverview {
  clients: DecoClient[];
  decos: { mac: string; name: string; online: boolean; model: string | null; firmware: string | null; role: string | null }[];
  people: Person[];
}

// --- Automasjoner ---
export interface HumidityRule {
  deviceId: string;
  houseId: string;
  name: string;
  enabled: boolean;
  /** "HH:MM" – tidsrommet styringen får slå på enheten */
  from: string;
  to: string;
  /** slå på ved fuktighet ≥ (%) */
  onAbove: number;
  /** slå av ved fuktighet ≤ (%) */
  offBelow: number;
  last?: { at: string; humidity: number | null; isOn: boolean | null; action: 'on' | 'off' | 'none'; reason: string; error?: string };
}

// --- Sonos ---
export interface SonosGroup {
  id: string;
  name: string;
  /** romnavn i gruppen */
  players: string[];
  state: 'playing' | 'paused' | 'idle' | 'buffering';
  track: { title: string | null; artist: string | null; source: string | null; image: string | null } | null;
  volume: number | null;
  muted: boolean;
}
export interface SonosOverview {
  householdId: string;
  groups: SonosGroup[];
  favorites: { id: string; name: string; image: string | null }[];
}
export type SonosCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous';

// --- Feilsøking ---
export interface MillDiag {
  id: string;
  name: string;
  model: string;
  type: string;
  house: string;
  room: string;
  mac: string | null;
  millConnected: boolean;
  wifi: { ip: string | null; band: string | null; deco: string | null; guest: boolean } | null;
  /** ok | cloud (på wifi, ikke i skyen) | nowifi | offline | unknown */
  verdict: 'ok' | 'cloud' | 'nowifi' | 'offline' | 'unknown';
  hint: string;
}
export interface MillNetworkDiagnostics {
  checkedAt: string;
  devices: MillDiag[];
  candidates: { mac: string; name: string; ip: string | null; band: string | null; deco: string | null; reason: string }[];
  deco: { clients: number; units: { mac: string; name: string; online: boolean; model: string | null; firmware: string | null; role: string | null }[] } | null;
  decoError: string | null;
}

// --- Kalender (ICS) ---
export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO-tidspunkt, eller YYYY-MM-DD for heldagshendelser */
  start: string;
  /** Eksklusiv slutt: ISO-tidspunkt, eller YYYY-MM-DD (dagen etter siste dag) for heldagshendelser */
  end: string;
  allDay: boolean;
  location: string | null;
  calendar: string | null;
}
