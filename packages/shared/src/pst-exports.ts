export type PstExportFile = { id: string; filename: string; size_bytes: string };
export type PstExportTask = {
  id: string;
  filename: string;
  state: 'queued' | 'staging' | 'converting' | 'ready' | 'failed' | 'cancelled' | 'expired';
  total_messages: number;
  prepared: number;
  converted: number;
  warnings: number;
  last_error: string | null;
  created_at: string;
  expires_at: string;
  files: PstExportFile[];
};
