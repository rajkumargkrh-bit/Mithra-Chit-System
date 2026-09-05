require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

async function main() {
  const [name, mobile, password, role] = process.argv.slice(2);
  if (!name || !mobile || !password) {
    console.log('Usage: node src/scripts/createAdmin.js "Full Name" 9999999999 YourPassword [ROLE]');
    console.log('ROLE defaults to SUPER_ADMIN. Allowed: SUPER_ADMIN, ADMIN, MANAGER, STAFF, ACCOUNTANT');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const finalRole = role || 'SUPER_ADMIN';

  const { rows } = await db.query(
    `INSERT INTO users (name, mobile, password_hash, role, status)
     VALUES ($1,$2,$3,$4,'ACTIVE')
     ON CONFLICT (mobile) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
     RETURNING id, name, mobile, role`,
    [name, mobile, hash, finalRole]
  );

  console.log('Admin user ready:', rows[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
