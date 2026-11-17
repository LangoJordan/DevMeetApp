/**
 * ============================================================================
 * PAGE: Invitations.tsx - Gestion des réunions et invitations
 * ============================================================================
 *
 * Cette page affiche:
 * 1. Les réunions créées par l'utilisateur (en tant qu'organisateur)
 * 2. Les réunions où l'utilisateur est invité (en tant que participant)
 *
 * Fonctionnalités:
 * - Mises à jour en temps réel de la liste via Firestore listeners
 * - Filtrer par statut de création (tous, créées par moi, invités, à venir)
 * - Vue grille ou tableau
 * - Accepter/Refuser les invitations
 * - Rejoindre les réunions en cours
 * - Gérer les participants (organisateurs uniquement)
 * - Voir la liste des participants avec noms, rôles, statuts
 *
 * INTERACTIONS FIRESTORE:
 * Collections:
 *   - reunions: Métadonnées de réunion
 *   - invitations: Enregistrements des participants
 *   - profiles: Infos de profil utilisateur
 *   - notifications: Enregistrements de notification
 *
 * MISES À JOUR EN TEMPS RÉEL:
 * - Utilise des listeners onSnapshot pour les réunions et invitations
 * - Reconstruit automatiquement la liste quand les données changent
 * - Affiche d'abord les réunions en cours
 *
 * SERVICES BACKEND:
 *   - notifyInvitationAccepted: Envoyer notification lors de l'acceptation
 *   - notifyInvitationDeclined: Envoyer notification lors du refus
 *
 * LOGIQUE COMPLEXE:
 * - Reconstruction de la liste de réunions à partir de plusieurs sources
 * - Récupération des profils des participants en parallèle
 * - Inclusion automatique du créateur de réunion en tant que participant
 * - Vérification de la date/heure de réunion pour le contrôle d'accès
 * - Gestion des invitations acceptées vs en attente
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Mail, Clock, Users, Filter, User, UserPlus, CalendarClock, Grid3x3, Table2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/firebase/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { toast } from 'sonner';
import { notifyInvitationAccepted, notifyInvitationDeclined } from '@/services/notificationService';

/**
 * TYPE: Single invitation to a meeting
 */
interface InvitationItem {
  id: string;  // Firestore document ID
  reunionId: string;  // Which meeting this is for
  callerId: string;  // Who sent the invitation (organizer)
  contactId: string;  // Who is being invited (Firebase UID)
  status: string;  // 'pending' | 'accepted' | 'declined'
  url: string;  // Join URL for the meeting
  roomId: string;  // Meeting room identifier
  viewed: boolean;  // Has this person seen the invitation
  debut: unknown;  // When they joined the meeting
  dateFin: unknown;  // When they left
  role: string;  // 'host' | 'co-host' | 'participant'
  createdAt: unknown;  // When invitation was sent
}

/**
 * TYPE: Meeting/Reunion data
 */
interface ReunionData {
  id: string;  // Firestore document ID
  title: string;
  description: string;
  creatorId: string;  // Who organized it
  status: string;  // 'scheduled' | 'in-progress' | 'completed'
  type: string;  // 'public' | 'private' | 'organizational'
  begin: Timestamp | number | string | null;  // When it starts
  roomId: string;  // Meeting room ID
  roomUrl: string;  // Join URL
}

/**
 * TYPE: Participant with their profile information
 */
interface ParticipantItem extends InvitationItem {
  profile: Record<string, unknown> | null;  // User's profile data
}

/**
 * HELPER: Format a date for display
 * Handles Firestore Timestamp, number (milliseconds), string (ISO), or null
 */
const dateToDisplay = (d: Timestamp | number | string | null) => {
  if (!d) return '—';
  try {
    if (d instanceof Timestamp) {
      return d.toDate().toLocaleString('fr-FR');
    }
    if (typeof d === 'number') return new Date(d).toLocaleString('fr-FR');
    return new Date(d).toLocaleString('fr-FR');
  } catch (e) {
    return '—';
  }
};

/**
 * HELPER: Get status badge component
 */
