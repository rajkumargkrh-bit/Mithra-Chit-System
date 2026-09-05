const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

function genMemberCode() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `MEM-${n}`;
}

// GET /api/members
router.get('/', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT'), async (req, res) => {
  const { search, status, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(name ILIKE $${params.length} OR mobile ILIKE $${params.length} OR member_code ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const { rows } = await db.query(
    `SELECT * FROM members ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ members: rows });
});

// POST /api/members
router.post('/', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { name, mobile, whatsapp, email, address, id_type, id_number, nominee_name, nominee_mobile } = req.body;
  if (!name || !mobile) return res.status(400).json({ error: 'Name and mobile are required' });

  const memberCode = genMemberCode();
  const { rows } = await db.query(
    `INSERT INTO members (member_code, name, mobile, whatsapp, email, address, id_type, id_number, nominee_name, nominee_mobile)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [memberCode, name, mobile, whatsapp, email, address, id_type, id_number, nominee_name, nominee_mobile]
  );

  await logAudit({ actorUserId: req.user.id, action: 'MEMBER_CREATED', entityType: 'member', entityId: rows[0].id, newValue: rows[0], ip: req.ip });
  res.status(201).json({ member: rows[0] });
});

// GET /api/members/:id
router.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM members WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Member not found' });
  res.json({ member: rows[0] });
});

// PUT /api/members/:id
router.put('/:id', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { rows: existingRows } = await db.query(`SELECT * FROM members WHERE id = $1`, [req.params.id]);
  if (!existingRows[0]) return res.status(404).json({ error: 'Member not found' });

  const fields = ['name', 'mobile', 'whatsapp', 'email', 'address', 'id_type', 'id_number', 'nominee_name', 'nominee_mobile', 'status'];
  const updates = [];
  const params = [];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) {
      params.push(req.body[f]);
      updates.push(`${f} = $${params.length}`);
    }
  });
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE members SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );

  await logAudit({ actorUserId: req.user.id, action: 'MEMBER_UPDATED', entityType: 'member', entityId: req.params.id, oldValue: existingRows[0], newValue: rows[0], ip: req.ip });
  res.json({ member: rows[0] });
});

// DELETE /api/members/:id
router.delete('/:id', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req, res) => {
  const { rows } = await db.query(`DELETE FROM members WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Member not found' });
  await logAudit({ actorUserId: req.user.id, action: 'MEMBER_DELETED', entityType: 'member', entityId: req.params.id, oldValue: rows[0], ip: req.ip });
  res.json({ message: 'Member deleted' });
});

// GET /api/members/:id/chits
router.get('/:id/chits', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT cm.*, cg.group_code, cp.name AS chit_name, cp.chit_value
     FROM chit_members cm
     JOIN chit_groups cg ON cg.id = cm.chit_group_id
     JOIN chit_plans cp ON cp.id = cg.chit_plan_id
     WHERE cm.member_id = $1`,
    [req.params.id]
  );
  res.json({ chits: rows });
});

// GET /api/members/:id/payments
router.get('/:id/payments', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM payments WHERE member_id = $1 ORDER BY payment_date DESC`,
    [req.params.id]
  );
  res.json({ payments: rows });
});

module.exports = router;
