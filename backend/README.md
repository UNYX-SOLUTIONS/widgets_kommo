# Backend UNYX — widget de Kommo «Verificar Cliente»

Servicio Node.js **sin dependencias externas** que hace de puente entre el
widget privado de Kommo y la API v4 de Kommo. Es el único lugar donde vive el
Secret key de la integración.

## Modelo de seguridad

1. **OAuth por asesor, no token global.** Cada usuario autoriza por separado
   (`https://www.kommo.com/oauth`). El backend guarda `access_token`,
   `refresh_token` y caducidad por asesor en `TOKEN_FILE` (modo 600) y refresca
   solo cuando hace falta. Consecuencia: una consulta o una creación se hacen
   **con los permisos del asesor que la pidió**, no con permisos de
   administrador.
2. **Identidad verificada, no declarada.** El widget envía `account` y
   `userId` tomados de `self.system()`, pero el backend no se los cree: exige un
   `sessionToken` firmado con HMAC-SHA256 (`SESSION_SECRET`) que solo emite si
   existe un token OAuth válido para esa cuenta y ese usuario. El `KOMMO_SUBDOMAIN`
   está fijado en el entorno y cualquier otra cuenta se rechaza con 403.
3. **`checkId` de un solo uso.** La respuesta de la verificación incluye un
   token firmado (`CHECK_SECRET`, 5 min por defecto) que ata cuenta + asesor +
   teléfono + resultado. `POST /api/kommo/leads` lo exige y lo valida: no se
   puede crear un lead reutilizando una verificación ajena o manipulada.
4. **Revalidación antes de crear.** Aunque el `checkId` sea válido, el backend
   vuelve a consultar contactos y leads con el token del asesor justo antes de
   crear, dentro de un lock por `cuenta + teléfono`. Si en ese momento hay una
   atención activa, devuelve `409` y no crea nada.
5. **Sin secretos en el widget.** El ZIP que sube el asesor no contiene ni el
   Secret key ni tokens. La API vive además en su propio subdominio
   (`api.widgets.unyxsolutions.com`), enrutado por Traefik a este contenedor;
   nginx devuelve 404 en `/api` y `/backend` por si alguien los enruta allí.

Riesgo residual asumido: un asesor con las herramientas de desarrollo del
navegador puede llamar al backend imitando a otro asesor que ya haya
autorizado. Se mitiga con los logs del contenedor. Para cerrarlo del todo hace
falta un proxy de identidad de Kommo, que no está disponible en integraciones
privadas.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/health` | estado del servicio |
| `GET` | `/api/kommo/oauth/callback` | callback de Kommo, intercambia el código y guarda el token |
| `POST` | `/api/kommo/session` | ¿hay sesión? devuelve `sessionToken` o `authUrl` |
| `POST` | `/api/kommo/client-check` | busca el contacto, sus leads y devuelve el estado |
| `POST` | `/api/kommo/leads` | revalida y crea el lead reutilizando el contacto |

Los cuerpos se aceptan en JSON o `application/x-www-form-urlencoded`, porque
`self.crm_post` de Kommo envía el segundo.

## Endpoint de Kommo que se usa

- `GET /oauth2/access_token` (authorization_code y refresh_token)
- `GET /api/v4/contacts?query=<tel>&with=leads` + filtro exacto por dígitos
- `GET /api/v4/leads?filter[id][]=…` — los leads del contacto
- `GET /api/v4/leads/pipelines` y `/api/v4/leads/pipelines/{id}/statuses`
- `GET /api/v4/users` — nombres de asesores (si el token no es admin, degrada)
- `POST /api/v4/contacts`, `POST /api/v4/leads`

## Qué cuenta como «atención activa»

Un lead del contacto está **cerrado** si su `closed_at` no es nulo, si el
`sort` de su etapa es `>= CLOSED_STAGE_SORT_MIN` (Kommo marca las etapas de
cierre a partir de 10000) o si el nombre de la etapa casa con
`CLOSED_STAGE_PATTERN`. Con los valores por defecto
(`(cerrad|closed|ganad|perdid|won|lost)`) se cubren los nombres habituales.

Conviene ajustar `CLOSED_STAGE_PATTERN` a los nombres reales de las etapas de
la cuenta.

## Configuración

Copiar `backend/.env.example` a `backend/.env` y completar:

```bash
cp backend/.env.example backend/.env
openssl rand -hex 32   # para SESSION_SECRET y CHECK_SECRET
```

| Variable | Obligatoria | Descripción |
|---|---|---|
| `KOMMO_CLIENT_ID` | sí | Integration ID de la integración privada |
| `KOMMO_CLIENT_SECRET` | sí | Secret key (solo se muestra una vez) |
| `KOMMO_SUBDOMAIN` | sí | subdominio de la cuenta; el resto se rechaza |
| `KOMMO_REDIRECT_URI` | sí | idéntico al Redirect URI de Kommo || `SESSION_SECRET` | sí | firma sesiones y `state` de OAuth |
| `CHECK_SECRET` | recomendada | firma los `checkId` |
| `TOKEN_FILE` | no | ruta del almacén de tokens (volumen persistente) |
| `CORS_ORIGINS` | no | por defecto `https://*.kommo.com` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | no | 60 peticiones / 60 s por IP |
| `CLOSED_STAGE_SORT_MIN` / `CLOSED_STAGE_PATTERN` | no | regla de lead activo |
| `LEAD_PIPELINE_ID` / `LEAD_STATUS_ID` | no | 0 = primera etapa del pipeline principal |
| `LEAD_SOURCE_EXTERNAL_ID` | no | `external_id` de una fuente del widget |
| `LEAD_NAME_TEMPLATE` | no | `{name}` y `{phone}` |

Con `NODE_ENV=production` el servicio **no arranca** si falta `KOMMO_CLIENT_ID`,
`KOMMO_CLIENT_SECRET`, `KOMMO_SUBDOMAIN` o `SESSION_SECRET`.

## Desarrollo local

```bash
cd backend
cp .env.example .env
npm test          # 22 comprobaciones con un doble de prueba de Kommo
npm start         # escucha en $PORT (3000 por defecto)
```

Los tests no salen a internet: sustituyen el cliente de Kommo por un doble en
memoria y cubren los cinco estados, la reutilización de contacto, el rechazo de
`checkId` manipulados y la revalidación anti-carrera.

## Despliegue

Lo hace `docker-compose.yml` (servicio `widget-api`) detrás de Traefik:
`Host(api.widgets.unyxsolutions.com)` → puerto 3000 del contenedor. Los tokens
viven en el volumen `widgets-api-data`.

```bash
bash infrastructure/scripts/deploy.sh
curl -fsS https://api.widgets.unyxsolutions.com/health
```

## Operación

```bash
docker compose logs -f widget-api
docker compose exec widget-api ls -l /app/data
```

Si se pierde el volumen hay que volver a autorizar; los refresh tokens de Kommo
duran 3 meses como máximo.
