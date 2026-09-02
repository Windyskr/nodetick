import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { CalendarDays, CheckSquare, Clock3, Hourglass, KeyRound, Languages, LayoutGrid, LogOut, Palette, Search, Target } from 'lucide-react';
import { Popover } from '../../components/Popover';
import { useI18n, useT } from '../../i18n';
import { useStore } from '../../stores/store';

const RAIL = 'flex h-full w-12 shrink-0 flex-col items-center border-r border-line bg-[#fbfbfb] py-3';
type Theme = 'blue' | 'violet' | 'green' | 'dark';
const THEMES: { id: Theme; color: string }[] = [
  { id: 'blue', color: '#4772fa' },
  { id: 'violet', color: '#7c5ce6' },
  { id: 'green', color: '#2e9b72' },
  { id: 'dark', color: '#202a38' },
];

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem('ntk_theme');
    if (stored === 'blue' || stored === 'violet' || stored === 'green' || stored === 'dark') return stored;
  } catch {
    // no localStorage — use the default theme
  }
  return 'blue';
}

export default function IconRail() {
  const navigate = useNavigate();
  const { me, logout } = useStore();
  const t = useT();
  const { lang, setLang } = useI18n();
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ntk_theme', theme);
    } catch {
      // storage may be disabled; the current tab still keeps the theme
    }
  }, [theme]);

  const item = (to: string, label: string, Icon: typeof CheckSquare) => (
    <NavLink
      key={to}
      to={to}
      title={label}
      className={({ isActive }) =>
        `flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
          isActive ? 'text-tt' : 'text-[#8c8c8c] hover:bg-hover hover:text-ink-2'
        }`
      }
    >
      <Icon size={19} strokeWidth={1.8} />
    </NavLink>
  );

  return (
    <div className={RAIL}>
      <Popover
        align="left"
        panelClass="w-52"
        trigger={(open, toggle) => (
          <button
            type="button"
            onClick={toggle}
            title={me?.email}
            className={`mb-3 flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-white ${
              open ? 'ring-2 ring-tt/40' : ''
            }`}
            style={{ background: '#b0b6bf' }}
          >
            {(me?.email ?? '?')[0].toUpperCase()}
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="border-b border-line px-3 py-2">
              <div className="truncate text-[13px] font-medium">{me?.email}</div>
              {me?.isAdmin && <div className="text-[12px] text-ink-3">{t('accountAdmin')}</div>}
            </div>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover"
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            >
              <Languages size={14} /> {t('langToggle')}
            </button>
            <div className="mt-1 flex items-center gap-1.5 border-t border-line px-3 pb-1 pt-2 text-[11px] font-medium text-ink-3"><Palette size={12} />{t('appearance')}</div>
            <div className="grid grid-cols-4 gap-1 px-3 pb-2">
              {THEMES.map((item) => {
                const label = item.id === 'blue' ? t('themeBlue') : item.id === 'violet' ? t('themeViolet') : item.id === 'green' ? t('themeGreen') : t('themeDark');
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={theme === item.id}
                    onClick={() => setTheme(item.id)}
                    className={`flex h-7 items-center justify-center rounded-md border ${theme === item.id ? 'border-tt bg-tt-light' : 'border-line hover:bg-hover'}`}
                  >
                    <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: item.color }} />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover"
              onClick={() => {
                close();
                navigate('/app/tokens');
              }}
            >
              <KeyRound size={14} /> {t('apiTokens')}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover"
              onClick={async () => {
                close();
                await logout();
                window.location.href = '/';
              }}
            >
              <LogOut size={14} /> {t('signOut')}
            </button>
          </>
        )}
      </Popover>

      <div className="flex flex-col items-center gap-2">
        {item('/app/tasks/all', t('navTasks'), CheckSquare)}
        {item('/app/calendar', t('navCalendar'), CalendarDays)}
        {item('/app/matrix', t('navMatrix'), LayoutGrid)}
        {item('/app/habit', t('navHabits'), Clock3)}
        {item('/app/focus', t('navFocus'), Target)}
        {item('/app/countdown', t('navCountdowns'), Hourglass)}
        {item('/app/search', t('navSearch'), Search)}
      </div>

    </div>
  );
}
