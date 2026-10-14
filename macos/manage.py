#!/usr/bin/env python3
"""Reversible local-copy installer. Never patches the original Claude.app."""
import argparse
import contextlib
import datetime
import hashlib
import json
import math
import os
import pathlib
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import time
import uuid

BASE = pathlib.Path.home() / 'Library/Application Support/ClaudeAutoContinue'
RUNTIME = BASE / 'Runtime'
LOGS = pathlib.Path.home() / 'Library/Logs/ClaudeAutoContinue'
PACKAGE = pathlib.Path(__file__).resolve().parent.parent
MARKER = 'claude-auto-continue-local-copy-v1'
SOURCE_FILES = ['lib/engine.js','lib/renderer.js','plugins/auto-continue.js',
                'macos/loader.cjs','macos/manage.py','macos/compatibility.json']

@contextlib.contextmanager
def operation_lock():
    """Prevent two launchers or installers from racing over the same local copy."""
    import fcntl
    BASE.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (BASE/'operation.lock').open('a+') as handle:
        os.chmod(handle.name,0o600)
        try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Another Claude Continue operation is already running. Wait for it to finish, then try again.') from error
        try:yield
        finally:fcntl.flock(handle,fcntl.LOCK_UN)

def run(*args, timeout=120):
    return subprocess.run([str(x) for x in args], check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=timeout)

def digest(path):
    h = hashlib.sha256()
    with pathlib.Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()

def write_json(path, data):
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)

def log(event, **fields):
    try:
        LOGS.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = LOGS/'installation.log'
        with path.open('a') as f:
            f.write(json.dumps(dict(time=datetime.datetime.now().astimezone().isoformat(), event=event, **fields))+'\n')
        path.chmod(0o600)
    except OSError:pass

def verify_sources(root):
    """A partially downloaded or stale bundle must never replace a working plugin."""
    if any(not (root/name).is_file() for name in SOURCE_FILES):
        raise RuntimeError('Plugin source files are missing. Keep the complete package folder together.')
    engine=(root/'lib/engine.js').read_text();renderer=(root/'lib/renderer.js').read_text()
    expected=('// Bundled safety engine preserves compatibility with the original one-file loader.\n'
              'if (typeof window !== "undefined" && !window.ClaudeAutoContinueEngine) {\n'
              +engine+'\n}\n'+renderer)
    if not engine.strip() or not renderer.strip() or (root/'plugins/auto-continue.js').read_text()!=expected:
        raise RuntimeError('Bundled plugin does not match its engine and renderer sources. Download a complete release package, or rebuild the plugin before updating.')
    version=re.search(r'\bconst\s+VERSION\s*=\s*([\'\"])([0-9A-Za-z.-]{1,64})\1\s*;',renderer)
    if not version:raise RuntimeError('Plugin renderer version is missing. Download a complete release package.')
    return version.group(2)

def locate(explicit=None):
    if explicit:
        candidates = [pathlib.Path(explicit).expanduser().resolve()]
    else:
        candidates = [pathlib.Path('/Applications/Claude.app'), pathlib.Path.home()/'Applications/Claude.app']
        candidates = [p for p in candidates if p.exists()]
        if not candidates:
            found = run('/usr/bin/mdfind', "kMDItemCFBundleIdentifier == 'com.anthropic.claudefordesktop'").stdout.decode().splitlines()
            candidates = [pathlib.Path(x) for x in found if BASE not in pathlib.Path(x).parents]
    verified = []
    for p in candidates:
        try:
            info = plistlib.loads((p/'Contents/Info.plist').read_bytes())
            if info['CFBundleIdentifier']=='com.anthropic.claudefordesktop' and (p/'Contents/Resources/app.asar').is_file():
                verified.append(p.resolve())
        except (OSError, KeyError, plistlib.InvalidFileException):
            pass
    verified = list(dict.fromkeys(verified))
    if len(verified)!=1:
        raise RuntimeError('Specify exactly one original Claude.app path; found %d candidates.' % len(verified))
    return verified[0]

