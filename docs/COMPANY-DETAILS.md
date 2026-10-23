# Cadastro de empresas

Os campos de identificação, endereço e contato são opcionais e ficam em
`tenants.company_details` (migration `0052_company_details.sql`), separados dos
parâmetros operacionais. Empresas existentes começam com `{}`. PATCH faz merge
dos campos informados; uma string vazia limpa um campo. Não altera mensagens,
usuários ou as configurações existentes.

Campos: razão social, nome fantasia, CNPJ, inscrições estadual e municipal,
responsável pelo contato, e-mail, telefone, site, CEP, logradouro, número,
complemento, bairro, cidade, UF e país. A validação compartilhada normaliza CNPJ,
CEP, e-mail e telefone e valida os dígitos verificadores de CNPJ numérico e
alfanumérico. URLs aceitam apenas HTTP/HTTPS.

Empresa e Superadmin usam o mesmo formulário. Ao digitar um novo CNPJ válido,
uma consulta ocorre após 500 ms. O botão Consultar CNPJ permite consultar de novo
um cadastro existente. Os campos retornados permanecem editáveis e o usuário deve
salvar explicitamente. Alterações manuais feitas durante a consulta e respostas
de um CNPJ anterior não são sobrescritas.

## Consulta pública

O backend consulta a [BrasilAPI CNPJ v1](https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/cnpj.json),
baseada na Minha Receita, com fallback direto para a [API pública Minha Receita](https://docs.minhareceita.org/), sem credenciais. Somente administradores/perfis com
`company.manage` ou superadmin podem consultar, com limite de 10 consultas por
usuário/minuto, timeout de até 4 segundos por provedor e 8 segundos no total, resposta limitada a 256 KB e validação do
CNPJ da resposta. Não são armazenados os dados de sócios nem a resposta completa.
Não há garantia de atualização imediata ou de disponibilidade da base pública;
quando não houver resultado ou ocorrer falha, o cadastro manual continua disponível.
Inscrições estadual/municipal, responsável e site dependem de preenchimento manual.
Não há validação fiscal oficial nem verificação de situação cadastral como requisito
para salvar. A consulta não envia e-mail nem realiza alterações externas.

O algoritmo dos dígitos verificadores segue a
[documentação da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf),
com ASCII − 48 para caracteres alfanuméricos e módulo 11.

## Verificação

- `packages/shared/test/company.test.ts`: validação, normalização e compatibilidade.
- `apps/api/test/company-lookup.test.ts`: mapeamento e falhas do provedor.
- `apps/api/test/integration/company.test.ts`: persistência real, merge, isolamento,
  permissões e criação/edição via Superadmin com proprietário já existente.
- `apps/web/src/components/forms/company-fields.test.tsx`: preenchimento automático,
  edição, salvamento, falha e descarte de consultas obsoletas.
