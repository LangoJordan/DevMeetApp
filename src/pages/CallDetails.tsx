// ============================================================================
// PAGE: CallDetails.tsx - Détails de la réunion et gestion des participants
// ============================================================================
//
// Cette page affiche les détails complets d'une réunion et permet de:
// 1. Voir les informations de la réunion (titre, description, heure)
// 2. Voir la liste des participants avec statuts
// 3. Voir les durées de participation de chaque participant
// 4. Reprogrammer la réunion (rôle host uniquement)
// 5. Cloner la réunion pour créer une copie
// 6. Inviter des contacts supplémentaires à la réunion
// 7. Afficher les détails des participants (nom, rôle, heure de connexion/déconnexion)
//
// INTERACTIVITÉ:
// - Mise à jour en temps réel via Firestore listeners
// - Vue grille ou tableau
// - Affichage de la durée de participation calculée
// - Affichage du rôle du participant (host, co-host, participant)
//
// RESTRICTIONS:
// - Seulement le host peut reprogrammer ou cloner
// - Seulement le host peut inviter d'autres participants
// - Les données se mettent à jour en temps réel

import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Clock, Users, Calendar, UserPlus, Grid3x3, Table2, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/firebase/firebase';
import { arrayUnion, doc, getDoc, collection, query, where, getDocs, onSnapshot, Timestamp, updateDoc, serverTimestamp } from 'firebase/firestore';
import callService from '@/services/callService';
import { toast } from 'sonner';

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

interface ContactRecord { id: string; name?: string; invitId?: string; [key: string]: unknown }

const ITEMS_PER_PAGE = 5;

const heroOutlineButton = 'h-10 rounded-full border-white/20 bg-white/5 px-5 text-white hover:bg-white/10 hover:text-white';

const toMillis = (value: Timestamp | number | string | null | undefined): number | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  return null;
};

const formatDateValue = (value: Timestamp | number | string | null | undefined) => {
  const millis = toMillis(value);
  return millis === null ? '—' : new Date(millis).toLocaleString('fr-FR');
};

const CallDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState<boolean>(true);
  const [reunion, setReunion] = useState<ReunionData | null>(null);
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [creatorProfile, setCreatorProfile] = useState<Record<string, unknown> | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState<boolean>(false);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [rolesMap, setRolesMap] = useState<Record<string, 'host' | 'co-host' | 'participant'>>({});
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    (async () => {
      try {
        if (!user) return;
        const q = query(collection(db, 'contacts'), where('creatorId', '==', user.uid));
        const snap = await getDocs(q);
        const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as ContactRecord) } as ContactRecord));
        setContacts(items);
      } catch (e) {
        console.error('Error loading contacts', e);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!id || !user?.uid) return;
    const reunionRef = doc(db, 'reunions', id);
    let unsubReunion: (() => void) | null = null;
    let unsubInv: (() => void) | null = null;

    (async () => {
      setLoading(true);
      try {
        const initialReunion = await getDoc(reunionRef);
        if (!initialReunion.exists()) throw new Error('Réunion introuvable');
        const filterField = initialReunion.data().creatorId === user.uid ? 'callerId' : 'contactId';
        const invitationsQuery = query(
          collection(db, 'invitations'),
          where('reunionId', '==', id),
          where(filterField, '==', user.uid),
        );
        unsubReunion = onSnapshot(reunionRef, (snap) => {
          if (!snap.exists()) {
            setReunion(null);
            setLoading(false);
            return;
          }
          const r = { id: snap.id, ...(snap.data() as ReunionData) } as ReunionData;
          setReunion(r);
        });

        unsubInv = onSnapshot(invitationsQuery, async (snap) => {
          const invDocs = snap.docs.map(d => ({ id: d.id, ...(d.data() as InvitationItem) } as InvitationItem));
          const participantPromises = invDocs.map(async (inv) => {
            const profSnap = await getDoc(doc(db, 'publicProfiles', inv.contactId));
            const prof = profSnap.exists() ? profSnap.data() : null;
            return { ...inv, profile: prof } as ParticipantItem;
          });
          const parts = await Promise.all(participantPromises);
          setParticipants(parts);
        });

        setLoading(false);
      } catch (err) {
        console.error('Error loading call details', err);
        setLoading(false);
      }
    })();

    return () => { if (unsubReunion) unsubReunion(); if (unsubInv) unsubInv(); };
  }, [id, user?.uid]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="landing-page flex items-center justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!reunion) {
    return (
      <DashboardLayout>
        <div className="landing-page mx-auto flex max-w-md flex-col items-center gap-4 rounded-[1.5rem] border border-dashed border-border bg-card px-6 py-16 text-center">
          <Video className="h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">Appel non trouvé</p>
          <Button onClick={() => navigate('/calls')} className="rounded-full">
            Retour à l'historique
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const getParticipantDetails = (profile: Record<string, unknown> | null, contactId: string) => {
    if (profile) return profile;
    return { displayName: contactId, email: '' } as Record<string, unknown>;
  };

  const describeParticipant = (participant: ParticipantItem) => {
    const contact = getParticipantDetails(participant.profile || null, participant.contactId);
    const rawName = contact['displayName'] || contact['name'] || participant.contactId;
    const isCurrentUser = !!user && participant.contactId === user.uid;
    return {
      name: isCurrentUser ? 'Vous' : String(rawName),
      email: String(contact['email'] || ''),
      isCurrentUser,
    };
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'host':
        return <Badge className="bg-primary">Organisateur</Badge>;
      case 'co-host':
        return <Badge className="bg-accent">Co-organisateur</Badge>;
      default:
        return <Badge variant="secondary">Participant</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-950/30">En attente</Badge>;
      case 'accepted':
        return <Badge className="bg-success dark:bg-success/20 text-success dark:text-success">Accepté</Badge>;
      case 'declined':
        return <Badge variant="destructive">Refusé</Badge>;
      case 'missed':
        return <Badge variant="outline" className="bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">Manqué</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const isUserCreator = () => user && reunion && user.uid === reunion.creatorId;
  const getUserParticipantRole = () => participants.find(p => p.contactId === user?.uid)?.role || null;
  const hasEditPermission = () => {
    const role = getUserParticipantRole();
    return isUserCreator() || role === 'host' || role === 'co-host';
  };

  const toggleContact = (id: string) => {
    if (selectedContacts.includes(id)) setSelectedContacts(selectedContacts.filter(s => s !== id));
    else setSelectedContacts([...selectedContacts, id]);
  };

  const updateContactRole = (id: string, role: 'host'|'co-host'|'participant') => setRolesMap({ ...rolesMap, [id]: role });

  const handleReprogram = async () => {
    if (!user || !reunion) return;
    const userRole = getUserParticipantRole();
    const isCreator = isUserCreator();
    const isOrganizer = userRole === 'host' || userRole === 'co-host';

    const newRoomId = `room_${Date.now()}_${user.uid}`;
    const newRoomUrl = `${window.location.origin}/meeting/${encodeURIComponent(newRoomId)}?userName=${encodeURIComponent(user.displayName || user.email || 'User')}`;

    if (isCreator || isOrganizer) {
      const confirmed = window.confirm('Voulez-vous reprogrammer cette réunion ? Tous les statuts des invitations seront remis à en attente.');
      if (!confirmed) return;
      const ok = await callService.reprogramReunion(reunion.id, newRoomId, newRoomUrl);
      if (ok) {
        toast.success('Réunion reprogrammée avec succès');
        const snap = await getDoc(doc(db, 'reunions', reunion.id));
        if (snap.exists()) setReunion({ id: snap.id, ...(snap.data() as ReunionData) });
      } else {
        toast.error('Erreur lors de la reprogrammation');
      }
      return;
    }

    if (reunion.type === 'private') {
      const confirmed = window.confirm('Ceci va créer une nouvelle réunion privée et vous en deviendrez le créateur. Continuer ?');
      if (!confirmed) return;
      const cloneResult = await callService.cloneReunionAsNew(reunion.id, user.uid);
      if (cloneResult) {
        toast.success('Réunion privée recréée en tant que nouvel organisateur');
        await updateDoc(doc(db, 'reunions', reunion.id), { status: 'replaced', updatedAt: serverTimestamp() });
        navigate(`/calls/${cloneResult.id}`);
      } else {
        toast.error('Erreur lors de la recréation');
      }
      return;
    }

    toast.error('Vous n\'êtes pas autorisé à reprogrammer cette réunion.');
  };

  const handleGenerateLinkNow = async () => {
    if (!user || !reunion) return;
    if (!hasEditPermission()) {
      toast.error('Seul l\'organisateur, co-organisateur ou le créateur peut générer le lien.');
      return;
    }

    if (reunion.roomId && reunion.roomUrl) {
      toast.info('Un lien de réunion existe déjà.');
      return;
    }

    const confirmed = window.confirm('Générer maintenant un lien de réunion accessible à tous les invités ?');
    if (!confirmed) return;

    try {
      const newRoomId = `room_${Date.now()}_${user.uid}`;
      const newRoomUrl = `${window.location.origin}/meeting/${encodeURIComponent(newRoomId)}?userName=${encodeURIComponent(user.displayName || user.email || 'User')}`;

      const invQ = query(
        collection(db, 'invitations'),
        where('reunionId', '==', reunion.id),
        where('callerId', '==', user.uid),
      );
      const invSnap = await getDocs(invQ);
      await updateDoc(doc(db, 'reunions', reunion.id), {
        roomId: newRoomId,
        roomUrl: newRoomUrl,
        hostId: reunion.creatorId,
        maxParticipants: 6,
        invitedUserIds: arrayUnion(user.uid, ...invSnap.docs.map((invitation) => invitation.data().contactId as string)),
        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: serverTimestamp(),
      });
      const updates = invSnap.docs.map(async (d) => {
        await updateDoc(doc(db, 'invitations', d.id), {
          url: newRoomUrl,
          roomId: newRoomId,
          updatedAt: serverTimestamp(),
        });
      });
      await Promise.all(updates);

      const snap = await getDoc(doc(db, 'reunions', reunion.id));
      if (snap.exists()) setReunion({ id: snap.id, ...(snap.data() as ReunionData) });

      toast.success('Lien de réunion généré avec succès');
    } catch (e) {
      console.error('Error generating room link', e);
      toast.error('Erreur lors de la génération du lien');
    }
  };

  const handleInviteMembers = async () => {
    if (!user || !reunion) return;
    if (!hasEditPermission()) {
      toast.error('Seul l\'organisateur, co-organisateur ou le créateur peut inviter des membres.');
      return;
    }
    const toInvite = selectedContacts.map(id => {
      const c = contacts.find(x => x.id === id);
      const contactId = (c as ContactRecord)?.invitId || (c as ContactRecord)?.id;
      return { contactId, role: rolesMap[id] || 'participant' };
    }).filter(Boolean);
    if (toInvite.length === 0) {
      toast.error('Sélectionnez au moins un contact');
      return;
    }
    const ok = await callService.inviteMembersToReunion(reunion.id, user.uid, toInvite, reunion.roomUrl || '', reunion.roomId || '');
    if (ok) {
      setIsInviteOpen(false);
      setSelectedContacts([]);
      toast.success('Invitations envoyées');
    } else {
      toast.error('Erreur lors de l\'envoi des invitations');
    }
  };

  const callDuration = (() => {
    const debuts = participants.map(p => toMillis(p.debut)).filter(Boolean) as number[];
    const ends = participants.map(p => toMillis(p.dateFin)).filter(Boolean) as number[];
    if (debuts.length > 0 && ends.length > 0) {
      return Math.round((Math.max(...ends) - Math.min(...debuts)) / 60000);
    }
    const rBegin = toMillis(reunion.begin);
    if (rBegin && ends.length > 0) {
      return Math.round((Math.max(...ends) - rBegin) / 60000);
    }
    return null;
  })();

  const stats = [
    { icon: Clock, label: 'Durée', value: callDuration !== null ? `${callDuration} minutes` : '—' },
    { icon: Users, label: 'Participants', value: `${participants.length} personnes` },
    { icon: Calendar, label: 'Date', value: formatDateValue(reunion.begin) },
  ];

  const totalPages = Math.ceil(participants.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedParticipants = participants.slice(startIndex, endIndex);

  const pagination = totalPages > 1 ? (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">
        Affichage {startIndex + 1} à {Math.min(endIndex, participants.length)} sur {participants.length} participants
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
  ) : null;

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

          <div className="relative space-y-6">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => navigate('/calls')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Retour à l'historique
            </Button>

            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 max-w-2xl space-y-4">
                <span className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {reunion.status === 'completed' ? 'Terminé' : reunion.status}
                </span>
                <h1 className="break-words text-3xl font-extrabold leading-[0.98] tracking-[-0.035em] md:text-5xl">
                  {reunion.title}
                </h1>
                {!reunion.roomId && !reunion.roomUrl && (
                  <p className="text-sm leading-relaxed text-white/60">
                    Aucun lien de salle n'a encore été généré pour cette réunion. Utilisez "Générer le lien maintenant" pour permettre aux invités de la rejoindre.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <Button
                  variant="outline"
                  className={heroOutlineButton}
                  onClick={() => window.open(reunion.roomUrl ?? `/meeting/${encodeURIComponent(String(reunion.roomId ?? reunion.id))}?userName=${encodeURIComponent(user?.displayName || user?.email || 'User')}`, '_blank')}
                  disabled={!reunion.roomUrl && !reunion.roomId}
                >
                  <Video className="mr-2 h-4 w-4" />
                  Rejoindre
                </Button>
                <Button
                  variant="outline"
                  className={heroOutlineButton}
                  onClick={handleGenerateLinkNow}
                  disabled={!hasEditPermission() || (!!reunion.roomId && !!reunion.roomUrl)}
                >
                  Générer le lien maintenant
                </Button>
                <Button
                  variant="outline"
                  className={heroOutlineButton}
                  onClick={handleReprogram}
                  disabled={!hasEditPermission() && reunion.type !== 'private'}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  Reprogrammer
                </Button>
                <Button
                  className="h-10 rounded-full px-5 font-semibold"
                  onClick={() => setIsInviteOpen(true)}
                  disabled={!hasEditPermission()}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  Inviter des membres
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {stats.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center gap-4 rounded-[1.5rem] border border-border bg-card p-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="mt-1 truncate font-semibold">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {isInviteOpen && (
          <section className="space-y-4 rounded-[1.5rem] border border-border bg-card p-5 sm:p-6">
            <div>
              <h2 className="text-lg font-semibold">Inviter des membres</h2>
              <p className="text-sm text-muted-foreground">Sélectionnez les contacts à inviter</p>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-border bg-background p-2">
              {contacts.map(c => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={selectedContacts.includes(c.id)}
                    onChange={() => toggleContact(c.id)}
                  />
                  <div className="min-w-0 flex-1 truncate text-sm font-medium">{String(c.name)}</div>
                  {selectedContacts.includes(c.id) && (
                    <select
                      className="h-8 rounded-full border border-border bg-card px-3 text-xs"
                      value={rolesMap[c.id] || 'participant'}
                      onChange={(e) => updateContactRole(c.id, e.target.value as 'host'|'co-host'|'participant')}
                    >
                      <option value="host">Organisateur</option>
                      <option value="co-host">Co-organisateur</option>
                      <option value="participant">Participant</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="rounded-full" onClick={() => setIsInviteOpen(false)}>Annuler</Button>
              <Button className="rounded-full font-semibold" onClick={handleInviteMembers}>Envoyer</Button>
            </div>
          </section>
        )}

        {reunion.description && (
          <section className="rounded-[1.5rem] border border-border bg-card p-5 sm:p-6">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Description</p>
            <p className="whitespace-pre-line leading-relaxed text-foreground/80">{reunion.description}</p>
          </section>
        )}

        <section className="space-y-4 rounded-[1.5rem] border border-border bg-card p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Participants ({participants.length})</h2>
            <div className="flex items-center gap-1 self-start rounded-full border border-border bg-background p-1 sm:self-auto">
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

          {participants.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
              Aucun participant pour le moment
            </div>
          )}

          {participants.length > 0 && viewMode === 'grid' && (
            <div className="grid gap-3 lg:grid-cols-2">
              {paginatedParticipants.map((participant) => {
                const { name, email, isCurrentUser } = describeParticipant(participant);
                return (
                  <div
                    key={participant.contactId}
                    className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className={`truncate font-semibold ${isCurrentUser ? 'text-primary' : ''}`}>{name}</h3>
                        {email && <p className="truncate text-sm text-muted-foreground">{email}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {getStatusBadge(participant.status)}
                      {getRoleBadge(participant.role || 'participant')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {participants.length > 0 && viewMode === 'table' && (
            <div className="overflow-hidden rounded-2xl border border-border bg-background">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/40">
                      <th className="px-4 py-4 text-left font-semibold text-foreground sm:px-6">Nom</th>
                      <th className="hidden px-6 py-4 text-left font-semibold text-foreground md:table-cell">Email</th>
                      <th className="px-4 py-4 text-left font-semibold text-foreground sm:px-6">Statut</th>
                      <th className="px-4 py-4 text-left font-semibold text-foreground sm:px-6">Rôle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedParticipants.map((participant) => {
                      const { name, email, isCurrentUser } = describeParticipant(participant);
                      return (
                        <tr key={participant.contactId} className="group border-b border-border/30 transition-colors last:border-0 hover:bg-primary/5">
                          <td className="px-4 py-4 sm:px-6">
                            <div className="flex min-w-[160px] items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                                {name.charAt(0).toUpperCase()}
                              </div>
                              <span className={`font-semibold transition-colors group-hover:text-primary ${isCurrentUser ? 'text-primary' : ''}`}>{name}</span>
                            </div>
                          </td>
                          <td className="hidden px-6 py-4 text-foreground md:table-cell">{email || '—'}</td>
                          <td className="px-4 py-4 sm:px-6">{getStatusBadge(participant.status)}</td>
                          <td className="px-4 py-4 sm:px-6">{getRoleBadge(participant.role || 'participant')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {pagination}
        </section>
      </div>
    </DashboardLayout>
  );
};

export default CallDetails;
