-- Message identity is independent of service workflow and subject similarity.
CREATE TABLE thread_message_identities (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
 message_id_header text NOT NULL CHECK(length(message_id_header) BETWEEN 1 AND 998),
 thread_id uuid NOT NULL REFERENCES threads(id),
 observed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,mailbox_id,message_id_header)
);
CREATE INDEX thread_message_identities_thread ON thread_message_identities(thread_id);
CREATE FUNCTION enforce_thread_identity_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM threads t WHERE t.id=NEW.thread_id AND t.tenant_id=NEW.tenant_id AND t.mailbox_id=NEW.mailbox_id) THEN RAISE EXCEPTION 'identity scope mismatch'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER thread_identity_scope BEFORE INSERT OR UPDATE ON thread_message_identities FOR EACH ROW EXECUTE FUNCTION enforce_thread_identity_scope();
ALTER TABLE outbox ADD COLUMN source_thread_id uuid REFERENCES threads(id);
CREATE FUNCTION enforce_outbox_source_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.source_thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM threads t WHERE t.id=NEW.source_thread_id AND t.tenant_id=NEW.tenant_id AND t.mailbox_id=NEW.mailbox_id) THEN RAISE EXCEPTION 'source scope mismatch'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER outbox_source_scope BEFORE INSERT OR UPDATE ON outbox FOR EACH ROW EXECUTE FUNCTION enforce_outbox_source_scope();
