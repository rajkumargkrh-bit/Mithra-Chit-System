const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// GET /api/payouts
router.get('/', requireAuth, async (req, res) => {
  const { status } = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === 'CUSTOMER') {
    params.push(req.user.memberId);
    conditions.push(`p.member_id = $${params.length}`);
  }
  if (status) { params.push(status); conditions.push(`p.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT p.*, m.name AS member_name FROM payouts p
     JOIN members m ON m.id = p.member_id
     ${where}
     ORDER BY p.id DESC`,
    params
  );
  res.json({ payouts: rows });
});

// POST /api/payout-accounts — add a bank/UPI account for a member
router.post('/accounts', requireAuth, async (req, res) => {
  const { member_id, account_name, bank_name, account_number, ifsc, upi_id, is_primary } = req.body;
  const targetMemberId = req.user.role === 'CUSTOMER' ? req.user.memberId : member_id;
  if (!targetMemberId) return res.status(400).json({ error: 'member_id is required' });

  if (is_primary) {
    await db.query(`UPDATE payout_accounts SET is_primary = FALSE WHERE member_id = $1`, [targetMemberId]);
  }

  const { rows } = await db.query(
    `INSERT INTO payout_accounts (member_id, account_name, bank_name, account_number, ifsc, upi_id, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [targetMemberId, account_name, bank_name, account_number, ifsc, upi_id, !!is_primary]
  );
  res.status(201).json({ account: rows[0] });
});

// POST /api/payouts/:id/approve — Manager/Admin approves a pending payout
router.post('/:id/approve', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { account_id } = req.body;
  const { rows } = await db.query(
    `UPDATE payouts SET status = 'PROCESSING', account_id = COALESCE($1, account_id) WHERE id = $2 RETURNING *`,
    [account_id || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Payout not found' });
  await logAudit({ actorUserId: req.user.id, action: 'PAYOUT_APPROVED', entityType: 'payout', entityId: req.params.id, newValue: rows[0], ip: req.ip });
  res.json({ payout: rows[0] });
});

// POST /api/payouts/:id/complete — mark as paid with a transaction reference
router.post('/:id/complete', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), async (req, res) => {
  const { payment_reference } = req.body;
  if (!payment_reference) return res.status(400).json({ error: 'payment_reference is required' });

  const { rows } = await db.query(
    `UPDATE payouts SET status = 'PAID', payment_reference = $1, paid_date = now() WHERE id = $2 RETURNING *`,
    [payment_reference, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Payout not found' });

  await db.query(
    `INSERT INTO cash_transactions (type, category, amount, reference, description, created_by)
     VALUES ('PAYOUT','Auction payout',$1,$2,'Payout completed',$3)`,
    [rows[0].amount, payment_reference, req.user.id]
  );

  await logAudit({ actorUserId: req.user.id, action: 'PAYOUT_COMPLETED', entityType: 'payout', entityId: req.params.id, newValue: rows[0], ip: req.ip });
  res.json({ payout: rows[0] });
});

// POST /api/payouts/:id/fail — mark a payout as failed
router.post('/:id/fail', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), async (req, res) => {
  const { reason } = req.body;
  const { rows } = await db.query(`UPDATE payouts SET status = 'FAILED' WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Payout not found' });
  await logAudit({ actorUserId: req.user.id, action: 'PAYOUT_FAILED', entityType: 'payout', entityId: req.params.id, newValue: { reason }, ip: req.ip });
  res.json({ payout: rows[0] });
});

module.exports = router;
