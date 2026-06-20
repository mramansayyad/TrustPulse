import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { Session, Device } from "./shared-types";

admin.initializeApp();
const db = admin.firestore();

function getUserIdHash(userId: string): string {
  return crypto.createHash("sha256").update(userId).digest("hex");
}

function getTimeOfDayBucket(): "night" | "morning" | "afternoon" | "evening" {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 6) return "night";
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

function calculateBehaviorScore(telemetry: { typingCadence?: number[]; navigationTiming?: number[] } | undefined): number {
  if (!telemetry) return 0;
  
  let score = 0;
  
  // Basic heuristic analysis:
  // Typing Cadence (typical typing speed in ms between keys is 100-300ms)
  if (telemetry.typingCadence && telemetry.typingCadence.length > 0) {
    const cadence = telemetry.typingCadence;
    const avg = cadence.reduce((a, b) => a + b, 0) / cadence.length;
    // An average below 50ms (bot/copy-paste) or above 800ms (highly erratic/hesitant typing) is suspicious
    if (avg < 50 || avg > 800) {
      score += 40;
    }
    // Check variance/jitter
    const variance = cadence.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b, 0) / cadence.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 250) { // Highly erratic timing
      score += 20;
    }
  }

  // Navigation Timing
  if (telemetry.navigationTiming && telemetry.navigationTiming.length > 0) {
    const timing = telemetry.navigationTiming;
    const avgNav = timing.reduce((a, b) => a + b, 0) / timing.length;
    if (avgNav < 100) { // Unusually fast navigation (bot behavior)
      score += 30;
    }
  }

  return Math.min(100, score);
}

export const signalIntake = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const {
      sessionId,
      userId,
      deviceId,
      geoBucket,
      transactionAmount,
      telemetry
    } = req.body;

    if (!sessionId || !userId || !deviceId) {
      res.status(400).send("Missing required parameters: sessionId, userId, deviceId");
      return;
    }

    const userIdHash = getUserIdHash(userId);
    const timeOfDayBucket = getTimeOfDayBucket();
    const behaviorScore = calculateBehaviorScore(telemetry);

    // App Check validation (Mocked for emulator, checked in prod)
    const appCheckToken = req.headers["x-firebase-appcheck"] as string;
    let appCheckVerdict = "valid";
    
    if (!appCheckToken) {
      appCheckVerdict = "missing";
    } else {
      try {
        if (process.env.FUNCTIONS_EMULATOR !== "true") {
          await admin.appCheck().verifyToken(appCheckToken);
        }
      } catch (err) {
        appCheckVerdict = "invalid";
      }
    }

    // Determine trust tier for the device
    let trustTier: "known" | "new" | "suspicious" = "known";
    if (appCheckVerdict === "missing" || appCheckVerdict === "invalid") {
      trustTier = "suspicious";
    }

    // Update Device Graph
    const deviceRef = db.collection("device_graph").doc(deviceId);
    const deviceDoc = await deviceRef.get();

    if (!deviceDoc.exists) {
      if (trustTier !== "suspicious") {
        trustTier = "new";
      }
      await deviceRef.set({
        id: deviceId,
        first_seen: new Date().toISOString(),
        linked_user_hashes: [userIdHash],
        trust_tier: trustTier,
        app_check_verdict: appCheckVerdict
      });
    } else {
      const deviceData = deviceDoc.data() as Device;
      const linkedUsers = new Set(deviceData.linked_user_hashes || []);
      linkedUsers.add(userIdHash);
      
      // If a device is shared across more than 3 user hashes, raise suspicion
      let updatedTrustTier = deviceData.trust_tier;
      if (linkedUsers.size > 3) {
        updatedTrustTier = "suspicious";
      } else if (trustTier === "suspicious") {
        updatedTrustTier = "suspicious";
      }

      await deviceRef.update({
        linked_user_hashes: Array.from(linkedUsers),
        trust_tier: updatedTrustTier,
        app_check_verdict: appCheckVerdict
      });
    }

    // Write / Update Session
    const sessionRef = db.collection("sessions").doc(sessionId);
    const startedAt = new Date().toISOString();
    
    const sessionData: Partial<Session> = {
      id: sessionId,
      user_id_hash: userIdHash,
      device_id: deviceId,
      geo_bucket: geoBucket || "IN-DL",
      time_of_day_bucket: timeOfDayBucket,
      behavior_score: behaviorScore,
      status: "active",
      transaction_amount: Number(transactionAmount) || 0,
      updated_at: startedAt
    };

    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) {
      sessionData.started_at = startedAt;
      await sessionRef.set(sessionData);
    } else {
      await sessionRef.update(sessionData);
    }

    res.status(200).json({
      success: true,
      sessionId,
      user_id_hash: userIdHash,
      behavior_score: behaviorScore,
      app_check_verdict: appCheckVerdict
    });
  } catch (error: any) {
    console.error("Error in signal-intake:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
