import { createContext, useContext, useEffect, useState } from "react";
import { auth } from "../firebase/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { logoutUser, syncEmailDirectory, updateUserOnlineStatus } from "@/services/authService";

/**
 * TYPE: Context value for authentication state
 *
 * Provides access to:
 * - user: Current Firebase Auth user
 * - loading: Whether initial auth check is complete
 * - logout: Function to logout current user
 */
interface AuthContextType {
  user: User | null;  // Firebase User object if logged in, null otherwise
  loading: boolean;  // True while checking auth state on app load
  logout: () => Promise<void>;  // Function to logout
}

/**
 * CONTEXT: Application-wide authentication state
 *
 * Provides user session information to all components.
 * Initialized with default values (will be populated when provider mounts).
 */
const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {}
});

/**
 * PROVIDER: AuthProvider wraps the entire app to provide auth context
 *
 * This provider handles:
 * 1. Firebase authentication state persistence
 * 2. Heartbeat mechanism to keep user marked as online
 * 3. Visibility tracking (user switches tabs/windows)
 * 4. Cleanup on logout/page unload
 *
 * WRAP YOUR APP WITH:
 * <AuthProvider>
 *   <App />
 * </AuthProvider>
 */
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * EFFECT 1: Setup Firebase authentication state listener
   *
   * Firebase automatically persists session between page reloads.
   * This effect runs once on component mount and:
   * 1. Checks if user is still logged in (from session storage)
   * 2. Sets user state
   * 3. Marks user as online in Firestore
   * 4. Unsubscribes listener on cleanup
   */
  useEffect(() => {
    // Listen for changes to Firebase auth state
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Update React state with current user
      setUser(currentUser);

      // If user is logged in, mark them as online
      if (currentUser) {
        try {
          await updateUserOnlineStatus(currentUser.uid, true);
        } catch (error) {
          console.warn("Failed to update online status:", error);
        }
        await syncEmailDirectory(currentUser);
      }

      // Auth state check complete, show the app
      setLoading(false);
    });

    // Cleanup listener on unmount
    return () => unsubscribe();
  }, []);

  /**
   * EFFECT 2: Heartbeat mechanism to keep user marked as online
   *
   * WHY WE NEED THIS:
   * - If we only update online status once per login, it won't know if user closed the browser
   * - We need to prove the user is still active
   * - Every heartbeat refreshes the "lastUpdated" timestamp
   * - If heartbeat stops = user went offline or connection dropped
   *
   * HOW IT WORKS:
   * - Sends "I'm still here" to Firestore every 30 seconds
   * - If user closes browser/app, heartbeat stops
   * - Other clients can detect inactivity after 30+ seconds
   *
   * SENDS TO FIRESTORE:
   * - Updates the user's profile with isOnline=true
   * - Updates lastUpdated timestamp
   *
   * Dependencies: [user] means this runs whenever user changes
   */
  useEffect(() => {
    if (!user) return;

    // Send initial heartbeat when user logs in
    updateUserOnlineStatus(user.uid, true).catch(error => {
      console.warn("Failed to set initial online status:", error);
    });

    // Set up recurring heartbeat
    const heartbeatInterval = setInterval(async () => {
      try {
        // Every 30 seconds, tell Firestore "I'm still online"
        await updateUserOnlineStatus(user.uid, true);
      } catch (error) {
        console.warn("Failed to update online status heartbeat:", error);
      }
    }, 30000); // 30 seconds

    // Cleanup: stop heartbeat when user logs out
    return () => clearInterval(heartbeatInterval);
  }, [user]);

  /**
   * EFFECT 3: Track when user switches browser tabs or minimizes window
   *
   * Browser Visibility API tells us when page is hidden/shown.
   *
   * SCENARIOS:
   * 1. User clicks another tab → document.hidden = true → mark as offline
   * 2. User clicks back to our tab → document.hidden = false → mark as online
   * 3. User minimizes browser → document.hidden = true → mark as offline
   *
   * WHY THIS MATTERS:
   * - User isn't interacting with our app, so they're effectively offline
   * - Other users see the correct status
   * - When they return, heartbeat resumes and they're online again
   *
   * SENDS TO FIRESTORE:
   * - isOnline = true: if tab is visible
   * - isOnline = false: if tab is hidden/minimized
   */
  useEffect(() => {
    if (!user) return;

    // Handler for visibility changes
    const handleVisibilityChange = async () => {
      try {
        // document.hidden = true means page is not visible
        const isOnline = !document.hidden;
        await updateUserOnlineStatus(user.uid, isOnline);
      } catch (error) {
        console.warn("Failed to update online status on visibility change:", error);
      }
    };

    // Register listener for visibility changes
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cleanup listener on unmount
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [user]);

  /**
   * EFFECT 4: Mark user as offline when page unloads
   *
   * SCENARIOS:
   * 1. User closes browser tab → "pagehide" event fires
   * 2. User closes entire browser → "beforeunload" event fires
   * 3. User navigates to different domain → "beforeunload" event fires
   * 4. Browser crashes (can't be caught, but heartbeat will eventually expire)
   *
   * WHY TWO EVENTS:
   * - beforeunload: Not reliable on all browsers/devices (can be prevented)
   * - pagehide: More reliable, fires even if page is hidden
   * - We use both as a fallback mechanism
   *
   * NOTE:
   * - These events don't guarantee execution (async operations might not complete)
   * - If network is slow, update might not reach server before page closes
   * - That's why we have the heartbeat timeout to detect offline users
   *
   * SENDS TO FIRESTORE:
   * - isOnline = false (best effort)
   */
  useEffect(() => {
    const handlePageHide = async () => {
      if (user) {
        try {
          await updateUserOnlineStatus(user.uid, false);
        } catch (error) {
          console.warn("Failed to update online status on page hide:", error);
        }
      }
    };

    const handleBeforeUnload = async () => {
      if (user) {
        try {
          await updateUserOnlineStatus(user.uid, false);
        } catch (error) {
          console.warn("Failed to update online status on unload:", error);
        }
      }
    };

    // Use pagehide for more reliable detection (W3C standard)
    window.addEventListener("pagehide", handlePageHide);
    // beforeunload as fallback for older browsers
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [user]);

  /**
   * LOGOUT HANDLER
   *
   * Called when user clicks logout:
   * 1. Mark user offline in Firestore
   * 2. Sign out from Firebase (clear session token)
   * 3. Clear user state
   */
  const handleLogout = async () => {
    try {
      const userId = user?.uid;
      // This function updates online status and signs out from Firebase Auth
      await logoutUser(userId);
    } catch (error) {
      console.error("Logout error:", error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout: handleLogout }}>
      {/* Only render children after initial auth check is complete */}
      {!loading && children}
    </AuthContext.Provider>
  );
};

/**
 * HOOK: useAuth
 *
 * Use this hook in any component to access:
 * - user: Current Firebase user or null
 * - loading: Auth check in progress
 * - logout: Logout function
 *
 * EXAMPLE:
 * const { user, logout } = useAuth();
 * if (user) {
 *   return <p>Hello, {user.displayName}!</p>;
 * }
 */
export const useAuth = () => useContext(AuthContext);
