# Workflows de n8n — UNYX · Verificar Cliente

Backend del widget privado, **general para todos los clientes**. No hay un
workflow por cliente: hay **dos workflows** que atienden a Altosa, Meditec,
LuxViajes y los que se sumen. El cliente se decide por el **token** que envía el
widget.

| Archivo | Webhook | Qué hace |
|---|---|---|
| `unyx-verificar-cliente.json` | `POST /webhook/unyx/verificar-cliente` | Busca el contacto por teléfono, revisa sus leads y devuelve el estado. |
| `unyx-crear-lead.json` | `POST /webhook/unyx/crear-lead` | **Re-valida** y crea el lead reutilizando el contacto. |

- Host: `https://flow.unyxsolutions.com`
- **No se usan credenciales de n8n.** El token de larga duración de cada cliente
  se lee de una variable de entorno y se manda en la cabecera `Authorization`.
- Los dos workflows son los mismos para todos los clientes: la única diferencia
  entre clientes vive en el entorno de n8n.

No se toca ni se reimporta ningún workflow existente
(`kommo-widget-conversion`, `kommo-widget-ticket-promedio`, `kommo-cobranzas-*`).

---

# 1. Los dos tokens

Cada cliente necesita **dos** valores distintos. Ninguno se guarda en este
repositorio: aquí solo van los **nombres** de las variables (`clientes.json`).

| Token | Qué es | Quién lo genera | Dónde vive |
|---|---|---|---|
| **Token del widget** (`UNYX_SECRET_<CLIENTE>`) | La llave que usa el widget para identificarse y decir de qué cliente es. Es una barrera de acceso compartida. | **Lo generas tú** (UNYX) con el comando de abajo. | Variable de entorno de n8n + ajuste *Token de acceso* del widget en Kommo |
| **Token de Kommo** (`KOMMO_TOKEN_<CLIENTE>`) | El token de larga duración de la integración privada de ese cliente. Es el que permite leer y escribir en su CRM. | **Lo genera Kommo** al crear la integración privada (pestaña *Claves y ámbitos*). | Variable de entorno de n8n |

## Cómo generar el token del widget

**Lo generas tú, no lo genero yo.** No hay ningún valor escrito en el código: si
no lo defines en n8n, el workflow deniega todo.

Un token por cliente, y distinto para cada uno: es lo que le dice al workflow en
qué cuenta de Kommo debe trabajar. Si dos clientes compartieran token, el
workflow no podría distinguirlos.

### Windows (PowerShell 7)

