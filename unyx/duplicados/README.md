# UNYX · Verificar Cliente — widget de Kommo

Integración **privada** de Kommo. El asesor ingresa un celular ecuatoriano
(`+593` + 9 dígitos) y el widget comprueba si el cliente ya tiene una atención
activa antes de permitir crear un lead.

Se muestra como panel lateral en la ficha de contacto (`ccard-1`) y en
cualquier lead (`lcard-1`).

**Un mismo ZIP sirve para todas las cuentas** (Meditec, Altosa, LuxViajes…).
Cada cuenta crea su propia integración privada, sube este ZIP y configura en
los ajustes del widget la URL de sus webhooks.

## Estado real del proyecto

| Pieza | Estado |
|---|---|
| Interfaz del card y los 8 estados | **Hecho** (`script.js`, `style.css`, `i18n/es.json`) |
| Llamadas del widget a n8n | **Hecho** (vía `self.crm_post`, sin CORS) |
| Workflows de n8n | **Hechos**, listos para importar (`unyx/n8n/`) |
| Reglas de negocio probadas sin n8n | **Hecho** (68 comprobaciones) |
| Prueba contra Kommo real | **Pendiente** — requiere importar los workflows y subir el ZIP |
| Logos oficiales de UNYX | **Pendiente** — los PNG actuales son marcadores |

Nada de esto está verificado todavía contra una cuenta real de Kommo.

## Arquitectura

```text
Widget (dentro de Kommo)        n8n (flow.unyxsolutions.com)        Kommo API v4
  script.js
     │  self.crm_post(form)
     └──────────────────────►  /webhook/unyx-<cliente>/verificar-cliente
                                  │ guarda de cuenta
                                  │ contacts?query=…&with=leads
                                  │ leads?filter[id][]=…
                                  │ users
                                  ▼
                               estado: available | same_agent | other_agent | multiple_leads
     │  self.crm_post(form)
     └──────────────────────►  /webhook/unyx-<cliente>/crear-lead
                                  │ REVALIDA
                                  │ contacts (reutiliza o crea)
                                  │ leads (asigna al asesor)
```

- El token de Kommo vive **solo** en la credencial de n8n de cada cliente. El
  widget no contiene credenciales ni llama a la API de Kommo.
- Se usa `self.crm_post` (proxy de Kommo) en vez de `fetch`: no hay CORS.
- El asesor actual se toma de `self.system().user_id`; n8n lo usa como
  `responsible_user_id` y `created_by` del lead nuevo.
- El workflow rechaza cualquier petición cuya cuenta no sea la suya, para que
  el widget de un cliente no pueda leer ni escribir en otro.

## Configuración del widget

Un único ajuste, obligatorio al instalar:

| Ajuste | Valor |
|---|---|
| *URL de los webhooks de n8n* | `https://flow.unyxsolutions.com/webhook/unyx-<cliente>` |

Ejemplos: `…/webhook/unyx-meditec`, `…/webhook/unyx-altosa`. El widget añade
`/verificar-cliente` y `/crear-lead`.

Si se deja vacío, el widget muestra «configuración incompleta» y no llama a
ningún sitio: no hay URL por defecto, justamente para que una cuenta no termine
pegándole al webhook de otra.

## Ubicaciones del manifiesto

```json
"locations": ["settings", "ccard-1", "lcard-1"]
```

- `ccard-1`: panel derecho de la ficha de contacto.
- `lcard-1`: panel derecho de cualquier lead.
- `settings`: icono de configuración, donde se pone la URL de n8n.

Detalle validado contra la documentación oficial: `locations` va en la **raíz**
del manifiesto (no dentro de `widget`), `interface_version` debe ser `2`, y si
`installation` es `true` el bloque `settings` es obligatorio.

## Contrato con n8n

El widget envía formularios (`application/x-www-form-urlencoded`) y espera
siempre HTTP 200 con `ok` en el cuerpo.

### `POST …/verificar-cliente`

Entrada: `phone`, `account`, `userId`, `userName`.

| `state` | Qué hace el widget |
|---|---|
| `available` | muestra **Crear lead** |
| `same_agent` | muestra el lead activo y el enlace para abrirlo |
| `other_agent` | bloquea la creación y nombra al asesor responsable |
| `multiple_leads` | lista los leads activos con enlace, sin permitir crear |

### `POST …/crear-lead`

Entrada: `phone`, `account`, `userId`, `userName`.

- Si el estado ya no es `available` (apareció otra atención), responde
  `{ ok: false, state, message, activeLead }` y el widget muestra la situación
  real en el mismo card.
