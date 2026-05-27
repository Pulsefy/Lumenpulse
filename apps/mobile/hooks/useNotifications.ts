import { useEffect, useState } from "react";
import axios from "@/lib/api";

export interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export const useNotifications = () => {
  const [data, setData] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    try {
      const res = await axios.get("/notifications");
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await axios.patch(`/notifications/${id}/read`);
      setData((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  return { data, loading, markAsRead, refetch: fetchNotifications };
};
