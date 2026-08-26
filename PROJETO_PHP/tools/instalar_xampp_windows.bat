@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SOURCE=%~dp0.."
if "%XAMPP_ROOT%"=="" set "XAMPP_ROOT=C:\xampp"
if "%WEB_NAME%"=="" set "WEB_NAME=totem"
set "DEST=%XAMPP_ROOT%\htdocs\%WEB_NAME%"
set "PHP=%XAMPP_ROOT%\php\php.exe"

echo Projeto fonte: %SOURCE%
echo XAMPP:         %XAMPP_ROOT%
echo Destino:       %DEST%
echo.

if not exist "%PHP%" (
  echo ERRO: PHP do XAMPP nao encontrado em %PHP%
  echo Defina XAMPP_ROOT antes de executar se o XAMPP estiver em outro caminho.
  exit /b 1
)

if not exist "%DEST%" mkdir "%DEST%"

if exist "%DEST%\data\totem.sqlite" (
  echo Instalacao existente detectada. Preservando data, uploads e branding.
  robocopy "%SOURCE%" "%DEST%" /MIR /XD data uploads branding /XF .gitignore >nul
  if errorlevel 8 (
    echo ERRO: falha ao atualizar os arquivos.
    exit /b 1
  )
) else (
  echo Primeira instalacao. Copiando distribuicao completa.
  robocopy "%SOURCE%" "%DEST%" /MIR /XF .gitignore >nul
  if errorlevel 8 (
    echo ERRO: falha ao copiar os arquivos.
    exit /b 1
  )
)

if not exist "%DEST%\data" mkdir "%DEST%\data"
if not exist "%DEST%\uploads" mkdir "%DEST%\uploads"
if not exist "%DEST%\branding" mkdir "%DEST%\branding"

echo.
echo Verificando extensoes PHP obrigatorias...
for %%E in (PDO pdo_sqlite fileinfo openssl mbstring json) do (
  "%PHP%" -m | findstr /I /X "%%E" >nul
  if errorlevel 1 (
    echo FALTA: %%E
  ) else (
    echo OK:    %%E
  )
)

echo.
echo Executando smoke test...
"%PHP%" "%DEST%\tools\smoke.php"
if errorlevel 1 (
  echo AVISO: o smoke test encontrou falhas. Abra diagnostico.php para detalhes.
)

echo.
echo Instalacao concluida.
echo Abra no navegador:
echo   http://localhost/%WEB_NAME%/install.php
echo   http://localhost/%WEB_NAME%/diagnostico.php
echo   http://localhost/%WEB_NAME%/
echo.
pause
