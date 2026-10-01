# Workflows de n8n — UNYX · Verificar Cliente

Backend del widget privado. **Un cliente = una cuenta de Kommo = un par de
workflows con su propia credencial.** El widget es el mismo ZIP para todos.

| Archivo generado | Webhook | Qué hace |
|---|---|---|
| `unyx-<cliente>-verificar-cliente.json` | `POST /webhook/unyx-<cliente>/verificar-cliente` | Busca el contacto por teléfono, revisa sus leads y devuelve el estado. |
| `unyx-<cliente>-crear-lead.json` | `POST /webhook/unyx-<cliente>/crear-lead` | **Re-valida** y crea el lead reutilizando el contacto. |

- Host: `https://flow.unyxsolutions.com`
- Credencial: la de cada cliente (por defecto **Kommo Meditec Token**,
  `httpHeaderAuth`, id `rsBfubSe7f022RsT`). Los workflows la referencian por id;
  no hay tokens en el código ni en el widget.
- Los workflows de Meditec ya generados:
  `unyx-meditec-verificar-cliente.json`, `unyx-meditec-crear-lead.json`
- Los de LuxViajes (preparados, pendientes de confirmar credencial):
  `unyx-luxviajes-verificar-cliente.json`, `unyx-luxviajes-crear-lead.json`

No se toca ni se reimporta ningún workflow existente
(`kommo-widget-conversion`, `kommo-widget-ticket-promedio`, `kommo-cobranzas-*`).

## Regla de «atención activa»: solo `closed_at`

**Un lead del contacto está activo si no tiene `closed_at`.** Kommo marca
`closed_at` cuando el lead se cierra (ganado o perdido) y lo limpia si se
reabre, así que no hace falta consultar pipelines ni etapas.

Por qué es mejor que la regla anterior (que sí miraba etapas):

| | Etapas (`sort >= 10000`, id 142, nombre) | `closed_at` |
|---|---|---|
| Llamadas a la API | 2 extra por consulta | 0 |
| Configuración por cliente | hay que averiguar pipelines y etapas | ninguna |
| Si renombran o crean una etapa | se rompe en silencio | no afecta |
| Funciona en cualquier cuenta | no | sí |

> ⚠️ Supuesto de proceso: para que un cliente no bloquee la creación, sus leads
> tienen que estar **cerrados de verdad en Kommo** (movidos a una etapa de
> ganado o perdido). Si el equipo deja leads viejos en etapas abiertas, se
> seguirán considerando atención activa — que es lo correcto, pero conviene
> saberlo.

Estados que devuelve la consulta: `available`, `same_agent`, `other_agent`,
`multiple_leads`. Con más de un lead activo se responde `multiple_leads`; con
uno solo, `same_agent` si es del asesor actual y `other_agent` si es de otro.

## Corrección de endpoints respecto de la propuesta inicial

| Propuesto | Estado | Por qué |
|---|---|---|
| `GET /api/v4/contacts?query=+593…` | ✅ válido | Es la vía documentada para buscar por teléfono. |
| `GET /api/v4/leads?filter[contacts][]=<id>` | ❌ **no existe** | El filtro de leads no admite `contacts`. Se usa `contacts?with=leads`, que devuelve los ids enlazados, y después `leads?filter[id][]=…`. |
| `GET /api/v4/users` | ✅ válido | Resuelve el nombre del asesor responsable. Requiere permisos de administrador; si falla, el widget muestra solo el id. |
| `POST /api/v4/leads` | ✅ válido | Creación simple con `_embedded.contacts` para enlazar el contacto. |

`POST /api/v4/leads/complex` (control de duplicados) existe, pero sus reglas
las define Kommo y no cubren «lead activo de otro asesor». No se usa.

## Multi-cliente

### Guarda de cuenta (importante)

El widget se instala en varias cuentas y cada una apunta a su propio webhook.
El **primer nodo** del workflow comprueba que el campo `account` que envía el
widget coincida con el subdominio del cliente; si no coincide, responde
`ok:false` sin tocar la API.

Sin esa guarda, un widget mal configurado en Altosa usaría el token de Meditec:
el asesor vería contactos y asesores de otra cuenta, y podría crear leads en
ella. La guarda es lo que hace segura la reutilización.

### Agregar un cliente

1. Crear la integración privada en la cuenta de Kommo del cliente
   (Settings → Integrations → Crear integración).
2. Generar su **token de larga duración** y guardarlo en una credencial nueva
   de n8n: tipo *Header Auth*, cabecera `Authorization`, valor
   `Bearer <token>`.
3. Añadir la entrada en `unyx/n8n/clientes.json`:

   ```json
   {
     "slug": "altosa",
     "nombre": "Altosa",
     "subdominio": "altosa",
     "credencial": { "id": "<id en n8n>", "name": "Kommo Altosa Token", "tipo": "httpHeaderAuth" },
     "pipelinesExcluidos": []
   }
   ```

   - `credencial.tipo` es `httpHeaderAuth` (cabecera `Authorization: Bearer <token>`) o
     `httpBearerAuth` (el token solo, como valor de la credencial). **Debe
     coincidir con el tipo real en n8n**, o el nodo HTTP queda sin credencial.
   - `pipelinesExcluidos` son los pipelines que **no** cuentan como atención
     activa. Por defecto `[]`.

