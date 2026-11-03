#!/usr/bin/env python3
"""Reempaqueta el APK base con la carpeta assets/ mejorada (sin firmar).

Uso: python3 repack_apk.py <base.apk> <carpeta assets> <salida-sin-firmar.apk>

- Copia todas las entradas del APK base en el mismo orden y con el mismo método de compresión.
- Sustituye los archivos de assets/ por los de la carpeta indicada y añade los nuevos.
- Quita la firma anterior (META-INF/*.SF, *.RSA, *.DSA, *.EC, MANIFEST.MF): el APK se firma después.
- Alinea a 4 bytes los datos de las entradas sin comprimir (como zipalign). Android 11+ exige
  resources.arsc sin comprimir y alineado para instalar apps con targetSdk 30 o superior.
"""
import os
import struct
import sys
import zipfile

ALIGNMENT_EXTRA_ID = 0xD935  # Mismo campo extra que usan zipalign/apksig para el relleno.


def write_entry(dst, info, data):
    if info.compress_type == zipfile.ZIP_STORED:
        name_len = len(info.filename.encode('utf-8'))
        data_start = dst.fp.tell() + 30 + name_len + 6
        padding = (-data_start) % 4
        info.extra = struct.pack('<HHH', ALIGNMENT_EXTRA_ID, 2 + padding, 4) + b'\0' * padding
    dst.writestr(info, data)

SIGNATURE_FILES = ('.SF', '.RSA', '.DSA', '.EC')


def is_old_signature(name):
    if not name.startswith('META-INF/'):
        return False
    base = name[len('META-INF/'):]
    return '/' not in base and (base == 'MANIFEST.MF' or base.upper().endswith(SIGNATURE_FILES))


def main(base_apk, assets_dir, out_apk):
    assets_dir = os.path.abspath(assets_dir)
    local = {}
    for root, _dirs, files in os.walk(assets_dir):
        for f in files:
            path = os.path.join(root, f)
            local['assets/' + os.path.relpath(path, assets_dir).replace(os.sep, '/')] = path
    replaced = added = 0
    with zipfile.ZipFile(base_apk) as src, zipfile.ZipFile(out_apk, 'w') as dst:
        seen = set()
        for info in src.infolist():
            if is_old_signature(info.filename):
                continue
            data = src.read(info.filename)
            if info.filename in local:
                with open(local[info.filename], 'rb') as fh:
                    new = fh.read()
                if new != data:
                    replaced += 1
                data = new
            seen.add(info.filename)
            out = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            out.compress_type = info.compress_type
            out.external_attr = info.external_attr
            write_entry(dst, out, data)
        for name in sorted(set(local) - seen):
            out = zipfile.ZipInfo(name, date_time=(1981, 1, 1, 1, 1, 2))
            out.compress_type = zipfile.ZIP_DEFLATED
            with open(local[name], 'rb') as fh:
                write_entry(dst, out, fh.read())
            added += 1
    print(f'Reemplazados: {replaced} · Nuevos: {added} · Salida: {out_apk}')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
