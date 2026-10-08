## 7. Design system

O arquivo **`design-system-e-diretrizes-tecnicas.md`** fornecido junto com este prompt é a fonte de verdade visual. **Copie-o para `docs/design-system.md` na Fase 0.** Se ele não estiver disponível, esta seção contém tudo o que é necessário. Em caso de conflito, o arquivo do design system prevalece, exceto nas exceções explícitas da seção 7.6.

### 7.1 Princípios (resumo obrigatório)

1. Clareza operacional: a informação principal e a próxima ação são reconhecidas sem esforço.
2. Densidade com legibilidade: listas compactas, com contraste, foco e áreas de clique acessíveis.
3. Cores comunicam função e estado; nunca apenas decoração. Status nunca depende só de cor (sempre texto e/ou ícone).
4. Progressive disclosure: ações raras ficam em menus ("Mais ações").
5. Acessibilidade: teclado, leitor de tela, contraste AA, `prefers-reduced-motion`.
6. Responsividade orientada à tarefa: mobile < 640 px, tablet 640–1023 px, desktop ≥ 1024 px.

### 7.2 Tipografia

- **Inter** (400, 500, 600, 700) para toda a interface; **JetBrains Mono** (400, 500, 700) para IDs, endereços técnicos e códigos. Carregar via Google Fonts em `apps/web/index.html` com `display=swap` e `preconnect`. Fallbacks: `ui-sans-serif, system-ui, sans-serif` e `ui-monospace, monospace`.
- Escala (classe utilitária → uso):

| Token          | Tamanho/linha | Peso                  | Uso                                        |
| -------------- | ------------- | --------------------- | ------------------------------------------ |
| `h1`           | 30/36         | 700, tracking -0.02em | Título único da página                     |
| `h2`           | 24/32         | 600                   | Seção principal, assunto da conversa       |
| `h3`           | 20/28         | 600                   | Card, painel                               |
| `subtitle`     | 16/24         | 500                   | Contexto abaixo do título                  |
| `body`         | 14/20         | 400                   | Texto padrão                               |
| `body-strong`  | 14/20         | 600                   | Ênfase                                     |
| `small`        | 12/16         | 400                   | Metadados, células                         |
| `small-strong` | 12/16         | 600                   | Rótulos compactos                          |
| `support`      | 11/16         | 400                   | Ajuda, badge, cabeçalho de tabela          |
| `micro`        | 10/14         | 500                   | Metadado curto (nunca instrução essencial) |
| `mono`         | 12/16         | 500                   | Códigos                                    |

- Um único `h1` por página. Texto operacional nunca menor que 12 px. Números alinhados à direita em tabelas.

### 7.3 Espaçamento, raios, sombras

Grade de 4 px (`space-1`=4, `space-2`=8, `space-3`=12, `space-4`=16, `space-6`=24, `space-8`=32). Raios: `sm` 4 px, `md` 8 px, `lg` 12 px, `xl` 16 px. Sombra de card: `0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)`. Não empilhar borda forte com sombra forte.

### 7.4 Tokens de cor — `apps/web/src/styles.css`

Implemente exatamente estes tokens (Tailwind 4, `@theme inline`), temas claro e escuro (classe `.dark` no `<html>`, com opção "Sistema"):

