import { describe, it, expect } from 'vitest';
const randomUUID = () => '4a8ce8c7-ae08-4091-8997-64681f8a1f44';
import {
  participationSeconds,
  defaultMeetConfig,
  editableMeetConfig,
  meetPreferencesSchema,
  meetJobSchema,
  meetReportQuerySchema,
  meetResourceSchema,
} from './google-meet.js';
describe('Google Meet reporting contracts', () => {
  it('reads provider defaults without crashing the room settings', () => {
    expect(
      editableMeetConfig({
        accessType: 'TRUSTED',
        moderation: 'MODERATION_UNSPECIFIED',
        artifactConfig: {
          recordingConfig: { autoRecordingGeneration: 'AUTO_GENERATION_TYPE_UNSPECIFIED' },
          transcriptionConfig: { autoTranscriptionGeneration: 'ON' },
        },
      }),
    ).toEqual({
      accessType: 'TRUSTED',
      artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: 'ON' } },
    });
  });
  it('unions simultaneous sessions, reconnections and unfinished sessions at conference end', () => {
    const start = '2026-10-15T12:00:00Z';
    expect(
      participationSeconds(
        [
          { start, end: '2026-10-15T12:20:00Z' },
          { start: '2026-10-15T12:10:00Z', end: '2026-10-15T12:30:00Z' },
          { start: '2026-10-15T12:40:00Z', end: null },
        ],
        '2026-10-15T13:00:00Z',
      ),
    ).toBe(3000);
    expect(participationSeconds([{ start, end: null }])).toBe(0);
    expect(
      participationSeconds([
        { start, end: 'invalid' },
        { start, end: '2026-10-15T11:00:00Z' },
      ]),
    ).toBe(0);
  });
  it('does not enable recording, transcription or notes without explicit preference', () => {
    const prefs = meetPreferencesSchema.parse({});
    expect(defaultMeetConfig(prefs)).toEqual({ accessType: 'TRUSTED' });
    expect(defaultMeetConfig({ ...prefs, auto_transcription: true })).toEqual({
      accessType: 'TRUSTED',
      artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: 'ON' } },
    });
    expect(meetPreferencesSchema.safeParse({ sync_enabled: true }).success).toBe(false);
    expect(meetPreferencesSchema.safeParse({ retention_days: 0 }).success).toBe(false);
  });
  it('rejects unsafe resources, incomplete jobs and unbounded reporting periods', () => {
    expect(meetResourceSchema.safeParse('spaces/a/../../token').success).toBe(false);
    const job = {
      kind: 'entries',
      connection_id: randomUUID(),
      space_id: randomUUID(),
      resource: 'conferenceRecords/a/transcripts/b',
      generation: randomUUID(),
    };
    expect(meetJobSchema.safeParse(job).success).toBe(false);
    expect(
      meetJobSchema.safeParse({ ...job, record_id: randomUUID(), artifact_id: randomUUID() })
        .success,
    ).toBe(true);
    expect(meetReportQuerySchema.safeParse({ from: '2025-01-01', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(meetReportQuerySchema.safeParse({ sort: 'title;drop table' }).success).toBe(false);
    expect(meetReportQuerySchema.parse({ pageSize: '20' }).pageSize).toBe(20);
  });
});
