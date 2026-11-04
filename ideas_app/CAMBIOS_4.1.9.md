# IDEAS Alumnos 4.1.9 — Más Navidad y animaciones más fluidas

Continúa la 4.1.8 y la regla se mantiene: **ninguna decoración tapa contenido**. Cada pieza
nueva está dentro de su propia tarjeta, en un margen reservado o en línea con el texto.
Comprobado en 16 pantallas (claro, oscuro y 320 px) con una prueba de pintado real
(`elementFromPoint`): 0 adornos encima de botones, textos, barras o menús.

## 13 decoraciones nuevas

| # | Decoración | Dónde |
|---|---|---|
| 1 | Trineo con dos renos que cruza el cielo cada 24 s (galope y vaivén) | Escena «¡Felices fiestas!», carril libre entre la cuenta regresiva y las colinas |
| 2 | Estrella fugaz ocasional | Escena, esquina superior derecha |
| 3 | Estrellas que titilan una por una | Cielo de la escena |
| 4 | Aurora suave verde y azul | Fondo de la escena |
| 5 | Cabaña con ventana encendida que parpadea | Colina de la escena |
| 6 | Humo de chimenea que sube y se disipa | Sobre la cabaña |
| 7 | Bastones de caramelo en la nieve | Escena, junto a los regalos |
| 8 | Cuenta regresiva: «Faltan N días para Navidad» (hora de Lima; mensajes propios el 24, el 25, Año Nuevo y hasta Reyes) | Escena, bajo el saludo |
| 9 | Destellos que recorren el aro de luces de la foto | Perfil (detrás de la foto) |
| 10 | Nieve a los costados de la foto, detrás de los árboles | Perfil, espacio lateral libre |
| 11 | Campanita dorada que se balancea | Junto al acebo de la fecha en «Hoy» |
| 12 | Copo que gira junto a «Modo Navidad» y copitos en la nota inferior | Perfil y pie de cada pantalla |
| 13 | Paisaje nevado con árboles, regalo y muñeco de nieve | Login, bloque propio debajo de todo |

Además: destellos de cuatro puntas en la tarjeta de bienvenida (lado derecho) y halo con
rayos giratorios en la estrella de cada árbol.

## Animaciones de mejor calidad

- **Más fluidas en celulares**: solo se animan `transform` y `opacity` (los mueve la GPU).
  Se quitaron las animaciones de `filter` y `box-shadow`, que repintaban en cada fotograma.
- **Luces en cadena**: el retraso depende de la posición, así que el brillo «corre» por la
  guirnalda; cada bombilla tiene halo propio y se mece con su propio ritmo.
- **Nieve con profundidad**: tres planos (lejos, medio y cerca) con tamaño, opacidad y
  velocidad distintos; la caída y el vaivén lateral son movimientos independientes.
- **Luna y estrellas**: el resplandor late por opacidad, sin repintados.
- **Ahorro de batería**: las animaciones que salen de la pantalla quedan en pausa.
- Con «Movimiento reducido» todo queda quieto y se ocultan nieve, trineo, estrella fugaz y humo.

## Archivos

- `public/ideas-season.js` y `public/ideas-season.css`: decoraciones y animaciones.
- `pwa/js/utils.js`, `pwa/index.html`, `pwa/service-worker.js`: versión 4.1.9 y caché
  (`ideas-season ?v=27`).
- `scripts/test_navidad_ui.cjs`: comprueba también las piezas nuevas.

## APK

`ideas-alumnos-prueba-4.1.9.apk` (versionCode 41009): misma firma (`debug.keystore`, certificado
SHA-256 `43d146063e836613658a010ba307e0f8517fc0af9d2df8f480efb13c1e3cf5fe`); se instala
encima de la 4.1.7 o de la 4.1.8. Firma v2 verificada. Código nativo idéntico a la 4.1.7.
**No se probó en un celular físico.**

Para la web, subir `public/ideas-season.js`, `public/ideas-season.css` y `pwa/`.
