<?php
/* حفظ تعديلات المحرر في data/tour.json — يعمل على أي استضافة PHP (مثل InfinityFree) */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/* ⚠️ غيّر كلمة السر قبل الرفع. تُرفض كلمة السر الافتراضية خارج الجهاز المحلي. */
require __DIR__ . '/config.php';

function fail($code, $msg) {
  http_response_code($code);
  echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}
function clean_str($v, $max = 200) { return mb_substr(trim(strip_tags((string)$v)), 0, $max); }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'طريقة غير مسموحة');

$local = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
if (EDIT_PASSWORD === 'change-me' && !$local) fail(403, 'غيّر كلمة السر الافتراضية داخل api/save.php أولًا');

$raw = file_get_contents('php://input');
if (strlen($raw) > 200000) fail(413, 'الحجم كبير');
$in = json_decode($raw, true);
if (!is_array($in)) fail(400, 'بيانات غير صالحة');

if (!hash_equals(EDIT_PASSWORD, (string)($in['password'] ?? ''))) { usleep(600000); fail(403, 'كلمة السر غير صحيحة'); }

$scenes = $in['config']['scenes'] ?? null;
if (!is_array($scenes) || count($scenes) < 1 || count($scenes) > 50) fail(400, 'المشاهد غير صالحة');

$out = ['scenes' => []];
$n = count($scenes);
foreach (array_values($scenes) as $s) {
  if (!is_array($s)) fail(400, 'مشهد غير صالح');
  $image = (string)($s['image'] ?? '');
  if (!preg_match('#^images/[A-Za-z0-9_\-. ]+\.(jpe?g|png|webp)$#i', $image) || strpos($image, '..') !== false) fail(400, 'مسار صورة غير صالح');
  $scene = [
    'name' => clean_str($s['name'] ?? ''),
    'image' => $image,
    'arrive' => round(fmod((float)($s['arrive'] ?? 0) + 360, 360), 1),
    'hotspots' => [],
  ];
  $hs = $s['hotspots'] ?? [];
  if (!is_array($hs) || count($hs) > 50) fail(400, 'أسهم غير صالحة');
  foreach ($hs as $h) {
    if (!is_array($h)) continue;
    $item = [
      'lon' => round(fmod((float)($h['lon'] ?? 0) + 360, 360), 1),
      'lat' => round(max(-90, min(90, (float)($h['lat'] ?? 0))), 1),
      'label' => clean_str($h['label'] ?? ''),
    ];
    if (($h['type'] ?? '') === 'info') { $item['type'] = 'info'; $item['text'] = clean_str($h['text'] ?? '', 600); }
    else { $to = (int)($h['to'] ?? 0); $item['to'] = ($to < 0 || $to >= $n) ? 0 : $to; }
    $scene['hotspots'][] = $item;
  }
  $out['scenes'][] = $scene;
}

$pr = $in['config']['property'] ?? [];
$out['property'] = [
  'title' => clean_str($pr['title'] ?? ''), 'price' => clean_str($pr['price'] ?? '', 60),
  'location' => clean_str($pr['location'] ?? '', 120), 'phone' => substr(preg_replace('/[^0-9+]/', '', (string)($pr['phone'] ?? '')), 0, 20),
];
$removed = [];
foreach (($in['config']['removed'] ?? []) as $r) {
  if (is_string($r) && preg_match('#^images/[A-Za-z0-9_\-. ]+\.(jpe?g|png|webp)$#i', $r) && strpos($r, '..') === false) $removed[] = $r;
}
$out['removed'] = array_slice(array_values(array_unique($removed)), 0, 100);

$dir = dirname(__DIR__) . '/data';
if (!is_dir($dir) && !mkdir($dir, 0755, true)) fail(500, 'تعذّر إنشاء مجلد data');
$tmp = $dir . '/tour.json.tmp';
$json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
if (file_put_contents($tmp, $json, LOCK_EX) === false || !rename($tmp, $dir . '/tour.json')) fail(500, 'تعذّرت الكتابة — تحقق من صلاحيات مجلد data');

echo json_encode(['ok' => true]);