## Qué archivos se importan en n8n

| Archivo | ¿Importar? |
|---|---|
| `unyx-<cliente>-verificar-cliente.json` | **Sí** |
| `unyx-<cliente>-crear-lead.json` | **Sí** |
| `clientes.json` | No — configuración del generador |
| `build.js` | No — genera los workflow JSON |
| `code/*.js` | No — lógica que `build.js` incrusta en los JSON |
| `test/logic.test.js` | No — pruebas locales |
| `README.md` | No |
| `Leads Duplicados.json` | No — es un flujo existente de LuxViajes, ajeno a este widget |

Importar **solo el par del cliente que se va a activar**. Los demás pares
pueden quedarse sin importar hasta que ese cliente se active.

## Pipelines excluidos

El flujo existente de LuxViajes (`Leads Duplicados.json`) ignora cuatro
pipelines al avisar de duplicados: `13416240, 13629516, 13629520, 13680940`.
En esa cuenta un lead en uno de esos pipelines no debería bloquear la creación
de otro, así que el widget replica la misma exclusión vía
`pipelinesExcluidos` en `clientes.json`.

Revisar este punto con el cliente: el aviso por nota y el bloqueo del widget
pueden tener criterios distintos a propósito (por ejemplo, el widget podría ser
más estricto). Cambiarlo es editar la lista en `clientes.json` y regenerar.

4. `node unyx/n8n/build.js` (o `node unyx/n8n/build.js altosa` para uno solo).
5. Importar los dos JSON nuevos en n8n y activarlos.
6. Al instalar el widget en esa cuenta, poner en *URL de los webhooks de n8n*:
   `https://flow.unyxsolutions.com/webhook/unyx-<slug>`

No se inventan subdominios ni credenciales: si a un cliente le falta el id de
credencial, el generador lo salta con un aviso.

## Formato de las respuestas

Siempre HTTP 200 con `ok` en el cuerpo, para que el widget muestre el mensaje
exacto en lugar del error genérico de red.

```jsonc
// consulta correcta
{
  "ok": true,
  "state": "available" | "same_agent" | "other_agent" | "multiple_leads",
  "phone": "+593991234567",
  "contactName": "María Zambrano",
  "contactCount": 1,
  "closedLeadCount": 2,
  "activeLead": { "id": 1, "name": "…", "responsibleName": "…", "leadUrl": "https://meditecec.kommo.com/leads/1" },
  "leads": []             // solo con multiple_leads
}

// error de validación, cuenta equivocada o bloqueo al crear
{ "ok": false, "message": "…", "state": "other_agent", "activeLead": { … } }

// lead creado
{ "ok": true, "leadId": 4321, "leadName": "María Zambrano · +593991234567", "contactId": 501, "leadUrl": "https://meditecec.kommo.com/leads/4321" }
```

## Instalación de los workflows

1. n8n → **Workflows → Import from File** → `unyx-meditec-verificar-cliente.json`.
2. Repetir con `unyx-meditec-crear-lead.json`.
3. Abrir cada uno y confirmar que los nodos HTTP muestran la credencial
   **Kommo Meditec Token** (si el id no existiera en la instancia, seleccionarla
   a mano en cada nodo HTTP).
4. **Activar** los dos workflows: el webhook de producción solo existe cuando el
   workflow está activo. El widget usa `/webhook/…`, no `/webhook-test/…`.
5. Probar:

   ```bash
   curl -s -X POST https://flow.unyxsolutions.com/webhook/unyx-meditec/verificar-cliente \
     -H 'content-type: application/json' \
     -d '{"phone":"991234567","account":"meditecec","userId":555}'
   ```

   Debe responder `{"ok":true,"state":…}`. Si responde
   `{"code":404,"message":"webhook not registered"}`, el workflow no está activo
   o la ruta no coincide.

## Concurrencia

`unyx-<cliente>-crear-lead` revalida justo antes de crear, dentro de la misma
ejecución, así que la ventana de carrera se reduce a milisegundos. **No la
elimina del todo**: dos asesores que creen el lead en el mismo instante podrían
pasar ambos la revalidación antes de que ninguna creación se refleje.

Si tu versión de n8n permite limitar la concurrencia de un workflow a 1, hazlo
sobre el workflow de creación y la ventana queda cerrada. Si no, alternativas:

- Activar el **control de duplicados** de Kommo al crear la integración, como
  red de seguridad adicional.
- Revisar el historial de leads del contacto si llega un reporte de duplicado.

## Desarrollo

Los JSON se generan; no se editan a mano.

```bash
node unyx/n8n/build.js            # regenera todos los clientes
node unyx/n8n/build.js altosa     # solo un cliente
node unyx/n8n/test/logic.test.js  # 68 comprobaciones sin n8n
```

| Archivo | Para qué |
|---|---|
| `clientes.json` | una entrada por cuenta de Kommo |
| `code/_comun.js` | regla de atención activa y armado del estado |
| `code/*.js` | lógica de cada nodo Code |
| `build.js` | ensambla los workflow JSON |
| `test/logic.test.js` | pruebas extraídas de los JSON generados |

Para cambiar una regla de negocio, edita el snippet correspondiente, regenera y
vuelve a importar los JSON en n8n.
