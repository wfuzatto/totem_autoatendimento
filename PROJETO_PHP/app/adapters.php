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
}

final class MockNfcBridge implements NfcBridge
{
    public function encode(int $reservationId, int $guestId, string $payload): string { return $payload; }
    public function read(): ?string { return null; }
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
