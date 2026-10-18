-- PostgreSQL limits counted regex repetitions to 255. Bound the length
-- separately so Gmail identifiers up to 512 characters remain valid.
alter table public.draft_generations
  drop constraint draft_generations_thread_id_check,
  drop constraint draft_generations_target_message_id_check,
  drop constraint draft_generations_draft_id_check,
  drop constraint draft_generations_draft_message_id_check,
  add constraint draft_generations_thread_id_check check (char_length(thread_id) between 1 and 512 and thread_id ~ '^[A-Za-z0-9_-]+$'),
  add constraint draft_generations_target_message_id_check check (char_length(target_message_id) between 1 and 512 and target_message_id ~ '^[A-Za-z0-9_-]+$'),
  add constraint draft_generations_draft_id_check check (char_length(draft_id) between 1 and 512 and draft_id ~ '^[A-Za-z0-9_-]+$'),
  add constraint draft_generations_draft_message_id_check check (char_length(draft_message_id) between 1 and 512 and draft_message_id ~ '^[A-Za-z0-9_-]+$');
