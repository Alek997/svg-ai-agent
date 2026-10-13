import type { CollectionIcon } from "@/lib/collections/contracts";
import { SvgImage } from "./svg-image";
import { collectionButton as button } from "./collection-forms";
export function CollectionIconCard({
  icon,
  disabled,
  onRetry,
  onDelete,
}: {
  icon: CollectionIcon;
  disabled: boolean;
  onRetry: (reindex: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <article className="space-y-2 rounded-lg border border-stone-200 p-3">
      <SvgImage source={icon.source} label={icon.filename} />
      <p className="break-all text-sm font-medium">{icon.filename}</p>
      <p className="text-xs">
        {icon.status}
        {icon.claimExpiresAt ? " · processing / awaiting claim expiry" : ""} ·
        description {icon.descriptionAttempts}/3 · embedding{" "}
        {icon.embeddingAttempts}/3
      </p>
      <p className="text-xs text-stone-600">{icon.description}</p>
      <p className="text-xs text-stone-500">{icon.tags.join(", ")}</p>
      {icon.error && <p className="text-xs text-red-700">{icon.error}</p>}
      <div className="flex flex-wrap gap-2">
        {icon.status.endsWith("_error") && (
          <button
            className={button}
            disabled={disabled}
            onClick={() => onRetry(false)}
          >
            Retry failed stage
          </button>
        )}
        {icon.status === "ready" && (
          <button
            className={button}
            disabled={disabled}
            onClick={() => onRetry(true)}
          >
            Reindex embedding
          </button>
        )}
        <button className={button} disabled={disabled} onClick={onDelete}>
          Delete
        </button>
      </div>
      <details className="text-xs">
        <summary>Recorded usage</summary>
        <pre className="overflow-auto">
          {JSON.stringify(icon.usage, null, 2)}
        </pre>
      </details>
    </article>
  );
}
