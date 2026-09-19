import { ReviewClient } from "./ReviewClient";

export default function CelebrationReviewPage({
  params,
}: {
  params: { workId: string };
}) {
  return <ReviewClient workId={params.workId} />;
}
