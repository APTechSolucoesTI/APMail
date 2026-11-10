import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useComposerPosition } from './use-composer-position';
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
});
function Fixture({
  user = 'user',
  enabled = true,
  surface,
}: {
  user?: string;
  enabled?: boolean;
  surface?: 'composer' | 'summary';
}) {
  const position = useComposerPosition('tenant:' + user, enabled, surface);
  return (
    <>
      <output aria-label="Posição">
        {position.style.left},{position.style.top}
      </output>
      <button onKeyDown={position.onKeyDown}>Mover compositor</button>
      <div
        aria-label="Cabeçalho"
        onPointerDown={position.onPointerDown}
        onPointerMove={position.onPointerMove}
        onPointerUp={position.onPointerUp}
        onPointerCancel={position.onPointerCancel}
      >
        Arraste aqui
      </div>
      <output aria-label="Arrastando">{String(position.dragging)}</output>
    </>
  );
}
it('move pelo teclado, lembra ao reabrir e isola a preferência por usuário', () => {
  const view = render(<Fixture />);
  expect(screen.getByLabelText('Posição')).toHaveTextContent('464,124');
  fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowLeft' });
  fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowUp' });
  expect(screen.getByLabelText('Posição')).toHaveTextContent('444,104');
  view.unmount();
  const reopened = render(<Fixture />);
  expect(screen.getByLabelText('Posição')).toHaveTextContent('444,104');
  reopened.rerender(<Fixture user="other" />);
  expect(screen.getByLabelText('Posição')).toHaveTextContent('464,124');
});
it('centraliza a conversa do Resumo e salva sua posição separadamente do compositor', () => {
  localStorage.setItem(
    'apmail-composer-position:tenant:user',
    JSON.stringify({ left: 32, top: 32 }),
  );
  const view = render(<Fixture surface="summary" />);
  expect(screen.getByLabelText('Posição')).toHaveTextContent('240,70');
  fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowRight' });
  expect(localStorage.getItem('apmail-summary-position:tenant:user')).toBe('{"left":260,"top":70}');
  view.rerender(<Fixture />);
  expect(screen.getByLabelText('Posição')).toHaveTextContent('32,32');
});
it('mantém o compositor visível quando a tela diminui e limita os movimentos', () => {
  render(<Fixture />);
  Object.defineProperty(window, 'innerWidth', { value: 1100, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  fireEvent(window, new Event('resize'));
  expect(screen.getByLabelText('Posição')).toHaveTextContent('124,24');
  for (let index = 0; index < 10; index++)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowUp', shiftKey: true });
  expect(screen.getByLabelText('Posição')).toHaveTextContent('124,16');
});
it('ignora preferência inválida sem impedir a composição', () => {
  localStorage.setItem('apmail-composer-position:tenant:user', '{invalid');
  render(<Fixture />);
  expect(screen.getByLabelText('Posição')).toHaveTextContent('464,124');
});
it('arrasta pelo cabeçalho, sinaliza o movimento e persiste apenas ao soltar', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const view = render(<Fixture />);
  const header = screen.getByLabelText('Cabeçalho');
  header.setPointerCapture = () => {};
  fireEvent.pointerDown(header, { button: 0, clientX: 500, clientY: 150 });
  expect(screen.getByLabelText('Arrastando')).toHaveTextContent('true');
  fireEvent.pointerMove(header, { clientX: 200, clientY: 100 });
  expect(screen.getByLabelText('Posição')).toHaveTextContent('164,74');
  expect(localStorage.getItem('apmail-composer-position:tenant:user')).toBeNull();
  fireEvent.pointerUp(header);
  expect(screen.getByLabelText('Arrastando')).toHaveTextContent('false');
  view.unmount();
  render(<Fixture />);
  expect(screen.getByLabelText('Posição')).toHaveTextContent('164,74');
  vi.unstubAllGlobals();
});
it('preserva posição flutuante durante maximização e ignora o atalho nesse modo', () => {
  const view = render(<Fixture />);
  fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowLeft' });
  view.rerender(<Fixture enabled={false} />);
  fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowLeft' });
  view.rerender(<Fixture />);
  expect(screen.getByLabelText('Posição')).toHaveTextContent('444,124');
});
