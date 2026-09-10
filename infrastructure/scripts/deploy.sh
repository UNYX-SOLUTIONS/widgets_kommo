#!/usr/bin/env bash

set -euo pipefail

# Ruta del repo: se calcula sola desde la ubicación de este script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
ENV_FILE="$PROJECT_DIR/.env.production"

cd "$PROJECT_DIR"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE not found."
    echo "       Create it from the template:  cp .env.example .env.production"
    exit 1
fi

set -a
source "$ENV_FILE"
set +a

NETWORK="${TRAEFIK_NETWORK:-unyx-widgets-front}"
PORT="${WIDGETS_HTTP_PORT:-8081}"

echo "========================================"
echo "UNYX Widgets Kommo - Deployment"
echo "========================================"

echo ""
echo "[1/6] Checking Traefik network '$NETWORK'..."

if docker network inspect "$NETWORK" > /dev/null 2>&1; then
    echo "Network OK."
else
    echo "Network does not exist. Creating it..."
    docker network create "$NETWORK"
    echo "Network created."
fi

if [ -n "${TRAEFIK_CONTAINER:-}" ]; then
    if docker inspect "$TRAEFIK_CONTAINER" > /dev/null 2>&1; then
        if ! docker network inspect "$NETWORK" --format '{{range .Containers}}{{.Name}} {{end}}' | grep -qw "$TRAEFIK_CONTAINER"; then
            echo "Connecting container '$TRAEFIK_CONTAINER' to '$NETWORK'..."
            docker network connect "$NETWORK" "$TRAEFIK_CONTAINER"
        fi
    else
        echo "WARNING: Traefik container '$TRAEFIK_CONTAINER' not found."
        echo "         Traefik must be connected to '$NETWORK' to route HTTPS."
    fi
fi

echo ""
echo "[2/6] Pulling latest code..."

git pull --ff-only origin main || echo "WARNING: git pull failed (continue with local code)."

echo ""
echo "[3/6] Validating Docker Compose..."

docker compose --env-file "$ENV_FILE" config > /dev/null
echo "Docker Compose configuration is valid."

echo ""
echo "[4/6] Building image..."

docker compose --env-file "$ENV_FILE" build

echo ""
echo "[5/6] Starting service..."

docker compose --env-file "$ENV_FILE" up -d

echo ""
echo "[6/6] Checking service status..."

sleep 3
docker compose --env-file "$ENV_FILE" ps

echo ""
echo "Checking health endpoint..."

if curl -fsS "http://127.0.0.1:$PORT/health" > /dev/null; then
    echo "Health: OK"
else
    echo "WARNING: health check failed."
    echo "Check logs with: docker logs unyx-widgets"
fi

echo ""
echo "========================================"
echo "Deployment completed"
echo "========================================"
echo ""
echo "Widgets available at https://${WIDGETS_DOMAIN}:"
for dir in */; do
    [ -d "$dir" ] || continue
    echo "  https://${WIDGETS_DOMAIN}/${dir%/}/"
done
echo ""
