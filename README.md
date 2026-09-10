# widgets_kommo

Widgets de Kommo (dashboard iframes) alojados en el VPS de UNYX.

## Estructura

```text
widgets_kommo/
├── lead_cotizacion_ganada/          ← un widget de Kommo
│   ├── lead_cotizacion_ganada_widget.html   ← el widget (iframe de Kommo)
│   ├── test_widget_es.html                  ← página de prueba en local
│   └── Kommo Widget - ... .json             ← flujo n8n (se importa en n8n)
├── nginx/default.conf                ← config del nginx del contenedor
├── Dockerfile                        ← nginx:alpine + los widgets
├── docker-compose.yml                ← servicio + labels de Traefik
├── .env.example                      ← plantilla de .env.production
├── infrastructure/scripts/deploy.sh  ← despliegue en el VPS
└── DEPLOYMENT-VPS.md                 ← guía completa para el VPS
```

## URLs

Producción: `https://widgets.unyxsolutions.com/<carpeta>/<archivo>.html`

## Despliegue

```bash
cp .env.example .env.production   # solo en el VPS
bash infrastructure/scripts/deploy.sh
```

Ver `DEPLOYMENT-VPS.md` para el detalle completo (DNS, Traefik, Kommo).

## Pruebas locales

Abrir directamente `test_widget_es.html` en el navegador, o servir la carpeta:

```bash
docker run --rm -p 8081:80 -v "$(pwd):/usr/share/nginx/html:ro" nginx:1.27-alpine
# http://localhost:8081/lead_cotizacion_ganada/lead_cotizacion_ganada_widget.html
```