def detect(app):
    info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
    framework = app/'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist'
    result = dict(path=str(app), version=info['CFBundleShortVersionString'],
                  electron=plistlib.loads(framework.read_bytes()).get('CFBundleVersion'),
                  arch=os.uname().machine, asarHash=digest(app/'Contents/Resources/app.asar'))
    run('/usr/bin/codesign','--verify','--deep','--strict',app)
    signature=run('/usr/bin/codesign','-dv',app).stderr.decode()
    result['vendorSigned']='TeamIdentifier=Q6L2SF6YDW' in signature
    return result

def ensure_closed():
    if subprocess.run(['/usr/bin/pgrep','-x','Claude'],stdout=subprocess.DEVNULL).returncode==0:
        raise RuntimeError('Quit Claude before installing. No running Claude process was stopped.')

def patch_asar(app):
    archive=app/'Contents/Resources/app.asar'
    blob=archive.read_bytes()
    first, header_size, pickle_size, json_size=struct.unpack('<4I',blob[:16])
    if first!=4 or header_size!=pickle_size+4 or json_size>header_size:
        raise RuntimeError('Unrecognized ASAR header; refusing to patch.')
    header=json.loads(blob[16:16+json_size]);payload=blob[8+header_size:]
    node=header['files']['.vite']['files']['build']['files']['index.pre.js']
    old=payload[int(node['offset']):int(node['offset'])+node['size']]
    if b'CLAUDE_PLUGIN_LOADER_HOOK' in old:
        raise RuntimeError('Source already patched; use the original signed app.')
    hook=b'''/* CLAUDE_PLUGIN_LOADER_HOOK */
try { require(require('path').join(process.resourcesPath, '..', '..', '..', 'macos', 'loader.cjs')); }
catch (_) { console.error('[ClaudeAutoContinue] loader unavailable; automation disabled'); }
'''
    code=hook+old;node['offset']=str(len(payload));node['size']=len(code)
    size=4*1024*1024
    node['integrity']=dict(algorithm='SHA256',hash=hashlib.sha256(code).hexdigest(),blockSize=size,
                           blocks=[hashlib.sha256(code[i:i+size]).hexdigest() for i in range(0,len(code),size)])
    raw=json.dumps(header,separators=(',',':'),ensure_ascii=False).encode()
    pad=(-(len(raw)+4))%4
    pickle=struct.pack('<II',len(raw)+4+pad,len(raw))+raw+bytes(pad)
    archive.write_bytes(struct.pack('<II',4,len(pickle))+pickle+payload+code)
    for info in [app/'Contents/Info.plist',app/'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist']:
        data=plistlib.loads(info.read_bytes())
        entries=data.get('ElectronAsarIntegrity',{})
        if not entries:
            raise RuntimeError('ASAR integrity metadata missing; refusing unknown structure.')
        for value in entries.values():
            if value['algorithm']!='SHA256':
                raise RuntimeError('Unknown ASAR integrity algorithm.')
            value['hash']=hashlib.sha256(raw).hexdigest()
        info.write_bytes(plistlib.dumps(data))
    check=archive.read_bytes();_,hs,_,js=struct.unpack('<4I',check[:16]);h=json.loads(check[16:16+js])
    n=h['files']['.vite']['files']['build']['files']['index.pre.js']
    actual=check[8+hs+int(n['offset']):8+hs+int(n['offset'])+n['size']]
    if actual!=code: raise RuntimeError('ASAR read-back verification failed.')

def sign_copy(app, scratch):
    framework=app/'Contents/Frameworks/Electron Framework.framework'
    run('/usr/bin/codesign','--force','--sign','-', '--requirements',
        '=designated => identifier "com.github.Electron.framework"',
        '--preserve-metadata=entitlements,flags,runtime',framework)
    targets=list((app/'Contents/Frameworks').glob('Claude Helper*.app'))+[app]
    for target in targets:
        entitlements=plistlib.loads(run('/usr/bin/codesign','-d','--entitlements','-','--xml',target).stdout)
        for key in ['com.apple.application-identifier','com.apple.developer.team-identifier','keychain-access-groups']:
            entitlements.pop(key,None)
        # Only this modified copy can load its locally signed Electron framework.
        entitlements['com.apple.security.cs.disable-library-validation']=True
        ent=scratch/'local-entitlements.plist';ent.write_bytes(plistlib.dumps(entitlements))
        identifier=plistlib.loads((target/'Contents/Info.plist').read_bytes())['CFBundleIdentifier']
        run('/usr/bin/codesign','--force','--sign','-','--requirements',
            '=designated => identifier '+json.dumps(identifier),'--entitlements',ent,'--options','runtime',target)
    (scratch/'local-entitlements.plist').unlink()
    run('/usr/bin/codesign','--verify','--deep','--strict',app)

