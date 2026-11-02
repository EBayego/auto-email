-- Explicit synthetic authorization for pre-MAIL-061 regression fixtures only.
with notice as (select '{"version":"mail061-v1","identity":{"operator":"Synthetic local SQL fixture"},"purpose":"Authorized mailbox fixture for database regression tests"}'::text as body)
insert into public.privacy_authorizations(user_id,notice_version,notice_hash,notice_text)
select u.id,'mail061-v1',encode(extensions.digest(notice.body,'sha256'),'hex'),notice.body
from public.users u cross join notice where u.status='ACTIVE'
on conflict(user_id) do nothing;
