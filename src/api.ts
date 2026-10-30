import type {
  Device,
  DeviceTimer,
  HouseStatistics,
  NewTimer,
  HousesResponse,
  OverrideMode,
  RoomDevicesResponse,
  RoomProgram,
  TibberHomeSummary,
  TibberOverview,
  RoomsResponse,
  EaseeCharger,
  EaseeChargerData,
  EaseeCommand,
  HueLight,
  HueGroup,
  TibberLive,
  DecoOverview,
  Person,
  HumidityRule,
  SonosCommand,
  SonosOverview,
  MillNetworkDiagnostics,
  CalendarEvent,
  AppliancesResponse,
  Appliance,
  PowerSample,
  IdentifyAnalysis,
  PowerStepRaw,
  WeatherPlaces,
  PlaceHit,
  Forecast,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Kalles når backenden svarer 401 (sesjonen er borte). */
export let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/** Lesinger som henger (nettbrett som våkner, halvdød Wi-Fi) må gi opp, ellers står pollingen fast. */
const READ_TIMEOUT_MS = 30_000;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    signal: method === 'GET' ? AbortSignal.timeout(READ_TIMEOUT_MS) : undefined,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized();
    const message =
      data?.error?.message ??
      (res.status === 429 ? 'For mange forespørsler mot Mill (maks 2500/time). Vent litt.' : `Feil ${res.status}`);
    throw new ApiError(res.status, message);
  }
  return data as T;
}

const mill = <T>(method: string, path: string, body?: unknown) => request<T>(method, `/api/mill${path}`, body);

