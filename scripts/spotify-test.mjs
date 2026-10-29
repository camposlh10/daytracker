// The Spotify client against a fake Spotify on 127.0.0.1: no real account or network.
//
//   node scripts/spotify-test.mjs
//
// Needs the compiled desktop sources (npm run build in desktop/).

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { SpotifyClient } = createRequire(import.meta.url)(path.join(root, 'desktop', 'dist', 'spotifyClient.js'));

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const ART = 'https://i.scdn.co/image/ab67616d00001e02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.slice(0, 24 + 40);
const TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';

// ---- The fake Spotify ------------------------------------------------------------
const fake = {
  codes: new Map(),
  refreshTokens: new Set(),
  accessTokens: new Set(),
  lastAuthorize: null,
  lastPlayBody: null,
  lastPlayQuery: null,
  expireNextAccess: false,
  deny: false,
  wrongStateFirst: false,
  nextPlayerError: null,
  revoked: false,
  tokenCalls: 0,
  devices: [{ id: 'device1', name: 'Laptop', type: 'Computer', is_active: true }, { id: null, name: 'Restricted' }],
  // How many more play commands fail as if nothing were playing.
  idlePlays: 0,
  lastTransfer: null,
  lastCommand: null,
  episode: false,
  lastPlaybackQuery: null,
};
let counter = 0;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const body = await new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => resolve(text));
  });
  const json = (status, data, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(data === undefined ? '' : JSON.stringify(data));
  };

  if (url.pathname === '/accounts/authorize') {
    fake.lastAuthorize = url.searchParams;
    const redirect = new URL(url.searchParams.get('redirect_uri'));
    if (fake.wrongStateFirst) {
      fake.wrongStateFirst = false;
      // Something else knocks on the listener first; it must be ignored.
      await fetch(`${redirect}?code=evil&state=not-the-state`).catch(() => undefined);
    }
    if (fake.deny) {
      redirect.search = new URLSearchParams({ error: 'access_denied', state: url.searchParams.get('state') }).toString();
    } else {
      const code = `code-${++counter}`;
      fake.codes.set(code, { challenge: url.searchParams.get('code_challenge'), redirect: url.searchParams.get('redirect_uri') });
      redirect.search = new URLSearchParams({ code, state: url.searchParams.get('state') }).toString();
    }
    response.writeHead(302, { Location: redirect.toString() }).end();
    return;
  }
  if (url.pathname === '/accounts/api/token') {
    fake.tokenCalls += 1;
    const form = new URLSearchParams(body);
    if (form.get('client_id') !== CLIENT_ID) return json(400, { error: 'invalid_client' });
    if (form.get('grant_type') === 'authorization_code') {
      const entry = fake.codes.get(form.get('code'));
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (!entry || entry.challenge !== challenge || entry.redirect !== form.get('redirect_uri')) {
        return json(400, { error: 'invalid_grant' });
      }
      fake.codes.delete(form.get('code'));
    } else if (form.get('grant_type') === 'refresh_token') {
      if (fake.revoked || !fake.refreshTokens.has(form.get('refresh_token'))) return json(400, { error: 'invalid_grant' });
      fake.refreshTokens.delete(form.get('refresh_token'));
    } else {
      return json(400, { error: 'unsupported_grant_type' });
    }
    const access = `access-${++counter}`;
    const refresh = `refresh-${++counter}`;
    fake.accessTokens.add(access);
    fake.refreshTokens.add(refresh);
    return json(200, { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: 'x' });
  }
  if (url.pathname.startsWith('/v1/')) {
    const token = (request.headers.authorization ?? '').replace('Bearer ', '');
    if (!fake.accessTokens.has(token)) return json(401, { error: { status: 401, message: 'The access token expired' } });
    if (fake.expireNextAccess) {
      fake.expireNextAccess = false;
      fake.accessTokens.delete(token);
      return json(401, { error: { status: 401, message: 'The access token expired' } });
    }
    const route = `${request.method} ${url.pathname}`;
    if (route === 'GET /v1/me') return json(200, { display_name: 'Ana Tester', id: 'ana' });
    if (route === 'GET /v1/search') {
      if (Number(url.searchParams.get('limit')) > 10) return json(400, { error: { status: 400, message: 'Invalid limit' } });
      return json(200, {
        tracks: {
          items: [
            { type: 'track', uri: `spotify:track:${TRACK_ID}`, name: 'Clair de Lune', duration_ms: 300000,
              artists: [{ name: 'Debussy' }, { name: 'Someone' }],
              album: { name: 'Suite', images: [{ url: ART, width: 300 }, { url: 'https://i.scdn.co/image/' + 'b'.repeat(40), width: 64 }] } },
          ],
        },
        playlists: {
          items: [
            null,
            { uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', name: 'Focus', owner: { display_name: 'Spotify' }, items: { total: 50 },
              images: [{ url: 'https://mosaic.scdn.co/640/abc', width: 640 }] },
          ],
        },
      });
    }
    if (route === 'GET /v1/me/playlists') return json(200, { items: [{ uri: 'spotify:playlist:1111111111111111111111', name: 'Mine', owner: { display_name: 'Ana' }, tracks: { total: 3 }, images: [] }] });
    if (route === 'GET /v1/playlists/1111111111111111111111/items') {
      fake.lastItemsQuery = url.searchParams;
      const offset = Number(url.searchParams.get('offset'));
      return json(200, {
        total: 3,
        next: offset === 0 ? 'more' : null,
        items:
          offset === 0
            ? [
                { item: { type: 'track', uri: `spotify:track:${TRACK_ID}`, name: 'Clair de Lune', artists: [{ name: 'Debussy' }], album: { name: 'Suite', images: [] }, duration_ms: 300000 } },
                { item: null },
              ]
            : [{ track: { type: 'track', uri: 'spotify:track:2222222222222222222222', name: 'Older shape', artists: [], album: { images: [] } } }],
      });
    }
    if (route === 'GET /v1/playlists/3333333333333333333333/items') return json(403, { error: { status: 403, message: 'Forbidden' } });
    if (route === 'GET /v1/me/tracks') {
      if (fake.noLibraryScope) return json(403, { error: { status: 403, message: 'Insufficient client scope' } });
      return json(200, { total: 1, next: null, items: [{ added_at: 'x', track: { type: 'track', uri: `spotify:track:${TRACK_ID}`, name: 'Liked one', artists: [], album: { images: [] } } }] });
    }
    if (route === 'GET /v1/me/player/devices') return json(200, { devices: fake.devices });
    if (route === 'GET /v1/me/player') {
      fake.lastPlaybackQuery = url.searchParams;
      if (fake.nothingPlaying) return json(204);
      const item = fake.episode
        ? { type: 'episode', uri: 'spotify:episode:512ojhOuo1ktJprKbVcKyQ', name: 'Rain at night', duration_ms: 36608000, images: [{ url: 'https://i.scdn.co/image/' + 'c'.repeat(40), width: 300 }], show: { name: 'Relaxing SoundZzz', publisher: 'Someone' } }
        : { type: 'track', uri: `spotify:track:${TRACK_ID}`, name: 'Clair de Lune', artists: [], album: { images: [] } };
      return json(200, { is_playing: true, progress_ms: 1234, shuffle_state: true, repeat_state: 'context', device: { name: 'Laptop', volume_percent: 64, supports_volume: true }, item });
    }
    if (url.pathname.startsWith('/v1/me/player')) {
      if (fake.nextPlayerError) {
        const error = fake.nextPlayerError;
        fake.nextPlayerError = null;
        return json(error.status, { error: { status: error.status, message: error.message, reason: error.reason } }, error.headers);
      }
      if (route === 'PUT /v1/me/player/play') {
        if (fake.idlePlays > 0) {
          fake.idlePlays -= 1;
          return json(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } });
        }
        fake.lastPlayBody = body ? JSON.parse(body) : null;
        fake.lastPlayQuery = url.searchParams;
      }
      if (route === 'PUT /v1/me/player') fake.lastTransfer = JSON.parse(body);
      fake.lastCommand = `${route}?${url.searchParams}`;
      return json(204);
    }
  }
  json(404, { error: { status: 404, message: 'Unknown' } });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- The client under test --------------------------------------------------------
