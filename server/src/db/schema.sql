-- Ready Raleigh on Tiger Data (TimescaleDB). Idempotent: the server runs this on every start.
-- Statements are split on a semicolon at the end of a line, so keep semicolons out of the middle.

-- Every finished run, scored by the server. Hypertable on time.
CREATE TABLE IF NOT EXISTS plays (
  id                 uuid             NOT NULL,
  created_at         timestamptz      NOT NULL DEFAULT now(),
  mode               text             NOT NULL,
  room_code          text             NOT NULL,
  player_id          text             NOT NULL,
  player_name        text             NOT NULL,
  score              double precision NOT NULL,
  best_possible      double precision,
  protected_people   double precision NOT NULL,
  stranded_people    double precision NOT NULL,
  protected_weighted double precision NOT NULL,
  at_risk_weighted   double precision NOT NULL,
  spent              bigint           NOT NULL,
  plan               jsonb            NOT NULL,
  result             jsonb            NOT NULL,
  PRIMARY KEY (id, created_at)
);
SELECT create_hypertable('plays', by_range('created_at', INTERVAL '1 day'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS plays_room ON plays (room_code, created_at DESC);

-- One row per piece placed. target is 'site:<id>', 'road:<id>' or 'cell:<index>'.
CREATE TABLE IF NOT EXISTS placements (
  created_at timestamptz NOT NULL,
  play_id    uuid        NOT NULL,
  mode       text        NOT NULL,
  room_code  text        NOT NULL,
  type       text        NOT NULL,
  target     text        NOT NULL,
  cell       integer
);
SELECT create_hypertable('placements', by_range('created_at', INTERVAL '1 day'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS placements_play ON placements (play_id);

-- Live river gauges (P15). Hypertable on time.
CREATE TABLE IF NOT EXISTS gauge_readings (
  time      timestamptz      NOT NULL,
  site_no   text             NOT NULL,
  name      text,
  parameter text             NOT NULL,
  value     double precision NOT NULL,
  unit      text,
  UNIQUE (site_no, parameter, time)
);
SELECT create_hypertable('gauge_readings', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE);

-- Crowd picks per spot per hour. Real-time (materialized_only = false): new plays count at once.
CREATE MATERIALIZED VIEW IF NOT EXISTS placements_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 hour', created_at) AS bucket, mode, type, target, cell, count(*) AS picks
FROM placements
GROUP BY bucket, mode, type, target, cell
WITH NO DATA;
SELECT add_continuous_aggregate_policy('placements_hourly',
  start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

-- Plays and scores per room per hour, for leaderboards.
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 hour', created_at) AS bucket, mode, room_code,
  count(*) AS plays, max(score) AS best_score, avg(score) AS avg_score,
  sum(protected_people) AS protected_people
FROM plays
GROUP BY bucket, mode, room_code
WITH NO DATA;
SELECT add_continuous_aggregate_policy('leaderboard_hourly',
  start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

-- Reference copy of the static game data, reloaded when the data build changes.
-- The game itself reads the static files. These tables let SQL join plays with people.
CREATE TABLE IF NOT EXISTS cells (
  i                   integer PRIMARY KEY,
  h3                  text    NOT NULL,
  hood                text    NOT NULL,
  pop                 double precision NOT NULL,
  pop65               double precision NOT NULL,
  low_inc             double precision NOT NULL,
  no_car_hh           double precision NOT NULL,
  weighted            double precision NOT NULL,
  flood_step          smallint,
  flood_frac          double precision NOT NULL,
  cut_off             boolean NOT NULL,
  flood_risk_weighted double precision NOT NULL,
  heat_c              double precision NOT NULL,
  tree_pct            double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS sites (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  kind       text NOT NULL,
  lon        double precision NOT NULL,
  lat        double precision NOT NULL,
  cell       integer NOT NULL,
  flood_step smallint
);
CREATE TABLE IF NOT EXISTS flood_roads (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  flood_step smallint NOT NULL,
  unlocks    integer[] NOT NULL
);
CREATE TABLE IF NOT EXISTS data_builds (
  build_date text        NOT NULL,
  cells      integer     NOT NULL,
  sites      integer     NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT now()
);

-- Crowd picks next to the people at flood risk, by neighborhood.
CREATE OR REPLACE VIEW crowd_by_hood AS
WITH hood_risk AS (
  SELECT hood, sum(flood_risk_weighted) AS flood_risk_weighted FROM cells GROUP BY hood
), hood_picks AS (
  SELECT c.hood, p.mode, sum(p.picks)::bigint AS picks
  FROM placements_hourly p JOIN cells c ON c.i = p.cell
  GROUP BY c.hood, p.mode
)
SELECT r.hood, p.mode, coalesce(p.picks, 0) AS picks, r.flood_risk_weighted
FROM hood_risk r LEFT JOIN hood_picks p ON p.hood = r.hood;
