import { useEffect, useState } from 'react';

const QUERY = '(max-height: 800px)';

function matches(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/** True when the window is short, so the month grid shows fewer items per day to avoid scrolling. */
export function useCompactHeight(): boolean {
  const [compact, setCompact] = useState(matches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia(QUERY);
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return compact;
}
