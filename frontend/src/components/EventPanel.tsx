import type { GameSnapshot, SimEvent } from '../types';

export function EventPanel({ events, snapshot, gameId }: { events: SimEvent[]; snapshot?: GameSnapshot; gameId?: string | null }) {
  const recent = [...events].reverse().slice(0, 10);
  const download = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), events }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'coffeesim-events.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const downloadRun = async () => {
    if (!snapshot || !gameId) return;
    const response = await fetch(`/api/games/${gameId}/trace`);
    const trace = await response.json();
    const blob = new Blob([JSON.stringify({ ...trace, format: 'coffeesim.client-run.v1', exported_at: new Date().toISOString(), mode: snapshot.simulation_mode, strategy: snapshot.simulation_strategy }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `coffeesim-run-${snapshot.seed}-day-${snapshot.day}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  return (
    <section className="event-panel">
      <div className="card-header-row"><h3>Event stream</h3><div><button className="btn btn-small" onClick={download}>Events JSON</button>{snapshot && gameId && <button className="btn btn-small" onClick={() => void downloadRun()}>Full run JSON</button>}</div></div>
      <p className="event-hint">Observable SimPy arrivals, queues, and completions.</p>
      {recent.length === 0 && <div className="journal-empty">Advance a day to populate the event stream.</div>}
      {recent.map((event, index) => (
        <div className="event-card" key={`${event.time}-${event.type}-${index}`}>
          <div className="event-header">
            <div className="event-title-row">
              <span className="event-freq freq-common">T+{event.time.toFixed(2)}</span>
              <h4><span className={`event-category ${event.category ?? 'supply'}`}>{event.category ?? 'supply'}</span>{event.type.replaceAll('_', ' ')}</h4>
            </div>
          </div>
          <p className="event-desc">{event.message}</p>
        </div>
      ))}
    </section>
  );
}