const getStatusBadge = (status: string) => {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-950/30">En attente</Badge>;
    case 'accepted':
      return <Badge className="bg-success dark:bg-success/20 text-success dark:text-success">Acceptée</Badge>;
    case 'declined':
      return <Badge variant="destructive">Refusée</Badge>;
    case 'missed':
      return <Badge variant="outline" className="bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">Manqué</Badge>;
    case 'expired':
      return <Badge variant="destructive">Terminée</Badge>;
    default:
      return null;
  }
};

/**
 * HELPER: Get meeting type badge
 */
const getTypeBadge = (type: string) => {
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

const FILTER_OPTIONS = [
  { value: 'all', label: 'Toutes', icon: Filter },
  { value: 'createdByMe', label: 'Créées par moi', icon: User },
  { value: 'invited', label: 'Où je suis invité', icon: UserPlus },
  { value: 'future', label: 'Réunions futures', icon: CalendarClock },
] as const;

/**
 * COMPONENT: Invitations Page
 */
const Invitations = () => {
  // ============================================================================
  // STATE & HOOKS
  // ============================================================================

  const { user } = useAuth();
  const navigate = useNavigate();

  // Reunions list with participant details
  const [reunions, setReunions] = useState<Array<{
    reunion: ReunionData
    participants: ParticipantItem[]
    myInvitation?: InvitationItem | null
    createdByMe: boolean
  }>>([]);

  // Filter and view options
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'createdByMe' | 'invited' | 'future'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 5;

  /**
   * EFFECT: Set up real-time listeners and build reunion list
   *
   * This is a COMPLEX effect that:
   * 1. Sets up real-time listeners on reunions and invitations
   * 2. Rebuilds the full reunion list whenever data changes
   * 3. Fetches all participant profiles in parallel
   * 4. Automatically includes the meeting creator as a participant
   * 5. Sorts by status (in-progress first) and date
   *
   * REAL-TIME LISTENERS:
   * Two onSnapshot listeners ensure list is always up-to-date:
   * 1. Listener on user's created reunions
   * 2. Listener on user's received invitations
   *
   * When either changes, the entire list is rebuilt.
   *
   * BUILD LIST PROCESS:
   *
   * Step 1: Query reunions and invitations
   *   - Get all reunions created by user
   *   - Get all invitations sent to user
   *
   * Step 2: Collect all reunion IDs
   *   - Add reunions user created
   *   - Add reunions from invitations user received
   *
   * Step 3: Fetch reunion documents
   *   - Get full reunion data for each ID
   *   - Handle errors gracefully (use null)
   *
   * Step 4: For each reunion, fetch all invitations
   *   - Get all invitation records for that reunion
   *   - For each invitation, fetch the contact's profile
   *
   * Step 5: Add meeting creator as automatic participant
   *   - If creator is not in invitation list, add them as 'host'
   *   - This ensures creator always appears in participant list
   *
   * Step 6: Enrich with user's perspective
   *   - Find user's own invitation (if any)
   *   - Determine if user created this meeting
   *
   * Step 7: Sort results
   *   - In-progress meetings first
   *   - Then by date (most recent first)
   *
   * DEPENDENCIES: [user]
   * - Rebuilds when user changes (different user = different reunions)
   */
  useEffect(() => {
    // Wait for user to load
    if (!user || !user.uid) {
      setLoading(false);
      return;
    }

    /**
     * Set up real-time listeners
     * These trigger buildList() whenever data changes
     */
    const createdQuery = query(collection(db, 'reunions'), where('creatorId', '==', user.uid));
    const unsubCreated = onSnapshot(createdQuery, async () => {
      // Reunions created by user changed, rebuild list
      await buildList();
    });

    const receivedQuery = query(collection(db, 'invitations'), where('contactId', '==', user.uid));
    const unsubReceived = onSnapshot(receivedQuery, async () => {
      // Invitations received by user changed, rebuild list
      await buildList();
    });

    // Build list immediately on mount
    void buildList();

    /**
     * COMPLEX FUNCTION: Build complete reunion list with all details
     *
     * This function is called whenever any relevant data changes.
     * It performs parallel queries to load all necessary data.
     */
    async function buildList() {
      setLoading(true);
      try {
        /**
         * Step 1: Query reunions and invitations for this user
         */
        const [createdSnap, receivedSnap] = await Promise.all([
          getDocs(query(collection(db, 'reunions'), where('creatorId', '==', user.uid))),
          getDocs(query(collection(db, 'invitations'), where('contactId', '==', user.uid)))
        ]);

        // Convert snapshots to typed arrays
        const createdReunions = createdSnap.docs.map(d => ({ id: d.id, ...(d.data() as ReunionData) })) as ReunionData[];
        const receivedInvitations = receivedSnap.docs.map(d => ({ id: d.id, ...(d.data() as InvitationItem) })) as InvitationItem[];

        /**
         * Step 2: Collect unique reunion IDs
         * Include both:
         * - Reunions user created
         * - Reunions user was invited to
         */
        const reunionIds = new Set<string>();
        createdReunions.forEach(r => reunionIds.add(r.id));
        receivedInvitations.forEach(i => i.reunionId && reunionIds.add(i.reunionId));

        /**
         * Step 3: Fetch all reunion documents in parallel
         * This loads the full metadata for each reunion
         */
        const reunionPromises = Array.from(reunionIds).map(reunionId =>
          getDoc(doc(db, 'reunions', reunionId))
            .then(snap => snap.exists() ? { id: snap.id, ...(snap.data() as ReunionData) } as ReunionData : null)
            .catch(e => {
              console.warn('Error loading reunion', reunionId, e);
              return null;  // Skip this reunion if it fails
            })
        );

        const reunions = await Promise.all(reunionPromises);
        const validReunions = reunions.filter((r): r is ReunionData => r !== null);

        /**
         * Step 4: For each reunion, load all participants and their profiles
         */
        const invitationPromises = validReunions.map(reunion =>
          getDocs(query(
            collection(db, 'invitations'),
            where('reunionId', '==', reunion.id),
            where(reunion.creatorId === user.uid ? 'callerId' : 'contactId', '==', user.uid),
          ))
            .then(async invSnap => {
              /**
               * Step 4a: Fetch profile for each participant
               * Profiles contain online status, email, phone
               */
              const participants = await Promise.all(
                invSnap.docs.map(async p => {
                  const pd = { id: p.id, ...(p.data() as InvitationItem) } as InvitationItem;
                  try {
                    const profSnap = await getDoc(doc(db, 'publicProfiles', pd.contactId));
                    return { ...pd, profile: profSnap.exists() ? profSnap.data() : null } as ParticipantItem;
                  } catch (e) {
                    return { ...pd, profile: null } as ParticipantItem;  // Graceful failure
                  }
                })
              );

              /**
               * Step 4b: Ensure meeting creator is in participant list
               * Even if they never formally accepted/joined, they should show as host
               */
              if (!participants.some(p => p.contactId === reunion.creatorId)) {
                try {
                  const creatorProfSnap = await getDoc(doc(db, 'publicProfiles', reunion.creatorId));
                  const creatorParticipant: ParticipantItem = {
                    id: `creator-${reunion.creatorId}`,  // Synthetic ID (not a real invitation)
                    reunionId: reunion.id,
                    callerId: reunion.creatorId,
                    contactId: reunion.creatorId,  // Same person
                    status: 'accepted',  // Always accepted
                    url: reunion.roomUrl || '',
                    roomId: reunion.roomId || '',
                    viewed: true,
                    debut: null,
                    dateFin: null,
                    role: 'host',  // Always host for creator
                    createdAt: reunion.begin || null,
                    profile: creatorProfSnap.exists() ? creatorProfSnap.data() as Record<string, unknown> : null,
                  };
                  participants.unshift(creatorParticipant);  // Add to front of list
                } catch (e) {
                  // If profile fetch fails, add creator without profile data
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

              /**
               * Step 4c: Find user's own invitation (if any)
               * Needed to show "Accept/Decline" buttons for this user
               */
              const myInvitation = participants.find(p => p.contactId === user.uid) || null;

              /**
               * Step 4d: Determine if user created this meeting
               * Determines which UI buttons to show
               */
              const createdByMe = reunion.creatorId === user.uid;

              return { reunion, participants, myInvitation, createdByMe };
            })
            .catch(e => {
              console.warn('Error loading invitations for reunion', e);
              return null;  // Skip this reunion if invitations fail
            })
        );

        // Wait for all invitation/participant loading
        const items = (await Promise.all(invitationPromises)).filter(item => item !== null) as Array<{
          reunion: ReunionData
          participants: ParticipantItem[]
          myInvitation?: InvitationItem | null
          createdByMe: boolean
        }>;

        /**
         * Step 5: Sort results
         * 1. In-progress meetings first (happening now)
         * 2. Then by date (most recent first)
         */
        items.sort((a, b) => {
          // Sort by status: in-progress first
          const aIsInProgress = a.reunion.status === 'in-progress';
          const bIsInProgress = b.reunion.status === 'in-progress';

          if (aIsInProgress && !bIsInProgress) return -1;  // a first
          if (!aIsInProgress && bIsInProgress) return 1;   // b first

          // Then sort by date (most recent first)
          const aBegin = a.reunion.begin;
          const bBegin = b.reunion.begin;
          const aT = aBegin ? (aBegin instanceof Timestamp ? aBegin.toDate().getTime() : (typeof aBegin === 'number' ? aBegin : new Date(aBegin).getTime())) : 0;
          const bT = bBegin ? (bBegin instanceof Timestamp ? bBegin.toDate().getTime() : (typeof bBegin === 'number' ? bBegin : new Date(bBegin).getTime())) : 0;
          return bT - aT;  // Newest first
        });

        // Update state with sorted list
        setReunions(items);
      } catch (err) {
        console.error('Error building reunions list', err);
        // Continue with empty list on error
      } finally {
        setLoading(false);
      }
    }

    // Cleanup: unsubscribe from listeners when component unmounts
    return () => {
      unsubCreated();
      unsubReceived();
    };
  }, [user]);

  /**
   * HANDLER: Accept an invitation to a meeting
   *
   * Called when user clicks "Accept" on a pending invitation.
   *
   * VALIDATIONS:
   * 1. Check meeting has room ID and URL (properly initialized)
   * 2. Check meeting hasn't started yet (can't join past meetings)
   *    Actually, can join if meeting is in-progress, just not future
   *
   * FIRESTORE UPDATES:
   * - Update invitation status to 'accepted'
   * - Mark as viewed (user has seen it)
   * - Add updatedAt timestamp
   *
   * NOTIFICATIONS:
   * - Send notification to meeting organizer (non-blocking)
   * - Tell them "User X has accepted"
   *
   * NAVIGATION:
   * - Navigate to /meeting/{roomId}
   * - User joins the video conference
   *
   * ERROR HANDLING:
   * - If meeting room not ready: show "Réunion indisponible"
   * - If meeting hasn't started yet: show "Elle sera accessible à partir du..."
   * - If update fails: show "Erreur lors de l'acceptation"
   *
   * @param invitationId The invitation document ID to accept
   * @param invitation Full invitation data
   * @param reunion The meeting being invited to
   */
  const handleAcceptInvitation = useCallback(async (invitationId: string, invitation: InvitationItem, reunion: ReunionData) => {
    if (!user?.uid) return;
    try {
      /**
       * Step 1: Validate meeting timing
       * User can only join if:
       * - Meeting has started (beginTime <= now)
       * - Meeting hasn't been completed (status != 'completed')
       */
      const beginTime = reunion.begin
        ? (reunion.begin instanceof Timestamp
          ? reunion.begin.toDate().getTime()
          : (typeof reunion.begin === 'number' ? reunion.begin : new Date(reunion.begin).getTime()))
        : 0;
      const now = Date.now();

      // Check meeting has proper room setup
      if (!reunion.roomId || !reunion.roomUrl) {
        toast.error(`Réunion indisponible pour l'instant. Elle sera accessible ultérieurement une fois le lien généré.`);
        return;
      }

      // Check meeting hasn't started yet
      if (beginTime > now) {
        const dateStr = dateToDisplay(reunion.begin);
        toast.error(`Réunion indisponible pour l'instant. Elle sera accessible à partir du ${dateStr}.`);
        return;
      }

      /**
       * Step 2: Update invitation in Firestore
       * Change status from 'pending' to 'accepted'
       */
      await updateDoc(doc(db, 'invitations', invitationId), {
        status: 'accepted',
        viewed: true,  // Mark as read
        updatedAt: serverTimestamp()
      });
      toast.success('Invitation acceptée');

      /**
       * Step 3: Notify the meeting organizer (non-blocking)
       * They should know someone accepted their invitation
       */
      try {
        await notifyInvitationAccepted(
          invitation.callerId,  // Who to notify (the organizer)
          invitation.reunionId,  // Which meeting
          invitationId,  // Which invitation
          user.displayName || user.email || 'User',  // Who accepted
        );
      } catch (e) {
        console.warn('Error notifying caller', e);
        // Continue - notification is nice-to-have
      }

      /**
       * Step 4: Navigate to the meeting room
       * User is now joining the video conference
       */
      const roomId = invitation.roomId || (invitation as InvitationItem & { zegoRoomId?: string }).zegoRoomId || reunion.roomId;
      const joinPath = `/meeting/${encodeURIComponent(roomId)}`;
      navigate(joinPath);

    } catch (error) {
      console.error('Error accepting invitation', error);
      toast.error('Erreur lors de l\'acceptation');
    }
  }, [user, navigate]);

  /**
   * HANDLER: Decline/Reject an invitation
   *
   * Called when user clicks "Decline" on a pending invitation.
   *
   * PROCESS:
   * 1. Update invitation status to 'declined'
   * 2. Mark as viewed (user has seen it)
   * 3. Notify the organizer (non-blocking)
   * 4. Show success toast
   *
   * FIRESTORE UPDATES:
   * - Collection: invitations
   * - Set status = 'declined'
   * - Set viewed = true
   * - Add updatedAt timestamp
   *
   * NOTIFICATIONS:
   * - Tell organizer "User X has declined"
   * - Organizer can see in their meeting details who declined
   *
   * UI BEHAVIOR:
   * - Pending invitation disappears from user's list
   * - In organizer's view, shows "Refusée" status
   * - Meeting continues without this person
   *
   * @param invitationId The invitation document ID to decline
   */
  const handleDeclineInvitation = useCallback(async (invitationId: string) => {
    if (!user?.uid) return;
    try {
      /**
       * Step 1: Fetch invitation data to get organizer info
       * We need callerId and reunionId to notify them
       */
      const invSnap = await getDoc(doc(db, 'invitations', invitationId));
      let callerId: string | null = null;
      let reunionId: string | null = null;
      if (invSnap.exists()) {
        const data = invSnap.data() as InvitationItem;
        callerId = data.callerId;  // Who to notify
        reunionId = data.reunionId;  // Which meeting
      }

      /**
       * Step 2: Update invitation status to 'declined'
       */
      await updateDoc(doc(db, 'invitations', invitationId), {
        status: 'declined',  // User is not coming
        viewed: true,  // Mark as read
        updatedAt: serverTimestamp(),
      });
      toast.success('Invitation refusée');

      /**
       * Step 3: Notify the organizer (non-blocking)
       * Tell them "User X declined your invitation"
       */
      if (callerId && reunionId) {
        await notifyInvitationDeclined(
          callerId,  // Who to notify (the organizer)
          reunionId,  // Which meeting
          invitationId,  // Which invitation
          user.displayName || user.email || 'User',  // Who declined
        );
      }
    } catch (error) {
      console.error('Error declining invitation', error);
      toast.error('Erreur lors du refus');
    }
  }, [user]);

  const getParticipantName = (participant: ParticipantItem) => {
    const profile = participant.profile as Record<string, unknown> | null;
    if (!profile) return participant.contactId;
    const displayName = (profile['displayName'] as unknown as string) || (profile['name'] as unknown as string) || participant.contactId;
    return displayName;
  };

  const getParticipantDisplayName = (participant: ParticipantItem) => {
    if (participant.contactId === user?.uid) {
      return "Vous";
    }
    const fullName = getParticipantName(participant);
    return fullName.length > 15 ? fullName.substring(0, 15) + '...' : fullName;
  };

  const isCurrentUser = (participant: ParticipantItem) => {
    return participant.contactId === user?.uid;
  };

  const filteredReunions = useMemo(() =>
    reunions.filter(({ reunion, myInvitation, createdByMe }) => {
      if (filter === 'createdByMe') {
        return createdByMe;
      }
      if (filter === 'invited') {
        return !createdByMe && !!myInvitation;
      }
      if (filter === 'future') {
        const begin = reunion.begin;
        const beginTime = begin
          ? (begin instanceof Timestamp
            ? begin.toDate().getTime()
            : (typeof begin === 'number' ? begin : new Date(begin).getTime()))
          : 0;
        return beginTime > Date.now();
      }
      return true;
    }), [reunions, filter]
  );

  const totalPages = Math.ceil(filteredReunions.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedReunions = filteredReunions.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="dashboard-surface landing-page mx-auto w-full max-w-[1440px] space-y-6 pb-8">
        <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Mail className="h-4 w-4 text-primary" /> Réunions et invitations
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">Votre planning</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Retrouvez vos réunions créées et les invitations reçues.</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="rounded-full px-3 py-1">{reunions.length} réunion{reunions.length === 1 ? '' : 's'}</Badge>
            <Link to="/invitations/new" className="shrink-0">
              <Button className="h-11 rounded-full px-5 font-semibold shadow-sm shadow-primary/15">
                <Plus className="mr-2 h-4 w-4" /> Nouvelle réunion
              </Button>
            </Link>
          </div>
        </section>

        <div className="dashboard-card flex flex-col gap-4 rounded-[1.5rem] p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {FILTER_OPTIONS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                type="button"
                variant={filter === value ? 'default' : 'outline'}
                size="sm"
                className="h-8 gap-1.5 rounded-full px-3.5 text-xs"
                onClick={() => setFilter(value)}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
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
          {filteredReunions.length === 0 && (
            <div className="dashboard-card rounded-[1.5rem] border-dashed px-6 py-16 text-center">
              <div className="dashboard-empty-icon mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"><Mail className="h-6 w-6" /></div>
              <h2 className="text-lg font-semibold text-foreground">Aucune réunion dans cette vue</h2>
              <p className="mb-5 mt-2 text-sm text-muted-foreground">Modifiez le filtre ou créez une réunion pour la retrouver ici.</p>
              <Link to="/invitations/new">
                <Button className="rounded-full font-semibold"><Plus className="mr-2 h-4 w-4" /> Créer une réunion</Button>
              </Link>
            </div>
          )}

          {viewMode === 'grid' && paginatedReunions.map(({ reunion, participants, myInvitation, createdByMe }) => {
            const acceptedCount = participants.filter(p => p.status === 'accepted').length;
            const pendingCount = participants.filter(p => p.status === 'pending').length;

            return (
              <div
                key={reunion.id}
                className={`dashboard-card space-y-4 rounded-[1.5rem] p-5 transition-shadow hover:shadow-lg sm:p-6 ${createdByMe ? 'border-primary/30' : ''}`}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words text-base font-semibold sm:text-lg">{reunion.title}</h3>
                    {getStatusBadge(reunion.status)}
                    {getTypeBadge(reunion.type)}
                    {createdByMe && <Badge>Créateur</Badge>}
                    {!createdByMe && myInvitation?.status === 'pending' && <Badge>Invité</Badge>}
                  </div>
                  {reunion.description && (
                    <p className="text-sm text-muted-foreground">{reunion.description}</p>
                  )}
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {dateToDisplay(reunion.begin)}
                  </div>
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {acceptedCount}/{participants.length} accepté(s)
                  </div>
                  {pendingCount > 0 && (
                    <div className="flex items-center gap-1">
                      <Mail className="h-4 w-4" />
                      {pendingCount} en attente
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 break-words text-sm text-muted-foreground">
                    Participants : {participants.map(p => getParticipantDisplayName(p)).join(', ')}
                  </p>

                  <div className="flex flex-wrap gap-2 sm:shrink-0">
                    {reunion.status === 'in-progress' && (
                      <Button
                        size="sm"
                        className="rounded-full bg-success hover:bg-success/90"
                        onClick={() => navigate(`/meeting/${encodeURIComponent(reunion.roomId || reunion.id)}?userName=${encodeURIComponent(user?.displayName || user?.email || 'User')}`)}
                      >
                        Rejoindre
                      </Button>
                    )}
                    {!createdByMe && myInvitation?.status === 'pending' && (
                      <>
                        <Button
                          size="sm"
                          className="rounded-full"
                          onClick={() => handleAcceptInvitation(myInvitation.id, myInvitation, reunion)}
                        >
                          Accepter
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => handleDeclineInvitation(myInvitation.id)}
                        >
                          Refuser
                        </Button>
                      </>
                    )}
                    {createdByMe && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => navigate(`/calls/${reunion.id}`)}
                      >
                        Gérer
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {participants.map((participant) => (
                    <div
                      key={participant.id}
                      className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-background/60 p-2.5 text-sm"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {isCurrentUser(participant) ? 'V' : getParticipantName(participant).charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate font-medium ${isCurrentUser(participant) ? 'font-bold text-primary' : ''}`}>
                          {getParticipantDisplayName(participant)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {participant.status === 'accepted' && '✓ Accepté'}
                          {participant.status === 'pending' && '⏱ En attente'}
                          {participant.status === 'declined' && '✗ Refusé'}
                          {participant.status === 'missed' && '⏱ Manqué'}
                          {participant.contactId === reunion.creatorId && ' • Organisateur'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {viewMode === 'table' && filteredReunions.length > 0 && (
            <div className="dashboard-card overflow-hidden rounded-[1.5rem]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/40">
                      <th className="px-4 py-4 text-left font-semibold text-foreground sm:px-6">Titre</th>
                      <th className="hidden px-6 py-4 text-left font-semibold text-foreground md:table-cell">Type</th>
                      <th className="px-4 py-4 text-left font-semibold text-foreground sm:px-6">Statut</th>
                      <th className="hidden px-6 py-4 text-left font-semibold text-foreground lg:table-cell">Date</th>
                      <th className="px-4 py-4 text-center font-semibold text-foreground sm:px-6">Participants</th>
                      <th className="px-4 py-4 text-right font-semibold text-foreground sm:px-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedReunions.map(({ reunion, participants, myInvitation, createdByMe }) => {
                      const acceptedCount = participants.filter(p => p.status === 'accepted').length;
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
                          <td className="px-4 py-4 sm:px-6">{getStatusBadge(reunion.status)}</td>
                          <td className="hidden px-6 py-4 text-foreground lg:table-cell">{dateToDisplay(reunion.begin)}</td>
                          <td className="px-4 py-4 text-center sm:px-6">
                            <Badge variant="outline">{acceptedCount}/{participants.length}</Badge>
                          </td>
                          <td className="px-4 py-4 text-right sm:px-6">
                            <div className="flex flex-wrap justify-end gap-2">
                              {reunion.status === 'in-progress' && (
                                <Button
                                  size="sm"
                                  className="rounded-full bg-success hover:bg-success/90"
                                  onClick={() => navigate(`/meeting/${encodeURIComponent(reunion.roomId || reunion.id)}?userName=${encodeURIComponent(user?.displayName || user?.email || 'User')}`)}
                                >
                                  Rejoindre
                                </Button>
                              )}
                              {!createdByMe && myInvitation?.status === 'pending' && (
                                <>
                                  <Button
                                    size="sm"
                                    className="rounded-full"
                                    onClick={() => handleAcceptInvitation(myInvitation.id, myInvitation, reunion)}
                                  >
                                    Accepter
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="rounded-full"
                                    onClick={() => handleDeclineInvitation(myInvitation.id)}
                                  >
                                    Refuser
                                  </Button>
                                </>
                              )}
                              {createdByMe && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-full"
                                  onClick={() => navigate(`/calls/${reunion.id}`)}
                                >
                                  Gérer
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {filteredReunions.length > 0 && (
            <div className="dashboard-card flex flex-col gap-3 rounded-[1.5rem] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Affichage {startIndex + 1} à {Math.min(endIndex, filteredReunions.length)} sur {filteredReunions.length} réunions
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

export default Invitations;
