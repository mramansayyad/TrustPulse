import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "mock-api-key-for-local-demo",
  projectId: process.env.GCP_PROJECT_ID || "YOUR_GCP_PROJECT_ID",
  appId: "mock-app-id-123"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
  console.log("Checking production documents...");
  
  const sessionsSnap = await getDocs(collection(db, "sessions"));
  console.log(`\n--- SESSIONS (${sessionsSnap.size}) ---`);
  sessionsSnap.forEach(doc => {
    console.log(`Session: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
  });

  const scoresSnap = await getDocs(collection(db, "trust_scores"));
  console.log(`\n--- TRUST SCORES (${scoresSnap.size}) ---`);
  scoresSnap.forEach(doc => {
    console.log(`Score: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
  });
}

check().catch(console.error);
