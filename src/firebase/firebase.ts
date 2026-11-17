import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";

/**
 * ============================================================================
 * FIREBASE INITIALIZATION
 * ============================================================================
 *
 * This file initializes the Firebase SDK with your project credentials.
 * All Firebase services are exported from here for use throughout the app.
 *
 * FIREBASE SERVICES USED:
 * 1. Authentication (firebase/auth):
 *    - Email/password signup and login
 *    - Google OAuth login
 *    - User session management
 *
 * 2. Firestore Database (firebase/firestore):
 *    - Real-time database for:
 *      • User profiles (online status, display info)
 *      • Contacts (user's saved contacts)
 *      • Reunions/Meetings (meetings and their details)
 *      • Invitations (who's invited to which meetings)
 *      • Messages (chat between users)
 *      • Notifications (events like "invitation accepted")
 *      • WebRTC signaling (offer/answer/ICE candidates)
 *
 * 3. Cloud Storage (firebase/storage):
 *    - Store files like:
 *      • User profile avatars
 *      • Shared documents in messages
 *      • Call recordings (if enabled)
 *
 * AUTHENTICATION FLOWS:
 * Environment variables loaded from .env file:
 * - VITE_FIREBASE_API_KEY: Public key for Firebase API
 * - VITE_FIREBASE_AUTH_DOMAIN: Auth subdomain (e.g., project.firebaseapp.com)
 * - VITE_FIREBASE_DATABASE_URL: Realtime DB URL (not used, using Firestore instead)
 * - VITE_FIREBASE_PROJECT_ID: Google Cloud project ID
 * - VITE_FIREBASE_STORAGE_BUCKET: Cloud Storage bucket name
 * - VITE_FIREBASE_MESSAGING_SENDER_ID: For push notifications (optional)
 * - VITE_FIREBASE_APP_ID: Unique app identifier
 */

// Load Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Initialize Firebase with the configuration
 * This sets up all Firebase services for use in the app
 */
const app = initializeApp(firebaseConfig);

/**
 * GOOGLE OAUTH PROVIDER
 * Used for "Sign in with Google" functionality
 * Configured to request user's profile information
 */
export const googleProvider = new GoogleAuthProvider();

/**
 * ============================================================================
 * FIRESTORE DATABASE
 * ============================================================================
 *
 * COLLECTIONS STRUCTURE:
 *
 * profiles/
 *   {userId}/
 *     - displayName: string
 *     - email: string
 *     - avatar: string (URL)
 *     - isOnline: boolean
 *     - lastSeen: timestamp
 *     - lastLogin: timestamp
 *     - createdAt: timestamp
 *     - getVisibility: boolean (privacy setting)
 *
 * contacts/
 *   {contactId}/
 *     - creatorId: string (who saved this contact)
 *     - name: string
 *     - email: string
 *     - phone: string
 *     - avatar: string (URL)
 *     - createdAt: timestamp
 *
 * reunions/
 *   {reunionId}/
 *     - title: string
 *     - description: string
 *     - creatorId: string
 *     - roomId: string (meeting room)
 *     - roomUrl: string
 *     - status: 'scheduled' | 'in_progress' | 'completed'
 *     - begin: timestamp
 *     - createdAt: timestamp
 *
 * invitations/
 *   {invitationId}/
 *     - reunionId: string
 *     - callerId: string (who invited)
 *     - contactId: string (who was invited)
 *     - status: 'pending' | 'accepted' | 'declined'
 *     - role: 'host' | 'co-host' | 'participant'
 *     - url: string (join link)
 *     - roomId: string
 *     - debut: timestamp (when they joined)
 *     - dateFin: timestamp (when they left)
 *     - viewed: boolean
 *     - createdAt: timestamp
 *
 * notifications/
 *   {notificationId}/
 *     - type: 'invitation_accepted' | 'invitation_received' | 'invitation_declined'
 *     - callerId: string
 *     - reunionId: string
 *     - invitationId: string
 *     - userName: string
 *     - createdAt: timestamp
 *     - read: boolean
 *
 * reunions/{reunionId}/
 *   - roomMembers/{uid}: room access and role
 *   - participants/{uid}: live presence and media status
 *   - connections/{pairId}: SDP offer and answer
 *     - offerCandidates/{candidateId}: ICE candidate
 *     - answerCandidates/{candidateId}: ICE candidate
 */
export const db = getFirestore(app);

/**
 * ============================================================================
 * FIREBASE AUTHENTICATION
 * ============================================================================
 *
 * Features:
 * - Email/password registration and login
 * - Google OAuth integration
 * - Session persistence (user stays logged in after page refresh)
 * - Built-in password reset functionality
 * - User management (create, delete accounts)
 */
export const auth = getAuth(app);

/**
 * ============================================================================
 * CLOUD STORAGE
 * ============================================================================
 *
 * Used to store:
 * - User profile avatars/pictures
 * - Files shared in messages
 * - Any other media files
 *
 * Access pattern: gs://project-id/bucket-path
 */
export const storage = getStorage(app);

// Export the Firebase app instance (rarely used directly)
export default app;
