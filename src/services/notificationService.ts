import { db } from '@/firebase/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

/**
 * NOTIFICATIONS: Enregistrer quand quelqu'un accepte une invitation à une réunion
 *
 * Cette fonction est appelée quand une personne accepte une invitation à une réunion.
 * L'organisateur de la réunion devrait être notifié à ce sujet.
 *
 * IMPLÉMENTATION ACTUELLE:
 * - Crée un document de notification dans Firestore
 * - Enregistre dans la console du navigateur pour le débogage
 * - Structure de base pour les améliorations futures (alertes email, notifications push, etc.)
 *
 * AMÉLIORATIONS FUTURES:
 * - Envoyer une notification par email à l'organisateur de la réunion
 * - Envoyer une notification push à son téléphone/navigateur
 * - Créer un flux de notifications dans l'application
 * - Déclencher un webhook pour les intégrations externes
 *
 * STRUCTURE FIRESTORE:
 * Collection: 'notifications'
 * Champs du document:
 *   - type: 'invitation_accepted' (type de notification)
 *   - callerId: UID Firebase de l'organisateur de la réunion (qui doit être notifié)
 *   - reunionId: L'ID de la réunion/réunion
 *   - invitationId: L'invitation spécifique qui a été acceptée
 *   - userName: Nom de la personne qui a accepté
 *   - createdAt: Timestamp serveur du moment de cet enregistrement
 *   - read: false (pas encore vu par l'organisateur)
 *
 * @param callerId - UID Firebase de l'organisateur de la réunion (reçoit la notification)
 * @param reunionId - L'ID de la réunion/réunion
 * @param invitationId - L'ID du document d'invitation
 * @param userName - Nom d'affichage de la personne qui accepte
 */
export async function notifyInvitationAccepted(
  callerId: string,
  reunionId: string,
  invitationId: string,
  userName: string,
): Promise<void> {
  try {
    // Créer un document de notification
    await addDoc(collection(db, 'notifications'), {
      type: 'invitation_accepted',  // Type d'événement pour filtrage/routage
      recipientId: callerId,
      reunionId,  // De quelle réunion il s'agit
      invitationId,  // Quelle invitation spécifique
      userName,  // Qui a accepté
      createdAt: serverTimestamp(),  // Quand c'est arrivé
      read: false,  // Pas encore vu
    });

    // Enregistrer pour le débogage dans la console du navigateur
    console.log('[notificationService] Invitation acceptée', {
      callerId,
      reunionId,
      invitationId,
      userName,
    });
  } catch (e) {
    // Ne pas planter si la création de la notification échoue
    console.warn('[notificationService] Échec de la création de la notification', e);
  }
}

/**
 * NOTIFICATIONS: Enregistrer que quelqu'un a reçu une invitation
 *
 * Cette fonction est appelée quand une invitation est envoyée à une personne.
 * Elle crée un enregistrement de cet événement d'invitation.
 *
 * CAS D'UTILISATION:
 * - Quand l'utilisateur clique sur "Inviter" sur une réunion
 * - Suivre qui a été invité et quand
 * - Plus tard: déclencher les notifications à l'invité
 *
 * STRUCTURE FIRESTORE:
 * Collection: 'notifications'
 * Champs du document:
 *   - type: 'invitation_received' (quelqu'un a reçu une invitation)
 *   - callerId: Qui a envoyé l'invitation
 *   - reunionId: Quelle réunion
 *   - invitationId: L'ID du document d'invitation
 *   - calleeId: Qui a été invité (UID Firebase)
 *   - callerName: Nom d'affichage de la personne qui a invité
 *   - createdAt: Timestamp serveur
 *   - read: false
 *
 * @param callerId - UID Firebase de qui fait l'invitation
 * @param reunionId - La réunion où l'invitation est faite
 * @param invitationId - L'ID du document d'invitation
 * @param calleeId - UID Firebase de la personne invitée
 * @param callerName - Nom d'affichage de la personne qui invite
 */
export async function notifyInvitationReceived(
  callerId: string,
  reunionId: string,
  invitationId: string,
  calleeId: string,
  callerName: string
): Promise<void> {
  try {
    // Créer un enregistrement de notification
    await addDoc(collection(db, 'notifications'), {
      type: 'invitation_received',  // Quelqu'un a reçu une invitation
      recipientId: calleeId,
      callerId,
      reunionId,
      invitationId,
      userName: callerName,
      createdAt: serverTimestamp(),
      read: false,
    });

    // Enregistrement de débogage
    console.log('[notificationService] Notification invitation reçue', {
      callerId, reunionId, invitationId, calleeId
    });
  } catch (e) {
    // Échouer gracieusement
    console.warn('[notificationService] Échec de la création de la notification (invitation reçue)', e);
  }
}

/**
 * NOTIFICATIONS: Enregistrer quand quelqu'un refuse une invitation à une réunion
 *
 * Cette fonction est appelée quand une personne rejette/refuse une invitation.
 * L'organisateur de la réunion devrait savoir que cette personne n'assistera pas.
 *
 * CAS D'UTILISATION:
 * - Quand l'invité clique sur "Refuser" ou "Rejeter" sur une invitation
 * - L'organisateur peut voir qui vient et qui ne vient pas
 * - Peut être utilisé pour auto-supprimer les personnes refusées de la liste des participants
 *
 * STRUCTURE FIRESTORE:
 * Collection: 'notifications'
 * Champs du document:
 *   - type: 'invitation_declined' (quelqu'un a rejeté)
 *   - callerId: L'organisateur (qui doit savoir)
 *   - reunionId: La réunion
 *   - invitationId: Quelle invitation a été refusée
 *   - userName: Nom de la personne qui refuse
 *   - createdAt: Timestamp serveur
 *   - read: false
 *
 * @param callerId - UID Firebase de l'organisateur
 * @param reunionId - L'ID de la réunion
 * @param invitationId - L'ID du document d'invitation
 * @param userName - Nom de la personne qui refuse
 */
export async function notifyInvitationDeclined(
  callerId: string,
  reunionId: string,
  invitationId: string,
  userName: string,
): Promise<void> {
  try {
    // Créer un enregistrement de notification
    await addDoc(collection(db, 'notifications'), {
      type: 'invitation_declined',  // Quelqu'un a rejeté
      recipientId: callerId,
      reunionId,  // Quelle réunion
      invitationId,  // Quelle invitation
      userName,  // Qui refuse
      createdAt: serverTimestamp(),
      read: false,
    });

    // Enregistrement de débogage
    console.log('[notificationService] Invitation refusée', {
      callerId, reunionId, invitationId, userName
    });
  } catch (e) {
    // Gérer gracieusement
    console.warn('[notificationService] Échec de la création de la notification (invitation refusée)', e);
  }
}
