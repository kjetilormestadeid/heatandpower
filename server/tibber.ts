const TIBBER_URL = 'https://api.tibber.com/v1-beta/gql';
const CACHE_MS = 5 * 60_000;

export class TibberError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const tibberConfigured = () => Boolean(process.env.TIBBER_TOKEN);

const cache = new Map<string, { at: number; data: unknown }>();

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.TIBBER_TOKEN;
  if (!token) throw new TibberError(503, 'TIBBER_TOKEN er ikke satt i .env');

  const key = query + JSON.stringify(variables);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;

  const res = await fetch(TIBBER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'mill-dashboard/0.1',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!res.ok || body?.errors?.length || !body?.data) {
    const msg = body?.errors?.map((e) => e.message).join('; ') || `Tibber API ${res.status}`;
    throw new TibberError(res.status === 200 ? 502 : res.status, msg);
  }
  cache.set(key, { at: Date.now(), data: body.data });
  return body.data;
}

const PRICE = 'total energy tax startsAt level currency';

export function tibberHomes() {
  return gql<{ viewer: { homes: { id: string; appNickname: string | null; address: { address1: string | null } | null }[] } }>(
    `{ viewer { homes { id appNickname address { address1 } } } }`,
  ).then((d) => d.viewer.homes);
}

export function tibberOverview(homeId: string, resolution: 'HOURLY' | 'QUARTER_HOURLY') {
  return gql<{ viewer: { home: unknown } }>(
    `query($id: ID!, $res: PriceInfoResolution) {
      viewer { home(id: $id) {
        id timeZone appNickname
        currentSubscription { status priceInfo(resolution: $res) {
          current { ${PRICE} } today { ${PRICE} } tomorrow { ${PRICE} }
        } }
        daily: consumption(resolution: DAILY, last: 31) { nodes { from to cost unitPrice consumption consumptionUnit currency } }
      } }
    }`,
    { id: homeId, res: resolution },
  ).then((d) => d.viewer.home);
}
