import type { ReactNode } from "react";
import Icon from "./Icon";

export type NavKey = "all" | "people" | "similar" | "hidden";

export interface Counts {
  all: number | null;
  people: number | null;
  similar: number | null;
  hidden: number | null;
}

interface Props {
  nav: NavKey;
  onNav: (key: NavKey) => void;
  onImportFolder?: () => void;
  counts?: Counts;
  children: ReactNode;
}

const NAV: { key: NavKey; label: string; icon: string }[] = [
  { key: "all", label: "All Photos", icon: "photo_library" },
  { key: "people", label: "Faces & People", icon: "group" },
  { key: "similar", label: "Similar Sets", icon: "burst_mode" },
];

// Verbatim port of the Stitch "PhotoCluster — People View" code.html shared
// TopNavBar + SideNavBar. Section nav / filter / tune / Batch Tag / avatar /
// footer links are decorative (as in the mock); refresh + Scan/Import are wired.
export default function AppShell({ nav, onNav, onImportFolder, children }: Props) {
  const peopleActive = nav === "people" || nav === "hidden";

  return (
    <div className="min-h-screen flex flex-col font-body-md overflow-x-hidden">
      {/* TOP APP BAR */}
      <header className="bg-surface-container-low border-b border-outline-variant shadow-sm sticky top-0 z-40">
        <div className="flex justify-between items-center w-full px-margin-md h-16 max-w-full">
          {/* Logo & wordmark */}
          <div className="flex items-center gap-space-md">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/20">
              <Icon name="photo_library" className="text-white text-2xl" />
            </div>
            <div>
              <div className="flex items-center gap-space-xs">
                <span className="text-headline-sm font-headline-sm font-semibold tracking-tight text-on-surface">
                  PhotoCluster
                </span>
              </div>
              <p className="text-body-sm font-body-sm text-outline tracking-tight">
                group photos by person &amp; similarity
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* SIDE NAV + CONTENT */}
      <div className="flex-1 flex overflow-hidden">
        <aside className="hidden md:flex flex-col h-[calc(100vh-4rem)] p-space-md w-64 shrink-0 bg-surface-container-lowest border-r border-outline-variant">
          {/* Rail header */}
          <div className="flex flex-col gap-space-lg">
            <div className="flex items-center gap-space-sm px-space-sm pt-space-xs">
              <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-primary ring-1 ring-outline-variant">
                <Icon name="dns" className="text-lg" />
              </div>
              <div>
                <p className="text-label-md font-label-md font-semibold text-on-surface">Local Archive</p>
                <p className="text-body-sm font-body-sm text-outline">Direct drive indexing</p>
              </div>
            </div>
            <button
              onClick={onImportFolder}
              className="flex items-center justify-center gap-space-sm w-full py-2 px-space-md rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant text-on-surface text-label-md font-label-md active:scale-[0.98] transition-colors duration-150"
            >
              <Icon name="add_circle" className="text-lg text-primary" />
              Import Folder
            </button>

            {/* Main nav */}
            <div className="flex flex-col gap-1">
              {NAV.map((item) => {
                const active = item.key === nav || (item.key === "people" && peopleActive);
                return (
                  <button
                    key={item.key}
                    onClick={() => onNav(item.key)}
                    className={`flex items-center gap-space-sm rounded-xl px-space-md py-space-sm active:scale-[0.98] transition-colors duration-150 ${
                      active
                        ? "bg-surface-container-high text-primary font-medium"
                        : "text-on-surface-variant font-normal hover:bg-surface-container hover:text-on-surface"
                    }`}
                  >
                    <Icon name={item.icon} className="text-lg" />
                    <span className="text-label-md font-label-md">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col overflow-y-auto custom-scroll relative">{children}</main>
      </div>
    </div>
  );
}
