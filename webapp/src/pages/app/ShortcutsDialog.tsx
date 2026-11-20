import { X } from 'lucide-react';
import { useT, type Key } from '../../i18n';
import { useEscape } from '../../lib/useEscape';

/** `G` then a letter jumps to a view (see AppLayout). */
export const GO_SHORTCUTS: [string, string, Key][] = [
  ['t', '/app/tasks/today', 'smartToday'],
  ['i', '/app/tasks/inbox', 'smartInbox'],
  ['a', '/app/tasks/all', 'smartAll'],
  ['c', '/app/calendar', 'navCalendar'],
  ['m', '/app/matrix', 'navMatrix'],
  ['h', '/app/habit', 'navHabits'],
  ['f', '/app/focus', 'navFocus'],
  ['d', '/app/countdown', 'navCountdowns'],
  ['s', '/app/stats', 'statsTitle'],
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key, index) => (
        <kbd key={index} className="min-w-[22px] rounded-md border border-line bg-[#fafafa] px-1.5 py-0.5 text-center font-sans text-[11px] text-ink-2 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
          {key}
        </kbd>
      ))}
    </span>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-[13px] text-ink-2">
      <span className="min-w-0 truncate">{label}</span>
      <Keys keys={keys} />
    </div>
  );
}

/** The keyboard shortcuts, opened with `?` or from the account menu. */
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  useEscape(onClose);
  const mod = isMac ? '⌘' : 'Ctrl';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcutsTitle')}
        className="max-h-[88vh] w-full max-w-[640px] overflow-y-auto rounded-xl bg-white p-5 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center">
          <h2 className="text-[17px] font-semibold">{t('shortcutsTitle')}</h2>
          <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="ml-auto rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={17} />
          </button>
        </div>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <section>
            <h3 className="mb-1 text-[12px] font-semibold text-ink-3">{t('shortcutsGeneral')}</h3>
            <Row keys={['N']} label={t('shortcutNewTask')} />
            <Row keys={['/']} label={t('shortcutSearch')} />
            <Row keys={['?']} label={t('shortcutsTitle')} />
            <Row keys={['Esc']} label={t('shortcutEscape')} />
            <h3 className="mb-1 mt-4 text-[12px] font-semibold text-ink-3">{t('shortcutsTasks')}</h3>
            <Row keys={['Enter']} label={t('shortcutOpenTask')} />
            <Row keys={[mod, t('shortcutClick')]} label={t('shortcutMultiSelect')} />
            <h3 className="mb-1 mt-4 text-[12px] font-semibold text-ink-3">{t('shortcutsQuickAdd')}</h3>
            <Row keys={['#']} label={t('shortcutTag')} />
            <Row keys={['!']} label={t('shortcutPriority')} />
            <Row keys={['~']} label={t('shortcutDate')} />
          </section>
          <section>
            <h3 className="mb-1 text-[12px] font-semibold text-ink-3">{t('shortcutsGoTo')}</h3>
            {GO_SHORTCUTS.map(([key, , label]) => (
              <Row key={key} keys={['G', key.toUpperCase()]} label={t(label)} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
