import { Bell, Menu, Moon, Search, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { db } from '@/firebase/firebase';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { toast } from 'sonner';

type NotificationDoc = { type: string; userName?: string };

interface HeaderProps {
  onMenuClick: () => void;
}

const pageTitles: Array<[string, string]> = [
  ['/dashboard', 'Tableau de bord'],
  ['/invitations/new', 'Nouvelle réunion'],
  ['/invitations', 'Réunions'],
  ['/contacts/new', 'Nouveau contact'],
  ['/contacts', 'Contacts'],
  ['/messages', 'Messages'],
  ['/calls', 'Historique des appels'],
  ['/settings', 'Paramètres'],
];

export const Header = ({ onMenuClick }: HeaderProps) => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'dark') return true;
    if (storedTheme === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  const [search, setSearch] = useState('');
  const pageTitle = pageTitles.find(([path]) => pathname === path || (path !== '/dashboard' && pathname.startsWith(`${path}/`)))?.[1] || 'MeetApp';
  const initials = (user?.displayName || user?.email || 'U')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  useEffect(() => {
    if (!user?.uid) return;
    const notificationsQuery = query(collection(db, 'notifications'), where('recipientId', '==', user.uid), where('read', '==', false));
    const unsubscribe = onSnapshot(notificationsQuery, async (snapshot) => {
      const newNotificationIds: string[] = [];
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const notification = change.doc.data() as NotificationDoc;
        const name = notification.userName || 'Un utilisateur';
        if (notification.type === 'invitation_accepted') toast.success(`${name} a accepté votre invitation`, { duration: 4000 });
        else if (notification.type === 'invitation_declined') toast.error(`${name} a refusé votre invitation`, { duration: 4000 });
        newNotificationIds.push(change.doc.id);
      });
      await Promise.all(newNotificationIds.map((id) => updateDoc(doc(db, 'notifications', id), { read: true }).catch(() => undefined)));
    });
    return unsubscribe;
  }, [user?.uid]);

  return (
    <header className="dashboard-header landing-page sticky top-0 z-30 flex h-[76px] shrink-0 items-center justify-between gap-4 px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-xl md:hidden" onClick={onMenuClick} aria-label="Ouvrir le menu">
          <Menu className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <p className="hidden text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:block">Espace personnel</p>
          <h1 className="truncate text-base font-bold tracking-tight md:text-lg">{pageTitle}</h1>
        </div>
      </div>

      <div className="hidden h-10 w-full max-w-[300px] items-center gap-2.5 rounded-xl border border-border/70 bg-card/80 px-3 transition-all focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 lg:flex">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          placeholder="Rechercher..."
          aria-label="Rechercher"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘ K</kbd>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setIsDark((current) => !current)} aria-label={isDark ? 'Passer au thème clair' : 'Passer au thème sombre'}>
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-xl" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
        </Button>
        <div className="ml-1 flex items-center gap-2.5 border-l border-border/70 pl-3 sm:ml-2 sm:pl-4">
          <div className="hidden text-right sm:block">
            <p className="max-w-[150px] truncate text-xs font-semibold leading-none">{user?.displayName || 'Utilisateur'}</p>
            <p className="mt-1 max-w-[150px] truncate text-[11px] text-muted-foreground">{user?.email || ''}</p>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-xs font-bold text-white ring-2 ring-primary/15">
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
};
