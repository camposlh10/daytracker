import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installFakeBridge } from '../../test/fakeBridge';
import { describeWeather, WeatherBadge } from './WeatherBadge';

describe('WeatherBadge', () => {
  it('shows the pixel picture and the temperature, naming the conditions without writing them', async () => {
    const { bridge } = installFakeBridge();
    bridge.weather.current.mockResolvedValue({ ok: true, data: { temperatureC: 17.8, preferredUnit: 'C', code: 3, isDay: false } });
    const { container } = render(<WeatherBadge />);

    expect(await screen.findByText('18°C')).toBeInTheDocument();
    const picture = screen.getByRole('img', { name: 'Overcast' });
    expect(picture.getAttribute('src')).toMatch(/overcast\.gif$/);
    // The still frame is used when Windows asks for less motion.
    expect(container.querySelector('source')).toHaveAttribute('media', '(prefers-reduced-motion: reduce)');
    expect(container.querySelector('source')?.getAttribute('srcset')).toMatch(/overcast\.still\.png$/);
    expect(screen.queryByText('Overcast')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('title', 'Overcast, 18°C');
  });

  it('starts in the unit Windows suggests, and a click switches and is remembered', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.weather.current.mockResolvedValue({ ok: true, data: { temperatureC: 17.8, preferredUnit: 'F', code: 3, isDay: false } });
    const { unmount } = render(<WeatherBadge />);

    await user.click(await screen.findByRole('button', { name: '64°F, show in °C' }));
    expect(screen.getByRole('button', { name: '18°C, show in °F' })).toBeInTheDocument();
    unmount();

    render(<WeatherBadge />);
    expect(await screen.findByText('18°C')).toBeInTheDocument();
  });

  it('says when Windows location is off, with how to turn it on', async () => {
    const { bridge } = installFakeBridge();
    const message = 'Location is off for desktop apps. Turn it on in Windows Settings, Privacy & security, Location.';
    bridge.weather.current.mockResolvedValue({ ok: false, error: { status: 0, code: 'LOCATION_OFF', message } });
    render(<WeatherBadge />);

    expect(await screen.findByText('No location')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('shows nothing when the weather cannot be fetched', async () => {
    const { bridge } = installFakeBridge();
    const { container } = render(<WeatherBadge />);

    await waitFor(() => expect(bridge.weather.current).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [0, 'Clear', 'sunny'],
    [1, 'Mostly clear', 'mostly_sunny'],
    [2, 'Partly cloudy', 'partly_cloudy'],
    [3, 'Overcast', 'overcast'],
    [45, 'Fog', 'cloudy'],
    [53, 'Drizzle', 'rain'],
    [57, 'Freezing drizzle', 'sleet'],
    [63, 'Rain', 'rain'],
    [65, 'Heavy rain', 'overcast_rain'],
    [67, 'Freezing rain', 'overcast_sleet'],
    [73, 'Snow', 'snow'],
    [75, 'Heavy snow', 'overcast_snow'],
    [81, 'Showers', 'rain'],
    [86, 'Snow showers', 'snow'],
    [95, 'Thunderstorm', 'rain_thunder'],
    [99, 'Thunderstorm with hail', 'rainy_thunderstorm'],
  ])('describes code %i as %s, with the %s icon', (code, label, icon) => {
    expect(describeWeather(code)).toEqual({ label, icon });
  });
});
