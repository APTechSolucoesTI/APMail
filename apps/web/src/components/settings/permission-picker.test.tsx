import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PermissionPicker } from './permission-picker';
import type { AccessPermission } from '@apmail/shared';

describe('PermissionPicker', () => {
  it('seleciona acesso de leitura sem conceder ações de exclusão', () => {
    const change = vi.fn();
    render(<PermissionPicker value={[]} onChange={change} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Contatos' }));
    expect(change).toHaveBeenLastCalledWith(['contacts']);
    expect(change.mock.lastCall?.[0]).not.toContain('contacts.delete');
  });

  it('mantém mover, excluir, restaurar e sinalizar como ações independentes', () => {
    const change = vi.fn();
    const { rerender } = render(<PermissionPicker value={[]} onChange={change} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Organizar mensagens' }));
    expect(change.mock.lastCall?.[0]).toEqual(expect.arrayContaining(['mail', 'mail.organize']));
    expect(change.mock.lastCall?.[0]).not.toContain('mail.delete');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mover mensagens' }));
    expect(change.mock.lastCall?.[0]).toEqual(
      expect.arrayContaining(['mail', 'mail.organize', 'mail.move']),
    );
    expect(change.mock.lastCall?.[0]).not.toContain('mail.delete');
    rerender(
      <PermissionPicker
        value={['mail', 'mail.organize', 'mail.move', 'mail.flag', 'contacts']}
        onChange={change}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'E-mail' }));
    expect(change).toHaveBeenLastCalledWith(['contacts']);
  });

  it('inclui as dependências de uma ação e permite recolher seu submenu', () => {
    const change = vi.fn();
    render(<PermissionPicker value={[]} onChange={change} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Excluir contatos' }));
    expect(change.mock.lastCall?.[0]).toEqual(
      expect.arrayContaining(['contacts', 'contacts.delete']),
    );
    const toggle = screen.getByRole('button', { name: 'Recolher ações de Contatos' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByRole('checkbox', { name: 'Excluir contatos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expandir ações de Contatos' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('revoga ações dependentes ao remover o acesso principal', () => {
    const change = vi.fn();
    render(
      <PermissionPicker value={['contacts', 'contacts.delete', 'calendar']} onChange={change} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Contatos' }));
    expect(change).toHaveBeenLastCalledWith(['calendar']);
  });

  it('limita concessões ao acesso do operador, permitindo remover acessos existentes', () => {
    const change = vi.fn();
    const value: AccessPermission[] = ['contacts', 'contacts.delete'];
    render(<PermissionPicker value={value} allowedPermissions={['contacts']} onChange={change} />);
    expect(screen.getByRole('checkbox', { name: 'Calendário e reuniões' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Excluir contatos' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Excluir contatos' }));
    expect(change).toHaveBeenLastCalledWith(['contacts']);
  });
});
