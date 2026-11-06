alter table integration_api_tokens add column permissions text[] not null default '{}';
update integration_api_tokens set permissions=array[permission];
alter table integration_api_tokens drop column permission;
