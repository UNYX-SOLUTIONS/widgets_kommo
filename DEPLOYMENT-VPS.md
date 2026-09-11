# Despliegue en el VPS — Widgets Kommo (guía de UNYX)

Esta guía es para desplegar los widgets de Kommo en el VPS central de la
empresa. Solo necesitas **Docker y bash** en el VPS (no hace falta Node: todo
corre dentro de un contenedor nginx).

## Qué es esto

Cada carpeta de este repo es un widget de Kommo (HTML estático que Kommo
muestra dentro de un iframe del Dashboard). El contenedor solo sirve esos
archivos por HTTPS; los datos los calcula n8n (los flujos `.json` de cada
carpeta se importan en n8n, no van en la imagen).

```text
VPS Global
├── traefik (HTTPS + Let's Encrypt, ya existente)
├── unyx-widgets-front (red Docker externa compartida con Traefik)
└── unyx-widgets ← nginx: sirve /meditec/…
                    HTTPS: https://widgets.unyxsolutions.com
```

## Paso 0 — Obtener el código

```bash
git clone <url-del-repo> /docker/widgets-kommo
cd /docker/widgets-kommo
```

**No hace falta ningún `.env` ni credenciales**: este proyecto no tiene
secretos (los webhooks/tokens viven en los HTML y en n8n). El dominio ya viene
por defecto (`widgets.unyxsolutions.com`) en el `docker-compose.yml`.

Solo si quieres cambiar el dominio, puerto o red, crea el archivo opcional:

```bash
cp .env.example .env.production
nano .env.production      # sobrescribir lo necesario
```

> Si clonas en otra ruta, cambia `PROJECT_DIR` al inicio de
> `infrastructure/scripts/deploy.sh`.

Variables de `.env.production` (todas opcionales, solo para sobrescribir los
valores por defecto):

| Variable | Valor por defecto | Qué poner |
|---|---|---|
| `WIDGETS_DOMAIN` | `widgets.unyxsolutions.com` | el dominio del widget |
| `WIDGETS_HTTP_PORT` | `8081` | puerto local en el VPS (cambiar si está ocupado) |
| `TRAEFIK_NETWORK` | `unyx-widgets-front` | red compartida con Traefik |
| `TRAEFIK_CONTAINER` | `traefik` | nombre del contenedor de Traefik en el VPS |

> `.env.production` está en `.gitignore`: si lo creas, no se versiona.

## Paso 1 — DNS (una sola vez)

Antes de desplegar, crea en el DNS de `unyxsolutions.com` un registro **A**
(o **AAAA**) para `widgets` que apunte a la IP del VPS. Let's Encrypt no emite
el certificado sin ese registro.

## Paso 2 — Desplegar (un solo comando)

```bash
bash infrastructure/scripts/deploy.sh
```

El script hace todo, en orden:

1. Trae el último código (`git pull`).
2. Crea la red `unyx-widgets-front` si no existe y conecta Traefik si hace falta.
3. Valida el `docker compose config`.
4. Reconstruye y levanta `unyx-widgets` (`up -d --build`).
5. Limpia imágenes viejas (`docker image prune -f`).
6. Muestra el estado final y las URLs de los widgets.

Es idempotente: se puede repetir cuantas veces quieras.

## Paso 3 — Verificar

1. `docker compose --env-file .env.production ps` → `unyx-widgets` `healthy`.
2. `curl -fsS http://127.0.0.1:8081/health` → `ok`.
3. `curl -fsS "https://widgets.unyxsolutions.com/meditec/Ticket Promedio de Ventas Ganadas.html"`
   → devuelve el HTML del widget.
4. Abre esa URL en el navegador: debe verse el widget con su dato.

## Paso 4 — Registrar los widgets en Kommo

En Kommo (Ajustes → Integraciones / Widgets de dashboard):

- Conversión:
  `https://widgets.unyxsolutions.com/meditec/Tasa de Conversion Cotizacion - Ganada.html`
- Ticket promedio:
  `https://widgets.unyxsolutions.com/meditec/Ticket Promedio de Ventas Ganadas.html`

Cada widget nuevo tendrá su propia URL con el patrón
`https://widgets.unyxsolutions.com/<carpeta>/<nombre>.html`.

## Agregar o actualizar un widget

1. Crea/edita la carpeta del widget (el `.html` es todo lo que se sirve).
2. Si cambiaste la URL del webhook de n8n dentro del HTML, con eso basta.
3. Despliega: `bash infrastructure/scripts/deploy.sh`.

Los `.json` de n8n que acompañan cada widget se importan en n8n
(Workflows → Import from File), no se versionan dentro de la imagen.

## Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| El navegador da "certificado inválido" o no carga HTTPS | Falta el registro DNS A de `widgets` o Traefik no conoce el contenedor | Revisa el Paso 1; `docker logs traefik` |
| `502 Bad Gateway` de Traefik | Traefik no está en `unyx-widgets-front` | `bash infrastructure/scripts/deploy.sh` (reconecta solo) |
| `port is already allocated` | El puerto local está ocupado | Cambia `WIDGETS_HTTP_PORT` en `.env.production` y redespliega |
| El widget muestra "Error" | El webhook de n8n no responde o la URL del HTML es la de prueba (`webhook-test`) | Revisa `N8N_WEBHOOK_URL` en el HTML y actívalo en n8n (URL sin `-test`) |
| El dato no se actualiza | El widget refresca cada 5 min y el HTML no se cachea; puede ser el dato de n8n | Revisa el flujo de n8n |

## Operación diaria

```bash
docker compose --env-file .env.production logs -f widgets   # logs en vivo
docker compose --env-file .env.production ps                # estado
bash infrastructure/scripts/deploy.sh                       # actualizar / redesplegar
```

Actualizar un widget en el VPS = editar el `.html` en git, hacer push y
correr `deploy.sh` (en el VPS). No hay bases de datos ni backups que mantener.
