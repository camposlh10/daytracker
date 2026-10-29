-- Appointments that repeat on chosen days of the week.
--
-- repeat_rule gains 'WEEKLY': on the days listed in repeat_weekdays (ISO numbers,
-- 1 = Monday to 7 = Sunday, comma-separated in order), from the first date until
-- repeat_until, or without end when that is NULL.
--
-- SQLite cannot change a CHECK constraint in place, so the table is rebuilt with
-- the wider list and its rows copied over, as for book covers in V003.

CREATE TABLE calendar_events_new (
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
    repeat_rule        TEXT CHECK (repeat_rule IS NULL OR repeat_rule IN ('DAILY', 'WEEKLY', 'DATES')),
    repeat_until       TEXT,
    repeat_dates       TEXT CHECK (repeat_dates IS NULL OR length(repeat_dates) <= 4100),
    links              TEXT CHECK (links IS NULL OR length(links) <= 20100),
    repeat_weekdays    TEXT CHECK (repeat_weekdays IS NULL OR length(repeat_weekdays) <= 13),
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

INSERT INTO calendar_events_new (id, title, notes, category_id, all_day, starts_at, ends_at, timezone, start_date,
    end_date_exclusive, created_at, updated_at, version, repeat_rule, repeat_until, repeat_dates, links)
SELECT id, title, notes, category_id, all_day, starts_at, ends_at, timezone, start_date,
    end_date_exclusive, created_at, updated_at, version, repeat_rule, repeat_until, repeat_dates, links
FROM calendar_events;

DROP TABLE calendar_events;

ALTER TABLE calendar_events_new RENAME TO calendar_events;

CREATE INDEX idx_calendar_events_timed ON calendar_events (starts_at, ends_at);
CREATE INDEX idx_calendar_events_all_day ON calendar_events (start_date, end_date_exclusive);
CREATE INDEX idx_calendar_events_category_id ON calendar_events (category_id);
CREATE INDEX idx_calendar_events_repeating ON calendar_events (repeat_until) WHERE repeat_rule IS NOT NULL;
