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
├── unyx-widgets ← nginx: sirve /meditec/…
│   HTTPS: https://widgets.unyxsolutions.com
└── unyx-widgets-api ← Node: API del widget privado
    HTTPS: https://api.widgets.unyxsolutions.com
```

Dos subdominios distintos, cada uno con su router de Traefik. Mantenerlos
separados evita que una URL de la API termine sirviéndose desde nginx (o al
revés) y simplifica el Redirect URI de OAuth.

## Paso 0 — Obtener el código

```bash
git clone <url-del-repo> /docker/widgets-kommo
cd /docker/widgets-kommo
```

**Los widgets HTML de Meditec no necesitan credenciales.** El widget privado
«UNYX · Verificar Cliente» sí: su backend guarda el Secret key de la
integración de Kommo.

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Valores mínimos obligatorios en `backend/.env`:

| Variable | Dónde se consigue |
|---|---|
| `KOMMO_CLIENT_ID` | Kommo → Settings → Integrations → *Keys and scopes* → Integration ID |
| `KOMMO_CLIENT_SECRET` | Kommo → *Generate secret key* (se muestra una sola vez) |
| `KOMMO_SUBDOMAIN` | el subdominio de `https://SUBDOMAIN.kommo.com` |
| `KOMMO_REDIRECT_URI` | `https://api.widgets.unyxsolutions.com/api/kommo/oauth/callback` |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `CHECK_SECRET` | `openssl rand -hex 32` |

`backend/.env` está en `.gitignore`. Sin él, `deploy.sh` se detiene (o
continúa con `ALLOW_MISSING_API_ENV=1` si solo quieres publicar los widgets de
Meditec).

Solo si quieres cambiar los dominios, puertos o red, crea el archivo opcional:

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
| `WIDGETS_DOMAIN` | `widgets.unyxsolutions.com` | dominio de los HTML estáticos |
| `WIDGETS_API_DOMAIN` | `api.widgets.unyxsolutions.com` | dominio de la API |
| `WIDGETS_HTTP_PORT` | `8081` | puerto local de nginx (cambiar si está ocupado) |
| `WIDGETS_API_HTTP_PORT` | `8082` | puerto local del backend |
| `TRAEFIK_NETWORK` | `unyx-widgets-front` | red compartida con Traefik |
| `TRAEFIK_CONTAINER` | `traefik` | nombre del contenedor de Traefik en el VPS |

> Si cambias `WIDGETS_API_DOMAIN`, hay que cambiar también
> `KOMMO_REDIRECT_URI` en `backend/.env` y el valor *URL del backend UNYX* en
> los ajustes del widget.

> `.env.production` está en `.gitignore`: si lo creas, no se versiona.

## Paso 1 — DNS (una sola vez)

Antes de desplegar, crea en el DNS de `unyxsolutions.com` un registro **A**
(o **AAAA**) para `widgets` **y otro para `api.widgets`**, ambos apuntando a la
IP del VPS. Let's Encrypt no emite el certificado sin el registro.

## Paso 2 — Desplegar (un solo comando)

```bash
bash infrastructure/scripts/deploy.sh
```

El script hace todo, en orden:

1. Verifica que exista `backend/.env` (salvo `ALLOW_MISSING_API_ENV=1`).
2. Trae el último código (`git pull`).
3. Crea la red `unyx-widgets-front` si no existe y conecta Traefik si hace falta.
4. Valida el `docker compose config`.
5. Reconstruye y levanta `unyx-widgets` y `unyx-widgets-api`.
6. Limpia imágenes viejas (`docker image prune -f`) y muestra el estado final.

Es idempotente: se puede repetir cuantas veces quieras.

## Paso 3 — Verificar

1. `docker compose --env-file .env.production ps` → `unyx-widgets` y
   `unyx-widgets-api` en `healthy`.
2. `curl -fsS http://127.0.0.1:8081/health` → `ok`.
3. `curl -fsS "https://widgets.unyxsolutions.com/meditec/Ticket Promedio de Ventas Ganadas.html"`
   → devuelve el HTML del widget.
4. Abre esa URL en el navegador: debe verse el widget con su dato.
5. `curl -fsS https://api.widgets.unyxsolutions.com/health` →
   `{"ok":true,...}`. Si responde `404`, el router de Traefik del subdominio
   `api.widgets` no está aplicado: revisa `docker logs traefik` y que exista el
   registro DNS.

## Paso 4 — Registrar los widgets en Kommo

En Kommo (Ajustes → Integraciones / Widgets de dashboard):

- Conversión:
  `https://widgets.unyxsolutions.com/meditec/Tasa de Conversion Cotizacion - Ganada.html`
- Ticket promedio:
  `https://widgets.unyxsolutions.com/meditec/Ticket Promedio de Ventas Ganadas.html`

