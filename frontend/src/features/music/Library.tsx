import { useEffect, useState } from 'react';
import { ApiError, errorMessage, spotifyApi } from '../../api/client';
import type { SpotifyPlaylist, SpotifyTrack, SpotifyTrackPage } from '../../api/bridge';
import { Button } from '../../components/Button';
import { Art, duration } from './MusicPage';
import type { SpotifyState } from './useSpotify';
import styles from './Library.module.css';

/** What the library shows on the right: Liked Songs or one playlist. */
export type LibrarySource = { kind: 'liked' } | { kind: 'playlist'; playlist: SpotifyPlaylist };

interface LibraryProps {
  spotify: SpotifyState;
  /** The device chosen on the Music page, or '' for the active one. */
  deviceId: string;
  source: LibrarySource | null;
  onSource: (source: LibrarySource) => void;
}

// Spotify plays at most this many songs from a list given one by one.
const MAX_LIST_PLAY = 100;

const playlistId = (playlist: SpotifyPlaylist) => playlist.uri.split(':')[2];
const failure = (error: unknown) => ({
  message: errorMessage(error),
  hidden: error instanceof ApiError && error.code === 'SPOTIFY_PLAYLIST_HIDDEN',
});
const sameSource = (a: LibrarySource | null, b: LibrarySource) =>
  a !== null && a.kind === b.kind && (a.kind === 'liked' || a.playlist.uri === (b as { playlist: SpotifyPlaylist }).playlist.uri);

/**
 * The user's music: Liked Songs and their playlists on the left; the songs of the
 * one chosen on the right, each to play (the list carries on after it) or to add
 * to the queue. Spotify lists the songs only of playlists the user made or
 * collaborates on; the others can still be played whole.
 */
