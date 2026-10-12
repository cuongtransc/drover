import { useEffect } from "react";
import { triageQueue } from "../dashboard/triage";
import { setDockBadge } from "../lib/ipc";
import { useApp } from "../store/app";

/** The Dock icon's red badge: how many agents need the user (the ⌘J queue: waiting, then Done
 *  and unseen), seen while Drover is in the background; none at zero. */
export function useDockBadge(): void {
  const n = useApp((s) => triageQueue(s.machines, s.order, s.doneSeen, s.statusSince).length);
  useEffect(() => {
    void setDockBadge(n).catch(() => {});
  }, [n]);
}
