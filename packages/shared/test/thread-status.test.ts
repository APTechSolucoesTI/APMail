import { expect, it } from 'vitest';
import { computeThreadStatus, noteMentions } from '../src/thread-status.js';
const inbound = new Date('2026-01-02T12:00:00Z'),
  outbound = new Date('2026-01-01T12:00:00Z');
const base = {
  queue_excluded: false,
  has_pending_outbox: false,
  manual_done_at: null,
  last_inbound_at: null,
  last_outbound_at: null,
  assigned_to: null,
};
it('aplica todas as prioridades da fila e preserva atribuição nas respostas', () => {
  expect(computeThreadStatus(base)).toBe('none');
  expect(computeThreadStatus({ ...base, last_inbound_at: inbound })).toBe('to_reply');
  expect(computeThreadStatus({ ...base, last_inbound_at: inbound, assigned_to: 'id' })).toBe(
    'in_progress',
  );
  expect(computeThreadStatus({ ...base, last_outbound_at: outbound })).toBe('awaiting_reply');
  expect(
    computeThreadStatus({
      ...base,
      last_inbound_at: outbound,
      last_outbound_at: inbound,
      assigned_to: 'id',
    }),
  ).toBe('awaiting_reply');
  expect(computeThreadStatus({ ...base, manual_done_at: inbound, last_inbound_at: outbound })).toBe(
    'done',
  );
  expect(computeThreadStatus({ ...base, manual_done_at: outbound, last_inbound_at: inbound })).toBe(
    'to_reply',
  );
  expect(computeThreadStatus({ ...base, has_pending_outbox: true, manual_done_at: inbound })).toBe(
    'scheduled',
  );
  expect(computeThreadStatus({ ...base, has_pending_outbox: true, queue_excluded: true })).toBe(
    'none',
  );
});
it('extrai somente menções com UUID válido, preservando texto e posição', () => {
  const body =
    'Olá @[José](8ade8222-68ab-4a30-bf9f-70a0ea741620) e @[Inválido](xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)';
  expect(noteMentions(body)).toEqual([
    {
      user_id: '8ade8222-68ab-4a30-bf9f-70a0ea741620',
      full_name: 'José',
      index: 4,
      text: '@[José](8ade8222-68ab-4a30-bf9f-70a0ea741620)',
    },
  ]);
});
it('mantém histórico sem fila e preserva intervenções operacionais', () => {
  const history = {
    queue_excluded: false,
    has_pending_outbox: false,
    manual_done_at: null,
    last_inbound_at: new Date(),
    last_outbound_at: null,
    assigned_to: null,
    history_queue_eligible: false,
  };
  expect(computeThreadStatus(history)).toBe('none');
  expect(computeThreadStatus({ ...history, history_queue_eligible: true })).toBe('to_reply');
  expect(computeThreadStatus({ ...history, has_pending_outbox: true })).toBe('scheduled');
  expect(computeThreadStatus({ ...history, assigned_to: 'user' })).toBe('in_progress');
});
