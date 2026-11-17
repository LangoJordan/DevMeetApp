/**
 * ============================================================================
 * PAGE: Contacts.tsx - Gestion des contacts utilisateurs et appels directs
 * ============================================================================
 *
 * Cette page affiche les contacts sauvegardés de l'utilisateur et permet d'initier des appels.
 *
 * RESPONSABILITÉS PRINCIPALES:
 * 1. Afficher les contacts sauvegardés de l'utilisateur depuis Firestore
 * 2. Afficher le statut en ligne/hors ligne pour chaque contact
 * 3. Rechercher et filtrer les contacts
 * 4. Initier des appels directs aux contacts
 * 5. Envoyer des invitations par email lors de l'appel
 * 6. Suivre les appels manqués
 * 7. Éditer et supprimer les contacts
 *
 * MODÈLE DE DONNÉES:
 * Chaque contact est un document dans la collection 'contacts':
 * {
 *   creatorId: string (UID Firebase de qui a sauvegardé ceci)
 *   name: string
 *   email: string
 *   phone?: string
 *   avatar?: string
 *   invitId: string (UID Firebase de la personne de contact)
 * }
 *
 * INTERACTIONS FIRESTORE:
 * Collections accédées:
 *   - contacts: Contacts sauvegardés
 *   - invitations: Appels en attente/actifs
 *   - profiles: Statut en ligne, email, téléphone
 *   - reunions: Créé lors de l'initiation d'un appel
 *
 * SERVICES BACKEND:
 *   - POST /api/send-invitations-email: Notification par email
 *
 * FONCTIONNALITÉS EN TEMPS RÉEL:
 * - Statut en ligne/hors ligne du contact (via hook useContactPresence)
 * - Suivi des invitations actives (qui appelle/vous appelle)
 * - Nombre d'appels manqués à partir des notifications
 *
 * DIAGRAMME DE FLUX - Initier un appel:
 * 1. Cliquer sur le bouton "Appeler" du contact
 * 2. Créer un document 'reunion' dans Firestore
 * 3. Créer une 'invitation' pour l'appelant (auto-acceptée)
 * 4. Créer une 'invitation' pour l'appelé (en attente)
 * 5. Envoyer une notification (notifyInvitationReceived)
 * 6. Envoyer une invitation par email (non-bloquante)
 * 7. Naviguer vers /meeting/roomId
 * 8. L'appelé reçoit une notification d'appel entrant
 */

import { useState, useEffect, useCallback } from 'react';
import { useContactPresence } from '@/hooks/useContactPresence';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Phone, MessageSquare, Edit, Trash2, Grid3x3, Table2, Filter, Users, RefreshCw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { db } from '@/firebase/firebase';
import { collection, query, where, deleteDoc, doc, getDoc, getDocs, serverTimestamp, addDoc, setDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { notifyInvitationReceived } from '@/services/notificationService';
import { useNotifications } from '@/hooks/useNotifications';
import { useMessages } from '@/context/MessagesContext';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    AudioContext?: typeof AudioContext;
  }
}

/**
 * TYPE: A contact in the user's address book
 */
interface ContactItem {
  id: string;  // Firestore document ID (not the same as invitId)
  creatorId: string;  // Firebase UID of contact owner
  invitId: string;  // Firebase UID of the actual contact (used for invitations)
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  isOnline: boolean;  // Current online status
  activeIncomingInvitationId?: string;  // If they're calling you
  activeOutgoingInvitationId?: string;  // If you're calling them
}

/**
 * TYPE: Pending or active invitation data
 */
interface InvitationData {
  id?: string;
  callerId?: string;  // Who initiated the call
  contactId?: string;  // Who's being called
  status?: string;  // 'pending' | 'accepted' | 'declined'
  reunionId?: string;  // Which meeting/call
  roomId?: string;  // Meeting room identifier
  url?: string;  // Join URL
  debut?: Timestamp | number | string | null;  // When they joined
  dateFin?: Timestamp | number | string | null;  // When they left
  createdAt?: Timestamp | number | string | Date | null;  // When invitation created
}

