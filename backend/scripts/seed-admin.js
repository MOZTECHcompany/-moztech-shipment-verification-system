#!/usr/bin/env node

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || '系統管理員';
  const role = 'admin';

  if (!process.env.DATABASE_URL) {
    console.error('請設定 DATABASE_URL 環境變數');
    process.exit(1);
  }
  if (!password) {
    console.error('請設定 ADMIN_PASSWORD 環境變數');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role, name) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING",
      [username, passwordHash, role, name]
    );
    console.log(`管理員使用者已建立或已存在：${username}`);
  } catch (e) {
    console.error('建立管理員失敗：', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();