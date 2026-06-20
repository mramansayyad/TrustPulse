import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { TrustScore } from "./shared-types";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

export const decisionEngine = onDocumentWritten("trust_scores/{sessionId}", async (event) => {
  const sessionId = event.params.sessionId;
  const scoreDoc = event.data?.after;
  
  if (!scoreDoc || !scoreDoc.exists) {
    console.log(`TrustScore for session ${sessionId} was deleted. Skipping decision.`);
    return;
  }

  const score = scoreDoc.data() as TrustScore;
  console.log(`Processing decision for session ${sessionId} with score ${score.score} (${score.decision})...`);

  const sessionRef = db.collection("sessions").doc(sessionId);

  if (score.decision === "allow") {
    // Session is allowed. Update status to active
    await sessionRef.update({
      status: "active",
      updated_at: new Date().toISOString()
    });
    console.log(`Session ${sessionId} status updated to active (seamless).`);
  } else {
    // score.decision === "step_up"
    // Create a mock OTP/challenge code (e.g. 6-digit number)
    const challengeCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    await sessionRef.update({
      status: "stepped_up",
      challenge_code: challengeCode,
      step_up_reason: score.reasoning,
      updated_at: new Date().toISOString()
    });
    
    console.log(`Session ${sessionId} status updated to stepped_up. Generated mock MFA challenge code: ${challengeCode}.`);
  }
});
