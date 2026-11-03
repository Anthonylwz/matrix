# Asistencia IDEAS · v4.2.0 (mejorada)

La interfaz web empaquetada en el APK `com.amoi.asistencia.web` (carpeta `assets/`), con mejoras
para todos los roles. No se quitó ninguna función: todo lo que existía sigue disponible.

- `assets/`: archivos web de la app (el primer commit es la copia original, así que el diff muestra solo las mejoras).
- `dist/asistencia-ideas-v4.2.0.apk`: el APK reconstruido y firmado (esquema v2, alineado).
- `tools/`: scripts para reconstruir el APK.

## Mejoras

### Inicio de sesión: el rol se detecta en segundo plano
- El selector "Tipo de cuenta" ya no aparece en pantalla. Se ingresa con DNI o usuario y contraseña, y la
  app reconoce si es alumno, trabajador, administración o personal de intranet.
- El selector manual sigue disponible en **"Elegir tipo de cuenta manualmente"**. La elección dura
  mientras la app esté abierta y se puede volver a **"Detectar automáticamente"**.
- Si los datos corresponden a **varias cuentas**, se muestran tarjetas para elegir y se entra con un toque,
  sin volver a escribir la contraseña. La contraseña queda solo en memoria y se descarta a los 2 minutos.
- Si el acceso pasa al flujo de trabajador y falla, la app vuelve sola al modo automático. Antes quedaba fijada en "Trabajador".
- Si el servidor no responde, el trabajador vinculado a este celular entra por su acceso sin conexión de siempre.
- La app recuerda la última cuenta (nombre, usuario y tipo; **nunca** la contraseña): saluda por el nombre y
  rellena el usuario. En celulares compartidos, **"¿No eres …? Usar otra cuenta"** borra lo recordado.
- Después de entrar se muestra el aviso "Cuenta detectada: Administración · Superadministrador" (o el rol que corresponda).
- Mientras se reconoce la cuenta, el botón dice "Reconociendo tu cuenta…" y después "Entrando como …".

### Administración (panel institucional)
- **Inicio**: saludo según la hora, fecha y tarjetas con íconos que llevan a su sección. Hay una tarjeta
  **"Asistencia de hoy"** con el % de trabajadores con entrada y una barra con salida, en jornada, sin marcar y tardanzas.
- **Marcaciones de hoy**: buscador por nombre, filtros (en jornada, con salida y cada estado), estados con
  colores y orden por hora de entrada.
- **Copiar reporte**: resumen listo para WhatsApp o una tabla para pegar en Excel.
- **Alumnos**: fichas y búsquedas recientes, botón "Limpiar búsqueda", avatar e insignia del estado de matrícula.
- **Ficha del alumno**: cabecera con avatar, promedio de notas, % de asistencia y número de cursos del periodo,
  saldo en rojo si hay deuda, botones para copiar correo y teléfono, y "Copiar resumen de la ficha".
- **Equipo**: filtros por estado con contadores, avatares e insignias, e historial de **credenciales validadas en la sesión**.
- **Lector de fotocheck**: marco de encuadre en la cámara. Al validar, vibra y muestra la hora de validación,
  con botones para escanear otra credencial o volver.
- **Perfil**: hora a la que vence la sesión y tiempo restante, lista de **permisos de la cuenta**,
  confirmación antes de cerrar sesión y versión de la app.
- El panel se actualiza solo sin parpadeos ni saltos de desplazamiento, y conserva filtros, búsquedas y la ficha abierta.
- Se muestra la hora de la última actualización, la carga tiene esqueletos animados y llega un aviso 10 minutos antes de que venza la sesión.
- **Corrección**: el ícono del botón "Escanear fotocheck" ocupaba todo el botón; ahora tiene su tamaño normal.

### Docente
- En Inicio, **"Mis clases de hoy"** con las insignias *En curso*, *Próxima* o *Terminada*.
- Cada curso muestra el número de alumnos, el promedio del curso y el % de asistencia. Hay un buscador de alumnos,
  una columna con el **promedio por alumno**, el resumen de asistencias por estado y **"Copiar notas"** (para Excel).
- En Horario hay una tarjeta con la clase en curso o la siguiente, filtros "Semana / Hoy" y una tabla por día con el día actual resaltado.

### Alumno
- En **Notas** hay un resumen por periodo: promedio de las notas publicadas, promedio por curso y nota más alta.
  Es solo una referencia; el promedio oficial sigue siendo el de la intranet.
- Al entrar se muestra el aviso de cuenta detectada.

### Trabajador
- En "Últimos 7 días" hay una barra de **puntualidad**: el % de días con entrada a tiempo.
- Su ingreso también se beneficia de la detección automática y del ingreso sin conexión.

## Instalar el APK

El APK está firmado con una **clave nueva**, distinta de la original. Android no permite instalarlo encima
de la app actual, así que hay que **desinstalar la versión anterior** antes de instalarlo.

> Antes de desinstalar, cada trabajador debe abrir la app con Internet y comprobar que no queden
> marcaciones pendientes de sincronizar: al desinstalar se borran los datos locales.

Para publicar la actualización sin desinstalar, con la **misma firma** de siempre, copia la carpeta
`assets/` de este repositorio en `app/src/main/assets/` del proyecto Android original y compílalo con la clave habitual.

## Reconstruir el APK

```bash
cd tools
./build_apk.sh /ruta/al/apk-base.apk            # deja el resultado en dist/
```

Requiere Python 3 y Java 11 o superior. La biblioteca oficial `apksig` se descarga de Maven Central y se
verifica su checksum. La clave se crea la primera vez en `tools/keystore/` y no se sube al repositorio.
Para que futuras versiones se instalen como actualización de este APK hay que **conservar esa clave**.

## Qué se probó
- Login (detección automática, varias cuentas, error de contraseña, selector manual, "usar otra cuenta").
- Paneles de administración, docente, alumno y trabajador.
- Modo claro y oscuro, en un navegador con un servidor simulado.
- La firma v2 del APK, la alineación de 4 bytes y que el contenido no web sea idéntico al original.
- **No se probó en un celular real.** Conviene instalarlo primero en un equipo de prueba.
