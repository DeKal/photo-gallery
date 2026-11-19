import Icon from "./Icon";

// Shared loading indicator — a centered spinner pill. Reused across every list
// view so initial loads look consistent (and match the "Load more" pill).
export default function LoadingPill({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex justify-center py-space-lg">
      <span className="px-space-lg py-2 rounded-xl bg-surface-container border border-outline-variant text-on-surface text-label-md font-label-md flex items-center gap-2">
        <Icon name="progress_activity" className="text-base animate-spin" />
        {label}
      </span>
    </div>
  );
}
