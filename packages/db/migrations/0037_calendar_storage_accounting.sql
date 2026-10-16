-- Keep the existing logical storage projection aware of productivity data.
INSERT INTO storage_logical_catalog VALUES
 ('calendars','metadata','tenant_id','{}'),
 ('calendar_events','metadata','tenant_id',ARRAY['updated_at','reminder_cursor']),
 ('reminders','metadata','tenant_id',ARRAY['updated_at','status','notification_id']);
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON calendars FOR EACH ROW
 EXECUTE FUNCTION storage_track_payload('id','metadata','tenant_id','');
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON calendar_events FOR EACH ROW
 EXECUTE FUNCTION storage_track_payload('id','metadata','tenant_id','updated_at,reminder_cursor');
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON reminders FOR EACH ROW
 EXECUTE FUNCTION storage_track_payload('id','metadata','tenant_id','updated_at,status,notification_id');
-- Backfill is safe when this migration follows live creation in a rolling rollout.
UPDATE calendars SET name=name;
UPDATE calendar_events SET title=title;
UPDATE reminders SET title=title;
