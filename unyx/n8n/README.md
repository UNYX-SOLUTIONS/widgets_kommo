# Workflows de n8n — UNYX · Verificar Cliente

Backend del widget privado. **Una rama por cliente** dentro de los dos
workflows: no hay un workflow por cliente ni variables de entorno.

| Archivo | Webhook | Qué hace |
|---|---|---|
| `unyx-verificar-cliente.json` | `POST /webhook/unyx/verificar-cliente` | Busca el contacto por teléfono, revisa sus leads y devuelve el estado. |
| `unyx-crear-lead.json` | `POST /webhook/unyx/crear-lead` | **Re-valida** y crea el lead reutilizando el contacto. |

- Host: `https://flow.unyxsolutions.com`
- El cliente se decide por el **token del widget**: `Switch Cliente` compara
  `body.token` y manda la petición a la rama de ese cliente.
- Cada rama usa la **credencial de n8n** de su cuenta de Kommo y la URL de su
  subdominio. **No se usan variables de entorno.**
- Clientes configurados hoy: Meditec, Altosa y LuxViajes.

No se toca ni se reimporta ningún workflow existente
(`kommo-widget-conversion`, `kommo-widget-ticket-promedio`, `kommo-cobranzas-*`).

---

# 1. Cómo queda el workflow

```text
Webhook (POST /unyx/verificar-cliente)
   │
   ▼
Switch Cliente  ── token == PEGAR_TOKEN_MEDITEC ──► Meditec · ¿Cuenta Correcta? ──► cadena (credencial Meditec)
   │            ── token == PEGAR_TOKEN_ALTOSA  ──► Altosa · ¿Cuenta Correcta?  ──► cadena (credencial Altosa)
   │            ── token == PEGAR_TOKEN_LUXVIAJES ► LuxViajes · ¿Cuenta Correcta? ► cadena (credencial LuxViajes)
   │
   └── (salida extra) cualquier otro token ──────► Acceso Denegado ──► Responder al Widget
```

Cada rama, antes de tocar la API:

- **`¿Cuenta Correcta?`**: comprueba que `body.account` (el subdominio que envía
  el widget) sea el de ese cliente. Si no, `Cuenta Incorrecta` → responde
  `ok:false`. Evita que un token válido opere sobre la cuenta equivocada.
- **`Teléfono Válido`**: 9 dígitos de celular ecuatoriano. Si no, `Teléfono
  Inválido` → responde `ok:false` en vez de reventar.

Los nodos Code de cada rama están prefijados con el nombre del cliente
(`Altosa · Consolidar`, etc.) y sólo referencian nodos de su propia rama. Hay
una prueba automática que falla si una rama referencia nodos de otra.

`acciones` del Switch: una salida por cliente **en el orden de `clientes.json`**,
más una salida extra para el token que no coincide. Si se reordena
`clientes.json` hay que regenerar e **reimportar**.

---

# 2. Los dos tokens (por cliente)

Cada cliente necesita dos valores **distintos**. Ninguno se guarda en este
repositorio.

| Token | Qué es | Quién lo genera | Dónde va |
|---|---|---|---|
| **Token del widget** | Identifica de qué cliente es la petición. Es la barrera de acceso al webhook. | **UNYX** (comando de abajo) | Nodo `Switch Cliente` en n8n **y** ajuste *Token de acceso* del widget en Kommo |
| **Token de Kommo** | Token de larga duración de la integración privada de esa cuenta. | Kommo, al crear la integración (*Claves y ámbitos*) | **Credencial de n8n** de ese cliente |

## Generar el token del widget

Uno por cliente, distinto en cada uno: es lo que le dice al Switch en qué rama
entrar. Windows (PowerShell 7):

