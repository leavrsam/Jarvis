// Local weather for the HUD (Open-Meteo, no key) and where "local" is.
//
// Location: the device's precise location if the browser already allows it (or the user taps
// "Use my location"); otherwise an approximate one from the network (BigDataCloud, no key), so
// the kiosk never shows a permission prompt on its own. Cached for a day.

export interface HudLocation {
  lat: number;
  lon: number;
  place: string;
  precise: boolean;
  at: number;
}

export interface HourForecast {
  time: Date;
  tempF: number;
  code: number;
  rainChance: number;
}

export interface Weather {
  place: string;
  tempF: number;
  feelsF: number;
  code: number;
  isDay: boolean;
  windMph: number;
  highF: number;
  lowF: number;
  rainChance: number;
  sunrise: Date | null;
  sunset: Date | null;
  hours: HourForecast[];
  updatedAt: number;
}

const LOCATION_KEY = 'jarvis_hud_location';
const LOCATION_MAX_AGE = 24 * 60 * 60 * 1000;

function readCachedLocation(): HudLocation | null {
  try {
    const loc = JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null') as HudLocation | null;
    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) && Date.now() - loc.at < LOCATION_MAX_AGE) return loc;
  } catch {}
  return null;
}

function saveLocation(loc: HudLocation) {
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
  } catch {}
}

async function placeName(lat?: number, lon?: number): Promise<{ lat: number; lon: number; place: string }> {
  const params = new URLSearchParams({ localityLanguage: 'en' });
  if (lat !== undefined && lon !== undefined) {
    params.set('latitude', String(lat));
    params.set('longitude', String(lon));
  }
  const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`location HTTP ${res.status}`);
  const d = await res.json();
  // Precise: the neighbourhood/town ("Draper"); approximate (network): the city, which is all it's good for
  const town = lat !== undefined ? d.locality || d.city : d.city || d.locality;
  const place = [town, d.principalSubdivisionCode?.replace(/^US-/, '') || d.principalSubdivision]
    .filter(Boolean)
    .join(', ');
  return { lat: lat ?? Number(d.latitude), lon: lon ?? Number(d.longitude), place: place || 'Local' };
}

function devicePosition(timeoutMs = 10000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: timeoutMs, maximumAge: 60 * 60 * 1000 })
  );
}

/** Precise location (asks the browser; may show a permission prompt) */
export async function requestPreciseLocation(): Promise<HudLocation> {
  const pos = await devicePosition();
  const { lat, lon } = { lat: pos.coords.latitude, lon: pos.coords.longitude };
  let place = 'Local';
  try {
    place = (await placeName(lat, lon)).place;
  } catch {}
  const loc = { lat, lon, place, precise: true, at: Date.now() };
  saveLocation(loc);
  return loc;
}

/** Where to show the weather for, without ever prompting on its own */
export async function getLocation(): Promise<HudLocation> {
  const cached = readCachedLocation();
  if (cached) return cached;
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (perm?.state === "granted") return await requestPreciseLocation();
  } catch {}
  const approx = await placeName();
  const loc = { ...approx, precise: false, at: Date.now() };
  saveLocation(loc);
  return loc;
}

export async function fetchWeather(loc: HudLocation): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: loc.lat.toFixed(3),
    longitude: loc.lon.toFixed(3),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: '2',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  const d = await res.json();
  // Open-Meteo times are local to the location, without an offset; offset them to real instants
  const offsetMs = (Number(d.utc_offset_seconds) || 0) * 1000;
  const toDate = (t: string) => new Date(Date.parse(`${t}Z`) - offsetMs);
  const now = Date.now();
  const hours: HourForecast[] = (d.hourly?.time || [])
    .map((t: string, i: number) => ({
      time: toDate(t),
      tempF: Math.round(d.hourly.temperature_2m[i]),
      code: d.hourly.weather_code[i],
      rainChance: d.hourly.precipitation_probability?.[i] ?? 0,
    }))
    .filter((h: HourForecast) => h.time.getTime() > now - 30 * 60 * 1000)
    .slice(0, 6);
  return {
    place: loc.place,
    tempF: Math.round(d.current.temperature_2m),
    feelsF: Math.round(d.current.apparent_temperature),
    code: d.current.weather_code,
    isDay: d.current.is_day === 1,
    windMph: Math.round(d.current.wind_speed_10m),
    highF: Math.round(d.daily.temperature_2m_max[0]),
    lowF: Math.round(d.daily.temperature_2m_min[0]),
    rainChance: d.daily.precipitation_probability_max?.[0] ?? 0,
    sunrise: d.daily.sunrise?.[0] ? toDate(d.daily.sunrise[0]) : null,
    sunset: d.daily.sunset?.[0] ? toDate(d.daily.sunset[0]) : null,
    hours,
    updatedAt: Date.now(),
  };
}

/** WMO weather code → short description */
export function describeWeather(code: number): string {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorms';
  return 'Weather';
}
