class BisApiError extends Error {
  constructor(message, { status = 502, code = 'bis_api_error', details = null } = {}) {
    super(message);
    this.name = 'BisApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function baseUrl() {
  return env('BIS_API_URL').replace(/\/+$/, '');
}

function timeoutMs() {
  const parsed = Number(env('BIS_API_TIMEOUT_MS', '15000'));
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 15000;
}

function providerConfig() {
  return {
    url: baseUrl(),
    confirmationConfigured: Boolean(env('BIS_API_WRITE_CONFIRMATION')),
    checkinTime: env('HOTEL_ACCESS_CHECKIN_TIME'),
    checkoutTime: env('HOTEL_ACCESS_CHECKOUT_TIME'),
    utcOffset: env('HOTEL_ACCESS_UTC_OFFSET'),
    timeoutMs: timeoutMs()
  };
}

function configurationError() {
  const config = providerConfig();
  try {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch (_) { return 'BIS_API_URL deve ser uma URL HTTP/HTTPS válida, sem credenciais.'; }
  if (!config.confirmationConfigured) return 'BIS_API_WRITE_CONFIRMATION não configurada no servidor.';
  try {
    validateTime(config.checkinTime, 'HOTEL_ACCESS_CHECKIN_TIME');
    validateTime(config.checkoutTime, 'HOTEL_ACCESS_CHECKOUT_TIME');
    validateOffset(config.utcOffset);
  } catch (error) { return error.message; }
  return null;
}

function validateTime(value, field) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BisApiError(`${field} deve usar HH:MM.`, { status: 503, code: 'bis_api_config' });
  }
  return value;
}

function validateOffset(value) {
  if (!/^(Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.test(value)) {
    throw new BisApiError('HOTEL_ACCESS_UTC_OFFSET deve usar Z ou ±HH:MM.', { status: 503, code: 'bis_api_config' });
  }
  return value;
}

function validateDate(value, field) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BisApiError(`${field} inválida ou ausente.`, { status: 409, code: 'validity_missing' });
  }
  return raw;
}

function writeFailureDetails(data) {
  // Non-2xx responses stay opaque by default: an upstream service must never
  // reflect the write confirmation back to the kiosk. This endpoint has a
  // small documented result contract, though, and these fields contain no
  // secret. Preserving them distinguishes a codec-confirmed failure from a
  // transport result whose physical outcome is genuinely unknown.
  const written = data?.written ?? data?.Written;
  const vendorResult = Number(data?.vendorResult ?? data?.VendorResult);
  if (written !== false || !Number.isInteger(vendorResult) || vendorResult === 0) return null;

  return {
    written: false,
    vendorResult,
    message: String(data?.message ?? data?.Message ?? '').trim().slice(0, 240),
    reader: String(data?.reader ?? data?.Reader ?? '').trim().slice(0, 240),
    uidHex: String(data?.uidHex ?? data?.UidHex ?? '').trim().toUpperCase()
  };
}

function accessWindow(reservation) {
  const checkinTime = validateTime(env('HOTEL_ACCESS_CHECKIN_TIME'), 'HOTEL_ACCESS_CHECKIN_TIME');
  const checkoutTime = validateTime(env('HOTEL_ACCESS_CHECKOUT_TIME'), 'HOTEL_ACCESS_CHECKOUT_TIME');
  const offset = validateOffset(env('HOTEL_ACCESS_UTC_OFFSET'));
  const fromDate = validateDate(reservation?.checkin_date, 'Data de check-in');
  const untilDate = validateDate(reservation?.checkout_date, 'Data de check-out');
  const suffix = offset === 'Z' ? 'Z' : offset;
  const validFrom = `${fromDate}T${checkinTime}:00${suffix}`;
  const validUntil = `${untilDate}T${checkoutTime}:00${suffix}`;

  if (!(Date.parse(validUntil) > Date.parse(validFrom))) {
    throw new BisApiError('A validade final da pulseira precisa ser posterior à inicial.', {
      status: 409,
      code: 'validity_invalid'
    });
  }

  return { validFrom, validUntil };
}

function staticBlockers(reservation) {
  const blockers = [];
  const config = providerConfig();
  const invalid = configurationError();
  if (invalid) blockers.push({ code: 'bis_api_config', message: invalid });
  if (!config.url) blockers.push({ code: 'bis_api_url_missing', message: 'BIS_API_URL não está configurada no servidor do Totem.' });
  if (!config.confirmationConfigured) blockers.push({ code: 'bis_api_confirmation_missing', message: 'BIS_API_WRITE_CONFIRMATION não está configurada no servidor do Totem.' });
  if (!config.checkinTime) blockers.push({ code: 'access_checkin_time_missing', message: 'Horário de início do acesso não configurado.' });
  if (!config.checkoutTime) blockers.push({ code: 'access_checkout_time_missing', message: 'Horário final do acesso não configurado.' });
  if (!config.utcOffset) blockers.push({ code: 'access_utc_offset_missing', message: 'Fuso/offset do acesso não configurado.' });

  if (blockers.length === 0) {
    try {
      accessWindow(reservation);
    } catch (error) {
      blockers.push({ code: error.code || 'validity_invalid', message: error.message });
    }
  }
  return blockers;
}