```css
@import 'tailwindcss';
@custom-variant dark (&:is(.dark *));

:root {
  --brand-dark: #0d2b5e;
  --brand-medium: #1a6b8a;
  --brand-accent: #00c2cb;
  --brand-gradient: linear-gradient(135deg, #0d2b5e 0%, #1a6b8a 55%, #00c2cb 100%);

  --background: #f7f8fa;
  --foreground: #111827;
  --card: #ffffff;
  --card-foreground: #111827;
  --popover: #ffffff;
  --popover-foreground: #111827;
  --primary: #137a98;
  --primary-foreground: #ffffff;
  --secondary: #e9f6f9;
  --secondary-foreground: #155e75;
  --accent: #ddf4f8;
  --accent-foreground: #155e75;
  --muted: #f1f3f5;
  --muted-foreground: #626d80;
  --border: #e4e7ec;
  --input: #dde1e7;
  --ring: #137a98;
  --destructive: #e7000b;
  --destructive-foreground: #ffffff;
  --sidebar: #ffffff;
  --sidebar-foreground: #344054;

  --success: #22c55e;
  --success-bg: #dcfce7;
  --success-fg: #166534;
  --warning: #eab308;
  --warning-bg: #fef9c3;
  --warning-fg: #854d0e;
  --danger: #e7000b;
  --danger-bg: #fee2e2;
  --danger-fg: #991b1b;
  --info: #3b82f6;
  --info-bg: #dbeafe;
  --info-fg: #1e40af;
  --progress: #4f46e5;
  --progress-bg: #e0e7ff;
  --progress-fg: #3730a3;
  --neutral: #667085;
  --neutral-bg: #f1f3f5;
  --neutral-fg: #344054;

  --chart-1: #1686a7;
  --chart-2: #0d2b5e;
  --chart-3: #00c2cb;
  --chart-4: #eab308;
  --chart-5: #22c55e;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --shadow-card: 0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06);
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

.dark {
  --brand-medium: #168db8;
  --brand-accent: #47c4dd;
  --background: #060608;
  --foreground: #f4f6f8;
  --card: #0d0e11;
  --card-foreground: #f4f6f8;
  --popover: #121317;
  --popover-foreground: #f4f6f8;
  --primary: #47c4dd;
  --primary-foreground: #041115;
  --secondary: #17191d;
  --secondary-foreground: #f4f6f8;
  --accent: #47c4dd;
  --accent-foreground: #041115;
  --muted: #191b20;
  --muted-foreground: #9ca3af;
  --border: #27292f;
  --input: #30323a;
  --ring: #47c4dd;
  --destructive: #ff6467;
  --destructive-foreground: #041115;
  --sidebar: #18191d;
  --sidebar-foreground: #f1f3f5;

  --success-bg: #14532d;
  --success-fg: #86efac;
  --warning-bg: #422006;
  --warning-fg: #fde047;
  --danger-bg: #450a0a;
  --danger-fg: #ff6467;
  --info-bg: #172554;
  --info-fg: #93c5fd;
  --progress-bg: #1e1b4b;
  --progress-fg: #a5b4fc;
  --neutral-bg: #191b20;
  --neutral-fg: #d0d5dd;

  --chart-1: #47c4dd;
  --chart-2: #93c5fd;
  --chart-3: #168db8;
  --chart-4: #fde047;
  --chart-5: #86efac;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-brand-dark: var(--brand-dark);
  --color-brand-medium: var(--brand-medium);
  --color-brand-accent: var(--brand-accent);
  --color-success: var(--success);
  --color-success-bg: var(--success-bg);
  --color-success-fg: var(--success-fg);
  --color-warning: var(--warning);
  --color-warning-bg: var(--warning-bg);
  --color-warning-fg: var(--warning-fg);
  --color-danger: var(--danger);
  --color-danger-bg: var(--danger-bg);
  --color-danger-fg: var(--danger-fg);
  --color-info: var(--info);
  --color-info-bg: var(--info-bg);
  --color-info-fg: var(--info-fg);
  --color-progress: var(--progress);
  --color-progress-bg: var(--progress-bg);
  --color-progress-fg: var(--progress-fg);
  --color-neutral: var(--neutral);
  --color-neutral-bg: var(--neutral-bg);
  --color-neutral-fg: var(--neutral-fg);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
  --radius-xl: var(--radius-xl);
  --shadow-card: var(--shadow-card);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground font-sans text-sm antialiased;
  }
  h1,
  h2,
  h3,
  h4 {
    letter-spacing: -0.02em;
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
}
```

Regras: componentes usam **somente** classes semânticas (`bg-card`, `text-muted-foreground`, `bg-info-bg text-info-fg` etc.). Hex direto só neste arquivo e em `packages/shared/src/constants.ts` (cores de etiqueta). Gradiente institucional apenas na tela de login/cadastro e no logo.

### 7.5 Mapas de status (usar sempre `StatusBadge`)

`StatusBadge` = `rounded-sm border px-2 h-5 text-[11px] font-medium inline-flex items-center gap-1` + ícone Lucide 12 px + texto. Nunca só cor.

**Status de fila (`queue_status`):**

| Valor                    | Rótulo              | Cor (bg/fg/borda) | Ícone          |
| ------------------------ | ------------------- | ----------------- | -------------- |
| `to_reply`               | A responder         | info              | `Inbox`        |
| `in_progress`            | Em atendimento      | progress          | `UserCheck`    |
| `awaiting_reply`         | Aguardando resposta | warning           | `Hourglass`    |
| `scheduled`              | Agendado            | neutral           | `Clock`        |
| `done`                   | Concluído           | success           | `CheckCircle2` |
| `none`                   | (sem badge)         | —                 | —              |
| _(derivado)_ fora do SLA | Fora do SLA         | danger            | `AlarmClock`   |

