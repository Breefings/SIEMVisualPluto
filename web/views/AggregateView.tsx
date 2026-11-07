import { useEffect, useState } from 'react';
import { Icon } from '../../shared/Icon.tsx';
import { api, type Integration } from '../api.ts';

export function AggregateView() {
  const [items, setItems] = useState<Integration[]>([]);
  useEffect(() => {
    api.integrations().then(setItems).catch(() => {});
  }, []);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Aggregate logs <span className="badge big">coming soon</span></h1>
          <p className="lead">Pull logs live from your infrastructure instead of uploading files. The connectors below plug into the same parsing and analysis pipeline.</p>
        </div>
      </div>
      <div className="integrations">
        {items.map((i) => (
          <div key={i.id} className="integration">
            <div className="int-head">
              <div className="int-icon"><Icon name="plug" size={18} /></div>
              <b>{i.name}</b>
              <span className="badge">{i.status}</span>
            </div>
            <p className="muted small">{i.desc}</p>
            <button className="btn ghost" disabled>Connect</button>
          </div>
        ))}
      </div>
      <div className="card note">
        <Icon name="terminal" size={16} />
        <div>
          <b>Integration contract.</b> A connector only needs to produce text or JSON lines. The server parses them with <code>parseFile()</code> into normalized records, then runs the same detection, Claude analysis, timeline and video pipeline used for uploads (see <code>server/parsers.ts</code>).
        </div>
      </div>
    </div>
  );
}
