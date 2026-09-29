import { PageHeader } from "@/components/ui/PageHeader";
import { OpenRouterKeysManager } from "@/components/operator/OpenRouterKeysManager";
import { requireOperator } from "@/lib/session";
import { OPENROUTER_DEPLOYMENTS, listOpenRouterKeys, type OpenRouterKeyRow } from "@/lib/openrouter-keys";

export const dynamic = "force-dynamic";

export default async function LlmKeysPage() {
  await requireOperator();

  let keys: OpenRouterKeyRow[] = [];
  let error: string | null = null;
  try {
    keys = await listOpenRouterKeys();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <PageHeader
        eyebrow="operator · llm keys"
        title={
          <>
            OpenRouter <span className="em">keys</span>
          </>
        }
        lede={
          <>
            Provider keys the LiteLLM gateway uses for every scan. Keys added here are tried first
            (spread across keys when you have several); the <span className="font-mono">OPENROUTER_API_KEY</span>{" "}
            env key is only used when they fail. Changes apply immediately — no restart.
          </>
        }
      />
      {error ? (
        <div className="bg-ink border border-crit/40 rounded-lg px-5 py-4 text-[13px] text-crit font-mono">
          Couldn&apos;t load keys from the gateway: {error}
        </div>
      ) : (
        <OpenRouterKeysManager keys={keys} aliasCount={OPENROUTER_DEPLOYMENTS.length} />
      )}
    </>
  );
}
