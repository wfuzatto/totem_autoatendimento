<?php
declare(strict_types=1);

function command_path(string $name): ?string
{
    if (!function_exists('shell_exec')) return null;
    $isWindows = DIRECTORY_SEPARATOR === '\\';
    $lookup = $isWindows
        ? 'where ' . escapeshellarg($name) . ' 2>NUL'
        : 'command -v ' . escapeshellarg($name) . ' 2>/dev/null';
    $path = trim((string)@shell_exec($lookup));
    if ($path === '') return null;
    $first = preg_split('/\r?\n/', $path)[0] ?? '';
    return trim($first) !== '' ? trim($first) : null;
}

function cpf_valid(string $value): bool
{
    $cpf = preg_replace('/\D+/', '', $value) ?? '';
    if (strlen($cpf) !== 11 || preg_match('/^(\d)\1{10}$/', $cpf)) return false;
    for ($t = 9; $t < 11; $t++) {
        $sum = 0;
        for ($i = 0; $i < $t; $i++) $sum += ((int)$cpf[$i]) * (($t + 1) - $i);
        $digit = ($sum * 10) % 11;
        if ($digit === 10) $digit = 0;
        if ($digit !== (int)$cpf[$t]) return false;
    }
    return true;
}

function normalize_ocr_text(string $text): string
{
    $text = strtoupper($text);
    $ascii = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
    if ($ascii !== false) $text = $ascii;
    return preg_replace('/\s+/', ' ', $text) ?? $text;
}

function extract_valid_cpf_from_text(string $text): ?string
{
    preg_match_all('/(?<!\d)(\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2})(?!\d)/', $text, $matches);
    foreach ($matches[1] ?? [] as $candidate) {
        $digits = preg_replace('/\D+/', '', $candidate) ?? '';
        if (cpf_valid($digits)) return $digits;
    }
    return null;
}

function run_tesseract(string $image): string
{
    $tesseract = command_path('tesseract');
    if (!$tesseract || !function_exists('shell_exec')) throw new RuntimeException('OCR opcional não instalado.');
    $languages = 'por+eng';
    $cmd = escapeshellarg($tesseract) . ' ' . escapeshellarg($image) . ' stdout -l ' . escapeshellarg($languages) . ' --psm 6 2>' . (DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null');
    $text = (string)@shell_exec($cmd);
    if (trim($text) === '') {
        $cmd = escapeshellarg($tesseract) . ' ' . escapeshellarg($image) . ' stdout --psm 6 2>' . (DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null');
        $text = (string)@shell_exec($cmd);
    }
    return $text;
}

function ocr_identity_file(string $file, string $mime): string
{
    if ($mime !== 'application/pdf') return run_tesseract($file);

    $pdftoppm = command_path('pdftoppm');
    if (!$pdftoppm || !function_exists('shell_exec')) throw new RuntimeException('Poppler/pdftoppm não instalado para validar PDF.');
    $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'totem-ocr-' . bin2hex(random_bytes(8));
    if (!mkdir($tmp, 0700, true) && !is_dir($tmp)) throw new RuntimeException('Falha ao criar diretório temporário de OCR.');
    $prefix = $tmp . DIRECTORY_SEPARATOR . 'page';
    try {
        $null = DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null';
        $cmd = escapeshellarg($pdftoppm) . ' -f 1 -l 3 -r 220 -jpeg ' . escapeshellarg($file) . ' ' . escapeshellarg($prefix) . ' 2>' . $null;
        @shell_exec($cmd);
        $images = glob($prefix . '-*.jpg') ?: [];
        if (!$images) throw new RuntimeException('Não foi possível renderizar o PDF para validação.');
        $text = '';
        foreach (array_slice($images, 0, 3) as $image) $text .= "\n" . run_tesseract($image);
        return $text;
    } finally {
        foreach (glob($tmp . DIRECTORY_SEPARATOR . '*') ?: [] as $f) @unlink($f);
        @rmdir($tmp);
    }
}

function validate_identity_upload_file(string $file, string $mime): array
{
    // O núcleo XAMPP funciona sem OCR. Quando Tesseract/Poppler estão presentes,
    // a validação avançada é ativada automaticamente sem mudar o fluxo visual.
    if (!command_path('tesseract')) return ['ok'=>true, 'mode'=>'basic-no-ocr'];
    if ($mime === 'application/pdf' && !command_path('pdftoppm')) return ['ok'=>true, 'mode'=>'basic-no-pdf-ocr'];

    $text = normalize_ocr_text(ocr_identity_file($file, $mime));
    if (strlen(trim($text)) < 80) throw new InvalidArgumentException('Documento ilegível ou sem conteúdo suficiente para validação.');

    $identityMarkers = [
        'CARTEIRA NACIONAL DE HABILITACAO', 'CNH', 'PERMISSAO PARA DIRIGIR',
        'CARTEIRA DE IDENTIDADE NACIONAL', 'CARTEIRA DE IDENTIDADE', 'REGISTRO GERAL', 'CIN'
    ];
    $supportMarkers = ['CPF', 'NOME', 'DATA DE NASCIMENTO', 'FILIACAO', 'ORGAO EXPEDIDOR', 'REPUBLICA FEDERATIVA DO BRASIL'];
    $hasIdentity = false; $support = 0;
    foreach ($identityMarkers as $m) if (str_contains($text, $m)) { $hasIdentity = true; break; }
    foreach ($supportMarkers as $m) if (str_contains($text, $m)) $support++;
    $cpf = extract_valid_cpf_from_text($text);

    if (!$hasIdentity || $support < 1 || !$cpf) {
        throw new InvalidArgumentException('Arquivo não reconhecido como CNH, RG ou CIN válido. Envie um documento de identidade legível com CPF válido.');
    }
    return ['ok'=>true, 'mode'=>'ocr', 'document'=>'identity'];
}