**Status da caixa (`mailbox_status`):** `active` → "Ativa" (success, `CircleCheck`); `pending` → "Verificando" (info, `Loader2` girando, respeitando reduced motion); `error` → "Erro de conexão" (danger, `CircleAlert`); `disabled` → "Desativada" (neutral, `CircleSlash`).

**Status de envio (`outbox_status`):** `draft` "Rascunho" (neutral), `queued` "Na fila" (info), `scheduled` "Agendado" (neutral, `Clock`), `sending` "Enviando" (info), `sent` "Enviado" (success), `failed` "Falhou" (danger), `canceled` "Cancelado" (neutral).

**Papéis:** `owner` "Proprietário", `admin` "Administrador", `member` "Membro"; `mailbox_admin` "Admin da caixa", `editor` "Editor", `viewer` "Somente leitura".

**Cores de etiqueta pessoal** (`packages/shared/src/constants.ts`, chave → claro bg/fg, escuro bg/fg):
`teal` #CCFBF1/#115E59, #134E4A/#5EEAD4 · `blue` #DBEAFE/#1E40AF, #172554/#93C5FD · `indigo` #E0E7FF/#3730A3, #1E1B4B/#A5B4FC · `green` #DCFCE7/#166534, #14532D/#86EFAC · `amber` #FEF3C7/#92400E, #451A03/#FCD34D · `red` #FEE2E2/#991B1B, #450A0A/#FCA5A5 · `slate` #F1F5F9/#334155, #1E293B/#CBD5E1 · `cyan` #CFFAFE/#155E75, #164E63/#67E8F9. Aplicar via `style` com CSS variables locais (`--label-bg`, `--label-fg`) escolhidas pelo tema — esta é a única exceção permitida a estilo inline.

### 7.6 Padrão de listagens (obrigatório em toda tela administrativa)

Anatomia: (1) cabeçalho da página com `h1`, descrição opcional e ação primária à direita; (2) toolbar: busca (debounce 400 ms), filtros em popover com contador, botão `Colunas` (ícone `Settings2`), ações em lote quando houver seleção; (3) resumo "início–fim de total" + paginação; (4) tabela com cabeçalho sticky (cabeçalho 11 px/600/caixa alta, altura 32 px; célula 12 px, `py-1.5 px-2`; hover `bg-muted/50`; seleção `bg-muted`); (5) estados: loading (skeleton), atualização (mantém dados + indicador discreto), vazio, sem resultado (com "Limpar filtros (N)"), erro ("Tentar novamente"), sem permissão; (6) paginação inferior.

- Paginação padrão **10**, opções **10, 20, 30, 50, 100**. Filtro/ordenação/tamanho voltam à página 1. Estado refletido na URL (search params).
- A lista de conversas usa padrão **10** por página, conforme a instrução AGENTS.md mais recente. A API também usa 10 quando o tamanho não é informado.
- Ordenação: nenhuma → asc → desc → nenhuma; `aria-sort` no `<th>`.
- Ações por linha: `Eye` (Visualizar), `Pencil` (Editar), `Trash2` (Excluir, cor destrutiva, com confirmação), `Ellipsis` (Mais ações). Botão `icon` 32×32 com `aria-label` e tooltip. Máximo 3 ações expostas.
- Preferências de colunas persistidas por usuário em `table_preferences` com `list_key` exclusivo (lista de `list_key` na seção 13). Botão "Restaurar padrão". Pelo menos uma coluna de identificação sempre visível.
- Mobile: listagens viram cards; ações de linha vão para menu contextual.
- Paginação/busca/ordenação no servidor quando o conjunto for ilimitado (e-mails, auditoria, envios); em memória só para conjuntos pequenos (usuários, caixas, regras, assinaturas, etiquetas).

Contrato para listagens paginadas no servidor (em `packages/shared/src/schemas/search.ts`):

```ts
export type ListQuery = {
  page: number;
  pageSize: 10 | 20 | 30 | 50 | 100;
  search?: string;
  sort?: { key: string; direction: 'asc' | 'desc' };
  filters: Record<string, string[]>;
};
export type ListResult<T> = { items: T[]; total: number; page: number; pageSize: number };
```

### 7.7 Componentes base obrigatórios (criados na Fase 0)

