(async () => {
'use strict';

/* ───────── الإعدادات: data/tour.json (المحفوظ على الموقع) وإلا config.js ───────── */
const base = window.TOUR_CONFIG;
let cfg = JSON.parse(JSON.stringify(base));
try {
  const r = await fetch('data/tour.json', { cache: 'no-store' });
  if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.scenes) && j.scenes.length) cfg = j; }
} catch (e) {}
/* مشاهد أُضيفت إلى config.js ولم تُحفظ بعد في tour.json: تُدمج تلقائيًا */
{
  const map = base.scenes.map(() => -1), fresh = [];
  base.scenes.forEach((bs, bi) => {
    const k = cfg.scenes.findIndex(s => s.image === bs.image);
    if (k !== -1) map[bi] = k; else if (!(cfg.removed || []).includes(bs.image)) fresh.push(bi);
  });
  fresh.forEach(bi => { cfg.scenes.push(JSON.parse(JSON.stringify(base.scenes[bi]))); map[bi] = cfg.scenes.length - 1; });
  fresh.forEach(bi => cfg.scenes[map[bi]].hotspots.forEach(hs => { hs.to = map[hs.to] >= 0 ? map[hs.to] : 0; }));
}
let dirty = false;
const save = () => { dirty = true; setStatus('تعديلات غير محفوظة'); };
function setStatus(msg) { const s = document.getElementById('status'); if (s) s.textContent = msg; }
if (new URLSearchParams(location.search).has('edit')) document.body.classList.add('can-edit');
const r1 = n => Math.round(n * 10) / 10;
const norm = d => ((d % 360) + 360) % 360;

/* ───────── three.js ───────── */
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
const geo = new THREE.SphereGeometry(500, 64, 40); geo.scale(-1, 1, 1);
const mat = new THREE.MeshBasicMaterial();
scene.add(new THREE.Mesh(geo, mat));

const rad = d => d * Math.PI / 180;
const dir = (lon, lat) => new THREE.Vector3(
  Math.cos(rad(lat)) * Math.cos(rad(lon)),
  Math.sin(rad(lat)),
  Math.cos(rad(lat)) * Math.sin(rad(lon)));

let lon = 180, lat = 0, fov = 75, cur = 0, busy = false;
let editMode = false, selected = null, dragging = null;
const textures = [];
let runtime = [];            // [{data, el, card, lonIn, latIn}]

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

/* ───────── أدوات DOM ───────── */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  kids.flat().forEach(c => e.append(c));
  return e;
}
const infoSvg = '<svg viewBox="0 0 24 24"><path d="M12 11v6M12 7.5v.01"/></svg>';
const arrowSvg = '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const $ = id => document.getElementById(id);
const bottom = $('bottom'), panelBody = $('panelBody');

/* ───────── المصغّرات والعناوين ───────── */
const thumbs = [];
function makeThumb(i) {
  const s = cfg.scenes[i];
  const t = h('button', { class: 'thumb', title: s.name, type: 'button', onclick: () => go(i) });
  t.style.backgroundImage = `url(${s.image})`; t.append(h('span', {}, s.name));
  bottom.appendChild(t); thumbs[i] = t;
}
cfg.scenes.forEach((s, i) => makeThumb(i));
function setUI() {
  $('title').textContent = cfg.scenes[cur].name;
  $('count').textContent = (cur + 1) + ' / ' + cfg.scenes.length;
  thumbs.forEach((t, i) => { t.classList.toggle('on', i === cur); t.title = cfg.scenes[i].name; t.firstChild.textContent = cfg.scenes[i].name; });
  document.title = cfg.scenes[cur].name + ' · جولة 360°';
}

