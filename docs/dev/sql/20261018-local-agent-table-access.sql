-- The server uses Prisma as postgres. These tables must not be exposed through
-- Supabase's browser Data API. Revoke TRUNCATE too: RLS alone cannot block it.
-- Apply in the same transaction as the two 20261017 schema additions.
REVOKE ALL PRIVILEGES ON TABLE
    public."LocalAgentDevice", public."LocalAgentAttempt",
    public."LocalAgentGrant", public."LocalAgentSnapshot",
    public."LocalAgentJob", public."ResearchConversation"
FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public."LocalAgentDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LocalAgentAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LocalAgentGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LocalAgentSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LocalAgentJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ResearchConversation" ENABLE ROW LEVEL SECURITY;

-- No policies and no FORCE RLS: only the trusted server/table owner has access.
-- Existing tables, default privileges, Auth, and Storage are unchanged.