def modified_files(app):
    paths=[app/'Contents/Resources/app.asar', app/'Contents/Info.plist',
           app/'Contents/MacOS/Claude',app/'Contents/_CodeSignature/CodeResources',
           app/'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist',
           app/'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
           app/'Contents/Frameworks/Electron Framework.framework/Versions/A/_CodeSignature/CodeResources']
    for helper in (app/'Contents/Frameworks').glob('Claude Helper*.app'):
        info=plistlib.loads((helper/'Contents/Info.plist').read_bytes())
        paths.extend([helper/'Contents/MacOS'/info['CFBundleExecutable'],helper/'Contents/_CodeSignature/CodeResources'])
    return {str(p.relative_to(app)):digest(p) for p in paths if p.is_file()}

def install(app):
    verify_sources(PACKAGE)
    ensure_closed()
    support=json.loads((PACKAGE/'macos/compatibility.json').read_text())
    print('Verifying original Claude signature and compatibility…',flush=True)
    found=detect(app)
    if not found['vendorSigned'] or found['version']!=support['version'] or found['asarHash']!=support['asarHash']:
        raise RuntimeError('Claude version/build is not the tested baseline. Installation paused; original app unchanged.')
    if RUNTIME.exists():
        raise RuntimeError('A local copy is already installed. Uninstall it before reinstalling; backups and logs will remain.')
    if shutil.disk_usage(BASE.parent if BASE.parent.exists() else pathlib.Path.home()).free<3*1024**3:
        raise RuntimeError('At least 3 GB of free disk space is required for copy and backup.')
    BASE.mkdir(parents=True,exist_ok=True,mode=0o700)
    stamp=datetime.datetime.now().astimezone().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
    backup=BASE/'Backups'/('Claude-'+found['version']+'-'+stamp)
    backup.mkdir(parents=True,mode=0o700)
    print('Creating and verifying a versioned backup…',flush=True)
    run('/usr/bin/ditto',app,backup/'Claude.app',timeout=300)
    original=modified_files(app)
    if original!=modified_files(backup/'Claude.app'):raise RuntimeError('Backup hashes did not match.')
    run('/usr/bin/codesign','--verify','--deep','--strict',backup/'Claude.app')
    write_json(backup/'manifest.json',dict(marker=MARKER,original=found,files=original))
    stage=BASE/('.staging-'+stamp);stage.mkdir(mode=0o700)
    try:
        for name in ['lib','macos']:
            shutil.copytree(PACKAGE/name,stage/name)
        (stage/'plugins').mkdir()
        shutil.copy2(PACKAGE/'plugins/auto-continue.js',stage/'plugins/auto-continue.js')
        run('/usr/bin/ditto',backup/'Claude.app',stage/'Claude.app',timeout=300)
        print('Patching and locally signing the copied app only…',flush=True)
        patch_asar(stage/'Claude.app');sign_copy(stage/'Claude.app',stage)
        manifest=dict(marker=MARKER,claudeVersion=found['version'],original=found,backup=str(backup),
                      originalHashes=original,patchedHashes=modified_files(stage/'Claude.app'),created=stamp)
        write_json(stage/'manifest.json',manifest)
        write_json(backup/'patched-manifest.json',manifest)
        stage.rename(RUNTIME)
    except Exception:
        if stage.exists():shutil.rmtree(stage)
        raise
    log('installed',version=found['version'])
    launch()

def load_manifest():
    data=json.loads((RUNTIME/'manifest.json').read_text())
    if data.get('marker')!=MARKER:raise RuntimeError('Installation marker is missing; refusing to change this directory.')
    return data

