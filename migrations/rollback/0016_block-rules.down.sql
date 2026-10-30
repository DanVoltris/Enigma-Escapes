-- Drops repeating blocks. Every session they held goes back on sale; one-off
-- blocks in slot_blocks are untouched.
drop table if exists public.slot_block_rules;
delete from schema_migrations where version = '0016';
notify pgrst, 'reload schema';
