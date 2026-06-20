import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  setDoc,
  query, 
  orderBy,
  deleteDoc,
  getDocs
} from "firebase/firestore";
import { 
  connectFirestoreEmulator 
} from "firebase/firestore";
import { 
  Activity, 
  Shield, 
  ShieldAlert, 
  Smartphone, 
  Globe, 
  XCircle, 
  Database, 
  Sparkles,
  RefreshCw,
  UserCheck
} from "lucide-react";
import type { Session, TrustScore } from "./shared-types";

// Initialize Firebase App
const firebaseConfig = {
  apiKey: "mock-api-key-for-local-demo",
  projectId: import.meta.env.VITE_GCP_PROJECT_ID || "YOUR_GCP_PROJECT_ID",
  appId: "mock-app-id-123"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Connect to local emulator if running locally
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  connectFirestoreEmulator(db, "localhost", 8085);
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedScore, setSelectedScore] = useState<TrustScore | null>(null);
  const [challengeInput, setChallengeInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);

  // Subscribe to real-time sessions feed
  useEffect(() => {
    const q = query(collection(db, "sessions"), orderBy("updated_at", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs: Session[] = [];
      snapshot.forEach((doc) => {
        docs.push(doc.data() as Session);
      });
      setSessions(docs);
      
      // Auto-select the first session if none selected
      if (docs.length > 0 && !selectedSessionId) {
        setSelectedSessionId(docs[0].id);
      }
    });

    return () => unsubscribe();
  }, [selectedSessionId]);

  // Subscribe to real-time selected session trust score
  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedScore(null);
      return;
    }

    const docRef = doc(db, "trust_scores", selectedSessionId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setSelectedScore(docSnap.data() as TrustScore);
      } else {
        setSelectedScore(null);
      }
    });

    return () => unsubscribe();
  }, [selectedSessionId]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId) || null;

  // Perform client-side seeding (highly convenient for live demo execution)
  const handleSeedData = async () => {
    setIsSeeding(true);
    setErrorMessage("");
    try {
      // Clear collections first
      const collections = ["sessions", "device_graph", "risk_profiles", "trust_scores", "audit_trail"];
      for (const coll of collections) {
        const snap = await getDocs(collection(db, coll));
        for (const docSnap of snap.docs) {
          await deleteDoc(doc(db, coll, docSnap.id));
        }
      }

      const userNormalHash = "c748c581e289bf6b9b3e1577bd91a62ee99d21226071efefeb39b56f8f7f7fef"; // SHA-256 placeholder for bob-customer-007

      // Seed profile baseline
      await setDoc(doc(db, "risk_profiles", userNormalHash), {
        user_id_hash: userNormalHash,
        typical_devices: ["device-normal"],
        typical_geo_buckets: ["IN-DL"],
        baseline_behavior_vector: [120, 150, 160, 180, 200],
        updated_at: new Date().toISOString()
      });

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

      // Wait 1.5 seconds for villain session seed
      setTimeout(async () => {
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
        setIsSeeding(false);
      }, 1500);

    } catch (err: any) {
      console.error(err);
      setErrorMessage("Seeding failed: " + err.message);
      setIsSeeding(false);
    }
  };

  const handleVerifyStepUp = async () => {
    if (!selectedSession) return;
    setErrorMessage("");

    const correctCode = (selectedSession as any).challenge_code;
    if (challengeInput.trim() === correctCode) {
      try {
        await updateDoc(doc(db, "sessions", selectedSession.id), {
          status: "active",
          updated_at: new Date().toISOString()
        });
        setChallengeInput("");
      } catch (err: any) {
        setErrorMessage("Verification failed: " + err.message);
      }
    } else {
      setErrorMessage("Invalid verification code. Please try again.");
    }
  };

  const handleBlockSession = async () => {
    if (!selectedSession) return;
    setErrorMessage("");
    try {
      await updateDoc(doc(db, "sessions", selectedSession.id), {
        status: "closed",
        updated_at: new Date().toISOString()
      });
      setChallengeInput("");
    } catch (err: any) {
      setErrorMessage("Failed to block session: " + err.message);
    }
  };

  const getRiskColor = (score: number) => {
    if (score < 30) return "var(--accent-green)";
    if (score < 60) return "var(--accent-amber)";
    return "var(--accent-red)";
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="title-area">
          <h1>
            <Shield className="logo-icon" style={{ color: "var(--accent-cyan)" }} />
            TrustPulse
          </h1>
          <p>Continuous Identity Trust Architecture & Real-Time Decisioning Engine</p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span className="badge-pill badge-live">
            <Activity size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} />
            Emulator Stream
          </span>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Column: Live Session Feed */}
        <section className="glass-panel">
          <div className="panel-header">
            <h2>Live Session Feed</h2>
            <button 
              className="btn btn-seed" 
              onClick={handleSeedData}
              disabled={isSeeding}
              style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", padding: "6px 12px" }}
            >
              <RefreshCw size={12} className={isSeeding ? "spin" : ""} />
              {isSeeding ? "Seeding..." : "Reset & Seed Demo"}
            </button>
          </div>
          <div className="panel-body">
            <div className="session-list">
              {sessions.length === 0 ? (
                <div className="empty-state">
                  <Database size={32} style={{ opacity: 0.3 }} />
                  <p>No active sessions detected.</p>
                  <p style={{ fontSize: "12px" }}>Click "Reset & Seed Demo" to populate baseline users.</p>
                </div>
              ) : (
                sessions.map((sess) => {
                  const isSelected = sess.id === selectedSessionId;
                  const isVillain = sess.id === "demo-villain";
                  return (
                    <div 
                      key={sess.id}
                      onClick={() => setSelectedSessionId(sess.id)}
                      className={`session-item ${isSelected ? (isVillain ? "selected-villain" : "selected") : ""}`}
                    >
                      <div className="session-item-header">
                        <span className="session-id">{sess.id}</span>
                        <span className={`status-badge status-${sess.status}`}>
                          {sess.status.replace("_", " ")}
                        </span>
                      </div>
                      <div className="session-details">
                        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <Smartphone size={12} /> {sess.device_id}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <Globe size={12} /> {sess.geo_bucket}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* Right Column: Reasoning & Breakdown */}
        <div className="main-display">
          {/* Top Panel: Selected Risk Gauge and Synthesis */}
          <section className="glass-panel" style={{ minHeight: "220px" }}>
            <div className="panel-header">
              <h2>Identity Trust Evaluation</h2>
            </div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
              {!selectedSession ? (
                <div className="empty-state">
                  <Activity size={32} style={{ opacity: 0.3 }} />
                  <p>Select a session to view identity trust evaluation.</p>
                </div>
              ) : (
                <div className="trust-score-banner">
                  {/* Gauge */}
                  <div className="gauge-container">
                    <svg className="gauge-svg" viewBox="0 0 180 180">
                      <circle className="gauge-bg" cx="90" cy="90" r="75" />
                      <circle 
                        className="gauge-fill" 
                        cx="90" 
                        cy="90" 
                        r="75"
                        stroke={selectedScore ? getRiskColor(selectedScore.score) : "var(--accent-cyan)"}
                        strokeDasharray={`${((selectedScore?.score || 0) / 100) * 471} 471`}
                      />
                    </svg>
                    <div className="gauge-text">
                      <span className="gauge-value" style={{ color: selectedScore ? getRiskColor(selectedScore.score) : "var(--accent-cyan)" }}>
                        {selectedScore ? selectedScore.score : "--"}
                      </span>
                      <span className="gauge-label">Risk Index</span>
                    </div>
                  </div>

                  {/* Verdict Details */}
                  <div className="risk-decision-box">
                    {selectedScore ? (
                      <>
                        <span className={`decision-badge decision-${selectedScore.decision}`}>
                          {selectedScore.decision === "allow" ? "Seamless Allowed" : "Step-Up Required"}
                        </span>
                        <p className="reasoning-text">
                          {selectedScore.reasoning}
                        </p>
                      </>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-secondary)" }}>
                        <Sparkles className="spin" size={18} />
                        <span>Evaluating multi-agent Gemini risk reasoning...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Bottom Panel: Multi-Agent Breakdown & Step Up Action */}
          <section className="glass-panel">
            <div className="panel-header">
              <h2>Multi-Agent Reasoning Logs (Explainable AI)</h2>
            </div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {!selectedScore || !selectedSession ? (
                <div className="empty-state">
                  <Sparkles size={32} style={{ opacity: 0.3 }} />
                  <p>Reasoning logs will appear once the evaluation is processed.</p>
                </div>
              ) : (
                <>
                  {/* Agent Cards */}
                  <div className="agent-grid">
                    {selectedScore.contributing_agents.map((agent) => (
                      <div className="agent-card" key={agent.agent}>
                        <div className="agent-card-header">
                          <span className="agent-name">{agent.agent.replace("-agent", "")}</span>
                          <span className="agent-score" style={{ color: getRiskColor(agent.risk_contribution) }}>
                            {agent.risk_contribution}
                          </span>
                        </div>
                        <p className="agent-reason">{agent.reasoning}</p>
                        <div className="agent-flags">
                          {agent.flags.map(f => (
                            <span className="flag-badge" key={f}>{f.replace("_", " ")}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Adaptive Step-Up Prompt UI */}
                  {selectedSession.status === "stepped_up" && (
                    <div className="stepup-box">
                      <div className="stepup-title">
                        <ShieldAlert />
                        <span>Adaptive Step-Up Verification Active</span>
                      </div>
                      <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
                        The Gemini Risk Engine flagged this session. Firebase Multi-Factor Challenge initiated.
                        <br />
                        <strong style={{ color: "var(--accent-cyan)", fontFamily: "var(--font-mono)" }}>
                          Demo MFA Challenge Code: {(selectedSession as any).challenge_code || "PENDING"}
                        </strong>
                      </p>

                      <div className="stepup-actions">
                        <input 
                          type="text" 
                          placeholder="MFA CODE"
                          maxLength={6}
                          value={challengeInput}
                          onChange={(e) => setChallengeInput(e.target.value)}
                          className="verify-input" 
                        />
                        <button className="btn btn-primary" onClick={handleVerifyStepUp}>
                          Verify Identity
                        </button>
                        <button className="btn btn-danger" onClick={handleBlockSession}>
                          Block Account Access
                        </button>
                      </div>

                      {errorMessage && (
                        <p style={{ color: "var(--accent-red)", fontSize: "13px", fontWeight: "600" }}>
                          {errorMessage}
                        </p>
                      )}
                    </div>
                  )}

                  {selectedSession.status === "active" && selectedScore.decision === "step_up" && (
                    <div className="stepup-box" style={{ background: "rgba(0, 230, 118, 0.04)", border: "1px dashed rgba(0, 230, 118, 0.3)" }}>
                      <div className="stepup-title" style={{ color: "var(--accent-green)" }}>
                        <UserCheck />
                        <span>Identity Authenticated</span>
                      </div>
                      <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
                        The user successfully resolved the Multi-Factor Authentication challenge. Access granted.
                      </p>
                    </div>
                  )}

                  {selectedSession.status === "closed" && (
                    <div className="stepup-box" style={{ background: "rgba(255, 77, 77, 0.04)", border: "1px dashed rgba(255, 77, 77, 0.3)" }}>
                      <div className="stepup-title" style={{ color: "var(--accent-red)" }}>
                        <XCircle />
                        <span>Session Closed & Blocked</span>
                      </div>
                      <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
                        Access was revoked due to verification failure or manual administrator override.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
