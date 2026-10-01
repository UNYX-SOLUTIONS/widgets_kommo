# UNYX · Verificar Cliente — widget de Kommo

Integración privada para Kommo. El asesor ingresa un celular ecuatoriano
(`+593` + 9 dígitos) y el widget verifica si el cliente ya tiene una atención
activa antes de permitir crear un lead.

El paquete NO habla nunca con la API de Kommo: llama al backend UNYX
(`/api/kommo/*`) a través del proxy de Kommo (`self.crm_post`). El Secret key
de la integración vive solo en el backend.

## Archivos del paquete (los que van en el ZIP)

| Archivo | Para qué sirve |
|---|---|
| `manifest.json` | Metadatos, ubicaciones y campo de configuración `api_url`. |
| `script.js` | Módulo AMD del widget (`render`, `init`, `bind_actions`). |
| `style.css` | Card único, ancho máximo 380 px, altura según contenido. |
| `i18n/es.json` | Textos de la interfaz y del formulario de instalación. |
| `images/` | 5 PNG con las medidas que exige Kommo. |

Solo de vista previa, **no** se empaquetan: `index.html`, `preview.js`, este
README.

## Validación del manifiesto contra la documentación oficial

Revisado contra `developers.kommo.com` (manifest.json, widget-locations,
script.js, images, structure-widget). Diferencias que se corrigieron respecto
del prototipo inicial:

| Punto | Prototipo | Estado correcto |
|---|---|---|
| `locations` | dentro de `widget` | **en la raíz**, hermano de `widget` |
| `widget.logo` | `"images/logo.png"` | no existe esa clave; los logos se toman por nombre de `images/` |
| `images/logo_min.png` | faltaba | **obligatorio** en widgets de tarjeta y listas |
| medidas de los PNG | 256×256, 128×128… | 400×272, 240×84, 84×84, 130×100, 108×108 |
| `installation: true` | sin bloque `settings` | `settings` es obligatorio si `installation` es `true` |
| `interface_version` | 2 | correcto (debe ser 2) |
| `tour` | ausente | la tabla de propiedades lo marca como requerido, pero la documentación práctica lo omite en integraciones privadas. **Verificar en la cuenta de prueba.** |

Ubicaciones configuradas:

```json
"locations": ["settings", "ccard-1", "lcard-1", "clist-0", "llist-0"]
```

- `-1` = el widget se muestra en el panel derecho de la tarjeta.
- `-0` = se inicializa en la lista sin panel; se abre desde el menú de la lista.
- `settings` = aparece el icono de configuración del widget.

`everywhere` (lo que usaba el prototipo) es una ubicación válida, pero **no
admite el parámetro 1/0**: el JavaScript se inicializa en todas las páginas y
el propio widget debe decidir dónde pintarse. Con las ubicaciones explícitas
Kommo se encarga del panel.

## Contrato con el backend

El widget envía siempre el subdominio y el usuario que lee de
`self.system()`, más un `sessionToken` de un solo uso que entrega
`POST /api/kommo/session`. El backend valida la firma del token y usa el token
OAuth **de ese asesor**, nunca uno global.

### `POST /api/kommo/session`

```json
{ "account": "miempresa", "userId": 123456 }
```

Respuestas:

```json
{ "ok": true, "authRequired": false, "sessionToken": "..." }
{ "ok": true, "authRequired": true, "authUrl": "https://www.kommo.com/oauth?..." }
```

### `POST /api/kommo/client-check`

```json
{ "phone": "+593991234567", "account": "miempresa", "userId": 123456, "sessionToken": "..." }
```

```json
{
  "ok": true,
  "state": "available",
  "phone": "+593991234567",
  "contactName": "María Zambrano",
  "contactCount": 1,
  "closedLeadCount": 2,
  "activeLead": null,
  "checkId": "..."
}
```

Estados posibles:

| `state` | Significado | Acción en el widget |
|---|---|---|
| `available` | sin atención activa | muestra **Crear lead** |
| `same_agent` | la atención activa es del asesor actual | muestra el lead y su etapa |
| `other_agent` | la atención activa es de otro asesor | bloquea la creación y nombra al asesor |
| `multiple_leads` | más de una atención activa | lista los leads con enlace para abrirlos |

Cuando hay lead activo, `activeLead` trae `id`, `name`, `statusName`,
`responsibleName`, `responsible_user_id` y `leadUrl`. En `multiple_leads` se
envía además `leads[]` con el mismo formato.

### `POST /api/kommo/leads`

```json
{ "phone": "+593991234567", "checkId": "...", "account": "miempresa", "userId": 123456, "sessionToken": "..." }
```

```json
{ "ok": true, "leadId": 987, "leadName": "María Zambrano · +593991234567", "contactId": 555, "leadUrl": "https://miempresa.kommo.com/leads/987" }
```

Errores: `409` cuando el `checkId` caducó, fue manipulado, no corresponde al
número/asesor, o cuando apareció otra atención activa entre la verificación y
la creación. El widget vuelve a consultar y muestra el estado real.

## Estados de la interfaz

cargando · disponible · mismo asesor · otro asesor · varios leads · lead
creado · error de consulta · error de creación · requiere autorización ·
configuración incompleta.

## Vista previa local

```bash
cd unyx/duplicados
python -m http.server 8080   # o cualquier servidor estático
```

Abrir `http://localhost:8080/`. Sin backend configurado, `preview.js` simula
las respuestas según el último dígito del número: termina en **1** disponible,
**2** mismo asesor, **3** otro asesor, **4** varios leads, cualquier otro
disponible.

Para probar contra el backend real, en la consola del navegador:

```js
window.UNYX_PREVIEW_API = 'https://api.widgets.unyxsolutions.com'
```

y recargar.

## Publicar en Kommo

1. **Backend primero**: despliegue con `backend/.env` completo y
   `https://api.widgets.unyxsolutions.com/health` respondiendo `ok`.
2. Crear el ZIP (manifest en la raíz):

   ```bash
   bash infrastructure/scripts/build-widget-zip.sh
   # o en Windows:
   pwsh -File infrastructure/scripts/build-widget-zip.ps1
   ```

   Sale en `dist/duplicados.zip`.
3. En Kommo (cuenta de administrador): **Settings → Integrations → Create
   Integration**. En la pestaña *Keys and scopes* copiar **Integration ID** y
   **Secret key** (el secret solo se muestra una vez) → ponerlos en
   `backend/.env` como `KOMMO_CLIENT_ID` y `KOMMO_CLIENT_SECRET`.
4. **Redirect URI**:
   `https://api.widgets.unyxsolutions.com/api/kommo/oauth/callback` (debe
   coincidir exactamente con `KOMMO_REDIRECT_URI`).
5. **Upload** del ZIP en la pestaña del widget.
6. En los ajustes del widget, *URL del backend UNYX* =
   `https://api.widgets.unyxsolutions.com`. Si se deja vacío se usa ese mismo
   valor por defecto.
7. El primer asesor que use el widget verá el botón **Autorizar acceso**.

## Logos

`images/*.png` son marcadores de posición generados con
`infrastructure/scripts/generate-placeholder-logos.ps1`. Sustituirlos por los
archivos oficiales de UNYX respetando estas medidas:

| Archivo | Medida |
|---|---|
| `logo_main.png` | 400×272 |
| `logo_medium.png` | 240×84 |
| `logo_min.png` | 84×84 |
| `logo.png` | 130×100 |
| `logo_small.png` | 108×108 |

Todos PNG, cada uno por debajo de 300 KB, codificación UTF-8 sin BOM.
