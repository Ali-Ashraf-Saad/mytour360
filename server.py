#!/usr/bin/env python3
"""خادم محلي للتجربة بدون PHP: يقدّم الملفات ويحفظ التعديلات في data/tour.json.
التشغيل:  python server.py            (المنفذ 8000)
          EDIT_PASSWORD=سري python server.py 8080
"""
import http.server, json, os, re, secrets, sys, time, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
PASSWORD = os.environ.get('EDIT_PASSWORD', 'change-me')
IMG = re.compile(r'^images/[A-Za-z0-9_\-. ]+\.(jpe?g|png|webp)$', re.I)

def num(v, default=0.0):
    try: return float(v)
    except (TypeError, ValueError): return default

def clean(cfg):
    scenes = cfg.get('scenes') if isinstance(cfg, dict) else None
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 50: raise ValueError('المشاهد غير صالحة')
    n, out = len(scenes), {'scenes': []}
    for s in scenes:
        if not isinstance(s, dict): raise ValueError('مشهد غير صالح')
        image = str(s.get('image', ''))
        if not IMG.match(image) or '..' in image: raise ValueError('مسار صورة غير صالح')
        sc = {'name': str(s.get('name', '')).strip()[:200], 'image': image,
              'arrive': round(num(s.get('arrive')) % 360, 1), 'hotspots': []}
        for h in (s.get('hotspots') or [])[:50]:
            if not isinstance(h, dict): continue
            it = {'lon': round(num(h.get('lon')) % 360, 1),
                  'lat': round(max(-90, min(90, num(h.get('lat')))), 1),
                  'label': str(h.get('label', '')).strip()[:200]}
            if h.get('type') == 'info':
                it['type'] = 'info'; it['text'] = str(h.get('text', '')).strip()[:600]
            else:
                to = int(num(h.get('to'))); it['to'] = to if 0 <= to < n else 0
            sc['hotspots'].append(it)
        out['scenes'].append(sc)
    pr = cfg.get('property') or {}
    out['property'] = {'title': str(pr.get('title', '')).strip()[:200], 'price': str(pr.get('price', '')).strip()[:60],
        'location': str(pr.get('location', '')).strip()[:120], 'phone': re.sub(r'[^0-9+]', '', str(pr.get('phone', '')))[:20]}
    rem = [r for r in (cfg.get('removed') or []) if isinstance(r, str) and IMG.match(r) and '..' not in r]
    out['removed'] = list(dict.fromkeys(rem))[:100]
    return out

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path.startswith('/api/img.php'):
            f = os.path.basename(urllib.parse.unquote(urllib.parse.urlparse(self.path).query.partition('f=')[2].split('&')[0]))
            fp = os.path.join(ROOT, 'images', f)
            if not re.match(r'^[A-Za-z0-9_\-. ]+\.(jpe?g|png|webp)$', f, re.I) or not os.path.isfile(fp):
                self.send_response(404); self.end_headers(); return
            data = open(fp, 'rb').read()
            self.send_response(200); self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data); return
        super().do_GET()
    def do_POST(self):
        if self.path.split('?')[0] == '/api/upload.php':
            if urllib.parse.unquote(self.headers.get('X-Password', '')) != PASSWORD: return self.reply(403, {'ok': False, 'error': 'كلمة السر غير صحيحة'})
            size = int(self.headers.get('Content-Length', 0))
            if size > 12 * 1024 * 1024: return self.reply(413, {'ok': False, 'error': 'الصورة كبيرة (الحد 12MB)'})
            raw = self.rfile.read(size)
            if size < 1000 or raw[:3] != b'\xff\xd8\xff': return self.reply(400, {'ok': False, 'error': 'الملف ليس صورة JPEG'})
            name = 'scene-%s-%s.jpg' % (time.strftime('%Y%m%d-%H%M%S'), secrets.token_hex(3))
            os.makedirs(os.path.join(ROOT, 'images'), exist_ok=True)
            with open(os.path.join(ROOT, 'images', name), 'wb') as f: f.write(raw)
            return self.reply(200, {'ok': True, 'path': 'images/' + name})
        if self.path.split('?')[0] != '/api/save.php': return self.reply(404, {'ok': False, 'error': 'غير موجود'})
        try:
            size = int(self.headers.get('Content-Length', 0))
            if size > 200000: return self.reply(413, {'ok': False, 'error': 'الحجم كبير'})
            data = json.loads(self.rfile.read(size))
        except Exception: return self.reply(400, {'ok': False, 'error': 'بيانات غير صالحة'})
        if str(data.get('password', '')) != PASSWORD: return self.reply(403, {'ok': False, 'error': 'كلمة السر غير صحيحة'})
        try: out = clean(data.get('config'))
        except ValueError as e: return self.reply(400, {'ok': False, 'error': str(e)})
        os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
        tmp = os.path.join(ROOT, 'data', 'tour.json.tmp')
        with open(tmp, 'w', encoding='utf-8') as f: json.dump(out, f, ensure_ascii=False, indent=2)
        os.replace(tmp, os.path.join(ROOT, 'data', 'tour.json'))
        self.reply(200, {'ok': True})

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'http://localhost:{port}/?edit   (كلمة السر: {PASSWORD})')
    http.server.ThreadingHTTPServer(('', port), Handler).serve_forever()
