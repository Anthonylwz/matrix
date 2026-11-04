"""Reempaqueta la APK de IDEAS Alumnos con la parte web nueva, sin Android SDK.

Parte de la APK publicada (4.1.7): su código nativo, recursos y Firebase quedan idénticos.
Solo cambia assets/web/asistencia_ideas/ (pwa/ y los archivos de temporada de public/) y la
versión del AndroidManifest (mismo largo de texto, como exige crear_apk_alumnos.py).
Luego alinea a 4 bytes y firma v2 con apksig (biblioteca oficial de Android) usando
firma/debug.keystore, de modo que se instala encima de la versión actual.

Uso:
  python reempaquetar_apk.py --base dist/ideas-alumnos-prueba-4.1.7.apk \
      --keystore firma/debug.keystore --apksig apksig-2.3.0.jar --out dist/ideas-alumnos-prueba-4.2.1.apk
La compilación completa con crear_apk_alumnos.py sigue siendo válida en una PC con Android SDK.
"""
from pathlib import Path
import argparse, hashlib, json, os, re, struct, subprocess, tempfile, zipfile

ROOT = Path(__file__).resolve().parents[1]           # carpeta con pwa/ y public/
PREFIX = 'assets/web/asistencia_ideas/'
WEB = PREFIX + 'pwa/'
STYLE_VERSION = 23
SEASON = ['ideas-season.css', 'ideas-season.js']

