import { useEffect, useRef } from 'react';
import styles from './Swatch.module.css';

/**
 * A small dot in a user-chosen color. The content security policy forbids inline
 * style attributes, so the color is applied through the CSS object model.
 */
export function Swatch({ color }: { color: string }) {
  const dot = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (dot.current) {
      dot.current.style.backgroundColor = color;
    }
  }, [color]);

  return <span ref={dot} className={styles.swatch} aria-hidden="true" />;
}
