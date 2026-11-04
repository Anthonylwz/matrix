# IDEAS Alumnos 4.2.4 — Conexión con datos móviles y con Wi-Fi

## Lo que no se pudo verificar desde aquí

- Este entorno no tiene celular, SIM ni Wi-Fi.
- Su red bloquea `asistencia.tiendaideas.com`, incluida la consulta DNS.
- Por eso **no hay mediciones de la conexión real**: todas las cifras de este documento son de un servidor
  simulado.
- Para tener cifras reales de tu celular, con datos móviles y con Wi-Fi, esta versión agrega
  **«Probar conexión»** (ver abajo).

## Cómo se conecta la APK (revisión del código nativo)

Se revisó el código Java de la APK descompilada (`MainActivity`, `NetBridge`, `AutoServerDiscovery`) y
`native-bridge.js`.

| Aspecto | Qué hace |
|---|---|
| Red que usa | Con el servidor público (por defecto `https://asistencia.tiendaideas.com/`), la red activa de Android: Wi-Fi si está conectado y tiene Internet; si no, datos móviles. La app no fuerza ninguna. |
| Servidor con IP local (192.168.x.x) | Va siempre por Wi-Fi; solo con datos móviles no se alcanza, como es de esperar. |
| Camino de cada consulta | La parte web llama a `fetch`. `native-bridge.js` la pasa a `AndroidNet.request`, y Java la envía con `HttpURLConnection`. |
| Consultas a la vez | 4 hilos nativos; una quinta consulta espera a que se libere uno. |
| Tiempos de espera | 8 s para conectar y 30 s para recibir. La parte web corta la mayoría de las consultas a los 15 s (algunas a los 5, 8 o 30 s), y la cancelación llega a Java. |
| Caché y redirecciones | Sin caché HTTP; no sigue redirecciones. |
| Comprobación al abrir | Al abrir la app y al volver a ella (como máximo cada 30 s), pide `estado_servidor.php` hasta 3 veces (3 s cada una, 2,5 s entre intentos). Si fallan las 3, muestra «Sin conexión. Toca Configurar servidor…» a los ~14 s. |

Riesgos encontrados:

1. **Al cambiar de red, una consulta puede fallar aunque haya señal.**
   - La parte nativa no escucha cambios de red.
   - Todas las consultas de la app son POST, y Android no repite un POST que salió por una conexión ya
     cortada. Pasa al pasar de Wi-Fi a datos (o al revés) y tras un rato sin uso con datos móviles.
   - Se ve «Sin conexión con el servidor» aunque haya señal. **Mitigado en esta versión** (ver «Reintento
     seguro»).
2. **Aviso falso al abrir con señal débil.**
   - Con datos móviles débiles (3G/2G), 3 s por intento pueden no alcanzar, y aparece el aviso «Sin
     conexión» aunque la app sí funcione: sus consultas esperan más.
   - No bloquea la app. Está en el código Java, así que cambiarlo requiere recompilar la APK en una PC con
     Android SDK (`crear_apk_alumnos.py`).

## Qué cambió

### 1. «Probar conexión»

Está en la pantalla de ingreso y en Perfil del trabajador, del personal (admin) y del alumno.

- **Red:** eliges Wi-Fi o Datos móviles; se marca sola según lo que informa Android. Si eliges «Datos
  móviles» con el Wi-Fi encendido, avisa que hay que apagarlo, porque Android seguiría usando el Wi-Fi.
- **Qué mide:** 13 consultas a `estado_servidor.php` (una primera, 8 seguidas y 4 a la vez), por el mismo
  camino que el resto de la app (en la APK, el puente nativo).
- **Resultado:**
  - Buena: hasta 0,5 s.
  - Aceptable: hasta 1,2 s.
  - Lenta: hasta 3 s.
  - Muy lenta: más de 3 s.
  - Inestable: 3 fallos o más.
- **Motivos de cada fallo:**
  - sin conexión;
  - más de 10 s;
  - la red redirige (Wi-Fi con página de acceso);
  - respuesta que no es del servidor;
  - error del servidor.
