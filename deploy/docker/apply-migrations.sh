#!/bin/sh
# ==============================================================================
# ServiceDesk - Automatic Database Migration Runner
# ==============================================================================
set -e

echo "======================================================================"
echo "  SERVICEDESK - EXECUTOR AUTOMÁTICO DE MIGRATIONS"
echo "======================================================================"
echo "Host:     $PGHOST"
echo "Porta:    $PGPORT"
echo "Usuário:  $PGUSER"
echo "Banco:    $PGDATABASE"
echo "======================================================================"

echo ">> Aguardando disponibilidade do PostgreSQL..."
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE"; do
  sleep 1
done

echo ">> PostgreSQL está pronto. Carregando migrations de /migrations..."

# Ordena os arquivos numericamente pelo prefixo numérico antes do sublinhado
MIGRATIONS=$(ls -1 /migrations/*.sql | sed 's/.*\///' | awk -F'_' '{n=$1; sub(/^0+/,"",n); if(n=="") n=0; printf "%04d %s\n", n, $0}' | sort -n | cut -d' ' -f2-)

for file in $MIGRATIONS; do
  echo ">> [MIGRATION] Aplicando: $file"
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f "/migrations/$file"
done

echo "======================================================================"
echo "  [OK] Todas as migrations foram aplicadas com sucesso!"
echo "======================================================================"
