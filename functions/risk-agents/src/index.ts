import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Session, Device, RiskProfile, RiskFeatures, AgentVerdict, TrustScore } from "./shared-types";

// Initialize Firebase Admin if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// Initialize Google AI Studio SDK
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// JSON schema for combined risk assessment
const combinedScoreSchema: any = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "Final combined aggregated risk score from 0 to 100, where higher is riskier."
    },
    decision: {
      type: "string",
      description: "Final decision: allow (score < 40) or step_up (score >= 40)."
    },
    reasoning: {
      type: "string",
      description: "Synthesized, non-redundant, natural explanation for the final score."
    },
    contributing_agents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Name of the perspective: onboarding-agent, recovery-agent, or privileged-access-agent."
          },
          risk_contribution: {
            type: "integer",
            description: "Risk score contribution from 0 to 100."
          },
          confidence: {
            type: "number",
            description: "Confidence value between 0.0 and 1.0."
          },
          reasoning: {
            type: "string",
            description: "One clear, natural-language sentence explaining the risk assessment."
          },
          flags: {
            type: "array",
            items: { type: "string" },
            description: "List of risk indicators triggered."
          }
        },
        required: ["agent", "risk_contribution", "confidence", "reasoning", "flags"]
      }
    }
  },
  required: ["score", "decision", "reasoning", "contributing_agents"]
};

// Specialist Agent system instructions compiled into a single unified prompt
const COMBINED_SYSTEM_PROMPT = `You are the Identity Trust Risk Engine, running three specialist risk perspectives and orchestrating their verdicts:

1. onboarding-agent: Assess new registration or KYC risks based on the client session profile. Look for device status, app check status, behavioral score, and location consistency.
2. recovery-agent: Assess account recovery and login risks. Compare current device/location features against typical user baselines. Look for new devices, off-hours, high transaction value, and behavioral anomalies.
3. privileged-access-agent: Assess operational risks for high-value or privileged actions. Flag critical transaction amounts, suspicious location hops, or extreme behavioral scores.

First, evaluate the risk from each of these three perspectives. Output their individual findings in contributing_agents. You MUST run exactly all three perspectives (onboarding-agent, recovery-agent, privileged-access-agent) and populate all three objects in the contributing_agents array.
Second, aggregate these findings into a final trust score (0-100, where higher is riskier). Set the decision to "step_up" if score >= 40, else "allow".
Third, write a synthesized, consolidated, non-redundant reasoning statement explaining this final score.
Return strict JSON matching the schema.`;

async function callCombinedEngine(
  features: RiskFeatures,
  baseline: RiskProfile | null
): Promise<{
  score: number;
  decision: "allow" | "step_up";
  reasoning: string;
  contributing_agents: AgentVerdict[];
}> {
  if (!genAI) {
    throw new Error("Gemini API client not initialized.");
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: combinedScoreSchema,
      temperature: 0.1
    }
  });

  const prompt = `
SYSTEM:
${COMBINED_SYSTEM_PROMPT}

USER:
Current Session Signals:
${JSON.stringify(features, null, 2)}

User Baseline Profile:
${JSON.stringify(baseline, null, 2)}

Assess the risk this represents. Be conservative. Highlight new patterns, device flags, or behavioral anomalies.
`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  return JSON.parse(responseText.trim()) as any;
}

