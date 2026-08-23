<?php
declare(strict_types=1);
require __DIR__ . '/app/core.php';

$action = (string)($_GET['action'] ?? $_POST['action'] ?? 'health');
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$data = request_data();

try {
    switch ($action) {
        case 'health':
            json_response(['ok'=>true,'service'=>'totem-autoatendimento-php','version'=>'3','time'=>date('c')]);

        case 'config':
            json_response([
                'hotel_name'=>setting('hotel_name',cfg('hotel_name')),
                'allow_item_contest'=>setting_bool('allow_item_contest',true),
                'require_govbr'=>setting_bool('require_govbr',true),
                'require_face_match'=>setting_bool('require_face_match',true),
                'require_wristband_return'=>setting_bool('require_wristband_return',true),
                'enable_accessibility_toolbar'=>setting_bool('enable_accessibility_toolbar',true),
                'inactivity_seconds'=>(int)setting('inactivity_seconds','120'),
                'govbr_hotel_url'=>setting('govbr_hotel_url','') ?: null,
                'logo_url'=>branding_url('logo_filename') ?: app_url('assets/logo.php'),
                'advertisement_url'=>branding_url('checkout_ad_filename'),
                'govbr_qr_url'=>branding_url('govbr_qr_filename'),
                'base_url'=>app_base_path(),
            ]);

        case 'admin_login':
            if ($method !== 'POST') json_response(['error'=>'Método não permitido.'],405);
            if (!admin_login((string)($data['password'] ?? ''))) json_response(['error'=>'Senha inválida.'],401);
            json_response(['ok'=>true]);

        case 'admin_logout':
            admin_logout(); json_response(['ok'=>true]);

        case 'admin_me':
            json_response(['authenticated'=>admin_ok()]);

        case 'settings_get':
            require_admin();
            $keys=['hotel_name','allow_item_contest','require_govbr','require_face_match','require_wristband_return','enable_accessibility_toolbar','api_provider','totvs_base_url','totvs_token','payment_provider','sitef_server','nfc_mode','printer_mode','webcam_mode','inactivity_seconds','public_qr_base_url','govbr_hotel_url'];
            $out=[];foreach($keys as $k){$v=setting($k,'');if($k==='totvs_token'&&$v!=='')$v='********';$out[$k]=$v;}
            $out['logo_url']=branding_url('logo_filename') ?: app_url('assets/logo.php');
            $out['advertisement_url']=branding_url('checkout_ad_filename');
            $out['govbr_qr_url']=branding_url('govbr_qr_filename');
            json_response($out);

        case 'settings_save':
            require_admin(); if($method!=='POST'&&$method!=='PUT')json_response(['error'=>'Método não permitido.'],405);
            save_settings($data); json_response(['ok'=>true]);

        case 'reservations_list':
            require_admin(); json_response(list_reservations(['search'=>$_GET['search']??'','status'=>$_GET['status']??'','source'=>$_GET['source']??'']));

        case 'reservation_detail':
            require_admin();$id=(int)($_GET['id']??0);$b=admin_reservation_bundle($id);if(!$b)json_response(['error'=>'Reserva não encontrada.'],404);json_response($b);

        case 'reservation_create':
            require_admin();if($method!=='POST')json_response(['error'=>'Método não permitido.'],405);json_response(create_manual_reservation($data),201);

        case 'reservation_update':
            require_admin();$id=(int)($data['id']??$_GET['id']??0);$b=update_reservation($id,$data);if(!$b)json_response(['error'=>'Reserva não encontrada.'],404);json_response($b);

        case 'reservation_reset':
            require_admin();$id=(int)($data['id']??$_GET['id']??0);$b=reset_reservation_for_totem($id);if(!$b)json_response(['error'=>'Reserva não encontrada.'],404);json_response($b);

        case 'reservation_delete':
            require_admin();$id=(int)($data['id']??$_GET['id']??0);json_response(['ok'=>delete_manual_reservation($id)]);

        case 'lookup':
            $type=(string)($data['type']??'auto');if(!in_array($type,['auto','reservation','cpf','qr'],true))$type='auto';
            $b=find_reservation((string)($data['query']??''),$type==='qr'?'reservation':$type);if(!$b)json_response(['error'=>'Reserva não encontrada.'],404);audit('reservation.lookup',(int)$b['reservation']['id'],['query_type'=>$type]);json_response($b);

        case 'reservation_bundle':
            $b=reservation_bundle((int)($_GET['id']??0));if(!$b)json_response(['error'=>'Reserva não encontrada.'],404);json_response($b);

        case 'upload_token':
            $id=(int)($data['id']??$_GET['id']??0);json_response(create_upload_token($id));

        case 'upload_context':
            $entry=valid_upload_token((string)($_GET['token']??''));if(!$entry)json_response(['error'=>'QR Code expirado.'],410);$b=reservation_bundle((int)$entry['reservation_id']);json_response($b ?: ['error'=>'Reserva não encontrada.']);

        case 'document_upload':
            if($method!=='POST')json_response(['error'=>'Método não permitido.'],405);$token=(string)($_POST['token']??'');$docId=(int)($_POST['document_id']??0);if(empty($_FILES['file']))json_response(['error'=>'Selecione um arquivo.'],400);json_response(document_upload($token,$docId,$_FILES['file']));

        case 'document_remove':
            $id=(int)($data['reservation_id']??0);$doc=(int)($data['document_id']??0);json_response(remove_document($id,$doc));

        case 'face_verify':
            $id=(int)($data['reservation_id']??0);$guest=(int)($data['guest_id']??0);json_response(verify_face($id,$guest));

        case 'govbr_verify':
            $id=(int)($data['reservation_id']??0);json_response(verify_govbr($id));

        case 'wristband_encode':
            $id=(int)($data['reservation_id']??0);$guest=(int)($data['guest_id']??0);$code=clean_text($data['code']??'',100)?:null;json_response(encode_wristband($id,$guest,$code));

        case 'payment':
            $id=(int)($data['reservation_id']??0);$methodName=(string)($data['method']??'pix');if(!in_array($methodName,['pix','debit','credit'],true))json_response(['error'=>'Forma de pagamento inválida.'],400);json_response(register_payment($id,$methodName));

        case 'checkin_finalize':
            json_response(finalize_checkin((int)($data['reservation_id']??0)));

        case 'statement':
            json_response(statement((int)($_GET['id']??0)));

        case 'contest_item':
            if(!setting_bool('allow_item_contest',true))json_response(['error'=>'Contestação desativada.'],403);$rid=(int)($data['reservation_id']??0);$item=(int)($data['item_id']??0);$s=db()->prepare('UPDATE folio_items SET contested=1 WHERE id=? AND reservation_id=?');$s->execute([$item,$rid]);if(!$s->rowCount())json_response(['error'=>'Item não encontrado.'],404);audit('folio.item.contested',$rid,['item_id'=>$item]);json_response(statement($rid));

        case 'wristband_returns':
            json_response(wristband_return_status((int)($_GET['id']??0)));

        case 'wristband_return':
            json_response(return_wristband((int)($data['reservation_id']??0),clean_text($data['code']??'',100)));

        case 'checkout_finalize':
            json_response(finalize_checkout((int)($data['reservation_id']??0)));

        case 'exit_validate':
            json_response(['ok'=>true,'authorization'=>validate_exit_token((string)($_GET['token']??''),false)]);

        case 'exit_consume':
            json_response(['ok'=>true,'authorization'=>validate_exit_token((string)($data['token']??''),true)]);

        case 'branding_upload':
            require_admin();$key=(string)($_POST['key']??'');$map=[
                'logo_filename'=>['field'=>'file','allowed'=>['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'],'max'=>5*1024*1024],
                'checkout_ad_filename'=>['field'=>'file','allowed'=>['image/png'=>'png','image/jpeg'=>'jpg','image/webp'=>'webp'],'max'=>20*1024*1024],
                'govbr_qr_filename'=>['field'=>'file','allowed'=>['image/png'=>'png','image/jpeg'=>'jpg','image/webp'=>'webp'],'max'=>8*1024*1024],
            ];if(!isset($map[$key])||empty($_FILES[$map[$key]['field']]))json_response(['error'=>'Upload inválido.'],400);$url=save_branding($key,$_FILES[$map[$key]['field']],$map[$key]['allowed'],$map[$key]['max']);json_response(['ok'=>true,'url'=>$url]);

        case 'branding_remove':
            require_admin();$key=(string)($data['key']??'');if(!in_array($key,['logo_filename','checkout_ad_filename','govbr_qr_filename'],true))json_response(['error'=>'Chave inválida.'],400);$file=branding_file($key);if($file)@unlink($file);db()->prepare('UPDATE settings SET value=\'\',updated_at=CURRENT_TIMESTAMP WHERE key=?')->execute([$key]);json_response(['ok'=>true]);

        case 'branding_media':
            $key=(string)($_GET['key']??'');if(!in_array($key,['logo_filename','checkout_ad_filename','govbr_qr_filename'],true)){http_response_code(404);exit;}$file=branding_file($key);if(!$file){http_response_code(404);exit;}$mime=(new finfo(FILEINFO_MIME_TYPE))->file($file)?:'application/octet-stream';header('Content-Type: '.$mime);header('Cache-Control: no-store');readfile($file);exit;

        case 'qr_image':
            $text=(string)($_GET['text']??'');$dataUrl=qr_data_url($text);if(!$dataUrl)json_response(['error'=>'qrencode não está instalado no servidor.','text'=>$text],503);[$head,$body]=explode(',',$dataUrl,2);header('Content-Type: image/png');header('Cache-Control: no-store');echo base64_decode($body);exit;

        case 'totvs_sync':
            require_admin();json_response(['error'=>'Adapter TOTVS preservado para a próxima etapa. Informe Swagger/endpoints e credenciais reais para ativar sincronização.'],501);

        default:
            json_response(['error'=>'Ação de API não encontrada.'],404);
    }
} catch (InvalidArgumentException $e) {
    json_response(['error'=>$e->getMessage()],400);
} catch (Throwable $e) {
    error_log('[TOTEM PHP] '.$e->getMessage().' '.$e->getTraceAsString());
    json_response(['error'=>$e->getMessage()],500);
}
