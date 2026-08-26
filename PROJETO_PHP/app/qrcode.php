<?php
declare(strict_types=1);

/**
 * Gerador QR Code Model 2 autocontido para a V3 XAMPP.
 * - modo Byte
 * - nível de correção L
 * - versões 1 a 6
 * - máscara 0
 *
 * Não depende de GD, Composer, qrencode ou serviços externos.
 */

function qr_gf_multiply(int $x, int $y): int
{
    $z = 0;
    for ($i = 7; $i >= 0; $i--) {
        $z = (($z << 1) ^ (($z >> 7) * 0x11D)) & 0xFF;
        if ((($y >> $i) & 1) !== 0) $z ^= $x;
    }
    return $z;
}

function qr_rs_divisor(int $degree): array
{
    $result = array_fill(0, $degree, 0);
    $result[$degree - 1] = 1;
    $root = 1;
    for ($i = 0; $i < $degree; $i++) {
        for ($j = 0; $j < $degree; $j++) {
            $result[$j] = qr_gf_multiply($result[$j], $root);
            if ($j + 1 < $degree) $result[$j] ^= $result[$j + 1];
        }
        $root = qr_gf_multiply($root, 0x02);
    }
    return $result;
}

function qr_rs_remainder(array $data, int $degree): array
{
    $divisor = qr_rs_divisor($degree);
    $result = array_fill(0, $degree, 0);
    foreach ($data as $byte) {
        $factor = ((int)$byte) ^ $result[0];
        array_shift($result);
        $result[] = 0;
        for ($i = 0; $i < $degree; $i++) {
            $result[$i] ^= qr_gf_multiply($divisor[$i], $factor);
        }
    }
    return $result;
}

function qr_append_bits(array &$bits, int $value, int $length): void
{
    for ($i = $length - 1; $i >= 0; $i--) $bits[] = ($value >> $i) & 1;
}

function qr_version_spec(int $byteLength): array
{
    // data = quantidade de codewords de dados; ecc = ECC por bloco.
    // A versão 6-L possui dois blocos iguais de 68 codewords de dados.
    $specs = [
        1 => ['data'=>19,  'ecc'=>7,  'blocks'=>1, 'centers'=>[]],
        2 => ['data'=>34,  'ecc'=>10, 'blocks'=>1, 'centers'=>[6,18]],
        3 => ['data'=>55,  'ecc'=>15, 'blocks'=>1, 'centers'=>[6,22]],
        4 => ['data'=>80,  'ecc'=>20, 'blocks'=>1, 'centers'=>[6,26]],
        5 => ['data'=>108, 'ecc'=>26, 'blocks'=>1, 'centers'=>[6,30]],
        6 => ['data'=>136, 'ecc'=>18, 'blocks'=>2, 'centers'=>[6,34]],
    ];
    foreach ($specs as $version => $spec) {
        // 4 bits modo + 8 bits tamanho + payload + terminador/alinhamento.
        $capacityBits = $spec['data'] * 8;
        $requiredBits = 4 + 8 + ($byteLength * 8);
        if ($requiredBits <= $capacityBits) return ['version'=>$version] + $spec;
    }
    throw new InvalidArgumentException('Conteúdo grande demais para o QR local. Reduza a URL pública do totem.');
}

function qr_make_codewords(string $text, array $spec): array
{
    $bytes = array_values(unpack('C*', $text) ?: []);
    $bits = [];
    qr_append_bits($bits, 0b0100, 4); // Byte mode
    qr_append_bits($bits, count($bytes), 8); // versões 1-9
    foreach ($bytes as $byte) qr_append_bits($bits, $byte, 8);

    $capacity = $spec['data'] * 8;
    $terminator = min(4, max(0, $capacity - count($bits)));
    for ($i = 0; $i < $terminator; $i++) $bits[] = 0;
    while ((count($bits) % 8) !== 0 && count($bits) < $capacity) $bits[] = 0;

    $data = [];
    for ($i = 0; $i < count($bits); $i += 8) {
        $value = 0;
        for ($j = 0; $j < 8; $j++) $value = ($value << 1) | ($bits[$i + $j] ?? 0);
        $data[] = $value;
    }
    $pads = [0xEC, 0x11];
    $p = 0;
    while (count($data) < $spec['data']) {
        $data[] = $pads[$p++ & 1];
    }

    $blocks = (int)$spec['blocks'];
    if ($blocks === 1) return array_merge($data, qr_rs_remainder($data, (int)$spec['ecc']));

    $blockSize = intdiv(count($data), $blocks);
    $dataBlocks = [];
    $eccBlocks = [];
    for ($b = 0; $b < $blocks; $b++) {
        $block = array_slice($data, $b * $blockSize, $blockSize);
        $dataBlocks[] = $block;
        $eccBlocks[] = qr_rs_remainder($block, (int)$spec['ecc']);
    }

    $result = [];
    for ($i = 0; $i < $blockSize; $i++) {
        for ($b = 0; $b < $blocks; $b++) $result[] = $dataBlocks[$b][$i];
    }
    for ($i = 0; $i < (int)$spec['ecc']; $i++) {
        for ($b = 0; $b < $blocks; $b++) $result[] = $eccBlocks[$b][$i];
    }
    return $result;
}

function qr_bch_format(int $mask): int
{
    // L = 01. Os 5 bits são EC(2) + máscara(3).
    $data = (0b01 << 3) | ($mask & 7);
    $rem = $data << 10;
    for ($i = 14; $i >= 10; $i--) {
        if ((($rem >> $i) & 1) !== 0) $rem ^= 0x537 << ($i - 10);
    }
    return (($data << 10) | ($rem & 0x3FF)) ^ 0x5412;
}

