import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarDays, ChevronRight, History, Home, LogOut,
  MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Settings, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useState } from 'react';
import { toast } from 'sonner';
import MeetAppLogo from '@/components/MeetAppLogo';

const menuItems = [
  { icon: Home, label: 'Tableau de bord', path: '/dashboard' },
  { icon: Users, label: 'Contacts', path: '/contacts' },
  { icon: CalendarDays, label: 'Réunions', path: '/invitations' },
  { icon: MessageSquare, label: 'Messages', path: '/messages' },
  { icon: History, label: 'Historique', path: '/calls' },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export const Sidebar = ({ open, onClose }: SidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [collapsedPreference, setCollapsedPreference] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('sidebarCollapsed') === 'true'
  );
  const isCollapsed = collapsedPreference && !open;
  const isActive = (path: string) => location.pathname === path;
  const initials = (user?.displayName || user?.email || 'U')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const toggle = () => {
    setCollapsedPreference((current) => {
      localStorage.setItem('sidebarCollapsed', String(!current));
      return !current;
    });
  };
  const handleSidebarButton = () => {
    if (window.matchMedia('(min-width: 768px)').matches) toggle();
    else onClose();
  };

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout();
      toast.success('Déconnexion réussie');
      navigate('/login');
    } catch {
      toast.error('Erreur lors de la déconnexion');
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden" onClick={onClose} />}
      <aside
        className={`dashboard-sidebar-shell landing-page fixed inset-y-3 left-3 z-50 flex overflow-hidden rounded-[1.6rem] p-1.5 transition-[width,transform] duration-300 ease-in-out md:static md:m-3 md:h-[calc(100dvh-1.5rem)] md:shrink-0 md:translate-x-0 ${open ? 'translate-x-0 w-[min(92vw,364px)]' : '-translate-x-[120%] w-[min(92vw,364px)]'} ${isCollapsed ? 'md:w-[80px]' : 'md:w-[364px]'}`}
      >
        <div className="dashboard-sidebar-rail flex h-full w-[64px] shrink-0 flex-col items-center rounded-[1.2rem] py-3 text-white">
          <Link to="/dashboard" title="MeetApp" onClick={onClose} className="mb-5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <MeetAppLogo />
          </Link>
          <nav aria-label="Navigation principale" className="flex w-full flex-1 flex-col items-center gap-2 px-2">
            {menuItems.map(({ icon: Icon, label, path }) => (
              <Link
                key={path}
                to={path}
                onClick={onClose}
                title={label}
                aria-label={label}
                aria-current={isActive(path) ? 'page' : undefined}
                className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-200 ${isActive(path) ? 'bg-lime-200 text-neutral-950 shadow-md shadow-lime-900/10' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex w-full flex-col items-center gap-2 border-t border-white/10 px-2 pt-3">
            <Link to="/settings" onClick={onClose} title="Paramètres" aria-label="Paramètres" className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${isActive('/settings') ? 'bg-white text-neutral-950' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>
              <Settings className="h-[18px] w-[18px]" />
            </Link>
            <button
              type="button"
              onClick={handleSidebarButton}
              title={isCollapsed ? 'Agrandir la barre latérale' : 'Réduire la barre latérale'}
              aria-label={isCollapsed ? 'Agrandir la barre latérale' : open ? 'Fermer la navigation' : 'Réduire la barre latérale'}
              aria-expanded={!isCollapsed}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 transition-colors hover:bg-white/10 hover:text-white"
            >
              {isCollapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              title="Déconnexion"
              aria-label="Déconnexion"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 transition-colors hover:bg-red-500/15 hover:text-red-200 disabled:opacity-50"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <div className={`flex min-w-0 flex-col overflow-hidden transition-[width,opacity,transform] duration-300 ease-in-out ${isCollapsed ? 'w-0 translate-x-2 opacity-0' : 'min-w-0 flex-1 translate-x-0 opacity-100'}`} aria-hidden={isCollapsed}>
          <div className="flex h-[58px] shrink-0 items-center justify-between gap-3 px-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">Espace de travail</p>
              <p className="truncate text-[10px] uppercase tracking-[0.16em] text-muted-foreground">MeetApp</p>
            </div>
          </div>

          <div className="dashboard-sidebar-user mx-3 flex shrink-0 items-center gap-3 rounded-2xl p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-sm font-bold text-white ring-2 ring-primary/15">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user?.displayName || 'Utilisateur'}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email || 'Compte MeetApp'}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          </div>

          <div className="px-3 pt-4">
            <Link to="/invitations/new" title="Nouvelle réunion" onClick={onClose} className="block">
              <Button className="h-10 w-full justify-start gap-2 rounded-xl text-sm font-semibold shadow-sm shadow-primary/15">
                <Plus className="h-4 w-4" />
                Nouvelle réunion
              </Button>
            </Link>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-5">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">Projets</p>
            <nav aria-label="Espace de travail" className="space-y-1">
              {menuItems.slice(0, 4).map(({ icon: Icon, label, path }) => (
                <Link
                  key={path}
                  to={path}
                  onClick={onClose}
                  aria-current={isActive(path) ? 'page' : undefined}
                  className={`flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-200 ${isActive(path) ? 'bg-primary/10 text-primary ring-1 ring-primary/15' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                  {isActive(path) && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </Link>
              ))}
            </nav>

            <div className="my-4 border-t border-border/70" />
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">Historique</p>
            <Link
              to="/calls"
              onClick={onClose}
              aria-current={isActive('/calls') ? 'page' : undefined}
              className={`flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-200 ${isActive('/calls') ? 'bg-primary/10 text-primary ring-1 ring-primary/15' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <History className="h-4 w-4 shrink-0" />
              <span className="truncate">Appels récents</span>
            </Link>
          </div>

          <div className="shrink-0 border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Espace personnel</span>
          </div>
        </div>
      </aside>
    </>
  );
};
