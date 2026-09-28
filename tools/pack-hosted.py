"""Package a built page (dist/) for hosts that only serve text/web types (e.g. claude.ai
artifacts): .glb → base64 .b64.txt, manifest rewritten, page reduced to its body content.

    npm run build && python3 tools/pack-hosted.py <outDir> [game|viewer]
"""
import base64, json, os, re, shutil, sys

out = sys.argv[1]
page = sys.argv[2] if len(sys.argv) > 2 else 'game'
src_html, title = {'game': ('dist/index.html', 'Mandate of Heaven'), 'viewer': ('dist/viewer.html', 'Mandate of Heaven Viewer')}[page]
shutil.rmtree(out, ignore_errors=True)
os.makedirs(os.path.join(out, 'assets', 'models'))
for f in os.listdir('dist/assets'):
    if f.endswith('.js'):
        shutil.copy(os.path.join('dist/assets', f), os.path.join(out, 'assets', f))
man = json.load(open('dist/assets/models/manifest.json'))
man['assets'] = [a for a in man['assets'] if a.get('category') != 'dev']  # viewer-only previews
for a in man['assets']:
    data = open(os.path.join('dist/assets/models', a['file']), 'rb').read()
    a['file'] = a['file'] + '.b64.txt'
    open(os.path.join(out, 'assets', 'models', a['file']), 'w').write(base64.b64encode(data).decode())
json.dump(man, open(os.path.join(out, 'assets', 'models', 'manifest.json'), 'w'))
s = open(src_html).read()
style = re.search(r'<style>.*?</style>', s, re.S).group(0)
fonts = re.findall(r'<link[^>]*(?:googleapis|gstatic)[^>]*>', s)
script = re.search(r'<script type="module"[^>]*></script>', s).group(0)
body = re.sub(r'<script type="module"[^>]*></script>', '', re.search(r'<body>(.*?)</body>', s, re.S).group(1))
open(os.path.join(out, 'index.html'), 'w').write(f'<title>{title}</title>\n' + '\n'.join(fonts) + '\n' + style + '\n' + body.strip() + '\n' + script + '\n')
print(json.dumps({'files': sorted(os.listdir(os.path.join(out, 'assets'))) + sorted(os.listdir(os.path.join(out, 'assets', 'models')))}))
