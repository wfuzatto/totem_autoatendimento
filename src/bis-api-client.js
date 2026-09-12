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
      catch (_) { data = { raw: text.slice(0, 1000) }; }
    }
    if (!response.ok) {
      const message = data?.error || data?.message || `bis_api respondeu HTTP ${response.status}.`;
      throw new BisApiError(message, {
        status: response.status >= 500 ? 502 : response.status,
        code: 'bis_api_http_error',
        details: data
      });
    }
    return data;
  } catch (error) {
    if (error instanceof BisApiError) throw error;
    if (error?.name === 'AbortError') {
      throw new BisApiError('Tempo esgotado aguardando o gravador NFC.', { status: 504, code: 'bis_api_timeout' });
    }
    throw new BisApiError(`Não foi possível conectar ao bis_api: ${error?.message || error}`, {
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
  const reader = preferred && available.some(item => item.toLowerCase() === preferred.toLowerCase())
    ? available.find(item => item.toLowerCase() === preferred.toLowerCase())
    : available.find(item => /acr122/i.test(item)) || available[0] || preferred;
  return { readers: available, reader: reader || null, present: Boolean(reader && available.some(item => item.toLowerCase() === reader.toLowerCase())) };
}

async function cardStatus(reader = '') {
  const query = reader ? `?reader=${encodeURIComponent(reader)}` : '';
  try {
    const result = await requestJson(`/api/pcsc/probe${query}`);
    return {
      present: true,
      reader: String(result?.reader || result?.Reader || reader || ''),
      uidHex: String(result?.uidHex || result?.UidHex || result?.uid || result?.Uid || '').trim().toUpperCase(),
      raw: result
    };
  } catch (error) {
    if (error.code === 'bis_api_http_error' && Number(error.status) === 502) {
      return { present: false, reader: reader || null, code: error.details?.code || error.details?.Code || null };
    }
    throw error;
  }
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

  const written = Boolean(resultField(result, 'written', 'Written'));
  if (!written) {
    throw new BisApiError(resultField(result, 'message', 'Message') || 'O bis_api não confirmou a gravação do cartão.', {
      status: 502,
      code: 'bis_api_write_rejected',
      details: result
    });
  }

  return {
    payload: { ...payload, Confirmation: undefined },
    written,
    vendorResult: Number(resultField(result, 'vendorResult', 'VendorResult') ?? 0),
    message: String(resultField(result, 'message', 'Message') || 'Sucesso'),
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
  staticBlockers,
  accessWindow,
  health,
  readers,
  readerStatus,
  cardStatus,
  encodeHotelCard
};
