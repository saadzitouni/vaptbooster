import { SkillCatalog } from "@/components/skills/SkillCatalog";
import { requireOperator } from "@/lib/session";
import { getSkillCatalog } from "@/lib/queries";

export default async function SkillCatalogPage() {
  await requireOperator();
  const skills = await getSkillCatalog();
  return <SkillCatalog skills={skills} />;
}
