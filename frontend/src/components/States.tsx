import type { ReactNode } from 'react';
import styles from './States.module.css';

export function LoadingState({ label }: { label: string }) {
  return (
    <div className={styles.state} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.state}>
      <p className={styles.title}>{title}</p>
      {children && <p className={styles.detail}>{children}</p>}
    </div>
  );
}

export function ErrorState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className={styles.state} role="alert">
      <p className={styles.error}>{message}</p>
      {action}
    </div>
  );
}
