import appIcon from '../assets/app-icon.png';
import styles from './Logo.module.css';

/**
 * Day Tracker's icon, the same picture as its program file and desktop shortcut.
 * Decorative: the name is always written next to it.
 */
export function Logo({ size = 40 }: { size?: number }) {
  return <img className={styles.logo} src={appIcon} width={size} height={size} alt="" draggable={false} />;
}
