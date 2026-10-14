# Gerador externo de PST

O worker chama o CLI ContinuMail em um processo separado. Fonte original:
https://github.com/ContinuMail/continumail-converter

Commit fixado: `d94d35e2f43611f0cbc85e1a8686b75249821079` (CLI 0.3.3).
SHA-256 do arquivo fonte: `fd911e60870b24438160be42246bebd4f04a4b3b89e202bb875d7818be7c6eee`.

O Dockerfile compila a fonte sem modificações, inclui a licença GPL-3.0-or-later e o arquivo completo da fonte correspondente em `/opt/pst/source.tar.gz`. O código LGPL do motor PST e as demais licenças estão nessa fonte. O CLI não acessa redes durante a conversão; recebe somente arquivos locais preparados pelo worker.

Para desenvolvimento, compile `src/Mail2Pst.Cli` do commit acima com o SDK .NET 8. Configure `PST_EXPORT_COMMAND` como o caminho do runtime `dotnet` e `PST_EXPORT_DLL` como o caminho do `Mail2Pst.Cli.dll` publicado. O runtime e o gerador já estão incluídos na imagem de produção do worker.