```powershell
[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

Devuelve 64 caracteres hexadecimales, por ejemplo:

```
31d89c2613d73dd09dc14ec64011dce2eb0fd0dd967e1af0aa35416a223f8a1a
```

Ejecútalo una vez por cliente.

### Linux / macOS

```bash
openssl rand -hex 32
```

> En la máquina Windows de UNYX `openssl` no está en el PATH: usa el comando de
> PowerShell.

### Reglas

- **64 caracteres o más**, aleatorio. No uses algo escribible a mano.
- **Uno por cliente.** No reutilices el mismo entre Altosa y Meditec.
- El mismo valor va en **dos sitios**: la variable de entorno de n8n y el ajuste
  *Token de acceso del widget* en Kommo. Deben coincidir exactamente (el
  workflow compara con `===`, distingue mayúsculas y no recorta espacios).
- Si se filtra, se cambia en los dos sitios y listo: no hay que tocar código ni
  reimportar workflows.

## Cómo obtener el token de Kommo

Es el **token de larga duración** de la integración privada, no el `client_id`
ni el `secret_key`:

1. En Kommo, como administrador: **Ajustes → Centro de integraciones**, abrir la
   integración del cliente.
2. Pestaña **Claves y ámbitos** → **token de larga duración**. Si no aparece,
   generarlo ahí mismo.
3. Ese valor va en la variable `KOMMO_TOKEN_<CLIENTE>`.

> La documentación de Kommo es explícita: si vas a usar un token de larga
> duración, **no escribas nada en el campo "URL de redireccionamiento"** al
> crear la integración.

---

# 2. Cómo funciona la selección de cliente

El primer nodo de cada workflow es **`Resolver Cliente`**. No es un nodo *Switch*
de n8n a propósito: el *Switch* v3, si el fallback no está bien configurado,
**descarta en silencio** las peticiones que no casan ninguna regla, y el widget
se quedaría esperando hasta el timeout. El nodo Code resuelve todos los casos de
forma explícita y está cubierto por pruebas.

Qué hace, en orden:

1. Compara el `token` que envía el widget contra el token de cada cliente
   (`$env.UNYX_SECRET_<CLIENTE>`).
   Si no coincide con ninguno → `ok:false` «Acceso no autorizado».
   Si las variables de entorno no existen → tampoco coincide nada (falla cerrado).
2. Comprueba que la cuenta que envía el widget (`account`, que el widget toma de
   `self.system().subdomain`) sea la del cliente de ese token.
   Si no → `ok:false`. Así el token de Altosa no puede operar en la cuenta de
   Meditec aunque se equivoquen al configurar el widget.
3. Comprueba que exista el token de Kommo de ese cliente.
   Si falta → `ok:false` diciendo qué cliente está sin configurar.
4. Devuelve la configuración resuelta (nombre, subdominio, token de Kommo y
   pipelines excluidos) para el resto de la cadena.

El siguiente nodo, `¿Autorizado?`, manda las peticiones rechazadas directamente
al respondedor: **nunca se toca la API de Kommo con una petición no autorizada.**

La lista de clientes vive en `unyx/n8n/clientes.json` y `build.js` la incrusta en
ese nodo como referencias a variables de entorno:

```js
{ nombre: "Altosa", subdominio: "altosa", secreto: $env.UNYX_SECRET_ALTOSA,
  kommoToken: $env.KOMMO_TOKEN_ALTOSA, pipelinesExcluidos: [] },
```

---

# 3. Configurar las variables de entorno en n8n

n8n lee las variables del entorno del proceso, así que hay que añadirlas al
contenedor y **reiniciar n8n**. Con Docker Compose:

```yaml
services:
  n8n:
    environment:
      # Token del widget: lo generas tú, uno por cliente
      - UNYX_SECRET_ALTOSA=<64 hex>
      - UNYX_SECRET_MEDITEC=<64 hex>
      - UNYX_SECRET_LUXVIAJES=<64 hex>
      # Token de larga duración de Kommo: uno por cliente
      - KOMMO_TOKEN_ALTOSA=<token de Kommo de Altosa>
      - KOMMO_TOKEN_MEDITEC=<token de Kommo de Meditec>
      - KOMMO_TOKEN_LUXVIAJES=<token de Kommo de LuxViajes>
```

Luego:

```bash
docker compose up -d n8n     # recrea el contenedor con las variables
docker compose logs -f n8n   # confirmar que arranca sin quejarse
```

Comprobaciones importantes:

- Si n8n tiene `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, los nodos **no** pueden leer
  `$env` y el workflow denegará todo. Hay que quitarlo.
- Las variables se leen al arrancar: **cambiar una exige reiniciar n8n**.
- En n8n Cloud no se pueden definir variables de entorno; este diseño es para
  n8n autoalojado (que es el caso de `flow.unyxsolutions.com`).

## Lo que hay que saber de este diseño

- El token del widget viaja en el cuerpo de cada petición y el de Kommo en la
  cabecera. **n8n guarda los datos de cada ejecución**, así que ambos quedan en
  el historial de ejecuciones. Cualquiera con acceso a ese historial puede
  leerlos. Es el precio de tener un workflow único para todos los clientes.
- La alternativa (una credencial de n8n por cliente) redacta los tokens en los
  logs, pero obliga a repetir la cadena de nodos por cliente. Si en algún
  momento pesa más la confidencialidad que el mantenimiento, se cambia.
- El token del widget es una **barrera de acceso compartida**, no autenticación
  por usuario: un asesor con las herramientas de desarrollo abiertas puede verlo.
  Lo que evita es que cualquiera en internet, sin token, enumere contactos por
  teléfono o cree leads en la cuenta.

---

