# widgets_kommo

Widgets de Kommo (dashboard iframes) alojados en el VPS de UNYX.

## Estructura

```text
widgets_kommo/
├── meditec/                          ← widgets de Meditec (dashboard)
│   ├── Tasa de Conversion Cotizacion - Ganada.html   ← widget conversión
│   ├── Ticket Promedio de Ventas Ganadas.html        ← widget ticket promedio
│   └── backup_workflows/             ← flujos n8n (se importan en n8n, no van en la imagen)
│       ├── Kommo Widget - Tasa de Conversion Cotizacion - Ganada.json
│       └── Kommo Widget - Ticket Promedio de Ventas Ganadas.json
├── unyx/
│   ├── duplicados/                   ← widget privado «UNYX · Verificar Cliente»
│   │   ├── manifest.json  script.js  style.css
│   │   ├── i18n/  images/
│   │   ├── index.html  preview.js    ← vista previa local (no se empaquetan)
│   │   └── README.md
│   └── n8n/                          ← backend del widget: 1 par de workflows por cliente
│       ├── clientes.json             ← una entrada por cuenta de Kommo
│       ├── unyx-meditec-verificar-cliente.json
│       ├── unyx-meditec-crear-lead.json
│       ├── code/  build.js  test/
│       └── README.md
├── nginx/default.conf                ← config del nginx del contenedor
├── Dockerfile                        ← nginx:alpine + los widgets
├── docker-compose.yml                ← servicio + labels de Traefik
├── .env.example                      ← plantilla de .env.production
├── infrastructure/scripts/
│   ├── deploy.sh                     ← despliegue en el VPS (widgets del dashboard)
│   ├── build-widget-zip.sh / .ps1    ← empaqueta el widget privado para Kommo
│   └── generate-placeholder-logos.ps1
└── DEPLOYMENT-VPS.md                 ← guía completa para el VPS
```

> `unyx/duplicados/` no se sirve por nginx: es una integración privada que se
> empaqueta en un ZIP y se sube desde Kommo. Su backend son dos workflows de
> n8n en `flow.unyxsolutions.com`, no un contenedor de este repo.
> Ver `unyx/duplicados/README.md` y `unyx/n8n/README.md`.

## URLs de producción

- Conversión: `https://widgets.unyxsolutions.com/meditec/Tasa de Conversion Cotizacion - Ganada.html`
- Ticket promedio: `https://widgets.unyxsolutions.com/meditec/Ticket Promedio de Ventas Ganadas.html`

## Widget privado «UNYX · Verificar Cliente»

No se despliega con `deploy.sh`. Se empaqueta y se sube a Kommo:

```bash
pwsh -File infrastructure/scripts/build-widget-zip.ps1   # genera dist/duplicados.zip
node unyx/n8n/build.js                                   # regenera los workflows
node unyx/n8n/test/logic.test.js                         # 68 comprobaciones sin n8n
```

Los dos workflows de n8n se importan a mano en `flow.unyxsolutions.com` y no
tocan los flujos existentes de Meditec.

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
