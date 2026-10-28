import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SpotifyPlayback, SpotifyStatus, SpotifyTrack } from '../../api/bridge';
import { App } from '../../App';
import { accessibilityProblems } from '../../test/a11y';
import { installFakeBridge } from '../../test/fakeBridge';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const REDIRECT = 'http://127.0.0.1:43821/callback';
const CONNECTED: SpotifyStatus = { clientId: CLIENT_ID, redirectUri: REDIRECT, connected: true, displayName: 'Ana' };

function track(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    name: 'Clair de Lune',
    artists: 'Claude Debussy',
    album: 'Suite bergamasque',
    durationMs: 302_000,
    imageId: 'a'.repeat(40),
    ...overrides,
  };
}

function playing(overrides: Partial<SpotifyPlayback> = {}): SpotifyPlayback {
  return { isPlaying: true, progressMs: 1000, track: track(), deviceName: 'Laptop', ...overrides };
}

async function openMusic(prepare: (bridge: ReturnType<typeof installFakeBridge>['bridge']) => void = () => undefined) {
  const fake = installFakeBridge({ status: 'ready' });
  prepare(fake.bridge);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('grid');
  await user.click(screen.getByRole('button', { name: 'Music' }));
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

  it('shows what is playing, with controls here and in the sidebar', async () => {
    const { bridge, user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.playback.mockResolvedValue({ ok: true, data: playing() });
    });

    const now = await screen.findByRole('region', { name: 'Now playing' });
    expect(await within(now).findByText('Clair de Lune')).toBeInTheDocument();
    expect(within(now).getByText('On Laptop')).toBeInTheDocument();
    expect(now.querySelector('img')).toHaveAttribute('src', `dt-spotify://image/${'a'.repeat(40)}`);
    const sidebar = screen.getByRole('region', { name: 'Now playing on Spotify' });
    expect(within(sidebar).getByText('Clair de Lune')).toBeInTheDocument();

    await user.click(within(now).getByRole('button', { name: 'Pause' }));
    await user.click(within(now).getByRole('button', { name: 'Next song' }));
    await user.click(within(sidebar).getByRole('button', { name: 'Next song' }));

    expect(bridge.spotify.pause).toHaveBeenCalledTimes(1);
    expect(bridge.spotify.next).toHaveBeenCalledTimes(2);
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
    ['SPOTIFY_NO_DEVICE', 'No Spotify device is active. Open Spotify on this computer or your phone, then try again.'],
  ])('explains %s', async (code, message) => {
    const { user } = await openMusic((fake) => {
      fake.spotify.status.mockResolvedValue({ ok: true, data: CONNECTED });
      fake.spotify.play.mockResolvedValue({ ok: false, error: { status: 403, code, message } });
    });

    await user.click(await screen.findByRole('button', { name: 'Play' }));

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
