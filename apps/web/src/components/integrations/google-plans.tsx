import { ExternalLink } from 'lucide-react';
const rows = [
  ['Criação de links', 'Sim', 'Sim', 'Sim', 'Sim'],
  ['Reuniões em grupo', 'Até 60 min', 'Até 24 h', 'Até 24 h', 'Até 24 h'],
  ['Gravação', 'Sem recurso premium', 'Premium 2 TB+', 'Incluída*', 'Standard+*'],
  ['Transcrição', 'Verificar na conta', 'Verificar na conta', 'Verificar na conta', 'Standard+*'],
  [
    'Relatório de presença',
    'Verificar na conta',
    'Não garantido',
    'Não garantido',
    'Plus / Enterprise / edições elegíveis*',
  ],
  [
    'Notas e recursos de IA',
    'Sem pacote premium',
    'Não incluídos no Premium básico',
    'Notas Gemini e recursos de IA*',
    'Depende da edição e das políticas*',
  ],
  [
    'Entrada e saída / API',
    'Permissão e acesso à reunião',
    'Permissão e acesso à reunião',
    'Permissão e acesso à reunião',
    'Permissão e acesso à reunião',
  ],
];
export function GooglePlans() {
  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
        Planos Google e disponibilidade de recursos
      </summary>
      <div className="space-y-3 border-t p-4">
        <p className="text-xs text-muted-foreground">
          A assinatura orienta os recursos do Meet. Permissões da API e políticas do organizador são
          verificadas separadamente; uma assinatura paga não libera automaticamente todos os dados.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[680px] text-left text-xs">
            <caption className="sr-only">Comparação de recursos do Google Meet</caption>
            <thead className="bg-muted/50">
              <tr>
                {[
                  'Recurso',
                  'Gratuito',
                  'Google One Premium',
                  'Google AI Pro / Ultra',
                  'Google Workspace',
                ].map((label) => (
                  <th key={label} className="px-3 py-2 font-semibold">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, ...values]) => (
                <tr key={label} className="border-t">
                  <th scope="row" className="px-3 py-2 font-medium">
                    {label}
                  </th>
                  {values.map((value, i) => (
                    <td key={i} className="px-3 py-2 text-muted-foreground">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          * Sujeito a país, idioma, edição, permissões e políticas. Gravação e transcrição são
          independentes. O plano informado no APMail não bloqueia recursos; a decisão final é do
          Google. Registros estruturados de sessões não equivalem ao relatório administrativo de
          presença.
        </p>
        <div className="flex flex-wrap gap-4 text-xs text-primary">
          <a
            href="https://support.google.com/meet/answer/10459644"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            Comparação oficial do Google
            <ExternalLink className="size-3" />
          </a>
          <a
            href="https://developers.google.com/workspace/meet/api/guides/authenticate-authorize"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            Permissões da API
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </details>
  );
}
