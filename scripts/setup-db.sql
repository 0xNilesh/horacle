-- Horacle Database Schema
-- Run this in Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id_nullifier TEXT UNIQUE NOT NULL,
  wallet_address TEXT NOT NULL,
  display_name TEXT,
  push_token TEXT,
  reputation_score FLOAT DEFAULT 3.0,
  total_earned_usdc FLOAT DEFAULT 0.0,
  total_queries_answered INT DEFAULT 0,
  avg_response_time_ms FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- LIVE SESSIONS
-- ============================================
CREATE TABLE live_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  status TEXT DEFAULT 'live' CHECK (status IN ('live', 'ended', 'expired')),
  started_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  earnings_usdc FLOAT DEFAULT 0,
  queries_answered INT DEFAULT 0
);

CREATE INDEX idx_live_geo ON live_sessions USING GIST(location);
CREATE INDEX idx_live_status ON live_sessions(status, expires_at);

-- ============================================
-- USER LOCATIONS (real-time GPS, upserted every 15s)
-- ============================================
CREATE TABLE user_locations (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  accuracy_m FLOAT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_uloc_geo ON user_locations USING GIST(location);

-- ============================================
-- QUERIES
-- ============================================
CREATE TABLE queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asker_id TEXT,
  question TEXT NOT NULL,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  radius_m FLOAT DEFAULT 500,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'answered', 'expired', 'cached')),
  budget_usdc FLOAT DEFAULT 0.05,
  answer TEXT,
  responder_id UUID REFERENCES users(id),
  response_time_ms INT,
  rating TEXT CHECK (rating IN ('helpful', 'not_helpful')),
  payment_tx_hash TEXT,
  cached_until TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_queries_geo ON queries USING GIST(location);
CREATE INDEX idx_queries_status ON queries(status, created_at);

-- ============================================
-- FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION upsert_location(
  p_user_id UUID, p_lng FLOAT, p_lat FLOAT, p_accuracy FLOAT DEFAULT NULL
) RETURNS VOID AS $$
  INSERT INTO user_locations (user_id, location, accuracy_m, updated_at)
  VALUES (p_user_id, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_accuracy, now())
  ON CONFLICT (user_id) DO UPDATE
  SET location = EXCLUDED.location, accuracy_m = EXCLUDED.accuracy_m, updated_at = now();
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION create_live_session(
  p_user_id UUID, p_lng FLOAT, p_lat FLOAT, p_expires_at TIMESTAMPTZ
) RETURNS UUID AS $$
  INSERT INTO live_sessions (user_id, location, status, expires_at)
  VALUES (p_user_id, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, 'live', p_expires_at)
  RETURNING id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION find_live_responders(
  p_lng FLOAT, p_lat FLOAT, p_radius_m FLOAT DEFAULT 500
) RETURNS TABLE(
  user_id UUID, wallet_address TEXT, push_token TEXT,
  reputation_score FLOAT, distance_m FLOAT
) AS $$
  SELECT u.id, u.wallet_address, u.push_token, u.reputation_score,
    ST_Distance(ul.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m
  FROM live_sessions ls
  JOIN users u ON u.id = ls.user_id
  JOIN user_locations ul ON ul.user_id = ls.user_id
  WHERE ls.status = 'live'
    AND ls.expires_at > now()
    AND ul.updated_at > now() - interval '60 seconds'
    AND ST_DWithin(ul.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m)
    AND u.reputation_score >= 1.0
    AND u.push_token IS NOT NULL
  ORDER BY u.reputation_score DESC, distance_m ASC
  LIMIT 5;
$$ LANGUAGE sql;

-- Create a query with PostGIS location
CREATE OR REPLACE FUNCTION create_query(
  p_asker_id TEXT, p_question TEXT, p_lng FLOAT, p_lat FLOAT,
  p_budget_usdc FLOAT, p_expires_at TIMESTAMPTZ
) RETURNS UUID AS $$
  INSERT INTO queries (asker_id, question, location, budget_usdc, expires_at)
  VALUES (p_asker_id, p_question, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_budget_usdc, p_expires_at)
  RETURNING id;
$$ LANGUAGE sql;

-- Increment responder stats after answering
CREATE OR REPLACE FUNCTION increment_responder_stats(p_user_id UUID)
RETURNS VOID AS $$
  UPDATE users SET
    total_queries_answered = total_queries_answered + 1,
    total_earned_usdc = total_earned_usdc + 0.05
  WHERE id = p_user_id;
$$ LANGUAGE sql;

-- Update reputation after rating
CREATE OR REPLACE FUNCTION update_reputation(p_user_id UUID, p_rating TEXT)
RETURNS VOID AS $$
  UPDATE users SET
    reputation_score = CASE
      WHEN p_rating = 'helpful' THEN LEAST(5.0, reputation_score + 0.1 * (1 - reputation_score / 5))
      WHEN p_rating = 'not_helpful' THEN GREATEST(0.0, reputation_score - 0.15 * (reputation_score / 5))
      ELSE reputation_score
    END
  WHERE id = p_user_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION expire_stale() RETURNS VOID AS $$
  UPDATE live_sessions SET status = 'expired' WHERE status = 'live' AND expires_at < now();
  UPDATE queries SET status = 'expired' WHERE status = 'open' AND expires_at < now();
$$ LANGUAGE sql;

-- ============================================
-- RLS (permissive for hackathon)
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_users" ON users FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE live_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_live" ON live_sessions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE user_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_uloc" ON user_locations FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_queries" ON queries FOR ALL USING (true) WITH CHECK (true);
