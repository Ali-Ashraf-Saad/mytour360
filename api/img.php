<?php
/* يمرّر صورة من images/ عبر PHP — بديل عند رفض الاستضافة للطلب المباشر (403) */
$f = basename((string)($_GET['f'] ?? ''));
if (!preg_match('/^[A-Za-z0-9_\-. ]+\.(jpe?g|png|webp)$/i', $f)) { http_response_code(400); exit; }
$p = dirname(__DIR__) . '/images/' . $f;
if (!is_file($p)) { http_response_code(404); exit; }
$ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
header('Content-Type: ' . ($ext === 'png' ? 'image/png' : ($ext === 'webp' ? 'image/webp' : 'image/jpeg')));
header('Content-Length: ' . filesize($p));
header('Cache-Control: public, max-age=86400');
readfile($p);
