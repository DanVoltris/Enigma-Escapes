-- Who took a slot out of service. Run once in the Supabase SQL editor.
-- Safe to run twice.
alter table slot_blocks add column if not exists blocked_by text;

-- Existing blocks keep an empty name — nothing recorded who made them, and
-- guessing would be worse than saying so. The reason is required from now on,
-- but the sixteen already on the books without one stay as they are.
