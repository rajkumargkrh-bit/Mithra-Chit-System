const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

function genGroupCode() {
  const n = Math.floor(100 + Math.random() * 900);
  return `CHIT-${n}`;
}

// GET /api/chits — list chit plans with their groups summarized
router.get('/', requireAuth, async (req, res) => {
  const { type, status } = req.query;
  const conditions = [];
  const params = [];
  if (type) { params.push(type); conditions.push(`type = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query(`SELECT * FROM chit_plans ${where} ORDER BY created_at DESC`, params);
  res.json({ chits: rows });
});

// POST /api/chits — create a chit plan
router.post('/', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { name, chit_value, max_bid, duration_months, start_date, type } = req.body;
  if (!name || !chit_value || !duration_months || !start_date || !type) {
    return res.status(400).json({ error: 'name, chit_value, duration_months, start_date and type are required' });
  }

  const { rows } = await db.query(
    `INSERT INTO chit_plans (name, chit_value, max_bid, duration_months, start_date, type, status)
     VALUES ($1,$2,$3,$4,$5,$6,'DRAFT') RETURNING *`,
    [name, chit_value, max_bid || null, duration_months, start_date, type]
  );

  await logAudit({ actorUserId: req.user.id, action: 'CHIT_PLAN_CREATED', entityType: 'chit_plan', entityId: rows[0].id, newValue: rows[0], ip: req.ip });
  res.status(201).json({ chit: rows[0] });
});

// GET /api/chits/:id
router.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM chit_plans WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Chit plan not found' });
  res.json({ chit: rows[0] });
});

// PUT /api/chits/:id
router.put('/:id', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { rows: existing } = await db.query(`SELECT * FROM chit_plans WHERE id = $1`, [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Chit plan not found' });

  const fields = ['name', 'chit_value', 'max_bid', 'duration_months', 'start_date', 'type', 'status'];
  const updates = [];
  const params = [];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) { params.push(req.body[f]); updates.push(`${f} = $${params.length}`); }
  });
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);

  const { rows } = await db.query(`UPDATE chit_plans SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  await logAudit({ actorUserId: req.user.id, action: 'CHIT_PLAN_UPDATED', entityType: 'chit_plan', entityId: req.params.id, oldValue: existing[0], newValue: rows[0], ip: req.ip });
  res.json({ chit: rows[0] });
});

// PATCH /api/chits/:id/rename
router.patch('/:id/rename', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows } = await db.query(`UPDATE chit_plans SET name = $1 WHERE id = $2 RETURNING *`, [name, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Chit plan not found' });
  res.json({ chit: rows[0] });
});

// DELETE /api/chits/:id
router.delete('/:id', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req, res) => {
  const { rows } = await db.query(`DELETE FROM chit_plans WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Chit plan not found' });
  res.json({ message: 'Chit plan deleted' });
});

// POST /api/chits/:id/groups — create a group under a chit plan
router.post('/:id/groups', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { total_slots } = req.body;
  if (!total_slots) return res.status(400).json({ error: 'total_slots is required' });

  const groupCode = genGroupCode();
  const { rows } = await db.query(
    `INSERT INTO chit_groups (chit_plan_id, group_code, total_slots) VALUES ($1,$2,$3) RETURNING *`,
    [req.params.id, groupCode, total_slots]
  );
  res.status(201).json({ group: rows[0] });
});

// GET /api/chits/:id/groups
router.get('/:id/groups', requireAuth, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM chit_groups WHERE chit_plan_id = $1`, [req.params.id]);
  res.json({ groups: rows });
});

// POST /api/groups/:id/members — add a member to a group slot
router.post('/groups/:id/members', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { member_id, slot_number } = req.body;
  if (!member_id || !slot_number) return res.status(400).json({ error: 'member_id and slot_number are required' });

  const { rows } = await db.query(
    `INSERT INTO chit_members (chit_group_id, member_id, slot_number) VALUES ($1,$2,$3) RETURNING *`,
    [req.params.id, member_id, slot_number]
  );
  await db.query(`UPDATE chit_groups SET filled_slots = filled_slots + 1 WHERE id = $1`, [req.params.id]);
  res.status(201).json({ chitMember: rows[0] });
});

// DELETE /api/groups/:id/members/:memberId
router.delete('/groups/:id/members/:memberId', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { rows } = await db.query(
    `DELETE FROM chit_members WHERE chit_group_id = $1 AND member_id = $2 RETURNING *`,
    [req.params.id, req.params.memberId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Member not found in this group' });
  await db.query(`UPDATE chit_groups SET filled_slots = GREATEST(filled_slots - 1, 0) WHERE id = $1`, [req.params.id]);
  res.json({ message: 'Member removed from group' });
});

// GET /api/groups/:id/vacancies
router.get('/groups/:id/vacancies', requireAuth, async (req, res) => {
  const { rows } = await db.query(`SELECT total_slots, filled_slots, vacant_slots FROM chit_groups WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Group not found' });
  res.json(rows[0]);
});

module.exports = router;
