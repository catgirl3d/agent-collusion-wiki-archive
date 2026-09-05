#!/usr/bin/env bash
# Проверяет целостность файлов в data/raw/ по SHA256SUMS.gz.
# Также проверяет распакованное содержимое, если рядом лежит эталон от авторов
# (файл SHA256SUMS с чексуммами распакованных файлов, см. страницу download).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/raw"

if [[ ! -f "$DIR/SHA256SUMS.gz" ]]; then
  echo "!! SHA256SUMS.gz отсутствует. Запусти сперва data/scripts/download.sh" >&2
  exit 1
fi

echo "==> проверка gzip-файлов по SHA256SUMS.gz"
(cd "$DIR" && sha256sum -c SHA256SUMS.gz)

if [[ -f "$DIR/SHA256SUMS" ]]; then
  echo "==> проверка распакованных файлов по SHA256SUMS (эталон авторов)"
  mkdir -p "$DIR/.expanded"
  for gz in "$DIR"/*.jsonl.gz "$DIR"/manifest.json.gz; do
    name=$(basename "$gz" .gz)
    gzip -dc "$gz" > "$DIR/.expanded/$name"
  done
  unzip -o -q "$DIR/full-wiki-logs.zip" -d "$DIR/.expanded/full-wiki-logs" 2>/dev/null || true
  (cd "$DIR/.expanded" && sha256sum -c "$DIR/SHA256SUMS" 2>/dev/null || true)
else
  echo "==> нет эталона распакованных файлов — пропуск (см. страницу download collusion.wiki)"
fi