- **Comparación:** la última prueba con Wi-Fi y la última con datos móviles del mismo servidor (en ese
  celular, 7 días).
- **«Copiar resultado»:** un texto para pegar en un mensaje, sin DNI, nombre, contraseña ni token.
- **Privacidad y peso:** no usa la cuenta. El módulo se descarga solo al abrir la prueba, así que no pesa
  en el arranque.

### 2. Reintento seguro

Si una consulta de **solo lectura** no recibe respuesta, se repite una vez a los 0,4 s, dentro del mismo
tiempo máximo:

- **Trabajador:** perfil, jornada, historial, permisos, correcciones, notificaciones, anuncios y cambios.
- **Personal:** panel, búsquedas, fichas y lectura de fotocheck.
- **Alumno:** perfil y cambios.

Nunca se repiten: marcar asistencia, ingresar, salir, ni enviar o cambiar nada.

## Cómo hacer la prueba en el celular

1. Instala la APK 4.2.4.
2. Con Wi-Fi: Perfil → **Probar conexión** → **Iniciar prueba**.
3. Apaga el Wi-Fi (deja solo datos móviles) → **Repetir prueba**. Verás la comparación.
4. **Copiar resultado** y envíalo para analizarlo.
5. Si puedes, repítela dentro y fuera de la sede, y a distintas horas.

Para que el servidor se pueda medir también desde este entorno, hay que permitir `asistencia.tiendaideas.com`
en el acceso a red del entorno (menú del entorno → Editar → Acceso a red → Dominios permitidos).

## Pruebas (servidor simulado)

- `scripts/test_prueba_conexion.cjs` (nuevo). Cubre:
  - prueba con Wi-Fi, luego con datos móviles, y su comparación;
  - aviso cuando la red elegida no coincide con la activa;
  - texto copiado sin datos personales;
  - cancelación al cerrar la hoja;
  - motivos de fallo (corte de red, redirección de portal Wi-Fi, respuesta ajena);
  - sin solapes a 320 px y en modo oscuro;
  - reintento solo de lectura en las tres apps, y nunca de marcación, ingreso ni escritura;
  - botón Atrás de Android.
- `test_navidad_ui.cjs` y `test_conexion.cjs` pasan.
- Las pruebas del proyecto dan el mismo resultado que el original: 26 pasan.
- Todo pasa también con los archivos extraídos de la APK.
- 0 solapes en 48 pantallas (claro, oscuro y 320 px).
- **Arranque** (CPU ×4, 4.2.3 y 4.2.4 alternadas en la misma ejecución): sin cambio medible. Las
  diferencias entre versiones (de −20 a +80 ms, casi todas en ±30 ms) son del mismo orden que entre dos
  ejecuciones de la misma versión.
- **Navegación del trabajador:** 88 ms de mediana (89 ms en 4.2.3).
- **Corrección:** `medir_arranque.cjs`, `medir_navegacion.cjs` y `medir_rendimiento_navidad.cjs` guardaban
  al trabajador simulado sin servidor, y la app lo mandaba al ingreso. Las cifras publicadas en la 4.2.3 se
  tomaron con la versión anterior de estas herramientas, que no tenía el problema.

## APK

- `ideas-alumnos-prueba-4.2.4.apk` (versionCode 42004).
- Misma firma: `debug.keystore`, certificado SHA-256
  `43d146063e836613658a010ba307e0f8517fc0af9d2df8f480efb13c1e3cf5fe`. Se instala encima de cualquier
  versión anterior.
- **No se probó en un celular físico.**

Para la web, subir la carpeta `pwa/`:

- nuevos: `js/connection-test.js`, `js/net-retry.js`;
- cambiaron: `index.html`, `service-worker.js`, `css/app.css`, `js/api.js`, `js/app.js`, `js/entry.js`,
  `js/icons.js`, `js/staff-api.js`, `js/staff-app.js`, `js/student-api.js`, `js/student-app.js`,
  `js/utils.js`, `pages/login.js` y `pages/profile.js`.

`public/` no cambió.
