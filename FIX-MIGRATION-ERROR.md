# Fix Database Migration Error

## Problem
The deployment failed with the following error:
```
❌ 遷移執行失敗: trigger "task_comments_update_timestamp" for relation "task_comments" already exists
```
This happened because the migration script `backend/migrations/002_collaboration_features.sql` tried to create a trigger that already existed in the database, and the script was not idempotent (it didn't check if the trigger existed before creating it).

## Solution
Modified `backend/migrations/002_collaboration_features.sql` to include `DROP TRIGGER IF EXISTS` before creating the trigger. This ensures that the migration can be run multiple times without failing.

## Changes
- Modified `backend/migrations/002_collaboration_features.sql`:
    - Added `DROP TRIGGER IF EXISTS task_comments_update_timestamp ON task_comments;` before the `CREATE TRIGGER` statement.

## Verification
- Checked other migration files for similar issues. `003_add_comment_priority.sql` already includes `DROP TRIGGER IF EXISTS`, so it is safe.
- The migration script `backend/migrations/run.js` runs all SQL files, so making them idempotent is the correct approach.