/* ───────── الأسهم + لوحة المحرر ───────── */
function rebuild() {
  runtime.forEach(r => r.el.remove());
  runtime = []; panelBody.innerHTML = '';
  const s = cfg.scenes[cur];

  s.hotspots.forEach(data => {
    const el = h('button', { class: 'hs' + (data.type === 'info' ? ' info' : ''), type: 'button' });
    el.innerHTML = `<span class="btn">${data.type === 'info' ? infoSvg : arrowSvg}</span><span class="lbl"></span>`;
    el.querySelector('.lbl').textContent = data.label;
    const rt = { data, el };
    el.addEventListener('click', e => { e.stopPropagation(); if (!editMode) data.type === 'info' ? showInfo(data) : go(data.to, data); });
    el.addEventListener('pointerdown', e => {
      if (!editMode) return;
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId); dragging = rt; select(rt);
    });
    el.addEventListener('pointermove', e => {
      if (dragging !== rt) return;
      const p = screenToLL(e.clientX, e.clientY);
      data.lon = r1(p.lon); data.lat = r1(Math.max(-89, Math.min(89, p.lat)));
      rt.lonIn.value = data.lon; rt.latIn.value = data.lat;
    });
    const end = () => { if (dragging === rt) { dragging = null; save(); } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    document.body.appendChild(el);
    runtime.push(rt);
  });

  /* لوحة المحرر */
  const nameIn = h('input', { type: 'text', value: s.name });
  nameIn.addEventListener('input', () => { s.name = nameIn.value; save(); setUI(); });
  const arriveBtn = h('button', { type: 'button', onclick: () => { s.arrive = r1(norm(lon)); save(); arriveBtn.textContent = '✔ تم ضبط الاتجاه'; setTimeout(() => arriveBtn.textContent = 'اجعل الاتجاه الحالي هو نقطة فتح هذا المشهد', 1200); } }, 'اجعل الاتجاه الحالي هو نقطة فتح هذا المشهد');
  const pf = (k, lab, ph) => { const i = h('input', { type: 'text', placeholder: ph || '' }); i.value = (cfg.property && cfg.property[k]) || ''; i.addEventListener('input', () => { (cfg.property = cfg.property || {})[k] = i.value; save(); renderProp(); }); return h('label', {}, lab, i); };
  panelBody.append(
    h('div', { class: 'sec' }, 'بيانات العقار'), pf('title', 'اسم العقار'), pf('price', 'السعر التقريبي'), pf('location', 'الموقع'), pf('phone', 'رقم التواصل (بصيغة دولية مثل 2010xxxxxxx)'),
    h('div', { class: 'sec' }, `المشهد ${cur + 1} من ${cfg.scenes.length}`),
    h('label', {}, 'اسم المشهد', nameIn),
    arriveBtn,
    h('div', { class: 'sec' }, 'الأسهم في هذا المشهد')
  );

  runtime.forEach(rt => {
    const d = rt.data;
    const labelIn = h('input', { type: 'text', value: d.label });
    labelIn.addEventListener('input', () => { d.label = labelIn.value; rt.el.querySelector('.lbl').textContent = d.label; save(); });
    const sel = h('select', {}, cfg.scenes.map((sc, i) => { const o = h('option', { value: i }, `${i + 1}. ${sc.name}`); if (i === d.to) o.selected = true; return o; }));
    sel.addEventListener('change', () => { d.to = Number(sel.value); save(); });
    const isInfo = d.type === 'info';
    const typeSel = h('select', {}, h('option', { value: 'nav' }, 'سهم انتقال'), h('option', { value: 'info' }, 'نقطة معلومة'));
    typeSel.value = isInfo ? 'info' : 'nav';
    typeSel.addEventListener('change', () => {
      if (typeSel.value === 'info') { d.type = 'info'; d.text = d.text || ''; delete d.to; }
      else { delete d.type; delete d.text; d.to = (cur + 1) % cfg.scenes.length; }
      save(); selected = rt; rebuild();
    });
    const textIn = h('textarea', { rows: '3' }); textIn.value = d.text || '';
    textIn.addEventListener('input', () => { d.text = textIn.value; save(); });
    rt.lonIn = h('input', { type: 'number', step: '0.5', value: d.lon });
    rt.latIn = h('input', { type: 'number', step: '0.5', value: d.lat });
    rt.lonIn.addEventListener('input', () => { d.lon = Number(rt.lonIn.value) || 0; save(); });
    rt.latIn.addEventListener('input', () => { d.lat = Number(rt.latIn.value) || 0; save(); });
    rt.card = h('div', { class: 'card' },
      h('label', {}, 'العنوان / النص', labelIn),
      h('label', {}, 'النوع', typeSel),
      isInfo ? h('label', {}, 'نص المعلومة', textIn) : h('label', {}, 'ينقل إلى', sel),
      h('div', { class: 'row' }, h('label', {}, 'الاتجاه الأفقي (lon)', rt.lonIn), h('label', {}, 'الاتجاه الرأسي (lat)', rt.latIn)),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => { lon = d.lon; lat = d.lat * 0.3; select(rt); } }, '🎯 اذهب إليه'),
        h('button', { type: 'button', onclick: () => { if (confirm('حذف هذا السهم؟')) { s.hotspots.splice(s.hotspots.indexOf(d), 1); save(); selected = null; rebuild(); } }, class: 'danger' }, '🗑 حذف')
      )
    );
    rt.card.addEventListener('pointerdown', () => select(rt));
    panelBody.appendChild(rt.card);
  });

  panelBody.append(
    h('button', { type: 'button', class: 'primary', onclick: () => addHotspot() }, '＋ إضافة سهم انتقال'),
    h('button', { type: 'button', onclick: () => addHotspot('info') }, 'ℹ️ إضافة نقطة معلومة'),
    h('button', { type: 'button', onclick: addScene }, '📤 رفع صورة 360° كمشهد جديد'),
    h('button', { type: 'button', class: 'danger', onclick: deleteScene }, '🗑 حذف هذا المشهد')
  );
  select(selected && runtime.find(r => r.data === selected.data) || null);
}
function select(rt) {
  selected = rt;
  runtime.forEach(r => { r.el.classList.toggle('sel', r === rt); r.card && r.card.classList.toggle('sel', r === rt); });
}
function addHotspot(type) {
  const s = cfg.scenes[cur];
  const d = type === 'info' ? { type: 'info', lon: r1(norm(lon)), lat: r1(lat), label: 'معلومة', text: 'اكتب المعلومة هنا' } : { to: (cur + 1) % cfg.scenes.length, lon: r1(norm(lon)), lat: -10, label: 'سهم جديد' };
  s.hotspots.push(d); save(); selected = null; rebuild();
  const rt = runtime[runtime.length - 1]; select(rt); rt.card.scrollIntoView({ block: 'nearest' });
}

