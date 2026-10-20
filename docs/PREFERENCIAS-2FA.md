# Preferências e autenticação em dois fatores

As preferências são organizadas em **Geral**, **E-mail**, **Notificações**, **Convites**
e **2FA**. Geral abre primeiro, com tema e fuso horário. Filas, confirmação de leitura
e imagens externas ficam em E-mail. Cada formulário salva apenas os campos da sua aba,
preservando as configurações das demais. O modelo de e-mail e a assinatura dos convites
continuam no componente existente, agora na aba Convites.

## Ativação e uso

Em **Preferências → 2FA**, o usuário confirma a senha atual, escaneia o QR Code no
Google Authenticator ou informa a chave manualmente, e confirma um código de seis dígitos.
O 2FA só fica ativo após essa confirmação. A configuração incompleta expira em dez minutos.
O QR Code é gerado localmente pelo backend, sem compartilhar o segredo com serviços externos.

A ativação é opcional e começa desabilitada para todas as contas existentes. O fator
protege a identidade do usuário em todas as empresas às quais ele pertence. Superadmins
usam o mesmo fluxo no botão **Segurança · 2FA** da administração.

Depois de validar a senha, uma conta com 2FA recebe uma etapa separada para informar
o código. Nenhuma sessão nova é criada antes dessa confirmação. Há dez códigos de
recuperação, apresentados apenas na ativação ou renovação, com opção de copiar e baixar.
Cada código funciona uma única vez. Renovar códigos invalida todos os anteriores.
Desativar ou renovar exige senha atual e um segundo fator válido.

Ativação, desativação e renovação encerram as outras sessões da conta e invalidam desafios
anteriores. A sessão que concluiu a operação permanece disponível. Recuperar ou alterar
a senha não desativa o 2FA. O link de recuperação de senha não concede uma sessão a uma
conta protegida: ela volta ao login e confirma o autenticador.

## Implementação e proteção

- TOTP conforme [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), com SHA1, seis dígitos,
  período de 30 segundos e janela de um intervalo para diferenças de relógio.
- Validação pela biblioteca [OTPAuth](https://github.com/hectorm/otpauth); QR pelo
  [node-qrcode](https://github.com/soldair/node-qrcode).
- Segredo criptografado com AES-256-GCM e vinculado ao ID do usuário. Reutiliza
  `CREDENTIALS_ENCRYPTION_KEY`; não exige variável adicional nem OAuth.
- Códigos de recuperação aleatórios de 80 bits; somente seus hashes SHA-256 vinculados
  à conta ficam no banco. O texto original não pode ser recuperado depois.
- Desafios aleatórios de login duram cinco minutos e são armazenados somente por hash,
  vinculados à versão do fator e à senha validada na primeira etapa. Cinco erros bloqueiam
  o desafio; há também limites por conta e IP, inclusive ao gerar novos desafios.
- Locks transacionais impedem uso concorrente de um código ou desafio. O último
  contador TOTP aceito é registrado para impedir repetição no mesmo intervalo.
- A criação de sessão central verifica o fator para todos os caminhos de autenticação,
  inclusive convites e recuperação de senha; uma sessão anterior revogada não pode renová-la.
- Rotas de configuração e verificação usam `Cache-Control: no-store`; segredos e provas
  não são incluídos em `/auth/me`, preferências, auditoria ou logs de requisição.
- Os dados são acessados somente no backend autenticado, com ID obtido da sessão;
  nenhuma rota aceita um ID de terceiro para gerenciar seu fator.
- O job existente `cleanup-auth` remove desafios expirados e chaves de setup vencidas.

## Banco e publicação

Migration aditiva **0048_optional_two_factor.sql**, com `user_two_factor` e
`auth_two_factor_challenges`, chaves estrangeiras, constraints, índices de usuário e
expiração. Tipos Kysely regenerados. Nenhum segredo é preenchido automaticamente e
nenhum usuário é obrigado a ativar a função.

Publicar API, web e worker com o migrador habitual. Preservar a chave de criptografia
existente e manter o relógio do servidor sincronizado. Não houve alteração em produção
nesta entrega; deploy pelo usuário no Dokploy.

Guarde os códigos de recuperação em local seguro. Sem o aplicativo e sem códigos,
a recuperação exige uma intervenção administrativa controlada; trocar a senha não
remove a proteção. Não há endpoint para um administrador desativar o fator de terceiros.

## Verificações

Testes incluem vetores RFC, criptografia vinculada ao usuário, setup com senha, expiração,
login sem fator, login TOTP, recuperação de uso único, concorrência, reuso, cinco erros,
mudança de senha, renovação, desativação, isolamento entre contas e acesso de superadmin.
Testes de componente cobrem o login em duas etapas e o salvamento parcial por aba.
O fluxo também foi exercitado no navegador com PostgreSQL e Redis locais, incluindo
desktop, tablet, celular e navegação por teclado. Nenhuma conta real teve 2FA ativado.
