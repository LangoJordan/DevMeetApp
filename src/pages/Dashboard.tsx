import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, ArrowUpRight, CalendarDays, Clock3, Plus, Sparkles, Users, Video,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/firebase/firebase';
import { collection, query, where, getDocs, Timestamp, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { calculateMeetingDuration, formatDuration } from '@/utils/durationCalculator';

interface ReunionDoc { id: string; title?: string; creatorId?: string; status?: string; begin?: Timestamp | number | string | null; roomId?: string; roomUrl?: string }
interface InvitationDoc { id: string; reunionId?: string; contactId?: string; status?: string; debut?: Timestamp | number | string | null; dateFin?: Timestamp | number | string | null }

const toTs = (value: Timestamp | number | string | null | undefined): number => {
  if (!value) return 0;
  if (value instanceof Timestamp) return value.toDate().getTime();
  if (typeof value === 'number') return value;
  return new Date(String(value)).getTime();
};

const toLocale = (value: Timestamp | number | string | null | undefined) =>
  value ? (value instanceof Timestamp ? value.toDate() : new Date(String(value))).toLocaleDateString('fr-FR') : '—';

const Skeleton = ({ className }: { className: string }) => <div className={`animate-pulse rounded-xl bg-muted/60 ${className}`} />;

export default function Dashboard() {
  const { user } = useAuth();
  const [contactsCount, setContactsCount] = useState<number | null>(null);
  const [meetingsThisMonth, setMeetingsThisMonth] = useState<number | null>(null);
  const [totalMinutes, setTotalMinutes] = useState<number | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  type MeetingPreview = { id: string; title: string; begin?: Timestamp | number | string | null; roomId?: string | null; roomUrl?: string | null };
  type RecentCall = { id: string; contact: string; duration: string; date: string };

  const [upcomingMeetings, setUpcomingMeetings] = useState<MeetingPreview[]>([]);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);

  useEffect(() => {
    if (!user) return;
    setStatsLoading(true);

    const unsubscribeContacts = onSnapshot(
      query(collection(db, 'contacts'), where('creatorId', '==', user.uid)),
      (snapshot) => setContactsCount(snapshot.size),
      () => setContactsCount(0),
    );

    const unsubscribeMeetings = onSnapshot(
      query(collection(db, 'reunions'), where('creatorId', '==', user.uid)),
      async (snapshot) => {
        try {
          const created = snapshot.docs.map((document) => ({ id: document.id, ...(document.data() as ReunionDoc) }));
          const invitations = await getDocs(query(collection(db, 'invitations'), where('contactId', '==', user.uid)));
          const invitationIds = Array.from(new Set(invitations.docs.map((document) => String(document.data().reunionId || '')).filter(Boolean)));
          const invited: ReunionDoc[] = [];
          for (const reunionId of invitationIds) {
            if (created.some((reunion) => reunion.id === reunionId)) continue;
            const reunionSnapshot = await getDoc(doc(db, 'reunions', reunionId));
            if (reunionSnapshot.exists()) invited.push({ id: reunionSnapshot.id, ...(reunionSnapshot.data() as ReunionDoc) });
          }
          const meetings = [...created, ...invited];
          const now = Date.now();
          const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

          setMeetingsThisMonth(meetings.filter((reunion) => {
            const timestamp = toTs(reunion.begin);
            return timestamp >= firstOfMonth && timestamp <= now;
          }).length);
          setUpcomingMeetings(
            meetings.filter((reunion) => reunion.status !== 'completed' && toTs(reunion.begin) > now)
              .sort((a, b) => toTs(a.begin) - toTs(b.begin))
              .slice(0, 4)
              .map((reunion) => ({
                id: reunion.id,
                title: reunion.title || 'Réunion',
                begin: reunion.begin,
                roomId: reunion.roomId ?? null,
                roomUrl: reunion.roomUrl ?? null,
              })),
          );

          const completed = meetings.filter((reunion) => reunion.status === 'completed')
            .sort((a, b) => toTs(b.begin) - toTs(a.begin))
            .slice(0, 5);
          const calls = await Promise.all(completed.map(async (reunion) => {
            try {
              const callInvitations = await getDocs(query(
                collection(db, 'invitations'),
                where('reunionId', '==', reunion.id),
                where('callerId', '==', user.uid),
              ));
              let maxDuration = 0;
              callInvitations.docs.forEach((document) => {
                const invitation = document.data() as InvitationDoc;
                if (invitation.debut && invitation.dateFin) {
                  maxDuration = Math.max(maxDuration, (toTs(invitation.dateFin) - toTs(invitation.debut)) / 60000);
                }
              });
              return {
                id: reunion.id,
                contact: reunion.title || 'Réunion',
                duration: maxDuration > 0 ? formatDuration(Math.round(maxDuration)) : '—',
                date: toLocale(reunion.begin),
              };
            } catch {
              return { id: reunion.id, contact: reunion.title || 'Réunion', duration: '—', date: toLocale(reunion.begin) };
            }
          }));
          setRecentCalls(calls);

          const reunionIds = completed.map((reunion) => reunion.id);
          if (!reunionIds.length) {
            setTotalMinutes(0);
            return;
          }
          const chunks: string[][] = [];
          for (let index = 0; index < reunionIds.length; index += 10) chunks.push(reunionIds.slice(index, index + 10));
          const allInvitations = (await Promise.all(chunks.map(async (chunk) => {
            const invitationSnapshot = await getDocs(query(
              collection(db, 'invitations'),
              where('reunionId', 'in', chunk),
              where('callerId', '==', user.uid),
            ));
            return invitationSnapshot.docs.map((document) => document.data() as InvitationDoc);
          }))).flat();
          const invitationsByReunion: Record<string, InvitationDoc[]> = {};
          allInvitations.forEach((invitation) => {
            if (!invitation.reunionId) return;
            (invitationsByReunion[String(invitation.reunionId)] ??= []).push(invitation);
          });
          let minutes = 0;
          for (const invitationsForReunion of Object.values(invitationsByReunion)) {
            const { meetingDurationMinutes } = calculateMeetingDuration(invitationsForReunion);
            if (meetingDurationMinutes) minutes += meetingDurationMinutes;
          }
          setTotalMinutes(minutes || 0);
        } catch (error) {
          console.error(error);
        } finally {
          setStatsLoading(false);
        }
      },
      () => {
        setMeetingsThisMonth(0);
        setStatsLoading(false);
      },
    );

    return () => {
      unsubscribeContacts();
      unsubscribeMeetings();
    };
  }, [user]);

  const stats = [
    { label: 'Réunions ce mois', value: meetingsThisMonth ?? 0, icon: CalendarDays, tone: 'mint' },
    { label: 'Contacts', value: contactsCount ?? 0, icon: Users, tone: 'lavender' },
    { label: 'Temps en réunion', value: totalMinutes !== null ? formatDuration(totalMinutes) : '—', icon: Clock3, tone: 'peach' },
  ];

  const quickActions = [
    { label: 'Nouvelle réunion', description: 'Planifier une session', icon: Video, to: '/invitations/new', tone: 'mint' },
    { label: 'Ajouter un contact', description: 'Agrandir votre réseau', icon: Users, to: '/contacts/new', tone: 'lavender' },
    { label: 'Voir les réunions', description: 'Gérer les invitations', icon: CalendarDays, to: '/invitations', tone: 'peach' },
    { label: 'Historique', description: 'Retrouver vos appels', icon: Clock3, to: '/calls', tone: 'blue' },
  ];

  return (
    <DashboardLayout>
      <div className="dashboard-surface landing-page mx-auto w-full max-w-[1440px] space-y-6 pb-8">
        <section className="grid gap-4 xl:grid-cols-[1.45fr_0.75fr]">
          <div className="dashboard-welcome relative isolate overflow-hidden rounded-[2rem] p-6 sm:p-8 lg:p-10">
            <div className="dashboard-welcome-orb dashboard-welcome-orb-one" />
            <div className="dashboard-welcome-orb dashboard-welcome-orb-two" />
            <div className="relative max-w-2xl">
              <span className="dashboard-eyebrow inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold">
                <Sparkles className="h-3.5 w-3.5" />
                Votre espace MeetApp
              </span>
              <h2 className="mt-5 max-w-xl text-3xl font-semibold leading-[1.08] tracking-[-0.045em] text-foreground sm:text-4xl lg:text-[2.8rem]">
                Bonjour, <span className="dashboard-name-accent">{user?.displayName?.split(' ')[0] || 'vous'}</span>
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground sm:text-base">
                Retrouvez vos réunions et gardez vos échanges au même endroit.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link to="/invitations/new">
                  <Button className="h-11 rounded-full px-5 font-semibold shadow-md shadow-primary/15">
                    <Plus className="mr-2 h-4 w-4" /> Nouvelle réunion
                  </Button>
                </Link>
                <Link to="/contacts" className="dashboard-secondary-link inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors">
                  Voir mes contacts <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>

          <div className="dashboard-focus-card relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[2rem] p-6 sm:p-7">
            <div className="absolute -right-12 -top-14 h-48 w-48 rounded-full bg-white/30 blur-2xl" />
            <div className="relative flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground/60">Votre activité</p>
                <p className="mt-2 text-sm text-foreground/70">Réunions ce mois</p>
              </div>
              <div className="dashboard-focus-icon flex h-10 w-10 items-center justify-center rounded-2xl">
                <Video className="h-5 w-5" />
              </div>
            </div>
            <div className="relative flex items-end justify-between gap-4">
              <div>
                {statsLoading ? <Skeleton className="mb-2 h-14 w-24 bg-white/40" /> : <p className="text-5xl font-semibold leading-none tracking-[-0.06em] text-foreground">{meetingsThisMonth ?? 0}</p>}
                <p className="mt-2 text-xs text-foreground/60">réunion{(meetingsThisMonth ?? 0) === 1 ? '' : 's'} terminée{(meetingsThisMonth ?? 0) === 1 ? '' : 's'} ou commencée{(meetingsThisMonth ?? 0) === 1 ? '' : 's'}</p>
              </div>
              <Link to="/invitations" aria-label="Voir les réunions" className="dashboard-focus-link flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:-translate-y-0.5">
                <ArrowUpRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </section>

        <section aria-label="Statistiques" className="grid gap-3 sm:grid-cols-3">
          {stats.map(({ label, value, icon: Icon, tone }) => (
            <article key={label} className="dashboard-card dashboard-stat flex min-h-[116px] items-center gap-4 rounded-[1.5rem] p-5 sm:p-6">
              <div className={`dashboard-stat-icon dashboard-tone-${tone} flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                {statsLoading ? <Skeleton className="mb-2 h-7 w-20" /> : <p className="truncate text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>}
                <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <article className="dashboard-card overflow-hidden rounded-[1.7rem]">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-5 sm:px-6">
              <div>
                <p className="text-lg font-semibold tracking-tight text-foreground">À venir</p>
                <p className="mt-1 text-xs text-muted-foreground">Vos prochaines réunions programmées</p>
              </div>
              <Link to="/invitations" className="dashboard-link inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold transition-colors">
                Tout voir <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="divide-y divide-border/60">
              {statsLoading ? [1, 2, 3].map((item) => (
                <div key={item} className="flex items-center gap-3 px-5 py-4 sm:px-6">
                  <Skeleton className="h-11 w-11 shrink-0 rounded-2xl" />
                  <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3.5 w-36" /><Skeleton className="h-3 w-24" /></div>
                  <Skeleton className="h-8 w-20 rounded-full" />
                </div>
              )) : upcomingMeetings.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <div className="dashboard-empty-icon flex h-12 w-12 items-center justify-center rounded-2xl"><CalendarDays className="h-5 w-5" /></div>
                  <p className="mt-3 text-sm font-semibold text-foreground">Aucune réunion prévue</p>
                  <p className="mt-1 text-xs text-muted-foreground">Planifiez votre prochain échange en quelques secondes.</p>
                  <Link to="/invitations/new" className="mt-4"><Button variant="outline" size="sm" className="rounded-full">Planifier une réunion</Button></Link>
                </div>
              ) : upcomingMeetings.map((meeting) => (
                <div key={meeting.id} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/35 sm:px-6">
                  <div className="dashboard-tone-mint flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"><Video className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{meeting.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{toLocale(meeting.begin)}</p>
                  </div>
                  <Link to={meeting.roomUrl ?? `/meeting/${encodeURIComponent(String(meeting.roomId ?? meeting.id))}?userName=${encodeURIComponent(user?.displayName || user?.email || 'User')}`}>
                    <Button size="sm" className="h-8 rounded-full px-4 text-xs">Rejoindre</Button>
                  </Link>
                </div>
              ))}
            </div>
          </article>

          <article className="dashboard-card overflow-hidden rounded-[1.7rem]">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-5 sm:px-6">
              <div>
                <p className="text-lg font-semibold tracking-tight text-foreground">Appels récents</p>
                <p className="mt-1 text-xs text-muted-foreground">Votre activité terminée</p>
              </div>
              <Link to="/calls" aria-label="Voir l’historique" className="dashboard-link flex h-9 w-9 items-center justify-center rounded-full transition-colors"><ArrowUpRight className="h-4 w-4" /></Link>
            </div>
            <div className="divide-y divide-border/60">
              {statsLoading ? [1, 2, 3].map((item) => (
                <div key={item} className="flex items-center gap-3 px-5 py-4 sm:px-6">
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3 w-20" /></div>
                  <Skeleton className="h-3 w-10" />
                </div>
              )) : recentCalls.length === 0 ? (
                <div className="px-6 py-12 text-center"><p className="text-sm font-medium text-foreground">Aucun appel récent</p><p className="mt-1 text-xs text-muted-foreground">Votre historique apparaîtra ici.</p></div>
              ) : recentCalls.map((call, index) => (
                <Link key={call.id} to={`/calls/${call.id}`} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/35 sm:px-6">
                  <div className={`dashboard-tone-${index % 2 === 0 ? 'lavender' : 'peach'} flex h-10 w-10 shrink-0 items-center justify-center rounded-full`}><Video className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{call.contact}</p><p className="mt-1 text-xs text-muted-foreground">{call.date}</p></div>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">{call.duration}</span>
                </Link>
              ))}
            </div>
          </article>
        </section>

        <section className="dashboard-card overflow-hidden rounded-[1.7rem]">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-5 sm:px-6">
            <div><p className="text-lg font-semibold tracking-tight text-foreground">Accès rapides</p><p className="mt-1 text-xs text-muted-foreground">Les actions que vous utilisez le plus</p></div>
          </div>
          <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            {quickActions.map(({ label, description, icon: Icon, to, tone }) => (
              <Link key={to} to={to} className="dashboard-quick-action group flex items-center gap-3 p-5 transition-colors hover:bg-muted/30 sm:p-6">
                <div className={`dashboard-tone-${tone} flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-transform group-hover:-translate-y-0.5`}><Icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{label}</p><p className="mt-1 truncate text-xs text-muted-foreground">{description}</p></div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