function loadTex(i, ok, err, tries = 3) {
  const direct = cfg.scenes[i].image;
  /* المحاولة الأولى مباشرة، وإن رُفضت (403 مثلًا) نمرّر الصورة عبر api/img.php */
  const url = tries === 3 ? direct : 'api/img.php?f=' + encodeURIComponent(direct.replace(/^images\//, ''));
  fetch(url, { cache: 'force-cache' })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (!/image/i.test(ct)) throw new Error('الاستضافة أرجعت صفحة بدل الصورة (' + (ct.split(';')[0] || 'غير معروف') + ')');
      return r.blob();
    })
    .then(b => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('تعذّر فك ترميز الصورة')); im.src = URL.createObjectURL(b); }))
    .then(im => {
      const max = Math.min(renderer.capabilities.maxTextureSize || 4096, 8192);
      let src = im;
      if (im.width > max) { const cv = document.createElement('canvas'); cv.width = max; cv.height = Math.round(max * im.height / im.width); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); src = cv; }
      const tex = new THREE.Texture(src);
      tex.encoding = THREE.sRGBEncoding; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
      textures[i] = tex; ok && ok();
    })
    .catch(e => { if (tries > 1) setTimeout(() => loadTex(i, ok, err, tries - 1), 800); else err && err(e); });
}
let pending = {};
function ensureTex(i) {
  if (textures[i]) return Promise.resolve();
  return pending[i] || (pending[i] = new Promise((res, rej) => loadTex(i, res, e => { delete pending[i]; rej(new Error('تعذّر تحميل ' + cfg.scenes[i].image + (e ? ' — ' + e.message : ''))); })));
}
let toastT;
function toast(msg, ms = 2600) { const e = $('toast'); e.textContent = msg; e.hidden = !msg; clearTimeout(toastT); if (msg && ms) toastT = setTimeout(() => { e.hidden = true; }, ms); }
const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: '' }); document.body.appendChild(fileIn);
function addScene() { fileIn.click(); }
fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) uploadScene(f); });
async function uploadScene(file) {
  if (!password) { password = prompt('كلمة سر المحرر:'); if (!password) { password = null; return; } }
  try {
    toast('جارٍ تجهيز الصورة…', 0);
    const img = await createImageBitmap(file);
    if (Math.abs(img.width / img.height - 2) > 0.15 && !confirm('الصورة ليست بنسبة 2:1 (الصيغة القياسية لصور 360°) وقد تظهر مشوّهة. المتابعة؟')) { toast(''); return; }
    const W = Math.min(img.width, 6144), H = Math.round(W * img.height / img.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').drawImage(img, 0, 0, W, H);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
    toast('جارٍ الرفع… (' + (blob.size / 1048576).toFixed(1) + ' MB)', 0);
    const r = await fetch('api/upload.php', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Password': encodeURIComponent(password) }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { if (r.status === 403) password = null; throw new Error(j.error || 'فشل الرفع'); }
    const n = cfg.scenes.length, prev = cur;
    cfg.removed = (cfg.removed || []).filter(x => x !== j.path);
    cfg.scenes.push({ name: 'مشهد ' + (n + 1), image: j.path, arrive: 180, hotspots: [{ to: prev, lon: 0, lat: -10, label: 'رجوع' }] });
    cfg.scenes[prev].hotspots.push({ to: n, lon: r1(norm(lon)), lat: -10, label: 'إلى ' + cfg.scenes[n].name });
    makeThumb(n); setUI(); toast('تمت إضافة المشهد ✔'); go(n); $('btnSave').click();
  } catch (e) { toast('✖ ' + e.message, 4000); }
}
function deleteScene() {
  if (cfg.scenes.length < 2) { alert('لا يمكن حذف المشهد الوحيد'); return; }
  if (!confirm('حذف المشهد «' + cfg.scenes[cur].name + '» وكل الأسهم المؤدية إليه؟')) return;
  const d = cur;
  (cfg.removed = cfg.removed || []).push(cfg.scenes[d].image);
  cfg.scenes.splice(d, 1); textures.splice(d, 1); pending = {};
  cfg.scenes.forEach(s => {
    s.hotspots = s.hotspots.filter(x => x.type === 'info' || x.to !== d);
    s.hotspots.forEach(x => { if (x.type !== 'info' && x.to > d) x.to--; });
  });
  thumbs.forEach(x => x.remove()); thumbs.length = 0; cfg.scenes.forEach((s, i) => makeThumb(i));
  cur = Math.min(d, cfg.scenes.length - 1);
  mat.map = textures[cur]; mat.needsUpdate = true; lon = cfg.scenes[cur].arrive; lat = 0; selected = null;
  save(); rebuild(); setUI();
}
function showInfo(d) { $('popT').textContent = d.label; $('popX').textContent = d.text || ''; $('pop').hidden = false; }
$('popC').addEventListener('click', () => { $('pop').hidden = true; });

/* ───────── الانتقال بين المشاهد (مع تأثير "المشي" نحو السهم) ───────── */
let vlon = 0, vlat = 0;
function setFov(v) { fov = v; camera.fov = v; camera.updateProjectionMatrix(); }
function go(i, via) {
  if (busy || i === cur) return; busy = true;
  const f = $('fade'), F0 = fov, ready = ensureTex(i);
  const swap = () => {
    cur = i; mat.map = textures[i]; mat.needsUpdate = true;
    lon = cfg.scenes[i].arrive; lat = 0; turned = 0; vlon = vlat = 0; setFov(F0);
    selected = null; rebuild(); setUI();
    f.style.opacity = 0; busy = false;
  };
  const fail = e => { busy = false; f.style.opacity = 0; setFov(F0); toast('✖ ' + e.message, 4000); };
  if (!via) { f.style.opacity = 1; setTimeout(() => ready.then(swap, fail), 470); return; }
  const L0 = lon, A0 = lat, dl = ((via.lon - lon + 540) % 360) - 180, t0 = performance.now();
  (function step(now) {
    const k = Math.min(1, (now - t0) / 650), e = k * k * (3 - 2 * k);
    lon = L0 + dl * e; lat = A0 + (via.lat * 0.4 - A0) * e; setFov(F0 - (F0 - 42) * e);
    if (k < 1) requestAnimationFrame(step);
    else { f.style.opacity = 1; setTimeout(() => ready.then(swap, fail), 450); }
  })(t0);
}

/* ───────── جولة تلقائية + رادار + ملء الشاشة ───────── */
let touring = false, turned = 0;
const stopTour = () => { touring = false; $('btnTour').textContent = '▶'; };
$('btnTour').addEventListener('click', () => { touring ? stopTour() : (touring = true, turned = 0, $('btnTour').textContent = '⏸'); });
view.addEventListener('pointerdown', () => { if (touring) stopTour(); });
$('btnFs').addEventListener('click', () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); });
const rc = $('radar').getContext('2d');
function drawRadar() {
  const c = 60, R = 52; rc.clearRect(0, 0, 120, 120);
  rc.fillStyle = 'rgba(0,0,0,.5)'; rc.beginPath(); rc.arc(c, c, R + 4, 0, 7); rc.fill();
  const hf = 2 * Math.atan(Math.tan(rad(fov) / 2) * camera.aspect);
  rc.fillStyle = 'rgba(255,209,102,.35)'; rc.beginPath(); rc.moveTo(c, c); rc.arc(c, c, R, -Math.PI / 2 - hf / 2, -Math.PI / 2 + hf / 2); rc.closePath(); rc.fill();
  rc.strokeStyle = 'rgba(255,255,255,.35)'; rc.beginPath(); rc.arc(c, c, R, 0, 7); rc.stroke();
  runtime.forEach(r => {
    const a = rad(r.data.lon - lon);
    rc.fillStyle = r.data.type === 'info' ? '#6ec1ff' : '#ffd166';
    rc.beginPath(); rc.arc(c + Math.sin(a) * R * 0.78, c - Math.cos(a) * R * 0.78, 5, 0, 7); rc.fill();
  });
  rc.fillStyle = '#fff'; rc.beginPath(); rc.arc(c, c, 3, 0, 7); rc.fill();
}

