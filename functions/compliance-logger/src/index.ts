import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { BigQuery } from "@google-cloud/bigquery";
import { TrustScore, Session } from "./shared-types";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// Initialize BigQuery client
const bq = new BigQuery({
  projectId: process.env.GCP_PROJECT_ID || "YOUR_GCP_PROJECT_ID"
});

const DATASET_ID = "trustpulse";
const TABLE_ID = "audit_trail";

// Initialize local Firestore collection fallback for compliance logging (makes local demo work flawlessly)
async function writeToLocalAuditTrail(row: any) {
  try {
    await db.collection("audit_trail").doc(row.event_id).set(row);
    console.log(`[Local Audit Trail] Logged event ${row.event_id} for session ${row.session_id}`);
  } catch (err: any) {
    console.error("Failed to write to local audit_trail Firestore collection:", err.message);
  }
}

async function updateLocalAuditTrailResolution(sessionId: string, resolution: string) {
  try {
    const snap = await db.collection("audit_trail")
      .where("session_id", "==", sessionId)
      .limit(1)
      .get();
    
    if (!snap.empty) {
      const doc = snap.docs[0];
      await doc.ref.update({ resolution });
      console.log(`[Local Audit Trail] Updated resolution for session ${sessionId} to ${resolution}`);
    }
  } catch (err: any) {
    console.error("Failed to update local audit_trail Firestore resolution:", err.message);
  }
}

// Write to BigQuery with local fallback
async function logToBigQuery(row: any) {
  // Always log locally first
  await writeToLocalAuditTrail(row);

  try {
    if (process.env.FUNCTIONS_EMULATOR === "true") {
      console.log("[BigQuery] Emulator mode active. Skipping remote streaming insert.");
      return;
    }

    const dataset = bq.dataset(DATASET_ID);
    const table = dataset.table(TABLE_ID);

    const bqRow = {
      event_id: row.event_id,
      session_id: row.session_id,
      user_id_hash: row.user_id_hash,
      timestamp: bq.datetime(row.timestamp),
      trust_score: row.trust_score,
      decision: row.decision,
      reasoning: row.reasoning,
      contributing_agents: JSON.stringify(row.contributing_agents),
      resolution: row.resolution
    };

    await table.insert(bqRow);
    console.log(`[BigQuery] Streamed log event ${row.event_id} successfully.`);
  } catch (error: any) {
    console.error(`[BigQuery] Insert failed: ${error.message}. Resolving through local fallback.`);
  }
}

async function updateBigQueryResolution(sessionId: string, resolution: string) {
  await updateLocalAuditTrailResolution(sessionId, resolution);

  try {
    if (process.env.FUNCTIONS_EMULATOR === "true") {
      return;
    }

    const query = `
      UPDATE \`${process.env.GCP_PROJECT_ID || "YOUR_GCP_PROJECT_ID"}.${DATASET_ID}.${TABLE_ID}\`
      SET resolution = @resolution
      WHERE session_id = @sessionId
    `;

    const options = {
      query: query,
      params: { resolution, sessionId }
    };

    await bq.query(options);
    console.log(`[BigQuery] Updated resolution to ${resolution} for session ${sessionId}.`);
  } catch (error: any) {
    console.error(`[BigQuery] Update resolution query failed: ${error.message}.`);
  }
}

// 1. Triggered on TrustScore creation
export const logDecision = onDocumentWritten("trust_scores/{sessionId}", async (event) => {
  const sessionId = event.params.sessionId;
  const scoreDoc = event.data?.after;

  if (!scoreDoc || !scoreDoc.exists) return;

  const score = scoreDoc.data() as TrustScore;

  // Retrieve session to get user_id_hash
  const sessionDoc = await db.collection("sessions").doc(sessionId).get();
  if (!sessionDoc.exists) {
    console.error(`Session ${sessionId} not found. Cannot log compliance trail.`);
    return;
  }
  const session = sessionDoc.data() as Session;

  const eventId = `evt_${sessionId}_${Date.now()}`;
  const timestamp = new Date().toISOString();

  const auditRow = {
    event_id: eventId,
    session_id: sessionId,
    user_id_hash: session.user_id_hash,
    timestamp: timestamp,
    trust_score: score.score,
    decision: score.decision,
    reasoning: score.reasoning,
    contributing_agents: score.contributing_agents,
    resolution: score.decision === "allow" ? "n/a" : "pending"
  };

  await logToBigQuery(auditRow);
});

// 2. Triggered on Session changes to log resolutions (verified vs abandoned)
export const logResolution = onDocumentWritten("sessions/{sessionId}", async (event) => {
  const sessionId = event.params.sessionId;
  
  const beforeDoc = event.data?.before;
  const afterDoc = event.data?.after;

  if (!beforeDoc || !afterDoc || !beforeDoc.exists || !afterDoc.exists) return;

  const before = beforeDoc.data() as Session;
  const after = afterDoc.data() as Session;

  // Track resolution changes:
  // If status transitions from stepped_up -> active, user is verified.
  // If status transitions from stepped_up -> closed, user is abandoned / failed.
  if (before.status === "stepped_up" && after.status === "active") {
    console.log(`Session ${sessionId} resolved: verified.`);
    await updateBigQueryResolution(sessionId, "verified");
  } else if (before.status === "stepped_up" && after.status === "closed") {
    console.log(`Session ${sessionId} resolved: abandoned.`);
    await updateBigQueryResolution(sessionId, "abandoned");
  }
});
