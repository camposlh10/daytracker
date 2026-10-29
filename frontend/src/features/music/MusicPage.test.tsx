import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SpotifyPlayback, SpotifyStatus, SpotifyTrack } from '../../api/bridge';
import { App } from '../../App';
import { accessibilityProblems } from '../../test/a11y';
import { installFakeBridge } from '../../test/fakeBridge';
import { goTo } from '../../test/navigate';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const REDIRECT = 'http://127.0.0.1:43821/callback';
const CONNECTED: SpotifyStatus = { clientId: CLIENT_ID, redirectUri: REDIRECT, connected: true, displayName: 'Ana' };

function track(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    kind: 'track',
    name: 'Clair de Lune',
    artists: 'Claude Debussy',
    album: 'Suite bergamasque',
    durationMs: 302_000,
    imageId: 'a'.repeat(40),
    ...overrides,
  };
}

function playing(overrides: Partial<SpotifyPlayback> = {}): SpotifyPlayback {
  return {
    isPlaying: true,
    progressMs: 1000,
    track: track(),
    deviceName: 'Laptop',
    volumePercent: 64,
    shuffle: false,
    repeat: 'off',
    ...overrides,
  };
}

async function openMusic(prepare: (bridge: ReturnType<typeof installFakeBridge>['bridge']) => void = () => undefined) {
  const fake = installFakeBridge({ status: 'ready' });
  prepare(fake.bridge);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('grid');
  await goTo(user, 'Music');
  await screen.findByRole('heading', { level: 1, name: 'Music' });
  return { ...fake, user };
}

