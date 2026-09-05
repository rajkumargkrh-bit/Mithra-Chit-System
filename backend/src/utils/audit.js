const db = require('../db');

async function logAudit({ actorUserId, action, entityType, entityId, oldValue, newValue, ip }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actorUserId || null, action, entityType || null, entityId || null,
       oldValue ? JSON.stringify(oldValue) : null,
       newValue ? JSON.stringify(newValue) : null,
       ip || null]
    );
  } catch (err) {
    console.error('Failed to write audit log', err.message);
  }
}

module.exports = { logAudit };
