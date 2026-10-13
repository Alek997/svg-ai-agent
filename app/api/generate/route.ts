import {
  retrieveOwnedCollectionReferencesOnServer,
  buildCollectionRetrievalQuery,
} from "@/lib/collections/retrieval";
import { streamSvgGenerationOnServer } from "@/lib/ai/generate-svg";
import { handleSavedSvgGenerationOnServer } from "@/lib/conversations/generate";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { flushTracking, startGenerationTracking } from "@/lib/ai/tracking";

export const runtime = "nodejs";
// Statically analyzable by Next.js; within Vercel Hobby's 300-second ceiling.
export const maxDuration = 300;

export async function POST(request: Request) {
  const { userId: authenticatedUserId } = await auth();
  if (!authenticatedUserId) {
    return Response.json(
      { error: "Please sign in before generating an SVG." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  after(flushTracking);
  return handleSavedSvgGenerationOnServer({
    request,
    authenticatedUserId,
    generateSvgWithoutCollectionReferences: (
      svgGenerationRequest,
      signal,
      onProgress,
      onEvent,
    ) => {
      return streamSvgGenerationOnServer({
        svgGenerationRequest,
        signal,
        onProgress,
        onEvent,
      });
    },
    generationDependencies: {
      startGenerationTracking: (svgGenerationRequest) => {
        return startGenerationTracking(
          svgGenerationRequest,
          authenticatedUserId,
        );
      },
      retrieveCollectionReferencesForRun: ({
        startedConversationRun,
        svgGenerationRequest,
        signal,
      }) => {
        return retrieveOwnedCollectionReferencesOnServer({
          authenticatedUserId,
          collectionId: startedConversationRun.collectionId!,
          query: buildCollectionRetrievalQuery({
            initialArtworkRequest: startedConversationRun.initialRequest!,
            latestUserMessage: svgGenerationRequest.messages.at(-1)!.content,
          }),
          signal,
          assistantMessageId: startedConversationRun.assistantMessageId,
        });
      },
      generateSvgWithCollectionReferences: streamSvgGenerationOnServer,
    },
  });
}