Cada widget nuevo tendrá su propia URL con el patrón
`https://widgets.unyxsolutions.com/<carpeta>/<nombre>.html`.

### Widget privado «UNYX · Verificar Cliente»

No es un iframe del dashboard: es una integración privada que se sube como ZIP.
El orden importa, porque el backend necesita conocer el Secret key que Kommo
genera al crear la integración:

1. Crear la integración en Kommo (Settings → Integrations → Create
   Integration). **No subir todavía el ZIP.**
2. En *Keys and scopes*: copiar **Integration ID** y **Secret key**, y
   ponerlos en `backend/.env` como `KOMMO_CLIENT_ID` y `KOMMO_CLIENT_SECRET`.
   Configurar el **Redirect URI** exactamente como
   `https://api.widgets.unyxsolutions.com/api/kommo/oauth/callback`.
3. `bash infrastructure/scripts/deploy.sh` y comprobar
   `https://api.widgets.unyxsolutions.com/health`.
4. Empaquetar y subir:
   `bash infrastructure/scripts/build-widget-zip.sh` → `dist/duplicados.zip`
   (el `manifest.json` va en la raíz del archivo, no dentro de una carpeta).
5. En los ajustes del widget, *URL del backend UNYX* =
   `https://api.widgets.unyxsolutions.com`.

Cada asesor abre el widget una vez y pulsa **Autorizar acceso**. Detalle del
paquete y del contrato: `unyx/duplicados/README.md`.

## Agregar o actualizar un widget

1. Widgets del dashboard: edita la carpeta del widget (el `.html` es todo lo
   que se sirve). Si cambiaste la URL del webhook de n8n, con eso basta.
2. Widget privado: edita `unyx/<carpeta>/`, reconstruye el ZIP y vuelve a
   subirlo. Sube siempre `version` en `manifest.json`.
3. Despliega: `bash infrastructure/scripts/deploy.sh`.

Los `.json` de n8n que acompañan cada widget se importan en n8n
(Workflows → Import from File), no se versionan dentro de la imagen.

## Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| El navegador da "certificado inválido" o no carga HTTPS | Falta el registro DNS A de `widgets` o Traefik no conoce el contenedor | Revisa el Paso 1; `docker logs traefik` |
| `502 Bad Gateway` de Traefik | Traefik no está en `unyx-widgets-front` | `bash infrastructure/scripts/deploy.sh` (reconecta solo) |
| `port is already allocated` | El puerto local está ocupado | Cambia `WIDGETS_HTTP_PORT` o `WIDGETS_API_HTTP_PORT` en `.env.production` y redespliega |
| El widget muestra "Error" | El webhook de n8n no responde o la URL del HTML es la de prueba (`webhook-test`) | Revisa `N8N_WEBHOOK_URL` en el HTML y actívalo en n8n (URL sin `-test`) |
| El dato no se actualiza | El widget refresca cada 5 min y el HTML no se cachea; puede ser el dato de n8n | Revisa el flujo de n8n |
| `unyx-widgets-api` reinicia en bucle | Faltan `KOMMO_CLIENT_ID`, `KOMMO_CLIENT_SECRET`, `KOMMO_SUBDOMAIN` o `SESSION_SECRET` en `backend/.env` | `docker compose logs widget-api`; completa el `.env` y redespliega |
| El widget pide "Autorizar acceso" siempre | El callback de OAuth no coincide con `KOMMO_REDIRECT_URI`, o el `state` venció | Compara ambos valores carácter por carácter |
| La API responde 403 a la sesión | `KOMMO_SUBDOMAIN` no es el subdominio de la cuenta del asesor | Corrige el valor (sin `https://` ni `.kommo.com`) |
| El lead creado no tiene teléfono | El campo `PHONE` del contacto no existe o no es `multitext` | Revisa `GET /api/v4/contacts/fields` de la cuenta |
| Se crea un lead y el widget cree que es de otro | La etapa de cierre no coincide con `CLOSED_STAGE_PATTERN` / `CLOSED_STAGE_SORT_MIN` | Ajusta ambos valores en `backend/.env` |

## Operación diaria

```bash
docker compose --env-file .env.production logs -f widgets      # logs del estático
docker compose --env-file .env.production logs -f widget-api   # logs de la API
docker compose --env-file .env.production ps                   # estado
bash infrastructure/scripts/deploy.sh                          # actualizar / redesplegar
```

Actualizar un widget del dashboard = editar el `.html` en git, hacer push y
correr `deploy.sh` (en el VPS).

Lo único que hay que respaldar es el volumen `widgets-api-data`
(`/app/data/tokens.json`): guarda las autorizaciones OAuth de los asesores. Si
se pierde, cada asesor vuelve a pulsar **Autorizar acceso**.