- Si es correcto, responde `{ ok: true, leadId, leadName, contactId, leadUrl }`.

Reglas, endpoints y multi-cliente: `unyx/n8n/README.md`.

## Poner el widget en Kommo

### 1. Antes de empezar

- Tener a mano un **token de larga duración** de la cuenta y guardarlo en n8n
  como credencial *Header Auth* (`Authorization: Bearer <token>`).
- Los dos workflows de esa cuenta importados y **activos** en n8n. Si el
  webhook no está activo, el widget no encontrará la URL.

### 2. Empaquetar

```bash
pwsh -File infrastructure/scripts/build-widget-zip.ps1   # Windows
bash infrastructure/scripts/build-widget-zip.sh          # Linux/macOS
```

Genera `dist/duplicados.zip` con `manifest.json` en la raíz. El script lo
verifica y falla si no es así. Solo incluye `manifest.json`, `script.js`,
`style.css`, `i18n/` e `images/`.

### 3. Crear la integración privada

En Kommo, como **administrador**:

1. **Ajustes → Centro de integraciones → + CREAR INTEGRACIÓN**.
2. **URL de redireccionamiento**: dejarla **vacía**.
   La documentación oficial es explícita: *si vas a usar un token de larga
   duración, no escribas nada en Redirect URL*. Nuestro backend usa el token de
   n8n, no el flujo OAuth del widget.
3. **Acceso webhook de notificación revocada**: vacío.
4. **Permitir acceso**: «Todos los» (o los ámbitos mínimos: contactos y leads).
5. **Subir → Integración con código personalizado**: elegir
   `dist/duplicados.zip`.
6. **Control de duplicados**: opcional. Activarlo añade la red de seguridad
   extra de Kommo al crear leads. Si se activa, hay que configurar las reglas
   de duplicado en el pipeline.
7. **Fuentes múltiples**: desmarcado.
8. **Idioma**: Español.
9. **Nombre de integración**: `UNYX · Verificar Cliente`.
10. **Descripción**: «Verifica si un cliente ya posee una atención activa antes
    de crear un nuevo lead.»
11. **Guardar**. Kommo muestra las claves en la pestaña *Claves y ámbitos*:
    Integration ID, Secret key y **Widget code** (el widget code lo usa Kommo
    internamente; no hay que copiarlo a ninguna parte).

### 4. Instalar y configurar en la cuenta

1. Buscar el widget en la lista de integraciones de la cuenta e instalarlo.
2. En los ajustes del widget, *URL de los webhooks de n8n*:
   `https://flow.unyxsolutions.com/webhook/unyx-<cliente>`.
3. Abrir la ficha de un contacto: el card debe aparecer en el panel derecho.

### 5. Repetir por cliente

Cada cuenta de Kommo necesita su propia integración privada y su propia subida
del ZIP (las integraciones privadas no se comparten entre cuentas). El ZIP es
el mismo; solo cambia la URL de los webhooks.

## Vista previa local

```bash
cd unyx/duplicados
python -m http.server 8080
```

Abrir `http://localhost:8080/`. Sin backend configurado, `preview.js` simula las
respuestas según el último dígito: **1** disponible, **2** mismo asesor,
**3** otro asesor, **4** varios leads, **5** disponible que falla al crear,
cualquier otro disponible.

Para probar contra n8n real, en la consola del navegador:

```js
window.UNYX_PREVIEW_API = 'https://flow.unyxsolutions.com/webhook/unyx-meditec'
```

y recargar.

## Logos

`images/*.png` son marcadores generados con
`infrastructure/scripts/generate-placeholder-logos.ps1`. Sustituir por los
oficiales de UNYX respetando:

| Archivo | Medida |
|---|---|
| `logo_main.png` | 400×272 |
| `logo_medium.png` | 240×84 |
| `logo_min.png` | 84×84 |
| `logo.png` | 130×100 |
| `logo_small.png` | 108×108 |

PNG, cada uno por debajo de 300 KB. `logo_min.png` es obligatorio en widgets de
tarjeta: si falta, Kommo da error al inicializar.

## Archivos

| Archivo | ¿Va en el ZIP? | Para qué |
|---|---|---|
| `manifest.json` | sí | metadatos, ubicaciones y campo `n8n_base` |
| `script.js` | sí | widget AMD (`render`, `init`, `bind_actions`) |
| `style.css` | sí | card compacto, máximo 380 px, altura según contenido |
| `i18n/es.json` | sí | textos de interfaz e instalación |
| `images/` | sí | los 5 PNG |
| `index.html`, `preview.js` | no | vista previa local |
| `README.md` | no | este documento |
