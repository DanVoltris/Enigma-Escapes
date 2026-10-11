-- Undo migrations/0015_signup.sql on one venue: removes the sign-up functions.
-- Businesses already created through them stay exactly as they are.
do $block$
begin
  drop function if exists public.create_tenant(text, text, text, text, text, text, jsonb, text);
  drop function if exists public.slug_available(text);
  delete from schema_migrations where version = '0015';
end
$block$;
notify pgrst, 'reload schema';
