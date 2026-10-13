import { useApp } from "../store/app";
import { SearchIcon } from "../ui/icons";
import { useSessionQuery } from "./activeFilter";

/** Words to narrow the Sessions tree by, and one chip per machine once there are two: under the
 *  Sessions header. Esc clears the words, then leaves the field. */
export function SessionFilter() {
  const query = useSessionQuery((s) => s.query);
  const setQuery = useSessionQuery((s) => s.setQuery);
  const chip = useSessionQuery((s) => s.machine);
  const setMachine = useSessionQuery((s) => s.setMachine);
  const machines = useApp((s) => s.machines);
  const order = useApp((s) => s.order);
  const listed = order.filter((id) => machines[id]);
  return (
    <div className="session-filter">
      <div className="session-filter-field">
        <SearchIcon className="icon" />
        <input
          type="search"
          aria-label="Filter sessions"
          placeholder="Filter sessions"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            if (query) setQuery("");
            else e.currentTarget.blur();
          }}
        />
        {query && (
          <button type="button" className="session-filter-clear" aria-label="Clear filter" onClick={() => setQuery("")}>
            Esc
          </button>
        )}
      </div>
      {listed.length > 1 && (
        <div className="machine-chips" role="group" aria-label="Show one machine">
          {listed.map((id) => (
            <button key={id} type="button" className="active-toggle" aria-pressed={chip === id} onClick={() => setMachine(chip === id ? null : id)}>
              {machines[id].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
