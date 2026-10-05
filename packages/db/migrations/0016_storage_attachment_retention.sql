-- Attachment metadata follows the message's retention state, while remaining part of total usage.
create function storage_attachment_retention() returns trigger language plpgsql as $$
begin
 if TG_TABLE_NAME='messages' then
  update storage_logical_payloads p set retained=(new.deleted_at is not null)
   from attachments a where a.message_id=new.id and p.relation_name='attachments' and p.row_key=jsonb_build_object('id',a.id)::text;
 else
  update storage_logical_payloads p set retained=exists(select 1 from messages m where m.id=new.message_id and m.deleted_at is not null)
   where p.relation_name='attachments' and p.row_key=jsonb_build_object('id',new.id)::text;
 end if;
 return new;
end $$;
create trigger zz_storage_attachment_retention after insert or update on attachments for each row execute function storage_attachment_retention();
create trigger zz_storage_message_retention after update of deleted_at on messages for each row execute function storage_attachment_retention();
update storage_logical_payloads p set retained=true from attachments a join messages m on m.id=a.message_id
 where m.deleted_at is not null and p.relation_name='attachments' and p.row_key=jsonb_build_object('id',a.id)::text;
