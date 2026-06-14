import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { ActiveEvent } from '../types';

export function EventPanel({ events }: { events: ActiveEvent[] }) {
  const resolveEvent = useGameStore((s) => s.resolveEvent);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (events.length === 0) return null;

  return (
    <div className="event-panel">
      <h3>⚡ Active Events</h3>
      <p className="event-hint">Resolve events first, then advance the day.</p>
      {events.map((event) => (
        <div key={event.id} className="event-card">
          <div className="event-header" onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}>
            <div className="event-title-row">
              <span className={`event-freq freq-${event.frequency}`}>{event.frequency}</span>
              <h4>{event.title}</h4>
            </div>
            <span className="event-chevron">{expandedId === event.id ? '▾' : '▸'}</span>
          </div>
          {expandedId === event.id && (
            <div className="event-body">
              <p className="event-desc">{event.description}</p>
              <div className="event-choices">
                {event.choices.map((choice, i) => (
                  <button
                    key={i}
                    className="event-choice-btn"
                    onClick={() => resolveEvent(event.id, i)}
                  >
                    <span className="choice-label">{choice.label}</span>
                    <span className="choice-desc">{choice.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
