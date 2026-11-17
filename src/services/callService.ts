import { db } from '@/firebase/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  Timestamp,
  arrayUnion,
} from 'firebase/firestore';

/**
 * TYPES: Définir la hiérarchie des rôles des participants à une réunion
 * - host: Le créateur de la réunion, peut gérer tous les aspects
 * - co-host: Peut aider à gérer la réunion
 * - participant: Participant régulier avec permissions limitées
 */
export type ParticipantRole = 'host' | 'co-host' | 'participant';

/**
 * INTERFACE: Structure de données pour inviter des membres à une réunion
 * Utilisé lors de l'invitation en masse de plusieurs personnes avec des rôles différents
 */
interface InviteMemberPayload {
  contactId: string;  // UID Firebase du contact
  role: ParticipantRole;  // Rôle à leur assigner
}

/**
 * GESTION DES RÉUNIONS: Reprogrammer (reporter) une réunion existante
 *
 * Quand une réunion est reportée, nous devons:
 * 1. Mettre à jour le document de réunion avec les nouveaux détails de la salle et l'heure de début
 * 2. Réinitialiser toutes les invitations au statut 'pending' (elles doivent accepter à nouveau)
 * 3. Mettre à jour les URLs d'accès pour tous les invités
 * 4. Effacer tous les temps de début/fin de la tentative précédente
 *
 * CAS D'UTILISATION:
 * - L'utilisateur reporte une réunion et veut une nouvelle salle de réunion
 * - Tous les participants doivent être notifiés et répondre à nouveau
 *
 * MISES À JOUR FIRESTORE:
 * Dans la collection 'reunions':
 *   - roomId: Nouvel identifiant de salle
 *   - roomUrl: Nouvelle URL d'accès
 *   - status: Défini à 'scheduled'
 *   - begin: Réinitialisé au timestamp serveur actuel
 *
 * Dans la collection 'invitations' (pour toutes les invitations à cette réunion):
 *   - status: Réinitialisé à 'pending' (tout le monde doit répondre à nouveau)
 *   - viewed: Défini à false (non lue)
 *   - url: Mise à jour avec la nouvelle URL de la salle
 *   - roomId: Nouvel ID de salle
 *   - debut/dateFin: Effacé (pas de temps de début/fin précédents)
 *
 * @param reunionId - L'ID du document Firestore de la réunion à reprogrammer
 * @param newRoomId - Le nouvel ID de salle à utiliser
 * @param newRoomUrl - La nouvelle URL d'accès à la réunion
 * @returns true si succès, false si réunion non trouvée ou erreur
 */
