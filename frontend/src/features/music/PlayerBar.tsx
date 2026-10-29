import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { spotifyApi } from '../../api/client';
import type { SpotifyPlayback, SpotifyRepeat } from '../../api/bridge';
import { Art, duration } from './MusicPage';
import type { SpotifyState } from './useSpotify';
import styles from './PlayerBar.module.css';

const SKIP_MS = 15_000;
const NEXT_REPEAT: Record<SpotifyRepeat, SpotifyRepeat> = { off: 'context', context: 'track', track: 'off' };
const REPEAT_LABEL: Record<SpotifyRepeat, string> = {
  off: 'Repeat: off',
  context: 'Repeat: all',
  track: 'Repeat: this song',
};

/**
 * Where the song is now, and a way to move it. Spotify is asked every few seconds;
 * in between, the position moves on by itself while the song plays.
 */
function useLivePosition(playback: SpotifyPlayback | null): [number, (positionMs: number) => void] {
  const [anchor, setAnchor] = useState(() => ({ progress: playback?.progressMs ?? 0, at: Date.now() }));
  const [, setTick] = useState(0);
  const playing = playback?.isPlaying === true;

  useEffect(() => {
    setAnchor({ progress: playback?.progressMs ?? 0, at: Date.now() });
  }, [playback]);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [playing]);

  const length = playback?.track?.durationMs ?? 0;
  const position = Math.min(anchor.progress + (playing ? Date.now() - anchor.at : 0), length);
  return [position, (progress) => setAnchor({ progress, at: Date.now() })];
}

interface SliderProps {
  value: number;
  max: number;
  step?: number;
  label: string;
  valueText: string;
  disabled?: boolean;
  className?: string;
  /** Called once the user lets go (or with each arrow key press), not while dragging. */
  onCommit: (value: number) => void;
}

