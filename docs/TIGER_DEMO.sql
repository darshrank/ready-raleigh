-- Tiger Data demo: paste one block at a time into the Tiger Cloud console's SQL editor.
-- Each block is what one part of the game reads. Keep `npm run dev` running so the live data is fresh.

-- 1. What lives in Tiger: plays, every piece placed, and live sensor readings, as hypertables.
SELECT hypertable_name, num_chunks, compression_enabled
FROM timescaledb_information.hypertables ORDER BY hypertable_name;

-- 2. Live right now: sensor readings that arrived in the last hour (USGS rivers + NWS weather).
SELECT count(*) AS readings_last_hour, count(DISTINCT site_no) AS sensors, max(time) AS newest
FROM gauge_readings WHERE time > now() - INTERVAL '1 hour' AND time <= now();

-- 3. The title screen's "Weather right now", per city.
SELECT w.city, w.station, w.conditions, round((r.value * 1.8 + 32)::numeric) AS temp_f, r.time AS observed
FROM weather_stations w
JOIN LATERAL (SELECT value, time FROM gauge_readings
              WHERE site_no = 'nws:' || w.station AND parameter = 'temp_c' AND time <= now()
              ORDER BY time DESC LIMIT 1) r ON true
ORDER BY w.city;

-- 4. Raleigh's rivers this hour, from the gauge_hourly continuous aggregate, closest to flood first.
SELECT g.name, round(h.last_value::numeric, 2) AS stage_ft, g.minor_ft AS flood_stage_ft,
       round((g.minor_ft - h.last_value)::numeric, 1) AS ft_below_flood
FROM gauge_hourly h JOIN gauges g USING (site_no)
WHERE h.parameter = 'stage_ft' AND g.minor_ft IS NOT NULL
  AND h.bucket = (SELECT max(bucket) FROM gauge_hourly WHERE parameter = 'stage_ft' AND bucket <= now())
ORDER BY ft_below_flood LIMIT 8;

-- 5. One creek over the last day with time_bucket (2-hour steps).
SELECT time_bucket(INTERVAL '2 hours', time) AS t, round(avg(value)::numeric, 2) AS stage_ft
FROM gauge_readings
WHERE site_no = (SELECT site_no FROM gauges WHERE name ILIKE '%Crabtree%' ORDER BY site_no LIMIT 1)
  AND parameter = 'stage_ft' AND time > now() - INTERVAL '24 hours'
GROUP BY t ORDER BY t;

-- 6. Where players act in Raleigh: the crowd_hourly continuous aggregate behind the planner page.
SELECT c.type, coalesce(s.name, r.name, c.target) AS place, sum(c.picks)::int AS picks
FROM crowd_hourly c
LEFT JOIN sites s ON c.target = 'site:' || s.id
LEFT JOIN flood_roads r ON c.target = 'road:' || r.id
WHERE c.city = 'raleigh' AND c.mode = 'flood'
GROUP BY c.type, place ORDER BY picks DESC LIMIT 8;

-- 7. Plays per hour and the best score: the leaderboard_hourly continuous aggregate.
SELECT bucket, sum(plays)::int AS plays, round(max(best_score)::numeric, 1) AS best_score
FROM leaderboard_hourly GROUP BY bucket ORDER BY bucket DESC LIMIT 8;

-- 8. Columnstore compression on the sensor readings.
SELECT pg_size_pretty(before_compression_total_bytes) AS before, pg_size_pretty(after_compression_total_bytes) AS after,
       round(before_compression_total_bytes::numeric / nullif(after_compression_total_bytes, 0), 1) AS ratio
FROM hypertable_columnstore_stats('gauge_readings');
