"use client";

/**
 * Firebase Web SDK — auth only.
 *
 * Per the Section 0/3 decision recorded in WEB_MIGRATION_PLAN.md, Firebase
 * provides IDENTITY only. Application data (including chat) lives in the
 * repository layer, so `firebase/firestore` is deliberately not imported here.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * True when the Firebase env vars are actually filled in. Lets the app boot and
 * render (and show a useful message) instead of throwing at import time when
 * someone clones the repo without credentials.
 */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error(
      "Firebase is not configured. Copy .env.example to .env.local and fill in the NEXT_PUBLIC_FIREBASE_* values.",
    );
  }
  app ??= getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
    // Survive a page reload; the httpOnly session cookie is what the server
    // trusts, but the client SDK still needs its own persisted state.
    void setPersistence(authInstance, browserLocalPersistence);
  }
  return authInstance;
}
