import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/firebase/firebase';
import { useAuth } from '@/context/AuthContext';

export interface NotificationItem { id?: string; type?: string; recipientId?: string; callerId?: string; reunionId?: string; invitationId?: string; createdAt?: unknown; read?: boolean; viewed?: boolean; [key: string]: unknown }

export const useNotifications = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    if (!user?.uid) {
      setNotifications([]);
      return;
    }
    const q = query(collection(db, 'notifications'), where('recipientId', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...(d.data() as NotificationItem) } as NotificationItem)));
    });
    return () => unsub();
  }, [user]);

  return { notifications };
};
