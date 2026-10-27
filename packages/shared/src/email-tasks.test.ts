import { expect, it } from 'vitest';
import { reminderSchema } from './calendar.js';

it('preserva vínculo de e-mail e responsável de uma tarefa validada', () => {
  const thread_id = '10000000-0000-4000-8000-000000000001';
  const user_id = '10000000-0000-4000-8000-000000000002';
  expect(
    reminderSchema.parse({
      title: 'Responder proposta',
      due_at: '2030-01-01T12:00:00Z',
      thread_id,
      user_id,
    }),
  ).toMatchObject({ thread_id, user_id });
});

it('rejeita vínculo de tarefa inválido', () => {
  expect(
    reminderSchema.safeParse({
      title: 'Responder',
      due_at: '2030-01-01T12:00:00Z',
      thread_id: 'outro-email',
    }).success,
  ).toBe(false);
});
