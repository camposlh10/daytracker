-- Allows covers from Google Books. SQLite cannot change a CHECK constraint in
-- place, so the table is rebuilt with the wider list and its rows copied over.

CREATE TABLE book_covers_new (
    book_id      TEXT PRIMARY KEY NOT NULL REFERENCES books (id) ON DELETE RESTRICT,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    data         BLOB NOT NULL CHECK (length(data) BETWEEN 1 AND 2097152),
    source       TEXT NOT NULL CHECK (source IN ('OPEN_LIBRARY', 'GOOGLE_BOOKS', 'FILE')),
    source_id    TEXT,
    sha256       TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

INSERT INTO book_covers_new (book_id, content_type, data, source, source_id, sha256, updated_at)
SELECT book_id, content_type, data, source, source_id, sha256, updated_at FROM book_covers;

DROP TABLE book_covers;

ALTER TABLE book_covers_new RENAME TO book_covers;
