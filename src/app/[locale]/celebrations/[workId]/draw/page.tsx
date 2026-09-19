import { DrawClient } from "./DrawClient";

export default function CelebrationDrawPage({
  params,
}: {
  params: { workId: string };
}) {
  return <DrawClient workId={params.workId} />;
}
