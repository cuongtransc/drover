/** Asks the open Agent Board to focus its search: the Jump key's action while the Board is open. */
export const DASHBOARD_SEARCH = "drover:dashboard-search";

export function focusDashboardSearch(): void {
  window.dispatchEvent(new Event(DASHBOARD_SEARCH));
}
