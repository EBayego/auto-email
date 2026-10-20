alter table public.draft_generations drop constraint draft_generations_prompt_version_check;
alter table public.draft_generations add constraint draft_generations_prompt_version_check
  check (prompt_version in ('mail020-v1', 'mail020-v2', 'mail027-v1', 'mail028-v1', 'mail028-v2'));

alter table public.style_preferences drop constraint style_preferences_value_check;
alter table public.style_preferences add constraint style_preferences_value_check check (
  case preference_key
    when 'greeting' then preference_value in ('short','none','natural')
    when 'language' then preference_value in ('recipient','es','en','fr','de','it','pt','ca')
    when 'length' then preference_value in ('short','medium','long')
    when 'formality' then preference_value in ('informal','neutral','formal')
    when 'closing' then preference_value in ('short','none','natural')
    when 'emojis' then preference_value in ('never','allowed')
    when 'warmth' then preference_value in ('reserved','neutral','warm')
    when 'help_offer' then preference_value in ('none','natural')
    else false
  end
);
