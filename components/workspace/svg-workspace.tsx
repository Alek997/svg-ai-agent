"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { WorkspaceCollections } from "../collections/workspace-collections";
import { ChatPanel } from "./chat-panel";
import {
  WorkspaceDraft,
  WorkspaceNavigation,
  type NavigationHandle,
} from "./workspace-draft";
import { SvgCanvas } from "./svg-canvas";
import { EmptySavedCanvas, WorkspaceSkeleton } from "./workspace-loading";
import { sampleDocument } from "@/lib/workspace/sample";
import { useWorkspaceSession } from "./use-workspace-session";

type WorkspaceProps = {
  ragEnabled?: boolean;
  trackingEnabled?: boolean;
  initialConversationId?: string;
};

export function SvgWorkspace(props: WorkspaceProps) {
  const pathname = usePathname();
  const routeId = pathname.startsWith("/conversations/")
    ? pathname.split("/")[2]
    : null;
  const [session, setSession] = useState({ routeId, key: 0 });

  if (session.routeId !== routeId) {
    setSession({ routeId, key: session.key + 1 });
  }

  return (
    <WorkspaceSession
      {...props}
      key={session.key}
      routeId={routeId}
      onCreated={(id) => {
        // Saving the first message changes the URL, but continues this session.
        setSession((previous) => ({ ...previous, routeId: id }));
      }}
      onNewSession={() =>
        setSession((previous) => ({ ...previous, key: previous.key + 1 }))
      }
    />
  );
}

function WorkspaceSession({
  trackingEnabled: isTrackingEnabled = false,
  ragEnabled: isCollectionFeatureEnabled = false,
  routeId,
  onCreated,
  onNewSession,
}: WorkspaceProps & {
  routeId: string | null;
  onCreated: (id: string) => void;
  onNewSession: () => void;
}) {
  const navigation = useRef<NavigationHandle>(null);
  const {
    draft,
    collectionId,
    setCollectionId,
    isConversationPrivate,
    messages,
    document,
    publicId,
    isSubmissionInProgress,
    isOpeningConversation,
    displayedId,
    isConversationStateConfirmed,
    activeSavedRun,
    isSvgGenerationInProgress,
    preview,
    activity,
    progress,
    error,
    olderCursor,
    isLoadingOlderMessages,
    historyRefresh,
    retryInput,
    retryAvailableAt,
    refreshSavedConversation,
    olderMessages,
    sendMessage,
    retry,
    setSavedConversation,
    setPublicId,
    abort,
  } = useWorkspaceSession({ routeId, onCreated });
  const pathname = routeId ? `/conversations/${routeId}` : "/";
  const isWorkspaceSkeletonVisible =
    isOpeningConversation || !!(routeId && routeId !== displayedId && !error);

  function navigate(path: string) {
    navigation.current?.navigate(path);
  }

  return (
    <WorkspaceDraft ref={draft}>
      <WorkspaceNavigation
        ref={navigation}
        isLoading={isSubmissionInProgress}
        pathname={pathname}
        onNewSession={onNewSession}
        onRefresh={() => void refreshSavedConversation()}
        onAbort={abort}
      />
      {isWorkspaceSkeletonVisible ? (
        <WorkspaceSkeleton />
      ) : (
        <>
          {isCollectionFeatureEnabled && (
            <WorkspaceCollections
              conversationId={displayedId}
              hasArtwork={!!document}
              privateConversation={isConversationPrivate}
              selected={collectionId}
              onSelect={setCollectionId}
              disabled={isSubmissionInProgress || !!activeSavedRun}
              onAdded={() => {
                setSavedConversation((previous) =>
                  previous ? { ...previous, private: true } : previous,
                );
                setPublicId(null);
                void refreshSavedConversation();
              }}
            />
          )}
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_400px]">
            {routeId && !document && !preview ? (
              <EmptySavedCanvas
                isLoading={isSubmissionInProgress}
                activity={activity}
              />
            ) : (
              <SvgCanvas
                document={preview ?? document ?? sampleDocument}
                publicId={
                  !isSubmissionInProgress && !activeSavedRun && !preview
                    ? publicId
                    : null
                }
                hasPreview={!!preview}
                activity={activity}
                isSample={!document}
                isLoading={isSvgGenerationInProgress}
              />
            )}
            <ChatPanel
              messages={messages}
              onSend={(content) => void sendMessage(content)}
              onReset={() => navigate("/")}
              isLoading={
                isSubmissionInProgress ||
                isOpeningConversation ||
                !!activeSavedRun ||
                !isConversationStateConfirmed
              }
              progress={progress}
              activity={
                isOpeningConversation
                  ? "Opening saved conversation…"
                  : activeSavedRun && !isSubmissionInProgress
                    ? "An earlier generation is still active. Refresh its status or wait for recovery."
                    : activity
              }
              trackingEnabled={isTrackingEnabled && !isConversationPrivate}
              error={error}
              retryAvailableAt={retryAvailableAt}
              onRetry={error && retryInput ? retry : undefined}
              currentId={routeId}
              historyRefresh={historyRefresh}
              onOpenConversation={(id) => navigate(`/conversations/${id}`)}
              olderCursor={olderCursor}
              loadingOlder={isLoadingOlderMessages}
              onLoadOlder={() => void olderMessages()}
              onRefreshConversation={
                routeId && !isSubmissionInProgress
                  ? () => void refreshSavedConversation()
                  : undefined
              }
            />
          </div>
        </>
      )}
    </WorkspaceDraft>
  );
}
