import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

let firebaseApp = null;

export const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (!serviceAccountJson) {
      console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT is not defined in environment variables. Push notifications will be disabled.");
      return null;
    }

    // Parse the JSON string from the environment variable
    const serviceAccount = JSON.parse(serviceAccountJson);

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("🔥 Firebase Admin SDK initialized successfully");
    return firebaseApp;
  } catch (error) {
    console.error("❌ Firebase Admin initialization failed:", error);
    return null;
  }
};

export const getFirebaseAdmin = () => {
  if (!firebaseApp) {
    return initFirebase();
  }
  return admin;
};