def own_pid():
    executable=str(RUNTIME/'Claude.app/Contents/MacOS/Claude')
    try:
        pid=int(json.loads((RUNTIME/'status.json').read_text())['pid'])
        command=run('/bin/ps','-p',str(pid),'-o','comm=').stdout.decode().strip()
        if command==executable:return pid
    except (OSError,ValueError,TypeError,KeyError,subprocess.SubprocessError):pass
    # A stale PID may already belong to another valid process after a reboot.
    for line in run('/bin/ps','-axo','pid=,comm=').stdout.decode().splitlines():
        parts=line.strip().split(None,1)
        if len(parts)==2 and parts[1]==executable:return int(parts[0])
    return None

def verify_installed_app(data):
    original=pathlib.Path(data['original']['path'])
    version=plistlib.loads((original/'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
    if version!=data['claudeVersion'] or digest(original/'Contents/Resources/app.asar')!=data['original']['asarHash']:
        raise RuntimeError('Original Claude was updated. Compatibility requires a new check; launch paused.')
    if modified_files(RUNTIME/'Claude.app')!=data['patchedHashes']:
        raise RuntimeError('Local app changed or updated. Launch paused; use Restore Claude.command.')

def verified_status(health,pid,renderer_version,started=None):
    if not isinstance(health,dict) or type(health.get('pid')) is not int or health.get('pid')!=pid:return False
    stamp=health.get('time')
    if isinstance(stamp,bool) or not isinstance(stamp,(int,float)) or not math.isfinite(stamp):return False
    age=time.time()*1000-stamp
    if age<0 or age>=15000 or (started is not None and stamp<=started*1000):return False
    renderers=health.get('renderers')
    return isinstance(renderers,list) and any(isinstance(x,dict) and type(x.get('widgets')) is int and x.get('widgets')==1
        and x.get('rendererVersion')==renderer_version and x.get('composer') is True and x.get('send') is True for x in renderers)

def check_loader_status(health,pid):
    if not isinstance(health,dict) or type(health.get('pid')) is not int or health.get('pid')!=pid:return
    if health.get('compatible') is False:
        raise RuntimeError('The local loader rejected this Claude version. Use the release that supports your installed build.')
    if health.get('bundleReady') is False:
        raise RuntimeError('The local plugin sources could not be loaded. Update from a complete release package.')

def launch():
    data=load_manifest();verify_installed_app(data);renderer_version=verify_sources(RUNTIME)
    pid=own_pid()
    if pid:
        try:
            health=json.loads((RUNTIME/'status.json').read_text())
            check_loader_status(health,pid)
            verified=verified_status(health,pid,renderer_version)
        except (OSError,ValueError):verified=False
        if not verified:raise RuntimeError('The managed copy is running, but its widget and controls are not verified. Open an existing chat, then run Launch again.')
        print('Verified running copy: one widget, composer, and Send control.');return
    ensure_closed()
    for name in ['shutdown.json','status.json']:
        (RUNTIME/name).unlink(missing_ok=True)
    print('Launching local copy. macOS may ask for Keychain access. Auto Continue starts OFF.',flush=True)
    print('Touch ID sign-in is unavailable in the locally signed copy. Original Claude remains unchanged.',flush=True)
    started=time.time()
    # Do not retain vendor output that might contain account or conversation data.
    process=subprocess.Popen([str(RUNTIME/'Claude.app/Contents/MacOS/Claude')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    for _ in range(180):
        if process.poll() is not None:raise RuntimeError('The copied Claude app exited before verification. Original app is intact; use Restore Claude.command.')
        try:
            status=json.loads((RUNTIME/'status.json').read_text())
            check_loader_status(status,process.pid)
            if verified_status(status,process.pid,renderer_version,started):
                log('launch-verified',version=data['claudeVersion'])
                print('Verified: Claude renderer, one widget, composer, and Send control. Automation is OFF.');return
        except (OSError,ValueError,KeyError):pass
        time.sleep(1)
    raise RuntimeError('Launch verification timed out. Open an existing chat, then run Launch again. Installation is not verified yet.')

def update():
    data=load_manifest()
    support=json.loads((PACKAGE/'macos/compatibility.json').read_text())
    if data['claudeVersion']!=support['version'] or data['original']['asarHash']!=support['asarHash']:
        raise RuntimeError('The installed app is not compatible with this update.')
    if PACKAGE==RUNTIME:
        raise RuntimeError('Run Update.command from the downloaded package folder.')
    files=SOURCE_FILES
    verify_sources(PACKAGE)
    if any(not (PACKAGE/name).is_file() or not (RUNTIME/name).is_file() for name in files):
        raise RuntimeError('Plugin source files are missing. Keep the complete update folder together.')
    verify_installed_app(data)
    # Only the plugin sources change. The signed app and account preferences stay intact.
    if own_pid():
        print('Closing the local copy to apply the update…',flush=True)
        write_json(RUNTIME/'shutdown.json',{'stop':True})
        for _ in range(20):
            if not own_pid():break
            time.sleep(1)
        if own_pid():raise RuntimeError('Close the local Claude copy, then run Update again.')
    ensure_closed()
    stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
    backup=BASE/'Backups'/('Plugin-'+stamp)
    staging=BASE/('Update-'+stamp)
    replaced=[]
    try:
        # Stage every replacement and backup before changing installed sources.
        for relative in files:
            target=RUNTIME/relative;prior=backup/relative;replacement=staging/relative
            prior.parent.mkdir(parents=True,exist_ok=True);replacement.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(target,prior);shutil.copy2(PACKAGE/relative,replacement)
        try:
            for relative in files:
                (staging/relative).replace(RUNTIME/relative);replaced.append(relative)
        except Exception as error:
            failures=[]
            for relative in reversed(replaced):
                try:shutil.copy2(backup/relative,RUNTIME/relative)
                except OSError:failures.append(relative)
            if failures:raise RuntimeError('Update failed and some files could not be restored. Backup: '+str(backup)) from error
            raise RuntimeError('Update failed; installed plugin sources were restored.') from error
    finally:
        shutil.rmtree(staging,ignore_errors=True)
    log('plugin-updated')
    launch()


def uninstall():
    if not RUNTIME.exists():print('No managed installation exists; original Claude is unchanged.');return
    data=load_manifest();pid=own_pid()
    if pid:
        write_json(RUNTIME/'shutdown.json',{'stop':True})
        for _ in range(15):
            if not own_pid():break
            time.sleep(1)
        if own_pid():raise RuntimeError('Close the managed Claude copy, then run Uninstall again. No app files were removed.')
    original=pathlib.Path(data['original']['path'])
    if not original.exists():
        raise RuntimeError('Original app is missing. Verified backup remains at '+data['backup']+'; no files removed.')
    run('/usr/bin/codesign','--verify','--deep','--strict',original)
    shutil.rmtree(RUNTIME)
    log('uninstalled')
    run('/usr/bin/open','-a',original)
    for _ in range(30):
        procs=run('/bin/ps','-axo','comm=').stdout.decode().splitlines()
        if str(original/'Contents/MacOS/Claude') in procs:
            print('Removed managed copy. Original signed Claude launches. Backups and logs preserved.');return
        time.sleep(1)
    raise RuntimeError('Managed copy removed and original signature verified; original launch could not be confirmed.')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['detect','install','launch','update','uninstall','restore']);parser.add_argument('app',nargs='?');args=parser.parse_args()
    if sys.platform!='darwin':raise RuntimeError('This installer requires macOS.')
    if os.uname().machine not in ['arm64','x86_64']:raise RuntimeError('Unsupported Mac architecture.')
    if args.action=='detect':print(json.dumps(detect(locate(args.app)),indent=2))
    else:
        with operation_lock():
            if args.action=='install':install(locate(args.app))
            elif args.action=='launch':launch()
            elif args.action=='update':update()
            else:uninstall()

if __name__=='__main__':
    try:main()
    except (RuntimeError,OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
        log('operation-failed',category=type(error).__name__)
        print('NOT COMPLETE: '+str(error),file=sys.stderr);sys.exit(1)
