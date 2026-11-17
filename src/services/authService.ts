import { auth, googleProvider, db } from "../firebase/firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User
} from "firebase/auth";
import { setDoc, doc, serverTimestamp, updateDoc, getDoc } from "firebase/firestore";

/**
 * FONCTION HELPER: Créer ou mettre à jour le profil d'un utilisateur dans Firestore
 *
 * Cette fonction gère les données du profil utilisateur dans la collection "profiles" de Firestore.
 * Elle est utilisée chaque fois qu'un utilisateur s'authentifie (enregistrement, connexion ou connexion Google).
 *
 * @param user - L'objet User d'authentification Firebase
 * @param isOnline - Si l'utilisateur est actuellement en ligne (par défaut: vrai)
 * @param additionalData - Données optionnelles comme nom, téléphone, avatar pour surcharger les valeurs par défaut
 *
 * FLUX:
 * 1. Vérifie si un profil existe déjà pour cet utilisateur
 * 2. Si nouveau profil: ajoute un timestamp createdAt
 * 3. Si profil existant: met à jour uniquement sans réinitialiser createdAt
 * 4. Utilise { merge: true } pour mettre à jour uniquement les champs fournis (ne pas écraser)
 *
 * DONNÉES STOCKÉES DANS FIRESTORE (collection profiles):
 * - userId: Le UID d'authentification Firebase
 * - email: Email de l'utilisateur
 * - name: Nom d'affichage de l'utilisateur
 * - phone: Numéro de téléphone de l'utilisateur (si fourni)
 * - avatar: URL de la photo de profil de l'utilisateur
 * - isOnline: Statut en ligne actuel
 * - lastLogin: Quand l'utilisateur s'est connecté pour la dernière fois
 * - lastSeen: Quand l'utilisateur a été actif pour la dernière fois
 * - createdAt: Quand le profil a été créé (seulement pour les nouveaux profils)
 */
