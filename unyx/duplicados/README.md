# UNYX · Verificar Cliente para Kommo

Widget compacto para comprobar atenciones existentes antes de crear un lead.

## Archivos

- `manifest.json`: configuración de la integración privada.
- `script.js`, `style.css`: interfaz del widget y llamadas a la API propia de UNYX.
- `index.html`: vista previa local del mismo card.
- `i18n/es.json`: textos en español.
- `images/`: logos requeridos por el paquete.

## Importante antes de subir

El widget no debe llamar directamente a la API de Kommo ni contener un token OAuth privado. Configure un backend HTTPS de UNYX que maneje OAuth, haga las búsquedas y aplique el bloqueo de duplicados también al crear. En `index.html` establezca `window.UNYX_WIDGET_API` al dominio del backend; en el paquete Kommo, configure esa URL en el bootstrap de `script.js` o sirva una configuración pública desde el propio backend.

Endpoints esperados:

### `POST /api/kommo/client-check`

Entrada: `{ "phone": "+593991234567" }`

Respuesta para cliente sin lead activo:

```json
{ "state": "available", "contactName": "Nombre opcional", "checkId": "id-opaco-de-un-solo-uso" }
```

Otros estados permitidos: `same_agent`, `other_agent`, `multiple_leads`. Incluir `activeLead` cuando corresponda, con `id`, `name`, `statusName`, `responsibleName` y, si se conoce, `leadUrl`.

### `POST /api/kommo/leads`

Entrada: `{ "phone": "+593991234567", "checkId": "id-opaco-de-un-solo-uso" }`

El backend debe volver a comprobar que no se creó/asignó una atención activa a otra persona desde la verificación, reutilizar el contacto existente si aplica, crear el lead asignado al usuario actual y devolver `{ "leadName": "...", "leadUrl": "https://..." }`.

## Ubicación en Kommo

`locations: ["everywhere"]` hace que la integración quede disponible en el entorno de Kommo. La ubicación exacta del widget depende de las ubicaciones admitidas por la versión vigente del manifest y del flujo real (debe abrirse sin un lead existente); validar en la cuenta de prueba antes de publicarlo.

## Crear ZIP

Comprimir el contenido de esta carpeta, no la carpeta contenedora, para que `manifest.json` quede en la raíz. Ejemplo: `cd unyx-kommo-widget && zip -r ../unyx-kommo-widget.zip .`.

Los PNG provisionales de `images/` son placeholders y deben reemplazarse por los logos oficiales de UNYX en las variantes que solicite la pantalla de carga.
