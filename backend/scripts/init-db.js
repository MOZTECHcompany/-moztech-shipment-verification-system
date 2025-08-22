const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: __dirname + '/../.env' });

async function run() {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query(`
			CREATE TABLE IF NOT EXISTS users (
				id SERIAL PRIMARY KEY,
				username TEXT UNIQUE NOT NULL,
				password_hash TEXT NOT NULL,
				name TEXT NOT NULL,
				role TEXT NOT NULL DEFAULT 'user',
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			);

			CREATE TABLE IF NOT EXISTS orders (
				id SERIAL PRIMARY KEY,
				voucher_number TEXT UNIQUE NOT NULL,
				customer_name TEXT,
				warehouse TEXT,
				order_status TEXT NOT NULL DEFAULT 'pending',
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			);

			CREATE TABLE IF NOT EXISTS order_items (
				id SERIAL PRIMARY KEY,
				order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
				product_code TEXT NOT NULL,
				product_name TEXT,
				quantity INTEGER NOT NULL,
				picked_quantity INTEGER NOT NULL DEFAULT 0,
				packed_quantity INTEGER NOT NULL DEFAULT 0
			);

			CREATE TABLE IF NOT EXISTS action_logs (
				id SERIAL PRIMARY KEY,
				order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
				order_item_id INTEGER REFERENCES order_items(id) ON DELETE CASCADE,
				user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
				action_type TEXT NOT NULL,
				quantity_change INTEGER NOT NULL,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			);

			CREATE TABLE IF NOT EXISTS error_logs (
				id SERIAL PRIMARY KEY,
				order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
				user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
				error_type TEXT NOT NULL,
				scanned_barcode TEXT,
				context JSONB,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
			);
		`);

		const adminUser = 'admin';
		const adminPass = 'admin123';
		const adminName = 'Administrator';
		const hash = await bcrypt.hash(adminPass, 10);
		await client.query(
			`INSERT INTO users (username, password_hash, name, role)
			 SELECT $1, $2, $3, 'admin'
			 WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = $1)`,
			[adminUser, hash, adminName]
		);

		await client.query('COMMIT');
		console.log('Database initialized. Admin user: admin / admin123');
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('Init failed:', err);
		process.exitCode = 1;
	} finally {
		client.release();
		await pool.end();
	}
}

run();