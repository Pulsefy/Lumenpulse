import axios from 'axios';
import { getEnvironmentConfig } from './config';

export async function getNotifications(p0: string) {
  try {
    const response = await axios.get(`${getEnvironmentConfig().apiBaseUrl}/notifications`);
    return response.data; // adjust based on your API response shape
  } catch (err) {
    console.error('Failed to fetch notifications', err);
    return [];
  }
}

export async function markAsRead(id: number) {
  try {
    await axios.post(`${getEnvironmentConfig().apiBaseUrl}/notifications/${id}/read`);
    return true;
  } catch (err) {
    console.error('Failed to mark notification as read', err);
    return false;
  }
}
