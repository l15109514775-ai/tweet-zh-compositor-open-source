"""Assemble a Debian 13 amd64 user-directory bundle. Build-time network only.

Run on Windows or Linux with Python 3.11+, Node/npm. Runtime needs no Python,
npm install, sudo, Docker, service registration, or downloads.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
import lzma
import os
import pathlib
import re
import shutil
import struct
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE_LIBS = {'libc.so.6', 'libm.so.6', 'libpthread.so.0', 'libdl.so.2', 'librt.so.1',
             'libresolv.so.2', 'libutil.so.1', 'libanl.so.1', 'libmvec.so.1',
             'ld-linux-x86-64.so.2', 'linux-vdso.so.1'}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def download(url, target, expected=None):
    target = pathlib.Path(target)
    if target.exists() and target.stat().st_size and (not expected or sha(target.read_bytes()) == expected):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'tweet-zh-compositor-offline-builder'})
    with urllib.request.urlopen(request, timeout=180) as response, open(str(target) + '.partial', 'wb') as out:
        shutil.copyfileobj(response, out)
    partial = pathlib.Path(str(target) + '.partial')
    if expected and sha(partial.read_bytes()) != expected:
        raise RuntimeError('Publisher SHA-256 mismatch: ' + target.name)
    partial.replace(target)
    return target

def control_records(text):
    for paragraph in text.split('\n\n'):
        fields = {}
        key = None
        for line in paragraph.splitlines():
            if line.startswith((' ', '\t')) and key:
                fields[key] += ' ' + line.strip()
            elif ': ' in line:
                key, value = line.split(': ', 1)
                fields[key] = value
        if fields.get('Package'):
            yield fields

def version_compare(a, b):
    def split(v):
        epoch, _, rest = v.partition(':')
        if not _: epoch, rest = '0', v
        upstream, dash, revision = rest.rpartition('-')
        if not dash: upstream, revision = rest, '0'
        return int(epoch), upstream, revision
    def part(a, b):
        def order(c):
            if c == '~': return -1
            if not c or c.isdigit(): return 0
            return ord(c) if c.isalpha() else ord(c) + 256
        while a or b:
            while (a and not a[0].isdigit()) or (b and not b[0].isdigit()):
                x, y = order(a[:1]), order(b[:1])
                if x != y: return (x > y) - (x < y)
                a, b = a[1:] if a else '', b[1:] if b else ''
            a, b = a.lstrip('0'), b.lstrip('0')
            x, y = re.match(r'\d*', a)[0], re.match(r'\d*', b)[0]
            if len(x) != len(y): return (len(x) > len(y)) - (len(x) < len(y))
            if x != y: return (x > y) - (x < y)
            a, b = a[len(x):], b[len(y):]
        return 0
    x, y = split(a), split(b)
    if x[0] != y[0]: return (x[0] > y[0]) - (x[0] < y[0])
    return part(x[1], y[1]) or part(x[2], y[2])

def ar_members(data):
    if not data.startswith(b'!<arch>\n'): raise ValueError('Not a Debian ar archive')
    pos = 8
    while pos + 60 <= len(data):
        header = data[pos:pos+60]
        size = int(header[48:58].decode().strip())
        name = header[:16].decode().strip().rstrip('/')
        pos += 60
        yield name, data[pos:pos+size]
        pos += size + size % 2

def elf_needed(data):
    if not data.startswith(b'\x7fELF'): return None
    if data[4:6] != b'\x02\x01' or struct.unpack_from('<H', data, 18)[0] != 62:
        raise ValueError('Non-amd64 ELF in Linux bundle')
    phoff = struct.unpack_from('<Q', data, 32)[0]
    phsize, count = struct.unpack_from('<HH', data, 54)
    loads, dynamic = [], None
    for i in range(count):
        p = struct.unpack_from('<IIQQQQQQ', data, phoff + i * phsize)
        if p[0] == 1: loads.append((p[3], p[2], p[5]))
        if p[0] == 2: dynamic = (p[2], p[5])
    if not dynamic: return []
    needed, string_address = [], None
    for off in range(dynamic[0], dynamic[0] + dynamic[1], 16):
        tag, value = struct.unpack_from('<qQ', data, off)
        if tag == 0: break
        if tag == 1: needed.append(value)
        if tag == 5: string_address = value
    if not needed: return []
    for address, offset, size in loads:
        if address <= string_address < address + size:
            start = offset + string_address - address
            return [data[start+n:data.index(b'\0', start+n)].decode() for n in needed]
    raise ValueError('ELF string table not mapped')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True, help='Absolute build/output directory, preferably D: on Windows')
    ap.add_argument('--cache', required=True, help='Directory prepared by offline-downloads.mjs (or equivalent publisher downloads)')
    args = ap.parse_args()
    work, cache = pathlib.Path(args.work).resolve(), pathlib.Path(args.cache).resolve()
    stage = work / 'stage'
    if stage.exists():
        raise SystemExit('Stage already exists; use a new empty --work to avoid mixing builds: ' + str(stage))
    stage.mkdir(parents=True)
    def excluded(file):
        # npm may retain both glibc and musl optional artifacts when cross-installing.
        # Only GNU amd64 artifacts belong in this Debian bundle.
        return any('linuxmusl' in part for part in file.relative_to(stage).parts)
    version = json.loads((ROOT/'package.json').read_text('utf-8'))['version']
    source_commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    source_dirty = bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
    versions = json.loads((cache/'versions.json').read_text('utf-8'))
    modes, links = {}, {}
    def put(name, data, mode=0o644):
        name = str(name).replace('\\', '/')
        if name.startswith('/') or '..' in pathlib.PurePosixPath(name).parts: raise ValueError('Unsafe archive path')
        file = stage / name
        file.parent.mkdir(parents=True, exist_ok=True)
        if file.exists() and file.read_bytes() != data: raise ValueError('Conflicting file: ' + name)
        file.write_bytes(data)
        modes[name] = mode & 0o777
    def copy_source():
        files = ['package.json', 'package-lock.json', '.npmrc', 'template.json', 'template-lock.json',
                 'README.md', 'LOCAL_SETUP.md', 'DOT_ACCEPTANCE.md', 'OFFLINE_LINUX.md', 'CLOUD_SETUP.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']
        for folder in ['src', 'web', 'scripts', 'tests', 'assets', 'reference', 'examples', 'acceptance', 'offline', 'docs']:
            files += [p.relative_to(ROOT).as_posix() for p in (ROOT/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc']
        for name in files:
            put(name, (ROOT/name).read_bytes())
    copy_source()
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    command = [npm, 'ci', '--os=linux', '--cpu=x64', '--libc=glibc', '--ignore-scripts', '--bin-links=false',
               '--no-audit', '--no-fund', '--cache', str(work/'npm-cache')]
    print('Installing Linux amd64 GNU npm artifacts from lockfile...', flush=True)
    subprocess.run(command, cwd=stage, check=True, env={**os.environ, 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD': '1'})
    if list((stage/'node_modules').rglob('*win32*')): raise RuntimeError('Windows optional module found in Linux staging')
    native = [p for p in (stage/'node_modules').rglob('*.node') if not excluded(p)]
    if not native or not any('sharp' in p.name for p in native): raise RuntimeError('Linux sharp native module missing')
    for p in native:
        if elf_needed(p.read_bytes()) is None: raise RuntimeError('Non-ELF native module: ' + str(p))
    print('Linux npm modules verified; collecting Debian runtime libraries...', flush=True)
    packages = {}
    for filename, base in [('trixie-Packages.xz','https://deb.debian.org/debian/'),
                           ('trixie-security-Packages.xz','https://deb.debian.org/debian-security/')]:
        for p in control_records(lzma.decompress((cache/filename).read_bytes()).decode()):
            if p.get('Architecture') not in ['amd64', 'all']: continue
            old = packages.get(p['Package'])
            if not old or version_compare(p['Version'], old['Version']) > 0:
                packages[p['Package']] = {**p, 'DownloadBase': base}
    bundle = (stage/'node_modules/playwright-core/lib/coreBundle.js').read_text('utf-8')
    section = bundle.split('"debian13-x64": {', 1)[1]
    seeds = re.findall(r'"([^"]+)"', re.search(r'chromium:\s*\[(.*?)\]', section, re.S)[1])
    seeds += ['libfontconfig1','libfreetype6','fonts-dejavu-core','fonts-liberation','libstdc++6',
              'libgcc-s1','libgtk-3-0t64','libvulkan1','libxshmfence1','libwayland-client0','libwayland-server0',
              'zlib1g','mesa-libgallium']
    selected, queue, ignored = {}, list(seeds), set()
    while queue:
        name = queue.pop(0)
        if name in selected: continue
        p = packages.get(name)
        if not p: raise RuntimeError('Debian runtime package missing: ' + name)
        selected[name] = p
        for group in (p.get('Pre-Depends','') + ',' + p.get('Depends','')).split(','):
            if not group.strip(): continue
            choices = [re.sub(r'\s*\([^)]*\)|\s*\[[^]]*\]|:[a-z0-9-]+', '', x).strip() for x in group.split('|')]
            chosen = next((x for x in choices if x in packages), None)
            if chosen and (chosen.startswith(('lib','fonts-')) or chosen == 'fontconfig-config'):
                queue.append(chosen)
            else: ignored.add(group.strip())
    metadata = []
    def get_deb(item):
        name, p = item
        file = download(p['DownloadBase'] + p['Filename'], cache/'debs'/pathlib.PurePosixPath(p['Filename']).name, p['SHA256'])
        return name, p, file
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        debs = list(pool.map(get_deb, sorted(selected.items())))
    for name, p, file in debs:
        metadata.append({'package':name,'version':p['Version'],'source':p.get('Source',name),'sha256':p['SHA256'],
                         'url':p['DownloadBase']+p['Filename']})
        data_archive = next(data for member,data in ar_members(file.read_bytes()) if member.startswith('data.tar'))
        try: archive = tarfile.open(fileobj=io.BytesIO(data_archive), mode='r:*')
        except tarfile.ReadError:
            import zstandard
            archive = tarfile.open(fileobj=io.BytesIO(zstandard.ZstdDecompressor().decompress(data_archive)), mode='r:')
        with archive:
            for info in archive:
                n = info.name.removeprefix('./')
                base = pathlib.PurePosixPath(n).name
                if '/lib/' in '/'+n and re.search(r'\.so(?:\.|$)', base) and name not in ['libc6','libc-bin']:
                    dest = 'runtime/lib/' + base
                    if info.issym(): links[dest] = pathlib.PurePosixPath(info.linkname).name
                    elif info.isfile(): put(dest, archive.extractfile(info).read(), info.mode)
                elif info.isfile() and n.endswith('/copyright'):
                    put('licenses/debian/'+name+'/copyright', archive.extractfile(info).read())
                elif info.isfile() and n.startswith('usr/share/fonts/'):
                    put('runtime/system-fonts/'+base, archive.extractfile(info).read())
                elif info.isfile() and n.startswith('usr/share/alsa/'):
                    put('runtime/alsa/'+n.removeprefix('usr/share/alsa/'), archive.extractfile(info).read())
    print(f'Collected {len(debs)} verified Debian packages.', flush=True)
    with tarfile.open(cache/'node-linux-x64.tar.xz', 'r:xz') as archive:
        for info in archive:
            parts = pathlib.PurePosixPath(info.name).parts
            if len(parts)<2: continue
            name = 'runtime/node/'+'/'.join(parts[1:])
            if info.issym(): links[name] = info.linkname
            elif info.isfile(): put(name, archive.extractfile(info).read(), info.mode)
    for zipname, prefix in [('chromium-headless-shell-linux64.zip','runtime/browsers/chromium_headless_shell-1248/'),
                            ('ffmpeg-linux.zip','runtime/browsers/ffmpeg-1013/')]:
        with zipfile.ZipFile(cache/zipname) as archive:
            for info in archive.infolist():
                if info.is_dir(): continue
                mode = (info.external_attr >> 16) & 0o777
                data = archive.read(info)
                if data.startswith(b'\x7fELF'): mode = 0o755
                put(prefix+info.filename, data, mode or 0o644)
        put(prefix+'INSTALLATION_COMPLETE', b'')
    put('runtime/fontconfig/fonts.conf', b'''<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig><dir prefix="relative">../../assets/fonts</dir><dir prefix="relative">../system-fonts</dir><cachedir prefix="relative">../font-cache</cachedir></fontconfig>
''')
    for script in ['start.sh','render.sh','self-check.sh','test-offline.sh','offline-env.sh']:
        put(script, (ROOT/'offline'/script).read_bytes(), 0o755)
    put('verify-offline.mjs', (ROOT/'offline/verify-offline.mjs').read_bytes())
    put('README-OFFLINE.md', (ROOT/'offline/README-OFFLINE.md').read_bytes())
    elf_files, available = [], set(BASE_LIBS)
    for file in stage.rglob('*'):
        if file.is_file() and not excluded(file) and '.so' in file.name: available.add(file.name)
    available.update(pathlib.PurePosixPath(n).name for n in links)
    unresolved = []
    for file in stage.rglob('*'):
        if not file.is_file() or excluded(file): continue
        with open(file, 'rb') as f: header=f.read(4)
        if header != b'\x7fELF': continue
        needed = elf_needed(file.read_bytes())
        rel=file.relative_to(stage).as_posix()
        elf_files.append({'file':rel,'needed':needed})
        for dep in needed:
            if dep not in available: unresolved.append({'file':rel,'missing':dep})
    for name,target in links.items():
        resolved = pathlib.PurePosixPath(name).parent / target
        normalized = os.path.normpath(str(resolved)).replace('\\','/')
        if not (stage/normalized).exists() and normalized not in links:
            unresolved.append({'file':name,'missingLinkTarget':target})
    report={'target':'Debian 13 amd64 / glibc 2.41','runtimeExecution':'not-run-on-Windows-builder',
            'node':versions['nodeVersion'],'chromium':'156.0.8078.4','revision':'1248','sourceCommit':source_commit,'sourceDirty':source_dirty,'nativeModules':[p.relative_to(stage).as_posix() for p in native],
            'debianPackages':metadata,'hostBaselineLibraries':sorted(BASE_LIBS),'elf':elf_files,'unresolved':unresolved,
            'nonLibraryPackageDependenciesNotBundled':[group for group in sorted(ignored) if not any(re.sub(r'\s*\([^)]*\)|:[a-z0-9-]+', '', alt).strip() in selected for alt in group.split('|'))]}
    put('OFFLINE-BUILD-REPORT.json', (json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode())
    if unresolved: raise RuntimeError('Unresolved ELF/link dependencies: '+json.dumps(unresolved))
    put('OFFLINE-METADATA.json', (json.dumps({'version':version,'target':'debian13-amd64','node':versions['nodeVersion'],
        'chromium':'156.0.8078.4','revision':'1248','requiresCloud':False,'requiresContainer':False,
        'glibcBaseline':'2.41','sourceCommit':source_commit,'sourceDirty':source_dirty,'linuxRuntimeTest':'pending Dot self-check'},indent=2)+'\n').encode())
    files=[]
    for file in sorted(stage.rglob('*')):
        if not file.is_file() or excluded(file): continue
        rel=file.relative_to(stage).as_posix()
        files.append({'file':rel,'sha256':sha(file.read_bytes()),'bytes':file.stat().st_size})
    put('OFFLINE-MANIFEST.json', (json.dumps({'files':files,'links':links},ensure_ascii=False,indent=2)+'\n').encode())
    put('SHA256SUMS', ''.join(f"{f['sha256']}  {f['file']}\n" for f in files).encode())
    name=f'tweet-zh-compositor-{version}-debian13-amd64-offline'
    output=work/(name+'.tar.gz')
    with tarfile.open(output,'w:gz',compresslevel=6,format=tarfile.PAX_FORMAT) as archive:
        for file in sorted(stage.rglob('*')):
            if not file.is_file() or excluded(file): continue
            rel=file.relative_to(stage).as_posix()
            info=tarfile.TarInfo(name+'/'+rel); info.size=file.stat().st_size; info.mode=modes.get(rel,0o644); info.mtime=946684800
            with open(file,'rb') as stream: archive.addfile(info,stream)
        for rel,target in sorted(links.items()):
            info=tarfile.TarInfo(name+'/'+rel); info.type=tarfile.SYMTYPE; info.linkname=target; info.mode=0o777; info.mtime=946684800
            archive.addfile(info)
    digest=sha(output.read_bytes())
    pathlib.Path(str(output)+'.sha256').write_text(f'{digest}  {output.name}\n',encoding='utf-8')
    print(json.dumps({'archive':str(output),'sha256':digest,'bytes':output.stat().st_size,'files':len(files),'elfFiles':len(elf_files),'debianPackages':len(debs),'linuxExecution':'pending'},ensure_ascii=False),flush=True)

if __name__=='__main__': main()
