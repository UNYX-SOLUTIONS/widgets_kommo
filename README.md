# widgets_kommo

Widgets de Kommo (dashboard iframes) alojados en el VPS de UNYX.

## Estructura

```text
widgets_kommo/
├── meditec/                          ← widgets de Meditec
│   ├── Tasa de Conversion Cotizacion - Ganada.html   ← widget conversión
│   ├── Ticket Promedio de Ventas Ganadas.html        ← widget ticket promedio
│   └── backup_workflows/             ← flujos n8n (se importan en n8n, no van en la imagen)
│       ├── Kommo Widget - Tasa de Conversion Cotizacion - Ganada.json
│       └── Kommo Widget - Ticket Promedio de Ventas Ganadas.json
├── nginx/default.conf                ← config del nginx del contenedor
├── Dockerfile                        ← nginx:alpine + los widgets
├── docker-compose.yml                ← servicio + labels de Traefik
├── .env.example                      ← plantilla de .env.production
├── infrastructure/scripts/deploy.sh  ← despliegue en el VPS
└── DEPLOYMENT-VPS.md                 ← guía completa para el VPS
```

## URLs de producción

- Conversión: `https://widgets.unyxsolutions.com/meditec/Tasa de Conversion Cotizacion - Ganada.html`
- Ticket promedio: `https://widgets.unyxsolutions.com/meditec/Ticket Promedio de Ventas Ganadas.html`

## Despliegue en el VPS

```bash
git clone <url-del-repo> /docker/widgets-kommo
cd /docker/widgets-kommo
bash infrastructure/scripts/deploy.sh
```

No necesita `.env` ni credenciales (no hay secretos en este repo). El dominio
viene por defecto; si quieres cambiarlo, `cp .env.example .env.production` y
edítalo.

Ver `DEPLOYMENT-VPS.md` para el detalle completo (DNS, Traefik, n8n, Kommo).

## Pruebas locales

```bash
docker run --rm -p 8081:80 -v "$(pwd):/usr/share/nginx/html:ro" nginx:1.27-alpine
# http://localhost:8081/meditec/Ticket Promedio de Ventas Ganadas.html
```
