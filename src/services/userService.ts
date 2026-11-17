import { db } from '@/firebase/firebase';
import { doc, getDoc } from 'firebase/firestore';

/**
 * TYPE: Structure de données de profil utilisateur
 * Ceci représente les informations utilisateur visibles publiquement
 */
export interface UserProfile {
  uid: string;  // UID d'authentification Firebase (identifiant unique)
  displayName: string;  // Nom d'affichage de l'utilisateur
  email: string;  // Adresse email de l'utilisateur
  photoURL?: string;  // URL de l'image d'avatar de l'utilisateur
  isOnline?: boolean;  // Statut en ligne actuel (mis à jour par battement cardiaque)
}

/**
 * PROFIL UTILISATEUR: Récupérer le profil d'un seul utilisateur depuis Firestore
 *
 * Cette fonction récupère les informations de profil pour tout utilisateur par son UID.
 * Utilisé pour:
 * - Afficher les informations utilisateur dans les contextes de chat/appel
 * - Afficher les cartes de profil en survolant les noms d'utilisateurs
 * - Remplir l'interface avec les détails de l'utilisateur
 * - Vérifier si un profil utilisateur existe
 *
 * STRUCTURE FIRESTORE:
 * Collection: 'profiles'
 * ID du document: userId (le UID Firebase)
 *
 * DONNÉES RETOURNÉES:
 * {
 *   uid: string,
 *   displayName: string,
 *   email: string,
 *   photoURL?: string,
 *   isOnline?: boolean,
 *   lastSeen?: timestamp,
 *   createdAt?: timestamp,
 *   ... autres champs
 * }
 *
 * @param userId - Le UID Firebase de l'utilisateur à récupérer
 * @returns Objet UserProfile si trouvé, null s'il n'existe pas ou erreur
 *
 * GESTION DES ERREURS:
 * - Retourne null si l'utilisateur n'est pas trouvé (ne lève pas)
 * - Enregistre l'erreur dans la console mais ne casse pas l'application
 */
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    // Référencer le document de profil pour cet utilisateur (ID est le UID Firebase)
    const docRef = doc(db, 'profiles', userId);
    // Récupérer le document
    const docSnap = await getDoc(docRef);

    // Vérifier si le document de profil existe
    if (docSnap.exists()) {
      // Retourner le profil avec l'UID inclus
      return {
        uid: userId,
        ...docSnap.data(),
      } as UserProfile;
    }
    // Le profil n'existe pas
    return null;
  } catch (error) {
    console.error('Erreur lors de la récupération du profil utilisateur:', error);
    // Retourner null au lieu de lever (gestion gracieuse des erreurs)
    return null;
  }
};

/**
 * PROFILS UTILISATEURS: Récupérer efficacement les profils de plusieurs utilisateurs
 *
 * Cette fonction est utilisée quand vous avez besoin de chercher les informations de plusieurs utilisateurs à la fois.
 * Par exemple:
 * - Charger les informations des participants pour une réunion avec 10 participants
 * - Remplir une liste/répertoire d'utilisateurs
 * - Obtenir les données de profil des expéditeurs de messages
 *
 * PERFORMANCE:
 * - Récupère tous les profils en parallèle (pas séquentiellement)
 * - Plus efficace que d'appeler getUserProfile dans une boucle
 * - Gère gracieusement les profils manquants (ils ne sont pas inclus dans le résultat)
 *
 * RETOURS:
 * Une Map (comme un dictionnaire) où:
 *   - Clé: userId
 *   - Valeur: objet UserProfile
 *
 * Exemple d'utilisation:
 * ```
 * const ids = ['user1', 'user2', 'user3'];
 * const profiles = await getUserProfiles(ids);
 * const user1Profile = profiles.get('user1');  // Obtenir un profil spécifique
 * profiles.forEach((profile, userId) => {  // Boucler à travers tous
 *   console.log(`${userId}: ${profile.displayName}`);
 * });
 * ```
 *
 * @param userIds - Tableau des UIDs Firebase à récupérer
 * @returns Map de userId -> UserProfile (certains peuvent manquer si les utilisateurs n'existent pas)
 *
 * GESTION DES ERREURS:
 * - Les profils non-existants sont silencieusement ignorés
 * - Les erreurs réseau sont enregistrées mais ne bloquent pas la fonction
 */
export const getUserProfiles = async (userIds: string[]): Promise<Map<string, UserProfile>> => {
  // Créer une map vide pour stocker les résultats
  const profiles = new Map<string, UserProfile>();

  try {
    // Créer une promesse pour chaque profil utilisateur (exécution parallèle)
    const profilePromises = userIds.map(async (userId) => {
      // Récupérer le profil de cet utilisateur
      const profile = await getUserProfile(userId);
      // Ajouter à la map seulement si le profil existe
      if (profile) {
        profiles.set(userId, profile);
      }
    });

    // Attendre que toutes les récupérations de profil se terminent
    await Promise.all(profilePromises);
  } catch (error) {
    // Enregistrer l'erreur mais retourner quand même les profils que nous avons pu récupérer
    console.error('Erreur lors de la récupération des profils utilisateurs:', error);
  }

  // Retourner la map (peut être partielle si certains utilisateurs n'existent pas)
  return profiles;
};
