import axios from 'axios';

export async function getAlerts() {
  const res = await axios.get('/api/alerts');
  return res.data;
}

export async function createAlert(alert) {
  await axios.post('/api/alerts', alert);
}

export async function updateAlert(id, alert) {
  await axios.put(`/api/alerts/${id}`, alert);
}

export async function deleteAlert(id) {
  await axios.delete(`/api/alerts/${id}`);
}
