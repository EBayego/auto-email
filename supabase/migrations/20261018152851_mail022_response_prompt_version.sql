alter table public.draft_generations
  drop constraint draft_generations_prompt_version_check,
  add constraint draft_generations_prompt_version_check check (prompt_version in ('mail020-v1', 'mail020-v2'));
