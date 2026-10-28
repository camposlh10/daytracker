import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { appSettings, emptyDay, installFakeBridge } from '../../test/fakeBridge';
import { SettingsPage } from './SettingsPage';

const URL = 'https://day-tracker.up.railway.app';
const TOKEN = 'a-long-access-token-0123456789abcdef0123';

function setup(prepare: (bridge: ReturnType<typeof installFakeBridge>['bridge']) => void = () => undefined) {
  const fake = installFakeBridge();
  fake.bridge.calendar.getDay.mockResolvedValue({ ok: true, data: emptyDay('2026-10-28') });
  fake.bridge.readingGoals.list.mockResolvedValue({ ok: true, data: [] });
  prepare(fake.bridge);
  render(
    <SettingsPage
      settings={appSettings()}
      today="2026-10-28"
      backendReady
      onSave={vi.fn(async () => appSettings())}
      onDataChanged={vi.fn()}
    />,
  );
  return { ...fake, user: userEvent.setup() };
}

describe('Where your data lives', () => {
  it('says the data is on this computer by default', async () => {
    setup();

    expect(await screen.findByText('On this computer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore from a file…' })).toBeInTheDocument();
  });

  it('tests a server without switching to it', async () => {
    const { bridge, user } = setup();

    await user.type(await screen.findByLabelText('Server address'), URL);
    await user.type(screen.getByLabelText('Access token'), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(bridge.server.test).toHaveBeenCalledWith({ url: URL, token: TOKEN });
    expect(await screen.findByText(/accepted the token/)).toBeInTheDocument();
    expect(bridge.server.use).not.toHaveBeenCalled();
  });

  it('keeps the token out of sight', async () => {
    setup();

    expect(await screen.findByLabelText('Access token')).toHaveAttribute('type', 'password');
  });

  it('switches to the server and reports a refusal in words', async () => {
    const { bridge, user } = setup((fake) =>
      fake.server.use
        .mockResolvedValueOnce({ ok: false, error: { status: 401, code: 'SERVER_TOKEN_REFUSED', message: 'The server refused this access token.' } })
        .mockResolvedValueOnce({ ok: true, data: null }),
    );

    await user.type(await screen.findByLabelText('Server address'), URL);
    await user.type(screen.getByLabelText('Access token'), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Use this server' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('refused this access token');

    await user.click(screen.getByRole('button', { name: 'Use this server' }));
    await waitFor(() => expect(bridge.server.use).toHaveBeenCalledTimes(2));
    expect(bridge.server.use).toHaveBeenLastCalledWith({ url: URL, token: TOKEN });
  });

  it('on a server, hides the tools that only work on this computer and offers to switch back', async () => {
    const { bridge, user } = setup((fake) =>
      fake.server.describe.mockResolvedValue({ activeUrl: URL, savedUrl: URL, canEncrypt: true }),
    );

    expect(await screen.findByText(URL, { selector: 'code' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore from a file…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open backup folder' })).not.toBeInTheDocument();
    expect(screen.getByText(/backups are kept there/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use this computer instead' }));
    expect(bridge.server.use).toHaveBeenCalledWith(null);
  });

  it('explains when Windows cannot protect the token', async () => {
    setup((fake) => fake.server.describe.mockResolvedValue({ activeUrl: null, savedUrl: null, canEncrypt: false }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot encrypt the token');
    expect(screen.queryByLabelText('Access token')).not.toBeInTheDocument();
  });
});
