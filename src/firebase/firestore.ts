import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { app } from './config';

/** Null until Firebase is configured via environment variables. */
export const db = app ? getFirestore(app) : null;

// Local development against the Firebase emulator suite. Set
// VITE_FIREBASE_EMULATOR=true (see .env.e2e) to point the app at a local
// Firestore emulator instead of the cloud project.
if (db && import.meta.env.VITE_FIREBASE_EMULATOR === 'true') {
  connectFirestoreEmulator(
    db,
    import.meta.env.VITE_FIREBASE_EMULATOR_HOST || 'localhost',
    Number(import.meta.env.VITE_FIREBASE_EMULATOR_PORT ?? 8080),
  );
}