```powershell
[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

Devuelve 64 caracteres hexadecimales. Ejecútalo tres veces (una por cliente) y
anota cuál es de cuál. En Linux/macOS: `openssl rand -hex 32`.

Genera un comando que los imprima de una vez, si prefieres:

```powershell
1..3 | ForEach-Object { [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower() }
```

El token debe ser hexadecimal: el Switch compara por igualdad de texto y un
valor con caracteres especiales podría interpretarse como expresión en n8n.

## Cómo obtener el token de Kommo

1. En Kommo, como administrador: **Ajustes → Centro de integraciones**, abrir la
   integración de ese cliente.
2. Pestaña **Claves y ámbitos** → **token de larga duración**.
3. Ese valor va en la credencial de n8n del cliente (siguiente sección).

> Si vas a usar un token de larga duración, la documentación de Kommo pide **no
> escribir nada en la URL de redireccionamiento** al crear la integración.

---

# 3. Crear las credenciales en n8n

Una credencial por cliente, todas del mismo tipo. En n8n:

1. **Credentials → Add credential → Header Auth**.
2. Rellenar:
   - **Name**: `Kommo Meditec Token` (o `Kommo Altosa Token`, `Bearer Auth account`
     para LuxViajes — los nombres ya están puestos en `clientes.json`).
   - **Header Name**: `Authorization`
   - **Header Value**: `Bearer <token de Kommo>` — la palabra `Bearer`, un
     espacio y el token.
3. Guardar.

`clientes.json` referencia cada credencial por **id**, no por nombre:

| Cliente | Credencial esperada | Id en `clientes.json` |
|---|---|---|
| Meditec | `Kommo Meditec Token` (`httpHeaderAuth`) | `rsBfubSe7f022RsT` |
| Altosa | `Kommo Altosa Token` (`httpHeaderAuth`) | **placeholder, hay que reemplazarlo** |
| LuxViajes | `Bearer Auth account` (`httpBearerAuth`) | `7VB4zRZNA0UkBt6D` |

El id se ve en la URL al abrir la credencial en n8n
(`/credentials/<id>`). Si creas la credencial de Altosa, actualiza
`clientes.json`, ejecuta `node unyx/n8n/build.js` y reimporta. Alternativa sin
regenerar: importar y **seleccionar la credencial a mano en los 3 nodos HTTP de
esa rama** (y en los 6 del workflow de creación).

Un nodo HTTP sin credencial **no falla al importar**: falla en la primera
consulta del asesor, con un error genérico en el widget.

---

# 4. Instalación

1. Crear las 3 credenciales (sección 3).
2. n8n → **Workflows → Import from File** → `unyx-verificar-cliente.json`.
3. Repetir con `unyx-crear-lead.json`.
4. En **cada uno** de los dos workflows: abrir `Switch Cliente` y reemplazar los
   tres valores `PEGAR_TOKEN_*` por los tokens reales del widget.
   **Mientras queden placeholders, todo cae en `Acceso Denegado`.**
5. Revisar que cada nodo HTTP tenga su credencial seleccionada.
6. **Activar** los dos workflows: el webhook de producción sólo existe con el
   workflow activo.
7. Probar:

   ```bash
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx/verificar-cliente \
     -H 'content-type: application/json' \
     -d '{"phone":"991234567","account":"altosa","userId":77,"token":"<token de Altosa>"}'
   ```

   Debe responder `{"ok":true,"state":…,"contactName":…}`.

   Pruebas negativas, una vez:

   ```bash
   # token desconocido -> Acceso Denegado
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx/verificar-cliente \
     -H 'content-type: application/json' -d '{"phone":"991234567","account":"altosa","token":"lo-que-sea"}'

   # token de Altosa anunciando la cuenta de Meditec -> Cuenta Incorrecta
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx/verificar-cliente \
     -H 'content-type: application/json' \
     -d '{"phone":"991234567","account":"meditecec","token":"<token de Altosa>"}'
   ```

   Si responde `{"code":404,"message":"webhook not registered"}`, el workflow no
   está activo o la ruta no coincide.

8. En los ajustes del widget en Kommo:
   - *URL de los webhooks de n8n*: `https://flow.unyxsolutions.com/webhook/unyx`
     (**igual para todos los clientes**)
   - *Token de acceso de esta cuenta*: el token del widget de esa cuenta.

## Actualizar un workflow ya desplegado

Los JSON se generan con `"active": false`, así que reimportar **no** actualiza el
que está en producción: crea uno nuevo. Además, **reimportar borra los tokens
que pegaste en el Switch** (vuelven a quedar como `PEGAR_TOKEN_*`).

Procedimiento por workflow:

1. **Anotar** los tokens que hay puestos en `Switch Cliente` (o tenerlos a mano).
2. **Desactivar** el workflow viejo: deja de responder el webhook.
3. Reimportar el JSON regenerado.
4. Revisar las credenciales de los nodos HTTP.
5. **Volver a pegar los tokens** en `Switch Cliente`.
6. **Activar** el nuevo, hacer `curl` de humo y borrar el workflow viejo.

Los ajustes manuales en n8n (credenciales elegidas a mano, concurrencia = 1)
tampoco viven en el repositorio y se pierden al reimportar.

---

# 5. Agregar un cliente

1. Crear la integración privada en la cuenta de Kommo del cliente (Ajustes →
   Centro de integraciones → Crear integración). **URL de redireccionamiento
   vacía.**
2. Obtener su **token de Kommo** (*Claves y ámbitos*) y crear su credencial
   Header Auth en n8n.
3. Generar su **token de widget** (comando de la sección 2).
4. Agregar la entrada al final de `unyx/n8n/clientes.json`:

   ```json
   {
     "slug": "nuevocliente",
     "nombre": "Nuevo Cliente",
     "subdominio": "sunsubdominio",
     "tokenSwitch": "PEGAR_TOKEN_NUEVOCLIENTE",
     "credencial": { "id": "<id en n8n>", "name": "Kommo Nuevo Cliente Token", "tipo": "httpHeaderAuth" },
     "pipelinesExcluidos": []
   }
   ```

   El **orden** importa: define las salidas del Switch.

5. `node unyx/n8n/build.js` → regenera los dos workflows (44 y 65 nodos hoy).
6. Reimportar los dos (procedimiento de arriba) y pegar los tokens.
7. Instalar el widget en esa cuenta con su URL y su token.

> Con más clientes, el workflow crece: cada cliente añade ~15 nodos a
> `unyx-verificar-cliente` y ~21 a `unyx-crear-lead`. Es el coste aceptado de
> este diseño; la alternativa era una variable de entorno por cliente, que
> requiere acceso SSH.

---

# 6. Regla de «atención activa»: sólo `closed_at`

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
> tienen que estar **cerrados de verdad en Kommo**. Si el equipo deja leads
> viejos en etapas abiertas, seguirán contando como atención activa.

`pipelinesExcluidos` permite excluir pipelines completos de la regla, por rama.
LuxViajes excluye los mismos cuatro que su flujo de avisos de duplicados
(`13416240, 13629516, 13629520, 13680940`). **Revisar con el cliente** si el
widget debe compartir ese criterio o ser más estricto.

Estados que devuelve la consulta: `available`, `same_agent`, `other_agent`,
`multiple_leads`.

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
  confirma que la búsqueda es por subcadena, se puede bajar a una sola consulta
  editando `code/preparar-consultas.js`.
- **Sin paginación**: ninguna lista pagina. Con más de 250 coincidencias, o más
  de 250 leads enlazados a un contacto, la consulta se trunca en silencio.
- **Nombres de asesores**: `GET /users` requiere permisos de administrador. El
  nodo tiene `onError: continueRegularOutput`, así que un fallo **no** detiene la
  ejecución: el widget muestra sólo los ids.

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
node unyx/n8n/build.js            # regenera los dos workflows (una rama por cliente)
node unyx/n8n/test/logic.test.js  # 102 comprobaciones sin n8n
```

| Archivo | Para qué |
|---|---|
| `clientes.json` | un registro por cuenta de Kommo: subdominio, credencial, token del Switch |
| `code/_comun.js` | regla de atención activa y armado del estado |
| `code/*.js` | lógica de cada nodo Code; `build.js` los adapta a cada rama |
| `build.js` | arma los dos JSON: Switch, ramas, credenciales y posiciones |
| `test/logic.test.js` | pruebas de la lógica, de la estructura y del encapsulado del widget |

Aunque el JSON repite la cadena por cliente, el código no está duplicado:
`rama()` construye cada rama desde los mismos snippets y reescribe las
referencias entre nodos (`$('__N_UNIFICAR__')` → `$('Altosa · Unificar
Contactos')`). Cambiar una regla en `code/` cambia las tres ramas.
