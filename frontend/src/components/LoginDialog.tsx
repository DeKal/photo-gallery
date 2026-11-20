import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useAuth } from "../auth";

// Admin sign-in modal. Dark "obsidian" card on a blurred backdrop: gradient
// badge + title/subtitle, labelled inputs with leading icons, a password
// show/hide toggle, and a gradient primary action. Owns the login call via
// useAuth; surfaces bad credentials inline. Esc or backdrop cancels, Enter
// submits from either field.
export default function LoginDialog({ onClose }: { onClose: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      onClose();
    } catch {
      setError("Wrong username or password.");
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-[#0b0d12]/85 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-surface-container border border-white/10 shadow-2xl shadow-black/70"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient corner glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-gradient-to-br from-indigo-500/25 to-violet-600/10 blur-3xl"
        />

        <div className="relative px-space-lg pt-space-lg pb-space-md flex items-start gap-space-sm">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20 shrink-0">
            <Icon name="lock" className="text-[20px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-headline-sm font-headline-sm font-semibold text-on-surface tracking-tight">Admin sign in</h2>
            <p className="text-body-sm font-body-sm text-outline mt-0.5">
              Sign in to manage photos, people and albums.
            </p>
          </div>
        </div>

        <div className="relative px-space-lg pb-space-lg">
          {/* Username */}
          <label className="block text-label-sm font-label-sm font-semibold uppercase tracking-wider text-on-surface-variant mb-space-xs">
            Username
          </label>
          <div className="relative">
            <Icon name="person" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-outline text-[18px] pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="e.g. admin"
              className="w-full h-12 pl-11 pr-3.5 rounded-xl bg-surface-container-lowest border border-white/10 text-on-surface font-body-md focus:border-primary focus:ring-2 focus:ring-primary/25 outline-none transition-all placeholder:text-outline"
            />
          </div>

          {/* Password */}
          <label className="block text-label-sm font-label-sm font-semibold uppercase tracking-wider text-on-surface-variant mb-space-xs mt-space-md">
            Password
          </label>
          <div className="relative">
            <Icon name="key" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-outline text-[18px] pointer-events-none" />
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Password"
              className="w-full h-12 pl-11 pr-11 rounded-xl bg-surface-container-lowest border border-white/10 text-on-surface font-body-md focus:border-primary focus:ring-2 focus:ring-primary/25 outline-none transition-all placeholder:text-outline"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Hide password" : "Show password"}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-outline hover:text-on-surface hover:bg-white/5 transition-colors"
            >
              <Icon name={showPassword ? "visibility_off" : "visibility"} className="text-[18px]" />
            </button>
          </div>

          {error && (
            <p className="mt-space-sm flex items-center gap-1.5 text-error text-body-sm font-body-sm">
              <Icon name="error" className="text-base" />
              {error}
            </p>
          )}

          <div className="mt-space-lg flex items-center justify-between gap-space-sm">
            <span className="hidden sm:flex items-center gap-1.5 text-outline text-label-sm font-label-sm">
              <Icon name="shield" className="text-[15px] text-primary/80" />
              Admin access only
            </span>
            <div className="flex items-center gap-space-sm ml-auto">
              <button
                onClick={onClose}
                className="h-11 px-space-md rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-white/5 text-label-md font-label-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="h-11 pl-space-lg pr-space-sm rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/40 text-white text-label-md font-label-md shadow-md shadow-indigo-500/25 active:scale-[0.98] transition-all disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none flex items-center gap-2"
              >
                {busy ? "Signing in…" : "Sign in"}
                <span className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center text-[13px]">⏎</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
