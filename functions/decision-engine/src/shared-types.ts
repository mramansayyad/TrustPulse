export interface RiskFeatures {
  user_id_hash: string;
  device_id: string;
  device_trust_tier: "known" | "new" | "suspicious";
  app_check_verdict: string;
  behavior_anomaly_score: number; // 0-100 (higher means more anomalous/unusual)
  geo_velocity_flag: boolean;
  geo_bucket: string; // coarse region/state like "IN-DL", "IN-MH"
  time_of_day_bucket: "night" | "morning" | "afternoon" | "evening";
  transaction_amount_bucket: "low" | "medium" | "high" | "critical";
  transaction_amount: number;
  timestamp: string; // ISO format
}

export interface AgentVerdict {
  agent: "onboarding-agent" | "recovery-agent" | "privileged-access-agent";
  risk_contribution: number;     // 0-100
  confidence: number;            // 0-1
  reasoning: string;             // short natural-language justification
  flags: string[];               // e.g. ["new_device", "geo_anomaly"]
}

export interface TrustScore {
  session_id: string;
  score: number;                 // 0-100 aggregated risk score
  decision: "allow" | "step_up";
  reasoning: string;             // synthesized, non-redundant explanation
  contributing_agents: AgentVerdict[];
  created_at: string;            // ISO format
}

export interface Session {
  id: string;
  user_id_hash: string;
  device_id: string;
  started_at: string;            // ISO format
  geo_bucket: string;
  time_of_day_bucket: "night" | "morning" | "afternoon" | "evening";
  behavior_score: number;        // 0-100 client-side anomaly score
  status: "active" | "stepped_up" | "closed";
  transaction_amount: number;
  updated_at: string;            // ISO format
}

export interface Device {
  id: string;
  first_seen: string;            // ISO format
  linked_user_hashes: string[];
  trust_tier: "known" | "new" | "suspicious";
  app_check_verdict: string;
}

export interface RiskProfile {
  user_id_hash: string;
  baseline_behavior_vector: number[]; // rolling baseline
  typical_devices: string[];
  typical_geo_buckets: string[];
  updated_at: string;
}