/* ───────── وضع المحرر ───────── */
function setEdit(on) {
  if (!on && dirty && !confirm('لديك تعديلات غير محفوظة. الخروج من المحرر؟ (تبقى التعديلات في الصفحة حتى تحدّثها)')) return;
  editMode = on; dragging = null;
  document.body.classList.toggle('edit', on);
  $('panel').hidden = !on;
  $('editToggle').textContent = on ? '✔ إنهاء التحرير' : '✏️ وضع المحرر';
}
$('editToggle').addEventListener('click', () => setEdit(!editMode));
$('btnClose').addEventListener('click', () => setEdit(false));
addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('pop').hidden) $('pop').hidden = true; else if (editMode) setEdit(false); } });
view.addEventListener('dblclick', e => {
  if (!editMode || !selected) return;
  const p = screenToLL(e.clientX, e.clientY);
  selected.data.lon = r1(p.lon); selected.data.lat = r1(Math.max(-89, Math.min(89, p.lat)));
  selected.lonIn.value = selected.data.lon; selected.latIn.value = selected.data.lat; save();
});
function configText() {
  return '/* أُنشئ من وضع المحرر */\nwindow.TOUR_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n';
}
$('btnDownload').addEventListener('click', () => {
  const a = h('a', { href: URL.createObjectURL(new Blob([configText()], { type: 'text/javascript' })), download: 'config.js' });
  document.body.appendChild(a); a.click(); a.remove();
});
$('btnCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(configText()); $('btnCopy').textContent = '✔ تم النسخ'; }
  catch (e) { prompt('انسخ الإعدادات:', configText()); }
  setTimeout(() => $('btnCopy').textContent = '📋 نسخ', 1200);
});
let password = null;
$('btnSave').addEventListener('click', async () => {
  if (!password) { password = prompt('كلمة سر المحرر:'); if (!password) { password = null; return; } }
  setStatus('جارٍ الحفظ…');
  try {
    const r = await fetch('api/save.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, config: cfg }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) { dirty = false; setStatus('✔ تم الحفظ في الموقع'); }
    else { if (r.status === 403) password = null; setStatus('✖ ' + (j.error || 'فشل الحفظ')); }
  } catch (e) { setStatus('✖ تعذّر الاتصال بالخادم (تأكد أن api/save.php يعمل)'); }
});
$('btnReset').addEventListener('click', () => {
  if (dirty && !confirm('تجاهل التعديلات غير المحفوظة؟')) return;
  dirty = false; location.reload();
});
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ───────── التحكم بالكاميرا ───────── */
const pts = new Map(); let lastPinch = 0;
view.addEventListener('pointerdown', e => { view.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); });
view.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId)) return;
  const p = pts.get(e.pointerId);
  if (pts.size === 1) { const k = 0.12 * fov / 75; vlon = -(e.clientX - p.clientX) * k; vlat = (e.clientY - p.clientY) * k; lon += vlon; lat = Math.max(-85, Math.min(85, lat + vlat)); }
  pts.set(e.pointerId, e);
  if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (lastPinch) zoom((lastPinch - d) * 0.15); lastPinch = d; }
});
const up = e => { pts.delete(e.pointerId); lastPinch = 0; };
view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
function zoom(d) { fov = Math.max(35, Math.min(95, fov + d)); camera.fov = fov; camera.updateProjectionMatrix(); }
view.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY * 0.05); }, { passive: false });
addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') lon -= 5;
  if (e.key === 'ArrowRight') lon += 5;
  if (e.key === 'ArrowUp') lat = Math.min(85, lat + 4);
  if (e.key === 'ArrowDown') lat = Math.max(-85, lat - 4);
  const N = cfg.scenes.length;
  if (e.key === ' ') { e.preventDefault(); $('btnTour').click(); }
  if (e.key === 'f' || e.key === 'F') $('btnFs').click();
  if (e.key === 'n' || e.key === 'N') go((cur + 1) % N);
  if (e.key === 'p' || e.key === 'P') go((cur - 1 + N) % N);
  if (e.key === '+') zoom(-5);
  if (e.key === '-') zoom(5);
});

