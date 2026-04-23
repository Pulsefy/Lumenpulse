const express = require('express');
const router = express.Router();
const service = require('../services/price_alerts_service');

router.get('/api/alerts', async (req, res) => {
  res.json(await service.listAlerts(req.user.id));
});

router.post('/api/alerts', async (req, res) => {
  await service.createAlert(req.user.id, req.body);
  res.json({ success: true });
});

router.put('/api/alerts/:id', async (req, res) => {
  await service.updateAlert(req.user.id, req.params.id, req.body);
  res.json({ success: true });
});

router.delete('/api/alerts/:id', async (req, res) => {
  await service.deleteAlert(req.user.id, req.params.id);
  res.json({ success: true });
});

module.exports = router;
