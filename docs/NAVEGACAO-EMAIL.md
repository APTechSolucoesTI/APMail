# Navegação e rolagem dos e-mails

A árvore de pastas usa setas para expandir e recolher, mantendo a hierarquia importada. As subpastas começam recolhidas; o caminho da pasta selecionada é revelado automaticamente. A escolha de expansão é uma preferência local por usuário, empresa e caixa. Nomes longos mostram o caminho completo ao passar o mouse, e contadores de não lidas têm espaço próprio. Recuos são limitados para pastas profundas; nomes e caminhos no banco não são alterados.

No desktop, arraste a divisória ao lado do menu para ajustar de 240 a 480 px (inicial: 300 px). A divisória também aceita setas do teclado e salva a largura por usuário neste navegador. Usa os componentes shadcn de redimensionamento e a biblioteca já instalada. No celular/tablet, o menu abre em um painel lateral, com alvos de toque maiores e fechamento após escolher a pasta.

O layout ocupa a altura da janela. Menu, lista de conversas e leitura rolam separadamente; outras páginas possuem rolagem no conteúdo principal. A lista não usa mais altura calculada por uma margem fixa. Indicadores acessíveis de mensagens não lidas ficam contidos em cada registro para não aumentar a altura da página fora do painel.

Alteração apenas no frontend; não exige migration ou dependência nova. Commit/deploy pelo usuário. Validado localmente com hierarquia de oito níveis, 45 subpastas, mensagens longas e paginação, em 1440×900, 768×1024 e 390×844, temas claro/escuro. Testes incluem expansão, persistência, isolamento de preferências, acesso por pasta selecionada e recolhimento pelo teclado.
