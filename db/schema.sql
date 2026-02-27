CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  pin VARCHAR(4) NOT NULL,
  lang VARCHAR(2) DEFAULT 'da',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  driver_id INTEGER REFERENCES drivers(id),
  tur_nr VARCHAR(50),
  order_nr VARCHAR(50),
  customer_name VARCHAR(255),
  address TEXT,
  product TEXT,
  delivery_date DATE,
  antal INTEGER,
  pos_nr VARCHAR(20),
  production VARCHAR(100),
  barcode VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending',
  damage_report TEXT,
  missing_items TEXT,
  ai_raw_response TEXT,
  email_sent BOOLEAN DEFAULT FALSE,
  email_sent_to VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_photos (
  id SERIAL PRIMARY KEY,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  photo_type VARCHAR(20) DEFAULT 'sticker',
  original_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_driver_id ON jobs(driver_id);

-- Insert default driver for testing
INSERT INTO drivers (name, pin) VALUES ('Test Driver', '1234') ON CONFLICT DO NOTHING;
