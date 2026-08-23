PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_number TEXT NOT NULL UNIQUE,
  room_number TEXT,
  responsible_name TEXT NOT NULL,
  responsible_cpf TEXT,
  checkin_date TEXT,
  checkout_date TEXT,
  status TEXT NOT NULL DEFAULT 'reserved',
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  payment_pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document TEXT,
  adult INTEGER NOT NULL DEFAULT 1,
  wristband_code TEXT,
  face_verified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS folio_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  contested INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  filename TEXT,
  status TEXT NOT NULL DEFAULT 'missing',
  uploaded_at TEXT,
  UNIQUE(reservation_id, guest_id, type)
);

CREATE TABLE IF NOT EXISTS upload_tokens (
  token TEXT PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wristband_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  returned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(reservation_id, code)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  external_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_state (
  reservation_id INTEGER PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
  govbr_verified INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservation_admin_meta (
  reservation_id INTEGER PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'integration',
  external_id TEXT,
  responsible_email TEXT,
  responsible_phone TEXT,
  notes TEXT,
  last_sync_at TEXT,
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  initial_payment_pending INTEGER NOT NULL DEFAULT 0,
  initial_room_number TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exit_authorizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL UNIQUE,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  reservation_id INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reservation_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservation_cpf ON reservations(responsible_cpf);
CREATE INDEX IF NOT EXISTS idx_guest_reservation ON guests(reservation_id);
CREATE INDEX IF NOT EXISTS idx_document_reservation ON documents(reservation_id);
CREATE INDEX IF NOT EXISTS idx_meta_source ON reservation_admin_meta(source);
CREATE INDEX IF NOT EXISTS idx_exit_token ON exit_authorizations(token_id);
