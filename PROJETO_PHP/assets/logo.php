<?php
declare(strict_types=1);

$file = __DIR__ . '/logo-original.base64';
$raw = is_file($file) ? (string)file_get_contents($file) : '';
$base64 = preg_replace('/\s+/', '', $raw) ?? '';
$image = $base64 !== '' ? base64_decode($base64, true) : false;

if ($image === false || $image === '') {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'Logo original não encontrada na distribuição XAMPP.';
    exit;
}

header('Content-Type: image/jpeg');
header('Content-Length: ' . strlen($image));
header('Cache-Control: public, max-age=3600');
echo $image;
