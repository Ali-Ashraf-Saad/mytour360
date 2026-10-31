<?php
/* رفع صورة 360° (JPEG) إلى مجلد images — يتطلب كلمة سر المحرر */
require __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
function fail($code, $msg) { http_response_code($code); echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'طريقة غير مسموحة');
$local = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
if (EDIT_PASSWORD === 'change-me' && !$local) fail(403, 'غيّر كلمة السر الافتراضية داخل api/config.php أولًا');
if (!hash_equals(EDIT_PASSWORD, rawurldecode($_SERVER['HTTP_X_PASSWORD'] ?? ''))) { usleep(600000); fail(403, 'كلمة السر غير صحيحة'); }

$raw = file_get_contents('php://input');
if (strlen($raw) < 1000) fail(400, 'الملف فارغ');
if (strlen($raw) > 12 * 1024 * 1024) fail(413, 'الصورة كبيرة (الحد 12MB)');
if (substr($raw, 0, 3) !== "\xFF\xD8\xFF") fail(400, 'الملف ليس صورة JPEG');

$dir = dirname(__DIR__) . '/images';
if (!is_dir($dir) && !mkdir($dir, 0755, true)) fail(500, 'تعذّر إنشاء مجلد images');
$name = 'scene-' . date('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.jpg';
if (file_put_contents($dir . '/' . $name, $raw) === false) fail(500, 'تعذّرت الكتابة — تحقق من صلاحيات مجلد images');
echo json_encode(['ok' => true, 'path' => 'images/' . $name]);
