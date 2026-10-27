-- Email tasks reuse reminders, including notification leases and recurrence deduplication.
ALTER TABLE reminders ADD COLUMN thread_id uuid;
ALTER TABLE reminders ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE threads ADD CONSTRAINT threads_task_tenant_key UNIQUE(id,tenant_id);
ALTER TABLE reminders ADD CONSTRAINT reminder_thread_tenant_fk
 FOREIGN KEY(thread_id,tenant_id) REFERENCES threads(id,tenant_id) ON DELETE CASCADE;
ALTER TABLE reminders ADD CONSTRAINT reminder_email_not_event CHECK(thread_id IS NULL OR event_id IS NULL);
CREATE INDEX reminder_thread_tasks ON reminders(tenant_id,thread_id,status) WHERE thread_id IS NOT NULL;

-- Both sides lock the same thread row: a competing completion and task creation
-- cannot commit a done thread with pending work. Applies to workers and bulk actions too.
CREATE FUNCTION guard_email_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status queue_status;
BEGIN
 IF NEW.thread_id IS NOT NULL AND NEW.status IN ('pending','notified') THEN
  SELECT queue_status INTO current_status FROM threads
   WHERE id=NEW.thread_id AND tenant_id=NEW.tenant_id FOR UPDATE;
  IF current_status='done' THEN
   RAISE EXCEPTION 'Reabra a conversa antes de adicionar uma tarefa pendente.' USING ERRCODE='23514', CONSTRAINT='email_tasks_thread_pending';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reminder_email_task_guard BEFORE INSERT OR UPDATE OF thread_id,status ON reminders
 FOR EACH ROW EXECUTE FUNCTION guard_email_task();

CREATE FUNCTION guard_thread_task_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.queue_status='done' AND EXISTS(SELECT 1 FROM reminders
  WHERE tenant_id=NEW.tenant_id AND thread_id=NEW.id AND status IN ('pending','notified')) THEN
  RAISE EXCEPTION 'Conclua ou dispense as tarefas pendentes antes de concluir a conversa.' USING ERRCODE='23514', CONSTRAINT='email_tasks_thread_pending';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER thread_email_task_guard BEFORE UPDATE OF queue_status ON threads
 FOR EACH ROW EXECUTE FUNCTION guard_thread_task_completion();
