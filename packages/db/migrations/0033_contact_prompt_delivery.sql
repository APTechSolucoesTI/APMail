-- Previously sent mail must never trigger a retroactive prompt.
ALTER TABLE outbox ADD COLUMN contact_prompt_handled boolean NOT NULL DEFAULT true;
CREATE INDEX outbox_contact_prompt_pending ON outbox(tenant_id,created_by,sent_at,id)
 WHERE status='sent' AND NOT contact_prompt_handled AND mdn_original_message_id IS NULL;
-- Refresh additions without charging a new body or rejecting pre-existing quotas.
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['outbox','messages'] LOOP
  EXECUTE format('UPDATE storage_logical_payloads p SET metadata_bytes=octet_length((to_jsonb(r)-c.excluded_columns)::text)::bigint FROM %I r,storage_logical_catalog c WHERE c.relation_name=%L AND p.relation_name=c.relation_name AND p.row_key=jsonb_build_object(''id'',r.id)::text',relation,relation);
 END LOOP;
END $$;
