import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2, Plus } from 'lucide-react';
import { editableMeetConfig, meetConfigSchema, type MeetConfig } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import type { MeetSpace } from '@/lib/meet-reports';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { ErrorState } from '@/components/data/data-state';
import { compactSelect } from './meet-preferences';
export function MeetConfigFields({
  value,
  onChange,
  disabled,
}: {
  value: MeetConfig;
  onChange: (config: MeetConfig) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-xs font-medium">
        Acesso à sala
        <select
          disabled={disabled}
          className={compactSelect}
          aria-label="Acesso à sala"
          value={value.accessType ?? 'TRUSTED'}
          onChange={(e) =>
            onChange({ ...value, accessType: e.target.value as MeetConfig['accessType'] })
          }
        >
          <option value="TRUSTED">Pessoas de confiança</option>
          <option value="RESTRICTED">Restrito aos convidados</option>
          <option value="OPEN">Aberto a quem tem o link</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-3">
        {(['recording', 'transcription', 'smartNotes'] as const).map((kind) => {
          const key =
            kind === 'recording'
              ? 'recordingConfig'
              : kind === 'transcription'
                ? 'transcriptionConfig'
                : 'smartNotesConfig';
          const field =
            kind === 'recording'
              ? 'autoRecordingGeneration'
              : kind === 'transcription'
                ? 'autoTranscriptionGeneration'
                : 'autoSmartNotesGeneration';
          const config = value.artifactConfig?.[key],
            checked = !!config && field in config && config[field as keyof typeof config] === 'ON';
          return (
            <label key={kind} className="flex items-center gap-2 text-xs">
              <Checkbox
                disabled={disabled}
                checked={checked}
                onCheckedChange={(state) =>
                  onChange(
                    meetConfigSchema.parse({
                      ...value,
                      artifactConfig: {
                        ...value.artifactConfig,
                        [key]: { [field]: state === true ? 'ON' : 'OFF' },
                      },
                    }),
                  )
                }
              />
              {kind === 'recording'
                ? 'Gravação automática'
                : kind === 'transcription'
                  ? 'Transcrição automática'
                  : 'Notas automáticas'}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Recursos independentes, sujeitos ao plano, às políticas e aos privilégios do organizador no
        Google. A geração automática depende da entrada de um anfitrião elegível. Informe os
        participantes sobre gravação e transcrição.
      </p>
      <p className="text-xs text-muted-foreground">
        Convidados por e-mail podem precisar pedir entrada na sala, conforme a política do Google.
      </p>
    </div>
  );
}
type Member = { name: string; email?: string; role?: string };
export function MeetSpaceManager({ space }: { space: MeetSpace }) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    [config, setConfig] = useState<MeetConfig>(() => editableMeetConfig(space.config)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [showMembers, setShowMembers] = useState(false),
    [email, setEmail] = useState(''),
    [role, setRole] = useState('COHOST'),
    [remove, setRemove] = useState<Member | null>(null);
  const [tokens, setTokens] = useState<string[]>([]),
    token = tokens.at(-1);
  const path = '/integrations/google/meet/spaces/' + space.id;
  const members = useQuery({
    queryKey: ['meet-reports', tenant, 'members', space.id, token],
    enabled: showMembers,
    queryFn: () =>
      api<{ items: Member[]; next: string | null }>(
        path + '/members' + (token ? '?page_token=' + encodeURIComponent(token) : ''),
      ),
  });
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api(path, { method: 'PATCH', body: config });
      await client.invalidateQueries({ queryKey: ['meet-reports', tenant, 'spaces'] });
      toast.success('Configuração atualizada no Google.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Configurações da sala</h2>
      {!space.app_created && (
        <p className="text-xs text-muted-foreground">
          Esta sala foi associada a partir de um link externo. O Google verifica seus privilégios
          para cada alteração de configuração ou membro.
        </p>
      )}
      <MeetConfigFields value={config} onChange={setConfig} disabled={busy} />
      <Button size="sm" disabled={busy} onClick={() => void save()}>
        Salvar no Google
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="border-t pt-3">
        <Button variant="ghost" size="sm" onClick={() => setShowMembers(!showMembers)}>
          {showMembers ? 'Ocultar membros' : 'Gerenciar membros e coorganizadores'}
        </Button>
        {showMembers && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Membros permanentes da sala. Adicionar um membro não envia o convite do calendário; os
              convidados do evento continuam no fluxo de e-mail existente.
            </p>
            {members.isPending ? (
              <p role="status" className="text-xs">
                Consultando Google…
              </p>
            ) : members.isError ? (
              <div>
                <p role="alert" className="text-xs text-destructive">
                  {members.error.message}
                </p>
                <ErrorState onRetry={() => void members.refetch()} />
              </div>
            ) : (
              <>
                <ul className="divide-y">
                  {members.data.items.map((member) => (
                    <li
                      key={member.name}
                      className="flex items-center justify-between gap-2 py-2 text-xs"
                    >
                      <span className="break-all">
                        <span className="block">{member.email ?? 'E-mail não informado'}</span>
                        <span className="block text-muted-foreground">
                          {member.role === 'COHOST'
                            ? 'Coorganizador'
                            : member.role === 'CONTRIBUTOR'
                              ? 'Colaborador'
                              : member.role === 'VIEWER'
                                ? 'Visualizador'
                                : 'Papel não informado'}
                        </span>
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={'Remover membro ' + (member.email ?? '')}
                        disabled={busy}
                        onClick={() => setRemove(member)}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
                {!members.data.items.length && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum membro informado pelo Google.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!tokens.length}
                    onClick={() => setTokens(tokens.slice(0, -1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!members.data.next}
                    onClick={() => members.data.next && setTokens([...tokens, members.data.next])}
                  >
                    Próxima
                  </Button>
                </div>
              </>
            )}
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await api(path + '/members', { method: 'POST', body: { email, role } });
                  setEmail('');
                  setTokens([]);
                  await client.invalidateQueries({
                    queryKey: ['meet-reports', tenant, 'members', space.id],
                  });
                  toast.success('Membro adicionado no Google.');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="min-w-40 flex-1 space-y-1 text-xs">
                E-mail
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="space-y-1 text-xs">
                Papel
                <select
                  className={compactSelect}
                  aria-label="Papel do membro"
                  value={role}
                  disabled={busy}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="COHOST">Coorganizador</option>
                  <option value="CONTRIBUTOR">Colaborador</option>
                  <option value="VIEWER">Visualizador</option>
                </select>
              </label>
              <Button size="sm" disabled={busy}>
                <Plus />
                Adicionar
              </Button>
            </form>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(open) => !open && setRemove(null)}
        title="Remover membro da sala?"
        description="O membro perderá o papel permanente nesta sala. O convite do calendário não será cancelado."
        destructive
        onConfirm={async () => {
          if (!remove) return;
          await api(path + '/members/' + encodeURIComponent(remove.name.split('/').at(-1)!), {
            method: 'DELETE',
          });
          await members.refetch();
          setRemove(null);
          toast.success('Membro removido.');
        }}
      />
    </section>
  );
}
