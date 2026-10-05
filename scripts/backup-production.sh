#!/usr/bin/env bash
# Usage: backup-production.sh COMPOSE_PROJECT ABSOLUTE_BACKUP_DIRECTORY
set -euo pipefail
umask 077

project=${1:?Informe o nome exato do projeto Compose}
backup_root=${2:?Informe o diretório absoluto de backups}
[[ "$project" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || { echo 'Projeto inválido' >&2; exit 1; }
[[ "$backup_root" == /* && "$backup_root" != / ]] || { echo 'Diretório de backup inválido' >&2; exit 1; }
mkdir -p "$backup_root"
exec 9>"$backup_root/.backup.lock"
flock -n 9 || { echo 'Um backup já está em execução' >&2; exit 1; }

container() {
  local ids
  ids=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$1")
  [[ -n "$ids" && "$ids" != *$'\n'* ]] || { echo "Serviço $1 ausente ou duplicado" >&2; return 1; }
  printf '%s' "$ids"
}
api=$(container api)
worker=$(container worker)
postgres=$(container postgres)
redis=$(container redis)
api_image=$(docker inspect --format '{{.Image}}' "$api")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_root/$stamp"
mkdir "$target"

# As chaves ficam em arquivo privado, nunca no log. Guarde cópia em cofre externo.
docker exec "$api" node -e 'for (const key of ["SESSION_SECRET", "CREDENTIALS_ENCRYPTION_KEY"]) { if (!process.env[key]) process.exit(1); console.log(key + "=" + process.env[key]); }' > "$target/secrets.env"

resume() { docker start "$api" "$worker" >/dev/null; }
trap resume EXIT
docker stop --time 45 "$api" "$worker" >/dev/null
docker exec "$postgres" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$target/apmail.dump"
docker run --rm --network none --volumes-from "$api:ro" --entrypoint tar "$api_image" -C /data/storage -czf - . > "$target/storage.tar.gz"
docker exec "$redis" redis-cli SAVE >/dev/null
docker cp "$redis:/data/dump.rdb" "$target/redis.rdb"
chmod 600 "$target"/*
printf '%s\n' "$project" > "$target/project.txt"
(cd "$target" && sha256sum apmail.dump storage.tar.gz redis.rdb secrets.env project.txt > checksums.sha256)
(cd "$target" && sha256sum -c checksums.sha256 >/dev/null)
printf '{"status":"completed","completed_at":"%s","checksum_verified":true,"restored_at":null}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$backup_root/backup-report.json.tmp"
mv "$backup_root/backup-report.json.tmp" "$backup_root/backup-report.json"
if [[ "${APMAIL_BACKUP_LEAVE_STOPPED:-false}" != true ]]; then resume; fi
trap - EXIT
printf 'Backup concluído: %s\n' "$target"