p = argparse.ArgumentParser()
p.add_argument('--base', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--keystore', type=Path, required=True)
p.add_argument('--apksig', type=Path, required=True, help='apksig-2.3.0.jar (Maven Central)')
p.add_argument('--alias', default='androiddebugkey')
p.add_argument('--password', default='android')
p.add_argument('--version', default='4.2.1')
p.add_argument('--version-code', type=int, default=42001)
args = p.parse_args()

web_version = re.search(r"APP_VERSION\s*=\s*'([^']+)'", (ROOT / 'pwa/js/utils.js').read_text(encoding='utf-8'))[1]
assert web_version == args.version, f'pwa/js/utils.js indica {web_version}; debe coincidir con {args.version}.'
ADDITIONS = sorted(f.relative_to(ROOT / 'pwa').as_posix() for f in (ROOT / 'pwa').rglob('*')
                   if f.is_file() and f.name not in {'index.html', 'service-worker.js', '.htaccess'})


def replace_equal(data, old, new):
    assert len(old) == len(new), 'La edición binaria requiere textos del mismo largo.'
    for enc in ('utf-8', 'utf-16le'):
        data = data.replace(old.encode(enc), new.encode(enc))
    return data


def index_html(text, version):
    # Mismas transformaciones que crear_apk_alumnos.py.
    text = re.sub(r'<title>[^<]*</title>', '<title>IDEAS Alumnos</title>', text, count=1)
    text = re.sub(r'(<meta name="application-version" content=")[^"]+("\s*>)', lambda m: m[1] + version + m[2], text, count=1)
    if not re.search(r'type="module" src="js/(app|entry)\.js"', text):
        raise RuntimeError('No se reconoce la entrada web del APK.')
    text = text.replace('type="module" src="js/app.js"', 'type="module" src="js/entry.js"')
    if 'window.IDEAS_STUDENT_APP=true' not in text:
        text = text.replace('</head>', '<script>window.IDEAS_STUDENT_APP=true;</script></head>')
    for css in ('student-app', 'theme-motion', 'staff-app'):
        text = re.sub(r'<link\b[^>]*href="css/' + css + r'\.css(?:\?[^"<>]*)?"[^>]*>\s*', '', text)
    return text.replace('</head>', f'<link rel="stylesheet" href="css/student-app.css?v={STYLE_VERSION}">\n<link rel="stylesheet" href="css/theme-motion.css?v=2">\n<link rel="stylesheet" href="css/staff-app.css?v={version}">\n</head>')


def service_worker(text, version):
    text, count = re.subn(r"const CACHE_VERSION = '[^']+';", f"const CACHE_VERSION = 'alumnos-{version}';", text, count=1)
    if count != 1 or 'const STATIC_ASSETS = [' not in text:
        raise RuntimeError('No se reconoce la caché del APK.')
    lines = []
    for line in text.splitlines():
        entry = re.fullmatch(r'\s*[\'"](\./[^\'"]+)[\'"],?\s*', line)
        if entry and entry[1].split('?')[0] in {'./' + rel for rel in ADDITIONS}:
            continue
        lines.append(line)
    text = '\n'.join(lines)
    precache = ['./' + rel for rel in ADDITIONS if rel.endswith('.js')] + [f'./css/student-app.css?v={STYLE_VERSION}', './css/theme-motion.css?v=2']
    return text.replace('const STATIC_ASSETS = [', 'const STATIC_ASSETS = [\n' + ''.join('  ' + json.dumps(r) + ',\n' for r in precache), 1)


SIGNATURE = re.compile(r'META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC))$', re.I)
with zipfile.ZipFile(args.base) as base:
    manifest = base.read('AndroidManifest.xml')
    names = base.namelist()
    found = re.search(r'\b(\d)\.(\d)\.(\d)\b', manifest.decode('utf-16le', errors='ignore'))
    assert found, 'No se reconoce la versión del AndroidManifest.'
    source_version = found[0]
    # Esquema de versionCode de esta app: 4.1.7 -> 41007.
    source_code = int(found[1]) * 10000 + int(found[2]) * 1000 + int(found[3])
    assert len(source_version) == len(args.version)
    replacements = {WEB + rel: (ROOT / 'pwa' / rel).read_bytes() for rel in ADDITIONS}
    replacements[WEB + 'index.html'] = index_html((ROOT / 'pwa/index.html').read_text(encoding='utf-8'), args.version).encode('utf-8')
    replacements[WEB + 'service-worker.js'] = service_worker((ROOT / 'pwa/service-worker.js').read_text(encoding='utf-8-sig'), args.version).encode('utf-8')
    for name in SEASON:
        replacements[PREFIX + 'public/' + name] = (ROOT / 'public' / name).read_bytes()
    entries = []
    for info in base.infolist():
        name = info.filename
        if SIGNATURE.match(name) or (name.startswith(WEB) and name not in replacements):
            continue  # firmas antiguas y archivos web que ya no existen
        data = replacements.pop(name, None)
        if data is None:
            data = base.read(name)
        if name == 'AndroidManifest.xml':
            data = replace_equal(data, source_version, args.version)
            old, new = struct.pack('<HBBI', 8, 0, 0x10, source_code), struct.pack('<HBBI', 8, 0, 0x10, args.version_code)
            assert data.count(old) == 1, 'No se reconoce el código de versión.'
            data = data.replace(old, new)
        entries.append((name, info.compress_type, info.date_time, info.external_attr, data))
    for name, data in sorted(replacements.items()):  # archivos web nuevos
        entries.append((name, zipfile.ZIP_DEFLATED, (2026, 11, 4, 0, 0, 0), 0o644 << 16, data))
    native_before = {n: base.read(n) for n in names if n.endswith('.dex') or n == 'resources.arsc' or n.startswith('res/') or n.startswith('lib/')}

args.out.parent.mkdir(parents=True, exist_ok=True)
# Escribe el ZIP alineado (zipalign -p 4): los datos sin comprimir empiezan en múltiplos de 4 (.so en 4096).
tmp = Path(tempfile.mkdtemp(dir=args.out.parent if args.out.parent.exists() else None))
unsigned = tmp / 'unsigned.apk'
with zipfile.ZipFile(unsigned, 'w') as out:
    for name, ctype, date_time, attr, data in entries:
        info = zipfile.ZipInfo(name, date_time=date_time)
        info.compress_type = ctype
        info.external_attr = attr
        if ctype == zipfile.ZIP_STORED:
            align = 4096 if name.endswith('.so') else 4
            start = out.fp.tell() + 30 + len(name.encode('utf-8'))
            pad = (-start) % align
            if pad:
                while pad < 4:
                    pad += align
                info.extra = struct.pack('<HH', 0xD935, pad - 4) + b'\x00' * (pad - 4)
        out.writestr(info, data)
with zipfile.ZipFile(unsigned) as check:
    for info in check.infolist():
        if info.compress_type == zipfile.ZIP_STORED:
            offset = info.header_offset + 30 + len(info.filename.encode('utf-8')) + len(info.extra)
            assert offset % 4 == 0, f'Sin alinear: {info.filename}'

classes = tmp / 'classes'
java_src = Path(__file__).with_name('firma_java') / 'FirmarApk.java'
subprocess.run(['javac', '-cp', str(args.apksig), '-d', str(classes), str(java_src)], check=True)
# apksig 2.3.0 usa clases internas de X.509: en Java 9+ hay que exportarlas.
subprocess.run(['java', '--add-exports', 'java.base/sun.security.x509=ALL-UNNAMED', '--add-exports', 'java.base/sun.security.pkcs=ALL-UNNAMED', '--add-exports', 'java.base/sun.security.util=ALL-UNNAMED', '-cp', f'{args.apksig}{os.pathsep}{classes}', 'FirmarApk',
                str(unsigned), str(args.out), str(args.keystore), args.alias, args.password], check=True)

with zipfile.ZipFile(args.out) as built:
    names = built.namelist()
    assert len(names) == len(set(names)), 'Hay entradas duplicadas.'
    for name, data in native_before.items():
        assert built.read(name) == data, f'Cambió contenido nativo: {name}'
    for rel in ADDITIONS:
        assert built.read(WEB + rel) == (ROOT / 'pwa' / rel).read_bytes()
    for name in SEASON:
        assert built.read(PREFIX + 'public/' + name) == (ROOT / 'public' / name).read_bytes()
    assert f"CACHE_VERSION = 'alumnos-{args.version}'" in built.read(WEB + 'service-worker.js').decode()
    assert args.version.encode('utf-16le') in built.read('AndroidManifest.xml')
import shutil; shutil.rmtree(tmp, ignore_errors=True)
digest = hashlib.sha256(args.out.read_bytes()).hexdigest()
print(f'APK generada: {args.out}\nVersión {args.version} ({args.version_code}) · base {source_version} ({source_code})\nSHA-256 {digest}')
