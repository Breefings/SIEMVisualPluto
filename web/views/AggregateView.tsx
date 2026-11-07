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
          <h1>Connect <span className="badge big">soon</span></h1>
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
            <button className="btn ghost" disabled>Connect</button>
          </div>
        ))}
      </div>
    </div>
  );
}
