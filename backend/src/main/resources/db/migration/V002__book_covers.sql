-- Book cover images, stored in the database so that backups and restores keep
-- them together with the books. One cover per book; replacing it overwrites
-- the row. Covers are optional: a book without one shows a typographic placeholder.

CREATE TABLE book_covers (
    book_id      TEXT PRIMARY KEY NOT NULL REFERENCES books (id) ON DELETE RESTRICT,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    data         BLOB NOT NULL CHECK (length(data) BETWEEN 1 AND 2097152),
    source       TEXT NOT NULL CHECK (source IN ('OPEN_LIBRARY', 'FILE')),
    source_id    TEXT,
    sha256       TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