describe('Music (Spotify)', () => {
  it('explains the one-time setup and saves the Client ID', async () => {
    const { bridge, user } = await openMusic((fake) =>
      fake.spotify.configure.mockResolvedValue({
        ok: true,
        data: { clientId: CLIENT_ID, redirectUri: 'daytracker://spotify-callback', connected: false, displayName: null },
      }),
    );

    expect(await screen.findByText('http://127.0.0.1:43821/callback')).toBeInTheDocument();
    expect(screen.getByText('http://[::1]:43821/callback')).toBeInTheDocument();
    expect(screen.getByText('daytracker://spotify-callback')).toBeInTheDocument();
    expect(screen.getByText('https://your-server.up.railway.app/spotify/callback')).toBeInTheDocument();
    expect(screen.getByText(/User Management/)).toBeInTheDocument();
    expect(screen.getByLabelText('Redirect URI')).toHaveValue('http://127.0.0.1:43821/callback');
    await user.type(screen.getByLabelText('Client ID'), CLIENT_ID);
    await user.clear(screen.getByLabelText('Redirect URI'));
    await user.type(screen.getByLabelText('Redirect URI'), 'daytracker://spotify-callback');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(bridge.spotify.configure).toHaveBeenCalledWith({ clientId: CLIENT_ID, redirectUri: 'daytracker://spotify-callback' });
    expect(await screen.findByRole('button', { name: 'Connect Spotify' })).toBeInTheDocument();
    expect(screen.getByText('Redirect URI: daytracker://spotify-callback')).toBeInTheDocument();
  });

  it('shows why a Client ID was refused', async () => {
    const { user } = await openMusic((fake) =>
      fake.spotify.configure.mockResolvedValue({
        ok: false,
        error: { status: 400, code: 'VALIDATION_FAILED', message: 'A Spotify Client ID is 32 letters and digits.' },
      }),
    );

    await user.type(await screen.findByLabelText('Client ID'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('32 letters and digits');
  });

  it('connects through the browser and stays quiet when sign-in is cancelled', async () => {
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: { clientId: CLIENT_ID, redirectUri: REDIRECT, connected: false, displayName: null } });
      fake.spotify.connect
        .mockResolvedValueOnce({ ok: false, error: { status: 0, code: 'CANCELLED', message: 'Signing in was cancelled.' } })
        .mockResolvedValueOnce({ ok: true, data: CONNECTED });
    });

    await user.click(await screen.findByRole('button', { name: 'Connect Spotify' }));
    await waitFor(() => expect(bridge.spotify.connect).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Connect Spotify' }));
    expect(await screen.findByText(/Spotify: Ana/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Now playing' })).toBeInTheDocument();
  });

  it('shows what is playing, with controls here and in the player bar', async () => {
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.playback.mockResolvedValue({ ok: true, data: playing() });
    });

    const now = await screen.findByRole('region', { name: 'Now playing' });
    expect(await within(now).findByText('Clair de Lune')).toBeInTheDocument();
    expect(within(now).getByText('On Laptop')).toBeInTheDocument();
    expect(now.querySelector('img')).toHaveAttribute('src', `dt-spotify://image/${'a'.repeat(40)}`);
    const bar = screen.getByRole('region', { name: 'Now playing on Spotify' });
    expect(within(bar).getByText('Clair de Lune')).toBeInTheDocument();
    expect(within(bar).getByText('Claude Debussy')).toBeInTheDocument();
    expect(within(bar).getByText('Laptop')).toBeInTheDocument();
    expect(within(bar).getByText('5:02')).toBeInTheDocument();

    await user.click(within(now).getByRole('button', { name: 'Pause' }));
    await user.click(within(now).getByRole('button', { name: 'Next song' }));
    await user.click(within(bar).getByRole('button', { name: 'Next song' }));

    expect(bridge.spotify.pause).toHaveBeenCalledTimes(1);
    expect(bridge.spotify.next).toHaveBeenCalledTimes(2);
  });

  it('shuffles, repeats, seeks and sets the volume from the player bar', async () => {
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.playback.mockResolvedValue({ ok: true, data: playing({ isPlaying: false }) });
    });
    const bar = await screen.findByRole('region', { name: 'Now playing on Spotify' });
    await within(bar).findByText('Clair de Lune');

    const shuffle = within(bar).getByRole('button', { name: 'Shuffle' });
    expect(shuffle).toHaveAttribute('aria-pressed', 'false');
    await user.click(shuffle);
    expect(bridge.spotify.shuffle).toHaveBeenCalledWith(true);
    expect(shuffle).toHaveAttribute('aria-pressed', 'true');

    // Repeat goes off, all, this song, off.
    await user.click(within(bar).getByRole('button', { name: 'Repeat: off' }));
    await user.click(await within(bar).findByRole('button', { name: 'Repeat: all' }));
    expect(bridge.spotify.repeat.mock.calls).toEqual([['context'], ['track']]);
    expect(within(bar).getByRole('button', { name: 'Repeat: this song' })).toHaveAttribute('aria-pressed', 'true');

    const position = within(bar).getByRole('slider', { name: 'Song position' });
    expect(position).toHaveAttribute('aria-valuetext', '0:01 of 5:02');
    fireEvent.change(position, { target: { value: '120000' } });
    expect(bridge.spotify.seek).not.toHaveBeenCalled();
    fireEvent.pointerUp(position);
    expect(bridge.spotify.seek).toHaveBeenCalledWith(120000);
    expect(position).toHaveAttribute('aria-valuetext', '2:00 of 5:02');

    const volume = within(bar).getByRole('slider', { name: 'Volume' });
    expect(volume).toHaveValue('64');
    fireEvent.change(volume, { target: { value: '30' } });
    fireEvent.keyUp(volume, { key: 'ArrowLeft' });
    expect(bridge.spotify.volume).toHaveBeenLastCalledWith(30);
    await user.click(within(bar).getByRole('button', { name: 'Mute' }));
    expect(bridge.spotify.volume).toHaveBeenLastCalledWith(0);
    await user.click(within(bar).getByRole('button', { name: 'Unmute' }));
    expect(bridge.spotify.volume).toHaveBeenLastCalledWith(30);

    await user.click(within(bar).getByRole('button', { name: 'Play' }));
    expect(bridge.spotify.play).toHaveBeenCalled();
  });

  it('plays podcast episodes, with 15-second skips and hour-long times', async () => {
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.playback.mockResolvedValue({
        ok: true,
        data: playing({
          isPlaying: false,
          progressMs: 243_000,
          track: track({ kind: 'episode', name: 'Rain at night', artists: 'Relaxing SoundZzz', durationMs: 36_608_000 }),
        }),
      });
    });
    const bar = await screen.findByRole('region', { name: 'Now playing on Spotify' });
    await within(bar).findByText('Rain at night');
    expect(within(bar).getByText('10:10:08')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Shuffle' })).not.toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Forward 15 seconds' }));
    expect(bridge.spotify.seek).toHaveBeenLastCalledWith(258_000);
    await user.click(within(bar).getByRole('button', { name: 'Back 15 seconds' }));
    expect(bridge.spotify.seek).toHaveBeenLastCalledWith(243_000);
    expect(within(bar).getByRole('button', { name: 'Next episode' })).toBeInTheDocument();
  });

  it('offers to set up Spotify in the player bar before connecting', async () => {
    const { user } = await openMusic();
    await goTo(user, 'Calendar');
    const bar = await screen.findByRole('region', { name: 'Spotify player' });
    await user.click(within(bar).getByRole('button', { name: /Set up Spotify/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Music' })).toBeInTheDocument();
  });

  it('lists Liked Songs and playlists, and plays a song inside its playlist or adds it to the queue', async () => {
    const mine = { uri: 'spotify:playlist:1111111111111111111111', name: 'LOFI', owner: 'luizhsc10', trackCount: 2, imageId: null };
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.playlists.mockResolvedValue({ ok: true, data: [mine] });
      fake.spotify.playlistItems.mockResolvedValue({
        ok: true,
        data: {
          tracks: [track({ uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa', name: 'Rain' }), track({ uri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb', name: 'Snow' })],
          total: 3,
          nextOffset: 2,
        },
      });
    });
    const library = await screen.findByRole('region', { name: 'Your library' });
    const sources = within(library).getByRole('navigation', { name: 'Liked Songs and playlists' });
    await user.click(await within(sources).findByRole('button', { name: /LOFI/ }));

    expect(bridge.spotify.playlistItems).toHaveBeenCalledWith('1111111111111111111111', 0);
    const songs = await within(library).findByRole('list', { name: 'Songs in LOFI' });
    expect(within(library).getByText('luizhsc10 · 3 songs')).toBeInTheDocument();
    expect(within(songs).getAllByRole('listitem')).toHaveLength(2);

    await user.click(within(songs).getByRole('button', { name: 'Play Snow' }));
    expect(bridge.spotify.play).toHaveBeenLastCalledWith({ uri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb', contextUri: mine.uri });
    await user.click(within(songs).getByRole('button', { name: 'Add Rain to the queue' }));
    expect(bridge.spotify.queue).toHaveBeenCalledWith('spotify:track:aaaaaaaaaaaaaaaaaaaaaa');
    expect(await within(library).findByRole('status')).toHaveTextContent('Added to the queue.');

    bridge.spotify.playlistItems.mockResolvedValueOnce({
      ok: true,
      data: { tracks: [track({ uri: 'spotify:track:cccccccccccccccccccccc', name: 'Wind' })], total: 3, nextOffset: null },
    });
    await user.click(within(library).getByRole('button', { name: 'Show more songs' }));
    expect(await within(songs).findByText('Wind')).toBeInTheDocument();
    expect(bridge.spotify.playlistItems).toHaveBeenLastCalledWith('1111111111111111111111', 2);
    expect(within(library).queryByRole('button', { name: 'Show more songs' })).not.toBeInTheDocument();

    await user.click(within(library).getByRole('button', { name: 'Play LOFI' }));
    expect(bridge.spotify.play).toHaveBeenLastCalledWith({ uri: mine.uri });
  });

  it('plays Liked Songs from the chosen one on, and explains playlists Spotify does not list', async () => {
    const followed = { uri: 'spotify:playlist:3333333333333333333333', name: 'TOP FUNK', owner: 'melovrant', trackCount: null, imageId: null };
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.playlists.mockResolvedValue({ ok: true, data: [followed] });
      fake.spotify.likedSongs.mockResolvedValue({
        ok: true,
        data: {
          tracks: [track({ uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa', name: 'First' }), track({ uri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb', name: 'Second' })],
          total: 2,
          nextOffset: null,
        },
      });
      fake.spotify.playlistItems.mockResolvedValue({
        ok: false,
        error: { status: 403, code: 'SPOTIFY_PLAYLIST_HIDDEN', message: 'Spotify only lists the songs of playlists you made or collaborate on. This one can still be played.' },
      });
    });
    const library = await screen.findByRole('region', { name: 'Your library' });

    await user.click(within(library).getByRole('button', { name: 'Liked Songs' }));
    const songs = await within(library).findByRole('list', { name: 'Songs in Liked Songs' });
    await user.click(within(songs).getByRole('button', { name: 'Play Second' }));
    expect(bridge.spotify.play).toHaveBeenLastCalledWith({ uri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb', uris: ['spotify:track:bbbbbbbbbbbbbbbbbbbbbb'] });

    await user.click(await within(library).findByRole('button', { name: /TOP FUNK/ }));
    expect(await within(library).findByText(/can still be played/)).toBeInTheDocument();
    await user.click(within(library).getByRole('button', { name: 'Play TOP FUNK' }));
    expect(bridge.spotify.play).toHaveBeenLastCalledWith({ uri: followed.uri });
  });

  it('searches and plays a song or a playlist', async () => {
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.search.mockResolvedValue({
        ok: true,
        data: {
          tracks: [track()],
          playlists: [{ uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', name: 'Deep Focus', owner: 'Spotify', trackCount: 200, imageId: null }],
        },
      });
    });

    await user.type(await screen.findByRole('textbox', { name: 'Search Spotify' }), 'debussy{Enter}');
    expect(bridge.spotify.search).toHaveBeenCalledWith('debussy');
    await user.click(await screen.findByRole('button', { name: 'Play Clair de Lune' }));
    await user.click(screen.getByRole('button', { name: 'Play Deep Focus' }));

    expect(bridge.spotify.play).toHaveBeenNthCalledWith(1, { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' });
    expect(bridge.spotify.play).toHaveBeenNthCalledWith(2, { uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' });
    expect(screen.getByText(/200 songs/)).toBeInTheDocument();
  });

  it('plays on a chosen device', async () => {
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.devices.mockResolvedValue({
        ok: true,
        data: [
          { id: 'laptop', name: 'Laptop', type: 'Computer', isActive: true },
          { id: 'phone', name: 'Phone', type: 'Smartphone', isActive: false },
        ],
      });
    });

    await user.click(await screen.findByRole('button', { name: 'Find devices' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Spotify device' }), 'Phone');

    expect(bridge.spotify.transfer).toHaveBeenCalledWith('phone');
  });

  it.each([
    ['SPOTIFY_PREMIUM_REQUIRED', 'Spotify only allows controlling playback with a Premium account.'],
    ['SPOTIFY_NO_DEVICE', 'Nothing is playing on Spotify right now. Press play to start it.'],
  ])('explains %s', async (code, message) => {
    const { user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.play.mockResolvedValue({ ok: false, error: { status: 403, code, message } });
    });

    const now = await screen.findByRole('region', { name: 'Now playing' });
    await user.click(await within(now).findByRole('button', { name: 'Play' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('disconnects', async () => {
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.disconnect.mockResolvedValue({ ok: true, data: { clientId: CLIENT_ID, redirectUri: REDIRECT, connected: false, displayName: null } });
    });

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(bridge.spotify.disconnect).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Connect Spotify' })).toBeInTheDocument();
  });

  it('does not ask Spotify for anything until connected', async () => {
    const { bridge } = await openMusic();

    await screen.findByLabelText('Client ID');
    expect(bridge.spotify.playback).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Now playing on Spotify' })).not.toBeInTheDocument();
  });

  it.each([
    ['set-up', { clientId: null, redirectUri: REDIRECT, connected: false, displayName: null }],
    ['connected', CONNECTED],
  ])('the %s screen has no accessibility violations', async (_name, status) => {
    await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: status });
      fake.spotify.playback.mockResolvedValue({ ok: true, data: playing() });
    });
    await screen.findAllByRole('heading', { level: 2 });

    expect(await accessibilityProblems(document.body)).toEqual([]);
  });
});
