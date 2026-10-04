# Workflows de n8n — UNYX · Verificar Cliente

Backend del widget privado. **Un par de workflows por cliente**, independientes
entre sí: no hay Switch, ni ramas, ni variables de entorno.

| Archivo | Webhook | Qué hace |
|---|---|---|
| `unyx-verificar-cliente.json` | `POST /webhook/unyx/verificar-cliente` | Busca el contacto por teléfono, revisa sus leads y devuelve el estado. |
| `unyx-crear-lead.json` | `POST /webhook/unyx/crear-lead` | **Re-valida** y crea el lead reutilizando el contacto. |

`unyx` es la **configuración madre**. Cuando un cliente quiera lo mismo, se
duplica el par completo (ver «Agregar un cliente»): sus archivos serán
`<slug>-verificar-cliente.json` y `<slug>-crear-lead.json`, con su credencial,
su subdominio y su webhook. Así ningún workflow arrastra nodos de otros
clientes: UNYX son 16 y 23 nodos.

No se toca ni se reimporta ningún workflow existente
(`kommo-widget-conversion`, `kommo-widget-ticket-promedio`, `kommo-cobranzas-*`).

---

# 1. Cómo queda el workflow

```text
Webhook (POST /unyx/verificar-cliente)
   └─► ¿Autorizado?          token del widget + subdominio de la cuenta
         ├─(no)─► Acceso Denegado ──► Responder al Widget
         └─(sí)─► Teléfono Válido               9 dígitos de celular
                    ├─(no)─► Teléfono Inválido ──► Responder al Widget
                    └─(sí)─► Preparar Consultas
                              └─► Buscar Contactos     (credencial de n8n)
                                    └─► Unificar Contactos
                                          └─► Usuarios Kommo
                                                └─► Consolidar
                                                      └─► ¿Tiene Leads?
                                                            ├─(sí)─► Obtener Leads ──► Evaluar Atención
                                                            └─(no)─► Sin Leads Activos
                                                                          └── ambos ──► Responder al Widget
```

`¿Autorizado?` comprueba dos cosas de una vez:

```
body.token   === <token del widget>     (se pega en n8n; ver sección 3)
body.account === <subdominio>
```

- Si el token no es el de esta cuenta → `Acceso no autorizado`.
- Si el token es válido pero `account` es de otra cuenta → también se corta. Esto
  protege al **duplicar el workflow**: si alguien copia el de Meditec para Altosa
  y se olvida de cambiar el subdominio de las URLs, el widget lo delata en vez de
  escribir en la cuenta equivocada.
- Todo ocurre **antes** de cualquier llamada a la API de Kommo.

`Teléfono Válido` solo comprueba la **forma** del número (de 7 a 15 dígitos, con o
sin `+`), para que un venezolano o un brasileño no se descarte antes de consultar.
La regla por país vive en `Preparar Consultas`: Ecuador exige sus 9 dígitos de
celular y el resto admite de 6 a 12. La expresión del IF está en
`code/if-telefono.txt`, compartida por `build.js` y el patcher.

---

# 2. Los dos tokens

Cada cliente necesita dos valores **distintos**. Ninguno se guarda en este
repositorio.

| Token | Qué es | Quién lo genera | Dónde va |
|---|---|---|---|
| **Token del widget** | Identifica que la petición viene del widget de esta cuenta. Es la barrera de acceso al webhook. | **UNYX** (comando de abajo) | Nodo `¿Autorizado?` en n8n **y** ajuste *Token de acceso* del widget en Kommo |
| **Token de Kommo** | Token de larga duración de la integración privada de esa cuenta. | Kommo, al crear la integración (*Claves y ámbitos*) | **Credencial de n8n** del cliente |

## Generar el token del widget

Windows (PowerShell 7):

