const db = require('../db');

async function listAlerts(userId) {
  const res = await db.query('SELECT * FROM price_alerts WHERE user_id=$1', [userId]);
  return res.rows;
}

async function createAlert(userId, { asset, targetPrice, direction }) {
  await db.query(
    'INSERT INTO price_alerts (id, user_id, asset, target_price, direction, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())',
    [userId, asset, targetPrice, direction]
  );
}

async function updateAlert(userId, id, { targetPrice, direction }) {
  await db.query(
    'UPDATE price_alerts SET target_price=$1, direction=$2 WHERE id=$3 AND user_id=$4',
    [targetPrice, direction, id, userId]
  );
}

async function deleteAlert(userId, id) {
  await db.query('DELETE FROM price_alerts WHERE id=$1 AND user_id=$2', [id, userId]);
}

module.exports = { listAlerts, createAlert, updateAlert, deleteAlert };
