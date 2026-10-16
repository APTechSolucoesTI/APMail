import { useState } from 'react';
import { Copy, ExternalLink, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
export function GoogleSetup({ redirect, configured }: { redirect: string; configured: boolean }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: 'Preparar o aplicativo',
      text: 'No Google Cloud, selecione o projeto da integração e ative Google Meet REST API. Ative Calendar API se quiser consultar a agenda; para importar texto de notas, ative também Drive API.',
      href: 'https://console.cloud.google.com/apis/library',
    },
    {
      title: 'Permitir sua conta',
      text: 'Na Google Auth Platform, configure a identificação e o público do aplicativo. Em testes, adicione o e-mail que será conectado como usuário de teste. Contas Workspace podem exigir aprovação do administrador.',
      href: 'https://console.cloud.google.com/auth/overview',
    },
    {
      title: 'Cadastrar o retorno',
      text: 'Crie um cliente do tipo Aplicativo da Web e adicione exatamente o endereço de retorno abaixo. O administrador deve configurar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor da API e no worker, preservando a chave de criptografia atual.',
      href: 'https://console.cloud.google.com/auth/clients',
    },
    {
      title: 'Conectar e verificar',
      text: 'Use Conectar Google, aprove somente os serviços desejados e depois Testar conexão. A permissão opcional para ler notas no Drive é restrita e pode exigir verificação adicional do aplicativo. Não é necessário ativá-la para criar salas e consultar transcrições estruturadas.',
      href: 'https://developers.google.com/workspace/meet/api/guides/authenticate-authorize',
    },
  ];
  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
        Assistente de configuração Google
      </summary>
      <div className="space-y-4 border-t p-4">
        <ol className="grid grid-cols-4 gap-2" aria-label="Etapas da configuração">
          {steps.map((item, i) => (
            <li key={item.title}>
              <button
                type="button"
                className={
                  'w-full rounded-md border px-2 py-2 text-xs ' +
                  (step === i
                    ? 'border-primary bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground')
                }
                onClick={() => setStep(i)}
                aria-current={step === i ? 'step' : undefined}
              >
                {i + 1}. <span className="hidden sm:inline">{item.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <h3 className="text-sm font-semibold">{steps[step]!.title}</h3>
        <p className="text-sm text-muted-foreground">{steps[step]!.text}</p>
        <a
          className="inline-flex items-center gap-1 text-xs text-primary underline"
          href={steps[step]!.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir instruções do Google
          <ExternalLink className="size-3" />
        </a>
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="mb-1 text-xs font-medium">Endereço de retorno da integração</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs">{redirect}</code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Copiar endereço de retorno"
              onClick={() =>
                void navigator.clipboard
                  .writeText(redirect)
                  .then(() => toast.success('Endereço copiado.'))
                  .catch(() => toast.error('Não foi possível copiar.'))
              }
            >
              <Copy />
            </Button>
          </div>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {configured && <Check className="size-4 text-success-fg" />}
          {configured
            ? 'O servidor já possui o aplicativo Google configurado.'
            : 'A configuração do aplicativo no servidor ainda está pendente.'}
        </p>
        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!step}
            onClick={() => setStep(step - 1)}
          >
            Anterior
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={step === steps.length - 1}
            onClick={() => setStep(step + 1)}
          >
            Próxima etapa
          </Button>
        </div>
      </div>
    </details>
  );
}