const Contacts = () => {
  // ============================================================================
  // STATE & HOOKS
  // ============================================================================

  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { notifications } = useNotifications();
  const { createDirectConversation } = useMessages();

  // Contact list state
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Filtering & searching
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'online' | 'offline'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Call and messaging state
  const [callingId, setCallingId] = useState<string | null>(null);
  const [messagingContactId, setMessagingContactId] = useState<string | null>(null);
  const [missedCallsCount, setMissedCallsCount] = useState(0);

  const openContactConversation = async (contact: ContactItem) => {
    if (!contact.invitId?.trim()) {
      toast.error("Ce contact n'est pas lié à un compte utilisateur");
      return;
    }

    setMessagingContactId(contact.id);
    try {
      const conversation = await createDirectConversation(contact.invitId);
      if (!conversation.id) throw new Error('Conversation id is missing');
      navigate('/messages', { state: { conversationId: conversation.id } });
    } catch (error) {
      console.error('Error opening contact conversation:', error);
      toast.error("Impossible d'ouvrir la discussion");
    } finally {
      setMessagingContactId(null);
    }
  };

  /**
   * HANDLER: Initiate a direct call to a contact
   *
   * This is the main calling flow triggered by clicking the "Call" button on a contact.
   *
   * PROCESS:
   * 1. Generate unique room ID for the call
   * 2. Create reunion document (meeting metadata)
   * 3. Create auto-accepted invitation for caller
   * 4. Create pending invitation for callee
   * 5. Send notification to callee (in-app)
   * 6. Send email invitation to callee (if email available)
   * 7. Navigate caller to meeting room
   * 8. Callee receives incoming call notification
   *
   * FIRESTORE WRITES:
   *
   * 1. Create Reunion:
   *    - Collection: reunions
   *    - title: "Appel avec {contact.name}"
   *    - status: 'scheduled' (will become 'in-progress' when first participant joins)
   *    - type: 'private' (only participants can join)
   *    - roomId: room_${timestamp}_${userId}
   *    - creatorId: current user (the caller)
   *    - begin: serverTimestamp()
   *
   * 2. Create Caller's Invitation:
   *    - Collection: invitations
   *    - status: 'accepted' (caller auto-joins)
   *    - role: 'host'
   *    - debut: serverTimestamp() (they're joining now)
   *    - dateFin: null (not left yet)
   *
   * 3. Create Callee's Invitation:
   *    - Collection: invitations
   *    - contactId: contact.invitId (who's being called)
   *    - status: 'pending' (waiting for response)
   *    - role: 'participant'
   *    - debut/dateFin: null (hasn't joined)
   *
   * NOTIFICATIONS:
   *
   * 1. In-app notification:
   *    - notifyInvitationReceived() creates document in 'notifications'
   *    - Callee's app watches 'notifications' and shows incoming call UI
   *
   * 2. Email notification:
   *    - POST /api/send-invitations-email (backend)
   *    - SMTP email sent via Node.js server
   *    - Non-blocking (doesn't block calling flow)
   *    - Callee can join via email link without opening app
   *
   * FRONTEND NAVIGATION:
   * Caller is immediately navigated to /meeting/roomId
   * This opens the native video room
   *
   * CALLEE EXPERIENCE:
   * 1. Receives in-app notification (if online)
   * 2. Receives email (if email available)
   * 3. Sees "incoming call" UI with Accept/Decline
   * 4. Clicking accept joins the meeting
   * 5. Clicking decline sets status to 'declined'
   *
   * @param contact The contact to call
   */
  const initiateCall = async (contact: ContactItem) => {
    // Validate preconditions
    if (!user) {
      toast.error("Vous devez être connecté pour lancer un appel");
      return;
    }

    if (!contact || !contact.invitId) {
      toast.error("Impossible d'initier l'appel : ce contact n'est pas correctement lié à un utilisateur.");
      return;
    }

    try {
      // Show loading spinner on this contact's button
      setCallingId(contact.id);

      // Generate identifiers for this call
      const callerName = user.displayName || user.email || 'User';
      const roomId = `room_${Date.now()}_${user.uid}`;  // Unique room identifier
      const roomUrl = `${window.location.origin}/meeting/${encodeURIComponent(roomId)}?userName=${encodeURIComponent(callerName)}`;

      /**
       * STEP 1: Create reunion document (meeting metadata)
       * This is the parent document for all invitations in this call
       */
      const reunionRef = await addDoc(collection(db, 'reunions'), {
        title: `Appel avec ${contact.name}`,
        description: `Appel initié via contact ${contact.name}`,
        creatorId: user.uid,  // The caller is the organizer
        hostId: user.uid,
        maxParticipants: 6,
        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
        status: 'scheduled',  // Will change to 'in-progress' when first person joins
        begin: serverTimestamp(),
        type: 'private',  // Only participants can join
        invitedUserIds: [user.uid, contact.invitId],
        roomId,
        roomUrl,
        createdAt: serverTimestamp(),
      });

      /**
       * STEP 2: Create caller's invitation (auto-accepted)
       * Caller automatically joins, doesn't need to accept
       */
      const callerInvitationRef = await addDoc(collection(db, 'invitations'), {
        reunionId: reunionRef.id,
        callerId: user.uid,
        contactId: user.uid,  // Caller's own Firebase UID
        createdAt: serverTimestamp(),
        debut: serverTimestamp(),  // Already in the call
        dateFin: null,
        role: 'host',  // Caller has control
        status: 'accepted',  // Auto-accepted
        viewed: false,
        url: roomUrl,
        roomId,
      });
      await setDoc(doc(db, 'reunions', reunionRef.id, 'roomMembers', user.uid), {
        uid: user.uid,
        role: 'host',
        invitationId: callerInvitationRef.id,
        kicked: false,
      });

      /**
       * STEP 3: Create callee's invitation (pending response)
       * Callee must accept to join
       */
      const calleeInvRef = await addDoc(collection(db, 'invitations'), {
        reunionId: reunionRef.id,
        callerId: user.uid,  // Who initiated
        contactId: contact.invitId,  // Who's being called (Firebase UID)
        createdAt: serverTimestamp(),
        debut: null,  // Haven't joined yet
        dateFin: null,
        role: 'participant',
        status: 'pending',  // Waiting for them to accept
        viewed: false,
        url: roomUrl,
        roomId,
      });
      /**
       * STEP 4: Send in-app notification to callee
       * Creates document in 'notifications' collection
       * Callee's app watches this and shows incoming call UI
       * Non-blocking: if it fails, call still happens
       */
      try {
        await notifyInvitationReceived(
          user.uid,
          reunionRef.id,
          calleeInvRef.id,
          contact.invitId,
          callerName,
        );
      } catch (e) {
        console.warn('Failed to send invitation notification', e);
        // Continue - notification is nice-to-have
      }

      /**
       * STEP 5: Send email invitation (non-blocking)
       * Fire-and-forget API call to backend
       * Backend sends SMTP email with join link
       * Callee can join via email without opening app
       */
      try {
        const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '');
        if (contact.email && apiBaseUrl) {
          const emailInvitation = {
            toEmail: contact.email,
            toName: contact.name,
            meetingTitle: `Appel avec ${contact.name}`,
            meetingDescription: `Appel initié via contact ${contact.name}`,
            begin: new Date().toISOString(),
            roomUrl,
          };

          // Fire-and-forget: Don't await, don't show error if it fails
          void fetch(`${apiBaseUrl}/api/send-invitations-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invitations: [emailInvitation] }),
          }).catch((err) => {
            // Call already initiated in Firestore, email is just a notification
            console.warn('Failed to call send-invitations-email endpoint from Contacts', err);
          });
        }
      } catch (emailErr) {
        console.warn('Error preparing contact invitation email', emailErr);
        // Continue - email is nice-to-have
      }

      /**
       * STEP 6: Navigate caller to the meeting room
       * Caller is immediately taken to the video conference
       */
      navigate(
        `/meeting/${encodeURIComponent(roomId)}?userName=${encodeURIComponent(
          callerName,
        )}&isCaller=true`,
      );
    } catch (err) {
      console.error("Erreur lors de l'initiation de l'appel", err);
      toast.error("Impossible d'initier l'appel. Réessayez.");
    } finally {
      // Hide loading spinner
      setCallingId(null);
    }
  };


  // Filter contacts based on search and status
  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (contact.phone?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);
    
    const matchesStatus = filterStatus === 'all' || 
      (filterStatus === 'online' && contact.isOnline) ||
      (filterStatus === 'offline' && !contact.isOnline);
    
    return matchesSearch && matchesStatus;
  });

  useEffect(() => {
    const missedInvitations = notifications.filter(
      n => n.type === 'invitation_missed' && !n.viewed
    ).length;
    setMissedCallsCount(missedInvitations);
  }, [notifications]);

  const handleDelete = async (id: string) => {
    toast('Supprimer le contact ?', {
      description: 'Cette action est irréversible.',
      action: {
        label: "Supprimer",
        onClick: async () => {
          try {
            await deleteDoc(doc(db, "contacts", id));
            toast.success('Contact supprimé avec succès');
          } catch (error) {
            console.error("Erreur lors de la suppression:", error);
            toast.error('Erreur de suppression');
          }
        },
      },
      cancel: { label: "Annuler" },
      duration: 10000,
    });
  };

  const TableRowContact = ({ contact: contactProp }: { contact: ContactItem }) => {
    const presenceIsOnline = useContactPresence(contactProp.invitId);
    const isCallingThisContact = Boolean(contactProp.activeOutgoingInvitationId);
    const isThisContactInvitingMe = Boolean(contactProp.activeIncomingInvitationId);

    return (
      <tr className="border-b border-border/30 hover:bg-primary/5 transition-colors group">
        <td className="px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-bold text-sm border border-primary/30 group-hover:scale-105 transition-transform">
              {(contactProp.name?.charAt(0) || 'U').toUpperCase()}
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-foreground group-hover:text-primary transition-colors">{contactProp.name}</span>
              {(isCallingThisContact || isThisContactInvitingMe) && (
                <Badge className="w-fit bg-blue-500 text-white text-xs">
                  {isCallingThisContact ? "Appel en cours" : "Appel entrant"}
                </Badge>
              )}
            </div>
          </div>
        </td>
        <td className="px-6 py-4 text-foreground">{contactProp.email}</td>
        <td className="px-6 py-4 text-foreground">{contactProp.phone || '—'}</td>
        <td className="px-6 py-4 text-center">
          <Badge className={presenceIsOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300' : 'border-border bg-muted/60 text-muted-foreground'}>
            <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${presenceIsOnline ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
            {presenceIsOnline ? 'En ligne' : 'Hors ligne'}
          </Badge>
        </td>
        <td className="px-6 py-4 text-right">
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openContactConversation(contactProp)}
              disabled={!contactProp.invitId || messagingContactId === contactProp.id}
              aria-label={`Ouvrir la discussion avec ${contactProp.name}`}
              title="Envoyer un message"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => initiateCall(contactProp)}
              disabled={!contactProp.invitId || callingId === contactProp.id}
              className="bg-primary hover:bg-primary/90 text-white"
            >
              {callingId === contactProp.id ? (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <Phone className="h-4 w-4" />
              )}
            </Button>
            <Link to={`/contacts/${contactProp.id}/edit`}>
              <Button variant="outline" size="sm" className="hover:bg-muted/60">
                <Edit className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDelete(contactProp.id)}
              className="hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  const ContactCard = ({ contact: contactProp }: { contact: ContactItem }) => {
    const contact = {
      ...contactProp,
      invitId: typeof contactProp.invitId === 'string' ? contactProp.invitId : '',
    };
    const presenceIsOnline = useContactPresence(contact.invitId);
    const isCallingThisContact = Boolean(contact.activeOutgoingInvitationId);
    const isThisContactInvitingMe = Boolean(contact.activeIncomingInvitationId);
    const isCalling = callingId === contact.id;

    return (
      <article className="dashboard-card flex h-full flex-col rounded-2xl p-5 transition-shadow duration-200 hover:shadow-lg">
        <div className="flex items-start gap-3">
          <div className="dashboard-tone-mint flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold">
            {(contact.name?.charAt(0) || 'U').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="truncate text-base font-semibold leading-5 text-foreground">{contact.name}</h3>
            <p className="mt-1 truncate text-sm text-muted-foreground">{contact.email}</p>
          </div>
          <span className={`mt-1 flex shrink-0 items-center gap-1.5 text-xs font-medium ${presenceIsOnline ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
            <span className={`h-2 w-2 rounded-full ${presenceIsOnline ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
            {presenceIsOnline ? 'En ligne' : 'Hors ligne'}
          </span>
        </div>

        {(isCallingThisContact || isThisContactInvitingMe) && (
          <div className="mt-4">
            <Badge variant="secondary" className="rounded-full bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
              {isCallingThisContact ? 'Appel en cours' : 'Appel entrant'}
            </Badge>
          </div>
        )}

        <div className="mt-5 min-h-10 border-t border-border/70 pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Téléphone</p>
          <p className="mt-1 truncate text-sm text-foreground">{contact.phone || 'Non renseigné'}</p>
        </div>

        <div className="mt-auto flex items-center gap-2 border-t border-border/70 pt-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => openContactConversation(contact)}
            disabled={!contact.invitId || messagingContactId === contact.id}
            className="h-10 w-10 shrink-0 rounded-xl"
            aria-label={`Ouvrir la discussion avec ${contact.name}`}
            title="Envoyer un message"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => initiateCall(contact)}
            disabled={!contact.invitId || isCalling}
            className="h-10 flex-1 rounded-xl font-semibold"
          >
            {isCalling ? (
              <>
                <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Appel…
              </>
            ) : (
              <><Phone className="mr-2 h-4 w-4" /> Appeler</>
            )}
          </Button>
          <Link to={`/contacts/${contact.id}/edit`}>
            <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl" aria-label={`Modifier ${contact.name}`} title="Modifier">
              <Edit className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleDelete(contact.id)}
            className="h-10 w-10 rounded-xl hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Supprimer ${contact.name}`}
            title="Supprimer"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </article>
    );
  };


  /**
   * HANDLER: Load user's contacts from Firestore
   *
   * Fetches:
   * 1. User's saved contacts from 'contacts' collection
   * 2. Pending invitations (outgoing and incoming)
   * 3. Profile data for each contact (to get online status)
   *
   * FIRESTORE QUERIES:
   *
   * Query 1: Get all contacts for this user
   *   - Collection: contacts
   *   - Filter: creatorId == user.uid
   *   - Returns: Basic contact info
   *
   * Query 2: Get outgoing invitations
   *   - Collection: invitations
   *   - Filter: status == 'pending' AND callerId == user.uid
   *   - Purpose: Show if user is currently calling a contact
   *
   * Query 3: Get incoming invitations
   *   - Collection: invitations
   *   - Filter: status == 'pending' AND contactId == user.uid
   *   - Purpose: Show if contact is calling user
   *
   * For each contact:
   *   - Query 4: Get contact's profile
   *   - Collection: profiles
   *   - ID: contact.invitId (Firebase UID)
   *   - Returns: Online status, email, phone (more current than contacts doc)
   *
   * PARALLEL LOADING:
   * - All profile queries run in parallel (not sequential)
   * - Faster loading for large contact lists
   * - Graceful degradation: if profile load fails, use contact data
   *
   * DATA ENRICHMENT:
   * Contact document has:
   *   - name, email, phone (saved by user)
   * Profile document has (more current):
   *   - isOnline (updated by heartbeat)
   *   - email (from auth)
   *   - phone (profile can update)
   *
   * This function prefers profile data for email/phone (more current).
   *
   * SORTING:
   * - Alphabetical by name
   *
   * OPTIONAL REFRESH NOTIFICATION:
   * - If forceRefresh=true, show toast with count
   * - Used when user clicks "Refresh" button
   *
   * @param forceRefresh Show success toast if true
   */
  const loadContacts = useCallback(async (forceRefresh = false) => {
    if (!user) {
      setContacts([]);
      setLoadingContacts(false);
      return;
    }

    setLoadingContacts(true);
    setIsRefreshing(true);

    try {
      /**
       * QUERY 1: Get this user's saved contacts
       */
      const contactsRef = collection(db, "contacts");
      const q = query(contactsRef, where("creatorId", "==", user.uid));
      const contactsSnapshot = await getDocs(q);

      /**
       * QUERY 2 & 3: Get pending invitations (both directions)
       * This tells us if user is currently calling or being called by a contact
       */
      const invitationsQuery = query(
        collection(db, 'invitations'),
        where('status', '==', 'pending'),
        where('callerId', 'in', [user.uid])  // User is calling someone
      );
      const invitationsQuery2 = query(
        collection(db, 'invitations'),
        where('status', '==', 'pending'),
        where('contactId', 'in', [user.uid])  // Someone is calling user
      );

      // Run both queries in parallel
      const [invitationsSnapshot1, invitationsSnapshot2] = await Promise.all([
        getDocs(invitationsQuery),
        getDocs(invitationsQuery2)
      ]);

      // Combine all pending invitations
      const currentInvitations: InvitationData[] = [];
      invitationsSnapshot1.forEach(doc => {
        currentInvitations.push({ id: doc.id, ...doc.data() } as InvitationData);
      });
      invitationsSnapshot2.forEach(doc => {
        currentInvitations.push({ id: doc.id, ...doc.data() } as InvitationData);
      });

      /**
       * QUERY 4: Load profile data for each contact (in parallel)
       * Profile data has the current online status and contact info
       */
      const fetchedContacts: ContactItem[] = [];
      const profilePromises: Promise<void>[] = [];

      for (const contactDoc of contactsSnapshot.docs) {
        const contactData = contactDoc.data();
        const invitId = String(contactData.invitId || '');

        if (invitId) {
          // Create async task to load profile data
          const profilePromise = getDoc(doc(db, "publicProfiles", invitId))
            .then(profileSnap => {
              const profileData = profileSnap.exists() ? profileSnap.data() : {};

              // Check if there's an active outgoing invitation to this contact
              const activeOutgoingInvitation = currentInvitations.find(inv =>
                inv.callerId === user?.uid && inv.contactId === String(invitId)
              );

              // Check if there's an active incoming invitation from this contact
              const activeIncomingInvitation = currentInvitations.find(inv =>
                inv.callerId === String(invitId) && inv.contactId === user?.uid
              );

              // Combine contact data with profile data (profile takes precedence)
              fetchedContacts.push({
                id: contactDoc.id,
                creatorId: contactData.creatorId,
                invitId,
                name: contactData.name || "Nom inconnu",
                // Use profile email if available (more current), otherwise use contact email
                email: (profileData.email as string) || contactData.email || "email@inconnu.com",
                // Same for phone
                phone: (profileData.phone as string) || contactData.phone || "",
                avatar: (profileData.avatar as string) || contactData.avatar || "",
                // Online status from profile (updated by heartbeat)
                isOnline: (profileData.isOnline as boolean) || false,
                activeOutgoingInvitationId: activeOutgoingInvitation?.id,
                activeIncomingInvitationId: activeIncomingInvitation?.id,
              });
            })
            .catch(error => {
              console.error("Erreur lors du chargement du profil:", error);
              // Fallback: use contact data if profile lookup fails
              fetchedContacts.push({
                id: contactDoc.id,
                creatorId: contactData.creatorId,
                invitId,
                name: contactData.name || "Nom inconnu",
                email: contactData.email || "email@inconnu.com",
                phone: contactData.phone || "",
                avatar: contactData.avatar || "",
                isOnline: false,  // Assume offline if profile unavailable
              });
            });

          profilePromises.push(profilePromise);
        } else {
          // Contact has no invitId (broken contact record)
          fetchedContacts.push({
            id: contactDoc.id,
            creatorId: contactData.creatorId,
            invitId: "",
            name: contactData.name || "Nom inconnu",
            email: contactData.email || "email@inconnu.com",
            phone: contactData.phone || "",
            avatar: contactData.avatar || "",
            isOnline: false,
          });
        }
      }

      // Wait for all profile fetches to complete
      await Promise.all(profilePromises);

      // Sort alphabetically by name
      const sortedContacts = [...fetchedContacts].sort((a, b) => a.name.localeCompare(b.name));
      setContacts(sortedContacts);
      setLastRefresh(new Date());

      // Optional success notification
      if (forceRefresh) {
        toast.success('Contacts actualisés', {
          description: `${sortedContacts.length} contact${sortedContacts.length > 1 ? 's' : ''} chargé${sortedContacts.length > 1 ? 's' : ''}`,
          duration: 2000,
        });
      }
    } catch (error) {
      console.error("Erreur lors du chargement des contacts:", error);
      toast.error('Erreur de chargement', {
        description: 'Impossible de charger vos contacts. Veuillez réessayer.',
        duration: 5000,
      });
    } finally {
      setLoadingContacts(false);
      setIsRefreshing(false);
    }
  }, [user]);


  useEffect(() => {
    if (!user) return;
    void loadContacts();
  }, [user, loadContacts]);

  const handleRefresh = useCallback(() => {
    loadContacts(true);
  }, [loadContacts]);

  if (authLoading) {
    return <div className="text-center py-12">Chargement de la session...</div>;
  }

  return (
    <DashboardLayout>
      <div className="dashboard-surface landing-page mx-auto w-full max-w-[1440px] space-y-6 pb-8">
        <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Users className="h-4 w-4 text-primary" />
              Carnet d’adresses
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">Contacts</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Retrouvez vos contacts, vérifiez leur disponibilité et démarrez un appel directement.
            </p>
          </div>
          <Link to="/contacts/new" className="shrink-0">
            <Button className="h-11 rounded-full px-5 font-semibold shadow-sm shadow-primary/15">
              <Plus className="mr-2 h-4 w-4" /> Ajouter un contact
            </Button>
          </Link>
        </section>


        {/* Search, filter, and refresh controls */}
        <div className="dashboard-card space-y-4 rounded-[1.5rem] p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un contact..."
                className="pl-10 w-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex gap-2 w-full sm:w-auto">
              {/* Filter dropdown */}
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-3">
                <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as 'all' | 'online' | 'offline')}
                  className="min-w-0 bg-transparent py-2.5 text-sm outline-none" aria-label="Filtrer par disponibilité"
                >
                  <option value="all">Tous les contacts</option>
                  <option value="online">En ligne</option>
                  <option value="offline">Hors ligne</option>
                </select>
              </div>

              {/* View mode toggle */}
              <div className="flex items-center rounded-xl border border-border/70 bg-background/70 p-1 gap-1">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setViewMode('grid')}
                  title="Affichage grille"
                >
                  <Grid3x3 className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === 'table' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setViewMode('table')}
                  title="Affichage tableau"
                >
                  <Table2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Refresh button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="h-10 flex-shrink-0 rounded-xl"
                aria-label="Actualiser les contacts"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Actualiser
              </Button>
            </div>
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {missedCallsCount > 0 && (
              <Badge variant="destructive" className="animate-pulse">
                {missedCallsCount} appel{missedCallsCount > 1 ? 's' : ''} manqué{missedCallsCount > 1 ? 's' : ''}
              </Badge>
            )}
            <Badge variant="secondary">
              {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}
            </Badge>
            {lastRefresh && (
              <span className="text-xs text-muted-foreground">Mis à jour à {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
        </div>

        {/* Contacts display */}
        {loadingContacts ? (
          <div className="text-center py-12 space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground">Chargement de vos contacts...</p>
          </div>
        ) : filteredContacts.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredContacts.map((contact) => (
                <ContactCard key={contact.id} contact={contact} />
              ))}
            </div>
          ) : (
            <div className="dashboard-card overflow-hidden rounded-[1.5rem]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/40">
                      <th className="px-6 py-4 text-left font-semibold text-foreground">Nom</th>
                      <th className="px-6 py-4 text-left font-semibold text-foreground">Email</th>
                      <th className="px-6 py-4 text-left font-semibold text-foreground">Téléphone</th>
                      <th className="px-6 py-4 text-center font-semibold text-foreground">Statut</th>
                      <th className="px-6 py-4 text-right font-semibold text-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map((contact) => (
                      <TableRowContact key={contact.id} contact={contact} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          <div className="dashboard-card rounded-[1.5rem] px-6 py-16 text-center">
            <div className="dashboard-empty-icon mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl">
              <Users className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {contacts.length === 0 ? 'Votre carnet est vide' : 'Aucun contact correspondant'}
            </h2>
            <p className="mx-auto mb-5 mt-2 max-w-sm text-sm text-muted-foreground">
              {contacts.length === 0 ? 'Ajoutez une personne pour la retrouver ici et pouvoir l’appeler rapidement.' : 'Essayez une autre recherche ou modifiez le filtre de disponibilité.'}
            </p>
            {contacts.length === 0 && (
              <Link to="/contacts/new">
                <Button className="rounded-full font-semibold"><Plus className="mr-2 h-4 w-4" /> Ajouter un contact</Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Contacts;