// Main trigger
export const evaluateRisk = onDocumentWritten("sessions/{sessionId}", async (event) => {
  const sessionId = event.params.sessionId;
  
  // Get data after the change
  const sessionDoc = event.data?.after;
  if (!sessionDoc || !sessionDoc.exists) {
    console.log(`Session ${sessionId} was deleted. Skipping risk evaluation.`);
    return;
  }

  const session = sessionDoc.data() as Session;

  // Crucial: Prevent loops by comparing before/after states
  const before = event.data?.before?.data() as Session | undefined;
  if (before) {
    const featuresChanged =
      before.device_id !== session.device_id ||
      before.geo_bucket !== session.geo_bucket ||
      before.time_of_day_bucket !== session.time_of_day_bucket ||
      before.behavior_score !== session.behavior_score ||
      before.transaction_amount !== session.transaction_amount ||
      before.status !== session.status;

    // Skip evaluation if features haven't changed, or if status changed from MFA/closed state
    if (!featuresChanged || before.status === "stepped_up" || before.status === "closed") {
      console.log(`Session ${sessionId} features did not change or was updated from verification. Skipping risk evaluation.`);
      return;
    }
  }

  // Crucial: Only evaluate when the session is "active"
  // This prevents loops where the decision engine updates the session to "stepped_up" or "closed" and retriggers this.
  if (session.status !== "active") {
    console.log(`Session ${sessionId} has status "${session.status}". Skipping risk evaluation.`);
    return;
  }

  console.log(`Evaluating risk for session ${sessionId}...`);

  // 1. Gather signals
  const deviceDoc = await db.collection("device_graph").doc(session.device_id).get();
  const device = deviceDoc.exists ? (deviceDoc.data() as Device) : null;

  const profileDoc = await db.collection("risk_profiles").doc(session.user_id_hash).get();
  const profile = profileDoc.exists ? (profileDoc.data() as RiskProfile) : null;

  // Calculate geo-velocity
  const geoAnomaly = profile ? !profile.typical_geo_buckets.includes(session.geo_bucket) : true;

  // Determine transaction bucket
  let amountBucket: "low" | "medium" | "high" | "critical" = "low";
  if (session.transaction_amount >= 200000) amountBucket = "critical";
  else if (session.transaction_amount >= 50000) amountBucket = "high";
  else if (session.transaction_amount >= 10000) amountBucket = "medium";

  // Construct standard privacy-preserving features payload
  const features: RiskFeatures = {
    user_id_hash: session.user_id_hash,
    device_id: session.device_id,
    device_trust_tier: device?.trust_tier || "new",
    app_check_verdict: device?.app_check_verdict || "missing",
    behavior_anomaly_score: session.behavior_score,
    geo_velocity_flag: geoAnomaly,
    geo_bucket: session.geo_bucket,
    time_of_day_bucket: session.time_of_day_bucket,
    transaction_amount_bucket: amountBucket,
    transaction_amount: session.transaction_amount,
    timestamp: session.updated_at
  };

  let trustScore: TrustScore;

  // Fallback safety threshold logic if Gemini fails
  const localFallbackScore = (): TrustScore => {
    let score = 0;
    const flags: string[] = [];
    const verdicts: AgentVerdict[] = [];

    // Simple rule-based calculation for safety fallback
    if (features.device_trust_tier === "suspicious" || features.app_check_verdict === "invalid") {
      score += 45;
      flags.push("suspicious_device");
    } else if (features.device_trust_tier === "new") {
      score += 15;
      flags.push("new_device");
    }

    if (features.behavior_anomaly_score > 50) {
      score += 25;
      flags.push("erratic_behavior");
    }

    if (features.geo_velocity_flag) {
      score += 20;
      flags.push("unusual_location");
    }

    if (features.time_of_day_bucket === "night") {
      score += 10;
      flags.push("off_hours");
    }

    if (features.transaction_amount_bucket === "high" || features.transaction_amount_bucket === "critical") {
      score += 15;
      flags.push("large_transfer");
    }

    score = Math.min(100, score);
    const decision = score >= 40 ? "step_up" : "allow";
    const reasoning = `Fallback: evaluated score of ${score} based on rules. Flags: ${flags.join(", ")}`;

    verdicts.push({
      agent: "recovery-agent",
      risk_contribution: score,
      confidence: 0.8,
      reasoning: "Rule-based fallback execution.",
      flags
    });

    return {
      session_id: sessionId,
      score,
      decision,
      reasoning,
      contributing_agents: verdicts,
      created_at: new Date().toISOString()
    };
  };

  try {
    if (!genAI) {
      throw new Error("No Gemini API key configured. Executing safety rules fallback.");
    }

    const evaluation = await callCombinedEngine(features, profile);

    trustScore = {
      session_id: sessionId,
      score: evaluation.score,
      decision: evaluation.decision,
      reasoning: evaluation.reasoning,
      contributing_agents: evaluation.contributing_agents,
      created_at: new Date().toISOString()
    };
    
    console.log(`Risk reasoning complete. Score: ${trustScore.score}, Decision: ${trustScore.decision}`);

  } catch (error: any) {
    console.error("Gemini risk agent pipeline failed:", error.message);
    // Execute safety fallback
    trustScore = localFallbackScore();
    trustScore.reasoning = `AI system unavailable, defaulted safely. Detail: ${trustScore.reasoning}`;
  }

  // Write trust score to Firestore
  await db.collection("trust_scores").doc(sessionId).set(trustScore);
  console.log(`Saved trust score for session ${sessionId} to trust_scores collection.`);
});