/** A thin bar that fills up to the value, like Spotify's, and can be dragged. */
function Slider({ value, max, step = 1, label, valueText, disabled, className, onCommit }: SliderProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const shown = dragging ?? value;
  const commit = () => {
    if (pending.current !== null) {
      onCommit(pending.current);
      pending.current = null;
      setDragging(null);
    }
  };
  return (
    <input
      type="range"
      className={`${styles.slider} ${className ?? ''}`}
      min={0}
      max={Math.max(max, 1)}
      step={step}
      value={shown}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={valueText}
      style={{ '--fill': `${max > 0 ? (shown / max) * 100 : 0}%` } as CSSProperties}
      onChange={(event) => {
        pending.current = Number(event.target.value);
        setDragging(pending.current);
      }}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
    />
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** For a toggle such as shuffle; undefined for a plain button. */
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.icon} ${active ? styles.on : ''} ${className ?? ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Simple 16-pixel icons in the text colour: filled shapes and 1.5-pixel lines.
const icon = (children: ReactNode) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);
const solid = { fill: 'currentColor', stroke: 'none' };

const ICONS = {
  shuffle: icon(
    <>
      <path d="M1.5 4.5h2.5l6 7h4" />
      <path d="M1.5 11.5h2.5l6-7h4" />
      <path d="M12 2.5l2 2-2 2M12 9.5l2 2-2 2" />
    </>,
  ),
  previous: icon(
    <>
      <rect x="2" y="2" width="2" height="12" rx="0.5" {...solid} />
      <path d="M14 2.5v11L5.5 8z" {...solid} />
    </>,
  ),
  next: icon(
    <>
      <path d="M2 2.5v11L10.5 8z" {...solid} />
      <rect x="12" y="2" width="2" height="12" rx="0.5" {...solid} />
    </>,
  ),
  play: icon(<path d="M4 2.2v11.6L14 8z" {...solid} />),
  pause: icon(
    <>
      <rect x="3" y="2" width="3.5" height="12" rx="0.75" {...solid} />
      <rect x="9.5" y="2" width="3.5" height="12" rx="0.75" {...solid} />
    </>,
  ),
  repeat: icon(
    <>
      <path d="M2 8V6.5a2.5 2.5 0 0 1 2.5-2.5H13" />
      <path d="M11 2l2 2-2 2" />
      <path d="M14 8v1.5a2.5 2.5 0 0 1-2.5 2.5H3" />
      <path d="M5 14l-2-2 2-2" />
    </>,
  ),
  back15: icon(
    <>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M3.8 1.5v2.8h2.8" />
      <text x="8.2" y="10.4" fontSize="5.6" fontWeight="700" textAnchor="middle" {...solid}>
        15
      </text>
    </>,
  ),
  forward15: icon(
    <>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M12.2 1.5v2.8H9.4" />
      <text x="7.8" y="10.4" fontSize="5.6" fontWeight="700" textAnchor="middle" {...solid}>
        15
      </text>
    </>,
  ),
  volume: icon(
    <>
      <path d="M1.5 6h2.5l4-3v10l-4-3H1.5z" {...solid} />
      <path d="M10.5 5.8a3 3 0 0 1 0 4.4" />
      <path d="M12.3 3.8a6 6 0 0 1 0 8.4" />
    </>,
  ),
  muted: icon(
    <>
      <path d="M1.5 6h2.5l4-3v10l-4-3H1.5z" {...solid} />
      <path d="M10.5 6l4 4M14.5 6l-4 4" />
    </>,
  ),
  device: icon(
    <>
      <rect x="1.5" y="2.5" width="13" height="8.5" rx="1" />
      <path d="M5 14h6M8 11v3" />
    </>,
  ),
};

/**
 * The player along the bottom of the window, like Spotify's: what is playing on
 * the left, the controls and a position bar in the middle, the device and volume
 * on the right. Before Spotify is connected it only offers to set it up.
 */
export function PlayerBar({ spotify, onOpen }: { spotify: SpotifyState; onOpen: () => void }) {
  const { playback, busy, run } = spotify;
  const track = playback?.track ?? null;
  const episode = track?.kind === 'episode';
  const [position, jumpTo] = useLivePosition(playback);
  const playing = playback?.isPlaying === true;
  // A change the user just made, shown until Spotify reports it back.
  const [volume, setVolume] = useState<number | null>(null);
  const [shuffle, setShuffle] = useState<boolean | null>(null);
  const [repeat, setRepeat] = useState<SpotifyRepeat | null>(null);
  const lastAudible = useRef(50);

  useEffect(() => {
    setVolume(null);
    setShuffle(null);
    setRepeat(null);
  }, [playback]);

  if (!spotify.status) {
    return null;
  }
  if (!spotify.status.connected) {
    return (
      <section className={`${styles.bar} ${styles.setup}`} aria-label="Spotify player">
        <span className={styles.muted}>Connect Spotify to see and control your music here.</span>
        <button type="button" className={styles.setupButton} onClick={onOpen}>
          <span aria-hidden="true">♪</span> Set up Spotify
        </button>
      </section>
    );
  }

  const shownVolume = volume ?? playback?.volumePercent ?? null;
  const shownShuffle = shuffle ?? playback?.shuffle ?? false;
  const shownRepeat = repeat ?? playback?.repeat ?? 'off';
  const kind = episode ? 'episode' : 'song';
  const seek = (ms: number) => {
    const target = Math.max(0, Math.min(ms, track?.durationMs ?? 0));
    jumpTo(target);
    void run(() => spotifyApi.seek(Math.round(target)));
  };
  const changeVolume = (percent: number) => {
    if (percent > 0) {
      lastAudible.current = percent;
    }
    setVolume(percent);
    void run(() => spotifyApi.volume(percent));
  };

  return (
    <section className={styles.bar} aria-label="Now playing on Spotify">
      <div className={styles.left}>
        {track ? (
          <button type="button" className={styles.track} title={`${track.name} · ${track.artists}`} onClick={onOpen}>
            <Art imageId={track.imageId} label={track.name} />
            <span className={styles.text}>
              <span className={styles.name}>{track.name}</span>
              <span className={styles.artist}>{track.artists}</span>
            </span>
          </button>
        ) : (
          <button type="button" className={styles.track} onClick={onOpen}>
            <Art imageId={null} label="♪" />
            <span className={styles.text}>
              <span className={styles.name}>Nothing playing</span>
              <span className={styles.artist}>Press play to carry on, or pick music</span>
            </span>
          </button>
        )}
      </div>

      <div className={styles.center}>
        <div className={styles.controls} role="group" aria-label="Playback">
          {episode ? (
            <IconButton label="Back 15 seconds" disabled={busy} onClick={() => seek(position - SKIP_MS)}>
              {ICONS.back15}
            </IconButton>
          ) : (
            <IconButton
              label="Shuffle"
              active={shownShuffle}
              disabled={busy || !playback}
              onClick={() => {
                setShuffle(!shownShuffle);
                void run(() => spotifyApi.shuffle(!shownShuffle));
              }}
            >
              {ICONS.shuffle}
            </IconButton>
          )}
          <IconButton label={`Previous ${kind}`} disabled={busy} onClick={() => void run(spotifyApi.previous)}>
            {ICONS.previous}
          </IconButton>
          <IconButton
            label={playing ? 'Pause' : 'Play'}
            className={styles.play}
            disabled={busy}
            onClick={() => void run(() => (playing ? spotifyApi.pause() : spotifyApi.play()))}
          >
            {playing ? ICONS.pause : ICONS.play}
          </IconButton>
          <IconButton label={`Next ${kind}`} disabled={busy} onClick={() => void run(spotifyApi.next)}>
            {ICONS.next}
          </IconButton>
          {episode ? (
            <IconButton label="Forward 15 seconds" disabled={busy} onClick={() => seek(position + SKIP_MS)}>
              {ICONS.forward15}
            </IconButton>
          ) : (
            <IconButton
              label={REPEAT_LABEL[shownRepeat]}
              active={shownRepeat !== 'off'}
              disabled={busy || !playback}
              onClick={() => {
                const next = NEXT_REPEAT[shownRepeat];
                setRepeat(next);
                void run(() => spotifyApi.repeat(next));
              }}
            >
              {ICONS.repeat}
              {shownRepeat === 'track' && <span className={styles.one}>1</span>}
            </IconButton>
          )}
        </div>
        <div className={styles.progress}>
          <span className={styles.time}>{track ? duration(position) : '-:--'}</span>
          <Slider
            className={styles.seek}
            value={track ? position : 0}
            max={track?.durationMs ?? 0}
            step={1000}
            label={`${episode ? 'Episode' : 'Song'} position`}
            valueText={track ? `${duration(position)} of ${duration(track.durationMs)}` : 'Nothing playing'}
            disabled={!track}
            onCommit={seek}
          />
          <span className={styles.time}>{track ? duration(track.durationMs) : '-:--'}</span>
        </div>
      </div>

      <div className={styles.right}>
        {playback?.deviceName && (
          <span className={styles.device} title={`Playing on ${playback.deviceName}`}>
            {ICONS.device}
            <span className={styles.deviceName}>{playback.deviceName}</span>
          </span>
        )}
        {shownVolume !== null && (
          <span className={styles.volume}>
            <IconButton
              label={shownVolume === 0 ? 'Unmute' : 'Mute'}
              disabled={busy}
              onClick={() => changeVolume(shownVolume === 0 ? lastAudible.current : 0)}
            >
              {shownVolume === 0 ? ICONS.muted : ICONS.volume}
            </IconButton>
            <Slider
              className={styles.volumeSlider}
              value={shownVolume}
              max={100}
              label="Volume"
              valueText={`${shownVolume}%`}
              onCommit={changeVolume}
            />
          </span>
        )}
      </div>
    </section>
  );
}
