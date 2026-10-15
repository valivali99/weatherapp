import { Injectable } from '@angular/core';

export type Sky = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
}

export interface DayForecast {
  date: Date;
  code: number;
  sky: Sky;
  label: string;
  max: number;
  min: number;
  rainChance: number;
}

export interface Forecast {
  current: {
    temperature: number;
    feelsLike: number;
    humidity: number;
    wind: number;
    code: number;
    sky: Sky;
    label: string;
    isDay: boolean;
  };
  today: DayForecast & { sunrise: string; sunset: string };
  week: DayForecast[];
}

/** WMO weather codes used by Open-Meteo → our sprite group + a readable label. */
const CODES: Record<number, [Sky, string]> = {
  0: ['clear', 'Clear sky'],
  1: ['partly', 'Mostly clear'],
  2: ['partly', 'Partly cloudy'],
  3: ['cloudy', 'Overcast'],
  45: ['fog', 'Fog'],
  48: ['fog', 'Icy fog'],
  51: ['rain', 'Light drizzle'],
  53: ['rain', 'Drizzle'],
  55: ['rain', 'Heavy drizzle'],
  56: ['rain', 'Freezing drizzle'],
  57: ['rain', 'Freezing drizzle'],
  61: ['rain', 'Light rain'],
  63: ['rain', 'Rain'],
  65: ['rain', 'Heavy rain'],
  66: ['rain', 'Freezing rain'],
  67: ['rain', 'Freezing rain'],
  71: ['snow', 'Light snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy snow'],
  77: ['snow', 'Snow grains'],
  80: ['rain', 'Light showers'],
  81: ['rain', 'Showers'],
  82: ['rain', 'Violent showers'],
  85: ['snow', 'Snow showers'],
  86: ['snow', 'Heavy snow showers'],
  95: ['storm', 'Thunderstorm'],
  96: ['storm', 'Storm with hail'],
  99: ['storm', 'Storm with hail'],
};

export function describe(code: number): [Sky, string] {
  return CODES[code] ?? ['cloudy', 'Unknown'];
}

@Injectable({ providedIn: 'root' })
export class WeatherService {
  /** Asks the browser for the device position. */
  locate(): Promise<GeolocationCoordinates> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation is not supported by this browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos.coords),
        (err) => reject(new Error(err.code === err.PERMISSION_DENIED
          ? 'Location access was denied.'
          : 'Could not get your location.')),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
      );
    });
  }

  /** Turns coordinates into a city name. Falls back to the coordinates themselves. */
  async placeName(latitude: number, longitude: number): Promise<string> {
    const fallback = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
    try {
      const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client'
        + `?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
      const res = await fetch(url);
      if (!res.ok) return fallback;
      const data = await res.json();
      const city = data.city || data.locality || data.principalSubdivision;
      return city ? [city, data.countryCode].filter(Boolean).join(', ') : fallback;
    } catch {
      return fallback;
    }
  }

  /** Looks up a city by name (used when location access is denied). */
  async search(query: string): Promise<Place[]> {
    const url = 'https://geocoding-api.open-meteo.com/v1/search'
      + `?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('City search failed.');
    const data = await res.json();
    return (data.results ?? []).map((r: any) => ({
      // Include the region so same-named places (e.g. several "Tokyo"s) can be told apart.
      name: [r.name, r.admin1 !== r.name ? r.admin1 : null, r.country_code].filter(Boolean).join(', '),
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  }

  async forecast(latitude: number, longitude: number, fahrenheit: boolean): Promise<Forecast> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
      timezone: 'auto',
      forecast_days: '8',
      temperature_unit: fahrenheit ? 'fahrenheit' : 'celsius',
      wind_speed_unit: fahrenheit ? 'mph' : 'kmh',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error('Could not load the forecast.');
    const data = await res.json();

    const d = data.daily;
    const days: DayForecast[] = d.time.map((t: string, i: number) => {
      const [sky, label] = describe(d.weather_code[i]);
      return {
        // Parse as local date so the weekday doesn't shift with the timezone.
        date: new Date(`${t}T12:00:00`),
        code: d.weather_code[i],
        sky,
        label,
        max: Math.round(d.temperature_2m_max[i]),
        min: Math.round(d.temperature_2m_min[i]),
        rainChance: d.precipitation_probability_max[i] ?? 0,
      };
    });

    const c = data.current;
    const [sky, label] = describe(c.weather_code);
    return {
      current: {
        temperature: Math.round(c.temperature_2m),
        feelsLike: Math.round(c.apparent_temperature),
        humidity: c.relative_humidity_2m,
        wind: Math.round(c.wind_speed_10m),
        code: c.weather_code,
        sky,
        label,
        isDay: c.is_day === 1,
      },
      today: { ...days[0], sunrise: d.sunrise[0].slice(11), sunset: d.sunset[0].slice(11) },
      week: days.slice(1, 8),
    };
  }
}
