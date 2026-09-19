import type { SimEvent } from '../types';

export function EventPanel({ events }: { events: SimEvent[] }) {
  const recent = [...events].reverse().slice(0, 10);
  const download = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), events }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'coffeesim-events.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  return (
    <section className="event-panel">
      <div className="card-header-row"><h3>Event stream</h3><button className="btn btn-small" onClick={download}>Download JSON</button></div>
      <p className="event-hint">Observable SimPy arrivals, queues, and completions.</p>
      {recent.length === 0 && <div className="journal-empty">Advance a day to populate the event stream.</div>}
      {recent.map((event, index) => (
        <div className="event-card" key={`${event.time}-${event.type}-${index}`}>
          <div className="event-header">
            <div className="event-title-row">
              <span className="event-freq freq-common">T+{event.time.toFixed(2)}</span>
              <h4>{event.type.replaceAll('_', ' ')}</h4>
            </div>
          </div>
          <p className="event-desc">{event.message}</p>
        </div>
      ))}
    </section>
  );
}
