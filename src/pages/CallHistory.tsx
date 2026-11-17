// ============================================================================
// PAGE: CallHistory.tsx - Historique des appels et réunions
// ============================================================================
//
// Cette page affiche l'historique de tous les appels et réunions de l'utilisateur, incluant:
// 1. Tous les appels acceptés (passés)
// 2. Filtrer par statut (tous, acceptés, refusés, manqués)
// 3. Filtrer par type de réunion (public, privé, organisationnel)
// 4. Voir les informations de chaque appel:
//    - Participants
//    - Durée de la réunion
//    - Durée de participation personnelle
//    - Date et heure
//    - Statut de participation
// 5. Vue grille ou tableau
// 6. Lien pour rejoindre l'enregistrement ou les détails de la réunion
//
// CALCULÉES DYNAMIQUEMENT:
// - Durée totale de la réunion (à partir des heures de début/fin)
// - Durée de participation personnelle (si acceptée)
// - Statut du participant (absent, accepté, refusé)

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Video, Clock, Users, Grid3x3, Table2, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/firebase/firebase';
import { collection, query, where, getDocs, getDoc, doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { calculateParticipantDuration, formatDuration } from '@/utils/durationCalculator';

interface InvitationItem {
  id: string;
  reunionId: string;
  callerId: string;
  contactId: string;
  status: string;
  debut?: Timestamp | number | string | null;
  dateFin?: Timestamp | number | string | null;
  role?: string;
  viewed?: boolean;
  createdAt?: Timestamp | number | string | null;
  url?: string;
  roomId?: string;
}

interface ReunionData {
  id: string;
  title: string;
  description?: string;
  creatorId: string;
  status: string;
  type?: string;
  begin?: Timestamp | number | string | null;
  roomId?: string;
  roomUrl?: string;
}

interface ParticipantItem extends InvitationItem {
  profile?: Record<string, unknown> | null;
}

const STATUS_FILTERS = [
  { value: 'all', label: 'Tous' },
  { value: 'accepted', label: 'Acceptés' },
  { value: 'declined', label: 'Refusés' },
  { value: 'missed', label: 'Manqués' },
] as const;

const TYPE_FILTERS = [
  { value: 'all', label: 'Tous types' },
  { value: 'public', label: 'Publiques' },
  { value: 'private', label: 'Privées' },
  { value: 'organizational', label: 'Org.' },
] as const;

const CallHistory = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [calls, setCalls] = useState<Array<{ reunion: ReunionData; participants: ParticipantItem[]; myInvitation?: InvitationItem | null; createdByMe: boolean }>>([]);
  const [filter, setFilter] = useState<'all' | 'accepted' | 'declined' | 'missed'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'public' | 'private' | 'organizational'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 5;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="secondary">Terminé</Badge>;
      case 'ongoing':
        return <Badge className="bg-success">En cours</Badge>;
      case 'scheduled':
        return <Badge variant="outline">Programmé</Badge>;
      default:
        return null;
    }
  };

  useEffect(() => {
    if (!user || !user.uid) {
      setLoading(false);
      return;
    }

    const createdQuery = query(collection(db, 'reunions'), where('creatorId', '==', user.uid));
    const unsubCreated = onSnapshot(createdQuery, async () => await buildList());

    const receivedQuery = query(collection(db, 'invitations'), where('contactId', '==', user.uid));
    const unsubReceived = onSnapshot(receivedQuery, async () => await buildList());

    void buildList();

    async function buildList() {
      setLoading(true);
      try {
        // Load created and received in parallel
        const [createdSnap, receivedSnap] = await Promise.all([
          getDocs(query(collection(db, 'reunions'), where('creatorId', '==', user.uid))),
          getDocs(query(collection(db, 'invitations'), where('contactId', '==', user.uid)))
        ]);

        const createdReunions = createdSnap.docs.map(d => ({ id: d.id, ...(d.data() as ReunionData) })) as ReunionData[];
        const receivedInvitations = receivedSnap.docs.map(d => ({ id: d.id, ...(d.data() as InvitationItem) })) as InvitationItem[];

        const reunionIds = new Set<string>();

        // Add completed reunions created by user
        createdReunions.forEach((r) => {
          if (r.status === 'completed') reunionIds.add(r.id);
        });

        // Check received invitations for relevant reunions
        const invitationReunionPromises = receivedInvitations.map(inv =>
          getDoc(doc(db, 'reunions', inv.reunionId))
            .then(reunionSnap => {
              if (!reunionSnap.exists()) return null;
              const reunion = { id: reunionSnap.id, ...(reunionSnap.data() as ReunionData) } as ReunionData;
              const isDeclinedOrMissed = inv.status === 'declined' || inv.status === 'expired';
              const isAcceptedAndCompleted = inv.status === 'accepted' && reunion.status === 'completed';
              return (isDeclinedOrMissed || isAcceptedAndCompleted) ? reunion.id : null;
            })
            .catch(err => {
              console.warn('Error checking reunion for invitation', err);
              return null;
            })
        );

        const relevantReunionIds = (await Promise.all(invitationReunionPromises))
          .filter((id): id is string => id !== null);
        relevantReunionIds.forEach(id => reunionIds.add(id));

        // Load all reunions in parallel
        const reunionPromises = Array.from(reunionIds).map(reunionId =>
          getDoc(doc(db, 'reunions', reunionId))
            .then(snap => snap.exists() ? { id: snap.id, ...(snap.data() as ReunionData) } as ReunionData : null)
            .catch(e => {
              console.warn('Error loading reunion', reunionId, e);
              return null;
            })
        );

        const reunions = await Promise.all(reunionPromises);
        const validReunions = reunions.filter((r): r is ReunionData => r !== null);

        // Load all invitations and profiles in parallel
        const callPromises = validReunions.map(reunion =>
          getDocs(query(
            collection(db, 'invitations'),
            where('reunionId', '==', reunion.id),
            where(reunion.creatorId === user.uid ? 'callerId' : 'contactId', '==', user.uid),
          ))
            .then(async invSnap => {
              const participants = await Promise.all(
                invSnap.docs.map(async p => {
                  const pd = { id: p.id, ...(p.data() as InvitationItem) } as InvitationItem;
                  try {
                    const profSnap = await getDoc(doc(db, 'publicProfiles', pd.contactId));
                    return { ...pd, profile: profSnap.exists() ? profSnap.data() : null } as ParticipantItem;
                  } catch (e) {
                    return { ...pd, profile: null } as ParticipantItem;
                  }
                })
              );

              // Ensure creator is in participants
              if (!participants.some(p => p.contactId === reunion.creatorId)) {
                try {
                  const creatorProfSnap = await getDoc(doc(db, 'publicProfiles', reunion.creatorId));
                  const creatorParticipant: ParticipantItem = {
                    id: `creator-${reunion.creatorId}`,
                    reunionId: reunion.id,
                    callerId: reunion.creatorId,
                    contactId: reunion.creatorId,
                    status: 'accepted',
                    url: reunion.roomUrl || '',
                    roomId: reunion.roomId || '',
                    viewed: true,
                    debut: null,
                    dateFin: null,
                    role: 'host',
                    createdAt: reunion.begin || null,
                    profile: creatorProfSnap.exists() ? creatorProfSnap.data() as Record<string, unknown> : null,
                  };
                  participants.unshift(creatorParticipant);
                } catch (e) {
                  const creatorParticipant: ParticipantItem = {
                    id: `creator-${reunion.creatorId}`,
                    reunionId: reunion.id,
                    callerId: reunion.creatorId,
                    contactId: reunion.creatorId,
                    status: 'accepted',
                    url: reunion.roomUrl || '',
                    roomId: reunion.roomId || '',
                    viewed: true,
                    debut: null,
                    dateFin: null,
                    role: 'host',
                    createdAt: reunion.begin || null,
                    profile: null,
                  };
                  participants.unshift(creatorParticipant);
                }
              }

              const myInvitation = participants.find(p => p.contactId === user.uid) || null;
              const createdByMe = reunion.creatorId === user.uid;

              return { reunion, participants, myInvitation, createdByMe };
            })
            .catch(e => {
              console.warn('Error loading call details', e);
              return null;
            })
        );

        const items = (await Promise.all(callPromises)).filter(item => item !== null) as Array<{ reunion: ReunionData; participants: ParticipantItem[]; myInvitation?: InvitationItem | null; createdByMe: boolean }>;

        items.sort((a, b) => {
          const aBegin = a.reunion.begin;
          const bBegin = b.reunion.begin;
          const aT = aBegin ? (aBegin instanceof Timestamp ? aBegin.toDate().getTime() : (typeof aBegin === 'number' ? aBegin : new Date(aBegin).getTime())) : 0;
          const bT = bBegin ? (bBegin instanceof Timestamp ? bBegin.toDate().getTime() : (typeof bBegin === 'number' ? bBegin : new Date(bBegin).getTime())) : 0;
          return bT - aT;
        });

        setCalls(items);
      } catch (err) {
        console.error('Error building call list', err);
      } finally {
        setLoading(false);
      }
    }

    return () => { unsubCreated(); unsubReceived(); };
  }, [user]);

  const getParticipantNames = (participants: ParticipantItem[]) => {
    return participants.map(p => (p.profile?.['displayName'] as string) || (p.profile?.['name'] as string) || p.contactId).filter(Boolean).join(', ');
  };

  const getTypeBadge = (type?: string) => {
    switch (type) {
      case 'public':
        return <Badge variant="secondary">Publique</Badge>;
      case 'private':
        return <Badge>Privée</Badge>;
      case 'organizational':
        return <Badge className="bg-accent">Organisationnelle</Badge>;
      default:
        return null;
    }
  };

  const getParticipationBadge = (createdByMe: boolean, myInvitation?: InvitationItem | null) => {
    if (createdByMe) return <Badge>Créateur</Badge>;
    if (!myInvitation) return null;
    const label = myInvitation.status === 'accepted' ? 'Acceptée'
      : myInvitation.status === 'declined' ? 'Refusée'
      : myInvitation.status === 'expired' ? 'Manquée'
      : 'En attente';
    return <Badge>{label}</Badge>;
  };

  const getDurationMinutes = (reunion: ReunionData, participants: ParticipantItem[]) => {
    // compute earliest debut and latest dateFin among participants if available
    const toMillis = (value: unknown) => {
      if (!value) return null;
      if (value instanceof Timestamp) return value.toDate().getTime();
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d.getTime();
      }
      return null;
    };
    const debuts = participants.map(p => toMillis(p.debut)).filter(Boolean) as number[];
    const ends = participants.map(p => toMillis(p.dateFin)).filter(Boolean) as number[];
    if (debuts.length > 0 && ends.length > 0) {
      const start = Math.min(...debuts);
      const end = Math.max(...ends);
      return Math.round((end - start) / 60000);
    }
    // fallback: if reunion.begin and there is a participant dateFin
    const rBegin = toMillis(reunion.begin);
    if (rBegin && ends.length > 0) {
      const end = Math.max(...ends);
      return Math.round((end - rBegin) / 60000);
    }
    return null;
  };

  const dateToDisplay = (d: Timestamp | number | string | null | undefined) => {
    if (!d) return '—';
    try {
      if (d instanceof Timestamp) return d.toDate().toLocaleString('fr-FR');
      if (typeof d === 'number') return new Date(d).toLocaleString('fr-FR');
      return new Date(d).toLocaleString('fr-FR');
    } catch (e) {
      return '—';
    }
  };

  const filteredCalls = useMemo(() =>
    calls.filter(({ myInvitation, createdByMe, reunion }) => {
      // Filtre type
      if (typeFilter !== 'all' && reunion.type !== typeFilter) return false;

      // Filtre statut
      if (filter === 'all') return true;

      // For created calls, show them regardless of status filter
      if (createdByMe) return true;

      // For received invitations, apply the status filter
      if (!myInvitation) return false;
      if (filter === 'accepted') return myInvitation.status === 'accepted';
      if (filter === 'declined') return myInvitation.status === 'declined';
      if (filter === 'missed') return myInvitation.status === 'expired';
      return true;
    }), [calls, filter, typeFilter]
  );

  const totalPages = Math.ceil(filteredCalls.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedCalls = filteredCalls.slice(startIndex, endIndex);

  return (
    <DashboardLayout>
      <div className="landing-page mx-auto max-w-6xl space-y-6">
        <div className="relative overflow-hidden rounded-[2rem] bg-neutral-950 p-6 text-white shadow-2xl sm:p-8 md:p-10">
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-black/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />

          <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl space-y-4">
              <span className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {calls.length} {calls.length > 1 ? 'réunions' : 'réunion'}
              </span>
              <h1 className="text-3xl font-extrabold leading-[0.98] tracking-[-0.035em] md:text-5xl">
                Historique <span className="text-primary">des appels.</span>
              </h1>
              <p className="text-sm leading-relaxed text-white/60">
                Retrouvez vos réunions passées, reçues ou organisées.
              </p>
            </div>
            <Link to="/invitations/new" className="shrink-0">
              <Button className="h-12 w-full rounded-full px-7 font-semibold md:w-auto">
                <Plus className="mr-2 h-4 w-4" />
                Nouvelle réunion
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-[1.5rem] border border-border bg-card p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map(option => (
              <Button
                key={option.value}
                variant={filter === option.value ? 'default' : 'outline'}
                size="sm"
                className="h-8 rounded-full px-3.5 text-xs"
                onClick={() => { setFilter(option.value); setCurrentPage(1); }}
              >
                {option.label}
              </Button>
            ))}
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
            {TYPE_FILTERS.map(option => (
              <Button
                key={option.value}
                variant={typeFilter === option.value ? 'default' : 'outline'}
                size="sm"
                className="h-8 rounded-full px-3.5 text-xs"
                onClick={() => { setTypeFilter(option.value); setCurrentPage(1); }}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-1 self-start rounded-full border border-border bg-background p-1 lg:self-auto">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 rounded-full p-0"
              onClick={() => { setViewMode('grid'); setCurrentPage(1); }}
              title="Affichage grille"
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 rounded-full p-0"
              onClick={() => { setViewMode('table'); setCurrentPage(1); }}
              title="Affichage tableau"
            >
              <Table2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {filteredCalls.length === 0 && (
            <div className="rounded-[1.5rem] border border-dashed border-border bg-card px-6 py-16 text-center">
              <Video className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              {calls.length === 0 ? (
                <>
                  <p className="mb-4 text-muted-foreground">Aucun appel dans l'historique</p>
                  <Link to="/invitations/new">
                    <Button className="rounded-full font-semibold">Créer votre première réunion</Button>
                  </Link>
                </>
              ) : (
                <p className="text-muted-foreground">Aucun appel ne correspond à ces filtres</p>
              )}
            </div>
          )}

          {viewMode === 'grid' && paginatedCalls.map(({ reunion, participants, myInvitation, createdByMe }) => {
            const duration = getDurationMinutes(reunion, participants);
            return (
              <div
                key={reunion.id}
                className="flex flex-col gap-4 rounded-[1.5rem] border border-border bg-card p-5 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between sm:p-6"
              >
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Video className="h-6 w-6 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-base font-semibold sm:text-lg">{reunion.title}</h3>
                      {getStatusBadge(reunion.status)}
                      {getTypeBadge(reunion.type)}
                      {getParticipationBadge(createdByMe, myInvitation)}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {dateToDisplay(reunion.begin)}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {duration !== null ? `${duration} min` : '—'}
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {participants.length} participants
                      </div>
                    </div>
                    <p className="break-words text-sm text-muted-foreground">
                      Participants : {getParticipantNames(participants)}
                    </p>
                  </div>
                </div>

                <Link to={`/calls/${reunion.id}`} className="shrink-0">
                  <Button variant="outline" className="w-full rounded-full sm:w-auto">Voir détails</Button>
                </Link>
              </div>
            );
          })}

          {viewMode === 'table' && filteredCalls.length > 0 && (
            <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/40">
                      <th className="px-4 py-4 text-left font-semibold text-foreground sm:px-6">Titre</th>
                      <th className="hidden px-6 py-4 text-left font-semibold text-foreground md:table-cell">Type</th>
                      <th className="px-4 py-4 text-left font-semibold text-foreground sm:px-6">Statut</th>
                      <th className="hidden px-6 py-4 text-left font-semibold text-foreground lg:table-cell">Date</th>
                      <th className="px-4 py-4 text-center font-semibold text-foreground sm:px-6">Participants</th>
                      <th className="hidden px-6 py-4 text-center font-semibold text-foreground lg:table-cell">Durée réunion</th>
                      <th className="hidden px-6 py-4 text-center font-semibold text-foreground xl:table-cell">Durée moy.</th>
                      <th className="px-4 py-4 text-right font-semibold text-foreground sm:px-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedCalls.map(({ reunion, participants, myInvitation, createdByMe }) => {
                      const duration = getDurationMinutes(reunion, participants);
                      const participantDurations = participants
                        .map(p => calculateParticipantDuration(p.debut, p.dateFin))
                        .filter((d): d is number => d !== null);
                      const avgParticipantDuration = participantDurations.length > 0
                        ? Math.round(participantDurations.reduce((a, b) => a + b, 0) / participantDurations.length)
                        : null;
                      return (
                        <tr key={reunion.id} className="group border-b border-border/30 transition-colors last:border-0 hover:bg-primary/5">
                          <td className="px-4 py-4 sm:px-6">
                            <div className="flex min-w-[160px] items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/20 text-sm font-bold text-primary">
                                {reunion.title?.charAt(0).toUpperCase() || 'R'}
                              </div>
                              <span className="font-semibold text-foreground transition-colors group-hover:text-primary">{reunion.title}</span>
                            </div>
                          </td>
                          <td className="hidden px-6 py-4 md:table-cell">{getTypeBadge(reunion.type || 'private')}</td>
                          <td className="px-4 py-4 sm:px-6">
                            <div className="flex flex-wrap items-center gap-2">
                              {getStatusBadge(reunion.status)}
                              {getParticipationBadge(createdByMe, myInvitation)}
                            </div>
                          </td>
                          <td className="hidden px-6 py-4 text-xs text-foreground lg:table-cell">{dateToDisplay(reunion.begin)}</td>
                          <td className="px-4 py-4 text-center sm:px-6">
                            <Badge variant="outline">{participants.length}</Badge>
                          </td>
                          <td className="hidden px-6 py-4 text-center text-foreground lg:table-cell">{duration !== null ? `${duration} min` : '—'}</td>
                          <td className="hidden px-6 py-4 text-center text-foreground xl:table-cell">{avgParticipantDuration !== null ? `${avgParticipantDuration} min` : '—'}</td>
                          <td className="px-4 py-4 text-right sm:px-6">
                            <Link to={`/calls/${reunion.id}`}>
                              <Button variant="outline" size="sm" className="rounded-full">Voir détails</Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {filteredCalls.length > 0 && (
            <div className="flex flex-col gap-3 rounded-[1.5rem] border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Affichage {startIndex + 1} à {Math.min(endIndex, filteredCalls.length)} sur {filteredCalls.length} appels
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  Précédent
                </Button>
                <div className="px-3 text-sm font-medium">
                  Page {currentPage} / {totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default CallHistory;
