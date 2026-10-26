-- Day Tracker initial schema.
-- Immutable once released: change the schema with a new V00N__ script instead.
-- Ids are UUID text, system times are UTC ISO-8601 text, calendar dates are YYYY-MM-DD text.
-- The schema_migrations ledger is created by the migration runner itself.

CREATE TABLE categories (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    normalized_name TEXT NOT NULL UNIQUE,
    color           TEXT NOT NULL,
    archived_at     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE tasks (
    id            TEXT PRIMARY KEY NOT NULL,
    title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    description   TEXT CHECK (description IS NULL OR length(description) <= 5000),
    category_id   TEXT REFERENCES categories (id) ON DELETE RESTRICT,
    priority      TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
    status        TEXT NOT NULL CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DONE')),
    planned_date  TEXT,
    deadline_date TEXT,
    completed_at  TEXT,
    archived_at   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    CHECK ((status = 'DONE') = (completed_at IS NOT NULL))
);

CREATE INDEX idx_tasks_planned_date ON tasks (planned_date);
CREATE INDEX idx_tasks_completed_at ON tasks (completed_at);
CREATE INDEX idx_tasks_category_id ON tasks (category_id);

CREATE TABLE task_activity (
    id                    TEXT PRIMARY KEY NOT NULL,
    task_id               TEXT NOT NULL REFERENCES tasks (id) ON DELETE RESTRICT,
    action                TEXT NOT NULL,
    previous_status       TEXT CHECK (previous_status IS NULL OR previous_status IN ('PENDING', 'IN_PROGRESS', 'DONE')),
    new_status            TEXT CHECK (new_status IS NULL OR new_status IN ('PENDING', 'IN_PROGRESS', 'DONE')),
    previous_planned_date TEXT,
    new_planned_date      TEXT,
    occurred_at           TEXT NOT NULL
);

CREATE INDEX idx_task_activity_task_id ON task_activity (task_id, occurred_at);

CREATE TABLE books (
    id           TEXT PRIMARY KEY NOT NULL,
    title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    author       TEXT,
    total_pages  INTEGER NOT NULL CHECK (total_pages > 0),
    initial_page INTEGER NOT NULL DEFAULT 0 CHECK (initial_page BETWEEN 0 AND total_pages),
    status       TEXT NOT NULL CHECK (status IN ('TO_READ', 'READING', 'FINISHED', 'ABANDONED')),
    archived_at  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE reading_sessions (
    id            TEXT PRIMARY KEY NOT NULL,
    book_id       TEXT NOT NULL REFERENCES books (id) ON DELETE RESTRICT,
    activity_date TEXT NOT NULL,
    pages_read    INTEGER NOT NULL CHECK (pages_read > 0),
    ending_page   INTEGER CHECK (ending_page IS NULL OR ending_page >= 0),
    notes         TEXT CHECK (notes IS NULL OR length(notes) <= 5000),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT,
    version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE INDEX idx_reading_sessions_activity_date ON reading_sessions (activity_date);
CREATE INDEX idx_reading_sessions_book_id ON reading_sessions (book_id, activity_date);

CREATE TABLE reading_goals (
    effective_date TEXT PRIMARY KEY NOT NULL,
    target_pages   INTEGER NOT NULL CHECK (target_pages > 0),
    updated_at     TEXT NOT NULL
);

CREATE TABLE calendar_events (
    id                 TEXT PRIMARY KEY NOT NULL,
    title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    notes              TEXT CHECK (notes IS NULL OR length(notes) <= 5000),
    category_id        TEXT REFERENCES categories (id) ON DELETE RESTRICT,
    all_day            INTEGER NOT NULL CHECK (all_day IN (0, 1)),
    starts_at          TEXT,
    ends_at            TEXT,
    timezone           TEXT,
    start_date         TEXT,
    end_date_exclusive TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    CHECK (
        (all_day = 1
            AND start_date IS NOT NULL AND end_date_exclusive IS NOT NULL
            AND end_date_exclusive > start_date
            AND starts_at IS NULL AND ends_at IS NULL AND timezone IS NULL)
        OR
        (all_day = 0
            AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND timezone IS NOT NULL
            AND ends_at > starts_at
            AND start_date IS NULL AND end_date_exclusive IS NULL)
    )
);

CREATE INDEX idx_calendar_events_timed ON calendar_events (starts_at, ends_at);
CREATE INDEX idx_calendar_events_all_day ON calendar_events (start_date, end_date_exclusive);
CREATE INDEX idx_calendar_events_category_id ON calendar_events (category_id);

CREATE TABLE daily_reviews (
    id                TEXT PRIMARY KEY NOT NULL,
    review_date       TEXT NOT NULL UNIQUE,
    wins              TEXT NOT NULL DEFAULT '' CHECK (length(wins) <= 5000),
    obstacles         TEXT NOT NULL DEFAULT '' CHECK (length(obstacles) <= 5000),
    tomorrow_priority TEXT NOT NULL DEFAULT '' CHECK (length(tomorrow_priority) <= 5000),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
