const service = require('../src/services/price_alerts_service');

describe('Price Alerts Service', () => {
  it('creates a new alert', async () => {
    await service.createAlert('user1', { asset: 'XLM', targetPrice: 0.5, direction: 'above' });
    const alerts = await service.listAlerts('user1');
    expect(alerts.some(a => a.asset === 'XLM')).toBe(true);
  });

  it('updates an alert', async () => {
    const alerts = await service.listAlerts('user1');
    const id = alerts[0].id;
    await service.updateAlert('user1', id, { targetPrice: 0.6, direction: 'below' });
    const updated = await service.listAlerts('user1');
    expect(updated.find(a => a.id === id).target_price).toBe(0.6);
  });

  it('deletes an alert', async () => {
    const alerts = await service.listAlerts('user1');
    const id = alerts[0].id;
    await service.deleteAlert('user1', id);
    const updated = await service.listAlerts('user1');
    expect(updated.find(a => a.id === id)).toBeUndefined();
  });
});
