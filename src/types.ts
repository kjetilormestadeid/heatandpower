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
}
