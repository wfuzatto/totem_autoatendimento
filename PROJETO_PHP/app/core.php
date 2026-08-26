<?php
declare(strict_types=1);
require_once __DIR__ . '/qrcode.php';

function cfg(?string $key = null): mixed
{
    static $config = null;
    if ($config === null) {
        $config = require dirname(__DIR__) . '/config/config.php';
        date_default_timezone_set($config['timezone']);
    }
    return $key === null ? $config : ($config[$key] ?? null);
}

function ensure_app_dirs(): void
{
    foreach (['data_dir', 'upload_dir', 'branding_dir'] as $key) {
        $dir = (string) cfg($key);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException("Não foi possível criar {$dir}");
        }
    }
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    ensure_app_dirs();
    $pdo = new PDO('sqlite:' . cfg('database_file'));
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA busy_timeout=5000');

    $schema = file_get_contents((string) cfg('schema_file'));
    if ($schema === false) throw new RuntimeException('Schema SQLite não encontrado.');
    $pdo->exec($schema);
    seed_defaults($pdo);
    seed_demo($pdo);
    return $pdo;
}

function seed_defaults(PDO $pdo): void
{
    $defaults = [
        'hotel_name' => cfg('hotel_name'),
        'admin_password_hash' => password_hash((string) cfg('admin_password'), PASSWORD_DEFAULT),
        'theme_skin' => 'vale_mantiqueira',
        'allow_item_contest' => '1',
        'require_govbr' => '1',
        'require_face_match' => '1',
        'require_wristband_return' => '1',
        'enable_accessibility_toolbar' => '1',
        'onscreen_keyboard_enabled' => '1',
        'qr_camera_device_id' => '',
        'api_provider' => 'mock',
        'totvs_base_url' => '',
        'totvs_token' => '',
        'payment_provider' => 'mock',
        'sitef_server' => '',
        'nfc_mode' => 'mock',
        'printer_mode' => 'mock',
        'webcam_mode' => 'browser',
        'inactivity_seconds' => '120',
        'public_qr_base_url' => (string) cfg('public_qr_base_url'),
        'logo_filename' => '',
        'checkout_ad_filename' => '',
        'govbr_qr_filename' => '',
        'govbr_hotel_url' => '',
    ];
    $stmt = $pdo->prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
    foreach ($defaults as $key => $value) $stmt->execute([$key, (string) $value]);
}

