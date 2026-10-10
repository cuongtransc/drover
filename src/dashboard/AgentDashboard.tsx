import { useEffect, useMemo, useRef, useState } from "react";
import { AgentIcon } from "../agents/AgentIcon";
import { StatusDot } from "../sidebar/StatusDot";
import { actionFor } from "../shortcuts/dispatch";
import { useShortcutLabel, useShortcuts } from "../shortcuts/store";
import { useApp } from "../store/app";
import { CloseIcon, FilterIcon, FolderIcon, LaptopIcon, SearchIcon, ServerIcon } from "../ui/icons";
import { QuotaColumn } from "./QuotaColumn";
import { BUCKETS, countsForUser, dashboardCards, matchesQuery } from "./buckets";
import type { DashCard } from "./buckets";

function useCards(): DashCard[] {
  const machines = useApp((s) => s.machines);
  const order = useApp((s) => s.order);
  const doneSeen = useApp((s) => s.doneSeen);
  const since = useApp((s) => s.statusSince);
  return useMemo(() => dashboardCards(machines, order, doneSeen, since), [machines, order, doneSeen, since]);
}


function Card({ card, onOpen }: { card: DashCard; onOpen: (c: DashCard) => void }) {
  const ssh = card.machine.kind === "ssh";
  return (
    <li>
      <button className={"dash-card dash-card-" + card.bucket} onClick={() => onOpen(card)} title={card.pane.cwd ?? undefined}>
        <span className="dash-card-head">
          <AgentIcon agent={card.pane.agent} />
          <span className="dash-card-title">{card.pane.title}</span>
          <StatusDot status={card.pane.status} />
        </span>
        <span className="dash-card-meta">
          <span className="dash-card-tag">
            {ssh ? <ServerIcon /> : <LaptopIcon />}
            <span className="label">{card.machine.label}</span>
          </span>
          <span className="dash-card-tag">
            <FolderIcon />
            <span className="label">{card.workspace.label}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

interface Filters {
  machine: string[];
  agent: string[];
}

function FilterMenu({ cards, filters, onChange }: { cards: DashCard[]; filters: Filters; onChange: (f: Filters) => void }) {
  const machines = new Map<string, { label: string; n: number }>();
  const agents = new Map<string, { label: string; n: number }>();
  for (const c of cards) {
    const m = machines.get(c.machine.id) ?? { label: c.machine.label, n: 0 };
    machines.set(c.machine.id, { ...m, n: m.n + 1 });
    const id = c.pane.agent ?? "";
    const a = agents.get(id) ?? { label: id, n: 0 };
    agents.set(id, { ...a, n: a.n + 1 });
  }
  const section = (key: keyof Filters, title: string, opts: Map<string, { label: string; n: number }>) => (
    <fieldset className="dash-filter-section">
      <legend>{title}</legend>
      {[...opts].map(([id, o]) => {
        const on = filters[key].includes(id);
        return (
          <label key={id} className="dash-filter-opt">
            <input
              type="checkbox"
              checked={on}
              onChange={() => onChange({ ...filters, [key]: on ? filters[key].filter((x) => x !== id) : [...filters[key], id] })}
            />
            <span className="label">{o.label}</span>
            <span className="dash-filter-n">{o.n}</span>
          </label>
        );
      })}
    </fieldset>
  );
  return (
    <div className="dash-filter-menu" role="group" aria-label="Filters">
      {section("machine", "Machine", machines)}
      {section("agent", "Agent", agents)}
    </div>
  );
}

/** Kanban of every agent by what it needs from the user. An overlay over the Agents column and
 *  the main area: the panes underneath stay mounted. */
export function AgentDashboard() {
  const setOpen = useApp((s) => s.setDashboardOpen);
  const select = useApp((s) => s.select);
  const cards = useCards();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>({ machine: [], agent: [] });
  const [filterOpen, setFilterOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const jumpKey = useShortcutLabel("jump");
  const filterOpenRef = useRef(filterOpen);
  filterOpenRef.current = filterOpen;

  useEffect(() => search.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (actionFor(e, useShortcuts.getState().bindings) === "jump") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      } else if (e.key === "Escape") {
        // The innermost layer first: the Filter menu, then any dialog opened over the dashboard.
        if (filterOpenRef.current) setFilterOpen(false);
        else if (!document.querySelector(".overlay")) setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const shown = cards.filter(
    (c) =>
      matchesQuery(c, query) &&
      (filters.machine.length === 0 || filters.machine.includes(c.machine.id)) &&
      (filters.agent.length === 0 || filters.agent.includes(c.pane.agent ?? "")),
  );
  const filtering = query.trim() !== "" || filters.machine.length > 0 || filters.agent.length > 0;
  const nFilters = filters.machine.length + filters.agent.length;

  // Selecting closes the dashboard.
  const openCard = (c: DashCard) => select(c.ref);

  return (
    <section className="dashboard" role="dialog" aria-label="Agent Board">
      <header className="dash-head" data-tauri-drag-region>
        <span className="dash-title">Agents</span>
        <span className="dash-total">{filtering ? `${shown.length} of ${cards.length} shown` : `${cards.length} total`}</span>
        <button className="icon-btn dash-close" aria-label="Close Agent Board" onClick={() => setOpen(false)}>
          <CloseIcon />
        </button>
      </header>
      <div className="dash-toolbar">
        <label className="dash-search">
          <SearchIcon />
          <input
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            ref={search}
            placeholder="Search agent, workspace, session, or machine…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button className="dash-search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
              <CloseIcon />
            </button>
          ) : (
            jumpKey && (
              <span className="dash-search-keys" aria-hidden="true">
                <kbd>{jumpKey}</kbd>
              </span>
            )
          )}
        </label>
        <div className="dash-filter">
          <button className="btn dash-filter-btn" aria-expanded={filterOpen} onClick={() => setFilterOpen((o) => !o)}>
            <FilterIcon />
            Filter
            {nFilters > 0 && <span className="count">{nFilters}</span>}
          </button>
          {filterOpen && (
            <>
              <div className="dash-filter-scrim" onMouseDown={() => setFilterOpen(false)} />
              <FilterMenu cards={cards} filters={filters} onChange={setFilters} />
            </>
          )}
        </div>
      </div>
      <div className="dash-board">
        {BUCKETS.map((b) => {
          const col = shown.filter((c) => c.bucket === b.id);
          return (
            <section key={b.id} className={"dash-col dash-col-" + b.id} role="region" aria-label={b.label}>
              <div className="dash-col-head">
                <span className="dash-col-title">{b.label}</span>
                <span className="count">{col.filter(countsForUser).length}</span>
              </div>
              {col.length === 0 ? (
                <p className="dash-col-empty">None</p>
              ) : (
                <ul className="dash-cards">
                  {col.map((c) => (
                    <Card key={c.key} card={c} onOpen={openCard} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        <QuotaColumn />
      </div>
    </section>
  );
}
