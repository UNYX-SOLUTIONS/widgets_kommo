# widgets_kommo

Widgets de Kommo (dashboard iframes e integraciones privadas) alojados en el VPS
de UNYX, más el backend que los necesita cuando tienen que tocar la API de
Kommo.

## Estructura

```text
widgets_kommo/
├── meditec/                          ← widgets de Meditec
│   ├── Tasa de Conversion Cotizacion - Ganada.html   ← widget conversión
│   ├── Ticket Promedio de Ventas Ganadas.html        ← widget ticket promedio
│   └── backup_workflows/             ← flujos n8n (se importan en n8n, no van en la imagen)
│       ├── Kommo Widget - Tasa de Conversion Cotizacion - Ganada.json
│       └── Kommo Widget - Ticket Promedio de Ventas Ganadas.json
├── unyx/
│   └── duplicados/                   ← widget privado «UNYX · Verificar Cliente»
│       ├── manifest.json             ← paquete que se sube a Kommo (ZIP)
│       ├── script.js  style.css
│       ├── i18n/es.json
│       ├── images/                   ← 5 PNG con las medidas de Kommo
│       ├── index.html  preview.js    ← vista previa local (no se empaquetan)
│       └── README.md
├── backend/                          ← API del widget (Node, sin dependencias)
│   ├── src/                          ← OAuth, consulta y creación con revalidación
│   ├── test/smoke.js
│   ├── Dockerfile
│   └── .env.example
├── nginx/default.conf                ← config del nginx del contenedor
├── Dockerfile                        ← nginx:alpine + los widgets
├── docker-compose.yml                ← widgets + widget-api, labels de Traefik
├── .env.example                      ← plantilla de .env.production
├── infrastructure/scripts/
│   ├── deploy.sh                     ← despliegue en el VPS
│   ├── build-widget-zip.sh / .ps1    ← empaqueta el widget para Kommo
│   └── generate-placeholder-logos.ps1
└── DEPLOYMENT-VPS.md                 ← guía completa para el VPS
```

## URLs de producción

- Conversión: `https://widgets.unyxsolutions.com/meditec/Tasa de Conversion Cotizacion - Ganada.html`
- Ticket promedio: `https://widgets.unyxsolutions.com/meditec/Ticket Promedio de Ventas Ganadas.html`
- API del widget UNYX: `https://api.widgets.unyxsolutions.com/api/…`

Dos dominios, un mismo certificado de Traefik. Ambos registros DNS deben
existir antes del primer despliegue.

## Despliegue en el VPS

```bash
git clone <url-del-repo> /docker/widgets-kommo
cd /docker/widgets-kommo
cp backend/.env.example backend/.env   # solo si se despliega el widget privado
nano backend/.env
bash infrastructure/scripts/deploy.sh
```

Los widgets HTML de Meditec no necesitan credenciales. El backend del widget
privado sí: `backend/.env` contiene el Secret key de la integración de Kommo y
está en `.gitignore`. `deploy.sh` se detiene si ese archivo no existe.

Ver `DEPLOYMENT-VPS.md` para el detalle completo (DNS, Traefik, n8n, Kommo).

## Pruebas locales

```bash
docker run --rm -p 8081:80 -v "$(pwd):/usr/share/nginx/html:ro" nginx:1.27-alpine
# http://localhost:8081/meditec/Ticket Promedio de Ventas Ganadas.html

cd backend && npm test     # lógica del widget sin tocar Kommo
```
