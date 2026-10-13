import { conversationStore } from "@/lib/conversations/store";
import { auth } from "@clerk/nextjs/server";
import { handleFeedback } from "@/lib/ai/handle-feedback";
import { saveTrackingFeedback, trackingEnabled } from "@/lib/ai/tracking";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const { userId } = await auth();
  return handleFeedback(
    request,
    userId,
    trackingEnabled() ? process.env.BRAINTRUST_FEEDBACK_SECRET : undefined,
    async (id, feedback, ownerId) => {
      await conversationStore.saveFeedback(
        ownerId,
        feedback.token,
        feedback,
        () => saveTrackingFeedback(id, feedback, ownerId),
      );
    },
  );
}
