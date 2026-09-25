import { createSignal, type Accessor } from "solid-js";
import type { CockpitLike, CockpitSnapshot } from "../core/cockpit";
import type { Notice } from "../core/types";

export function createCockpitStore(cockpit: CockpitLike): { snap: Accessor<CockpitSnapshot>; toasts: Accessor<Notice[]>; dispose: () => void } {
  const [snap, setSnap] = createSignal<CockpitSnapshot>(cockpit.snapshot());
  const [toasts, setToasts] = createSignal<Notice[]>([]);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const offState = cockpit.events.on("state", (s) => setSnap(s));
  const offNotice = cockpit.events.on("notice", (n) => {
    setToasts((t) => [...t, n].slice(-3));
    const timer = setTimeout(() => {
      timers.delete(timer);
      setToasts((t) => t.filter((x) => x !== n));
    }, 6000);
    timers.add(timer);
  });
  return {
    snap,
    toasts,
    dispose: () => {
      offState();
      offNotice();
      timers.forEach(clearTimeout);
    },
  };
}
