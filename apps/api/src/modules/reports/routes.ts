import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { meetReportQuerySchema, type MeetReportRow } from '@apmail/shared';
import type { Resources } from '../resources.js';
import { requireTenant, conflict, notFound } from '../../authz/context.js';
import { meetReportData, meetDetail, transcriptRows } from './meet-data.js';
import { reportCsv, reportPdf, reportHtml, type ReportDocument } from './export.js';
const idOf = (value: unknown) =>
  z
    .object({
      id: z.union([
        z.uuid(),
        z
          .string()
          .max(250)
          .refine((id) => {
            const match = id.match(/^event_([^_]+)_(.+)$/);
            return !!match && z.uuid().safeParse(match[1]).success;
          }),
      ]),
    })
    .parse(value).id;
const duration = (seconds: number | null) =>
  seconds === null
    ? 'Não disponível'
    : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min ${seconds % 60}s`;
const status: Record<MeetReportRow['status'], string> = {
  completed: 'Concluída (Google)',
  ongoing: 'Em andamento (Google)',
  scheduled: 'Agendada',
  unverified: 'Sem registro de realização',
  cancelled: 'Cancelada',
};
export async function registerReports(app: FastifyInstance, r: Resources) {
  app.get('/api/reports', async (req) => {
    requireTenant(req.ctx);
    return [
      {
        id: 'meet',
        name: 'Google Meet',
        description: 'Agendamentos, conferências, participação e arquivos autorizados.',
        href: '/reports/meet',
      },
    ];
  });
  app.get('/api/reports/meet', async (req) => {
    const result = await meetReportData(r, req.ctx, meetReportQuerySchema.parse(req.query));
    return {
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      summary: result.summary,
      coverage: result.coverage,
      chart: result.chart,
      accounts: result.accounts,
      organizers: result.organizers,
    };
  });
  app.get(
    '/api/reports/meet/export',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const query = meetReportQuerySchema.parse(req.query),
        { format, report } = z
          .object({
            format: z.enum(['pdf', 'csv', 'html']).default('pdf'),
            report: z.enum(['meetings', 'duration', 'artifacts']).default('meetings'),
          })
          .parse(req.query);
      const data = await meetReportData(r, req.ctx, query),
        rows =
          report === 'artifacts'
            ? data.all.filter((row) => (row.recordings ?? 0) + (row.transcripts ?? 0) > 0)
            : data.all;
      const date = (value: string) =>
        new Intl.DateTimeFormat('pt-BR', {
          timeZone: query.timezone,
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(new Date(value));
      const document: ReportDocument = {
        title:
          report === 'duration'
            ? 'Duração das reuniões'
            : report === 'artifacts'
              ? 'Reuniões com gravação ou transcrição'
              : 'Reuniões Google Meet',
        context: `Período: ${query.from.split('-').reverse().join('/')} a ${query.to.split('-').reverse().join('/')} · Fuso: ${query.timezone} · Situação: ${query.status === 'all' ? 'Todas' : status[query.status]} · Busca: ${query.search || 'Todas'} · Conta: ${query.account || 'Todas'} · Organizador: ${query.organizer || 'Todos'}`,
        columns: [
          'Reunião',
          'Data / conta',
          'Situação',
          'Duração real',
          'Participações',
          'Arquivos',
        ],
        landscape: true,
        rows: rows.map((row) => [
          row.title,
          date(row.date) + '\n' + (row.account_email ?? 'Conta não associada'),
          status[row.status],
          duration(row.duration_seconds),
          row.participant_count === null ? 'Não disponível' : String(row.participant_count),
          `Gravações: ${row.recordings ?? '—'}\nTranscrições: ${row.transcripts ?? '—'}\nNotas: ${row.smart_notes ?? '—'}`,
        ]),
        notes: [
          'Durações e participações provêm exclusivamente dos registros importados do Google. Agendamento não comprova realização.',
          'A ausência de arquivo importado não comprova que a reunião não foi gravada ou transcrita. Este relatório não classifica produtividade ou desempenho individual.',
        ],
      };
      reply.header('Cache-Control', 'private, no-store');
      if (format === 'html')
        return reply
          .type('text/html; charset=utf-8')
          .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
          .send(reportHtml(document));
      reply.header(
        'Content-Disposition',
        `attachment; filename="apmail-reunioes-${query.from}.${format}"`,
      );
      return format === 'csv'
        ? reply.type('text/csv; charset=utf-8').send(reportCsv(document))
        : reply.type('application/pdf').send(await reportPdf(document));
    },
  );
  app.get('/api/reports/meet/:id', async (req) => {
    const result = await meetDetail(r, req.ctx, idOf(req.params));
    return result;
  });
  app.get('/api/reports/meet/:id/transcript', async (req) => {
    const detail = await meetDetail(r, req.ctx, idOf(req.params));
    if (!detail.record) return { items: [], total: 0, page: 1, pageSize: 100 };
    const { search, page } = z
      .object({
        search: z.string().max(200).default(''),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(req.query);
    const items = await transcriptRows(r, detail.record.id, search, 101, (page - 1) * 100);
    return { items: items.slice(0, 100), hasMore: items.length > 100, page, pageSize: 100 };
  });
  app.get(
    '/api/reports/meet/:id/export',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const detail = await meetDetail(r, req.ctx, idOf(req.params)),
        { format, report } = z
          .object({
            format: z.enum(['pdf', 'csv', 'html', 'txt', 'vtt']).default('pdf'),
            report: z.enum(['meeting', 'participants', 'transcript']).default('meeting'),
          })
          .parse(req.query);
      const date = (value: string | Date | null | undefined) =>
        value
          ? new Date(value).toLocaleString('pt-BR', {
              timeZone: detail.event?.timezone ?? 'America/Sao_Paulo',
            })
          : 'Não disponível';
      const document: ReportDocument = {
        title:
          report === 'participants'
            ? 'Participação na reunião'
            : report === 'transcript'
              ? 'Transcrição da reunião'
              : 'Relatório de reunião',
        context: `${detail.record?.title ?? detail.event?.title} · ${detail.record?.account_email ?? 'Evento APMail'} · Início: ${date(detail.record?.starts_at ?? detail.event?.starts_at)}`,
        columns: ['Informação', 'Valor'],
        rows: [],
        notes: detail.limitations,
      };
      if (report === 'participants') {
        document.columns = [
          'Participante',
          'Primeira entrada',
          'Última saída',
          'Sessões',
          'Tempo de participação',
        ];
        document.landscape = true;
        document.rows = detail.participants.map((p) => [
          p.display_name || 'Sem nome informado',
          date(p.first_join_at),
          date(p.last_leave_at),
          String(p.sessions.length),
          duration(p.duration_seconds),
        ]);
      } else if (report === 'transcript') {
        if (!detail.record) throw notFound();
        const size = await r.db
          .selectFrom('google_meet_transcript_entries as entry')
          .innerJoin('google_meet_artifacts as artifact', 'artifact.id', 'entry.artifact_id')
          .select([
            sql<string>`coalesce(sum(octet_length(entry.body_text)),0)::text`.as('bytes'),
            sql<string>`count(*)::text`.as('count'),
          ])
          .where('artifact.record_id', '=', detail.record.id)
          .executeTakeFirstOrThrow();
        if (BigInt(size.bytes) > 10n * 1024n * 1024n || BigInt(size.count) > 100000n)
          throw conflict(
            'Esta transcrição excede o limite de exportação. Consulte os documentos originais no Google.',
          );
        const entries = await transcriptRows(r, detail.record.id);
        if (entries.length > 100000)
          throw conflict(
            'Esta transcrição excede o limite de exportação. Consulte os documentos originais no Google.',
          );
        if (!entries.length)
          throw conflict('Ainda não há trechos de transcrição importados para exportar.');
        const stamp = (value: Date) => {
          const ms = Math.max(0, +value - +detail.record!.starts_at),
            hours = Math.floor(ms / 3600000),
            minutes = Math.floor((ms % 3600000) / 60000),
            seconds = Math.floor((ms % 60000) / 1000);
          return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
        };
        if (format === 'txt' || format === 'vtt') {
          const text =
            format === 'vtt'
              ? 'WEBVTT\n\n' +
                entries
                  .map(
                    (entry) =>
                      `${stamp(entry.starts_at)} --> ${stamp(entry.ends_at)}\n${(entry.display_name || 'Participante') + ': ' + entry.body_text.replaceAll('-->', '→').replace(/\n\s*\n/g, '\n')}\n`,
                  )
                  .join('\n')
              : entries
                  .map(
                    (entry) =>
                      `[${stamp(entry.starts_at)}] ${entry.display_name || 'Participante'}: ${entry.body_text}`,
                  )
                  .join('\n\n');
          return reply
            .header('Cache-Control', 'private, no-store')
            .header('Content-Disposition', `attachment; filename="apmail-transcricao.${format}"`)
            .type(format === 'vtt' ? 'text/vtt; charset=utf-8' : 'text/plain; charset=utf-8')
            .send(text);
        }
        document.columns = ['Horário', 'Participante', 'Trecho'];
        document.rows = entries.map((entry) => [
          stamp(entry.starts_at),
          entry.display_name || 'Participante',
          entry.body_text,
        ]);
        if (format === 'pdf') {
          document.rows = [];
          document.sections = entries.map((entry) => ({
            title: stamp(entry.starts_at) + ' · ' + (entry.display_name || 'Participante'),
            text: entry.body_text,
          }));
        }
      } else {
        const artifactCount = (key: string, kind: string) => {
          const raw = detail.record?.artifact_status;
          const state =
            raw && typeof raw === 'object' && !Array.isArray(raw)
              ? (raw as Record<string, { state?: string }>)[key]?.state
              : null;
          return state === 'available'
            ? String(detail.artifacts.filter((a) => a.kind === kind).length)
            : 'Não disponível';
        };
        document.rows = [
          [
            'Origem',
            detail.record
              ? 'Conferência registrada pelo Google'
              : 'Agendamento sem comprovação de realização',
          ],
          ['Organizador', detail.event?.organizer ?? 'Não informado pela API'],
          ['Início real', date(detail.record?.starts_at)],
          ['Fim real', date(detail.record?.ends_at)],
          ['Link', detail.record?.meeting_url ?? detail.event?.meeting_url ?? ''],
          [
            'Participantes registrados',
            detail.record?.artifact_status &&
            typeof detail.record.artifact_status === 'object' &&
            !Array.isArray(detail.record.artifact_status) &&
            (detail.record.artifact_status as Record<string, { state?: string }>).participants
              ?.state === 'available'
              ? String(detail.participants.length)
              : 'Não disponível',
          ],
          ['Gravações', artifactCount('recordings', 'recording')],
          ['Transcrições', artifactCount('transcripts', 'transcript')],
          ['Notas', artifactCount('smartNotes', 'smart_notes')],
        ];
        document.sections = [
          {
            title: 'Participação registrada',
            text:
              detail.participants
                .map((p) => (p.display_name || 'Sem nome') + ' · ' + duration(p.duration_seconds))
                .join('\n') || 'Sem dados de participação importados.',
          },
          {
            title: 'Linha do tempo',
            text:
              detail.timeline.map((e) => date(e.at) + ' · ' + e.label).join('\n') ||
              'Nenhum registro de conferência disponível.',
          },
        ];
      }
      if (format === 'txt' || format === 'vtt')
        throw conflict('Escolha a exportação de transcrição para este formato.');
      reply.header('Cache-Control', 'private, no-store');
      if (format === 'html')
        return reply
          .type('text/html; charset=utf-8')
          .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
          .send(reportHtml(document));
      reply.header('Content-Disposition', `attachment; filename="apmail-${report}.${format}"`);
      return format === 'csv'
        ? reply.type('text/csv; charset=utf-8').send(reportCsv(document))
        : reply.type('application/pdf').send(await reportPdf(document));
    },
  );
}
