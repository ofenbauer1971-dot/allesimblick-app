CREATE TABLE IF NOT EXISTS subscriptions (
  device_hash TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL,
  subscription_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_hash, endpoint_hash)
);

CREATE TABLE IF NOT EXISTS reminders (
  device_hash TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_url TEXT NOT NULL DEFAULT './',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error TEXT,
  PRIMARY KEY (device_hash, reminder_id)
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reminders_device ON reminders(device_hash);