```powershell
[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

Devuelve 64 caracteres hexadecimales. En Linux/macOS: `openssl rand -hex 32`.

Debe ser hexadecimal: el nodo `¿Autorizado?` compara por igualdad de texto y un
valor con llaves podría interpretarse como expresión en n8n.

**Es un secreto**: el valor real no se escribe en `clientes.json` ni en el JSON
generado. Se pega directamente en el nodo, dentro de n8n.

## Cómo obtener el token de Kommo

1. En Kommo, como administrador: **Ajustes → Centro de integraciones**, abrir la
   integración de esa cuenta.
2. Pestaña **Claves y ámbitos** → **token de larga duración**.
3. Ese valor va en la credencial de n8n (sección 3).

> Si vas a usar un token de larga duración, la documentación de Kommo pide **no
> escribir nada en la URL de redireccionamiento** al crear la integración.

---

# 3. Crear la credencial en n8n

Una por cliente. En n8n:

1. **Credentials → Add credential → Header Auth**.
2. Rellenar:
   - **Name**: `Kommo UNYX Token`
   - **Header Name**: `Authorization`
   - **Header Value**: `Bearer <token de Kommo>` — la palabra `Bearer`, un espacio
     y el token.
3. Guardar.

`clientes.json` referencia la credencial por **id**, no por nombre:

```json
"credencial": { "id": "PEGAR_ID_CREDENCIAL_UNYX", "name": "Kommo UNYX Token", "tipo": "httpHeaderAuth" }
```

El id se ve en la URL al abrir la credencial en n8n (`/credentials/<id>`).
Mientras siga el placeholder, los nodos HTTP importarán **sin credencial**.

Un nodo HTTP sin credencial **no falla al importar**: falla en la primera
consulta del asesor, con un error genérico en el widget. Dos alternativas:

- Reemplazar el id en `clientes.json`, `node unyx/n8n/build.js` y reimportar, o
- Importar y **seleccionar la credencial a mano** en los 3 nodos HTTP de
  `unyx-verificar-cliente` y los 6 de `unyx-crear-lead`.

`tipo` debe coincidir con el tipo real de la credencial en n8n:
`httpHeaderAuth` (cabecera `Authorization: Bearer …`) o `httpBearerAuth` (sólo el
token como valor).

---

# 4. Instalación

1. Crear la credencial de Kommo en n8n (sección 3).
2. n8n → **Workflows → Import from File** → `unyx-verificar-cliente.json`.
3. Repetir con `unyx-crear-lead.json`.
4. En **cada uno** de los dos workflows: abrir `¿Autorizado?` y reemplazar
   `PEGAR_TOKEN_UNYX` por el token real del widget.
   **Mientras quede el placeholder, todo cae en `Acceso Denegado`.**
5. Revisar que cada nodo HTTP tenga su credencial seleccionada.
6. **Activar** los dos: el webhook de producción sólo existe con el workflow
   activo. El widget usa `/webhook/…`, no `/webhook-test/…`.
7. Probar:

   ```bash
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx/verificar-cliente \
     -H 'content-type: application/json' \
     -d '{"phone":"991234567","account":"unyx","userId":77,"token":"<token del widget>"}'
   ```

   Debe responder `{"ok":true,"state":…,"contactName":…}`.

   Pruebas negativas, una vez:

   ```bash
   # token desconocido -> Acceso no autorizado
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx/verificar-cliente \
     -H 'content-type: application/json' -d '{"phone":"991234567","account":"unyx","token":"lo-que-sea"}'

   # token válido anunciando otra cuenta -> Acceso no autorizado
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx/verificar-cliente \
     -H 'content-type: application/json' \
     -d '{"phone":"991234567","account":"meditecec","token":"<token del widget>"}'
   ```

   Si responde `{"code":404,"message":"webhook not registered"}`, el workflow no
   está activo o la ruta no coincide.

8. En los ajustes del widget en Kommo:
   - *URL de los webhooks de n8n*: `https://flow.unyxsolutions.com/webhook/unyx`
   - *Token de acceso de esta cuenta*: el mismo token del paso 4.

## Actualizar un workflow ya desplegado

Los JSON se generan con `"active": false`, así que reimportar **no** actualiza el
que está en producción: crea uno nuevo. Además, **reimportar borra el token que
pegaste en `¿Autorizado?`** (vuelve a quedar como `PEGAR_TOKEN_<CLIENTE>`).

1. **Anotar** el token que hay puesto en `¿Autorizado?`.
2. **Desactivar** el workflow viejo: deja de responder el webhook.
3. Reimportar el JSON regenerado.
4. Revisar las credenciales de los nodos HTTP.
5. **Volver a pegar el token** en `¿Autorizado?`.
6. **Activar** el nuevo, hacer `curl` de humo y borrar el workflow viejo.

