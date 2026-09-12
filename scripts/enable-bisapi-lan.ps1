#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$HubAddress,
    [switch]$EnableHotelCardWrites
)
$ErrorActionPreference = 'Stop'
$parsed = $null
if (-not [System.Net.IPAddress]::TryParse($HubAddress, [ref]$parsed)) { throw 'HubAddress deve ser um IP.' }
$configPath = 'C:\Program Files\BisApi\appsettings.Local.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $config.BeTech57.HotelPassword) { throw 'HPASS ausente. Configure a senha original do hotel no Windows.' }
if (-not $config.BisApi.RequireWriteChallenge) { throw 'RequireWriteChallenge ausente.' }
$previousPassword = $config.BeTech57.HotelPassword
$backup = $configPath + '.before-nfc-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
Copy-Item -LiteralPath $configPath -Destination $backup
$ruleName = 'BisApi-Hub-NFC'
$createdRule = $false
try {
    $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($rule) {
        $remote = @($rule | Get-NetFirewallAddressFilter | Select-Object -ExpandProperty RemoteAddress)
        if ($remote.Count -ne 1 -or $remote[0] -ne $HubAddress) { throw 'Regra BisApi-Hub-NFC existente possui escopo diferente. Revise antes de continuar.' }
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName 'BisApi NFC - somente servidor HUB' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8765 -RemoteAddress $HubAddress -Profile Any | Out-Null
        $createdRule = $true
    }
    $config.BisApi | Add-Member -NotePropertyName Url -NotePropertyValue 'http://0.0.0.0:8765' -Force
    $config.BisApi | Add-Member -NotePropertyName EnableHotelCardWrites -NotePropertyValue ([bool]$EnableHotelCardWrites) -Force
    $config.BisApi | Add-Member -NotePropertyName EnableRawWrites -NotePropertyValue $false -Force
    $config.BisApi | Add-Member -NotePropertyName AllowTrailerWrites -NotePropertyValue $false -Force
    # Serialize locally only: never print/log the JSON or the password/challenge.
    [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 100), [System.Text.UTF8Encoding]::new($false))
    $saved = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($saved.BeTech57.HotelPassword -cne $previousPassword) { throw 'HPASS divergente; restaurando configuração.' }
    Restart-Service BisApi
    $health = $null
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        try { $health = Invoke-RestMethod http://127.0.0.1:8765/api/health -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 700 }
    }
    if (-not $health.ok -or $health.vendor.hotelCardWritesEnabled -ne [bool]$EnableHotelCardWrites) { throw 'BisApi não confirmou a configuração.' }
    [pscustomobject]@{ Online = $health.ok; Url = $health.url; WritesEnabled = $health.vendor.hotelCardWritesEnabled; HotelPasswordConfigured = $health.vendor.hotelPasswordConfigured; FirewallHub = $HubAddress; Backup = $backup }
} catch {
    Copy-Item -LiteralPath $backup -Destination $configPath -Force
    if ($createdRule) { Remove-NetFirewallRule -Name $ruleName }
    Restart-Service BisApi
    throw 'Não foi possível habilitar a LAN. Configuração anterior restaurada; consulte o serviço BisApi.'
}