async function requestJson(path, options = {}) {
  const url = baseUrl();
  if (!url) {
    throw new BisApiError('BIS_API_URL não configurada.', { status: 503, code: 'bis_api_url_missing' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${url}${path}`, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); }
      catch (_) { throw new BisApiError('Resposta inválida do BisApi.', { code: 'bis_api_invalid_response' }); }
    }
    if (!response.ok) {
      // Arbitrary upstream errors may echo the write challenge. Do not forward them.
      const writeFailure = path === '/api/hotel-card/encode' ? writeFailureDetails(data) : null;
      const hotelPasswordRejected = writeFailure?.vendorResult === 5;
      const message = hotelPasswordRejected
        ? 'Esta pulseira não autentica com o código deste hotel (BIS código 5). Retire-a e use outra pulseira já preparada para este hotel; repetir a mesma pulseira não resolverá.'
        : writeFailure
          ? `O codec BIS confirmou que a gravação não foi concluída (código ${writeFailure.vendorResult}).`
          : `Falha ao consultar ou gravar no BisApi (HTTP ${response.status}).`;
      throw new BisApiError(message, {
        status: response.status >= 500 ? 502 : response.status,
        code: writeFailure ? 'bis_api_vendor_write_failed' : 'bis_api_http_error',
        details: {
          code: data?.code,
          operation: data?.operation,
          httpStatus: response.status,
          writeFailure,
          cardReplacementRequired: hotelPasswordRejected
        }
      });
    }
    return data;
  } catch (error) {
    if (error instanceof BisApiError) throw error;
    if (error?.name === 'AbortError') {
      throw new BisApiError('Tempo esgotado aguardando o gravador NFC.', { status: 504, code: 'bis_api_timeout' });
    }
    throw new BisApiError('BisApi indisponível. Verifique a conexão com o Windows.', {
      status: 503,
      code: 'bis_api_unreachable'
    });
  } finally {
    clearTimeout(timer);
  }
}

async function health() {
  return requestJson('/api/health');
}

async function readers() {
  return requestJson('/api/pcsc/readers');
}

async function readerStatus(preferredReader = '') {
  const result = await readers();
  const available = Array.isArray(result?.readers) ? result.readers.map(item => String(item || '').trim()).filter(Boolean) : [];
  const preferred = String(preferredReader || '').trim();
  const reader = preferred
    ? available.find(item => item.toLowerCase() === preferred.toLowerCase())
    : available.find(item => /acr122/i.test(item));
  return { readers: available, reader: reader || null, present: Boolean(reader && available.some(item => item.toLowerCase() === reader.toLowerCase())) };
}

async function cardStatus(reader = '') {
  const query = reader ? `?reader=${encodeURIComponent(reader)}` : '';
  try {
    const result = await requestJson(`/api/pcsc/probe${query}`);
    const uidHex = String(result?.uidHex || result?.UidHex || '').trim().toUpperCase();
    if (!validUid(uidHex)) throw new BisApiError('O leitor não retornou um UID válido.', { code: 'bis_api_uid_missing' });
    return {
      present: true,
      reader: String(result?.reader || result?.Reader || reader || ''),
      uidHex
    };
  } catch (error) {
    if (error.code === 'bis_api_http_error' && ['0X8010000C', '0X80100069'].includes(String(error.details?.code).toUpperCase())) {
      return { present: false, reader: reader || null, code: error.details?.code || error.details?.Code || null };
    }
    throw error;
  }
}

function validUid(value) { return /^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/i.test(String(value || '')); }

async function hardwareStatus({ requireWrite = true } = {}) {
  const configError = configurationError();
  const status = { ok: false, provider: 'bis_api', online: false, configured: !configError, ready_for_write: false };
  if (configError) return { ...status, code: 'bis_api_config', error: configError };
  try {
    const result = await health();
    const vendor = result?.vendor || result?.Vendor || {};
    Object.assign(status, {
      online: result.ok === true,
      process_architecture: result.processArchitecture || result.ProcessArchitecture,
      codec_present: (vendor.codecPresent ?? vendor.CodecPresent) === true,
      pcsc_shim_present: (vendor.pcscShimPresent ?? vendor.PcscShimPresent) === true,
      writes_enabled: (vendor.hotelCardWritesEnabled ?? vendor.HotelCardWritesEnabled) === true,
      hotel_password_configured: (vendor.hotelPasswordConfigured ?? vendor.HotelPasswordConfigured) === true,
      reader: vendor.pcscReader || vendor.PcscReader || null,
      datetime_format: vendor.dateTimeFormat || vendor.DateTimeFormat || null
    });
    const reader = await readerStatus(status.reader);
    status.reader_present = reader.present;
    status.reader = reader.reader || status.reader;
    const checks = [
      [status.online, 'bis_api_offline', 'BisApi indisponível.'],
      [String(status.process_architecture).toUpperCase() === 'X86', 'architecture', 'BisApi precisa executar em x86.'],
      [status.codec_present, 'codec_missing', 'Codec BIS ausente.'],
      [status.pcsc_shim_present, 'shim_missing', 'PC/SC shim ausente.'],
      [status.reader_present, 'reader_missing', 'ACR122U não encontrado.'],
      [status.hotel_password_configured, 'hpass_missing', 'HotelPassword/HPASS não configurado no Windows.'],
      ...(requireWrite ? [[status.writes_enabled, 'writes_disabled', 'Gravação não habilitada no BisApi.']] : [])
    ];
    const failure = checks.find(([ready]) => !ready);
    if (failure) return { ...status, code: failure[1], error: failure[2] };
    return { ...status, ok: true, ready_for_write: true, code: 'ready' };
  } catch (error) { return { ...status, code: error.code || 'bis_api_error', error: error.message }; }
}

function readField(result, camel, pascal) {
  const value = result?.[camel] ?? result?.[pascal];
  return value == null ? null : String(value).trim();
}

async function readGuestCard() {
  const result = await requestJson('/api/vendor/read-guest-card');
  const vendorResult = Number(result?.vendorResult ?? result?.VendorResult);
  return {
    success: (result?.success ?? result?.Success) === true,
    vendorResult: Number.isInteger(vendorResult) ? vendorResult : null,
    reader: readField(result, 'reader', 'Reader'),
    uidHex: readField(result, 'uidHex', 'UidHex')?.toUpperCase() || null,
    doorId: readField(result, 'doorId', 'DoorId'),
    guestSerial: Number(result?.guestSerial ?? result?.GuestSerial ?? 0) || null,
    holderSerial: Number(result?.holderSerial ?? result?.HolderSerial ?? 0) || null,
    guestIndex: Number(result?.guestIndex ?? result?.GuestIndex ?? 0) || null,
    beginTime: readField(result, 'beginTime', 'BeginTime'),
    endTime: readField(result, 'endTime', 'EndTime')
  };
}

async function cardKeyState() {
  const result = await requestJson('/api/vendor/card-key-state');
  return {
    conclusive: (result?.conclusive ?? result?.Conclusive) === true,
    state: readField(result, 'state', 'State'),
    hotelVendorResult: Number(result?.hotelVendorResult ?? result?.HotelVendorResult),
    factoryVendorResult: result?.factoryVendorResult ?? result?.FactoryVendorResult ?? null,
    reader: readField(result, 'reader', 'Reader'),
    uidHex: readField(result, 'uidHex', 'UidHex')?.toUpperCase() || null,
    message: readField(result, 'message', 'Message')
  };
}

function resultField(result, camel, pascal) {
  return result?.[camel] ?? result?.[pascal];
}

async function encodeHotelCard({ reservation, guest }) {
  const confirmation = env('BIS_API_WRITE_CONFIRMATION');
  if (!confirmation) {
    throw new BisApiError('BIS_API_WRITE_CONFIRMATION não configurada.', {
      status: 503,
      code: 'bis_api_confirmation_missing'
    });
  }

  const { validFrom, validUntil } = accessWindow(reservation);
  const payload = {
    RoomOrDoorId: String(reservation.room_number || '').trim(),
    ValidFrom: validFrom,
    ValidUntil: validUntil,
    Confirmation: confirmation,
    GuestName: String(guest.name || '').trim()
  };

  const result = await requestJson('/api/hotel-card/encode', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const written = resultField(result, 'written', 'Written') === true;
  if (!written) {
    throw new BisApiError('O bis_api não confirmou a gravação do cartão.', {
      status: 502,
      code: 'bis_api_write_rejected',
      details: result
    });
  }

  return {
    payload: { ...payload, Confirmation: undefined },
    written,
    vendorResult: Number(resultField(result, 'vendorResult', 'VendorResult') ?? 0),
    message: 'Pulseira gravada.',
    reader: String(resultField(result, 'reader', 'Reader') || ''),
    uidHex: String(resultField(result, 'uidHex', 'UidHex') || '').trim().toUpperCase(),
    doorId: String(resultField(result, 'doorId', 'DoorId') || payload.RoomOrDoorId),
    beginTime: String(resultField(result, 'beginTime', 'BeginTime') || ''),
    endTime: String(resultField(result, 'endTime', 'EndTime') || ''),
    guestSerial: Number(resultField(result, 'guestSerial', 'GuestSerial') ?? 0),
    holderSerial: Number(resultField(result, 'holderSerial', 'HolderSerial') ?? 0),
    guestIndex: Number(resultField(result, 'guestIndex', 'GuestIndex') ?? 0),
    suitDoor: String(resultField(result, 'suitDoor', 'SuitDoor') || ''),
    publicDoor: String(resultField(result, 'publicDoor', 'PublicDoor') || ''),
    raw: result,
    validFrom,
    validUntil
  };
}

module.exports = {
  BisApiError,
  providerConfig,
  configurationError,
  hardwareStatus,
  validUid,
  staticBlockers,
  accessWindow,
  health,
  readers,
  readerStatus,
  cardStatus,
  readGuestCard,
  cardKeyState,
  encodeHotelCard
};