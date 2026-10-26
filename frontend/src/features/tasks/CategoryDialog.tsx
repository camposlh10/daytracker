import { useRef, useState, type FormEvent } from 'react';
import { categoriesApi, errorMessage } from '../../api/client';
import type { Category, UpdateCategoryInput } from '../../api/bridge';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import form from '../../components/form.module.css';
import styles from './CategoryDialog.module.css';

interface CategoryDialogProps {
  categories: Category[];
  backendReady: boolean;
  onClose: () => void;
  /** Called after every successful change so the list is reloaded. */
  onChanged: () => void;
}

const DEFAULT_COLOR = '#668be8';

/** Add, rename, recolor, archive, and restore categories. */
export function CategoryDialog({ categories, backendReady, onClose, onChanged }: CategoryDialogProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The id belongs to the current draft, so retrying a create cannot make a duplicate.
  const draftId = useRef(crypto.randomUUID());
  const disabled = busy || !backendReady;

  const run = async (operation: () => Promise<unknown>): Promise<boolean> => {
    if (disabled) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      await operation();
      onChanged();
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') {
      return;
    }
    if (await run(() => categoriesApi.create({ id: draftId.current, name, color }))) {
      setName('');
      draftId.current = crypto.randomUUID();
    }
  };

  const update = (category: Category, change: Omit<UpdateCategoryInput, 'version'>) =>
    run(() => categoriesApi.update(category.id, { version: category.version, ...change }));

  return (
    <Dialog title="Categories" size="large" onCancel={onClose} actions={<Button onClick={onClose}>Close</Button>}>
      <form className={styles.add} onSubmit={(event) => void add(event)}>
        <div className={`${form.field} ${styles.grow}`}>
          <label className={form.label} htmlFor="category-name">
            New category
          </label>
          <input
            id="category-name"
            className={form.control}
            value={name}
            maxLength={50}
            placeholder="Name"
            onChange={(event) => {
              setName(event.target.value);
              draftId.current = crypto.randomUUID();
            }}
          />
        </div>
        <div className={form.field}>
          <label className={form.label} htmlFor="category-color">
            Color
          </label>
          <input
            id="category-color"
            type="color"
            className={styles.color}
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" disabled={disabled || name.trim() === ''}>
          Add
        </Button>
      </form>

      {error && (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}

      {categories.length === 0 ? (
        <p>No categories yet.</p>
      ) : (
        <ul className={styles.list} aria-label="Categories">
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} disabled={disabled} onUpdate={update} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}

interface CategoryRowProps {
  category: Category;
  disabled: boolean;
  onUpdate: (category: Category, change: Omit<UpdateCategoryInput, 'version'>) => Promise<boolean>;
}

function CategoryRow({ category, disabled, onUpdate }: CategoryRowProps) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color.toLowerCase());
  const archived = category.archivedAt !== null;
  const renamed = name.trim() !== '' && name.trim() !== category.name;
  const recolored = color !== category.color.toLowerCase();

  const save = () => {
    const change: Omit<UpdateCategoryInput, 'version'> = {};
    if (renamed) change.name = name;
    if (recolored) change.color = color;
    void onUpdate(category, change);
  };

  return (
    <li className={styles.row}>
      <input
        type="color"
        className={styles.color}
        value={color}
        disabled={disabled || archived}
        aria-label={`Color of ${category.name}`}
        onChange={(event) => setColor(event.target.value)}
      />
      <input
        className={`${form.control} ${styles.grow}`}
        value={name}
        maxLength={50}
        disabled={disabled || archived}
        aria-label={`Name of ${category.name}`}
        onChange={(event) => setName(event.target.value)}
      />
      {(renamed || recolored) && (
        <Button variant="primary" disabled={disabled} aria-label={`Save ${category.name}`} onClick={save}>
          Save
        </Button>
      )}
      <Button
        disabled={disabled}
        aria-label={`${archived ? 'Restore' : 'Archive'} ${category.name}`}
        onClick={() => void onUpdate(category, { archived: !archived })}
      >
        {archived ? 'Restore' : 'Archive'}
      </Button>
    </li>
  );
}
