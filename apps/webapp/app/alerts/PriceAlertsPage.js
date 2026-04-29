// app/frontend/src/pages/alerts/PriceAlertsPage.js
import React, { useState, useEffect } from 'react';
import { getAlerts, createAlert, updateAlert, deleteAlert } from '../../services/priceAlertService';

function PriceAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [newAlert, setNewAlert] = useState({ asset: '', targetPrice: '', direction: 'above' });

  useEffect(() => {
    getAlerts().then(setAlerts);
  }, []);

  const handleCreate = async () => {
    await createAlert(newAlert);
    setAlerts(await getAlerts());
    setNewAlert({ asset: '', targetPrice: '', direction: 'above' });
  };

  const handleUpdate = async (id, updated) => {
    await updateAlert(id, updated);
    setAlerts(await getAlerts());
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this alert?')) {
      await deleteAlert(id);
      setAlerts(await getAlerts());
    }
  };

  return (
    <div>
      <h2>Price Alerts</h2>
      <div>
        <input placeholder="Asset (e.g. XLM)" value={newAlert.asset} onChange={e => setNewAlert({ ...newAlert, asset: e.target.value })} />
        <input placeholder="Target Price" value={newAlert.targetPrice} onChange={e => setNewAlert({ ...newAlert, targetPrice: e.target.value })} />
        <select value={newAlert.direction} onChange={e => setNewAlert({ ...newAlert, direction: e.target.value })}>
          <option value="above">Above</option>
          <option value="below">Below</option>
        </select>
        <button onClick={handleCreate}>Create Alert</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Target Price</th>
            <th>Direction</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map(a => (
            <tr key={a.id}>
              <td>{a.asset}</td>
              <td>{a.targetPrice}</td>
              <td>{a.direction}</td>
              <td>{a.createdAt}</td>
              <td>
                <button onClick={() => handleUpdate(a.id, { ...a, targetPrice: prompt('New price:', a.targetPrice) })}>Edit</button>
                <button onClick={() => handleDelete(a.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PriceAlertsPage;
