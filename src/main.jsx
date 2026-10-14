import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Ellipsis,
  Globe2,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Ticket,
  Upload,
  Users,
  X,
  Link2,
  LoaderCircle,
  AlertCircle,
  SlidersHorizontal,
  Command,
  LockKeyhole,
} from 'lucide-react';
import './styles.css';
import BrowserPanel from './BrowserPanel.jsx';
import CollectorPanel from './CollectorPanel.jsx';
import CampaignPanel from './CampaignPanel.jsx';

const money = (c, compact = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: compact ? 0 : 2,
  }).format(c / 100);
const number = (n) => new Intl.NumberFormat('en-US').format(n || 0);
const date = (d, opts = { month: 'short', day: 'numeric' }) =>
  new Date(d).toLocaleDateString('en-US', opts);
const initials = (n) =>
  n
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('');
let currentWorkspace = 'demo';
async function api(url, options = {}) {
  const res = await fetch(`/api${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Crowd-Control': '1',
      'X-Workspace': currentWorkspace,
      ...options.headers,
    },
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function useData(url, version = 0) {
  const [state, set] = useState({ data: null, loading: true, error: '' });
  useEffect(() => {
    let active = true;
    set((s) => ({ ...s, loading: true, error: '' }));
    api(url)
      .then((data) => active && set({ data, loading: false, error: '' }))
      .catch((e) => active && set({ data: null, loading: false, error: e.message }));
    return () => {
      active = false;
    };
  }, [url, version]);
  return state;
}
function Button({ children, icon: Icon, className = '', ...props }) {
  return (
    <button className={`button ${className}`} {...props}>
      {Icon && <Icon size={15} />} {children}
    </button>
  );
}
function Empty({ title = 'Nothing here yet', children, icon: Icon = Database }) {
  return (
    <div className="empty">
      <Icon size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} /> Loading your workspace
    </div>
  );
}
function ErrorBox({ message }) {
  return (
    message && (
      <div role="alert" className="error">
        <AlertCircle size={17} />
        {message}
      </div>
    )
  );
}
function Badge({ children, tone = '' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Avatar({ name, size = '' }) {
  return <span className={`avatar ${size}`}>{initials(name)}</span>;
}
function Field({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}
function Modal({ title, subtitle, onClose, children, wide = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const fn = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const els = [
          ...dialog.current.querySelectorAll('button:not(:disabled),input,select,textarea,a[href]'),
        ];
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', fn);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('keydown', fn);
      document.body.style.overflow = prev;
      previousFocus?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-shade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={dialog}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">CROWD CONTROL</span>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function App() {
  const [page, setPage] = useState('Overview'),
    [workspace, setWorkspace] = useState('demo'),
    [version, setVersion] = useState(0),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(''),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState('');
  currentWorkspace = workspace;
  const refresh = () => setVersion((v) => v + 1);
  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4500);
  };
  const navigate = (p) => {
    setPage(p);
    setMobile(false);
  };
  const write = (type) => (workspace === 'demo' ? setModal({ type: 'auth' }) : setModal({ type }));
  const close = useCallback(() => setModal(null), []);
  const switchWorkspace = async () => {
    if (workspace === 'live') {
      setWorkspace('demo');
      setVersion((v) => v + 1);
      return;
    }
    try {
      const status = await api('/auth/status');
      if (status.user) {
        setWorkspace('live');
        refresh();
      } else setModal({ type: 'auth' });
    } catch (e) {
      notify(e.message);
    }
  };
  return (
    <div className="app">
      {mobile && <div className="sidebar-shade" onClick={() => setMobile(false)} />}
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('Overview');
          }}
        >
          <span className="brand-icon">
            <AudioLines size={26} />
          </span>
          <span>
            CROWD<span className="brand-second">CONTROL</span>
          </span>
        </a>
        <button className="workspace-switch" onClick={switchWorkspace}>
          <span className="workspace-monogram">CC</span>
          <span>
            <strong>Crowd Control</strong>
            <small>{workspace === 'demo' ? 'Demo workspace' : 'Your workspace'}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {[
            [LayoutDashboard, 'Overview'],
            [Users, 'Audience'],
            [CalendarDays, 'Events'],
            [Database, 'Data sources'],
            [Globe2, 'Browser worker'],
            [Database, 'POSH collector'],
            [Mail, 'Campaign drafts'],
          ].map(([Icon, label]) => (
            <button
              key={label}
              className={page === label ? 'active' : ''}
              onClick={() => navigate(label)}
            >
              <Icon size={18} />
              {label}
              {label === 'Data sources' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-label">
            <ShieldCheck size={14} /> Your audience. Your asset.
          </div>
          <button className="profile" onClick={switchWorkspace}>
            <Avatar name="Crowd Control" />
            <span>
              <strong>Crowd Control</strong>
              <small>{workspace === 'demo' ? 'Explore the platform' : 'Workspace owner'}</small>
            </span>
            <Settings2 size={16} />
          </button>
          {workspace === 'live' && (
            <button
              className="logout"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST' });
                setWorkspace('demo');
                refresh();
              }}
            >
              <LogOut size={13} /> Sign out
            </button>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <span className="live-indicator">
              <i />
              {workspace === 'demo' ? 'Demo data' : 'Live workspace'}
            </span>
            <span className="top-divider" />
            <Avatar name="Crowd Control" size="small" />
          </div>
        </header>
        <main>
          {workspace === 'demo' && (
            <div className="demo-strip">
              <span>
                <Sparkles size={13} /> A preview of what your audience can become. All data here is
                illustrative.
              </span>
              <button onClick={() => setModal({ type: 'auth' })}>
                Set up your workspace <ArrowRight size={13} />
              </button>
            </div>
          )}
          {page === 'Overview' && (
            <Overview version={version} navigate={navigate} open={setModal} write={write} />
          )}
          {page === 'Audience' && (
            <Audience
              version={version}
              search={search}
              setSearch={setSearch}
              open={setModal}
              write={write}
            />
          )}
          {page === 'Events' && <Events version={version} open={setModal} write={write} />}
          {page === 'Data sources' && (
            <Sources version={version} open={setModal} write={write} workspace={workspace} />
          )}
          {page === 'POSH collector' && (
            <CollectorPanel
              key={workspace}
              api={api}
              workspace={workspace}
              onConnect={() => setModal({ type: 'auth' })}
            />
          )}
          {page === 'Campaign drafts' && (
            <CampaignPanel key={workspace} api={api} workspace={workspace} />
          )}
          {page === 'Browser worker' && (
            <BrowserPanel
              key={workspace}
              api={api}
              workspace={workspace}
              onConnect={() => setModal({ type: 'auth' })}
            />
          )}
        </main>
        <footer>
          <span>
            CROWD CONTROL <span className="footer-dot">•</span> AUDIENCE INTELLIGENCE
          </span>
          <span>Built for the next night.</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {modal?.type === 'auth' && (
        <Auth
          onClose={close}
          onSuccess={() => {
            setWorkspace('live');
            refresh();
            close();
            notify('Your workspace is ready.');
          }}
        />
      )}
      {modal?.type === 'event' && (
        <EventForm
          onClose={close}
          onSuccess={() => {
            refresh();
            close();
            notify('Event created. Ready for your audience.');
          }}
        />
      )}
      {modal?.type === 'contact' && (
        <ContactForm
          onClose={close}
          onSuccess={() => {
            refresh();
            close();
            notify('Contact added.');
          }}
        />
      )}
      {modal?.type === 'person' && (
        <Person id={modal.id} onClose={close} workspace={workspace} refresh={refresh} />
      )}
      {modal?.type === 'recommend' && <Recommendation id={modal.id} onClose={close} />}
      {modal?.type === 'import' && (
        <Import
          onClose={close}
          onSuccess={() => {
            refresh();
            close();
            notify('Import complete. Your audience has been updated.');
          }}
        />
      )}
    </div>
  );
}
function PageTitle({ eyebrow, title, description, children }) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="title-actions">{children}</div>
    </div>
  );
}
function Overview({ version, navigate, open, write }) {
  const [city, setCity] = useState('');
  const {
    data: d,
    loading,
    error,
  } = useData(`/dashboard${city ? `?city=${encodeURIComponent(city)}` : ''}`, version);
  return (
    <>
      <PageTitle
        eyebrow="THE BIG PICTURE"
        title="Your crowd, understood."
        description="Every connection. Every night. A stronger community."
      >
        <Button icon={Upload} onClick={() => write('import')}>
          Import audience
        </Button>
        <Button className="primary" icon={Plus} onClick={() => write('event')}>
          Create event
        </Button>
      </PageTitle>
      <div className="filter-bar">
        <div className="section-tabs">
          <span className="selected">Audience overview</span>
          <span className="scope-label">{city || 'All markets'}</span>
        </div>
        <div className="filters">
          <div className="select-wrap">
            <MapPin size={13} />
            <select
              aria-label="Filter market"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">All markets</option>
              {(d?.cities || []).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <span className="period">
            <CalendarDays size={13} /> Revenue · last 90 days
          </span>
        </div>
      </div>
      <ErrorBox message={error} />
      {loading && !d ? (
        <Loading />
      ) : (
        d && (
          <>
            <div className="stats-grid">
              {[
                [Users, 'Owned audience', number(d.people), 'Unique customer profiles'],
                [
                  ArrowUpRight,
                  'Net ticket sales',
                  money(d.revenue_cents, true),
                  'After refunds · last 90 days',
                ],
                [
                  Activity,
                  'Repeat buyer rate',
                  `${d.repeat_rate.toFixed(1)}%`,
                  `${number(d.repeat_buyers)} of ${number(d.buyers)} buyers · all time`,
                ],
                [MessageSquare, 'SMS eligible', number(d.sms), 'Recorded opt-in · all time'],
              ].map(([Icon, label, value, sub]) => (
                <section className="stat-card" key={label}>
                  <div>
                    <span>{label}</span>
                    <Icon size={16} />
                  </div>
                  <strong>{value}</strong>
                  <small>
                    <span className="stat-dot" />
                    {sub}
                  </small>
                </section>
              ))}
            </div>
            <div className="analytics-grid">
              <section className="panel revenue-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Good nights. Lasting connections.</h2>
                    <p>Net ticket sales across your audience</p>
                  </div>
                  <span className="chart-legend">
                    <i /> Net sales
                  </span>
                </div>
                <div className="chart-total">
                  {money(d.revenue_cents, true)}
                  <span>past 90 days</span>
                </div>
                <RevenueChart data={d.trend} />
                <div className="chart-caption">
                  <span>
                    <span className="tiny-dot" /> Last 12 weeks shown
                  </span>
                  <span>USD · net of refunds</span>
                </div>
              </section>
              <section className="panel channels-panel">
                <div className="panel-heading">
                  <div>
                    <h2>How they found you</h2>
                    <p>Attributed net sales · last 90 days</p>
                  </div>
                  <Link2 size={17} />
                </div>
                <Channels channels={d.channels} />
                <div className="panel-note">
                  <ShieldCheck size={14} /> Based on recorded order sources
                </div>
              </section>
            </div>
            <div className="section-heading">
              <div>
                <span className="eyebrow">WHAT'S NEXT</span>
                <h2>On the horizon</h2>
              </div>
              <button className="text-button" onClick={() => navigate('Events')}>
                All events <ArrowRight size={14} />
              </button>
            </div>
            {d.upcoming.length ? (
              <div className="event-grid">
                {d.upcoming.slice(0, 3).map((e, i) => (
                  <EventCard
                    event={e}
                    key={e.id}
                    index={i}
                    onClick={() => open({ type: 'recommend', id: e.id })}
                  />
                ))}
              </div>
            ) : (
              <section className="panel">
                <Empty title="The next great night starts here" icon={CalendarDays}>
                  Create your first event, then connect an audience.
                </Empty>
              </section>
            )}
            <div className="bottom-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>The familiar faces</h2>
                    <p>Your highest-value customer relationships</p>
                  </div>
                  <button className="text-button" onClick={() => navigate('Audience')}>
                    View audience <ArrowRight size={14} />
                  </button>
                </div>
                <PeopleTable people={d.topPeople} open={open} compact />
              </section>
              <section className="insight-panel">
                <span className="insight-icon">
                  <Sparkles size={20} />
                </span>
                <span className="eyebrow">THE COMPOUND EFFECT</span>
                <h2>
                  The best audience for your next night?
                  <br />
                  <em>It’s already in the room.</em>
                </h2>
                <p>
                  {d.repeat_buyers
                    ? `${number(d.repeat_buyers)} people have bought more than one event. Build your next invitation around what brings them back.`
                    : 'Every RSVP and purchase can become the beginning of a lasting relationship.'}
                </p>
                <button className="text-button" onClick={() => navigate('Audience')}>
                  Get to know your audience <ArrowUpRight size={15} />
                </button>
                <div className="orbital" />
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}
function RevenueChart({ data }) {
  const max = Math.max(...data.map((d) => d.value), 10000),
    w = 760,
    h = 190,
    pad = 10;
  const coords = data.map((d, i) => [
    i * (w / (data.length - 1)),
    h - pad - (d.value / max) * (h - 30),
  ]);
  const line = coords.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  return (
    <div className="chart">
      <div className="y-axis">
        {[1, 0.75, 0.5, 0.25, 0].map((v) => (
          <span key={v}>{money(max * v, true)}</span>
        ))}
      </div>
      <div className="plot">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Weekly net ticket sales chart"
        >
          <defs>
            <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#538bb8" stopOpacity=".25" />
              <stop offset="100%" stopColor="#538bb8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.1, 0.325, 0.55, 0.775, 1].map((y) => (
            <line
              key={y}
              x1="0"
              x2={w}
              y1={y * (h - pad)}
              y2={y * (h - pad)}
              stroke="#283342"
              strokeDasharray="3 5"
            />
          ))}
          <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#area)" />
          <path
            d={line}
            fill="none"
            stroke="#8eb8dd"
            strokeWidth="2.4"
            vectorEffect="non-scaling-stroke"
          />
          {coords.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3" fill="#9cc4e6">
              <title>
                {data[i].label}: {money(data[i].value)}
              </title>
            </circle>
          ))}
        </svg>
        <div className="x-axis">
          {data
            .filter((_, i) => i % 2 === 0 || i === 11)
            .map((d) => (
              <span key={d.label}>{d.label}</span>
            ))}
        </div>
      </div>
    </div>
  );
}
function Channels({ channels }) {
  const colors = ['#94b4ce', '#507f9f', '#3c566f', '#b7a487', '#697482'];
  const total = channels.reduce((s, c) => s + c.value, 0);
  let acc = 0;
  const stops = channels
    .map((c, i) => {
      const start = acc;
      acc += total ? (c.value / total) * 100 : 0;
      return `${colors[i % 5]} ${start}% ${acc}%`;
    })
    .join(',');
  return (
    <>
      <div className="donut" style={{ background: total ? `conic-gradient(${stops})` : '#263241' }}>
        <div>
          <span>NET SALES</span>
          <strong>{money(total, true)}</strong>
          <small>{channels.length} sources</small>
        </div>
      </div>
      <div className="channel-list">
        {channels.length ? (
          channels.map((c, i) => (
            <div key={c.name}>
              <span>
                <i style={{ background: colors[i % 5] }} />
                {c.name}
              </span>
              <strong>{total ? ((c.value / total) * 100).toFixed(0) : 0}%</strong>
            </div>
          ))
        ) : (
          <p className="muted">Sources appear after your first import.</p>
        )}
      </div>
    </>
  );
}
function EventArt({ event, index }) {
  return (
    <div className={`event-art art-${index % 3}`}>
      <div className="art-glow" />
      <div className="art-lines" />
      <span className="art-tag">CROWD CONTROL PRESENTS</span>
      <div className="art-title">
        {event.name.split(' ').map((s, i) => (
          <span key={i}>{s}</span>
        ))}
      </div>
      <span className="art-bottom">
        {event.concept} <span>•</span> {event.city}
      </span>
      <span className="event-date">
        <strong>{new Date(event.starts_at).getDate()}</strong>
        {date(event.starts_at, { month: 'short' }).toUpperCase()}
      </span>
    </div>
  );
}
function EventCard({ event: e, index, onClick }) {
  const percent = Math.min(100, (e.tickets / e.capacity) * 100);
  return (
    <button className="event-card" onClick={onClick}>
      <EventArt event={e} index={index} />
      <div className="event-content">
        <div className="event-name">
          <h3>{e.name}</h3>
          <ArrowUpRight size={17} />
        </div>
        <p>
          <MapPin size={12} />
          {e.venue} <span>·</span> {e.city}
        </p>
        <div className="event-progress">
          <span>
            {number(e.tickets)} <small>/ {number(e.capacity)} tickets</small>
          </span>
          <strong>{Math.round(percent)}%</strong>
        </div>
        <div className="progress">
          <i style={{ width: `${percent}%` }} />
        </div>
        <div className="event-foot">
          <span className="badge">{e.genre}</span>
          <span>
            {money(e.revenue_cents, true)} <small>net sales</small>
          </span>
        </div>
      </div>
    </button>
  );
}
function PeopleTable({ people, open, compact = false }) {
  return people.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>MEMBER</th>
            {!compact && <th>MARKET</th>}
            <th>EVENTS</th>
            <th>NET SPEND</th>
            {!compact && <th>REACHABILITY</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} onClick={() => open({ type: 'person', id: p.id })}>
              <td>
                <button
                  className="person-cell"
                  onClick={(e) => {
                    e.stopPropagation();
                    open({ type: 'person', id: p.id });
                  }}
                >
                  <Avatar name={p.name} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{compact ? p.city : p.email}</small>
                  </span>
                </button>
              </td>
              {!compact && <td>{p.city || 'Not provided'}</td>}
              <td>
                {p.events_count}
                <span className="muted"> {p.events_count === 1 ? 'event' : 'events'}</span>
              </td>
              <td className="spend">{money(p.revenue_cents, true)}</td>
              {!compact && (
                <td>
                  <div className="reachability">
                    {p.email_status === 'opted_in' && (
                      <Badge tone="green">
                        <Mail size={11} /> Email
                      </Badge>
                    )}
                    {p.sms_status === 'opted_in' && (
                      <Badge tone="blue">
                        <MessageSquare size={11} /> SMS
                      </Badge>
                    )}
                    {p.email_status !== 'opted_in' && p.sms_status !== 'opted_in' && (
                      <span className="muted">No opt-in recorded</span>
                    )}
                  </div>
                </td>
              )}
              <td>
                <ChevronRight size={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="Your audience starts with one connection" icon={Users}>
      Add a contact or import a reviewed event report.
    </Empty>
  );
}
function Audience({ version, search, setSearch, open, write }) {
  const [segment, setSegment] = useState('all');
  const { data, loading, error } = useData(
    `/people?search=${encodeURIComponent(search)}&segment=${segment}`,
    version,
  );
  return (
    <>
      <PageTitle
        eyebrow="THE PEOPLE BEHIND THE NIGHTS"
        title="Your audience."
        description="One profile. Every connection. A relationship that lasts."
      >
        <Button icon={Upload} onClick={() => write('import')}>
          Import audience
        </Button>
        <Button className="primary" icon={Plus} onClick={() => write('contact')}>
          Add contact
        </Button>
      </PageTitle>
      <section className="panel audience-panel">
        <div className="audience-toolbar">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="Search audience"
              placeholder="Search name, email or city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="result-count">{number(data?.length)} members</span>
        </div>
        <div className="segment-tabs">
          {[
            ['all', 'Everyone'],
            ['repeat', 'Repeat buyers'],
            ['email', 'Email eligible'],
            ['sms', 'SMS eligible'],
            ['nonbuyers', 'Not yet buyers'],
          ].map(([key, label]) => (
            <button
              className={segment === key ? 'active' : ''}
              key={key}
              onClick={() => setSegment(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <ErrorBox message={error} />
        {loading ? <Loading /> : <PeopleTable people={data || []} open={open} />}
      </section>
    </>
  );
}
function Events({ version, open, write }) {
  const { data, loading, error } = useData('/events', version);
  const [filter, setFilter] = useState('upcoming');
  const list = (data || []).filter(
    (e) =>
      filter === 'all' ||
      (filter === 'upcoming'
        ? Date.parse(e.starts_at) > Date.now()
        : Date.parse(e.starts_at) <= Date.now()),
  );
  return (
    <>
      <PageTitle
        eyebrow="CURATED NIGHTS. CONNECTED PEOPLE."
        title="Make the next night count."
        description="Every event is a new chapter in your audience’s story."
      >
        <Button className="primary" icon={Plus} onClick={() => write('event')}>
          Create event
        </Button>
      </PageTitle>
      <div className="filter-bar">
        <div className="segment-tabs">
          {['upcoming', 'past', 'all'].map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All events' : f === 'past' ? 'Past events' : 'Upcoming'}
            </button>
          ))}
        </div>
        <span className="muted">{list.length} events</span>
      </div>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : list.length ? (
        <div className="event-grid events-full">
          {list.map((e, i) => (
            <EventCard
              key={e.id}
              event={e}
              index={i}
              onClick={() => open({ type: 'recommend', id: e.id })}
            />
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty title="A blank canvas for a great night" icon={CalendarDays}>
            Create an event to start building its audience.
          </Empty>
        </section>
      )}
    </>
  );
}
function Sources({ version, write, workspace }) {
  const { data: d, loading, error } = useData('/sources', version);
  return (
    <>
      <PageTitle
        eyebrow="THE FOUNDATION"
        title="Bring it all together."
        description="Connect the moments that make your audience yours."
      >
        <Button className="primary" icon={Upload} onClick={() => write('import')}>
          Import CSV
        </Button>
      </PageTitle>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : (
        d && (
          <>
            <div className="source-grid">
              <section className="panel source-card">
                <span className="source-logo">
                  P<span>↗</span>
                </span>
                <Badge tone="amber">CSV ready</Badge>
                <h2>POSH</h2>
                <p>
                  Bring in orders, buyer profiles, tracking links and order-level scan counts from
                  your event reports.
                </p>
                <Button icon={Upload} onClick={() => write('import')}>
                  Import an event report <ArrowRight size={14} />
                </Button>
              </section>
              <section className="panel source-card">
                <span className="source-logo webhook">
                  <Link2 size={25} />
                </span>
                <Badge tone={d.webhookConfigured ? 'green' : ''}>
                  {d.webhookConfigured ? 'Receiver configured' : 'Setup required'}
                </Badge>
                <h2>Webhook inbox</h2>
                <p>
                  Securely capture POSH payloads. Deliveries are held for mapping before they can
                  change customer or sales data.
                </p>
                <code>POST /api/webhooks/posh</code>
              </section>
              <section className="panel source-card">
                <span className="source-logo email">
                  <Mail size={25} />
                </span>
                <Badge>Not connected</Badge>
                <h2>Email & SMS</h2>
                <p>
                  Consent history is ready. Campaign delivery and provider integrations are a next
                  step; this version sends no messages.
                </p>
                <span className="muted small-text">
                  Choose providers after validating your data.
                </span>
              </section>
            </div>
            <div className="source-summary">
              <span>
                <strong>{number(d.counts.people)}</strong> profiles
              </span>
              <span>
                <strong>{number(d.counts.events)}</strong> events
              </span>
              <span>
                <strong>{number(d.counts.orders)}</strong> orders
              </span>
              <span>
                <ShieldCheck size={14} />{' '}
                {workspace === 'demo'
                  ? 'Isolated demonstration database'
                  : 'Persistent workspace database'}
              </span>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Import history</h2>
                  <p>Review every file added to your workspace</p>
                </div>
                <Database size={17} />
              </div>
              {d.imports.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>FILE</th>
                        <th>RECEIVED</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.imports.map((b) => (
                        <tr key={b.id}>
                          <td>{b.filename}</td>
                          <td>{date(b.created_at)}</td>
                          <td>
                            <Badge tone={b.status === 'committed' ? 'green' : ''}>
                              {b.status === 'committed' ? 'Imported' : 'Preview only'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="A clean start" icon={Upload}>
                  Your import history will appear here. Files are previewed before any audience data
                  changes.
                </Empty>
              )}
            </section>
            <section className="panel inbox">
              <div className="panel-heading">
                <div>
                  <h2>Webhook deliveries</h2>
                  <p>Captured payloads awaiting a verified POSH mapping</p>
                </div>
                <Badge>{d.webhooks.length} recent</Badge>
              </div>
              {d.webhooks.length ? (
                <div className="delivery-list">
                  {d.webhooks.map((w) => (
                    <div key={w.id}>
                      <span>
                        {date(w.received_at)} · {new Date(w.received_at).toLocaleTimeString()}
                      </span>
                      <Badge tone="amber">Awaiting mapping</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-deliveries">No deliveries received.</p>
              )}
            </section>
          </>
        )
      )}
    </>
  );
}
function Auth({ onClose, onSuccess }) {
  const { data, loading, error } = useData('/auth/status');
  const [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={data?.setupRequired ? 'Your crowd starts here.' : 'Welcome back.'}
      subtitle={
        data?.setupRequired
          ? 'Create the owner account for your private workspace.'
          : 'Sign in to access your real audience data.'
      }
      onClose={onClose}
    >
      <ErrorBox message={error || err} />
      {loading ? (
        <Loading />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr('');
            const form = new FormData(e.currentTarget);
            try {
              await api(`/auth/${data.setupRequired ? 'setup' : 'login'}`, {
                method: 'POST',
                body: JSON.stringify(Object.fromEntries(form)),
              });
              onSuccess();
            } catch (e) {
              setErr(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="Email address"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
          />
          <Field
            label="Password"
            name="password"
            type="password"
            minLength={12}
            maxLength={128}
            autoComplete={data?.setupRequired ? 'new-password' : 'current-password'}
            required
          />
          <p className="form-note">
            <LockKeyhole size={13} /> At least 12 characters. Your real workspace starts empty.
          </p>
          {data?.setupRequired && data?.setupTokenRequired && (
            <Field
              label="Workspace setup token"
              name="setup_token"
              type="password"
              autoComplete="off"
              required
            />
          )}
          <Button className="primary full" disabled={busy}>
            {busy ? 'Please wait…' : data?.setupRequired ? 'Create workspace' : 'Sign in'}
            <ArrowRight size={15} />
          </Button>
        </form>
      )}
    </Modal>
  );
}
function EventForm({ onClose, onSuccess }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Set the scene."
      subtitle="Create the event. Find the people who belong there."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setBusy(true);
          const f = Object.fromEntries(new FormData(e.currentTarget));
          try {
            await api('/events', {
              method: 'POST',
              body: JSON.stringify({
                ...f,
                starts_at: new Date(f.starts_at).toISOString(),
                capacity: Number(f.capacity),
                price_cents: Math.round(Number(f.price) * 100),
              }),
            });
            onSuccess();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox message={error} />
        <Field label="Event name" name="name" placeholder="After Hours" required autoFocus />
        <div className="form-grid">
          <Field label="Concept / series" name="concept" placeholder="OVO / XO" required />
          <Field label="Genre" name="genre" placeholder="R&B" required />
        </div>
        <div className="form-grid">
          <Field label="City" name="city" placeholder="San Antonio" required />
          <Field label="Venue" name="venue" placeholder="The Ivory Room" required />
        </div>
        <Field
          label="Start date and time (include UTC offset)"
          name="starts_at"
          placeholder="2026-10-10T21:00:00-05:00"
          pattern=".*T.*(Z|[+-][0-9]{2}:[0-9]{2})"
          required
        />
        <Field label="Event timezone" name="timezone" defaultValue="America/Chicago" required />
        <div className="form-grid">
          <Field label="Capacity" name="capacity" type="number" min="1" max="1000000" required />
          <Field
            label="Base ticket price (USD)"
            name="price"
            type="number"
            min="0"
            step="0.01"
            required
          />
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button className="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create event'}
            <ArrowRight size={14} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ContactForm({ onClose, onSuccess }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="A new connection."
      subtitle="Start a profile. Let the relationship grow."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api('/people', {
              method: 'POST',
              body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
            });
            onSuccess();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox message={error} />
        <Field label="Full name" name="name" required autoFocus />
        <Field label="Email" name="email" type="email" required />
        <div className="form-grid">
          <Field label="Phone (optional)" name="phone" type="tel" />
          <Field label="Home city (optional)" name="city" />
        </div>
        <p className="form-note">
          <ShieldCheck size={14} /> Adding a contact does not grant marketing permission.
        </p>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add contact'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function Person({ id, onClose, workspace, refresh }) {
  const [version, setVersion] = useState(0),
    [editing, setEditing] = useState(false),
    [error, setError] = useState('');
  const { data: p, loading, error: loadError } = useData(`/people/${id}`, version);
  return (
    <Modal
      title={p?.name || 'Customer profile'}
      subtitle={p ? `${p.city || 'City not provided'} · ${p.email}` : ''}
      onClose={onClose}
      wide
    >
      <ErrorBox message={loadError || error} />
      {loading ? (
        <Loading />
      ) : (
        p && (
          <>
            <div className="profile-stats">
              <div>
                <span>NET LIFETIME SPEND</span>
                <strong>{money(p.revenue_cents, true)}</strong>
              </div>
              <div>
                <span>EVENTS PURCHASED</span>
                <strong>{p.events_count}</strong>
              </div>
              <div>
                <span>MEMBER SINCE</span>
                <strong>{date(p.created_at, { month: 'short', year: 'numeric' })}</strong>
              </div>
            </div>
            <div className="profile-section">
              <div className="section-heading">
                <h3>Communication preferences</h3>
                {workspace === 'live' && (
                  <button className="text-button" onClick={() => setEditing(!editing)}>
                    Record consent <Plus size={13} />
                  </button>
                )}
              </div>
              <div className="consent-row">
                <Badge tone={p.email_status === 'opted_in' ? 'green' : ''}>
                  <Mail size={13} /> Email · {p.email_status.replaceAll('_', ' ')}
                </Badge>
                <Badge tone={p.sms_status === 'opted_in' ? 'green' : ''}>
                  <MessageSquare size={13} /> SMS · {p.sms_status.replaceAll('_', ' ')}
                </Badge>
              </div>
              {editing && (
                <form
                  className="consent-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await api(`/people/${id}/consent`, {
                        method: 'POST',
                        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
                      });
                      setEditing(false);
                      setVersion((v) => v + 1);
                      refresh();
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  <div className="form-grid">
                    <Field label="Channel">
                      <select name="channel">
                        <option value="email">Email</option>
                        <option value="sms">SMS</option>
                      </select>
                    </Field>
                    <Field label="Decision">
                      <select name="status">
                        <option value="opted_out">Opted out</option>
                        <option value="opted_in">Opted in</option>
                      </select>
                    </Field>
                  </div>
                  <Field
                    label="Evidence / source"
                    name="evidence"
                    minLength={10}
                    placeholder="Form URL, disclosure version, date and evidence reference"
                    required
                  />
                  <Button className="primary">Save consent evidence</Button>
                </form>
              )}
            </div>
            <div className="profile-section">
              <h3>Purchase history</h3>
              {p.orders.length ? (
                <div className="order-list">
                  {p.orders.map((o) => (
                    <div key={o.id}>
                      <span className="timeline-icon">
                        <Ticket size={16} />
                      </span>
                      <div>
                        <strong>{o.event_name}</strong>
                        <small>
                          {date(o.purchased_at)} · {o.quantity} tickets · {o.channel}
                        </small>
                      </div>
                      <span>
                        {money(o.subtotal_cents - o.refund_cents)}
                        <small>{o.status}</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No purchases recorded yet.</p>
              )}
            </div>
            <div className="profile-section">
              <h3>Relationship timeline</h3>
              <div className="timeline">
                {p.interactions.length ? (
                  p.interactions.slice(0, 12).map((i) => (
                    <div key={i.id}>
                      <i />
                      <div>
                        <strong>{i.detail}</strong>
                        <small>
                          {date(i.occurred_at)} · {i.source}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">New interactions will appear here.</p>
                )}
              </div>
            </div>
          </>
        )
      )}
    </Modal>
  );
}
function Recommendation({ id, onClose }) {
  const { data: d, loading, error } = useData(`/events/${id}/audience`);
  const [tier, setTier] = useState('A');
  return (
    <Modal
      title={d?.event.name || 'Event audience'}
      subtitle={
        d
          ? `${d.event.city} · ${date(d.event.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })} · ${d.event.venue}`
          : ''
      }
      onClose={onClose}
      wide
    >
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : (
        d && (
          <>
            <div className="profile-stats">
              <div>
                <span>POTENTIAL AUDIENCE</span>
                <strong>{d.people.length}</strong>
              </div>
              <div>
                <span>EMAIL · TIERS A/B</span>
                <strong>{d.email}</strong>
              </div>
              <div>
                <span>SMS · TIER A</span>
                <strong>{d.sms}</strong>
              </div>
            </div>
            <div className="recommend-note">
              <Sparkles size={18} />
              <div>
                <strong>The right people for this night.</strong>
                <p>
                  Ranked by city, concept and purchase history. {d.suppressed} existing buyers
                  excluded.
                </p>
              </div>
            </div>
            <div className="segment-tabs">
              {['A', 'B', 'C'].map((t) => (
                <button key={t} className={tier === t ? 'active' : ''} onClick={() => setTier(t)}>
                  Tier {t} <span>{d.people.filter((p) => p.tier === t).length}</span>
                </button>
              ))}
            </div>
            <div className="ranked-list">
              {d.people.filter((p) => p.tier === tier).length ? (
                d.people
                  .filter((p) => p.tier === tier)
                  .slice(0, 50)
                  .map((p) => (
                    <div key={p.id}>
                      <Avatar name={p.name} />
                      <div>
                        <strong>{p.name}</strong>
                        <small>{p.reasons.join(' · ') || 'No matching signals yet'}</small>
                        <small>
                          {p.confidence} confidence · {p.evidence_events} past paid events
                          {p.typical_lead_days !== null
                            ? ` · Usually buys ${p.typical_lead_days} days before`
                            : ''}
                        </small>
                      </div>
                      <span className="score">
                        {p.score}
                        <small>/ 100</small>
                      </span>
                    </div>
                  ))
              ) : (
                <Empty title="No matches in this tier" icon={Users}>
                  More customer history will improve these recommendations.
                </Empty>
              )}
            </div>
            <p className="form-note">
              <ShieldCheck size={14} />
              {d.note} Showing up to 50 people per tier.
            </p>
          </>
        )
      )}
    </Modal>
  );
}
function Import({ onClose, onSuccess }) {
  const { data: events } = useData('/events');
  const [file, setFile] = useState(null),
    [eventId, setEvent] = useState(''),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const download = () => {
    const csv =
      'order_id,name,email,phone,city,quantity,subtotal,refund,purchased_at,channel,tracking_link,scanned_count\nexample-001,Example Guest,guest@example.com,,San Antonio,2,60.00,0.00,2026-09-18T20:00:00-05:00,Email,newsletter,\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crowd-control-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal
      title={preview ? 'Review your import.' : 'Bring your audience home.'}
      subtitle="Preview first. Keep your customer history accurate."
      onClose={onClose}
      wide
    >
      <ErrorBox message={error} />
      {!preview ? (
        <>
          <Field label="Which event does this report belong to?">
            <select value={eventId} onChange={(e) => setEvent(e.target.value)}>
              <option value="">Select an event</option>
              {(events || []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.city}
                </option>
              ))}
            </select>
          </Field>
          {events?.length === 0 && (
            <p className="form-note">Create an event before importing its orders.</p>
          )}
          <label className="dropzone">
            <Upload size={28} />
            <strong>{file ? file.name : 'Choose your CSV report'}</strong>
            <span>One row per order · USD · up to 4 MB</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setError('');
              }}
            />
          </label>
          <div className="template-row">
            <p>
              Use the template to align your POSH export.
              <br />
              Remove transfer rows and use dates with timezone offsets.
            </p>
            <Button icon={Download} onClick={download}>
              CSV template
            </Button>
          </div>
          <p className="form-note">
            Required: order ID, name, email, quantity, subtotal and purchase date. Imports never
            grant email or SMS permission.
          </p>
          <div className="modal-footer">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              className="primary"
              disabled={!eventId || !file || busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  if (file.size > 4000000) throw new Error('Please choose a file below 4 MB.');
                  setPreview(
                    await api('/imports/preview', {
                      method: 'POST',
                      body: JSON.stringify({
                        event_id: eventId,
                        filename: file.name,
                        csv: await file.text(),
                      }),
                    }),
                  );
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Validating…' : 'Preview import'}
              <ArrowRight size={14} />
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="profile-stats">
            <div>
              <span>NEW ORDERS</span>
              <strong>{preview.newOrders}</strong>
            </div>
            <div>
              <span>ORDER UPDATES</span>
              <strong>{preview.updates}</strong>
            </div>
            <div>
              <span>FILE NET SALES</span>
              <strong>{money(preview.net_cents, true)}</strong>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>BUYER</th>
                  <th>ORDER</th>
                  <th>NET SALES</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r) => (
                  <tr key={r.external_id}>
                    <td>
                      {r.name}
                      <small className="block muted">{r.email}</small>
                    </td>
                    <td>{r.external_id}</td>
                    <td>{money(r.subtotal_cents - r.refund_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-warnings">
            {preview.warnings.map((w) => (
              <p key={w}>
                <ShieldCheck size={13} />
                {w}
              </p>
            ))}
          </div>
          <div className="modal-footer">
            <Button onClick={() => setPreview(null)}>Back</Button>
            <Button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api(`/imports/${preview.id}/commit`, { method: 'POST', body: '{}' });
                  onSuccess();
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Importing…' : `Import ${preview.rows} orders`}
              <Check size={15} />
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