Los ajustes manuales en n8n (credenciales elegidas a mano, concurrencia = 1)
tampoco viven en el repositorio y se pierden al reimportar.

---

# 5. Agregar un cliente (duplicar el workflow completo)

1. Crear la integración privada en la cuenta de Kommo del cliente (Ajustes →
   Centro de integraciones → Crear integración). **URL de redireccionamiento
   vacía.**
2. Obtener su **token de Kommo** (*Claves y ámbitos*) y crear su credencial
   Header Auth en n8n.
3. Generar su **token de widget** (comando de la sección 2).
4. Agregar la entrada al final de `unyx/n8n/clientes.json`:

   ```json
   {
     "slug": "altosa",
     "nombre": "Altosa",
     "subdominio": "altosa",
     "tokenWidget": "PEGAR_TOKEN_ALTOSA",
     "credencial": { "id": "<id en n8n>", "name": "Kommo Altosa Token", "tipo": "httpHeaderAuth" },
     "pipelinesExcluidos": []
   }
   ```

   El `slug` define el nombre de los archivos y la ruta del webhook.

5. `node unyx/n8n/build.js` → además del par de UNYX genera
   `altosa-verificar-cliente.json` y `altosa-crear-lead.json`.
   (Con `node unyx/n8n/build.js altosa` se genera sólo ése.)
6. Importar ese par en n8n, pegar su token en `¿Autorizado?` y activarlos.
7. Instalar el widget en esa cuenta con:
   - *URL*: `https://flow.unyxsolutions.com/webhook/altosa`
   - *Token de acceso*: el token de ese cliente.

Los pares son independientes: un cambio en las reglas se regenera para todos y
se reimporta sólo el que haga falta. Ningún workflow mezcla clientes.

`clientes.json` puede contener varios clientes a la vez; `build.js` genera un par
por cada uno. Si prefieres trabajar de uno en uno, deja sólo el que estés
instalando.

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

`pipelinesExcluidos` permite excluir pipelines completos de la regla, por
cliente. UNYX hoy no excluye ninguno. Si algún cliente necesita el mismo
criterio que su flujo de avisos de duplicados, se copia su lista ahí.

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
  (`963925815`, `0963925815`, `593963925815`), con comparación exacta después en
  JS. Es deliberado: si la búsqueda de Kommo no fuera por subcadena, una sola
  consulta perdería contactos guardados con otro formato, y un falso
  «disponible» es exactamente el duplicado que el widget debe evitar.
- **Teléfonos internacionales**: el widget envía `phone` en formato E.164
  (`+573001234567`) y `country` con el código de país aparte, así que la parte
  nacional se calcula sin adivinar. La comparación contra lo guardado en Kommo
  acepta la parte nacional, con `0` inicial, o con el código de país delante
  (1 a 3 dígitos). Si `country` no viene (widget anterior), se asume Ecuador, así
  que **n8n y el widget se pueden actualizar en cualquier orden sin romper
  Ecuador**; para números de otros países sí hace falta el widget nuevo.
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
node unyx/n8n/build.js            # regenera el par de cada cliente de clientes.json
node unyx/n8n/build.js altosa     # sólo el de un cliente
node unyx/n8n/test/logic.test.js  # 99 comprobaciones sin n8n
```

| Archivo | Para qué |
|---|---|
| `clientes.json` | un registro por cuenta: subdominio, credencial, token del widget |
| `code/_comun.js` | regla de atención activa y armado del estado |
| `code/*.js` | lógica de cada nodo Code; `build.js` los adapta al cliente |
| `build.js` | arma los dos JSON de cada cliente |
| `test/logic.test.js` | pruebas de la lógica, de la estructura y del encapsulado del widget |

Los snippets son agnósticos al cliente: usan `__N_<NODO>__` para las referencias
entre nodos y `__SUBDOMINIO__`/`__PIPELINES_EXCLUIDOS__` para las constantes, y
`build.js` los resuelve. Cambiar una regla en `code/` cambia la de todos los
clientes al regenerar.
