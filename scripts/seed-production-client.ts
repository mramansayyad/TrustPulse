import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "mock-api-key-for-local-demo",
  projectId: process.env.GCP_PROJECT_ID || "YOUR_GCP_PROJECT_ID",
  appId: "mock-app-id-123"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function seed() {
  console.log("Seeding production Firestore via Client SDK...");

  const userNormalHash = "c748c581e289bf6b9b3e1577bd91a62ee99d21226071efefeb39b56f8f7f7fef"; // bob-customer-007

  // Seed profile baseline
  await setDoc(doc(db, "risk_profiles", userNormalHash), {
    user_id_hash: userNormalHash,
    typical_devices: ["device-normal"],
    typical_geo_buckets: ["IN-DL"],
    baseline_behavior_vector: [120, 150, 160, 180, 200],
    updated_at: new Date().toISOString()
  });
  console.log("Seeded risk profiles.");

  // Seed normal device
  await setDoc(doc(db, "device_graph", "device-normal"), {
    id: "device-normal",
    first_seen: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    linked_user_hashes: [userNormalHash],
    trust_tier: "known",
    app_check_verdict: "valid"
  });

  // Seed villain device
  await setDoc(doc(db, "device_graph", "device-villain"), {
    id: "device-villain",
    first_seen: new Date().toISOString(),
    linked_user_hashes: [],
    trust_tier: "new",
    app_check_verdict: "missing"
  });
  console.log("Seeded device graph.");

  // Write normal session (triggers risk-agents Cloud Function)
  await setDoc(doc(db, "sessions", "demo-normal"), {
    id: "demo-normal",
    user_id_hash: userNormalHash,
    device_id: "device-normal",
    started_at: new Date().toISOString(),
    geo_bucket: "IN-DL",
    time_of_day_bucket: "afternoon",
    behavior_score: 5,
    status: "active",
    transaction_amount: 1200,
    updated_at: new Date().toISOString()
  });
  console.log("Seeded demo-normal session.");

  // Wait 1.5 seconds for villain session seed
  console.log("Waiting 1.5 seconds before seeding demo-villain...");
  await new Promise(r => setTimeout(r, 1500));

  await setDoc(doc(db, "sessions", "demo-villain"), {
    id: "demo-villain",
    user_id_hash: userNormalHash,
    device_id: "device-villain",
    started_at: new Date().toISOString(),
    geo_bucket: "IN-MH",
    time_of_day_bucket: "night",
    behavior_score: 85,
    status: "active",
    transaction_amount: 250000,
    updated_at: new Date().toISOString()
  });
  console.log("Seeded demo-villain session.");
  console.log("Production database seeding complete!");
}

seed().catch(err => {
  console.error("Seeding failed:", err);
});
