<?php
require __DIR__ . '/app/core.php';
$token=(string)($_GET['token']??'');
$entry=$token!==''?valid_upload_token($token):null;
$bundle=$entry?reservation_bundle((int)$entry['reservation_id']):null;
$hotel=htmlspecialchars((string)setting('hotel_name',cfg('hotel_name')),ENT_QUOTES,'UTF-8');
$logo=htmlspecialchars(branding_url('logo_filename') ?: app_url('assets/logo.php'),ENT_QUOTES,'UTF-8');
?><!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enviar documentos · <?= $hotel ?></title><link rel="stylesheet" href="<?= htmlspecialchars(app_url('assets/app.css')) ?>?v=3"></head><body>
<header class="topbar"><div class="brand"><img src="<?= $logo ?>" alt="<?= $hotel ?>"><div><strong>Envio de documentos</strong><small>Check-in seguro</small></div></div></header><main class="kiosk-main" style="max-width:760px">
<?php if(!$entry||!$bundle): ?><section class="panel"><div class="alert alert-danger"><strong>QR Code inválido ou expirado.</strong><br>Volte ao totem e gere um novo código.</div></section>
<?php else: ?><section class="panel"><div class="step-badge">Reserva <?= htmlspecialchars($bundle['reservation']['reservation_number']) ?></div><h1 class="step-title" style="font-size:2.2rem">Envie seus documentos</h1><p class="step-subtitle">Fotografe ou selecione PDF/JPG/PNG/WEBP. Limite de 15 MB por arquivo.</p><div id="docs" class="doc-list">
<?php foreach($bundle['documents'] as $doc): $guest='Reserva'; foreach($bundle['guests'] as $g){if((int)$g['id']===(int)$doc['guest_id']){$guest=$g['name'];break;}} ?><div class="list-row" data-doc="<?= (int)$doc['id'] ?>"><div><strong><?= $doc['type']==='identity'?'Documento de identidade':'Comprovante de pagamento' ?></strong><div style="color:var(--muted)"><?= htmlspecialchars($guest) ?></div></div><div style="min-width:220px;text-align:right"><?php if($doc['status']==='received'): ?><span class="status status-ok">Enviado</span><?php else: ?><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" data-file="<?= (int)$doc['id'] ?>"><button class="btn btn-primary" data-send="<?= (int)$doc['id'] ?>" style="margin-top:8px">Enviar arquivo</button><?php endif; ?></div></div><?php endforeach; ?>
</div><div id="uploadMessage" class="alert alert-info">Mantenha esta página aberta até todos os arquivos aparecerem como enviados.</div></section><?php endif; ?>
</main><script>window.TOTEM_BASE=<?= json_encode(app_base_path(),JSON_UNESCAPED_SLASHES) ?>;window.UPLOAD_TOKEN=<?= json_encode($token) ?>;</script><script src="<?= htmlspecialchars(app_url('assets/upload.js')) ?>?v=3"></script></body></html>