function seed_demo(PDO $pdo): void
{
    if ((int) $pdo->query('SELECT COUNT(*) FROM reservations')->fetchColumn() > 0) return;

    $pdo->beginTransaction();
    try {
        $r = $pdo->prepare('INSERT INTO reservations(reservation_number,room_number,responsible_name,responsible_cpf,checkin_date,checkout_date,status,adults,children,balance_cents,payment_pending) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
        $g = $pdo->prepare('INSERT INTO guests(reservation_id,name,document,adult,wristband_code,face_verified) VALUES(?,?,?,?,?,?)');
        $d = $pdo->prepare("INSERT INTO documents(reservation_id,guest_id,type,filename,status,uploaded_at) VALUES(?,?,?,?,?,?)");
        $f = $pdo->prepare('INSERT INTO folio_items(reservation_id,guest_id,description,amount_cents,occurred_at) VALUES(?,?,?,?,?)');
        $m = $pdo->prepare('INSERT INTO reservation_admin_meta(reservation_id,source,initial_balance_cents,initial_payment_pending,initial_room_number) VALUES(?,?,?,?,?)');
        $s = $pdo->prepare('INSERT INTO process_state(reservation_id,govbr_verified) VALUES(?,0)');

        $r->execute(['RES-10025','204','Carlos Henrique Souza','12345678909','2026-08-20','2026-08-23','checked_in',2,1,42870,1]);
        $checkoutId = (int) $pdo->lastInsertId();
        $g->execute([$checkoutId,'Carlos Henrique Souza','RG 12.345.678-9',1,'SAGA-204-CARLOS',1]); $g1=(int)$pdo->lastInsertId();
        $g->execute([$checkoutId,'Mariana Souza','RG 45.678.901-2',1,'SAGA-204-MARIANA',1]); $g2=(int)$pdo->lastInsertId();
        $g->execute([$checkoutId,'Pedro Souza',null,0,null,0]); $g3=(int)$pdo->lastInsertId();
        $d->execute([$checkoutId,$g1,'identity','carlos-rg.pdf','received','2026-08-20 10:00:00']);
        $d->execute([$checkoutId,$g2,'identity','mariana-rg.pdf','received','2026-08-20 10:01:00']);
        $f->execute([$checkoutId,$g1,'Restaurante - Jantar',14990,'2026-08-21 20:35:00']);
        $f->execute([$checkoutId,$g1,'Frigobar - Água mineral',1200,'2026-08-22 09:12:00']);
        $f->execute([$checkoutId,$g2,'Spa - Massagem',22000,'2026-08-22 15:00:00']);
        $f->execute([$checkoutId,$g2,'Frigobar - Refrigerante',1680,'2026-08-22 19:44:00']);
        $f->execute([$checkoutId,$g3,'Loja - Souvenir',3000,'2026-08-22 17:10:00']);
        $m->execute([$checkoutId,'demo',42870,1,'204']);
        $s->execute([$checkoutId]);

        $r->execute(['RES-20080',null,'Fernanda Almeida','98765432100','2026-08-23','2026-08-26','reserved',2,0,85000,1]);
        $checkinId = (int) $pdo->lastInsertId();
        $g->execute([$checkinId,'Fernanda Almeida','CPF 987.654.321-00',1,null,0]); $c1=(int)$pdo->lastInsertId();
        $g->execute([$checkinId,'Rafael Almeida','CPF 111.222.333-44',1,null,0]); $c2=(int)$pdo->lastInsertId();
        $d->execute([$checkinId,$c1,'identity','fernanda-identidade.pdf','received','2026-08-22 18:00:00']);
        $d->execute([$checkinId,$c2,'identity',null,'missing',null]);
        $d->execute([$checkinId,null,'payment_proof',null,'missing',null]);
        $m->execute([$checkinId,'demo',85000,1,null]);
        $s->execute([$checkinId]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function setting(string $key, mixed $fallback = null): mixed
{
    $stmt = db()->prepare('SELECT value FROM settings WHERE key=?');
    $stmt->execute([$key]);
    $value = $stmt->fetchColumn();
    return $value === false ? $fallback : $value;
}

function setting_bool(string $key, bool $fallback = false): bool
{
    $value = setting($key, $fallback ? '1' : '0');
    return in_array((string)$value, ['1','true','yes','on'], true);
}

function save_settings(array $values): void
{
    $allowed = [
        'hotel_name','allow_item_contest','require_govbr','require_face_match','require_wristband_return',
        'enable_accessibility_toolbar','api_provider','totvs_base_url','totvs_token','payment_provider','sitef_server',
        'nfc_mode','printer_mode','webcam_mode','inactivity_seconds','public_qr_base_url','govbr_hotel_url'
    ];
    $stmt = db()->prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP');
    foreach ($values as $key => $value) {
        if (!in_array($key, $allowed, true)) continue;
        if ($key === 'totvs_token' && $value === '********') continue;
        $stmt->execute([$key, (string)$value]);
    }
    audit('admin.settings.updated', null, ['keys'=>array_keys($values)]);
}

function audit(string $event, ?int $reservationId = null, array $metadata = []): void
{
    $stmt = db()->prepare('INSERT INTO audit_log(event,reservation_id,metadata) VALUES(?,?,?)');
    $stmt->execute([$event,$reservationId,json_encode($metadata, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)]);
}

function start_app_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name((string) cfg('session_name'));
    session_set_cookie_params([
        'lifetime'=>0,
        'path'=>'/',
        'secure'=>(!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly'=>true,
        'samesite'=>'Lax'
    ]);
    session_start();
}

function admin_login(string $password): bool
{
    start_app_session();
    $hash = (string) setting('admin_password_hash','');
    if (!$hash || !password_verify($password,$hash)) return false;
    session_regenerate_id(true);
    $_SESSION['admin_authenticated'] = true;
    $_SESSION['admin_last_seen'] = time();
    audit('admin.login');
    return true;
}

function admin_logout(): void
{
    start_app_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p=session_get_cookie_params();
        setcookie(session_name(),'',time()-42000,$p['path'],$p['domain']??'',(bool)$p['secure'],(bool)$p['httponly']);
    }
    session_destroy();
}

function admin_ok(): bool
{
    start_app_session();
    if (empty($_SESSION['admin_authenticated'])) return false;
    if ((int)($_SESSION['admin_last_seen'] ?? 0) < time()-1800) { admin_logout(); return false; }
    $_SESSION['admin_last_seen'] = time();
    return true;
}

function require_admin(): void
{
    if (!admin_ok()) json_response(['error'=>'Sessão administrativa inválida ou expirada.'],401);
}

function app_base_path(): string
{
    $script = str_replace('\\','/', (string)($_SERVER['SCRIPT_NAME'] ?? ''));
    $dir = rtrim(str_replace('\\','/', dirname($script)),'/');
    return $dir === '.' ? '' : $dir;
}

function app_url(string $path = ''): string
{
    $base = app_base_path();
    return $base . '/' . ltrim($path,'/');
}

function absolute_app_url(string $path = ''): string
{
    $configured = trim((string)setting('public_qr_base_url',''));
    if ($configured !== '') return rtrim($configured,'/') . '/' . ltrim($path,'/');
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $scheme = $https ? 'https' : 'http';
    $host = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
    return $scheme . '://' . $host . app_url($path);
}

function request_data(): array
{
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (str_contains($contentType,'application/json')) {
        $raw=file_get_contents('php://input');
        $data=json_decode($raw ?: '{}',true);
        return is_array($data)?$data:[];
    }
    return $_POST;
}

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    exit;
}

function clean_text(mixed $value, int $max = 500): string
{
    return mb_substr(trim((string)$value),0,$max);
}

function digits(mixed $value): string { return preg_replace('/\D+/','',(string)$value) ?? ''; }
function bool_value(mixed $value): bool { return in_array($value,[true,1,'1','true','on','yes'],true); }
function int_value(mixed $value, int $fallback=0): int { return is_numeric($value)?max(0,(int)round((float)$value)):$fallback; }

function reservation_bundle(int $id): ?array
{
    $stmt=db()->prepare('SELECT * FROM reservations WHERE id=?'); $stmt->execute([$id]); $r=$stmt->fetch();
    if (!$r) return null;
    $stmt=db()->prepare('SELECT * FROM guests WHERE reservation_id=? ORDER BY adult DESC,id'); $stmt->execute([$id]); $guests=$stmt->fetchAll();
    $stmt=db()->prepare('SELECT * FROM documents WHERE reservation_id=? ORDER BY guest_id,type,id'); $stmt->execute([$id]); $docs=$stmt->fetchAll();
    $stmt=db()->prepare('SELECT * FROM process_state WHERE reservation_id=?'); $stmt->execute([$id]); $state=$stmt->fetch() ?: ['govbr_verified'=>0];
    $r['adults']=(int)$r['adults']; $r['children']=(int)$r['children']; $r['balance_cents']=(int)$r['balance_cents']; $r['payment_pending']=(bool)$r['payment_pending'];
    foreach($guests as &$g){$g['adult']=(bool)$g['adult'];$g['face_verified']=(bool)$g['face_verified'];} unset($g);
    return ['reservation'=>$r,'guests'=>$guests,'documents'=>$docs,'state'=>['govbr_verified'=>(bool)$state['govbr_verified']]];
}

function find_reservation(string $query, string $type='auto'): ?array
{
    $raw=trim($query); if($raw==='') return null; $pdo=db(); $row=false;
    if($type==='reservation'){
        $s=$pdo->prepare('SELECT * FROM reservations WHERE reservation_number=? COLLATE NOCASE LIMIT 1');$s->execute([$raw]);$row=$s->fetch();
    } elseif($type==='cpf'){
        $d=digits($raw); if(strlen($d)!==11)return null;
        $s=$pdo->prepare("SELECT * FROM reservations WHERE REPLACE(REPLACE(REPLACE(responsible_cpf,'.',''),'-',''),' ','')=? LIMIT 1");$s->execute([$d]);$row=$s->fetch();
    } else {
        $s=$pdo->prepare('SELECT * FROM reservations WHERE reservation_number=? COLLATE NOCASE OR room_number=? COLLATE NOCASE LIMIT 1');$s->execute([$raw,$raw]);$row=$s->fetch();
        if(!$row){$d=digits($raw);if($d){$s=$pdo->prepare("SELECT * FROM reservations WHERE REPLACE(REPLACE(REPLACE(responsible_cpf,'.',''),'-',''),' ','')=? LIMIT 1");$s->execute([$d]);$row=$s->fetch();}}
        if(!$row){$s=$pdo->prepare('SELECT r.* FROM guests g JOIN reservations r ON r.id=g.reservation_id WHERE g.wristband_code=? COLLATE NOCASE LIMIT 1');$s->execute([$raw]);$row=$s->fetch();}
    }
    return $row?reservation_bundle((int)$row['id']):null;
}

function reservation_meta(int $id): array
{
    $s=db()->prepare('SELECT * FROM reservation_admin_meta WHERE reservation_id=?');$s->execute([$id]);
    return $s->fetch() ?: ['reservation_id'=>$id,'source'=>'integration','external_id'=>null,'responsible_email'=>null,'responsible_phone'=>null,'notes'=>null,'last_sync_at'=>null,'initial_balance_cents'=>0,'initial_payment_pending'=>0,'initial_room_number'=>null];
}

function admin_reservation_bundle(int $id): ?array
{
    $bundle=reservation_bundle($id); if(!$bundle)return null; $pdo=db();
    $s=$pdo->prepare('SELECT * FROM payments WHERE reservation_id=? ORDER BY id DESC');$s->execute([$id]);$payments=$s->fetchAll();
    $s=$pdo->prepare('SELECT f.*,g.name guest_name FROM folio_items f LEFT JOIN guests g ON g.id=f.guest_id WHERE f.reservation_id=? ORDER BY f.occurred_at DESC,f.id DESC');$s->execute([$id]);$folio=$s->fetchAll();
    $s=$pdo->prepare('SELECT * FROM wristband_returns WHERE reservation_id=? ORDER BY id DESC');$s->execute([$id]);$returns=$s->fetchAll();
    $s=$pdo->prepare('SELECT * FROM audit_log WHERE reservation_id=? ORDER BY id DESC LIMIT 100');$s->execute([$id]);$audits=$s->fetchAll();
    foreach($audits as &$a){$a['metadata']=json_decode((string)$a['metadata'],true)?:[];}unset($a);
    return $bundle+['meta'=>reservation_meta($id),'payments'=>$payments,'folio'=>$folio,'wristband_returns'=>$returns,'audit'=>$audits];
}

function list_reservations(array $filters=[]): array
{
    $where=[];$params=[];
    if(!empty($filters['status'])){$where[]='r.status=?';$params[]=$filters['status'];}
    if(!empty($filters['source'])){$where[]='COALESCE(m.source,\'integration\')=?';$params[]=$filters['source'];}
    if(!empty($filters['search'])){
        $q='%'.trim((string)$filters['search']).'%';
        $where[]='(r.reservation_number LIKE ? OR r.responsible_name LIKE ? OR r.responsible_cpf LIKE ? OR r.room_number LIKE ? OR m.external_id LIKE ?)';
        array_push($params,$q,$q,$q,$q,$q);
    }
    $sql="SELECT r.*,COALESCE(m.source,'integration') source,m.external_id,m.responsible_email,m.responsible_phone,m.last_sync_at,
      (SELECT COUNT(*) FROM documents d WHERE d.reservation_id=r.id) document_count,
      (SELECT COUNT(*) FROM documents d WHERE d.reservation_id=r.id AND d.status='received') documents_received,
      (SELECT COUNT(*) FROM guests g WHERE g.reservation_id=r.id AND g.adult=1 AND g.face_verified=1) faces_verified,
      (SELECT COUNT(*) FROM guests g WHERE g.reservation_id=r.id AND g.adult=1 AND COALESCE(g.wristband_code,'')!='') wristbands_encoded
      FROM reservations r LEFT JOIN reservation_admin_meta m ON m.reservation_id=r.id";
    if($where)$sql.=' WHERE '.implode(' AND ',$where);
    $sql.=' ORDER BY r.checkin_date DESC,r.id DESC LIMIT 500';
    $s=db()->prepare($sql);$s->execute($params);$rows=$s->fetchAll();
    $stats=['total'=>0,'reserved'=>0,'checked_in'=>0,'checked_out'=>0,'manual'=>0,'integration'=>0,'demo'=>0];
    foreach(db()->query("SELECT r.status,COALESCE(m.source,'integration') source FROM reservations r LEFT JOIN reservation_admin_meta m ON m.reservation_id=r.id") as $row){$stats['total']++;if(isset($stats[$row['status']]))$stats[$row['status']]++;if(isset($stats[$row['source']]))$stats[$row['source']]++;}
    return ['rows'=>$rows,'stats'=>$stats];
}

function create_manual_reservation(array $p): array
{
    $name=clean_text($p['responsible_name']??'',160); if($name==='')throw new InvalidArgumentException('Informe o nome do responsável.');
    $cpf=digits($p['responsible_cpf']??''); if($cpf!==''&&strlen($cpf)!==11)throw new InvalidArgumentException('CPF deve ter 11 dígitos.');
    $checkin=clean_text($p['checkin_date']??'',10);$checkout=clean_text($p['checkout_date']??'',10);
    if(!preg_match('/^\d{4}-\d{2}-\d{2}$/',$checkin)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$checkout)||$checkout<$checkin)throw new InvalidArgumentException('Período da reserva inválido.');
    $guests=is_array($p['guests']??null)?$p['guests']:[];$normalized=[];
    foreach($guests as $g){$gn=clean_text($g['name']??'',160);if($gn==='')continue;$normalized[]=['name'=>$gn,'document'=>clean_text($g['document']??'',100)?:null,'adult'=>!isset($g['adult'])||bool_value($g['adult'])];}
    if(!$normalized)$normalized[]=['name'=>$name,'document'=>$cpf?:null,'adult'=>true];
    $adults=count(array_filter($normalized,fn($g)=>$g['adult']));if($adults<1)throw new InvalidArgumentException('A reserva precisa ter pelo menos um adulto.');
    $children=count($normalized)-$adults;$balance=int_value($p['balance_cents']??0);$pending=bool_value($p['payment_pending']??false)&&$balance>0?1:0;
    $number=clean_text($p['reservation_number']??'',80);if($number==='')$number='MAN-'.date('Ymd').'-'.strtoupper(bin2hex(random_bytes(2)));
    if(!preg_match('/^[A-Za-z0-9][A-Za-z0-9._\/-]{2,80}$/',$number))throw new InvalidArgumentException('Número da reserva inválido.');
    $room=clean_text($p['room_number']??'',30)?:null;$pdo=db();
    $s=$pdo->prepare('SELECT 1 FROM reservations WHERE reservation_number=? COLLATE NOCASE');$s->execute([$number]);if($s->fetchColumn())throw new InvalidArgumentException('Já existe uma reserva com esse número.');
    $pdo->beginTransaction();try{
        $s=$pdo->prepare("INSERT INTO reservations(reservation_number,room_number,responsible_name,responsible_cpf,checkin_date,checkout_date,status,adults,children,balance_cents,payment_pending) VALUES(?,?,?,?,?,?,'reserved',?,?,?,?)");
        $s->execute([$number,$room,$name,$cpf?:null,$checkin,$checkout,$adults,$children,$balance,$pending]);$id=(int)$pdo->lastInsertId();
        $gq=$pdo->prepare('INSERT INTO guests(reservation_id,name,document,adult,wristband_code,face_verified) VALUES(?,?,?,?,NULL,0)');$dq=$pdo->prepare("INSERT INTO documents(reservation_id,guest_id,type,status) VALUES(?,?,?,'missing')");
        foreach($normalized as $g){$gq->execute([$id,$g['name'],$g['document'],$g['adult']?1:0]);$gid=(int)$pdo->lastInsertId();if($g['adult'])$dq->execute([$id,$gid,'identity']);}
        if(!array_key_exists('require_payment_proof',$p)||bool_value($p['require_payment_proof']))$dq->execute([$id,null,'payment_proof']);
        $pdo->prepare('INSERT INTO process_state(reservation_id,govbr_verified) VALUES(?,0)')->execute([$id]);
        $pdo->prepare('INSERT INTO reservation_admin_meta(reservation_id,source,responsible_email,responsible_phone,notes,initial_balance_cents,initial_payment_pending,initial_room_number) VALUES(?,?,?,?,?,?,?,?)')->execute([$id,'manual',clean_text($p['responsible_email']??'',180)?:null,clean_text($p['responsible_phone']??'',60)?:null,clean_text($p['notes']??'',2000)?:null,$balance,$pending,$room]);
        audit('reservation.manual.created',$id,['reservation_number'=>$number,'adults'=>$adults,'children'=>$children]);$pdo->commit();return admin_reservation_bundle($id);
    }catch(Throwable $e){$pdo->rollBack();throw $e;}
}

function update_reservation(int $id,array $p): ?array
{
    $current=reservation_bundle($id);if(!$current)return null;$r=$current['reservation'];$meta=reservation_meta($id);
    $name=clean_text($p['responsible_name']??$r['responsible_name'],160);$cpf=digits($p['responsible_cpf']??$r['responsible_cpf']);
    $checkin=clean_text($p['checkin_date']??$r['checkin_date'],10);$checkout=clean_text($p['checkout_date']??$r['checkout_date'],10);if($checkout<$checkin)throw new InvalidArgumentException('Check-out anterior ao check-in.');
    $status=clean_text($p['status']??$r['status'],30);if(!in_array($status,['reserved','checked_in','checked_out','cancelled'],true))throw new InvalidArgumentException('Status inválido.');
    $balance=array_key_exists('balance_cents',$p)?int_value($p['balance_cents']):(int)$r['balance_cents'];$pending=array_key_exists('payment_pending',$p)?(bool_value($p['payment_pending'])&&$balance>0?1:0):(int)$r['payment_pending'];
    db()->prepare('UPDATE reservations SET responsible_name=?,responsible_cpf=?,checkin_date=?,checkout_date=?,room_number=?,status=?,balance_cents=?,payment_pending=? WHERE id=?')->execute([$name,$cpf?:null,$checkin,$checkout,clean_text($p['room_number']??$r['room_number'],30)?:null,$status,$balance,$pending,$id]);
    db()->prepare('UPDATE reservation_admin_meta SET external_id=?,responsible_email=?,responsible_phone=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE reservation_id=?')->execute([clean_text($p['external_id']??$meta['external_id'],150)?:null,clean_text($p['responsible_email']??$meta['responsible_email'],180)?:null,clean_text($p['responsible_phone']??$meta['responsible_phone'],60)?:null,clean_text($p['notes']??$meta['notes'],2000)?:null,$id]);
    audit('reservation.admin.updated',$id);return admin_reservation_bundle($id);
}

function reset_reservation_for_totem(int $id): ?array
{
    $bundle=admin_reservation_bundle($id);if(!$bundle)return null;$m=$bundle['meta'];$pdo=db();$pdo->beginTransaction();try{
        $pdo->prepare("UPDATE reservations SET status='reserved',room_number=?,balance_cents=?,payment_pending=? WHERE id=?")->execute([$m['initial_room_number'],$m['initial_balance_cents'],$m['initial_payment_pending'],$id]);
        $pdo->prepare('UPDATE guests SET face_verified=0,wristband_code=NULL WHERE reservation_id=?')->execute([$id]);
        $pdo->prepare('UPDATE process_state SET govbr_verified=0,updated_at=CURRENT_TIMESTAMP WHERE reservation_id=?')->execute([$id]);
        $pdo->prepare('DELETE FROM payments WHERE reservation_id=?')->execute([$id]);$pdo->prepare('DELETE FROM wristband_returns WHERE reservation_id=?')->execute([$id]);$pdo->prepare('DELETE FROM exit_authorizations WHERE reservation_id=?')->execute([$id]);
        audit('reservation.reset_for_totem',$id);$pdo->commit();return admin_reservation_bundle($id);
    }catch(Throwable $e){$pdo->rollBack();throw $e;}
}

function delete_manual_reservation(int $id): bool
{
    $m=reservation_meta($id);if(($m['source']??'integration')!=='manual')throw new RuntimeException('Somente reservas manuais podem ser excluídas.');
    $s=db()->prepare('DELETE FROM reservations WHERE id=?');$s->execute([$id]);return $s->rowCount()>0;
}

function create_upload_token(int $reservationId): array
{
    if(!reservation_bundle($reservationId))throw new RuntimeException('Reserva não encontrada.');$token=bin2hex(random_bytes(16));$expires=date('c',time()+1800);
    db()->prepare('DELETE FROM upload_tokens WHERE reservation_id=?')->execute([$reservationId]);db()->prepare('INSERT INTO upload_tokens(token,reservation_id,expires_at) VALUES(?,?,?)')->execute([$token,$reservationId,$expires]);
    $url=absolute_app_url('upload.php?token='.rawurlencode($token));return ['token'=>$token,'expires_at'=>$expires,'url'=>$url,'qr_data_url'=>qr_data_url($url)];
}

function valid_upload_token(string $token): ?array
{
    $s=db()->prepare('SELECT * FROM upload_tokens WHERE token=?');$s->execute([$token]);$row=$s->fetch();if(!$row||strtotime($row['expires_at'])<=time())return null;return $row;
}

function qr_data_url(string $text): ?string
{
    try { return qr_data_url_local($text); }
    catch (Throwable $e) { error_log('[TOTEM QR] '.$e->getMessage()); return null; }
}

function document_upload(string $token,int $documentId,array $file): array
{
    $entry=valid_upload_token($token);if(!$entry)throw new RuntimeException('QR Code expirado. Gere um novo no totem.');
    if(($file['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK)throw new RuntimeException('Falha no envio do arquivo.');if((int)$file['size']>(int)cfg('max_upload_bytes'))throw new RuntimeException('Arquivo excede 15 MB.');
    $finfo=new finfo(FILEINFO_MIME_TYPE);$mime=$finfo->file($file['tmp_name']);$allowed=['application/pdf'=>'pdf','image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'];if(!isset($allowed[$mime]))throw new RuntimeException('Use PDF, JPG, PNG ou WEBP.');
    $s=db()->prepare('SELECT * FROM documents WHERE id=? AND reservation_id=?');$s->execute([$documentId,$entry['reservation_id']]);$doc=$s->fetch();if(!$doc)throw new RuntimeException('Documento não encontrado.');
    $filename=date('YmdHis').'-'.bin2hex(random_bytes(5)).'.'.$allowed[$mime];$dest=rtrim((string)cfg('upload_dir'),'/').'/'.$filename;if(!move_uploaded_file($file['tmp_name'],$dest))throw new RuntimeException('Não foi possível salvar o arquivo.');
    if(!empty($doc['filename']))@unlink(rtrim((string)cfg('upload_dir'),'/').'/'.basename($doc['filename']));
    db()->prepare("UPDATE documents SET filename=?,status='received',uploaded_at=CURRENT_TIMESTAMP WHERE id=?")->execute([$filename,$documentId]);audit('document.received',(int)$entry['reservation_id'],['document_id'=>$documentId,'mime'=>$mime]);
    return reservation_bundle((int)$entry['reservation_id']);
}

function remove_document(int $reservationId,int $documentId): array
{
    $s=db()->prepare('SELECT * FROM documents WHERE id=? AND reservation_id=?');$s->execute([$documentId,$reservationId]);$doc=$s->fetch();if(!$doc)throw new RuntimeException('Documento não encontrado.');if($doc['filename'])@unlink(rtrim((string)cfg('upload_dir'),'/').'/'.basename($doc['filename']));
    db()->prepare("UPDATE documents SET filename=NULL,status='missing',uploaded_at=NULL WHERE id=?")->execute([$documentId]);audit('document.removed',$reservationId,['document_id'=>$documentId]);return reservation_bundle($reservationId);
}

function verify_face(int $reservationId,int $guestId): array
{
    $s=db()->prepare('UPDATE guests SET face_verified=1 WHERE id=? AND reservation_id=? AND adult=1');$s->execute([$guestId,$reservationId]);if(!$s->rowCount())throw new RuntimeException('Hóspede adulto não encontrado.');audit('face.verified',$reservationId,['guest_id'=>$guestId,'mode'=>'php-mock']);return reservation_bundle($reservationId);
}

function verify_govbr(int $reservationId): array
{
    db()->prepare('INSERT INTO process_state(reservation_id,govbr_verified,updated_at) VALUES(?,1,CURRENT_TIMESTAMP) ON CONFLICT(reservation_id) DO UPDATE SET govbr_verified=1,updated_at=CURRENT_TIMESTAMP')->execute([$reservationId]);audit('govbr.verified',$reservationId,['mode'=>'php-mock']);return reservation_bundle($reservationId);
}

function encode_wristband(int $reservationId,int $guestId,?string $code=null): array
{
    $code=$code?:'VM-'.str_pad((string)$reservationId,5,'0',STR_PAD_LEFT).'-'.strtoupper(bin2hex(random_bytes(3)));$s=db()->prepare('UPDATE guests SET wristband_code=? WHERE id=? AND reservation_id=? AND adult=1');$s->execute([$code,$guestId,$reservationId]);if(!$s->rowCount())throw new RuntimeException('Hóspede adulto não encontrado.');audit('wristband.encoded',$reservationId,['guest_id'=>$guestId,'mode'=>setting('nfc_mode','mock')]);return ['ok'=>true,'code'=>$code,'bundle'=>reservation_bundle($reservationId)];
}

function register_payment(int $reservationId,string $method): array
{
    $b=reservation_bundle($reservationId);if(!$b)throw new RuntimeException('Reserva não encontrada.');$amount=(int)$b['reservation']['balance_cents'];
    if($amount>0){$ref='PHP-'.strtoupper(bin2hex(random_bytes(4)));db()->prepare("INSERT INTO payments(reservation_id,method,amount_cents,status,external_reference) VALUES(?,?,?,'approved',?)")->execute([$reservationId,$method,$amount,$ref]);db()->prepare('UPDATE reservations SET balance_cents=0,payment_pending=0 WHERE id=?')->execute([$reservationId]);audit('payment.approved',$reservationId,['method'=>$method,'amount_cents'=>$amount,'mode'=>setting('payment_provider','mock')]);}
    return reservation_bundle($reservationId);
}

function docs_complete(int $id): bool { $s=db()->prepare("SELECT COUNT(*) FROM documents WHERE reservation_id=? AND status!='received'");$s->execute([$id]);return (int)$s->fetchColumn()===0; }
function adult_checks_complete(int $id,string $column): bool { $allowed=['face_verified','wristband_code'];if(!in_array($column,$allowed,true))return false;$expr=$column==='face_verified'?"$column=1":"COALESCE($column,'')!=''";$s=db()->prepare("SELECT COUNT(*) total,SUM(CASE WHEN $expr THEN 1 ELSE 0 END) done FROM guests WHERE reservation_id=? AND adult=1");$s->execute([$id]);$r=$s->fetch();return (int)$r['total']>0&&(int)$r['total']===(int)$r['done']; }

function finalize_checkin(int $id): array
{
    $b=reservation_bundle($id);if(!$b)throw new RuntimeException('Reserva não encontrada.');if(!docs_complete($id))throw new RuntimeException('Existem documentos pendentes.');if(setting_bool('require_face_match',true)&&!adult_checks_complete($id,'face_verified'))throw new RuntimeException('Reconhecimento facial pendente.');if(setting_bool('require_govbr',true)&&empty($b['state']['govbr_verified']))throw new RuntimeException('Validação gov.br pendente.');if(!adult_checks_complete($id,'wristband_code'))throw new RuntimeException('Existem pulseiras pendentes.');if($b['reservation']['payment_pending'])throw new RuntimeException('Pagamento pendente.');
    $room=$b['reservation']['room_number']?:'A DEFINIR';db()->prepare("UPDATE reservations SET status='checked_in',room_number=? WHERE id=?")->execute([$room,$id]);audit('checkin.completed',$id,['room'=>$room]);return ['ok'=>true,'room_number'=>$room,'bundle'=>reservation_bundle($id),'advertisement_url'=>branding_url('checkout_ad_filename')];
}

function statement(int $id): array
{
    $b=reservation_bundle($id);if(!$b)throw new RuntimeException('Reserva não encontrada.');$s=db()->prepare('SELECT f.*,g.name guest_name FROM folio_items f LEFT JOIN guests g ON g.id=f.guest_id WHERE f.reservation_id=? ORDER BY f.occurred_at,f.id');$s->execute([$id]);$items=$s->fetchAll();$groups=[];$total=0;
    foreach($b['guests'] as $g){$gi=array_values(array_filter($items,fn($i)=>(int)$i['guest_id']===(int)$g['id']));$subtotal=array_sum(array_map(fn($i)=>(int)$i['amount_cents'],$gi));$groups[]=['guest'=>$g,'items'=>$gi,'subtotal_cents'=>$subtotal];$total+=$subtotal;}
    $un=array_values(array_filter($items,fn($i)=>empty($i['guest_id'])));if($un){$subtotal=array_sum(array_map(fn($i)=>(int)$i['amount_cents'],$un));$groups[]=['guest'=>['id'=>null,'name'=>'Conta da reserva'],'items'=>$un,'subtotal_cents'=>$subtotal];$total+=$subtotal;}
    return $b+['groups'=>$groups,'total_cents'=>$total,'allow_item_contest'=>setting_bool('allow_item_contest',true)];
}

function return_wristband(int $id,string $code): array
{
    $s=db()->prepare('SELECT * FROM guests WHERE reservation_id=? AND wristband_code=? AND adult=1');$s->execute([$id,$code]);if(!$s->fetch())throw new RuntimeException('Pulseira não pertence a esta reserva.');db()->prepare('INSERT OR IGNORE INTO wristband_returns(reservation_id,code) VALUES(?,?)')->execute([$id,$code]);audit('wristband.returned',$id,['code'=>$code]);return wristband_return_status($id);
}
function wristband_return_status(int $id): array { $s=db()->prepare('SELECT adults FROM reservations WHERE id=?');$s->execute([$id]);$expected=(int)$s->fetchColumn();$s=db()->prepare('SELECT code,returned_at FROM wristband_returns WHERE reservation_id=? ORDER BY id');$s->execute([$id]);$rows=$s->fetchAll();return ['expected'=>$expected,'returned_count'=>count($rows),'returned'=>$rows,'complete'=>count($rows)>=$expected]; }

function sign_exit_token(string $tokenId,int $expires): string { return substr(hash_hmac('sha256',$tokenId.'.'.$expires,(string)cfg('exit_token_secret')),0,32); }
function create_exit_authorization(int $reservationId): array
{
    $tokenId=bin2hex(random_bytes(12));$expires=time()+8*3600;$sig=sign_exit_token($tokenId,$expires);$token=$tokenId.'.'.$expires.'.'.$sig;$receipt='SAI-'.date('Ymd').'-'.str_pad((string)$reservationId,6,'0',STR_PAD_LEFT).'-'.strtoupper(substr(bin2hex(random_bytes(3)),0,6));
    db()->prepare('INSERT INTO exit_authorizations(token_id,reservation_id,receipt_number,expires_at) VALUES(?,?,?,?)')->execute([$tokenId,$reservationId,$receipt,date('c',$expires)]);$url=absolute_app_url('portaria.php?token='.rawurlencode($token));return ['token'=>$token,'receipt_number'=>$receipt,'expires_at'=>date('c',$expires),'url'=>$url,'qr_data_url'=>qr_data_url($url)];
}

function validate_exit_token(string $token,bool $consume=false): array
{
    $parts=explode('.',$token);if(count($parts)!==3)throw new RuntimeException('Autorização inválida.');[$id,$expires,$sig]=$parts;if(!ctype_digit($expires)||!hash_equals(sign_exit_token($id,(int)$expires),$sig))throw new RuntimeException('Assinatura inválida.');if((int)$expires<time())throw new RuntimeException('Autorização expirada.');$s=db()->prepare('SELECT e.*,r.reservation_number,r.room_number,r.responsible_name FROM exit_authorizations e JOIN reservations r ON r.id=e.reservation_id WHERE e.token_id=?');$s->execute([$id]);$row=$s->fetch();if(!$row)throw new RuntimeException('Autorização não encontrada.');if($row['consumed_at'])throw new RuntimeException('Autorização já utilizada.');if($consume){db()->prepare('UPDATE exit_authorizations SET consumed_at=CURRENT_TIMESTAMP WHERE id=?')->execute([$row['id']]);$row['consumed_at']=date('Y-m-d H:i:s');audit('exit.authorization.consumed',(int)$row['reservation_id']);}return $row;
}

function finalize_checkout(int $id): array
{
    $b=reservation_bundle($id);if(!$b)throw new RuntimeException('Reserva não encontrada.');if(setting_bool('require_wristband_return',true)&&!wristband_return_status($id)['complete'])throw new RuntimeException('Devolução das pulseiras pendente.');if($b['reservation']['payment_pending']||(int)$b['reservation']['balance_cents']>0)throw new RuntimeException('Pagamento pendente.');db()->prepare("UPDATE reservations SET status='checked_out' WHERE id=?")->execute([$id]);$auth=create_exit_authorization($id);audit('checkout.completed',$id,['receipt'=>$auth['receipt_number']]);print_exit_receipt($id,$auth);return ['ok'=>true,'authorization'=>$auth,'advertisement_url'=>branding_url('checkout_ad_filename')];
}

function print_exit_receipt(int $id,array $auth): void
{
    if(setting('printer_mode','mock')!=='escpos')return;$b=reservation_bundle($id);if(!$b)return;$text="HOTEL FAZENDA VALE DA MANTIQUEIRA\nAUTORIZACAO DE SAIDA\nReserva: {$b['reservation']['reservation_number']}\nUH: {$b['reservation']['room_number']}\nComprovante: {$auth['receipt_number']}\n{$auth['url']}\n\n";$device=(string)cfg('printer_device');if(is_writable($device))@file_put_contents($device,$text,FILE_APPEND);
}

function branding_file(string $settingKey): ?string
{
    $name=basename((string)setting($settingKey,''));if($name==='')return null;$full=rtrim((string)cfg('branding_dir'),'/').'/'.$name;return is_file($full)?$full:null;
}
function branding_url(string $settingKey): ?string { $file=branding_file($settingKey);if(!$file)return null;return app_url('api.php?action=branding_media&key='.rawurlencode($settingKey).'&v='.filemtime($file)); }
function save_branding(string $settingKey,array $file,array $allowed,int $maxBytes): string
{
    require_admin();if(($file['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK)throw new RuntimeException('Selecione um arquivo.');if((int)$file['size']>$maxBytes)throw new RuntimeException('Arquivo muito grande.');$mime=(new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);if(!isset($allowed[$mime]))throw new RuntimeException('Formato de imagem não permitido.');$old=branding_file($settingKey);if($old)@unlink($old);$name=$settingKey.'.'.$allowed[$mime];$dest=rtrim((string)cfg('branding_dir'),'/').'/'.$name;if(!move_uploaded_file($file['tmp_name'],$dest))throw new RuntimeException('Não foi possível gravar a imagem.');db()->prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP')->execute([$settingKey,$name]);return app_url('api.php?action=branding_media&key='.rawurlencode($settingKey).'&v='.time());
}

// Inicializa banco/sessão ao incluir este arquivo.
db();
start_app_session();
