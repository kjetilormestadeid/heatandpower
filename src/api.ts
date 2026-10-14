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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
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
  tibberHomes: () => request<{ homes: TibberHomeSummary[] }>('GET', '/api/tibber/homes'),
  tibberOverview: (homeId: string, resolution: 'HOURLY' | 'QUARTER_HOURLY') =>
    request<TibberOverview>('GET', `/api/tibber/homes/${homeId}?resolution=${resolution}`),

  houseStatistics: (houseId: string, year: number, month: number) =>
    mill<HouseStatistics>('POST', `/houses/${houseId}/statistics`, { period: 'daily', year, month }),
};
