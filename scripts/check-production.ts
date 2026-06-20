import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin without FIRESTORE_EMULATOR_HOST to query production
if (getApps().length === 0) {
  initializeApp({
    projectId: process.env.GCP_PROJECT_ID || "YOUR_GCP_PROJECT_ID"
  });
}

const db = getFirestore();

async function checkProduction() {
  console.log("Fetching production Firestore documents...");

  const sessionsSnap = await db.collection("sessions").get();
  console.log(`\n--- SESSIONS (${sessionsSnap.size} found) ---`);
  sessionsSnap.docs.forEach(doc => {
    console.log(`Session ID: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
  });

  const scoresSnap = await db.collection("trust_scores").get();
  console.log(`\n--- TRUST SCORES (${scoresSnap.size} found) ---`);
  scoresSnap.docs.forEach(doc => {
    console.log(`Score ID: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
  });
}

checkProduction().catch(err => {
  console.error("Failed to query production Firestore:", err);
});
