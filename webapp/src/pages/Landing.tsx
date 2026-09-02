import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Cloud,
  GitBranch,
  Hourglass,
  LayoutGrid,
  ListTodo,
  Tag,
  Target,
  Terminal,
} from 'lucide-react';
import { LogoMark } from '../components/Logo';
import { api } from '../lib/api';
import { useT, useTF } from '../i18n';

const FEATURES = [
  { icon: ListTodo, titleKey: 'featTasks', descKey: 'featTasksDesc' },
  { icon: Tag, titleKey: 'featTags', descKey: 'featTagsDesc' },
  { icon: LayoutGrid, titleKey: 'featMatrix', descKey: 'featMatrixDesc' },
  { icon: CalendarDays, titleKey: 'featHabit', descKey: 'featHabitDesc' },
  { icon: Target, titleKey: 'featFocus', descKey: 'featFocusDesc' },
  { icon: Hourglass, titleKey: 'featCountdown', descKey: 'featCountdownDesc' },
] as const;

export default function Landing() {
  const t = useT();
  const f = useTF();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    document.title = 'NodeTick: To-Do List & Tasks';
    api.me().then(
      () => setSignedIn(true),
      () => setSignedIn(false),
    );
  }, []);

  return (
    <div className="min-h-full bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-line/60 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-6">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark size={28} />
            <span className="text-[19px] font-bold tracking-tight">NodeTick</span>
          </Link>
          <nav className="ml-10 hidden items-center gap-7 text-[14px] text-ink-2 md:flex">
            <a href="#features" className="hover:text-ink">{t('navFeatures')}</a>
            <a href="#selfhost" className="hover:text-ink">{t('navSelfhost')}</a>
            <a href="#cli" className="hover:text-ink">{t('navCli')}</a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {signedIn === true ? (
              <Link
                to="/app"
                className="rounded-full bg-tt px-5 py-2 text-[14px] font-medium text-white transition-colors hover:bg-tt-hover"
              >
                {t('openApp')}
              </Link>
            ) : (
              <>
                {signedIn === false && (
                  <Link to="/login" className="text-[14px] text-ink-2 hover:text-ink">
                    {t('signIn')}
                  </Link>
                )}
                <Link
                  to={signedIn === false ? '/register' : '/app'}
                  className="rounded-full bg-tt px-5 py-2 text-[14px] font-medium text-white transition-colors hover:bg-tt-hover"
                >
                  {t('getStarted')}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-20 text-center">
          <h1 className="mx-auto max-w-3xl text-[44px] font-extrabold leading-[1.15] tracking-tight md:text-[56px]">
            {t('heroA')}
            <br />
            <span className="text-tt">{t('heroB')}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
            {t('landingSub')}
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              to={signedIn === true ? '/app' : '/register'}
              className="rounded-full bg-tt px-7 py-3 text-[15px] font-medium text-white shadow-[0_6px_20px_rgba(71,114,250,0.35)] transition-all hover:bg-tt-hover"
            >
              {t('getStarted')}
            </Link>
            <a
              href="#selfhost"
              className="rounded-full border border-line px-7 py-3 text-[15px] font-medium text-ink transition-colors hover:border-tt hover:text-tt"
            >
              {t('deployOnCf')}
            </a>
          </div>

          {/* App mock */}
          <AppMock />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-line/60 bg-[#fafbfc] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-[32px] font-bold tracking-tight">{t('featuresTitle')}</h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-[15px] text-ink-2">
            {t('featuresSub')}
          </p>
          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, titleKey, descKey }) => (
              <div
                key={titleKey}
                className="rounded-2xl border border-line/70 bg-white p-6 transition-shadow hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-tt-light text-tt">
                  <Icon size={22} />
                </div>
                <h3 className="text-[16px] font-semibold">{t(titleKey)}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{t(descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Self-hosted strip */}
      <section id="selfhost" className="py-20">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 md:grid-cols-2">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-tt-light px-3 py-1 text-[13px] font-medium text-tt">
              <Cloud size={14} /> {t('selfhostTag')}
            </div>
            <h2 className="text-[32px] font-bold leading-tight tracking-tight">
              {t('selfhostTitleA')}
              <span className="text-tt">{t('selfhostTitleB')}</span>
              {t('selfhostTitleC')}
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-2">{t('selfhostDesc')}</p>
            <ul className="mt-6 space-y-3 text-[14px] text-ink-2">
              {(['selfhostB1', 'selfhostB2', 'selfhostB3'] as const).map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-tt" />
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-[#0d1117] p-5 font-mono text-[13px] leading-relaxed text-[#c9d1d9] shadow-[0_12px_32px_rgba(0,0,0,0.15)]">
            <div className="mb-3 flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
            <p><span className="text-[#7ee787]">$</span> git clone https://github.com/Windyskr/nodetick</p>
            <p><span className="text-[#7ee787]">$</span> cd nodetick &amp;&amp; npm install</p>
            <p><span className="text-[#7ee787]">$</span> npx wrangler d1 create nodetick-db</p>
            <p><span className="text-[#7ee787]">$</span> npm run deploy</p>
            <p className="mt-2 text-[#8b949e]">🌐 https://nodetick.&lt;your-subdomain&gt;.workers.dev</p>
          </div>
        </div>
      </section>

      {/* CLI */}
      <section id="cli" className="border-t border-line/60 bg-[#fafbfc] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2">
            <div className="order-2 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.05)] md:order-1">
              <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed">
                <code>
                  <span className="text-ink-3">$</span> <span className="font-semibold text-tt">nodetick</span> task add "{t('mockTask1')}" <br />
                  {'  '}✓ <span className="text-ink-2">{t('smartInbox')}</span>{'\n'}
                  <span className="text-ink-3">$</span> <span className="font-semibold text-tt">nodetick</span> task today{'\n'}
                  {'  '}● {t('mockTask1')}  <span className="text-ink-2">{t('smartInbox')} · {t('relToday')}</span>{'\n'}
                  <span className="text-ink-3">$</span> <span className="font-semibold text-tt">nodetick</span> habit checkin drink-water{'\n'}
                  {'  '}✓ {f('habitStreak', 1)}
                </code>
              </pre>
            </div>
            <div className="order-1 md:order-2">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-tt-light px-3 py-1 text-[13px] font-medium text-tt">
                <Terminal size={14} /> {t('cliTag')}
              </div>
              <h2 className="text-[32px] font-bold leading-tight tracking-tight">
                {t('cliTitle')}
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
                {t('cliDesc')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-tt py-16 text-center">
        <h2 className="text-[28px] font-bold tracking-tight text-white">{t('ctaTitle')}</h2>
        <p className="mt-3 text-[15px] text-white/80">{t('ctaSub')}</p>
        <Link
          to={signedIn === true ? '/app' : '/register'}
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-[15px] font-semibold text-tt shadow-lg transition-transform hover:scale-[1.03]"
        >
          {t('getStarted')} <ArrowRight size={16} />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-line bg-white py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-[13px] text-ink-3 md:flex-row">
          <div className="flex items-center gap-2">
            <LogoMark size={20} />
            <span>NodeTick</span>
            <span className="text-line">|</span>
            <span>{t('mitLicense')}</span>
          </div>
          <div className="flex items-center gap-5">
            <a
              href="https://github.com/Windyskr/nodetick"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:text-ink"
            >
              <GitBranch size={14} /> GitHub
            </a>
            <span className="flex items-center gap-1.5">
              <Cloud size={14} /> Cloudflare Workers + D1
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Pure-CSS miniature of the app UI used as the hero screenshot. */
function AppMock() {
  const t = useT();
  const smart = [t('smartAll'), t('smartToday'), t('smartNext7'), t('smartInbox')];
  const lists = [t('mockWelcome'), t('mockWork'), t('mockPersonal')];
  const rows: [string, string, string][] = [
    [t('mockTask1'), t('mockWork'), '#4772FA'],
    [t('mockTask2'), t('mockPersonal'), '#47a35c'],
    [t('mockTask3'), t('mockWelcome'), '#faa80c'],
  ];
  return (
    <div className="relative mx-auto mt-14 max-w-4xl">
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_60px_rgba(0,0,0,0.12)]">
        <div className="flex h-[420px] text-left">
          {/* mini rail */}
          <div className="hidden w-12 flex-col items-center gap-4 border-r border-line py-4 md:flex">
            <div className="h-7 w-7 rounded-full bg-hover" />
            <div className="mt-2 flex h-8 w-8 items-center justify-center rounded-lg bg-tt text-white">
              <CheckCircle2 size={16} />
            </div>
            <CalendarDays size={17} className="text-ink-3" />
            <LayoutGrid size={17} className="text-ink-3" />
            <Target size={17} className="text-ink-3" />
          </div>
          {/* mini sidebar */}
          <div className="hidden w-52 flex-col border-r border-line bg-[#fbfbfb] py-4 md:flex">
            {smart.map((label, i) => (
              <div
                key={label}
                className={`mx-2 mb-1 flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] ${
                  i === 0 ? 'bg-selected font-medium' : 'text-ink-2'
                }`}
              >
                {label}
                <span className="text-[11px] text-ink-3">3</span>
              </div>
            ))}
            <div className="mx-3 mt-4 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              {t('sectionLists')}
            </div>
            {lists.map((label) => (
              <div key={label} className="mx-2 mb-1 rounded-md px-2.5 py-1.5 text-[13px] text-ink-2">
                {label}
              </div>
            ))}
          </div>
          {/* mini list */}
          <div className="flex-1 px-6 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[18px] font-bold">{t('smartAll')}</span>
              <ArrowUpDown size={15} className="text-ink-3" />
            </div>
            <div className="mb-4 rounded-lg bg-hover px-3 py-2 text-[13px] text-ink-3">
              {t('addTaskTo').replace('{0}', t('smartInbox'))}
            </div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
              <ChevronDown size={13} /> {t('relToday')} <span className="text-ink-3">3</span>
            </div>
            {rows.map(([title, list, color]) => (
              <div key={title} className="flex items-center gap-3 border-b border-line/70 py-2.5">
                <span className="h-4 w-4 shrink-0 rounded-full border-2 border-[#d5d5d5]" />
                <span className="text-[13px]">{title}</span>
                <span className="ml-auto flex items-center gap-1 text-[12px] text-ink-3">
                  <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
                  {list}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ArrowUpDown({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <path d="m21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16" />
    </svg>
  );
}