# 4. Regla de «atención activa»: solo `closed_at`

Un lead del contacto está **activo** si no tiene `closed_at`. Kommo lo marca al
cerrar el lead (ganado o perdido) y lo limpia si se reabre, así que no hace
falta consultar pipelines ni etapas.

| | Etapas (`sort >= 10000`, id fijo, nombre) | `closed_at` |
|---|---|---|
| Llamadas extra a la API | 2 por consulta | 0 |
| Configuración por cliente | averiguar pipelines y etapas | ninguna |
| Si renombran o crean una etapa | se rompe en silencio | no afecta |
| Funciona en cualquier cuenta | no | sí |

> ⚠️ Supuesto de proceso: para que un cliente no bloquee la creación, sus leads
> tienen que estar **cerrados de verdad en Kommo** (movidos a una etapa de
> ganado o perdido). Si el equipo deja leads viejos en etapas abiertas, seguirán
> contando como atención activa — que es lo correcto, pero conviene saberlo.

`pipelinesExcluidos` permite excluir pipelines completos de la regla, por
cliente. LuxViajes excluye los mismos cuatro pipelines que su flujo de avisos de
duplicados (`13416240, 13629516, 13629520, 13680940`). **Revisar con el cliente**
si el widget debe compartir ese criterio o ser más estricto.

Estados que devuelve la consulta: `available`, `same_agent`, `other_agent`,
`multiple_leads`.

---

# 5. Instalación

1. Definir **las 6 variables de entorno** (3 clientes × 2 tokens) y reiniciar n8n.
   Si falta alguna, ese cliente recibe «Acceso no autorizado» o «Falta el token
   de Kommo» en lugar de funcionar.
2. n8n → **Workflows → Import from File** → `unyx-verificar-cliente.json`.
3. Repetir con `unyx-crear-lead.json`.
4. **Activar** los dos: el webhook de producción solo existe con el workflow
   activo. El widget usa `/webhook/…`, no `/webhook-test/…`.
5. Probar (con el token real de un cliente):

   ```bash
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx/verificar-cliente \
     -H 'content-type: application/json' \
     -d '{"phone":"991234567","account":"altosa","userId":77,"token":"<UNYX_SECRET_ALTOSA>"}'
   ```

   Debe responder `{"ok":true,"state":…,"contactName":…}`.

   Pruebas negativas que conviene hacer una vez:

   ```bash
   # sin token -> Acceso no autorizado
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx/verificar-cliente \
     -H 'content-type: application/json' -d '{"phone":"991234567","account":"altosa"}'

   # token de un cliente en la cuenta de otro -> rechazado
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx/verificar-cliente \
     -H 'content-type: application/json' \
     -d '{"phone":"991234567","account":"meditecec","token":"<UNYX_SECRET_ALTOSA>"}'
   ```

   Si responde `{"code":404,"message":"webhook not registered"}`, el workflow no
   está activo o la ruta no coincide.

6. En Kommo, al instalar el widget, poner en los ajustes:
   - *URL de los webhooks de n8n*: `https://flow.unyxsolutions.com/webhook/unyx`
     (**igual para todos los clientes**)
   - *Token de acceso del widget*: el `UNYX_SECRET_<CLIENTE>` de esa cuenta.

## Actualizar un workflow ya desplegado

Los JSON se generan con `"active": false`, así que reimportar **no** actualiza el
que está en producción: crea uno nuevo y puede dejar dos workflows compitiendo
por la misma ruta, o el viejo activo sirviendo código anterior.

1. En n8n, **desactivar** el workflow viejo (deja de responder el webhook).
2. Reimportar el JSON regenerado.
3. **Activar** el nuevo y ejecutar un `curl` de humo de los dos webhooks.
4. Borrar el workflow viejo.

Los ajustes manuales en n8n (concurrencia = 1, por ejemplo) no viven en el
repositorio y se pierden al reimportar: hay que repetirlos.

---

# 6. Agregar un cliente

1. Crear la integración privada en la cuenta de Kommo de ese cliente
   (Ajustes → Centro de integraciones → Crear integración). **Dejar vacía la URL
   de redireccionamiento.**
