const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/dues — outstanding installments, with filters
router.get('/', requireAuth, async (req, res) => {
  const { group_id, overdueOnly } = req.query;
  const conditions = [`i.status IN ('PENDING','PARTIAL','OVERDUE')`];
  const params = [];

  if (req.user.role === 'CUSTOMER') {
    params.push(req.user.memberId);
    conditions.push(`cm.member_id = $${params.length}`);
  }
  if (group_id) { params.push(group_id); conditions.push(`cm.chit_group_id = $${params.length}`); }
  if (overdueOnly === 'true') { conditions.push(`i.due_date < CURRENT_DATE`); }

  const { rows } = await db.query(
    `SELECT i.*, m.name AS member_name, m.mobile, cg.group_code
     FROM installments i
     JOIN chit_members cm ON cm.id = i.chit_member_id
     JOIN members m ON m.id = cm.member_id
     JOIN chit_groups cg ON cg.id = cm.chit_group_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY i.due_date ASC`,
    params
  );
  res.json({ dues: rows });
});

// POST /api/dues/:installmentId/remind — trigger a reminder (wire to WhatsApp/SMS provider)
router.post('/:installmentId/remind', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT i.*, m.mobile, m.whatsapp, m.name FROM installments i
     JOIN chit_members cm ON cm.id = i.chit_member_id
     JOIN members m ON m.id = cm.member_id
     WHERE i.id = $1`,
    [req.params.installmentId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Installment not found' });

  // TODO: integrate WhatsApp Business API / SMS gateway to actually send the reminder.
  console.log(`[REMINDER] Due reminder for ${rows[0].name} (${rows[0].mobile}) — amount ${rows[0].total_amount}`);
  res.json({ message: 'Reminder sent' });
});

module.exports = router;
