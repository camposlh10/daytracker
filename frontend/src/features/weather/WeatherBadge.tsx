import { useEffect, useState } from 'react';
import { ApiError, weatherApi } from '../../api/client';
import type { Weather } from '../../api/bridge';
import styles from './WeatherBadge.module.css';

const REFRESH_MS = 15 * 60_000;
const UNIT_KEY = 'dayTracker.temperatureUnit';

type Unit = 'C' | 'F';

// The pixel-art icons: an animated GIF for each state, and a still PNG for reduced motion.
const ANIMATED = import.meta.glob<string>('../../assets/weather/*.gif', { eager: true, query: '?url', import: 'default' });
const STILL = import.meta.glob<string>('../../assets/weather/*.still.png', { eager: true, query: '?url', import: 'default' });

export type WeatherIcon =
  | 'sunny'
  | 'mostly_sunny'
  | 'partly_cloudy'
  | 'cloudy'
  | 'overcast'
  | 'rain'
  | 'overcast_rain'
  | 'sleet'
  | 'overcast_sleet'
  | 'snow'
  | 'overcast_snow'
  | 'rain_thunder'
  | 'rainy_thunderstorm';

/**
 * What a WMO weather code means, and which icon shows it. The icon set has no
 * night pictures or fog, so clear nights show the sun and fog a cloud.
 */
export function describeWeather(code: number): { label: string; icon: WeatherIcon } {
  if (code === 0) return { label: 'Clear', icon: 'sunny' };
  if (code === 1) return { label: 'Mostly clear', icon: 'mostly_sunny' };
  if (code === 2) return { label: 'Partly cloudy', icon: 'partly_cloudy' };
  if (code === 3) return { label: 'Overcast', icon: 'overcast' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'cloudy' };
  if (code === 56 || code === 57) return { label: 'Freezing drizzle', icon: 'sleet' };
  if (code >= 51 && code <= 55) return { label: 'Drizzle', icon: 'rain' };
  if (code === 66 || code === 67) return { label: 'Freezing rain', icon: 'overcast_sleet' };
  if (code === 65) return { label: 'Heavy rain', icon: 'overcast_rain' };
  if (code >= 61 && code <= 63) return { label: 'Rain', icon: 'rain' };
  if (code === 75) return { label: 'Heavy snow', icon: 'overcast_snow' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: 'snow' };
  if (code === 82) return { label: 'Heavy showers', icon: 'overcast_rain' };
  if (code === 80 || code === 81) return { label: 'Showers', icon: 'rain' };
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: 'snow' };
  if (code === 96 || code === 99) return { label: 'Thunderstorm with hail', icon: 'rainy_thunderstorm' };
  if (code === 95) return { label: 'Thunderstorm', icon: 'rain_thunder' };
  return { label: 'Cloudy', icon: 'cloudy' };
}

/** The unit chosen with a click, if any; Windows' regional format decides otherwise. */
function savedUnit(): Unit | null {
  try {
    const unit = window.localStorage.getItem(UNIT_KEY);
    return unit === 'C' || unit === 'F' ? unit : null;
  } catch {
    return null;
  }
}

function saveUnit(unit: Unit): void {
  try {
    window.localStorage.setItem(UNIT_KEY, unit);
  } catch {
    // Not remembered this time; the switch still works for now.
  }
}

export function inUnit(celsius: number, unit: Unit): number {
  return Math.round(unit === 'F' ? (celsius * 9) / 5 + 32 : celsius);
}

type State =
  | { kind: 'loading' }
  | { kind: 'shown'; weather: Weather }
  | { kind: 'location-off'; message: string }
  | { kind: 'none' };

/**
 * The weather where this computer is, small: a pixel-art picture with the
 * temperature under it. Hovering names the conditions; a click on the temperature
 * switches between °C and °F. Asked again every 15 minutes while the window is
 * visible. When Windows' location is off it says so; other failures show nothing.
 */
export function WeatherBadge() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [chosenUnit, setChosenUnit] = useState<Unit | null>(savedUnit);

  useEffect(() => {
    let live = true;
    const load = () =>
      weatherApi.current().then(
        (weather) => live && setState({ kind: 'shown', weather }),
        (error: unknown) => {
          if (!live) return;
          setState(
            error instanceof ApiError && error.code === 'LOCATION_OFF'
              ? { kind: 'location-off', message: error.message }
              : // Keep showing the last weather rather than nothing after one failed refresh.
                (current) => (current.kind === 'shown' ? current : { kind: 'none' }),
          );
        },
      );
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (state.kind === 'location-off') {
    return (
      <p className={styles.badge} title={state.message}>
        <span className={styles.off} aria-hidden="true">
          📍
        </span>
        <span className={styles.offText}>No location</span>
        <span className={styles.srOnly}>{state.message}</span>
      </p>
    );
  }
  if (state.kind !== 'shown') {
    return null;
  }
  const { temperatureC, preferredUnit, code } = state.weather;
  const unit = chosenUnit ?? preferredUnit;
  const other: Unit = unit === 'C' ? 'F' : 'C';
  const { label, icon } = describeWeather(code);
  const temperature = `${inUnit(temperatureC, unit)}°${unit}`;
  return (
    <div className={styles.badge} title={`${label}, ${temperature}`}>
      <picture>
        <source srcSet={STILL[`../../assets/weather/${icon}.still.png`]} media="(prefers-reduced-motion: reduce)" />
        <img
          className={styles.icon}
          src={ANIMATED[`../../assets/weather/${icon}.gif`]}
          width={32}
          height={32}
          alt={label}
          draggable={false}
        />
      </picture>
      <button
        type="button"
        className={styles.temperature}
        aria-label={`${temperature}, show in °${other}`}
        onClick={() => {
          setChosenUnit(other);
          saveUnit(other);
        }}
      >
        {temperature}
      </button>
    </div>
  );
}
