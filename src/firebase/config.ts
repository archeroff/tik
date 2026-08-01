import { initializeApp } from 'firebase/app';

/**
 * Firebase configuration is injected through Vite environment variables.
 *
 * Copy `.env.example` to `.env` and fill in the values from your Firebase
 * project (Project settings -> General -> Your apps -> Web app). Only
 * `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_PROJECT_ID` are strictly required
 * for Firestore, the rest are kept for future-proofing.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** True once the required environment variables are present. */
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
