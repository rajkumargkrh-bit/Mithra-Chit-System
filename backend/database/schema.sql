-- ChitPro database schema (PostgreSQL)
-- Run with: psql -U postgres -d chitpro -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ========== USERS & MEMBERS ==========

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  mobile VARCHAR(15) UNIQUE NOT NULL,
  email VARCHAR(150),
  password_hash TEXT,
  role VARCHAR(20) NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','MANAGER','STAFF','ACCOUNTANT','CUSTOMER')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  member_code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  mobile VARCHAR(15) NOT NULL,
  whatsapp VARCHAR(15),
  email VARCHAR(150),
  address TEXT,
  id_type VARCHAR(30),
  id_number VARCHAR(60),
  nominee_name VARCHAR(150),
  nominee_mobile VARCHAR(15),
  joining_date DATE DEFAULT CURRENT_DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========== OTP (customer login) ==========

CREATE TABLE otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile VARCHAR(15) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========== CHIT PLANS / GROUPS ==========

CREATE TABLE chit_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  chit_value NUMERIC(14,2) NOT NULL,
  max_bid NUMERIC(14,2),
  duration_months INT NOT NULL,
  start_date DATE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('FIXED','DIVIDEND')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RUNNING','COMPLETED','CANCELLED')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chit_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_plan_id UUID REFERENCES chit_plans(id) ON DELETE CASCADE,
  group_code VARCHAR(20) UNIQUE NOT NULL,
  total_slots INT NOT NULL,
  filled_slots INT NOT NULL DEFAULT 0,
  vacant_slots INT GENERATED ALWAYS AS (total_slots - filled_slots) STORED,
  current_round INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'FORMING' CHECK (status IN ('FORMING','RUNNING','COMPLETED'))
);

CREATE TABLE chit_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_group_id UUID REFERENCES chit_groups(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  slot_number INT NOT NULL,
  joining_date DATE DEFAULT CURRENT_DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXITED','WON')),
  UNIQUE(chit_group_id, slot_number)
);

-- ========== AUCTIONS ==========

CREATE TABLE auction_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_group_id UUID REFERENCES chit_groups(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  auction_date DATE NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','LIVE','PAUSED','CLOSED')),
  winner_member_id UUID REFERENCES members(id),
  winning_bid NUMERIC(14,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(chit_group_id, round_number)
);

CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_round_id UUID REFERENCES auction_rounds(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id),
  bid_amount NUMERIC(14,2) NOT NULL,
  bid_time TIMESTAMPTZ DEFAULT now(),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','WITHDRAWN','WINNING'))
);

CREATE TABLE auction_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_round_id UUID REFERENCES auction_rounds(id) ON DELETE CASCADE,
  winner_id UUID REFERENCES members(id),
  chit_value NUMERIC(14,2) NOT NULL,
  winning_bid NUMERIC(14,2) NOT NULL,
  net_payout NUMERIC(14,2) NOT NULL,
  dividend NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========== PAYMENTS / DUES ==========

CREATE TABLE installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_member_id UUID REFERENCES chit_members(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  late_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PARTIAL','PAID','OVERDUE'))
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id),
  chit_group_id UUID REFERENCES chit_groups(id),
  installment_id UUID REFERENCES installments(id),
  amount NUMERIC(14,2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH','UPI','BANK_TRANSFER','CARD','CHEQUE')),
  transaction_reference VARCHAR(100),
  payment_date TIMESTAMPTZ DEFAULT now(),
  status VARCHAR(20) NOT NULL DEFAULT 'PAID' CHECK (status IN ('PENDING','PARTIAL','PAID','OVERDUE')),
  receipt_number VARCHAR(30) UNIQUE
);

-- ========== PAYOUTS ==========

CREATE TABLE payout_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  account_name VARCHAR(150),
  bank_name VARCHAR(100),
  account_number VARCHAR(40),
  ifsc VARCHAR(20),
  upi_id VARCHAR(80),
  is_primary BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'ACTIVE'
);

CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_result_id UUID REFERENCES auction_results(id),
  member_id UUID REFERENCES members(id),
  amount NUMERIC(14,2) NOT NULL,
  account_id UUID REFERENCES payout_accounts(id),
  payment_reference VARCHAR(100),
  paid_date TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PAID','FAILED'))
);

-- ========== CASH FLOW ==========

CREATE TABLE cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('INCOME','EXPENSE','PAYOUT','REFUND')),
  category VARCHAR(60),
  amount NUMERIC(14,2) NOT NULL,
  reference VARCHAR(100),
  description TEXT,
  transaction_date TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

-- ========== AUDIT LOG ==========

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  action VARCHAR(150) NOT NULL,
  entity_type VARCHAR(60),
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========== INDEXES ==========

CREATE INDEX idx_members_mobile ON members(mobile);
CREATE INDEX idx_chit_members_group ON chit_members(chit_group_id);
CREATE INDEX idx_bids_round ON bids(auction_round_id);
CREATE INDEX idx_installments_member ON installments(chit_member_id);
CREATE INDEX idx_payments_member ON payments(member_id);
CREATE INDEX idx_payouts_status ON payouts(status);

-- ========== SEED: default super admin ==========
-- Do NOT insert a hardcoded password hash here. After running this schema,
-- create the first admin with the provided script:
--   cd backend && node src/scripts/createAdmin.js "Super Admin" 9999999999 Admin@123
-- That script hashes the password with bcrypt and inserts the row safely.
