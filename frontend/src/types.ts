export type AgentId = "email" | "incident";

/** Mirrors server DEFAULT_PROFILE / business profile JSON */
export type BusinessProfile = {
  business_id: string;
  user_name: string;
  business_name: string;
  business_type: string;
  country: string;
  email_platform: string;
  it_support: string;
  has_cyber_insurance: boolean | null;
  policy_inclusions: string;
  policy_exclusions: string;
  insurance_declarations_original_name?: string;
  insurance_declarations_relpath?: string;
  insurance_declarations_onboarding_done?: boolean;
  has_mfa_for_all_users: boolean | null;
  sends_sensitive_files_via_email_regularly: boolean | null;
  uses_file_sharing_solutions: string[];
  onboarding_complete: boolean;
};

export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  assistantAgent?: AgentId;
};

export type ChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  agent: AgentId;
};
