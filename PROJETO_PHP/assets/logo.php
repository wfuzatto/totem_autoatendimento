<?php
$original = dirname(__DIR__, 2) . '/public/assets/skins/vale-mantiqueira/logo.jpg';
if (is_file($original)) {
    header('Content-Type: image/jpeg');
    header('Cache-Control: public, max-age=3600');
    readfile($original);
    exit;
}
header('Content-Type: image/svg+xml; charset=utf-8');
header('Cache-Control: no-store');
echo <<<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 180">
  <rect width="760" height="180" fill="white"/>
  <text x="380" y="75" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#006b3c">Hotel Fazenda</text>
  <text x="380" y="128" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="800" fill="#73b842">Vale da Mantiqueira</text>
</svg>
SVG;