/* من إحداثيات الشاشة إلى lon/lat */
function screenToLL(x, y) {
  const v = new THREE.Vector3((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
  return { lon: norm(Math.atan2(v.z, v.x) * 180 / Math.PI), lat: Math.asin(v.y) * 180 / Math.PI };
}

/* ───────── حلقة العرض ───────── */
const tmp = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  if (!pts.size && !touring) { lon += vlon; lat = Math.max(-85, Math.min(85, lat + vlat)); vlon *= 0.93; vlat *= 0.93; }
  if (touring && !busy && !pts.size) {
    lon += 0.18; lat += (0 - lat) * 0.02; turned += 0.18;
    if (turned >= 330) { turned = 0; const hs = cfg.scenes[cur].hotspots.find(x => x.type !== 'info'); go(hs ? hs.to : (cur + 1) % cfg.scenes.length, hs); }
  }
  drawRadar();
  camera.lookAt(dir(lon, lat)); camera.updateMatrixWorld();
  renderer.render(scene, camera);
  runtime.forEach(r => {
    tmp.copy(dir(r.data.lon, r.data.lat)).multiplyScalar(400).project(camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1) { r.el.style.display = 'none'; return; }
    r.el.style.display = 'block';
    r.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px,${(-tmp.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%)`;
  });
}

/* ───────── تحميل الصور ───────── */
/* ───────── بيانات العقار / مشاركة / جيروسكوب ───────── */
function renderProp() {
  const p = cfg.property || {}, ph = (p.phone || '').replace(/[^0-9]/g, '');
  $('btnProp').hidden = !(p.title || p.price);
  if ($('btnProp').hidden) $('prop').hidden = true;
  $('propT').textContent = p.title || ''; $('propP').textContent = p.price || '';
  $('propL').textContent = p.location ? '📍 ' + p.location : '';
  $('propWa').hidden = $('propTel').hidden = !ph;
  $('propWa').href = 'https://wa.me/' + ph + '?text=' + encodeURIComponent('مرحبًا، مهتم بالعقار: ' + (p.title || ''));
  $('propTel').href = 'tel:+' + ph;
}
$('btnProp').addEventListener('click', () => { $('prop').hidden = !$('prop').hidden; });
$('propC').addEventListener('click', () => { $('prop').hidden = true; });
$('btnShare').addEventListener('click', async () => {
  const u = location.origin + location.pathname + '?s=' + (cur + 1);
  try { await navigator.clipboard.writeText(u); toast('تم نسخ رابط هذا المشهد 🔗'); } catch (e) { prompt('انسخ الرابط:', u); }
});
let gyro = null;
function onOri(e) {
  if (e.alpha == null || e.beta == null) return;
  if (!gyro.z) gyro.z = { a: e.alpha, l: lon };
  lon = gyro.z.l - (e.alpha - gyro.z.a); lat = Math.max(-85, Math.min(85, e.beta - 90)); vlon = vlat = 0;
}
$('btnGyro').addEventListener('click', async () => {
  if (gyro) { removeEventListener('deviceorientation', onOri); gyro = null; $('btnGyro').classList.remove('on'); return; }
  try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission && await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch (e) { return; }
  gyro = {}; addEventListener('deviceorientation', onOri); $('btnGyro').classList.add('on'); toast('حرّك هاتفك للتجوّل 🧭');
});
if (!('ontouchstart' in window)) $('btnGyro').hidden = true;
view.addEventListener('pointerdown', () => { vlon = vlat = 0; if (gyro) gyro.z = null; });
addEventListener('keydown', () => {}, { passive: true });

/* ───────── البدء: تحميل المشهد الأول فقط ثم الباقي في الخلفية ───────── */
cur = Math.max(0, Math.min(cfg.scenes.length - 1, (parseInt(new URLSearchParams(location.search).get('s'), 10) || 1) - 1));
ensureTex(cur).then(() => {
  mat.map = textures[cur]; mat.needsUpdate = true; lon = cfg.scenes[cur].arrive;
  rebuild(); setUI(); renderProp(); if (!$('btnProp').hidden) $('prop').hidden = false;
  $('loader').classList.add('done'); setTimeout(() => { $('loader').style.display = 'none'; }, 600); frame();
  cfg.scenes.forEach((s, i) => setTimeout(() => ensureTex(i).catch(() => {}), 1500 + i * 1200));
}).catch(e => { $('loader').innerHTML = '<div dir="auto">' + e.message + '</div><button type="button" class="retry" onclick="location.reload()">إعادة المحاولة</button>'; });
})();
