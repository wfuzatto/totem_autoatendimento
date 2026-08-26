<?php
declare(strict_types=1);

$required = [
    'PHP >= 8.1' => version_compare(PHP_VERSION, '8.1.0', '>='),
    'PDO' => extension_loaded('pdo'),
    'PDO SQLite' => extension_loaded('pdo_sqlite'),
    'Fileinfo' => extension_loaded('fileinfo'),
    'OpenSSL' => extension_loaded('openssl'),
    'mbstring' => extension_loaded('mbstring'),
    'JSON' => extension_loaded('json'),
];
$ready = !in_array(false, $required, true);
$error = '';
$success = isset($_GET['ok']);
$installed = false;
$current = [];

if ($ready) {
    try {
        require __DIR__ . '/app/core.php';
        $installed = setting_bool('installation_complete', false);
        $current = [
            'hotel_name' => (string)setting('hotel_name', cfg('hotel_name')),
            'public_qr_base_url' => (string)setting('public_qr_base_url', ''),
        ];

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $data = $_POST;
            if ($installed) {
                $currentPassword = (string)($data['current_password'] ?? '');
                $hash = (string)setting('admin_password_hash', '');
                if ($currentPassword === '' || !$hash || !password_verify($currentPassword, $hash)) {
                    throw new RuntimeException('Informe a senha administrativa atual para alterar uma instalação existente.');
                }
            }

            $hotel = trim((string)($data['hotel_name'] ?? ''));
            if ($hotel === '') throw new RuntimeException('Informe o nome do hotel.');
            $publicBase = rtrim(trim((string)($data['public_qr_base_url'] ?? '')), '/');
            if ($publicBase !== '' && !preg_match('#^https?://#i', $publicBase)) {
                throw new RuntimeException('A URL pública precisa começar com http:// ou https://.');
            }
            $newPassword = (string)($data['new_password'] ?? '');
            if (!$installed && $newPassword === '') $newPassword = '251933';
            if ($newPassword !== '' && strlen($newPassword) < 4) throw new RuntimeException('A senha administrativa deve ter pelo menos 4 caracteres.');

            $pdo = db();
            $save = $pdo->prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP');
            $pdo->beginTransaction();
            try {
                $save->execute(['hotel_name', $hotel]);
                $save->execute(['public_qr_base_url', $publicBase]);
                if ($newPassword !== '') $save->execute(['admin_password_hash', password_hash($newPassword, PASSWORD_DEFAULT)]);
                $save->execute(['installation_complete', '1']);
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }
            header('Location: install.php?ok=1');
            exit;
        }
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}

$https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
$scheme = $https ? 'https' : 'http';
$host = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
$scriptDir = str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/')));
$detectedBase = $scheme . '://' . $host . ($scriptDir === '/' || $scriptDir === '.' ? '' : rtrim($scriptDir, '/'));
?><!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instalar Totem no XAMPP</title>
<style>
:root{--g:#006b3c;--b:#dce9d8;--m:#68776e}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f3f7ef;color:#183128}.wrap{max-width:920px;margin:32px auto;padding:18px}.card{background:#fff;border:1px solid var(--b);border-radius:22px;padding:26px;box-shadow:0 18px 55px rgba(0,75,42,.08)}h1{color:var(--g);margin-top:0}.lead{color:var(--m)}.checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:20px 0}.check{padding:11px;border-radius:10px;background:#f7faf8}.ok{color:#08713f}.bad{color:#9d2430}.alert{padding:13px 15px;border-radius:11px;margin:14px 0}.success{background:#e8f7ed;color:#08713f}.danger{background:#fdebed;color:#9d2430}.info{background:#edf6ff;color:#235576}label{display:block;font-weight:700;margin:14px 0 6px}input{width:100%;min-height:50px;border:1px solid #cfded4;border-radius:12px;padding:11px 13px;font:inherit}.help{font-size:.88rem;color:var(--m);margin-top:5px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.btn{border:0;border-radius:12px;padding:12px 18px;font-weight:750;text-decoration:none;cursor:pointer}.primary{background:var(--g);color:#fff}.secondary{background:#edf3ef;color:#30473a}@media(max-width:700px){.checks{grid-template-columns:1fr}}
</style></head><body><main class="wrap"><section class="card">
<h1>Instalação XAMPP</h1>
<p class="lead">Esta versão roda diretamente no Apache/PHP do XAMPP. O visual e os campos do totem não são alterados pelo instalador.</p>
<div class="checks"><?php foreach($required as $name=>$ok): ?><div class="check <?= $ok?'ok':'bad' ?>"><strong><?= $ok?'✓':'✕' ?> <?= htmlspecialchars($name) ?></strong></div><?php endforeach; ?></div>
<?php if(!$ready): ?><div class="alert danger">Ative as extensões obrigatórias no <strong>php.ini</strong> do XAMPP e reinicie o Apache.</div><?php endif; ?>
<?php if($error): ?><div class="alert danger"><?= htmlspecialchars($error) ?></div><?php endif; ?>
<?php if($success): ?><div class="alert success">Configuração salva. O totem está pronto para uso.</div><?php endif; ?>
<?php if($ready): ?>
<div class="alert info">Base detectada: <strong><?= htmlspecialchars($detectedBase) ?></strong>. Para QR enviado ao celular, configure abaixo um endereço que o celular consiga acessar.</div>
<form method="post" autocomplete="off">
<label for="hotel_name">Nome do hotel</label>
<input id="hotel_name" name="hotel_name" value="<?= htmlspecialchars($current['hotel_name'] ?? 'Hotel Fazenda Vale da Mantiqueira') ?>" required>
<label for="public_qr_base_url">URL pública do totem</label>
<input id="public_qr_base_url" name="public_qr_base_url" placeholder="https://totem.seudominio.com.br/totem" value="<?= htmlspecialchars($current['public_qr_base_url'] ?? '') ?>">
<div class="help">Pode ficar vazio em testes locais. Para câmera e upload pelo celular em outro dispositivo, prefira HTTPS.</div>
<?php if($installed): ?>
<label for="current_password">Senha administrativa atual</label>
<input id="current_password" name="current_password" type="password" inputmode="numeric" required>
<?php endif; ?>
<label for="new_password"><?= $installed ? 'Nova senha administrativa (opcional)' : 'Senha administrativa inicial' ?></label>
<input id="new_password" name="new_password" type="password" inputmode="numeric" placeholder="<?= $installed?'Deixe vazio para manter':'251933' ?>">
<div class="help">Na primeira instalação, se ficar vazia, será usada a senha 251933.</div>
<div class="actions"><button class="btn primary" type="submit"><?= $installed?'Salvar configuração':'Instalar e criar banco' ?></button><a class="btn secondary" href="diagnostico.php">Diagnóstico</a><a class="btn secondary" href="index.php">Abrir totem</a></div>
</form>
<?php endif; ?>
</section></main></body></html>
