<?php
return [
    'app_name' => 'Totem Autoatendimento',
    'hotel_name' => 'Hotel Fazenda Vale da Mantiqueira',
    'timezone' => 'America/Sao_Paulo',
    'admin_password' => getenv('TOTEM_ADMIN_PASSWORD') ?: '251933',
    'data_dir' => dirname(__DIR__) . '/data',
    'upload_dir' => dirname(__DIR__) . '/uploads',
    'branding_dir' => dirname(__DIR__) . '/branding',
    'database_file' => dirname(__DIR__) . '/data/totem.sqlite',
    'schema_file' => dirname(__DIR__) . '/database/schema.sql',
    'session_name' => 'TOTEMPHPSESSID',
    'exit_token_secret' => getenv('TOTEM_EXIT_SECRET') ?: 'troque-esta-chave-na-producao-v3',
    'max_upload_bytes' => 15 * 1024 * 1024,
    'public_qr_base_url' => getenv('TOTEM_PUBLIC_BASE_URL') ?: '',
    'printer_device' => getenv('TOTEM_PRINTER_DEVICE') ?: '/dev/usb/lp0',
];
