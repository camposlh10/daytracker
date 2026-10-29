import { useState, type FormEvent } from 'react';
import { spotifyApi, spotifyImageUrl } from '../../api/client';
import type {
  SpotifyDevice,
  SpotifyPlaylist,
  SpotifySearchResult,
  SpotifyTrack,
} from '../../api/bridge';
import { Button } from '../../components/Button';
import { LoadingState } from '../../components/States';
import form from '../../components/form.module.css';
import { Library, type LibrarySource } from './Library';
import { DEFAULT_REDIRECT_URI, type SpotifyState } from './useSpotify';
import styles from './music.module.css';

/** Album art, or the first letter of the name when there is none. */
export function Art({ imageId, label }: { imageId: string | null; label: string }) {
  const url = spotifyImageUrl(imageId);
  const [failed, setFailed] = useState<string | null>(null);
  return url && url !== failed ? (
    <img className={styles.art} src={url} alt="" draggable={false} onError={() => setFailed(url)} />
  ) : (
    <span className={`${styles.art} ${styles.placeholder}`} aria-hidden="true">
      {label.trim().charAt(0).toUpperCase() || '♪'}
    </span>
  );
}

/** 3:05, or 10:10:08 for something an hour or longer. */
export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const two = (value: number) => String(value).padStart(2, '0');
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`
    : `${Math.floor(seconds / 60)}:${two(seconds % 60)}`;
}

/**
 * Spotify: set up the connection, see and control what plays, search, and browse
 * Liked Songs and playlists to pick songs. Sound comes from one of the user's Spotify devices (Spotify Connect);
 * when none is playing, the desktop side starts Spotify on this computer by itself.
 */
export function MusicPage({ spotify }: { spotify: SpotifyState }) {
  const { status } = spotify;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Music</h1>
        {status?.connected && (
          <p className={styles.muted}>
            Spotify{status.displayName ? `: ${status.displayName}` : ''} ·{' '}
            <button
              type="button"
              className={styles.link}
              onClick={() => void spotify.run(async () => spotify.setStatus(await spotifyApi.disconnect()))}
            >
              Disconnect
            </button>
          </p>
        )}
      </header>
      {spotify.problem && (
        <p className={form.error} role="alert">
          {spotify.problem}
        </p>
      )}
      {status === null ? (
        <LoadingState label="Checking Spotify…" />
      ) : !status.clientId ? (
        <Setup spotify={spotify} />
      ) : !status.connected ? (
        <Connect spotify={spotify} />
      ) : (
        <Connected spotify={spotify} />
      )}
    </div>
  );
}

function Setup({ spotify }: { spotify: SpotifyState }) {
  const [clientId, setClientId] = useState(spotify.status?.clientId ?? '');
  const [redirectUri, setRedirectUri] = useState(spotify.status?.redirectUri ?? DEFAULT_REDIRECT_URI);

  const save = (event: FormEvent) => {
    event.preventDefault();
    void spotify.run(async () => spotify.setStatus(await spotifyApi.configure(clientId, redirectUri)));
  };

  return (
    <section className={styles.card} aria-labelledby="spotify-setup">
      <h2 id="spotify-setup">Connect Spotify</h2>
      <p>
        Spotify only lets an app control playback after you register it with your own Spotify account. It takes a
        few minutes, once:
      </p>
      <ol className={styles.steps}>
        <li>
          Sign in at <code>developer.spotify.com/dashboard</code> and choose <strong>Create app</strong>.
        </li>
        <li>
          Add a redirect URI and tick <strong>Web API</strong>. Spotify’s dashboard has been changing which addresses it
          accepts, so try these in order and keep the first one it saves without saying it is not secure:
          <ul className={styles.options}>
            <li>
              Your Day Tracker server, if you run one (for example on Railway):{' '}
              <code>https://your-server.up.railway.app/spotify/callback</code>. It only passes Spotify’s answer back to
              this computer.
            </li>
            <li>
              <code>{DEFAULT_REDIRECT_URI}</code>
            </li>
            <li>
              <code>http://[::1]:43821/callback</code>
            </li>
            <li>
              <code>daytracker://spotify-callback</code> (an app link: your browser asks to open Day Tracker)
            </li>
          </ul>
        </li>
        <li>
          Under <strong>User Management</strong>, add the email address of the Spotify account you will use.
        </li>
        <li>Copy the app’s Client ID, and enter it here with the redirect URI exactly as you saved it.</li>
      </ol>
      <p className={styles.muted}>
        Spotify requires the owner of the app to have Premium, allows up to five accounts per app, and only lets
        Premium accounts control playback.
      </p>
      <form className={styles.setupForm} onSubmit={save}>
        <div className={form.field}>
          <label className={form.label} htmlFor="spotify-client-id">
            Client ID
          </label>
          <input
            id="spotify-client-id"
            className={form.control}
            value={clientId}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setClientId(event.target.value)}
          />
        </div>
        <div className={form.field}>
          <label className={form.label} htmlFor="spotify-redirect">
            Redirect URI
          </label>
          <input
            id="spotify-redirect"
            className={form.control}
            value={redirectUri}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setRedirectUri(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={spotify.busy || clientId.trim().length === 0 || redirectUri.trim().length === 0}
        >
          Save
        </Button>
      </form>
    </section>
  );
}

function Connect({ spotify }: { spotify: SpotifyState }) {
  const [changing, setChanging] = useState(false);
  if (changing) {
    return <Setup spotify={spotify} />;
  }
  return (
    <section className={styles.card} aria-labelledby="spotify-connect">
      <h2 id="spotify-connect">Connect your Spotify account</h2>
      <p>
        Your browser opens Spotify’s own sign-in page. Day Tracker never sees your password; it keeps only a key to
        your account, encrypted for your Windows user.
      </p>
      <div className={styles.inline}>
        <Button
          variant="primary"
          disabled={spotify.busy}
          onClick={() => void spotify.run(async () => spotify.setStatus(await spotifyApi.connect()))}
        >
          {spotify.busy ? 'Waiting for Spotify…' : 'Connect Spotify'}
        </Button>
        <Button onClick={() => setChanging(true)}>Change setup</Button>
      </div>
      <p className={styles.muted}>Redirect URI: {spotify.status?.redirectUri}</p>
      {spotify.busy && <p className={styles.muted}>Finish signing in in your browser, then come back here.</p>}
    </section>
  );
}

function Connected({ spotify }: { spotify: SpotifyState }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifySearchResult | null>(null);
  // Liked Songs or the playlist open in the library.
  const [source, setSource] = useState<LibrarySource | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[] | null>(null);
  const [deviceId, setDeviceId] = useState('');

  const play = (uri: string) =>
    void spotify.run(() => spotifyApi.play({ uri, ...(deviceId ? { deviceId } : {}) }));
  const queue = (uri: string) => void spotify.run(() => spotifyApi.queue(uri));

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim()) {
      void spotify.run(async () => setResults(await spotifyApi.search(query.trim())));
    }
  };

  return (
    <>
      <NowPlaying spotify={spotify} />

      <section className={styles.card} aria-labelledby="spotify-devices">
        <h2 id="spotify-devices">Play on</h2>
        <div className={styles.inline}>
          <select
            aria-label="Spotify device"
            className={`${form.control} ${styles.devices}`}
            value={deviceId}
            onChange={(event) => {
              setDeviceId(event.target.value);
              if (event.target.value) void spotify.run(() => spotifyApi.transfer(event.target.value));
            }}
          >
            <option value="">Automatic</option>
            {(devices ?? []).map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
                {device.isActive ? ' (active)' : ''}
              </option>
            ))}
          </select>
          <Button onClick={() => void spotify.run(async () => setDevices(await spotifyApi.devices()))}>
            {devices === null ? 'Find devices' : 'Refresh devices'}
          </Button>
        </div>
        {devices?.length === 0 && (
          <p className={styles.muted}>No devices are open. Press play and Day Tracker starts Spotify on this computer.</p>
        )}
        {devices === null && (
          <p className={styles.muted}>
            Automatic plays where music is already playing; when nothing is, Day Tracker starts Spotify on this
            computer in the background.
          </p>
        )}
      </section>

      <section className={styles.card} aria-labelledby="spotify-search">
        <h2 id="spotify-search">Search</h2>
        <form className={styles.inline} onSubmit={search} role="search">
          <input
            aria-label="Search Spotify"
            className={form.control}
            placeholder="Song, artist, or playlist"
            value={query}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" disabled={spotify.busy || !query.trim()}>
            Search
          </Button>
        </form>
        {results && (
          <>
            {results.tracks.length === 0 && results.playlists.length === 0 && (
              <p className={styles.muted}>Nothing found.</p>
            )}
            {results.tracks.length > 0 && (
              <ul className={styles.list} aria-label="Songs">
                {results.tracks.map((track) => (
                  <TrackRow key={track.uri} track={track} onPlay={() => play(track.uri)} onQueue={() => queue(track.uri)} />
                ))}
              </ul>
            )}
            {results.playlists.length > 0 && (
              <ul className={styles.list} aria-label="Playlists found">
                {results.playlists.map((playlist) => (
                  <PlaylistRow
                    key={playlist.uri}
                    playlist={playlist}
                    onPlay={() => play(playlist.uri)}
                    onOpen={() => setSource({ kind: 'playlist', playlist })}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <Library spotify={spotify} deviceId={deviceId} source={source} onSource={setSource} />
    </>
  );
}

function NowPlaying({ spotify }: { spotify: SpotifyState }) {
  const { playback } = spotify;
  const track = playback?.track ?? null;
  return (
    <section className={styles.card} aria-labelledby="spotify-now">
      <h2 id="spotify-now">Now playing</h2>
      <div className={styles.now}>
        <Art imageId={track?.imageId ?? null} label={track?.name ?? ''} />
        <div className={styles.nowText}>
          <strong>{track ? track.name : playback ? 'Something other than a song or episode' : 'Nothing is playing'}</strong>
          {track && <span className={styles.muted}>{track.artists}</span>}
          {playback?.deviceName && <span className={styles.muted}>On {playback.deviceName}</span>}
        </div>
        <Controls spotify={spotify} />
      </div>
    </section>
  );
}

/** Previous, play or pause, next. */
function Controls({ spotify }: { spotify: SpotifyState }) {
  const playing = spotify.playback?.isPlaying === true;
  return (
    <div className={styles.controls} role="group" aria-label="Playback">
      <Button aria-label="Previous song" disabled={spotify.busy} onClick={() => void spotify.run(spotifyApi.previous)}>
        ⏮
      </Button>
      <Button
        variant="primary"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={spotify.busy}
        onClick={() => void spotify.run(() => (playing ? spotifyApi.pause() : spotifyApi.play()))}
      >
        {playing ? '⏸' : '▶'}
      </Button>
      <Button aria-label="Next song" disabled={spotify.busy} onClick={() => void spotify.run(spotifyApi.next)}>
        ⏭
      </Button>
    </div>
  );
}

function TrackRow({ track, onPlay, onQueue }: { track: SpotifyTrack; onPlay: () => void; onQueue: () => void }) {
  return (
    <li className={styles.row}>
      <Art imageId={track.imageId} label={track.name} />
      <span className={styles.rowText}>
        <strong>{track.name}</strong>
        <span className={styles.muted}>
          {track.artists}
          {track.album ? ` · ${track.album}` : ''} · {duration(track.durationMs)}
        </span>
      </span>
      <Button aria-label={`Play ${track.name}`} onClick={onPlay}>
        ▶ Play
      </Button>
      <Button aria-label={`Add ${track.name} to the queue`} onClick={onQueue}>
        + Queue
      </Button>
    </li>
  );
}

function PlaylistRow({ playlist, onPlay, onOpen }: { playlist: SpotifyPlaylist; onPlay: () => void; onOpen: () => void }) {
  return (
    <li className={styles.row}>
      <Art imageId={playlist.imageId} label={playlist.name} />
      <span className={styles.rowText}>
        <strong>{playlist.name}</strong>
        <span className={styles.muted}>
          Playlist{playlist.owner ? ` by ${playlist.owner}` : ''}
          {playlist.trackCount !== null ? ` · ${playlist.trackCount} songs` : ''}
        </span>
      </span>
      <Button aria-label={`Show the songs of ${playlist.name}`} onClick={onOpen}>
        Songs
      </Button>
      <Button aria-label={`Play ${playlist.name}`} onClick={onPlay}>
        ▶ Play
      </Button>
    </li>
  );
}
