import { notFound } from "next/navigation";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { requireOperator } from "@/lib/session";
import { getSkillByKey } from "@/lib/queries";

export default async function SkillEditorPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  await requireOperator();
  const { key } = await params;
  const skill = await getSkillByKey(key);
  if (!skill) notFound();
  return <SkillEditor skill={skill} />;
}
