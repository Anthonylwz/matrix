# IDEAS Alumnos 4.2.0 — Navidad integrada en las tarjetas y con vida

Sigue la regla de las versiones anteriores: **ningún adorno tapa contenido**. Se midió en
48 pantallas (claro, oscuro y 320 px) comparando cada adorno contra cada línea de texto,
ícono, foto, campo e interruptor reales, con prueba de pintado (`elementFromPoint`): 0 solapes.
La prueba se validó forzando un solape a propósito, que sí detectó.

> Versión 4.2.0 y no 4.1.10: el empaquetado edita el AndroidManifest en binario y exige que
> el número de versión tenga el mismo largo que el de la APK base (5 caracteres).

## Decoraciones nuevas, acopladas a la app

| Decoración | Dónde (espacio libre o propio) |
|---|---|
| Escarcha con gotitas en el borde superior de cada tarjeta, con un destello ocasional. Tono hielo en modo claro y blanco en oscuro. | Relleno superior vacío de las tarjetas (≤ 10 px); evita los extremos y la columna de íconos. Usa `::before`/`::after`: no cambia la estructura de la tarjeta. |
| Esfera colgante que se mece, de un color distinto en cada tarjeta | Esquina superior derecha (libre) de las tarjetas de estadísticas |
| Íconos animados junto a los títulos de sección: esfera, estrella, bastón, regalo, campana y copo | En línea, después del texto del título |
| Pie nevado: farol con luz cálida y corona, montículo de nieve con textura, árboles, regalo y nieve | Sección nueva al final de las pantallas que no tienen la escena (Alumnos, Equipo, Perfil, Historial…) |
| Pingüino con bufanda y gorro que camina de un lado a otro, se balancea y mueve las alas | Dentro del pie nevado |
| Nubes que cruzan el cielo | Escena «¡Felices fiestas!», carriles por encima y por debajo del texto |
| Cielo según la hora de Lima: de día (sol con rayos que giran), atardecer y noche (luna, estrellas, aurora) | Escena |

## Animaciones que dan vida

- **Árboles**: se mecen desde el tronco como si hubiera viento, tienen luces propias que corren
  por la guirnalda, la guirnalda dorada brilla en movimiento y de vez en cuando cae nieve de
  las ramas.
- **Muñeco de nieve**: respira, parpadea con brillo en los ojos, mira a un lado, saluda con la
  mano, se quita el sombrero, la bufanda ondea, echa vaho por el frío y tiene mejillas y sonrisa.
- **Luces**: 4 programas que se alternan cada 10 s (cadena, destello, alterno y respiración),
  como un controlador real de luces navideñas.
- **Viento**: cada 15–26 s una ráfaga desvía la nieve, inclina los árboles y agita la bufanda.
- **Regalos**: dan un saltito cada tanto, cada uno a su ritmo.
- **Tocar la escena**: celebración de 2 s. Los árboles se sacuden, los regalos saltan, el
  muñeco saluda y se quita el sombrero, las luces destellan, cae una ráfaga de nieve y suenan
  campanitas (no suenan si la música navideña está apagada).

Todo se anima con `transform` y `opacity`, y se pausa fuera de la pantalla. Con «Movimiento
reducido» queda quieto, sin programas de luces ni viento. Al apagar el Modo Navidad se
quitan también la escarcha y los programas de luces.

## Archivos

- `public/ideas-season.js`, `public/ideas-season.css`: decoraciones y animaciones.
- `pwa/js/utils.js`, `pwa/index.html`, `pwa/service-worker.js`: versión 4.2.0 y caché
  (`ideas-season ?v=28`).
- `scripts/test_navidad_ui.cjs`: cubre las piezas nuevas, la celebración y su limpieza.

## APK

`ideas-alumnos-prueba-4.2.0.apk` (versionCode 42000), misma firma (`debug.keystore`, certificado
SHA-256 `43d146063e836613658a010ba307e0f8517fc0af9d2df8f480efb13c1e3cf5fe`). Se instala encima
de la 4.1.7, 4.1.8 o 4.1.9. Firma v2 verificada; código nativo idéntico a la 4.1.7.
**No se probó en un celular físico.**

Para la web, subir `public/ideas-season.js`, `public/ideas-season.css` y `pwa/`.
