import { bridge } from '../../api/bridge';
import { Button } from '../../components/Button';
import styles from './lifecycle.module.css';

/**
 * Shown above the workspace when the backend stops after having been ready.
 * The workspace stays mounted so unsaved input is not lost.
 */
export function BackendDownBanner({ restarting }: { restarting: boolean }) {
  return (
    <div className={styles.banner} role="alert">
      <p>
        {restarting
          ? 'Restarting the data service…'
          : 'The data service stopped. Changes are disabled until it is restarted; anything you typed is still here.'}
      </p>
      {!restarting && (
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void bridge().backend.restart()}>
            Restart
          </Button>
          <Button onClick={() => void bridge().app.openDiagnostics()}>Open diagnostics</Button>
        </div>
      )}
    </div>
  );
}
