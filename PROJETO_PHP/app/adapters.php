<?php
declare(strict_types=1);

interface HotelIntegrationAdapter
{
    public function find(string $query): ?array;
    public function sync(string $externalId): array;
}

final class TotvsGuestAdapter implements HotelIntegrationAdapter
{
    public function __construct(private string $baseUrl, private string $token) {}

    public function find(string $query): ?array
    {
        throw new LogicException('TOTVS Guest API ainda depende do Swagger/contrato real do hotel.');
    }

    public function sync(string $externalId): array
    {
        throw new LogicException('TOTVS Guest API ainda depende do Swagger/contrato real do hotel.');
    }

    public function configured(): bool
    {
        return str_starts_with($this->baseUrl, 'https://') && $this->token !== '';
    }
}

interface NfcBridge
{
    public function encode(int $reservationId, int $guestId, string $payload): string;
    public function read(): ?string;
    public function status(): array;
}

final class MockNfcBridge implements NfcBridge
{
    public function encode(int $reservationId, int $guestId, string $payload): string { return $payload; }
    public function read(): ?string { return null; }
    public function status(): array { return ['mode'=>'mock','present'=>false,'uid'=>null]; }
}

final class BisApiNfcBridge implements NfcBridge
{
    public function __construct(private string $baseUrl, private string $reader, private string $confirmation) {}

    public function status(): array
    {
        try {
            $result = $this->request('/api/pcsc/probe?reader=' . rawurlencode($this->reader));
            return ['mode'=>'pcsc','present'=>true,'uid'=>$result['uidHex'] ?? null,'reader'=>$result['reader'] ?? $this->reader];
        } catch (Throwable $e) {
            return ['mode'=>'pcsc','present'=>false,'uid'=>null,'reader'=>$this->reader,'error'=>'Leitor aguardando pulseira.'];
        }
    }

    public function encode(int $reservationId, int $guestId, string $payload): string
    {
        $request = json_decode($payload, true, 16, JSON_THROW_ON_ERROR);
        $result = $this->request('/api/hotel-card/encode', 'POST', [
            'roomOrDoorId' => (string)($request['roomOrDoorId'] ?? ''),
            'validFrom' => (string)($request['validFrom'] ?? ''),
            'validUntil' => (string)($request['validUntil'] ?? ''),
            'confirmation' => $this->confirmation,
            'readerName' => $this->reader,
            'guestIndex' => (int)($request['guestIndex'] ?? 1),
            'suitDoor' => '000000000000',
            'publicDoor' => '00000000',
        ]);
        if (empty($result['written'])) throw new RuntimeException('BisApi não confirmou a gravação da pulseira.');
        return 'NFC-' . strtoupper((string)($result['uidHex'] ?? bin2hex(random_bytes(4))));
    }

    public function read(): ?string { return $this->status()['uid'] ?? null; }

    private function request(string $path, string $method='GET', ?array $body=null): array
    {
        $url = rtrim($this->baseUrl, '/') . $path;
        $headers = ['Content-Type: application/json', 'Accept: application/json'];
        $options = ['http'=>[
            'method'=>$method,
            'timeout'=>3,
            'ignore_errors'=>true,
            'header'=>implode("\r\n", $headers),
        ]];
        if ($body !== null) $options['http']['content'] = json_encode($body, JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $raw = @file_get_contents($url, false, stream_context_create($options));
        $status = 0;
        foreach (($http_response_header ?? []) as $line) if (preg_match('/\s(\d{3})\s/', $line, $m)) { $status=(int)$m[1]; break; }
        $result = is_string($raw) ? json_decode($raw, true) : null;
        if ($status < 200 || $status >= 300 || !is_array($result)) throw new RuntimeException('BisApi indisponível ou rejeitou a operação.');
        return $result;
    }
}

interface PaymentBridge
{
    public function charge(int $amountCents, string $method): array;
}

final class MockPaymentBridge implements PaymentBridge
{
    public function charge(int $amountCents, string $method): array
    {
        return ['approved'=>true,'reference'=>'MOCK-'.strtoupper(bin2hex(random_bytes(4))),'amount_cents'=>$amountCents,'method'=>$method];
    }
}

final class SitefPaymentBridge implements PaymentBridge
{
    public function __construct(private string $server) {}
    public function charge(int $amountCents, string $method): array
    {
        throw new LogicException('A chamada SiTef/Gertec PPC930 deve ser implementada com o SDK/TEF homologado do estabelecimento.');
    }
}