export async function reprogramReunion(
  reunionId: string,
  newRoomId: string,
  newRoomUrl: string,
): Promise<boolean> {
  try {
    // Référencer le document de réunion
    const reunionRef = doc(db, 'reunions', reunionId);
    // Vérifier si la réunion existe
    const snap = await getDoc(reunionRef);
    if (!snap.exists()) return false;

    const invQ = query(
      collection(db, 'invitations'),
      where('reunionId', '==', reunionId),
      where('callerId', '==', snap.data().creatorId),
    );
    const invSnap = await getDocs(invQ);

    // Mettre à jour le document de réunion principal avec les nouveaux détails de la salle
    await updateDoc(reunionRef, {
      roomId: newRoomId,
      roomUrl: newRoomUrl,
      hostId: snap.data().creatorId,
      maxParticipants: 6,
      invitedUserIds: arrayUnion(snap.data().creatorId, ...invSnap.docs.map((invitation) => invitation.data().contactId as string)),
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      status: 'scheduled',
      begin: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Mettre à jour chaque invitation en parallèle
    const batchUpdates = invSnap.docs.map(async (d) => {
      const invRef = doc(db, 'invitations', d.id);
      await updateDoc(invRef, {
        status: 'pending',  // Réinitialiser à pending (les gens doivent accepter à nouveau)
        viewed: false,  // Marquer comme non lue
        url: newRoomUrl,  // Nouvelle URL d'accès
        roomId: newRoomId,
        debut: null,  // Effacer l'heure de début précédente
        dateFin: null,  // Effacer l'heure de fin précédente
        updatedAt: serverTimestamp(),
      });
    });

    // Attendre que toutes les mises à jour se complètent
    await Promise.all(batchUpdates);
    return true;
  } catch (e) {
    console.error('reprogramReunion a échoué', e);
    return false;
  }
}

/**
 * GESTION DES RÉUNIONS: Cloner une réunion pour en créer une nouvelle avec un créateur différent
 *
 * Ceci crée une toute nouvelle réunion avec la même liste de participants mais:
 * - Créateur différent (le newCreatorId devient le host)
 * - Nouvel ID de salle et URL d'accès
 * - Tous les participants réinitialisés au statut 'pending' (doivent accepter à nouveau)
 * - Le nouveau créateur se joint automatiquement en tant que host
 *
 * CAS D'UTILISATION:
 * - L'utilisateur veut dupliquer une configuration de réunion existante
 * - Déléguer la création de réunion à un autre organisateur
 * - Créer une réunion récurrente à partir d'un modèle
 *
 * PROCESSUS:
 * 1. Récupérer le document de réunion original
 * 2. Créer un nouveau document de réunion avec les mêmes métadonnées mais nouveau créateur
 * 3. Générer un nouvel ID de salle et URL d'accès
 * 4. Copier toutes les invitations précédentes vers la nouvelle réunion
 * 5. Auto-accepter l'invitation pour le nouveau créateur (il est déjà le host)
 *
 * STRUCTURE FIRESTORE:
 * Crée un nouveau document dans 'reunions' avec:
 *   - title, description, type copiés de l'original
 *   - creatorId: Défini à newCreatorId
 *   - status: 'scheduled'
 *   - roomId/roomUrl: Nouvellement générés
 *   - createdAt: Timestamp actuel
 *
 * Crée des documents dans 'invitations' pour chaque participant original:
 *   - status: 'pending' (ils n'ont pas encore accepté cette version)
 *   - url/roomId: Nouveaux liens de salle
 *
 * Plus invitation auto-acceptée pour le nouveau créateur avec:
 *   - status: 'accepted'
 *   - role: 'host'
 *   - debut: serverTimestamp() (il est déjà dans la réunion)
 *
 * @param reunionId - L'ID du document Firestore de la réunion à cloner
 * @param newCreatorId - Le UID Firebase de la personne qui sera le nouveau host
 * @returns { id: string } avec le nouvel ID de réunion, ou null si l'original non trouvé
 */
export async function cloneReunionAsNew(
  reunionId: string,
  newCreatorId: string,
): Promise<{ id: string } | null> {
  try {
    // Récupérer la réunion originale pour copier ses données
    const reunionRef = doc(db, 'reunions', reunionId);
    const snap = await getDoc(reunionRef);
    if (!snap.exists()) return null;

    const data = snap.data() || {};
    const invitedUserIds = Array.isArray(data.invitedUserIds)
      ? [...new Set([...data.invitedUserIds, newCreatorId])]
      : [newCreatorId];

    // Générer un nouvel ID de salle unique en utilisant le timestamp et l'ID du créateur
    const newRoomId = `room_${Date.now()}_${newCreatorId}`;
    // Construire l'URL d'accès pour cette salle
    const newRoomUrl = `${window.location.origin}/meeting/${encodeURIComponent(newRoomId)}?userName=${encodeURIComponent('Organisateur')}`;

    // Créer le nouveau document de réunion
    const newReunionRef = await addDoc(collection(db, 'reunions'), {
      title: data.title ?? 'Réunion',
      description: data.description ?? '',
      creatorId: newCreatorId,  // Nouveau créateur
      hostId: newCreatorId,
      maxParticipants: 6,
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      status: 'scheduled',
      type: data.type ?? 'private',
      invitedUserIds,
      begin: serverTimestamp(),
      roomId: newRoomId,
      roomUrl: newRoomUrl,
      createdAt: serverTimestamp(),
    });

    const createPromises = invitedUserIds
      .filter((contactId) => contactId !== newCreatorId)
      .map(async (contactId) => {
        await addDoc(collection(db, 'invitations'), {
          reunionId: newReunionRef.id,
          callerId: newCreatorId,
          contactId,
          createdAt: serverTimestamp(),
          debut: null,
          dateFin: null,
          role: 'participant',
          status: 'pending',
          viewed: false,
          url: newRoomUrl,
          roomId: newRoomId,
        });
      });

    // Auto-accepter le nouveau créateur en tant que host (ils n'ont pas besoin d'être invités à leur propre réunion)
    await addDoc(collection(db, 'invitations'), {
      reunionId: newReunionRef.id,
      callerId: newCreatorId,
      contactId: newCreatorId,  // Le créateur s'invite lui-même
      createdAt: serverTimestamp(),
      debut: serverTimestamp(),  // Déjà dans la réunion
      dateFin: null,
      role: 'host',  // Il est le host
      status: 'accepted',  // Déjà accepté
      viewed: true,
      url: newRoomUrl,
      roomId: newRoomId,
    });

    // Attendre que la création de toutes les invitations se termine
    await Promise.all(createPromises);

    // Retourner le nouvel ID de réunion
    return { id: newReunionRef.id };
  } catch (e) {
    console.error('cloneReunionAsNew a échoué', e);
    return null;
  }
}

/**
 * GESTION DES RÉUNIONS: Inviter plusieurs membres à une réunion existante
 *
 * Cette fonction crée des documents d'invitation dans Firestore pour chaque membre.
 * Elle est généralement utilisée quand:
 * - L'utilisateur ajoute des participants à une réunion déjà créée
 * - L'utilisateur développe la liste des participants après la création initiale
 *
 * PROCESSUS:
 * Pour chaque membre de la liste:
 * 1. Créer un nouveau document d'invitation
 * 2. Définir le statut à 'pending' (attente de leur acceptation)
 * 3. Inclure l'URL d'accès à la réunion et l'ID de la salle
 * 4. Assigner leur rôle (host, co-host ou participant)
 *
 * STRUCTURE FIRESTORE:
 * Crée des documents dans la collection 'invitations':
 *   - reunionId: Lien vers la réunion
 *   - callerId: Qui a envoyé l'invitation (l'organisateur)
 *   - contactId: Qui est invité
 *   - status: 'pending' (en attente de réponse)
 *   - role: Leur rôle dans la réunion
 *   - url: Le lien d'accès
 *   - roomId: Identifiant de la salle
 *   - debut/dateFin: null initialement (sera défini quand ils acceptent/partent)
 *
 * @param reunionId - L'ID Firestore de la réunion
 * @param callerId - Le UID Firebase de la personne qui invite (l'organisateur)
 * @param members - Tableau des membres à inviter avec leurs rôles
 * @param roomUrl - L'URL d'accès pour la réunion
 * @param roomId - L'identifiant de la salle
 * @returns true si toutes les invitations ont été créées avec succès, false si liste vide ou erreur
 */
export async function inviteMembersToReunion(
  reunionId: string,
  callerId: string,
  members: InviteMemberPayload[],
  roomUrl: string,
  roomId: string,
): Promise<boolean> {
  try {
    // Valider que nous avons des membres à inviter
    if (!members || members.length === 0) return false;

    // Créer une invitation pour chaque membre en parallèle
    await updateDoc(doc(db, 'reunions', reunionId), {
      invitedUserIds: arrayUnion(...members.map(member => member.contactId)),
    });

    const promises = members.map(async (m) => {
      await addDoc(collection(db, 'invitations'), {
        reunionId,  // Lien vers la réunion
        callerId,  // Qui invite (l'organisateur)
        contactId: m.contactId,  // Qui est invité
        createdAt: serverTimestamp(),
        debut: null,  // Pas encore commencé
        dateFin: null,  // Pas encore terminé
        role: m.role ?? 'participant',  // Par défaut participant si pas de rôle spécifié
        status: 'pending',  // En attente de leur réponse
        viewed: false,  // Ils n'ont pas encore vu cette invitation
        url: roomUrl,  // Le lien d'accès
        roomId,
      });
    });

    // Attendre que toutes les invitations soient créées
    await Promise.all(promises);
    return true;
  } catch (e) {
    console.error('inviteMembersToReunion a échoué', e);
    return false;
  }
}

const callService = {
  reprogramReunion,
  cloneReunionAsNew,
  inviteMembersToReunion,
};

export default callService;
