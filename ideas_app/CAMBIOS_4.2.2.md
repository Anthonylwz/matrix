# IDEAS Alumnos 4.2.2 — Invasión navideña y conexión más rápida

## 1. Conexión con el servidor

Medido con un servidor simulado lento (700 ms por petición). El código del servidor (PHP)
no venía en el paquete, así que todo el trabajo es en la app; cada viaje ahorrado vale
lo que tarde el servidor real.

| Situación | Antes | Ahora |
|---|---|---|
| Admin abre la app (ya la usó antes) | esqueleto de carga hasta que responde el servidor (~950 ms) | **contenido a los ~430 ms** y se actualiza en segundo plano |
| Comprobaciones de servidor en la pantalla de ingreso | 2 iguales a la vez | **1** |
| Trabajador abre la app | 8 peticiones compitiendo a la vez | **jornada e historial primero**; las demás esperan a que terminen (máx. 1,5 s) |
| Trabajador desbloquea su celular | 2 viajes (`acceso_app` y luego `login_app`) | **1 viaje** |
| Alumno recién entra | 3 peticiones | **1** |
| Entrada del trabajador | esperaba el cifrado de la clave sin conexión (PBKDF2) | el cifrado va en segundo plano |

Detalles:
- **Panel del admin guardado** (`ideas-personal-panel:v1`):
  - es solo de esa sesión y ese servidor, y caduca a las 12 h;
  - se borra al cerrar sesión o cuando la sesión vence;
  - si la actualización falla, se ven los últimos datos con un aviso.
- **Comprobación de servidor compartida**: las llamadas simultáneas usan la misma petición y una
  respuesta correcta se reutiliza 3 s.
- **Prioridad de red** (`api.js`): permisos, correcciones, notificaciones, anuncios,
  `cambios_app` y `estado_servidor` esperan a las consultas principales. Nunca se descarta una petición.
- **Desbloqueo directo del trabajador**: solo si en ese celular el servidor ya respondió que el DNI es
  **únicamente** de trabajador (pista local sin contraseñas, válida 7 días).
  - Si el servidor ofrece elegir cuenta (por ejemplo, alguien que también es admin), la pista se borra.
  - Si el ingreso directo falla, el siguiente intento usa el acceso normal.
- **Sin saltos al actualizar**: el admin no pierde la posición y las tarjetas no vuelven a
  «aparecer» en cada actualización automática.

Recomendaciones para el servidor (no se pudieron verificar desde aquí): activar compresión
gzip o brotli y HTTP/2, OPcache de PHP, e índices en las tablas que consultan `jornada.php`,
`historial.php` y `personal_app.php`.

## 2. Invasión navideña (sin tapar nada)

- **Nevada de fondo** en todas las pantallas, también en el login.
  - Va por detrás del contenido: se ve entre tarjetas, en los márgenes y bajo los títulos.
  - Copos celestes en modo claro y blancos en oscuro.
  - Se limita a la zona entre las barras, para no forzar su desenfoque en cada cuadro.
- **Ráfagas de nieve** cada 15–26 s y al tocar la escena:
  - copos rápidos que cruzan en diagonal, alargados por la velocidad, y estelas de viento;
  - por el fondo, la tarjeta de bienvenida y la escena;
  - con el viento, la nevada de fondo se acelera, los árboles se inclinan y la bufanda del muñeco ondea.
- **Guirnalda de luces bajo la barra superior** en cada pantalla, en su propio espacio.
- **Escarcha en más superficies**: botones principales, tarjetas de estadísticas, accesos
  (por ejemplo «Consultar alumno») y el borde superior de la barra de pestañas.
- **Acebo** en una de cada tres tarjetas, dentro de la franja de escarcha.

## 3. Animaciones más vivas

- **El muñeco lanza bolas de nieve**: cuando el brazo vuelve adelante, la bola vuela en
  parábola sobre el árbol y estalla en polvo al caer junto a la cabaña.
- **El pingüino da saltitos** mientras camina por el pie nevado.

## Rendimiento (perfilador de Chrome, calidad completa)

Comparado con la 4.2.1 en la misma ejecución, en un celular de gama baja simulado (CPU ×6),
pantalla con la escena e incluyendo una ráfaga:

| | fps |
|---|---|
| 4.2.1 | 59–60 |
| 4.2.2, calidad completa | 56–58 |
| 4.2.2, modo ligero | 59 |

En gama media (CPU ×4): 58–60 fps en todas las pantallas. Mientras dura una ráfaga (3 s), las
animaciones suben de ~150 a ~220 y luego bajan solas.

## Comprobaciones

- 0 solapes con texto, íconos, fotos, campos e interruptores en 48 pantallas (claro, oscuro y 320 px).
- `node scripts/test_navidad_ui.cjs`: decoraciones, ráfagas, celebración, cierre de sesión del
  admin y refresco silencioso sin saltos (±2 px arriba y al final de la página).
- `node scripts/test_conexion.cjs` (nuevo): comprobación compartida, prioridad de red, panel guardado,
  desbloqueo directo, vuelta al acceso normal y vencimiento de la pista.
- Las pruebas del proyecto dan el mismo resultado que el original (26 pasan).
- Ambas suites pasan también con los archivos extraídos de la APK.

## APK

`ideas-alumnos-prueba-4.2.2.apk` (versionCode 42002), misma firma (`debug.keystore`, certificado
SHA-256 `43d146063e836613658a010ba307e0f8517fc0af9d2df8f480efb13c1e3cf5fe`); se instala encima
de cualquier versión anterior. **No se probó en un celular físico.**

Para la web, subir `public/ideas-season.js`, `public/ideas-season.css` y `pwa/` (cambiaron
`js/api.js`, `js/entry.js`, `js/staff-api.js`, `js/staff-app.js`, `js/student-app.js`,
`pages/login.js`, `css/staff-app.css`, `js/utils.js`, `index.html` y `service-worker.js`).
