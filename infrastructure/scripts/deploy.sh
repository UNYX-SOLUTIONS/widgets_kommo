#!/bin/bash

set -e

# Ruta del proyecto en el VPS (cambiar si se clonó en otro lado)
PROJECT_DIR="/docker/widgets-kommo"
ENV_FILE="$PROJECT_DIR/.env.production"

echo ""
echo "======================================"
echo " UNYX Widgets Kommo - Deploy"
echo "======================================"
echo ""

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE no existe."
    echo "       Cópialo desde la plantilla:  cp .env.example .env.production"
    exit 1
fi

set -a
source "$ENV_FILE"
set +a

NETWORK="${TRAEFIK_NETWORK:-unyx-widgets-front}"

# ==========================================
# 1. ACTUALIZAR REPOSITORIO
# ==========================================

echo "[1/6] Actualizando repositorio..."

cd "$PROJECT_DIR"

git pull origin main || echo "AVISO: git pull falló (continúo con el código local)."

echo ""
echo "Repositorio actualizado."

# ==========================================
# 2. RED DE TRAEFIK
# ==========================================

echo ""
echo "[2/6] Verificando red de Traefik..."

if ! docker network inspect "$NETWORK" > /dev/null 2>&1; then
    echo "Creando red '$NETWORK'..."
    docker network create "$NETWORK"
fi

if [ -n "${TRAEFIK_CONTAINER:-}" ] && docker inspect "$TRAEFIK_CONTAINER" > /dev/null 2>&1; then
    if ! docker network inspect "$NETWORK" --format '{{range .Containers}}{{.Name}} {{end}}' | grep -qw "$TRAEFIK_CONTAINER"; then
        echo "Conectando '$TRAEFIK_CONTAINER' a '$NETWORK'..."
        docker network connect "$NETWORK" "$TRAEFIK_CONTAINER"
    fi
fi

echo "Red lista."

# ==========================================
# 3. VALIDAR DOCKER COMPOSE
# ==========================================

echo ""
echo "[3/6] Validando Docker Compose..."

docker compose --env-file "$ENV_FILE" config > /dev/null

echo "Docker Compose válido."

# ==========================================
# 4. BUILD + DEPLOY
# ==========================================

echo ""
echo "[4/6] Reconstruyendo unyx-widgets..."

docker compose --env-file "$ENV_FILE" up -d --build

echo ""
echo "Contenedor actualizado."

# ==========================================
# 5. LIMPIEZA
# ==========================================

echo ""
echo "[5/6] Limpiando imágenes Docker antiguas..."

docker image prune -f

# ==========================================
# 6. ESTADO
# ==========================================

echo ""
echo "[6/6] Estado final..."
echo ""

docker compose --env-file "$ENV_FILE" ps

echo ""
echo "--------------------------------------"

docker ps \
  --filter "name=unyx-widgets" \
  --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "Widgets disponibles en https://${WIDGETS_DOMAIN}:"
for dir in */; do
    [ -d "$dir" ] || continue
    ls "$dir"/*.html > /dev/null 2>&1 || continue
    echo "  https://${WIDGETS_DOMAIN}/${dir%/}/"
done

echo ""
echo "======================================"
echo " Deploy Widgets Kommo terminado"
echo "======================================"
echo ""
