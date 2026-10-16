-- Reuse the existing tenant storage projection, including imported text.
ALTER TABLE google_meet_records ADD COLUMN tenant_id uuid;
UPDATE google_meet_records r SET tenant_id=s.tenant_id FROM google_meet_spaces s WHERE s.id=r.space_id;
ALTER TABLE google_meet_participants ADD COLUMN tenant_id uuid;
UPDATE google_meet_participants p SET tenant_id=r.tenant_id FROM google_meet_records r WHERE r.id=p.record_id;
ALTER TABLE google_meet_sessions ADD COLUMN tenant_id uuid;
UPDATE google_meet_sessions s SET tenant_id=p.tenant_id FROM google_meet_participants p WHERE p.id=s.participant_id;
ALTER TABLE google_meet_artifacts ADD COLUMN tenant_id uuid;
UPDATE google_meet_artifacts a SET tenant_id=r.tenant_id FROM google_meet_records r WHERE r.id=a.record_id;
ALTER TABLE google_meet_transcript_entries ADD COLUMN tenant_id uuid;
UPDATE google_meet_transcript_entries e SET tenant_id=a.tenant_id FROM google_meet_artifacts a WHERE a.id=e.artifact_id;

ALTER TABLE google_meet_spaces ADD UNIQUE(id,tenant_id);
ALTER TABLE google_meet_records ALTER COLUMN tenant_id SET NOT NULL, ADD UNIQUE(id,tenant_id), ADD FOREIGN KEY(space_id,tenant_id) REFERENCES google_meet_spaces(id,tenant_id) ON DELETE CASCADE;
ALTER TABLE google_meet_participants ALTER COLUMN tenant_id SET NOT NULL, ADD UNIQUE(id,tenant_id), ADD FOREIGN KEY(record_id,tenant_id) REFERENCES google_meet_records(id,tenant_id) ON DELETE CASCADE;
ALTER TABLE google_meet_sessions ALTER COLUMN tenant_id SET NOT NULL, ADD FOREIGN KEY(participant_id,tenant_id) REFERENCES google_meet_participants(id,tenant_id) ON DELETE CASCADE;
ALTER TABLE google_meet_artifacts ALTER COLUMN tenant_id SET NOT NULL, ADD UNIQUE(id,tenant_id), ADD FOREIGN KEY(record_id,tenant_id) REFERENCES google_meet_records(id,tenant_id) ON DELETE CASCADE;
ALTER TABLE google_meet_transcript_entries ALTER COLUMN tenant_id SET NOT NULL, ADD FOREIGN KEY(artifact_id,tenant_id) REFERENCES google_meet_artifacts(id,tenant_id) ON DELETE CASCADE;

DO $$ DECLARE relation text; keys text; BEGIN
 FOREACH relation IN ARRAY ARRAY['google_meet_preferences','google_meet_spaces','google_meet_records','google_meet_participants','google_meet_sessions','google_meet_artifacts','google_meet_transcript_entries'] LOOP
  keys := CASE WHEN relation='google_meet_preferences' THEN 'tenant_id,user_id' ELSE 'id' END;
  INSERT INTO storage_logical_catalog VALUES(relation,'metadata','tenant_id',ARRAY['updated_at','last_sync_at','next_sync_at','sync_status','sync_error','sync_error_code','artifact_status','capabilities','last_check_at','entries_status','entries_error','sessions_synced_at']);
  -- Initial projection bypasses quota enforcement for already-existing rows.
  EXECUTE format('INSERT INTO storage_logical_payloads SELECT %L,(SELECT jsonb_object_agg(k,to_jsonb(r)->k)::text FROM unnest(string_to_array(%L,'','')) k),r.tenant_id,NULL,''metadata'',0,octet_length((to_jsonb(r)-c.excluded_columns)::text),false FROM %I r JOIN storage_logical_catalog c ON c.relation_name=%L',relation,keys,relation,relation);
  EXECUTE format('CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION storage_track_payload(%L,''metadata'',''tenant_id'',''updated_at,last_sync_at,next_sync_at,sync_status,sync_error,sync_error_code,artifact_status,capabilities,last_check_at,entries_status,entries_error,sessions_synced_at'')',relation,keys);
 END LOOP;
END $$;
