# IDEAS Alumnos 4.1.8 — Revisión y Navidad sin superposiciones

Esta carpeta contiene la parte web editable de la APK (`pwa/` y `public/`), igual que en
`03_APK/proyecto_apk`, con los cambios de esta versión. **No** incluye la firma, claves,
configuración de Firebase ni bases de datos: esos archivos siguen solo en el paquete privado.

## Fallos corregidos

| Dónde | Fallo | Corrección |
|---|---|---|
| Todas las vistas | Las luces, la estrella, el árbol y los muñecos de nieve eran una capa fija encima de la pantalla: tapaban la barra superior, el botón de actualizar, tarjetas, la barra de pestañas y el menú de «Cerrar sesión». | Se eliminó la capa fija. Las decoraciones solo ocupan espacios reservados (ver abajo). Medido automáticamente: 0 solapes con botones, textos o barras. |
| Admin / personal | «Cerrar sesión» salía al instante, sin preguntar. | Hoja de confirmación con texto específico para administradores, botón bloqueado mientras se cierra y protección contra doble toque. |
| Panel web de administración | El cierre de sesión no pedía confirmación. | `ideas-season.js` muestra un diálogo antes de seguir cualquier enlace o formulario hacia `logout.php`, `cerrar_sesion.php` o `salir.php` (Esc o «Cancelar» lo cierran). No actúa si el panel ya hace su propia confirmación. |
| Admin «Hoy» | Cada 60 s, y al volver a la app, la pantalla pasaba a esqueleto de carga y perdía el desplazamiento. | Actualización en segundo plano: sin parpadeo, mantiene la posición; si falla, conserva los datos y avisa con un mensaje. El botón ↻ gira mientras actualiza y la nota inferior muestra «Actualizado hh:mm». |
| Admin / Perfil | Cambiar el tema llevaba la pantalla al inicio. | Se conserva la posición. |
| Música navideña | Al ir a «Alumnos» o «Equipo» la app creía que la sesión se había cerrado; al volver a «Hoy» la música sonaba otra vez. | La sesión se detecta por el modo de la app, no por la pestaña visible. Suena una vez por sesión. |
| Modo Navidad | La capa nueva podía re-evaluarse en cada fotograma (bucle de mutaciones). | Solo se cambian clases y estilos cuando difieren; verificado: 0 mutaciones en reposo. |
| Ficha de alumno (admin) | Fallaba si el servidor no enviaba `matriculas`. | Se trata como lista vacía. |
| Admin «Hoy» | Sin nombre registrado mostraba «undefined». | Saludo alternativo. |
| Sesión vencida (admin) | Pantalla sin estilo. | Pantalla con el diseño de la app y botón «Iniciar sesión». |
| Trabajadores «Hoy» | La fecha y el saludo usaban la zona horaria del celular (con otra zona mostraba otro día). | Hora de Lima, igual que en las apps de alumnos y personal. |

## Mejoras de interfaz

- Marcaciones de hoy: el estado se colorea (Puntual en verde, Tardanza en naranja).
- Buscadores de alumnos y equipo: teclado con botón «Buscar», sin autocorrección.
- Sin conexión: el indicador superior cambia a «Sin conexión» al momento.

## Navidad: decoraciones nuevas (ninguna tapa nada)

- **Foto de perfil** (alumnos, personal/admin y trabajadores): aro de luces con casquillo y
  reflejo, moño rojo arriba y dos árboles con regalos a los lados. El aro queda detrás de la
  foto y deja libre el botón de cámara. Al activarse se reserva el margen necesario, así que el
  nombre no se mueve debajo de las luces. En pantallas muy angostas los árboles se ocultan solos.
- **Tarjeta de bienvenida**: guirnalda en el relleno superior, nieve que cae detrás (se
  desvanece antes de la columna del saludo), textura de puntos y montículo de nieve.
- **Escena «¡Felices fiestas!»** al final de «Hoy»: tarjeta propia con cielo nocturno
  texturizado, luna que brilla, colinas nevadas, árboles con estrella y adornos que titilan,
  regalos, muñeco de nieve que parpadea y saluda, guirnalda y nieve continua.
- **Detalles en línea**: acebo junto a la fecha de «Hoy», guirnalda sobre el logo del login y,
  en el panel web, dentro de la marca de la barra lateral.
- Respeta «Movimiento reducido», el modo oscuro, el apagado global del administrador y se
  oculta en el escáner. Se apaga desde Perfil → Navidad.

## Archivos modificados

- `public/ideas-season.js`, `public/ideas-season.css` — reescritos.
- `pwa/js/staff-app.js` — confirmación de cierre, refresco silencioso y correcciones.
- `pwa/css/staff-app.css` — estilos nuevos al final.
- `pwa/js/utils.js` — versión 4.1.8; fecha y saludo en hora de Lima.
- `pwa/js/student-settings.js`, `pwa/pages/profile.js` — texto del interruptor Navidad.
- `pwa/index.html`, `pwa/service-worker.js` — versión 4.1.8 y caché (`ideas-season ?v=26`).

## Compilar y publicar

APK ya generada: `ideas-alumnos-prueba-4.1.8.apk` (versionCode 41008), firmada con el mismo
`firma/debug.keystore` (certificado SHA-256 `43d146063e836613658a010ba307e0f8517fc0af9d2df8f480efb13c1e3cf5fe`),
así que se instala encima de la 4.1.7 sin desinstalar. Firma v2 verificada con `apksig` y
`apksigtool` (minSdk 26, no necesita v1). El código nativo, los recursos y Firebase son
idénticos byte a byte a la 4.1.7. **No se probó en un celular físico.**

Para regenerarla sin Android SDK (solo Python 3 y Java):

```bash
python scripts/reempaquetar_apk.py --base dist/ideas-alumnos-prueba-4.1.7.apk \
  --keystore firma/debug.keystore --apksig apksig-2.3.0.jar --out dist/ideas-alumnos-prueba-4.1.8.apk
```

`apksig-2.3.0.jar` se descarga de Maven Central
(`com/android/tools/build/apksig/2.3.0`, SHA-1 `6ef7a58375aa68fb492b58edd97607bee8ee5c5c`).
Con Android SDK sigue valiendo `crear_apk_alumnos.py` con `VERSION='4.1.8'` y `VERSION_CODE=41008`.

**Web (asistencia.tiendaideas.com):** subir también `public/ideas-season.js` y
`public/ideas-season.css`, que usan la PWA y el panel de administración, y la carpeta `pwa/`.

## Pruebas

- `node scripts/test_navidad_ui.cjs` (Playwright + Chromium, servidor simulado): cierre de sesión
  del admin (cancelar/confirmar), refresco silencioso, Modo Navidad (sin capas fijas, apagado,
  escáner, sin bucles) y diálogo del panel web. Pasa también con los archivos extraídos de la APK.
- Las pruebas existentes de `scripts/` dan el mismo resultado antes y después (26 pasan; las 4
  que fallan ya fallaban: necesitan archivos del servidor que no están en el paquete, Microsoft
  Edge, o prueban los murciélagos de Halloween que ya no existen).
