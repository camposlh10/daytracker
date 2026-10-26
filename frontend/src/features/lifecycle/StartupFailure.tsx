import { bridge } from '../../api/bridge';
import { Button } from '../../components/Button';
import styles from './lifecycle.module.css';

/** Shown instead of the workspace when the backend never became ready. */
export function StartupFailure({ message }: { message: string }) {
  return (
    <main className={styles.fullPage}>
      <section className={styles.card} role="alert" aria-labelledby="startup-failure-title">
        <h1 id="startup-failure-title">Day Tracker could not start</h1>
        <p className={styles.message}>{message}</p>
        <p className={styles.message}>Your saved data has not been changed.</p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void bridge().backend.restart()}>
            Retry
          </Button>
          <Button onClick={() => void bridge().app.openDiagnostics()}>Open diagnostics</Button>
          <Button onClick={() => void bridge().app.exit()}>Exit</Button>
        </div>
      </section>
    </main>
  );
}
