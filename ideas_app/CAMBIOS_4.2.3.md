# IDEAS Alumnos 4.2.3 — Auditoría de rendimiento y optimización

Auditoría de toda la app (no solo la Navidad) con el perfilador de Chrome y un celular de
gama media simulado (CPU 4 veces más lenta). Se midió primero, se optimizó lo que de verdad
pesaba y se volvió a medir con el mismo método.

## Qué se encontró

| Área | Hallazgo |
|---|---|
| Arranque | La Navidad creaba ~500 elementos y arrancaba sus animaciones **antes** de la primera pantalla: +340 ms con CPU ×4. |
| Arranque | Admin y alumno descargaban y compilaban los ~35 módulos de la app del trabajador (≈330 KB de JS que nunca usan). |
| Cambio de pestaña | Con Navidad tardaba el triple: los adornos de la pantalla nueva se colocaban antes de mostrarla. |
| Cambio de pestaña (trabajador) | El enrutador marca `inert` la pantalla que sale y fuerza un recálculo de estilos síncrono: **844 elementos** con Navidad (251 sin ella). |
| Estabilidad visual | En la 4.2.2 el contenido del inicio del trabajador saltaba 8 px al llegar el relleno del héroe. |
| Fugas de memoria | **Ninguna.** Nodos, escuchas y memoria se estabilizan tras la primera visita a cada pestaña (medido a las 10, 20 y 30 vueltas). |
| Reposo | La app no gasta nada en reposo (1 ms de CPU en 20 s, sin peticiones fuera de sus consultas periódicas). |

## Qué se optimizó

1. **Precarga según la cuenta** (`index.html`): un pequeño script lee la sesión guardada y precarga solo
   los módulos de ese perfil (personal 17, alumno 23; el trabajador y la pantalla de ingreso, los de
   siempre menos `staff-app.js`).
2. **Adornos después del primer pintado**: la pantalla aparece primero. Los adornos se colocan en el
   siguiente momento libre del procesador (`requestIdleCallback`, máx. 0,5 s) y nunca durante una
   transición, con un fundido breve.
3. **Espacio reservado desde el CSS** (`html.ideas-navidad`): la guirnalda superior (ahora en posición
   absoluta), el relleno del héroe y el margen de la foto existen desde el primer cuadro, así que los
   adornos no mueven nada al aparecer. Solo se decora de forma síncrona cuando hay que restaurar una
   posición de desplazamiento distinta de cero.
4. **Adornos de la pantalla que sale ocultos antes del cambio**: la escucha de `hashchange` de la Navidad
   corre antes que la del enrutador y oculta (`display:none`) sus contenedores. El recálculo forzado baja
   de 844 a 310 elementos.

## Resultados (CPU ×4, misma máquina, misma ejecución por comparación)

Arranque, hasta ver el contenido (mediana de 5 aperturas):

| Perfil | 4.2.2 | 4.2.3 | JS cargado |
|---|---|---|---|
| Inicio de sesión | 520 ms | **401 ms** (−23 %) | 544 → 508 KB |
| Admin (incluye 300 ms de servidor simulado) | 1.039 ms | **647 ms** (−38 %) | 543 → **227 KB** |
| Alumno | 1.100 ms | **721 ms** (−34 %) | 635 → **291 KB** |
| Trabajador | 818 ms | **531 ms** (−35 %) | 539 → 503 KB |

Cambio de pestaña (mediana / p90, 28–35 cambios):

| Perfil | 4.2.2 | 4.2.3 | Sin Navidad (referencia) |
|---|---|---|---|
| Admin | 121 / 196 ms | **41 / 48 ms** | 33 / 50 ms |
| Alumno | 127 / 225 ms | **50 / 66 ms** | 47 / 63 ms |
| Trabajador | 174 / 249 ms | **89 / 115 ms** | 61 / 82 ms |

- **Estabilidad**: 0 saltos de contenido en los tres perfiles, medido cuadro a cuadro con la posición
  de diseño. El método se validó con un control: sin la reserva de espacio detecta saltos de 8 a 26 px.
- **Animaciones**: siguen a 59–60 fps sin cuadros lentos.
- **Solapes**: 0 en 48 pantallas (claro, oscuro y 320 px).

Posible paso futuro (no aplicado): cargar bajo demanda las pantallas del trabajador desde su
enrutador. Ahorraría ~10–15 ms reales de arranque, pero implica reorganizar la navegación.

## Herramientas para repetir las mediciones

- `node scripts/medir_arranque.cjs [perfiles] [cpu] [repeticiones]`
- `node scripts/medir_navegacion.cjs [perfiles] [cpu] [vueltas] [off]`
- `node scripts/medir_rendimiento_navidad.cjs [full,lite,off] [pantallas] [cpu]`

Todas usan Playwright con un servidor simulado (sin datos reales). Son mediciones en Chrome de
escritorio con la CPU limitada: sirven para comparar versiones, pero no reemplazan probar en
un celular real.

## Pruebas

`test_navidad_ui.cjs`, `test_conexion.cjs` y las 26 pruebas del proyecto pasan, también con los
archivos extraídos de la APK.

## APK

`ideas-alumnos-prueba-4.2.3.apk` (versionCode 42003), misma firma (`debug.keystore`, certificado
SHA-256 `43d146063e836613658a010ba307e0f8517fc0af9d2df8f480efb13c1e3cf5fe`); se instala encima
de cualquier versión anterior. **No se probó en un celular físico.**

Para la web, subir `public/ideas-season.js`, `public/ideas-season.css` y `pwa/` (cambiaron
`index.html`, `js/staff-app.js`, `js/student-app.js`, `js/utils.js` y `service-worker.js`).
