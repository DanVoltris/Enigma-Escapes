-- One column for the new request flow: when the "still want it?" nudge was
-- sent, so the sweep never sends it twice. Without it the code deliberately
-- sends no reminders at all (it stamps before texting), and the 30-minute
-- release still works — so this is safe to run before or after the deploy.
alter table booking_requests
  add column if not exists reminded_at timestamptz;
