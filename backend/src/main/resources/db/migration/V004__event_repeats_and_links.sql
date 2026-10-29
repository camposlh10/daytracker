-- Appointments that repeat, and links attached to an appointment.
--
-- repeat_rule:  NULL (once), 'DAILY' (every day from the first date), or 'DATES'
--               (on each date listed in repeat_dates).
-- repeat_until: the last date a repeating appointment may start on; NULL repeats
--               every day without end. For 'DATES' it is the last listed date.
-- repeat_dates: 'DATES' only, comma-separated YYYY-MM-DD in order, the first being
--               the appointment's own first date.
-- links:        web addresses, one per line.

ALTER TABLE calendar_events ADD COLUMN repeat_rule TEXT CHECK (repeat_rule IS NULL OR repeat_rule IN ('DAILY', 'DATES'));

ALTER TABLE calendar_events ADD COLUMN repeat_until TEXT;

ALTER TABLE calendar_events ADD COLUMN repeat_dates TEXT CHECK (repeat_dates IS NULL OR length(repeat_dates) <= 4100);

ALTER TABLE calendar_events ADD COLUMN links TEXT CHECK (links IS NULL OR length(links) <= 20100);

CREATE INDEX idx_calendar_events_repeating ON calendar_events (repeat_until) WHERE repeat_rule IS NOT NULL;