| Componente             | Arquivo                                      | Especificação                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shadcn/ui              | `components/ui/*`                            | Instalar: button, input, label, textarea, select, checkbox, radio-group, switch, dialog, alert-dialog, sheet, dropdown-menu, popover, command, tooltip, tabs, badge, avatar, separator, skeleton, table, scroll-area, sonner, calendar, resizable, chart, toggle-group, collapsible, form                                                                                                         |
| `cn()`                 | `lib/utils.ts`                               | `clsx` + `tailwind-merge`                                                                                                                                                                                                                                                                                                                                                                         |
| `DataState`            | `components/data/data-state.tsx`             | Exporta `LoadingState`, `EmptyState({icon,title,description,action})`, `NoResultsState({onClear,count})`, `ErrorState({onRetry})`, `NoPermissionState`. Usa `role="status"`/`aria-live="polite"`.                                                                                                                                                                                                 |
| `ConfigurableTable<T>` | `components/data/configurable-table.tsx`     | Sobre TanStack Table. Props: `listKey`, `columns` (id, header, cell, sortable, align, width, hideable=true, defaultVisible=true), `data`, `total`, `query: ListQuery`, `onQueryChange`, `selectable`, `bulkActions(selectedIds)`, `rowActions(row)`, `toolbarLeft`, `filters`, `isLoading`, `isFetching`, `error`, `emptyState`, `mode: 'client' \| 'server'`. Implementa toda a anatomia da 7.6. |
| `ColumnSettingsDialog` | `components/data/column-settings-dialog.tsx` | Visibilidade (checkbox), ordem (`ArrowUp`/`ArrowDown`), tamanho da página; "Aplicar", "Cancelar", "Restaurar padrão".                                                                                                                                                                                                                                                                             |
| `Pagination`           | `components/data/pagination.tsx`             | `<nav aria-label="Paginação da listagem">`, `ChevronLeft`/`ChevronRight`, "Página X de Y", "1–10 de 243".                                                                                                                                                                                                                                                                                         |
| `SearchInput`          | `components/data/search-input.tsx`           | Ícone `Search`, botão limpar (`X`), `Escape` limpa, debounce configurável.                                                                                                                                                                                                                                                                                                                        |
| `FilterPopover`        | `components/data/filter-popover.tsx`         | Multisseleção com checkbox, "Todos", "Limpar", rótulo "Status: 2".                                                                                                                                                                                                                                                                                                                                |
| `PageHeader`           | `components/layout/page-header.tsx`          | `h1` + descrição + slot de ações.                                                                                                                                                                                                                                                                                                                                                                 |
| `StatusBadge`          | `components/common/status-badge.tsx`         | Variantes: `info`, `progress`, `warning`, `success`, `danger`, `neutral`; recebe `icon` e `label`. Helpers `QueueStatusBadge`, `MailboxStatusBadge`, `OutboxStatusBadge`, `RoleBadge`.                                                                                                                                                                                                            |
| `ConfirmDialog`        | `components/common/confirm-dialog.tsx`       | AlertDialog; variante destrutiva; texto com quantidade afetada em ações em lote.                                                                                                                                                                                                                                                                                                                  |
| `UserAvatar`           | `components/common/user-avatar.tsx`          | Foto ou iniciais; tamanhos 20/24/32/40; indicador online opcional.                                                                                                                                                                                                                                                                                                                                |
| `useTablePreferences`  | `hooks/use-table-preferences.ts`             | Lê/grava preferências por `list_key` via `GET/PUT /api/preferences/tables/:listKey`.                                                                                                                                                                                                                                                                                                              |

---

Etiquetas pessoais: cores azul, índigo, verde, âmbar, vermelho e cinza reutilizam os tokens de feedback correspondentes. Verde petróleo usa label-teal-bg/fg (#CCFBF1/#115E59 no claro, #134E4A/#99F6E4 no escuro); ciano usa label-cyan-bg/fg (#CFFAFE/#155E75 no claro, #164E63/#A5F3FC no escuro). Toda etiqueta inclui seu nome, com contraste AA nos dois temas.

## Revisão das listagens — 07/10/2026

Todas as listagens de registros usam ConfigurableTable ou contrato equivalente: filtros digitáveis em cada coluna, ordenação, Colunas (visibilidade/ordem/tamanho), paginação superior/inferior e identificação sempre visível. Filtros de coluna usam `filters["column:<id>"]`; APIs recebem `columns` JSON, `column_sort` e `column_direction` validados contra whitelist. Contatos usam `sort`/`direction` equivalentes; e-mails preservam URL da caixa/fila/pasta/etiqueta e painel de leitura. Preferências são privadas por usuário/listKey, incluindo superadmin; menus/autocomplete/texto de conversa mantêm interação própria. Dados não limitados são filtrados no servidor antes da paginação/total; detalhes de gráficos, amostras e catálogos já limitados podem usar cliente. Temas claro/escuro, filtros móveis, navegação por teclado, redução de movimento e estados de dados são mantidos.
