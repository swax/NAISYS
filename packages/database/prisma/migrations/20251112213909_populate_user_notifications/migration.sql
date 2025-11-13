-- Populate user_notifications table from existing mail and log data

-- Insert a row for each user with data from thread_members, context_log, and run_session
INSERT INTO user_notifications (user_id, latest_mail_id, latest_log_id, last_active, modified_date)
SELECT
  u.id as user_id,
  -- Get the latest thread_id this user is a member of (represents latest mail)
  COALESCE((
    SELECT tm.thread_id
    FROM thread_members tm
    WHERE tm.user_id = u.id
    ORDER BY tm.thread_id DESC
    LIMIT 1
  ), -1) as latest_mail_id,
  -- Get the latest log_id for this user from run_session
  COALESCE((
    SELECT rs.latest_log_id
    FROM run_session rs
    WHERE rs.user_id = u.id
    ORDER BY rs.last_active DESC
    LIMIT 1
  ), -1) as latest_log_id,
  -- Get the most recent last_active time for this user
  COALESCE((
    SELECT rs.last_active
    FROM run_session rs
    WHERE rs.user_id = u.id
    ORDER BY rs.last_active DESC
    LIMIT 1
  ), datetime('now')) as last_active,
  datetime('now') as modified_date
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_notifications un WHERE un.user_id = u.id
);
