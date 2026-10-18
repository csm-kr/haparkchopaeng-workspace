-- Private task conversations are accessed only by the authenticated application server.
-- Apply with the goal-task DDL in the same transaction, before exposing the new web code.
REVOKE ALL ON TABLE public."AgentTask", public."AgentOperation"
  FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public."AgentTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AgentOperation" ENABLE ROW LEVEL SECURITY;
-- No policies and no FORCE: server owner postgres retains access.
-- Existing tables and default privileges are intentionally unchanged.