function qr_set_function(array &$m, array &$f, int $x, int $y, bool $dark): void
{
    $size = count($m);
    if ($x < 0 || $y < 0 || $x >= $size || $y >= $size) return;
    $m[$y][$x] = $dark;
    $f[$y][$x] = true;
}

function qr_draw_finder(array &$m, array &$f, int $cx, int $cy): void
{
    for ($dy = -4; $dy <= 4; $dy++) {
        for ($dx = -4; $dx <= 4; $dx++) {
            $dist = max(abs($dx), abs($dy));
            qr_set_function($m, $f, $cx + $dx, $cy + $dy, $dist !== 2 && $dist !== 4);
        }
    }
}

function qr_draw_alignment(array &$m, array &$f, int $cx, int $cy): void
{
    if ($f[$cy][$cx]) return;
    for ($dy = -2; $dy <= 2; $dy++) {
        for ($dx = -2; $dx <= 2; $dx++) {
            qr_set_function($m, $f, $cx + $dx, $cy + $dy, max(abs($dx), abs($dy)) !== 1);
        }
    }
}

function qr_draw_format(array &$m, array &$f, int $mask): void
{
    $size = count($m);
    $bits = qr_bch_format($mask);
    $bit = static fn(int $i): bool => (($bits >> $i) & 1) !== 0;

    for ($i = 0; $i <= 5; $i++) qr_set_function($m, $f, 8, $i, $bit($i));
    qr_set_function($m, $f, 8, 7, $bit(6));
    qr_set_function($m, $f, 8, 8, $bit(7));
    qr_set_function($m, $f, 7, 8, $bit(8));
    for ($i = 9; $i < 15; $i++) qr_set_function($m, $f, 14 - $i, 8, $bit($i));

    for ($i = 0; $i < 8; $i++) qr_set_function($m, $f, $size - 1 - $i, 8, $bit($i));
    for ($i = 8; $i < 15; $i++) qr_set_function($m, $f, 8, $size - 15 + $i, $bit($i));
    qr_set_function($m, $f, 8, $size - 8, true); // dark module
}

function qr_matrix(string $text): array
{
    $bytes = array_values(unpack('C*', $text) ?: []);
    $spec = qr_version_spec(count($bytes));
    $version = (int)$spec['version'];
    $size = 17 + 4 * $version;
    $m = array_fill(0, $size, array_fill(0, $size, false));
    $f = array_fill(0, $size, array_fill(0, $size, false));

    qr_draw_finder($m, $f, 3, 3);
    qr_draw_finder($m, $f, $size - 4, 3);
    qr_draw_finder($m, $f, 3, $size - 4);

    foreach ($spec['centers'] as $cy) {
        foreach ($spec['centers'] as $cx) qr_draw_alignment($m, $f, $cx, $cy);
    }

    for ($i = 0; $i < $size; $i++) {
        if (!$f[6][$i]) qr_set_function($m, $f, $i, 6, ($i % 2) === 0);
        if (!$f[$i][6]) qr_set_function($m, $f, 6, $i, ($i % 2) === 0);
    }

    qr_draw_format($m, $f, 0); // também reserva os módulos de formato

    $codewords = qr_make_codewords($text, $spec);
    $bits = [];
    foreach ($codewords as $cw) qr_append_bits($bits, (int)$cw, 8);
    $bitIndex = 0;
    $upward = true;
    for ($right = $size - 1; $right >= 1; $right -= 2) {
        if ($right === 6) $right--;
        for ($vert = 0; $vert < $size; $vert++) {
            $y = $upward ? $size - 1 - $vert : $vert;
            for ($j = 0; $j < 2; $j++) {
                $x = $right - $j;
                if ($f[$y][$x]) continue;
                $dark = ($bits[$bitIndex++] ?? 0) !== 0;
                if ((($x + $y) & 1) === 0) $dark = !$dark; // máscara 0
                $m[$y][$x] = $dark;
            }
        }
        $upward = !$upward;
    }

    // Formato deve ficar sem máscara de dados.
    qr_draw_format($m, $f, 0);
    return $m;
}

function qr_svg(string $text, int $scale = 8, int $border = 4): string
{
    $matrix = qr_matrix($text);
    $size = count($matrix);
    $view = $size + ($border * 2);
    $path = [];
    for ($y = 0; $y < $size; $y++) {
        $runStart = null;
        for ($x = 0; $x <= $size; $x++) {
            $dark = $x < $size && $matrix[$y][$x];
            if ($dark && $runStart === null) $runStart = $x;
            if (!$dark && $runStart !== null) {
                $width = $x - $runStart;
                $path[] = 'M' . ($runStart + $border) . ',' . ($y + $border) . 'h' . $width . 'v1h-' . $width . 'z';
                $runStart = null;
            }
        }
    }
    $pixels = $view * max(1, $scale);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="'.$pixels.'" height="'.$pixels.'" viewBox="0 0 '.$view.' '.$view.'" shape-rendering="crispEdges" role="img" aria-label="QR Code">'
        .'<rect width="100%" height="100%" fill="#fff"/>'
        .'<path d="'.implode('', $path).'" fill="#000"/>'
        .'</svg>';
}

function qr_data_url_local(string $text): string
{
    return 'data:image/svg+xml;base64,' . base64_encode(qr_svg($text));
}
