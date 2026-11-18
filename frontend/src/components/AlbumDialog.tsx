import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

// Small modal for naming an album (create or rename). Replaces window.prompt:
// autofocused input, Enter to submit, Esc or backdrop to cancel, submit disabled
// while empty or unchanged. Kept presentational — the caller owns the API call.
export default function AlbumDialog({
  title,
  initial = "",
  confirmLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial?: string;
  confirmLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const clean = name.trim();
  const canSubmit = clean.length > 0 && clean !== initial.trim();

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-[#0b0d12]/80 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface-container border border-outline-variant shadow-2xl shadow-black/60 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-space-lg pt-space-lg pb-space-md flex items-center gap-space-sm">
          <span className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center text-primary shrink-0">
            <Icon name="collections_bookmark" className="text-[18px]" />
          </span>
          <h2 className="text-headline-sm font-headline-sm font-semibold text-on-surface tracking-tight">{title}</h2>
        </div>
        <div className="px-space-lg pb-space-lg">
          <input
            ref={inputRef}
            type="text"
            data-testid="album-dialog-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) onSubmit(clean);
            }}
            placeholder="Album name"
            className="w-full h-11 px-3.5 rounded-xl bg-surface-container-low border border-outline-variant text-on-surface font-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all placeholder:text-outline"
          />
          <div className="mt-space-lg flex items-center justify-end gap-space-sm">
            <button
              onClick={onCancel}
              className="h-11 px-space-md rounded-xl bg-surface-container-high border border-outline-variant text-on-surface-variant hover:text-on-surface text-label-md font-label-md transition-colors"
            >
              Cancel
            </button>
            <button
              data-testid="album-dialog-submit"
              onClick={() => canSubmit && onSubmit(clean)}
              disabled={!canSubmit}
              className="h-11 px-space-lg rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white text-label-md font-label-md shadow-md shadow-indigo-500/25 active:scale-[0.98] transition-all disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
