#!/bin/bash
# Empaqueta el widget de Kommo en un ZIP con manifest.json en la RAÍZ.
# Kommo rechaza el archivo si el manifest queda dentro de una carpeta.
# Los archivos de vista previa (index.html, preview.js, README.md) NO entran.
#
# Uso: bash infrastructure/scripts/build-widget-zip.sh [carpeta-del-widget]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
SOURCE_DIR="${1:-$PROJECT_DIR/unyx/duplicados}"
WIDGET_NAME="$(basename "$SOURCE_DIR")"
OUTPUT="$PROJECT_DIR/dist/$WIDGET_NAME.zip"

[ -f "$SOURCE_DIR/manifest.json" ] || { echo "ERROR: no existe $SOURCE_DIR/manifest.json"; exit 1; }

mkdir -p "$PROJECT_DIR/dist"
rm -f "$OUTPUT"

cd "$SOURCE_DIR"
zip -r -X "$OUTPUT" manifest.json script.js style.css i18n images > /dev/null

echo "ZIP generado: $OUTPUT"
echo "Contenido:"
unzip -l "$OUTPUT" | sed 's/^/  /'
echo ""
echo "Siguiente paso: Settings -> Integrations -> Create Integration -> Upload en Kommo."