2. Obtener su **token de larga duración** (pestaña *Claves y ámbitos*).
3. Generar su **token de widget** (comando de PowerShell de arriba).
4. Añadir las dos variables al entorno de n8n y reiniciar.
5. Agregar la entrada en `unyx/n8n/clientes.json`:

   ```json
   {
     "slug": "altosa",
     "nombre": "Altosa",
     "subdominio": "altosa",
     "secretoEnv": "UNYX_SECRET_ALTOSA",
     "kommoEnv": "KOMMO_TOKEN_ALTOSA",
     "pipelinesExcluidos": []
   }
   ```

   - `subdominio`: lo que va antes de `.kommo.com`.
   - `pipelinesExcluidos`: pipelines que **no** cuentan como atención activa.

6. `node unyx/n8n/build.js` → regenera **los dos** workflows (son los mismos para
   todos, ahora con el cliente nuevo dentro).
7. Reimportar los dos en n8n siguiendo el procedimiento de actualización de
   arriba **una sola vez**, sin importar cuántos clientes haya.
8. Instalar el widget en esa cuenta con su *URL de los webhooks* y su *token*.

---

# 7. Límites y coste por consulta

| Operación | Llamadas a Kommo |
|---|---|
| Verificación | 3 × `contacts` + 1 × `users` + 1 × `leads` |
| Creación | lo anterior (revalidación) + `custom_fields` + `contacts` + `leads` |

Límites usados: `contacts` 250, `leads` 250, `users` 250.

- **3 consultas de contactos**: una por cada forma habitual del número
  (`991234567`, `0991234567`, `+593991234567`), con comparación exacta después en
  JS. Es deliberado: si la búsqueda de Kommo no fuera por subcadena, una sola
  consulta perdería contactos guardados con otro formato, y un falso
  «disponible» es exactamente el duplicado que el widget debe evitar. Si se
  confirma en la cuenta que la búsqueda es por subcadena, se puede bajar a una
  sola consulta editando `code/preparar-consultas.js`.
- **Sin paginación**: ninguna lista pagina. Con más de 250 coincidencias, o más
  de 250 leads enlazados a un contacto, la consulta se trunca en silencio. Para
  teléfonos de 9 dígitos es improbable, pero conviene revisarlo si una cuenta
  crece.
- **Nombres de asesores**: `GET /users` requiere permisos de administrador. El
  nodo tiene `onError: continueRegularOutput`, así que un fallo **no** detiene la
  ejecución: el widget muestra solo los ids.

# 8. Endpoints de Kommo usados

- `GET /api/v4/contacts?query=<variante>&with=leads&limit=250`
- `GET /api/v4/leads?filter[id][]=…&limit=250`
- `GET /api/v4/users?limit=250`
- `GET /api/v4/contacts/custom_fields` *(ruta documentada: `/api/v4/{entidad}/custom_fields`)*
- `POST /api/v4/contacts`, `POST /api/v4/leads`

> `filter[contacts][]` **no existe** en la API v4: los leads de un contacto se
> obtienen con `with=leads` sobre el contacto y luego `filter[id][]`.
>
> `POST /api/v4/leads/complex` (control de duplicados) existe, pero sus reglas
> las define Kommo y no cubren «lead activo de otro asesor».

# 9. Desarrollo

Los JSON se generan; no se editan a mano.

```bash
node unyx/n8n/build.js            # regenera los dos workflows generales
node unyx/n8n/test/logic.test.js  # 88 comprobaciones sin n8n
```

| Archivo | Para qué |
|---|---|
| `clientes.json` | un registro por cuenta de Kommo (nombre, subdominio, nombres de variables) |
| `code/resolver-cliente.js` | el switch por token; `build.js` incrusta la lista de clientes |
| `code/_comun.js` | regla de atención activa y armado del estado |
| `code/*.js` | lógica del resto de nodos Code |
| `build.js` | arma los dos JSON desde los snippets |
| `test/logic.test.js` | pruebas extraídas de los JSON generados |

Cambiar una regla de negocio = editar el snippet, `node unyx/n8n/build.js`,
reimportar los dos workflows.
