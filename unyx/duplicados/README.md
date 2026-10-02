# UNYX · Verificar Cliente — widget de Kommo

Integración **privada** de Kommo. El asesor ingresa un celular ecuatoriano
(`+593` + 9 dígitos) y el widget comprueba si el cliente ya tiene una atención
activa antes de permitir crear un lead.

Se muestra como panel lateral en la ficha de contacto (`ccard-1`) y en
cualquier lead (`lcard-1`).

**Un mismo ZIP sirve para todas las cuentas** (Altosa, Meditec, LuxViajes…).
Cada cuenta crea su propia integración privada, sube este ZIP y configura en
los ajustes la URL de los webhooks y su token. Del lado de n8n hay **un solo par
de workflows generales**: el cliente se decide por el token.

## Estado real del proyecto

| Pieza | Estado |
|---|---|
| Interfaz del card y los 8 estados | **Hecho** (`script.js`, `style.css`, `i18n/es.json`) |
| Llamadas del widget a n8n | **Hecho** (vía `self.crm_post`, sin CORS) |
| Workflows de n8n | **Hechos**: un par por cliente (UNYX es la madre) |
| Reglas de negocio probadas sin n8n | **Hecho** (102 comprobaciones) |
| Bug de carga en Kommo | **Corregido** (ver abajo); pendiente de confirmar en la cuenta real |
| Logos oficiales | **Hecho** desde `images/unyx.png`; falta un isotipo cuadrado para `logo_min`/`logo_small` |

## El bug de carga en Kommo: causa y arreglo

**Síntoma**: al renderizarse el widget, la interfaz de Kommo (menú lateral, área
de leads) quedaba congelada o mal renderizada hasta recargar con F5.

**Causa**: el `style.css` venía del prototipo, escrito para una página propia, y
empezaba así:

```css
:root { font-family: Inter, Arial, sans-serif; color: #1e293b; }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; background: #f1f3f5; }
```

El script de un widget de Kommo **se ejecuta en la misma página que Kommo** (no
dentro de un iframe), así que ese CSS se aplicaba a toda la aplicación: `body`
con `padding` y fondo, `*` cambiando el `box-sizing` de todo, y `:root`
redefiniendo la tipografía global. Además había clases sin prefijo (`.button`,
`.link`, `.status`, `.heading`, `.small`) que chocan con las de Kommo, y la hoja
se inyectaba en `document.head`, de modo que seguía aplicándose incluso al salir
del widget. Eso explica también que fuera intermitente: el daño empezaba en el
momento exacto en que el widget se renderizaba.

**Arreglo aplicado**:

1. `style.css` reescrito: **todo** selector arranca por `.unyx-widget`, y las
   clases internas llevan prefijo (`unyx-card`, `unyx-button`, `unyx-status`…).
   Sin `body`, `html`, `:root` ni `*` sueltos. Las variables CSS viven en
   `.unyx-widget`, no en `:root`. Los `@keyframes` se renombraron a `unyx-spin`
   (los nombres de keyframes son globales).
2. La hoja se inserta **dentro del markup del widget** (patrón del ejemplo
   oficial), no en `document.head`: vive y muere con el widget.
3. `script.js` dejó de usar selectores globales: cada instancia se identifica
   con un id único y todos los elementos se buscan desde su raíz
   (`data-unyx="..."`). Ya no usa `document.head`, `document.body`,
   `document.documentElement` ni `window`.
4. `render` ahora devuelve **`false`** en las fichas de creación
   (`APP.data.current_card.id == 0`), como pide la documentación, para no
   inicializarse donde no corresponde.

Hay comprobaciones automáticas que fallan si alguien vuelve a meter un selector
global, una clase sin prefijo o un acceso a `document.head`/`body`.

**Sin confirmar**: el arreglo está verificado por análisis y por pruebas
estáticas, pero **no probado en la cuenta real**. Faltan dos cosas por
descartar si el síntoma persistiera: que Kommo no reciba bien el `<link>` dentro
del panel del widget, y que alguna extensión del navegador interfiera.


