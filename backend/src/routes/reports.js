const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/reports/dashboard — the cards shown on the admin dashboard
router.get('/dashboard', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT'), async (req, res) => {
  const [chits, members, todayCollection, pendingDues, liveAuctions, pendingPayouts] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM chit_plans WHERE status != 'CANCELLED'`),
    db.query(`SELECT COUNT(*) FROM members WHERE status = 'ACTIVE'`),
    db.query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE payment_date::date = CURRENT_DATE`),
    db.query(`SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(DISTINCT chit_member_id) AS members FROM installments WHERE status IN ('PENDING','PARTIAL','OVERDUE')`),
    db.query(`SELECT COUNT(*) FROM auction_rounds WHERE status = 'LIVE'`),
    db.query(`SELECT COUNT(*) FROM payouts WHERE status IN ('PENDING','PROCESSING')`),
  ]);

  res.json({
    totalChits: Number(chits.rows[0].count),
    totalMembers: Number(members.rows[0].count),
    todaysCollection: Number(todayCollection.rows[0].total),
    pendingDues: Number(pendingDues.rows[0].total),
    pendingDueMembers: Number(pendingDues.rows[0].members),
    liveAuctions: Number(liveAuctions.rows[0].count),
    pendingPayouts: Number(pendingPayouts.rows[0].count),
  });
});

// GET /api/reports/cash-flow?from=&to=
router.get('/cash-flow', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'MANAGER'), async (req, res) => {
  const { from, to } = req.query;
  const params = [];
  let where = '';
  if (from && to) {
    params.push(from, to);
    where = `WHERE transaction_date::date BETWEEN $1 AND $2`;
  }

  const { rows } = await db.query(
    `SELECT type, COALESCE(SUM(amount),0) AS total FROM cash_transactions ${where} GROUP BY type`,
    params
  );
  res.json({ cashFlow: rows });
});

// GET /api/reports/dues-summary
router.get('/dues-summary', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'MANAGER'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT COUNT(DISTINCT chit_member_id) AS members, COALESCE(SUM(total_amount),0) AS total
     FROM installments WHERE status IN ('PENDING','PARTIAL','OVERDUE')`
  );
  res.json(rows[0]);
});

module.exports = router;
