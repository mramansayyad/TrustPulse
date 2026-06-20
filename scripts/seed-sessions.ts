import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as crypto from "crypto";

// Set emulator env variable if running local
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";

if (getApps().length === 0) {
  initializeApp({
    projectId: process.env.GCP_PROJECT_ID || "YOUR_GCP_PROJECT_ID"
  });
}

const db = getFirestore();

function getUserIdHash(userId: string): string {
  return crypto.createHash("sha256").update(userId).digest("hex");
}

async function clearCollections() {
  const collections = ["sessions", "device_graph", "risk_profiles", "trust_scores", "audit_trail"];
  for (const coll of collections) {
    const snap = await db.collection(coll).get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`Cleared collection: ${coll}`);
  }
}

async function seed() {
  console.log("Starting database seeding...");
  await clearCollections();

  const normalUserId = "bob-customer-007";
  const userNormalHash = getUserIdHash(normalUserId);

  console.log(`Generated normal user ID hash: ${userNormalHash}`);

  // 1. Seed user risk profile (historical baseline)
  await db.collection("risk_profiles").doc(userNormalHash).set({
    user_id_hash: userNormalHash,
    typical_devices: ["device-normal"],
    typical_geo_buckets: ["IN-DL"], // Delhi (normal location)
    baseline_behavior_vector: [120, 150, 160, 180, 200], // Typing intervals in ms
    updated_at: new Date().toISOString()
  });
  console.log("Seeded user risk profile baseline.");

  // 2. Seed device graph entries
  await db.collection("device_graph").doc("device-normal").set({
    id: "device-normal",
    first_seen: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
    linked_user_hashes: [userNormalHash],
    trust_tier: "known",
    app_check_verdict: "valid"
  });

  await db.collection("device_graph").doc("device-villain").set({
    id: "device-villain",
    first_seen: new Date().toISOString(),
    linked_user_hashes: [],
    trust_tier: "new",
    app_check_verdict: "missing"
  });
  console.log("Seeded device graph entries.");

  // 3. Seed Normal Session
  // This will trigger evaluateRisk, which runs risk evaluation
  await db.collection("sessions").doc("demo-normal").set({
    id: "demo-normal",
    user_id_hash: userNormalHash,
    device_id: "device-normal",
    started_at: new Date().toISOString(),
    geo_bucket: "IN-DL",
    time_of_day_bucket: "afternoon",
    behavior_score: 5, // very normal typing pattern
    status: "active",
    transaction_amount: 1200,
    updated_at: new Date().toISOString()
  });
  console.log("Seeded demo-normal session.");

  // 4. Seed Villain Session (Wait 1.5 seconds to separate them in logs/dashboard)
  await new Promise(r => setTimeout(r, 1500));

  await db.collection("sessions").doc("demo-villain").set({
    id: "demo-villain",
    user_id_hash: userNormalHash,
    device_id: "device-villain",
    started_at: new Date().toISOString(),
    geo_bucket: "IN-MH", // Mumbai (anomalous location/hop)
    time_of_day_bucket: "night", // off hours
    behavior_score: 85, // erratic typing pattern / potential bot or unauthorized recovery
    status: "active",
    transaction_amount: 250000, // Critical transfer amount
    updated_at: new Date().toISOString()
  });
  console.log("Seeded demo-villain session.");

  console.log("Seeding complete! Local emulator database ready for demo.");
}

seed().catch(err => {
  console.error("Seeding failed:", err);
});