export const syncEmailDirectory = async (user: User) => {
  const email = user.email?.trim().toLowerCase();
  if (!email) return;

  try {
    await setDoc(doc(db, 'emailDirectory', email), {
      uid: user.uid,
      email,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Unable to sync email directory:', error);
  }
};

export const syncPublicProfile = async (
  userId: string,
  profile: { displayName?: string; photoURL?: string | null; isOnline?: boolean }
) => {
  await setDoc(doc(db, 'publicProfiles', userId), {
    ...profile,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

const createOrUpdateUserProfile = async (
  user: User,
  isOnline: boolean = true,
  additionalData?: { name?: string; phone?: string; avatar?: string }
) => {
  if (!user) return;

  try {
    // Référence au document de profil de l'utilisateur dans Firestore en utilisant son UID comme ID de document
    const profileRef = doc(db, "profiles", user.uid);
    // Vérifier si le profil existe déjà
    const existingProfile = await getDoc(profileRef);

    // Préparer l'objet de données de profil
    const profileData: any = {
      userId: user.uid,
      email: user.email,
      name: additionalData?.name || user.displayName || "",
      phone: additionalData?.phone || "",
      avatar: additionalData?.avatar || user.photoURL || "https://lh3.googleusercontent.com/a/ACg8ocLZ8rJKU52yGWjkTzmsXB_5pIafCE5e147Wmo805EQlW0VRDw=s96-c",
      isOnline,
      lastLogin: serverTimestamp(), // Timestamp côté serveur (plus précis que l'heure du client)
      lastSeen: serverTimestamp(),
    };

    // Ne définir createdAt que pour les nouveaux profils (pas sur les mises à jour)
    if (!existingProfile.exists()) {
      profileData.createdAt = serverTimestamp();
    }

    // Mettre à jour le profil avec merge: true (met à jour uniquement les champs fournis, ne supprime pas les autres)
    await setDoc(profileRef, profileData, { merge: true });
    await syncEmailDirectory(user);
    await syncPublicProfile(user.uid, {
      displayName: profileData.name,
      photoURL: profileData.avatar,
      isOnline,
    });
  } catch (error) {
    console.error("Erreur lors de la création/mise à jour du profil utilisateur:", error);
    throw error;
  }
};

/**
 * AUTHENTIFICATION: Enregistrer un nouvel utilisateur avec email et mot de passe
 *
 * PROCESSUS:
 * 1. Crée un nouveau compte utilisateur dans l'authentification Firebase
 * 2. Crée un document de profil correspondant dans Firestore
 * 3. L'utilisateur commence en ligne (isOnline = true par défaut dans createOrUpdateUserProfile)
 *
 * @param email - Adresse email de l'utilisateur
 * @param password - Mot de passe de l'utilisateur
 * @returns Firebase UserCredential (contient l'objet utilisateur avec UID, email, etc.)
 *
 * LÈVE:
 * - Erreur si l'email existe déjà
 * - Erreur si le mot de passe est trop faible
 * - Erreur si le réseau échoue
 */
export const registerUser = async (email: string, password: string) => {
  // Créer l'utilisateur dans le service d'authentification Firebase
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  // Créer simultanément son profil dans Firestore
  await createOrUpdateUserProfile(userCredential.user);
  return userCredential;
};

/**
 * AUTHENTIFICATION: Connecter un utilisateur existant avec email et mot de passe
 *
 * PROCESSUS:
 * 1. Authentifie l'utilisateur dans l'authentification Firebase
 * 2. Met à jour son profil pour montrer qu'il est en ligne
 * 3. Met à jour le timestamp lastLogin
 *
 * @param email - Adresse email de l'utilisateur
 * @param password - Mot de passe de l'utilisateur
 * @returns Firebase UserCredential (contient l'objet utilisateur avec UID, email, etc.)
 *
 * LÈVE:
 * - Erreur si l'email n'existe pas
 * - Erreur si le mot de passe est incorrect
 * - Erreur si le réseau échoue
 */
export const loginUser = async (email: string, password: string) => {
  // Authentifier l'utilisateur contre l'authentification Firebase
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  // Mettre à jour le profil pour les marquer comme en ligne
  await createOrUpdateUserProfile(userCredential.user, true);
  return userCredential;
};

/**
 * AUTHENTIFICATION: Se connecter avec Google OAuth
 *
 * PROCESSUS:
 * 1. Ouvre une fenêtre popup pour l'authentification Google
 * 2. L'utilisateur se connecte avec son compte Google (ou crée un nouveau compte Firebase lié à Google)
 * 3. Le profil est créé/mis à jour dans Firestore
 * 4. Gère les erreurs de blocage de popup avec grâce
 *
 * GESTION SPÉCIALE:
 * - Si le popup est bloqué par le navigateur: retourne un message d'erreur convivial
 *
 * @returns Firebase UserCredential (l'objet utilisateur inclut les données de profil Google)
 *
 * LÈVE:
 * - Erreur personnalisée si le popup est bloqué
 * - Autres erreurs Firebase si l'authentification échoue
 */
export const loginWithGoogle = async () => {
  try {
    // Déclencher la popup Google OAuth
    const userCredential = await signInWithPopup(auth, googleProvider);
    // Créer/mettre à jour le profil dans Firestore avec isOnline = true
    await createOrUpdateUserProfile(userCredential.user, true);
    return userCredential;
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    // Gérer spécifiquement le scénario de popup bloqué
    if (err.code === 'auth/popup-blocked') {
      throw {
        code: 'auth/popup-blocked',
        message: 'Popup a été bloqué. Veuillez désactiver votre bloqueur de popup et réessayer.',
        userFriendlyMessage: 'Bloqueur de popup détecté. Veuillez autoriser les popups pour ce site.'
      };
    }
    throw error;
  }
};

/**
 * STATUT EN LIGNE: Mettre à jour le statut en ligne/hors ligne de l'utilisateur dans Firestore
 *
 * Cette fonction est appelée:
 * - Toutes les 30 secondes (battement cardiaque) pour garder l'utilisateur marqué comme en ligne
 * - Quand l'utilisateur change d'onglet du navigateur (API de visibilité)
 * - Quand l'utilisateur est sur le point de partir/fermer la page
 *
 * FONCTIONNALITÉ DE CONFIDENTIALITÉ:
 * - Si l'utilisateur a le paramètre de confidentialité getVisibility=false, son statut en ligne est toujours affiché comme faux
 * - Cela respecte les préférences de confidentialité de l'utilisateur tout en suivant en interne
 *
 * @param userId - Le UID Firebase de l'utilisateur
 * @param isOnline - Si l'utilisateur est actuellement en ligne
 *
 * DONNÉES MISES À JOUR DANS FIRESTORE:
 * - isOnline: Statut booléen
 * - lastUpdated: Timestamp serveur de la dernière mise à jour
 * - lastSeen: Mis à jour dans d'autres contextes pour montrer quand il a été actif pour la dernière fois
 */
export const updateUserOnlineStatus = async (userId: string, isOnline: boolean) => {
  if (!userId) return;

  try {
    const profileRef = doc(db, "profiles", userId);
    // Récupérer le profil actuel pour vérifier les paramètres de confidentialité
    const profileSnap = await getDoc(profileRef);

    // FONCTIONNALITÉ DE CONFIDENTIALITÉ: Respecter la préférence de visibilité de l'utilisateur
    if (profileSnap.exists()) {
      const data = profileSnap.data() as { getVisibility?: boolean; displayName?: string; name?: string; photoURL?: string | null; avatar?: string | null };
      const visibleStatus = data.getVisibility === false ? false : isOnline;
      await updateDoc(profileRef, {
        isOnline: visibleStatus,
        lastUpdated: serverTimestamp(),
      });
      await syncPublicProfile(userId, {
        displayName: data.displayName || data.name,
        photoURL: data.photoURL || data.avatar,
        isOnline: visibleStatus,
      });
      return;
    }

    // Mettre à jour le statut en ligne normalement
    await updateDoc(profileRef, {
      isOnline,
      lastUpdated: serverTimestamp(),
    });
    await syncPublicProfile(userId, { isOnline });
  } catch (error) {
    console.error("Erreur lors de la mise à jour du statut en ligne de l'utilisateur:", error);
    throw error;
  }
};

/**
 * AUTHENTIFICATION: Déconnecter un utilisateur
 *
 * PROCESSUS:
 * 1. Marque l'utilisateur comme hors ligne dans Firestore (optionnel, si userId fourni)
 * 2. Se déconnecte de l'authentification Firebase
 * 3. Efface l'état d'authentification local
 *
 * APPELÉ DEPUIS:
 * - Page Paramètres quand l'utilisateur clique sur "Déconnexion"
 * - AuthContext quand l'état d'authentification change
 *
 * @param userId - (Optionnel) Le UID Firebase à marquer comme hors ligne
 *
 * POURQUOI userId EST OPTIONNEL:
 * - Dans certains cas, nous n'avons pas l'UID disponible au moment de la déconnexion
 * - Firebase gérera l'effacement de l'état d'authentification de toute manière
 * - Ne pas mettre à jour le statut en ligne ne doit pas bloquer la déconnexion
 */
export const logoutUser = async (userId?: string) => {
  try {
    // Marquer l'utilisateur comme hors ligne avant de se déconnecter (si nous avons son ID)
    if (userId) {
      await updateUserOnlineStatus(userId, false);
    }
  } catch (error) {
    // Enregistrer l'erreur mais ne pas bloquer le processus de déconnexion
    console.warn("Erreur lors de la mise à jour du statut à la déconnexion:", error);
  }

  // Se déconnecter de l'authentification Firebase (efface les tokens de session)
  return await signOut(auth);
};
