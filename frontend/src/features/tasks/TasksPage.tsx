import { useEffect, useState } from 'react';
import { tasksApi } from '../../api/client';
import type { Category, TaskListQuery, TaskPriority, TaskStatus } from '../../api/bridge';
import { useLoadable } from '../../app/useLoadable';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { addDays } from '../../lib/dates';
import { CategoryDialog } from './CategoryDialog';
import { TaskDialog, type TaskEditorTarget } from './TaskDialog';
import { TaskRow } from './TaskRow';
import { PRIORITIES, PRIORITY_NAMES, STATUSES, STATUS_LABELS, categoryName } from './taskLabels';
import { useTaskActions } from './useTaskActions';
import form from '../../components/form.module.css';
import styles from './TasksPage.module.css';

type Scope = 'active' | 'unscheduled' | 'archived';

interface Filters {
  text: string;
  scope: Scope;
  status: TaskStatus | '';
  priority: TaskPriority | '';
  categoryId: string;
  plannedDate: string;
}

const NO_FILTERS: Filters = { text: '', scope: 'active', status: '', priority: '', categoryId: '', plannedDate: '' };
const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;

interface TasksPageProps {
  categories: Category[];
  /** False while the backend is down: reads and writes pause. */
  backendReady: boolean;
  /** Changes when data was modified elsewhere. */
  dataVersion?: number;
  /** Called after a task or category was changed here. */
  onDataChanged?: () => void;
}

function toQuery(filters: Filters, text: string, page: number): TaskListQuery {
  const query: TaskListQuery = { page, size: PAGE_SIZE };
  if (text.trim() !== '') query.q = text.trim();
  if (filters.scope === 'unscheduled') query.scheduled = false;
  if (filters.scope === 'archived') query.archived = true;
  if (filters.status) query.status = filters.status;
  if (filters.priority) query.priority = filters.priority;
  if (filters.categoryId) query.categoryId = filters.categoryId;
  if (filters.plannedDate) {
    query.plannedFrom = filters.plannedDate;
    query.plannedTo = addDays(filters.plannedDate, 1);
  }
  return query;
}

/** Every task, with search and filters, the unscheduled list, and the archive. */
export function TasksPage({ categories, backendReady, dataVersion = 0, onDataChanged }: TasksPageProps) {
  const [filters, setFilters] = useState(NO_FILTERS);
  // The search runs shortly after typing stops rather than on every keystroke.
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [changes, setChanges] = useState(0);
  const [editor, setEditor] = useState<TaskEditorTarget | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchText(filters.text);
      setPage(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [filters.text]);

  const changed = () => {
    setChanges((count) => count + 1);
    onDataChanged?.();
  };
  const actions = useTaskActions(changed);

  const query = toQuery(filters, searchText, page);
  const list = useLoadable(JSON.stringify(query), changes + dataVersion, backendReady, () => tasksApi.list(query));

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    if (key !== 'text') {
      setPage(0);
    }
  };

  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const controlsDisabled = !backendReady || actions.busyId !== null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Tasks</h1>
        <div className={styles.headerActions}>
          <Button onClick={() => setManagingCategories(true)}>Categories</Button>
          <Button variant="primary" onClick={() => setEditor({ kind: 'create', plannedDate: null })}>
            + New task
          </Button>
        </div>
      </header>

      <div className={styles.filters} role="search" aria-label="Filter tasks">
        <div className={`${form.field} ${styles.search}`}>
          <label className={form.label} htmlFor="tasks-search">
            Search
          </label>
          <input
            id="tasks-search"
            type="search"
            className={form.control}
            value={filters.text}
            maxLength={200}
            placeholder="Title or description"
            onChange={(event) => setFilter('text', event.target.value)}
          />
        </div>
        <div className={form.field}>
          <label className={form.label} htmlFor="tasks-scope">
            Show
          </label>
          <select
            id="tasks-scope"
            className={form.control}
            value={filters.scope}
            onChange={(event) => setFilter('scope', event.target.value as Scope)}
          >
            <option value="active">All tasks</option>
            <option value="unscheduled">Unscheduled</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className={form.field}>
          <label className={form.label} htmlFor="tasks-status">
            Status
          </label>
          <select
            id="tasks-status"
            className={form.control}
            value={filters.status}
            onChange={(event) => setFilter('status', event.target.value as TaskStatus | '')}
          >
            <option value="">Any status</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div className={form.field}>
          <label className={form.label} htmlFor="tasks-priority">
            Priority
          </label>
          <select
            id="tasks-priority"
            className={form.control}
            value={filters.priority}
            onChange={(event) => setFilter('priority', event.target.value as TaskPriority | '')}
          >
            <option value="">Any priority</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_NAMES[priority]}
              </option>
            ))}
          </select>
        </div>
        <div className={form.field}>
          <label className={form.label} htmlFor="tasks-category">
            Category
          </label>
          <select
            id="tasks-category"
            className={form.control}
            value={filters.categoryId}
            onChange={(event) => setFilter('categoryId', event.target.value)}
          >
            <option value="">Any category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryName(category)}
              </option>
            ))}
          </select>
        </div>
        <div className={form.field}>
          <label className={form.label} htmlFor="tasks-planned">
            Planned on
          </label>
          <input
            id="tasks-planned"
            type="date"
            className={form.control}
            value={filters.plannedDate}
            disabled={filters.scope === 'unscheduled'}
            onChange={(event) => setFilter('plannedDate', event.target.value)}
          />
        </div>
        {filtered && (
          <Button
            onClick={() => {
              setFilters(NO_FILTERS);
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {actions.error && (
        <p className={form.error} role="alert">
          {actions.error}
        </p>
      )}

      <section className={styles.results} aria-label="Task list">
        {list.status === 'loading' && <LoadingState label="Loading tasks…" />}
        {list.status === 'error' && <ErrorState message={`Tasks could not be loaded: ${list.message}`} />}
        {list.status === 'loaded' &&
          list.data.items.length === 0 &&
          (filtered ? (
            <EmptyState title="No tasks match these filters" />
          ) : (
            <EmptyState title="No tasks yet">
              Add one here, or pick a day in the calendar and add it there.
            </EmptyState>
          ))}
        {list.status === 'loaded' && list.data.items.length > 0 && (
          <>
            <ul className={styles.list} aria-label="Tasks">
              {list.data.items.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  categories={categories}
                  disabled={controlsDisabled}
                  showPlannedDate
                  onToggleDone={(target) => void actions.toggleDone(target)}
                  onOpen={(target) => setEditor({ kind: 'edit', task: target })}
                  action={
                    task.archivedAt ? (
                      <Button disabled={controlsDisabled} onClick={() => void actions.setArchived(task, false)}>
                        Restore
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </ul>
            <footer className={styles.pager}>
              <span>
                {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + list.data.items.length} of {list.data.total}
              </span>
              <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button disabled={(page + 1) * PAGE_SIZE >= list.data.total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </footer>
          </>
        )}
      </section>

      {editor && (
        <TaskDialog
          target={editor}
          categories={categories}
          backendReady={backendReady}
          onClose={() => setEditor(null)}
          onSaved={changed}
        />
      )}
      {managingCategories && (
        <CategoryDialog
          categories={categories}
          backendReady={backendReady}
          onClose={() => setManagingCategories(false)}
          onChanged={changed}
        />
      )}
    </div>
  );
}
