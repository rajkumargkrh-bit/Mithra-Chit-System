const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { logAudit } = require('../utils/audit');

const router = express.Router();

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

// POST /api/auth/admin/login
router.post('/admin/login', async (req, res) => {
  const { mobile, password } = req.body;
  if (!mobile || !password) {
    return res.status(400).json({ error: 'Mobile and password are required' });
  }

  const { rows } = await db.query(
    `SELECT * FROM users WHERE mobile = $1 AND role != 'CUSTOMER'`,
    [mobile]
  );
  const user = rows[0];
  if (!user || user.status !== 'ACTIVE') {
    return res.status(401).json({ error: 'Invalid mobile or password' });
  }

  const ok = await bcrypt.compare(password, user.password_hash || '');
  if (!ok) return res.status(401).json({ error: 'Invalid mobile or password' });

  const token = signToken({ id: user.id, role: user.role, mobile: user.mobile, name: user.name });
  await logAudit({ actorUserId: user.id, action: 'ADMIN_LOGIN', entityType: 'user', entityId: user.id, ip: req.ip });

  res.json({ token, user: { id: user.id, name: user.name, role: user.role, mobile: user.mobile } });
});

// In-memory OTP store fallback is avoided; OTPs are persisted in otp_codes table.
// In production, plug an SMS/WhatsApp provider into sendOtp() below.
async function sendOtp(mobile, code) {
  // TODO: integrate WhatsApp Business API / SMS gateway here.
  console.log(`[OTP] Sending code ${code} to ${mobile}`);
}

// POST /api/auth/customer/send-otp
router.post('/customer/send-otp', async (req, res) => {
  const { mobile } = req.body;
  if (!mobile) return res.status(400).json({ error: 'Mobile number is required' });

  const { rows } = await db.query(`SELECT * FROM members WHERE mobile = $1`, [mobile]);
  if (!rows[0]) return res.status(404).json({ error: 'No member found with this mobile number' });

  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + (Number(process.env.OTP_EXPIRY_MINUTES || 5) * 60 * 1000));

  await db.query(
    `INSERT INTO otp_codes (mobile, code, expires_at) VALUES ($1,$2,$3)`,
    [mobile, code, expiresAt]
  );

  await sendOtp(mobile, code);
  res.json({ message: 'OTP sent', expiresInMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 5) });
});

// POST /api/auth/customer/verify-otp
router.post('/customer/verify-otp', async (req, res) => {
  const { mobile, code } = req.body;
  if (!mobile || !code) return res.status(400).json({ error: 'Mobile and code are required' });

  const { rows } = await db.query(
    `SELECT * FROM otp_codes WHERE mobile = $1 AND code = $2 AND consumed = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [mobile, code]
  );
  const otp = rows[0];
  if (!otp) return res.status(401).json({ error: 'Invalid OTP' });
  if (new Date(otp.expires_at) < new Date()) return res.status(401).json({ error: 'OTP expired' });

  await db.query(`UPDATE otp_codes SET consumed = TRUE WHERE id = $1`, [otp.id]);

  const { rows: memberRows } = await db.query(`SELECT * FROM members WHERE mobile = $1`, [mobile]);
  const member = memberRows[0];
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const token = signToken({ id: member.user_id, memberId: member.id, role: 'CUSTOMER', mobile: member.mobile, name: member.name });
  res.json({ token, member: { id: member.id, name: member.name, memberCode: member.member_code } });
});

// POST /api/auth/logout — stateless JWT: client just discards the token.
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out' });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    delete payload.iat;
    delete payload.exp;
    const fresh = signToken(payload);
    res.json({ token: fresh });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /api/auth/forgot-password — admin/staff password reset (email link flow to be wired to a mailer)
router.post('/forgot-password', async (req, res) => {
  const { mobile } = req.body;
  const { rows } = await db.query(`SELECT id, email FROM users WHERE mobile = $1`, [mobile]);
  if (!rows[0]) return res.json({ message: 'If the account exists, a reset link has been sent' });
  // TODO: generate a reset token, email it via a mail provider.
  res.json({ message: 'If the account exists, a reset link has been sent' });
});

module.exports = router;