## Arquitectura

```text
Widget (dentro de Kommo)        n8n (un par por cliente)        Kommo API v4
  script.js
     │  self.crm_post(form)
     └──────────────────────►  /webhook/unyx/verificar-cliente
                                  │ ¿Autorizado? (token + cuenta)
                                  │ contacts?query=…&with=leads
                                  │ leads?filter[id][]=…
                                  │ users
                                  ▼
                               available | same_agent | other_agent | multiple_leads
     │  self.crm_post(form)
     └──────────────────────►  /webhook/unyx/crear-lead
                                  │ REVALIDA
                                  │ contacts (reutiliza o crea)
                                  │ leads (asigna al asesor)
```

- El token de Kommo de cada cliente vive **sólo en una credencial de n8n**. El
  widget no contiene credenciales ni llama a la API de Kommo.
- Se usa `self.crm_post` (proxy de Kommo) en vez de `fetch`: no hay CORS.
- El asesor actual se toma de `self.system().user_id`; n8n lo usa como
  `responsible_user_id` y `created_by` del lead nuevo.
- El primer nodo de cada workflow identifica al cliente por el token del widget
  y comprueba que la cuenta coincida: el token de un cliente no puede operar en
  la cuenta de otro.

## Configuración del widget

Dos ajustes, ambos obligatorios al instalar:

| Ajuste | Valor |
|---|---|
| *URL de los webhooks de n8n* | `https://flow.unyxsolutions.com/webhook/unyx` — **igual para todos los clientes** |
| *Token de acceso de esta cuenta* | el token que pegaste en el nodo `¿Autorizado?` del workflow |

El widget añade `/verificar-cliente` y `/crear-lead` a esa URL.

Si falta cualquiera de los dos, el widget muestra «configuración incompleta» y no
llama a ningún sitio: no hay URL por defecto (para que una cuenta no termine
pegándole al webhook equivocado) ni token por defecto (para que un workflow sin
configurar no quede accesible desde internet).

**Cómo se genera el token del widget:** lo generas tú, uno por cliente, con
`[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()`
en PowerShell. El detalle completo, incluido de dónde sale el token de Kommo,
está en `unyx/n8n/README.md` → sección **«Los dos tokens»**.

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
   `https://flow.unyxsolutions.com/webhook/unyx` (igual para todos) y el
   *Token de acceso* de esa cuenta.
3. Abrir la ficha de un contacto: el card debe aparecer en el panel derecho.

### 5. Repetir por cliente

Cada cuenta de Kommo necesita su propia integración privada y su propia subida
del ZIP (las integraciones privadas no se comparten entre cuentas). El ZIP y la
URL de los webhooks son los mismos para todos; lo único que cambia por cuenta es
el *Token de acceso*.

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
window.UNYX_PREVIEW_API = 'https://flow.unyxsolutions.com/webhook/unyx'
```

y recargar.

## Logos

Los cinco PNG se generan desde el logo oficial de UNYX
(`images/unyx.png`) con `infrastructure/scripts/build-widget-logos.ps1`, que
ajusta el logotipo dentro de cada lienzo conservando la proporción:

```powershell
pwsh -File infrastructure/scripts/build-widget-logos.ps1
# o desde otro archivo:
pwsh -File infrastructure/scripts/build-widget-logos.ps1 -Source ruta\al\logo.svg
```

Medidas exigidas por Kommo:

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
| `manifest.json` | sí | metadatos, ubicaciones y campos `n8n_base` y `unyx_token` |
| `script.js` | sí | widget AMD (`render`, `init`, `bind_actions`) |
| `style.css` | sí | card compacto, máximo 380 px, altura según contenido |
| `i18n/es.json` | sí | textos de interfaz e instalación |
| `images/` | sí | los 5 PNG |
| `index.html`, `preview.js` | no | vista previa local |
| `README.md` | no | este documento |