const saved = { clientId: null, redirectUri: null, refreshToken: null };
const registered = [];
const store = { load: async () => ({ ...saved }), save: async (data) => Object.assign(saved, data) };
const opened = [];
// A client for picking a device when nothing plays, on the same connection as the main one.
const wakingClient = (options) =>
  new SpotifyClient({ store, openBrowser: async () => undefined, apiBase: `${base}/v1`, accountsBase: `${base}/accounts`, deviceWaitMs: 400, devicePollMs: 20, ...options });
const client = new SpotifyClient({
  store,
  // The "browser": follows Spotify's redirect back to the app's listener, or hands an
  // app link to the app the way Windows would.
  openBrowser: async (url) => {
    opened.push(url);
    void (async () => {
      const answer = await fetch(url, { redirect: 'manual' });
      const location = answer.headers.get('location');
      if (!location) return;
      if (location.startsWith('https://day-tracker.example/spotify/callback')) {
        // What the server's relay page does: back to this computer, on the port in the state.
        const answer = new URL(location);
        const port = answer.searchParams.get('state').split('.')[1];
        await fetch(`http://127.0.0.1:${port}/callback?${answer.searchParams}`);
      } else if (location.startsWith('http')) await fetch(location);
      else client.handleLink(location);
    })().catch(() => undefined);
  },
  registerScheme: (scheme) => registered.push(scheme),
  accountsBase: `${base}/accounts`,
  apiBase: `${base}/v1`,
  loginTimeoutMs: 3000,
});

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? '  ok ' : ' FAIL'} ${message}`);
  if (!condition) failures += 1;
}

try {
  console.log('Setting up');
  const notConfigured = await client.connect();
  check(!notConfigured.ok && notConfigured.error.code === 'SPOTIFY_NOT_CONFIGURED', 'connecting needs a Client ID first');
  const badId = await client.configure('not-a-client-id', 'http://127.0.0.1/callback');
  check(!badId.ok && badId.error.status === 400, 'a malformed Client ID is refused');
  for (const uri of ['https://example.com/callback?next=1', 'http://example.com/callback', 'http://localhost:8080/callback', 'http://192.168.1.2:80/cb', 'javascript://alert(1)', 'spotify://x', 'http://127.0.0.1:99999/cb']) {
    const refused = await client.configure(CLIENT_ID, uri);
    check(!refused.ok && refused.error.status === 400, `a redirect the app cannot receive is refused: ${uri}`);
  }
  const configured = await client.configure(` ${CLIENT_ID} `, 'http://127.0.0.1/callback');
  check(configured.ok && configured.data.clientId === CLIENT_ID && !configured.data.connected, 'the Client ID is stored, not yet connected');

  console.log('Signing in');
  fake.wrongStateFirst = true;
  const connected = await client.connect();
  check(connected.ok && connected.data.connected && connected.data.displayName === 'Ana Tester', 'sign-in completes and the account name is known');
  const params = fake.lastAuthorize;
  check(opened.length === 1 && opened[0].startsWith(`${base}/accounts/authorize?`), 'only the sign-in page was opened');
  check(params.get('code_challenge_method') === 'S256' && params.get('response_type') === 'code' && !params.has('client_secret'), 'it uses PKCE and no client secret');
  check(/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(params.get('redirect_uri')), 'the answer comes back to a loopback address with a free port');
  check(params.get('scope').includes('user-modify-playback-state') && params.get('scope').includes('user-read-playback-state'), 'it asks only for playback and playlist scopes');
  check(params.get('scope').includes('user-library-read') && params.get('scope').includes('playlist-read-collaborative'), 'it asks to read Liked Songs and collaborative playlists');
  check(saved.refreshToken?.startsWith('refresh-') && !JSON.stringify(saved).includes('access-'), 'only the refresh token is stored, never the access token');

  console.log('Using the API');
  const search = await client.search('debussy');
  const track = search.data?.tracks[0];
  check(search.ok && track?.name === 'Clair de Lune' && track.artists === 'Debussy, Someone', 'search returns tracks with their artists');
  check(track?.imageId === 'b'.repeat(40), 'album art is the smallest image of at least 64 pixels, as an i.scdn.co id');
  check(search.data?.playlists.length === 1 && search.data.playlists[0].trackCount === 50 && search.data.playlists[0].imageId === null, 'null playlists are skipped, the renamed items count is read, and images from other hosts are dropped');
  const mine = await client.playlists();
  check(mine.ok && mine.data[0].name === 'Mine' && mine.data[0].trackCount === 3, 'the user’s playlists are listed');
  const devices = await client.devices();
  check(devices.ok && devices.data.length === 1 && devices.data[0].isActive, 'devices without an id are skipped');
  const playback = await client.playback();
  check(playback.ok && playback.data.isPlaying && playback.data.track.name === 'Clair de Lune' && playback.data.track.kind === 'track' && playback.data.deviceName === 'Laptop', 'what is playing is reported');
  check(playback.data?.volumePercent === 64 && playback.data.shuffle === true && playback.data.repeat === 'context', 'volume, shuffle and repeat are reported');
  check(fake.lastPlaybackQuery?.get('additional_types') === 'track,episode', 'podcast episodes are asked for too');
  fake.episode = true;
  const episode = await client.playback();
  const item = episode.data?.track;
  check(item?.kind === 'episode' && item.name === 'Rain at night' && item.artists === 'Relaxing SoundZzz' && item.durationMs === 36608000 && item.imageId === 'c'.repeat(40), 'a podcast episode is reported with its show and cover');
  fake.episode = false;
  fake.nothingPlaying = true;
  const idle = await client.playback();
  check(idle.ok && idle.data === null, 'nothing playing is reported as nothing');
  fake.nothingPlaying = false;

  console.log('Library');
  const page = await client.playlistItems('1111111111111111111111');
  check(page.ok && page.data.tracks.length === 1 && page.data.tracks[0].name === 'Clair de Lune' && page.data.total === 3 && page.data.nextOffset === 2, 'a playlist page lists its playable songs, its total and where the next page starts');
  check(fake.lastItemsQuery.get('limit') === '50' && fake.lastItemsQuery.get('offset') === '0', 'pages are 50 songs');
  const second = await client.playlistItems('1111111111111111111111', 2);
  check(second.ok && second.data.tracks[0].name === 'Older shape' && second.data.nextOffset === null, 'the older "track" shape is read too, and the last page says so');
  const hidden = await client.playlistItems('3333333333333333333333');
  check(!hidden.ok && hidden.error.code === 'SPOTIFY_PLAYLIST_HIDDEN' && hidden.error.message.includes('can still be played'), 'a playlist Spotify will not list says it can still be played');
  const liked = await client.likedSongs();
  check(liked.ok && liked.data.tracks[0].name === 'Liked one', 'Liked Songs are listed');
  fake.noLibraryScope = true;
  const reconnect = await client.likedSongs();
  check(!reconnect.ok && reconnect.error.code === 'SPOTIFY_RECONNECT', 'a connection without the Liked Songs permission is asked to connect again');
  fake.noLibraryScope = false;
  const queued = await client.queue(`spotify:track:${TRACK_ID}`);
  check(queued.ok && fake.lastCommand === `POST /v1/me/player/queue?uri=spotify%3Atrack%3A${TRACK_ID}`, 'a song is added to the queue');

  console.log('Playback control');
  await client.play({ uri: `spotify:track:${TRACK_ID}` });
  check(JSON.stringify(fake.lastPlayBody) === JSON.stringify({ uris: [`spotify:track:${TRACK_ID}`] }), 'a track is played as a single-track list');
  await client.play({ uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', deviceId: 'device1' });
  check(fake.lastPlayBody?.context_uri === 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' && fake.lastPlayQuery.get('device_id') === 'device1', 'a playlist is played as a context on the chosen device');
  await client.play();
  check(fake.lastPlayBody === null, 'play without a target resumes');
  await client.play({ uri: `spotify:track:${TRACK_ID}`, contextUri: 'spotify:playlist:1111111111111111111111' });
  check(fake.lastPlayBody?.context_uri === 'spotify:playlist:1111111111111111111111' && fake.lastPlayBody.offset?.uri === `spotify:track:${TRACK_ID}`, 'a song is played inside its playlist, which carries on after it');
  await client.play({ uri: `spotify:track:${TRACK_ID}`, uris: ['spotify:track:2222222222222222222222', `spotify:track:${TRACK_ID}`] });
  check(fake.lastPlayBody?.uris?.length === 2 && fake.lastPlayBody.offset?.uri === `spotify:track:${TRACK_ID}`, 'a liked song is played with the songs listed with it');
  for (const action of ['pause', 'next', 'previous']) {
    const result = await client[action]();
    check(result.ok, `${action} works`);
  }
  for (const [action, value, expected] of [
    ['seek', 90500, 'PUT /v1/me/player/seek?position_ms=90500'],
    ['volume', 35, 'PUT /v1/me/player/volume?volume_percent=35'],
    ['shuffle', false, 'PUT /v1/me/player/shuffle?state=false'],
    ['repeat', 'track', 'PUT /v1/me/player/repeat?state=track'],
  ]) {
    const result = await client[action](value);
    check(result.ok && fake.lastCommand === expected, `${action} is sent as ${expected}`);
  }
  fake.nextPlayerError = { status: 403, reason: 'PREMIUM_REQUIRED', message: 'Player command failed: Premium required' };
  const premium = await client.pause();
  check(!premium.ok && premium.error.code === 'SPOTIFY_PREMIUM_REQUIRED', 'a free account is told that playback control needs Premium');
  fake.nextPlayerError = { status: 404, reason: 'NO_ACTIVE_DEVICE', message: 'Player command failed: No active device found' };
  const noDevice = await client.pause();
  check(!noDevice.ok && noDevice.error.code === 'SPOTIFY_NO_DEVICE', 'pausing with nothing playing is explained');

  console.log('Playing when nothing is playing');
  const allDevices = fake.devices;
  let starts = 0;
  fake.idlePlays = 1;
  fake.lastTransfer = null;
  const openDevice = await wakingClient({ startSpotify: async () => false }).play();
  check(openDevice.ok && fake.lastTransfer?.device_ids?.[0] === 'device1' && fake.lastTransfer.play === true, 'resuming carries on on an open device when Spotify cannot be started here');

  fake.devices = [{ id: 'phone1', name: 'Pixel', type: 'Smartphone', is_active: false }, { id: 'here1', name: 'mimosa', type: 'Computer', is_active: false }];
  fake.idlePlays = 1;
  const here = await wakingClient({ computerName: 'MIMOSA', startSpotify: async () => (starts++, true) }).play({ uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' });
  check(here.ok && fake.lastPlayQuery.get('device_id') === 'here1' && starts === 0, 'this computer’s open Spotify is chosen over a phone, without starting another');

  fake.devices = [{ id: 'phone1', name: 'Pixel', type: 'Smartphone', is_active: false }];
  fake.idlePlays = 2;
  const started = await wakingClient({
    computerName: 'MIMOSA',
    startSpotify: async () => {
      starts++;
      // Spotify signs in and appears a moment later, under a name of its own.
      setTimeout(() => fake.devices.push({ id: 'desk1', name: 'My desk', type: 'Computer', is_active: false }), 60);
      return true;
    },
  }).play({ uri: `spotify:track:${TRACK_ID}` });
  check(started.ok && starts === 1 && fake.lastPlayQuery.get('device_id') === 'desk1', 'Spotify is started here and plays once it appears, waiting out a first refusal');

  fake.devices = [];
  fake.idlePlays = 1;
  const neverAppears = await wakingClient({ startSpotify: async () => true }).play();
  check(!neverAppears.ok && neverAppears.error.code === 'SPOTIFY_NO_DEVICE' && neverAppears.error.message.includes('sign in'), 'a started Spotify that never appears asks to sign in to it once');

  fake.idlePlays = 1;
  const notInstalled = await wakingClient({ startSpotify: async () => false }).play();
  check(!notInstalled.ok && notInstalled.error.message.includes('not installed'), 'no Spotify on this computer and no other device is explained');
  fake.idlePlays = 0;
  fake.devices = allDevices;
  fake.nextPlayerError = { status: 429, message: 'API rate limit exceeded', headers: { 'Retry-After': '7' } };
  const limited = await client.next();
  check(!limited.ok && limited.error.code === 'SPOTIFY_RATE_LIMITED' && limited.error.message.includes('7 seconds'), 'rate limiting says how long to wait');

  console.log('Tokens');
  const refreshBefore = saved.refreshToken;
  const callsBefore = fake.tokenCalls;
  fake.expireNextAccess = true;
  const afterExpiry = await client.devices();
  check(afterExpiry.ok && fake.tokenCalls === callsBefore + 1, 'an expired access token is refreshed once and the call retried');
  check(saved.refreshToken !== refreshBefore && fake.refreshTokens.has(saved.refreshToken), 'a rotated refresh token replaces the old one');
  fake.revoked = true;
  fake.expireNextAccess = true;
  const revoked = await client.devices();
  check(!revoked.ok && revoked.error.code === 'SPOTIFY_NOT_CONNECTED' && saved.refreshToken === null, 'a revoked connection is forgotten and asks to connect again');
  fake.revoked = false;

  console.log('Cancelling and disconnecting');
  fake.deny = true;
  const denied = await client.connect();
  check(!denied.ok && denied.error.code === 'CANCELLED', 'saying no on Spotify’s page is a cancel, not an error');
  fake.deny = false;
  const again = await client.connect();
  check(again.ok && again.data.connected, 'connecting again works');
  const disconnected = await client.disconnect();
  check(disconnected.ok && !disconnected.data.connected && saved.refreshToken === null && saved.clientId === CLIENT_ID, 'disconnecting forgets the token but keeps the Client ID');
  const afterDisconnect = await client.search('x');
  check(!afterDisconnect.ok && afterDisconnect.error.code === 'SPOTIFY_NOT_CONNECTED', 'nothing is sent to Spotify after disconnecting');
  console.log('Redirect URI forms');
  await client.configure(CLIENT_ID, 'http://127.0.0.1:43899/cb');
  const fixedPort = await client.connect();
  check(fixedPort.ok && fake.lastAuthorize.get('redirect_uri') === 'http://127.0.0.1:43899/cb', 'a registered port and path are sent exactly as registered');
  await client.configure(CLIENT_ID, 'http://[::1]/callback');
  const ipv6 = await client.connect();
  check(ipv6.ok && /^http:\/\/\[::1\]:\d+\/callback$/.test(fake.lastAuthorize.get('redirect_uri')), 'the IPv6 loopback works, with a free port added');
  const linkSetup = await client.configure(CLIENT_ID, 'daytracker://spotify-callback');
  check(linkSetup.ok && registered.includes('daytracker') && linkSetup.data.redirectUri === 'daytracker://spotify-callback', 'an app link registers its scheme with Windows');
  check(client.handleLink('daytracker://spotify-callback?code=x&state=forged') === false, 'a link that arrives when no sign-in is waiting is ignored');
  const viaLink = await client.connect();
  check(viaLink.ok && viaLink.data.connected && fake.lastAuthorize.get('redirect_uri') === 'daytracker://spotify-callback', 'sign-in completes through the app link');
  await client.configure(CLIENT_ID, 'https://day-tracker.example/spotify/callback');
  const viaRelay = await client.connect();
  check(viaRelay.ok && viaRelay.data.connected, 'sign-in completes through the relay on your own server');
  check(
    fake.lastAuthorize.get('redirect_uri') === 'https://day-tracker.example/spotify/callback' &&
      /^[A-Za-z0-9_-]{22}[.][0-9]{4,5}$/.test(fake.lastAuthorize.get('state')),
    'the https address is sent as registered, and the state carries the local port for the relay',
  );
  const blocker = createServer(() => undefined);
  await new Promise((resolve) => blocker.listen(43898, '127.0.0.1', resolve));
  await client.configure(CLIENT_ID, 'http://127.0.0.1:43898/callback');
  const busy = await client.connect();
  check(!busy.ok && busy.error.message.includes('43898') && busy.error.message.includes('in use'), 'a port taken by another program is explained');
  blocker.close();
  await client.configure('fedcba9876543210fedcba9876543210', 'http://127.0.0.1/callback');
  check(saved.clientId === 'fedcba9876543210fedcba9876543210' && saved.refreshToken === null, 'changing the Client ID drops any token from the old app');
} catch (error) {
  failures += 1;
  console.error(error);
} finally {
  server.close();
}
console.log(failures === 0 ? 'SPOTIFY TEST PASSED' : `SPOTIFY TEST FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
