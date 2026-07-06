import { AgentConfigEditor } from "@/components/skills/AgentConfigEditor";
import { requireOperator } from "@/lib/session";
import { getAgentConfig } from "@/lib/queries";

export default async function AgentConfigPage() {
  await requireOperator();
  const config = await getAgentConfig();
  return <AgentConfigEditor config={config} />;
}
