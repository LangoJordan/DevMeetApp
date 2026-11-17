import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase/firebase";

/**
 * CONTACTS: Récupérer les 5 contacts les plus récemment créés/mis à jour pour un utilisateur
 *
 * Cette fonction est utilisée pour afficher:
 * - Les contacts récents dans le tableau de bord
 * - Accès rapide aux personnes fréquemment contactées
 * - Suggestions de contacts dans les listes déroulantes/listes
 *
 * REQUÊTE FIRESTORE:
 * Collection: 'contacts'
 * Filtres:
 *   - creatorId == userId (seulement les contacts de cet utilisateur)
 * Tri:
 *   - Par champ 'id' en ordre décroissant (le plus récent en premier)
 * Limite:
 *   - Retourne seulement les 5 plus récents
 *
 * STRUCTURE DE DONNÉES DE CONTACT ATTENDUE:
 * {
 *   id: string,  // ID du document Firestore
 *   creatorId: string,  // UID Firebase du propriétaire
 *   name: string,
 *   email: string,
 *   phone?: string,
 *   avatar?: string,
 *   createdAt?: timestamp,
 *   ... autres champs
 * }
 *
 * @param userId - Le UID Firebase de l'utilisateur récupérant ses contacts
 * @returns Tableau d'objets de contact (max 5 éléments)
 */
export const getRecentContacts = async (userId: string) => {
  // Référencer la collection 'contacts' dans Firestore
  const contactsRef = collection(db, "contacts");

  // Construire une requête pour récupérer les contacts récents de cet utilisateur
  const q = query(
    contactsRef,
    where("creatorId", "==", userId),  // Seulement les contacts de cet utilisateur
    orderBy("id", "desc"),  // Le plus récent en premier
    limit(5)  // Seulement les 5 plus récents
  );

  // Exécuter la requête
  const snapshot = await getDocs(q);

  // Transformer les documents Firestore en objets avec ID inclus
  return snapshot.docs.map((doc) => ({
    id: doc.id,  // Inclure l'ID du document Firestore
    ...doc.data()  // Étendre tous les champs du contact
  }));
};