export function Library({ spotify, deviceId, source, onSource }: LibraryProps) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState<SpotifyTrackPage | null>(null);
  // hidden: Spotify does not list this playlist's songs to apps; it still plays.
  const [pageError, setPageError] = useState<{ message: string; hidden: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const device = deviceId ? { deviceId } : {};

  useEffect(() => {
    spotifyApi.playlists().then(setPlaylists, (error: unknown) => setListError(errorMessage(error)));
  }, []);

  const fetchPage = (from: LibrarySource, offset: number) =>
    from.kind === 'liked' ? spotifyApi.likedSongs(offset) : spotifyApi.playlistItems(playlistId(from.playlist), offset);

  const sourceKey = !source ? null : source.kind === 'liked' ? 'liked' : source.playlist.uri;

  useEffect(() => {
    if (!source) {
      return;
    }
    let live = true;
    setPage(null);
    setPageError(null);
    setQueued(null);
    setLoading(true);
    fetchPage(source, 0)
      .then(
        (first) => live && setPage(first),
        (error: unknown) => live && setPageError(failure(error)),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // Compared by what it shows, not by object identity.
  }, [sourceKey]);

  const more = async () => {
    if (!source || !page || page.nextOffset === null) return;
    setLoading(true);
    try {
      const next = await fetchPage(source, page.nextOffset);
      setPage({ tracks: [...page.tracks, ...next.tracks], total: next.total, nextOffset: next.nextOffset });
    } catch (error) {
      setPageError(failure(error));
    } finally {
      setLoading(false);
    }
  };

  const playSong = (track: SpotifyTrack) => {
    if (!source) return;
    if (source.kind === 'playlist') {
      void spotify.run(() => spotifyApi.play({ uri: track.uri, contextUri: source.playlist.uri, ...device }));
      return;
    }
    // Liked Songs have no context: play the listed songs from this one on.
    const songs = page?.tracks ?? [track];
    const at = Math.max(0, songs.findIndex((song) => song.uri === track.uri));
    const uris = songs.slice(at, at + MAX_LIST_PLAY).map((song) => song.uri);
    void spotify.run(() => spotifyApi.play({ uri: track.uri, uris, ...device }));
  };

  const playAll = () => {
    if (!source) return;
    if (source.kind === 'playlist') {
      void spotify.run(() => spotifyApi.play({ uri: source.playlist.uri, ...device }));
    } else if (page && page.tracks.length > 0) {
      playSong(page.tracks[0]);
    }
  };

  const queue = async (track: SpotifyTrack) => {
    const done = await spotify.run(() => spotifyApi.queue(track.uri));
    if (done !== undefined) setQueued(track.uri);
  };

  const title = source?.kind === 'playlist' ? source.playlist.name : 'Liked Songs';

  return (
    <section className={styles.library} aria-labelledby="spotify-library">
      <h2 id="spotify-library" className={styles.heading}>
        Your library
      </h2>
      <nav className={styles.sources} aria-label="Liked Songs and playlists">
        <ul>
          <li>
            <button
              type="button"
              className={styles.source}
              aria-current={source?.kind === 'liked' ? 'true' : undefined}
              onClick={() => onSource({ kind: 'liked' })}
            >
              <span className={styles.liked} aria-hidden="true">
                ♥
              </span>
              <span className={styles.sourceText}>
                <span className={styles.name}>Liked Songs</span>
              </span>
            </button>
          </li>
          {(playlists ?? []).map((playlist) => (
            <li key={playlist.uri}>
              <button
                type="button"
                className={styles.source}
                aria-current={sameSource(source, { kind: 'playlist', playlist }) ? 'true' : undefined}
                onClick={() => onSource({ kind: 'playlist', playlist })}
              >
                <Art imageId={playlist.imageId} label={playlist.name} />
                <span className={styles.sourceText}>
                  <span className={styles.name}>{playlist.name}</span>
                  {playlist.owner && <span className={styles.meta}>{playlist.owner}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {playlists === null && !listError && <p className={styles.meta}>Loading playlists…</p>}
        {listError && <p className={styles.meta}>{listError}</p>}
      </nav>

      <div className={styles.detail}>
        {!source ? (
          <p className={styles.meta}>Choose Liked Songs or a playlist to see its songs.</p>
        ) : (
          <>
            <div className={styles.detailHeader}>
              {source.kind === 'playlist' ? (
                <Art imageId={source.playlist.imageId} label={source.playlist.name} />
              ) : (
                <span className={`${styles.liked} ${styles.bigLiked}`} aria-hidden="true">
                  ♥
                </span>
              )}
              <div className={styles.sourceText}>
                <h3 className={styles.detailTitle}>{title}</h3>
                <span className={styles.meta}>
                  {source.kind === 'playlist' && source.playlist.owner ? `${source.playlist.owner} · ` : ''}
                  {page ? `${page.total} ${page.total === 1 ? 'song' : 'songs'}` : ''}
                </span>
              </div>
              <Button
                variant="primary"
                aria-label={`Play ${title}`}
                disabled={spotify.busy || (source.kind === 'liked' && !page?.tracks.length)}
                onClick={playAll}
              >
                ▶ Play
              </Button>
            </div>

            {pageError && <p className={pageError.hidden ? styles.meta : styles.error}>{pageError.message}</p>}
            {page && page.tracks.length === 0 && !pageError && <p className={styles.meta}>No songs here yet.</p>}
            {page && page.tracks.length > 0 && (
              <ol className={styles.songs} aria-label={`Songs in ${title}`}>
                {page.tracks.map((track, index) => {
                  const current = spotify.playback?.track?.uri === track.uri;
                  return (
                    <li key={`${track.uri}-${index}`} className={current ? `${styles.song} ${styles.current}` : styles.song}>
                      <span className={styles.number} aria-hidden="true">
                        {index + 1}
                      </span>
                      <Art imageId={track.imageId} label={track.name} />
                      <span className={styles.sourceText}>
                        <span className={styles.name}>{track.name}</span>
                        <span className={styles.meta}>{track.artists}</span>
                      </span>
                      <span className={`${styles.meta} ${styles.album}`}>{track.album}</span>
                      <span className={`${styles.meta} ${styles.length}`}>{track.durationMs ? duration(track.durationMs) : ''}</span>
                      <span className={styles.actions}>
                        <button
                          type="button"
                          className={styles.icon}
                          aria-label={`Play ${track.name}`}
                          title="Play"
                          disabled={spotify.busy}
                          onClick={() => playSong(track)}
                        >
                          ▶
                        </button>
                        <button
                          type="button"
                          className={styles.icon}
                          aria-label={`Add ${track.name} to the queue`}
                          title={queued === track.uri ? 'Added to the queue' : 'Add to the queue'}
                          disabled={spotify.busy}
                          onClick={() => void queue(track)}
                        >
                          {queued === track.uri ? '✓' : '+'}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {queued && (
              <p className={styles.meta} role="status">
                Added to the queue.
              </p>
            )}
            {loading && <p className={styles.meta}>Loading songs…</p>}
            {page && page.nextOffset !== null && !loading && (
              <Button onClick={() => void more()}>Show more songs</Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
