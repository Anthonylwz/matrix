# IDEAS Alumnos 4.2.1 — Animaciones navideñas optimizadas y más fluidas

Misma Navidad que la 4.2.0, ahora fluida también en celulares de gama media y baja.
Sigue sin tapar nada (0 solapes en 48 pantallas: claro, oscuro y 320 px).

## Qué estaba mal (medido con el perfilador de Chrome)

En un celular de gama media simulado (CPU 4 veces más lenta), el Modo Navidad de la 4.2.0
hacía caer la app a 18–30 fps, con hasta 85 cuadros lentos cada 5 s. Sin Navidad, la app iba a 60 fps.

1. **77 animaciones no podían ir por la GPU**: el vaivén de las bombillas animaba una variable
   CSS (`--sw`), el brillo de la guirnalda del árbol usaba `stroke-dashoffset` y el de la
   cuenta regresiva, `background-position`. Cada una obligaba a recalcular estilos en cada cuadro.
2. **Animaciones dentro de los SVG** (luces y adornos del árbol, partes del muñeco, patas de
   los renos, ala del pingüino…): Chrome repinta el dibujo entero en cada cuadro, unas 600
   veces cada 5 s en la pantalla de la escena.
3. **310 animaciones activas a la vez**: aunque vayan por la GPU, cada una suma trabajo por cuadro.

## Qué se hizo

- **Todo por la GPU** (solo `transform` y `opacity`).
  - El vaivén usa `var(--rot)` dentro de los fotogramas.
  - La cuenta regresiva brilla con una franja de luz que se desliza.
  - La aurora no usa desenfoque animado.
- **Piezas por capas**: cada parte que se mueve es un SVG o elemento propio, así la GPU la mueve sin repintar.
  - Árbol: base, dos grupos de luces, destello de la estrella y gota de nieve.
  - Muñeco: cuerpo, brazo, cabeza, ojos, sombrero, bufanda y vaho.
  - Otras piezas: patas de cada reno, ala del pingüino y brillo de la ventana.
- **Menos animaciones, el mismo efecto** (310 → unas 130):
  - **Luces en 4 fases**, como un controlador real: cada fase se enciende y se mece como grupo.
    Las luces siguen «corriendo» por la guirnalda, con 8 animaciones por guirnalda en vez de 32.
  - **Copos**: caída y vaivén en una sola animación, que sigue una curva suave.
  - **Estrella**: el halo y los rayos son un solo destello que gira y late.
  - **Escarcha**: el brillo solo aparece en una de cada tres tarjetas.
- **Pausa fuera de pantalla** también en las esferas y en los íconos de los títulos.
- **Modo ligero automático** en celulares con ≤ 3 GB de memoria, ≤ 4 núcleos o «ahorro de datos»:
  la mitad de copos y un 25 % menos de bombillas.
- **JS más liviano**:
  - el observador ya no se activa con cambios de clase ajenos (por ejemplo, la barra al desplazarse);
  - la foto de perfil solo mide su tamaño al crearse o al cambiar el tamaño de la pantalla, en vez
    de forzar un recálculo de diseño en cada revisión;
  - sin `will-change` permanente.

## Animaciones mejoradas

- Encendido tipo bombilla incandescente: prende rápido y se apaga lento.
- Copos estrella que aletean en 3D mientras caen.
- Estela de polvo de estrellas detrás del trineo.
- Destello de la estrella del árbol con rayos que giran.
- Parpadeo doble y natural del muñeco de nieve.
- Aparición suave al encender el Modo Navidad.

## Resultados (perfilador de Chrome, 5 s por pantalla, calidad completa)

Celular de gama media simulado (CPU ×4):

| Pantalla | fps 4.2.0 → 4.2.1 | Cuadros lentos | Repintados |
|---|---|---|---|
| Hoy (arriba) | 30 → **60** | 19 → 0 | 0 → 4 |
| Hoy con la escena | 18 → **59** | 82 → 0 | 626 → 4 |
| Perfil (admin) | 25 → **60** | 50 → 0 | 384 → 4 |
| Alumno con la escena | 18 → **59** | 85 → 0 | 630 → 0 |
| Trabajador | 29 → **60** | 21 → 0 | 0 → 0 |

Celular de gama baja simulado (CPU ×6), pantalla con la escena: 8–9 fps → **41–43 fps**
con calidad completa y **48–49 fps** con el modo ligero.

Las mediciones son en Chrome de escritorio sin pantalla, con la CPU limitada. Sirven para
comparar versiones, pero no reemplazan probar en un celular real.

Para repetirlas: `node scripts/medir_rendimiento_navidad.cjs full,lite,off` (requiere Playwright).

## APK

`ideas-alumnos-prueba-4.2.1.apk` (versionCode 42001), misma firma (`debug.keystore`, certificado
SHA-256 `43d146063e836613658a010ba307e0f8517fc0af9d2df8f480efb13c1e3cf5fe`); se instala encima
de cualquier versión anterior. Firma v2 verificada; código nativo idéntico a la 4.1.7.
**No se probó en un celular físico.**

Para la web, subir `public/ideas-season.js`, `public/ideas-season.css` y `pwa/`.
