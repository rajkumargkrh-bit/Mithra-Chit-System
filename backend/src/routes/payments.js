const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

function genReceiptNumber() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `RC-${n}`;
}

// GET /api/payments — list, with optional filters
router.get('/', requireAuth, async (req, res) => {
  const { member_id, chit_group_id, status, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === 'CUSTOMER') {
    params.push(req.user.memberId);
    conditions.push(`member_id = $${params.length}`);
  } else if (member_id) {
    params.push(member_id);
    conditions.push(`member_id = $${params.length}`);
  }
  if (chit_group_id) { params.push(chit_group_id); conditions.push(`chit_group_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const { rows } = await db.query(
    `SELECT * FROM payments ${where} ORDER BY payment_date DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ payments: rows });
});

// POST /api/payments — record a payment
router.post('/', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT'), async (req, res) => {
  const { member_id, chit_group_id, installment_id, amount, payment_method, transaction_reference } = req.body;
  if (!member_id || !chit_group_id || !amount || !payment_method) {
    return res.status(400).json({ error: 'member_id, chit_group_id, amount and payment_method are required' });
  }

  const receiptNumber = genReceiptNumber();
  const { rows } = await db.query(
    `INSERT INTO payments (member_id, chit_group_id, installment_id, amount, payment_method, transaction_reference, status, receipt_number)
     VALUES ($1,$2,$3,$4,$5,$6,'PAID',$7) RETURNING *`,
    [member_id, chit_group_id, installment_id || null, amount, payment_method, transaction_reference || null, receiptNumber]
  );

  if (installment_id) {
    await db.query(`UPDATE installments SET status = 'PAID' WHERE id = $1`, [installment_id]);
  }

  await db.query(
    `INSERT INTO cash_transactions (type, category, amount, reference, description, created_by)
     VALUES ('INCOME','Chit installment',$1,$2,'Payment recorded',$3)`,
    [amount, receiptNumber, req.user.id]
  );

  await logAudit({ actorUserId: req.user.id, action: 'PAYMENT_RECORDED', entityType: 'payment', entityId: rows[0].id, newValue: rows[0], ip: req.ip });
  res.status(201).json({ payment: rows[0] });
});

// GET /api/payments/:id/receipt — receipt details for printing/download
router.get('/:id/receipt', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, m.name AS member_name, m.member_code FROM payments p
     JOIN members m ON m.id = p.member_id
     WHERE p.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Payment not found' });
  res.json({ receipt: rows[0] });
});

module.exports = router;