export const api = {
  me: () => request<{ login: string }>('GET', '/api/auth/me'),
  login: (login: string, password: string) => request<{ login: string }>('POST', '/api/auth/login', { login, password }),
  logout: () => request('POST', '/api/auth/logout'),

  houses: () => mill<HousesResponse>('GET', '/houses'),
  rooms: (houseId: string) => mill<RoomsResponse>('GET', `/houses/${houseId}/rooms`),
  roomDevices: (roomId: string) => mill<RoomDevicesResponse>('GET', `/rooms/${roomId}/devices`),

  roomPrograms: (houseId: string) => mill<{ items: RoomProgram[] }>('GET', `/houses/${houseId}/roomPrograms`),
  createRoomProgram: (houseId: string, name: string) =>
    mill<{ roomProgram: RoomProgram }>('POST', `/houses/${houseId}/roomPrograms`, { name }),
  updateRoomProgram: (houseId: string, programId: string, patch: Pick<RoomProgram, 'name' | 'data'>) =>
    mill<RoomProgram>('PATCH', `/houses/${houseId}/roomPrograms/${programId}`, patch),
  setRoomProgram: (roomId: string, roomProgramId: string | null) =>
    mill('POST', `/rooms/${roomId}/program`, { roomProgramId }),

  renameRoom: (roomId: string, name: string) => mill('PATCH', `/rooms/${roomId}`, { name }),

  setRoomTemperature: (
    roomId: string,
    temps: { roomComfortTemperature?: number; roomSleepTemperature?: number; roomAwayTemperature?: number },
  ) => mill('POST', `/rooms/${roomId}/temperature`, temps),

  overrideRoom: (roomId: string, mode: OverrideMode, endDate: number | null) =>
    mill(
      'POST',
      `/rooms/${roomId}/mode/override`,
      endDate
        ? { mode, overrideModeType: 'not_continuous', overrideEndDate: endDate }
        : { mode, overrideModeType: 'continuous' },
    ),
  cancelRoomOverride: (roomId: string) => mill('DELETE', `/rooms/${roomId}/mode/override`),

  independentDevices: (houseId: string) =>
    mill<{ items: Device[] }>('GET', `/houses/${houseId}/devices/independent?filterDevices=allDevice`),
  /** Uten roomId blir enheten uavhengig (ligger i huset uten rom). */
  moveDevice: (deviceId: string, houseId: string, roomId?: string) =>
    mill('POST', `/devices/${deviceId}/attach`, roomId ? { houseId, roomId } : { houseId }),

  setDeviceEnabled: (deviceId: string, isEnabled: boolean) =>
    mill('PATCH', `/devices/${deviceId}/enabled`, { isEnabled }),

  timers: (deviceId: string) => mill<{ items: DeviceTimer[] }>('GET', `/devices/${deviceId}/timers`),
  createTimer: (deviceId: string, timer: NewTimer) => mill<DeviceTimer>('POST', `/devices/${deviceId}/timers`, timer),
  updateTimer: (deviceId: string, timerId: string, patch: Partial<NewTimer>) =>
    mill<DeviceTimer>('PATCH', `/devices/${deviceId}/timers/${timerId}`, patch),
  deleteTimer: (deviceId: string, timerId: string) => mill('DELETE', `/devices/${deviceId}/timers/${timerId}`),
  /** Sender aktive engangstimere til enheten (deaktiverer de som ikke er med). */
  activateTimers: (deviceId: string, timerIds: string[]) =>
    mill('POST', `/devices/${deviceId}/timers/activate`, { timersToActivateIds: timerIds }),

  tibberStatus: () => request<{ configured: boolean }>('GET', '/api/tibber/status'),
  tibberLive: () => request<{ live: TibberLive | null; error: string | null }>('GET', '/api/tibber/live'),
  tibberHomes: () => request<{ homes: TibberHomeSummary[] }>('GET', '/api/tibber/homes'),
  tibberOverview: (homeId: string, resolution: 'HOURLY' | 'QUARTER_HOURLY') =>
    request<TibberOverview>('GET', `/api/tibber/homes/${homeId}?resolution=${resolution}`),

  easeeStatus: () => request<{ configured: boolean }>('GET', '/api/easee/status'),
  easeeChargers: () => request<{ chargers: EaseeCharger[] }>('GET', '/api/easee/chargers'),
  easeeCharger: (id: string) => request<EaseeChargerData>('GET', `/api/easee/chargers/${encodeURIComponent(id)}`),
  easeeCommand: (id: string, command: EaseeCommand) =>
    request('POST', `/api/easee/chargers/${encodeURIComponent(id)}/${command}`),

  humidityRules: () => request<{ rules: HumidityRule[] }>('GET', '/api/automations/humidity'),
  saveHumidityRule: (rule: Omit<HumidityRule, 'last'>) =>
    request<{ rule: HumidityRule }>('PUT', `/api/automations/humidity/${encodeURIComponent(rule.deviceId)}`, rule),

  appliances: () => request<AppliancesResponse>('GET', '/api/appliances'),
  addAppliance: (a: { name: string; watts: number; source: Appliance['source'] }) =>
    request<{ appliance: Appliance }>('POST', '/api/appliances', a),
  removeAppliance: (id: string) => request('DELETE', `/api/appliances/${encodeURIComponent(id)}`),
  setApplianceOn: (id: string, on: boolean) => request('PUT', `/api/appliances/${encodeURIComponent(id)}/state`, { on }),
  identifyStart: () => request<{ startedAt: string }>('POST', '/api/appliances/identify/start'),
  identifySamples: () => request<{ startedAt: string | null; samples: PowerSample[]; steps: PowerStepRaw[] }>('GET', '/api/appliances/identify'),
  identifyCancel: () => request('POST', '/api/appliances/identify/cancel'),
  identifyAnalyze: (hint: string) =>
    request<{ analysis: IdentifyAnalysis; samples: PowerSample[]; startedAt: string }>('POST', '/api/appliances/identify/analyze', { hint }),

  sonosStatus: () => request<{ configured: boolean; connected: boolean }>('GET', '/api/sonos/status'),
  sonosComplete: (url: string) => request('POST', '/api/sonos/complete', { url }),
  sonosLogout: () => request('POST', '/api/sonos/logout'),
  sonosOverview: () => request<SonosOverview>('GET', '/api/sonos/overview'),
  sonosPauseAll: () => request('POST', '/api/sonos/pause-all'),
  sonosCommand: (groupId: string, cmd: SonosCommand) => request('POST', `/api/sonos/groups/${encodeURIComponent(groupId)}/${cmd}`),
  sonosVolume: (groupId: string, volume: number) => request('POST', `/api/sonos/groups/${encodeURIComponent(groupId)}/volume`, { volume }),
  sonosFavorite: (groupId: string, favoriteId: string) =>
    request('POST', `/api/sonos/groups/${encodeURIComponent(groupId)}/favorite`, { favoriteId }),
  sonosPlayerFavorite: (playerId: string, favoriteId: string) =>
    request('POST', `/api/sonos/players/${encodeURIComponent(playerId)}/favorite`, { favoriteId }),

  calendarStatus: () => request<{ configured: boolean }>('GET', '/api/calendar/status'),
  calendarEvents: (days: number, fresh = false) =>
    request<{ events: CalendarEvent[] }>('GET', `/api/calendar/events?days=${days}${fresh ? '&fresh=1' : ''}`),

  weatherPlaces: () => request<WeatherPlaces>('GET', '/api/weather/places'),
  addWeatherPlace: (p: PlaceHit) => request<WeatherPlaces>('POST', '/api/weather/places', p),
  selectWeatherPlace: (id: string) => request<WeatherPlaces>('PUT', '/api/weather/places/selected', { id }),
  removeWeatherPlace: (id: string) => request<WeatherPlaces>('DELETE', `/api/weather/places/${encodeURIComponent(id)}`),
  searchWeatherPlaces: (q: string) => request<{ places: PlaceHit[] }>('GET', `/api/weather/search?q=${encodeURIComponent(q)}`),
  nearestWeatherPlace: (lat: number, lon: number) => request<{ place: PlaceHit }>('GET', `/api/weather/nearest?lat=${lat}&lon=${lon}`),
  forecast: (lat: number, lon: number) => request<Forecast>('GET', `/api/weather/forecast?lat=${lat}&lon=${lon}`),

  millNetworkDiagnostics: () => request<MillNetworkDiagnostics>('GET', '/api/diagnostics/mill-network'),

  decoStatus: () => request<{ configured: boolean }>('GET', '/api/deco/status'),
  decoOverview: () => request<DecoOverview>('GET', '/api/deco/overview'),
  decoSetOwner: (mac: string, name: string) =>
    request<{ people: Person[] }>('PUT', `/api/deco/owners/${encodeURIComponent(mac)}`, { name }),

  hueStatus: () => request<{ configured: boolean; connected: boolean }>('GET', '/api/hue/status'),
  hueLights: () => request<{ lights: HueLight[] }>('GET', '/api/hue/lights'),
  hueSetLight: (id: string, on: boolean) => request('PUT', `/api/hue/lights/${encodeURIComponent(id)}`, { on }),
  hueGroups: () => request<{ groups: HueGroup[] }>('GET', '/api/hue/groups'),
  hueSetGroup: (id: string, on: boolean) => request('PUT', `/api/hue/groups/${encodeURIComponent(id)}`, { on }),
  hueDimLight: (id: string, brightness: number) => request('PUT', `/api/hue/lights/${encodeURIComponent(id)}`, { brightness }),
  hueDimGroup: (id: string, brightness: number) => request('PUT', `/api/hue/groups/${encodeURIComponent(id)}`, { brightness }),
  hueIdentifyLight: (id: string) => request('PUT', `/api/hue/lights/${encodeURIComponent(id)}`, { identify: true }),
  hueRenameLight: (id: string, name: string) => request('PUT', `/api/hue/lights/${encodeURIComponent(id)}`, { name }),
  hueRenameGroup: (kind: 'room' | 'zone', id: string, name: string) =>
    request('PUT', `/api/hue/${kind}s/${encodeURIComponent(id)}`, { name }),
  hueLogout: () => request('POST', '/api/hue/logout'),

  houseStatisticsHourly: (houseId: string, date: Date) =>
    mill<HouseStatistics>('POST', `/houses/${houseId}/statistics`, {
      period: 'hourly',
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
    }),
  houseStatistics: (houseId: string, year: number, month: number) =>
    mill<HouseStatistics>('POST', `/houses/${houseId}/statistics`, { period: 'daily', year, month }),
};
