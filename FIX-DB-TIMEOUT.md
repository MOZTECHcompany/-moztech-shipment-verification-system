# Fix Database Connection Timeout

## Problem
The application was crashing with `Error: Connection terminated due to connection timeout` when accessing `/api/tasks`.
The logs indicated that the connection was timing out after 2 seconds, which is the configured `connectionTimeoutMillis`.

## Cause
The `connectionTimeoutMillis` in `backend/src/config/database.js` was set to `2000` (2 seconds). This is too short for a cloud environment like Render, especially when the database is under load or experiencing network latency, or when establishing a new SSL connection.

## Solution
Increased `connectionTimeoutMillis` to `10000` (10 seconds) to allow more time for the database connection to be established.

## Changes
- Modified `backend/src/config/database.js`:
    - Changed `connectionTimeoutMillis: 2000` to `connectionTimeoutMillis: 10000`.

## Verification
- This should prevent the "Connection terminated due to connection timeout" error unless the database is completely unreachable for more than 10 seconds.
