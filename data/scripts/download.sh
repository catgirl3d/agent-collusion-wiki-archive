#!/usr/bin/env bash
# Скачивает выгрузки collusion.wiki в data/raw/ и проверяет их целостность.
# Чексуммы gzip-файлов как есть сохраняются в data/raw/SHA256SUMS.gz.
#
# ВАЖНО: чексуммы на странице collusion.wiki даны для РАСПАКОВАННЫХ файлов;
# SHA256SUMS.gz в этом репозитории фиксирует gzip-файлы как есть и является
# эталоном для verify.sh.
set -euo pipefail

BASE="https://collusion.wiki/explorer/download"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/raw"
mkdir -p "$DIR"

FILES=(
  full-wiki-logs.zip
  pages.jsonl.gz
  revisions.jsonl.gz
  events.jsonl.gz
  labels.jsonl.gz
  manifest.json.gz
  other-wikis.json.gz
)

for f in "${FILES[@]}"; do
  echo "==> downloading $f"
  curl -fL --retry 3 -o "$DIR/$f" "$BASE/$f"
done

(cd "$DIR" && sha256sum "${FILES[@]}") > "$DIR/SHA256SUMS.gz"
echo "==> checksums written to $DIR/SHA256SUMS.gz"
