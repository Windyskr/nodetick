import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Flag,
  FolderOpen,
  Paperclip,
  Plus,
  Settings2,
  Tag as TagIcon,
} from 'lucide-react';
import { useStore } from '../../stores/store';
import { useI18n, useT, useTF, type Lang } from '../../i18n';
import { allDayDate } from '../../lib/date';
import { describeRepeat } from '../../lib/repeat';
import { localDateTime, scheduleLabel } from '../../components/taskSchedule';
import { findQuickDateToken, parseQuickAdd, type QuickDateToken } from '../../lib/quickParse';
import { projectDisplayName } from '../../lib/project';
import type { Project, Tag } from '../../lib/types';
import { Popover } from '../../components/Popover';
import { PRIORITY_COLORS, PRIORITY_LEVELS, priorityLabel } from '../../components/RoundCheck';
import { ScheduleMenu, type TaskSchedule } from '../../components/ScheduleMenu';
import { uniqueTags } from '../../lib/tags';

const EMPTY_SCHEDULE: TaskSchedule = {
  startDate: null,
  dueDate: null,
  isAllDay: false,
  reminders: [],
  repeatFlag: null,
};

interface QueuedTask {
  raw: string;
  lang: Lang;
  projectId: string;
  tags: string[];
  priority: number;
  schedule: TaskSchedule;
  kind: 'TASK' | 'NOTE';
  recognizeBareDates: boolean;
  /** What the input showed as recognized when the task was submitted. */
  recognized?: Pick<QuickDateToken, 'dueDate' | 'time' | 'repeat'>;
}

function sameDateToken(left: QuickDateToken, right: QuickDateToken): boolean {
  return left.text === right.text
    && left.start === right.start
    && left.end === right.end
    && left.dueDate === right.dueDate
    && left.time === right.time
    && left.repeat === right.repeat;
}

/** The schedule a recognized phrase stands for: a timed or all-day due date, maybe repeating. */
function tokenSchedule(token: Pick<QuickDateToken, 'dueDate' | 'time' | 'repeat'>): Pick<TaskSchedule, 'dueDate' | 'isAllDay' | 'repeatFlag'> | null {
  const dueDate = token.time ? localDateTime(token.dueDate, token.time) : allDayDate(token.dueDate);
  if (!dueDate) return null;
  return { dueDate, isAllDay: !token.time, repeatFlag: token.repeat ?? null };
}

function getInlineDate(raw: string, recognized: QuickDateToken | null, lang: Lang): QuickDateToken | null {
  if (!recognized) return null;
  const token = findQuickDateToken(raw, lang);
  return token && sameDateToken(token, recognized) ? token : null;
}

/**
 * TickTick-style quick-add bar. It supports natural dates (`今天`, `today`),
 * explicit quick-add tokens (`~明天`, `!高`, `#标签`), and the same date and
 * task-options menus used by the task detail panel.
 */
/** The schedule a new task starts with: empty, or all-day on a smart list's default day. */
function defaultSchedule(day: string | null): TaskSchedule {
  return day ? { ...EMPTY_SCHEDULE, dueDate: allDayDate(day), isAllDay: true } : EMPTY_SCHEDULE;
}

export function QuickAdd({ projectId, placeholder, defaultDueDate = null }: {
  projectId: string;
  placeholder: string;
  /** YYYY-MM-DD preset from date smart lists (Today, Tomorrow, Next 7 Days); typed dates still win. */
  defaultDueDate?: string | null;
}) {
  const createTask = useStore((state) => state.createTask);
  const projects = useStore((state) => state.projects);
  const tags = useStore((state) => state.tags);
  const lang = useI18n((state) => state.lang);
  const t = useT();
  const f = useTF();
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const queue = useRef<QueuedTask[]>([]);
  const draining = useRef(false);
  const composing = useRef(false);
  const rawValue = useRef('');
  const [rawText, setRawText] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [recognizedDate, setRecognizedDate] = useState<QuickDateToken | null>(null);
  const recognizedDateRef = useRef<QuickDateToken | null>(null);
  const ignoredDateRef = useRef<QuickDateToken | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [priority, setPriority] = useState(0);
  const [schedule, setSchedule] = useState<TaskSchedule>(() => defaultSchedule(defaultDueDate));
  const [kind, setKind] = useState<'TASK' | 'NOTE'>('TASK');
  const [smartParsing, setSmartParsing] = useState(true);

  useEffect(() => {
    setSelectedProjectId(projectId);
  }, [projectId]);

  // Switching between Today / Tomorrow / a project resets the preset date.
  useEffect(() => {
    setSchedule(defaultSchedule(defaultDueDate));
  }, [defaultDueDate]);

  const updateRecognizedDate = (next: QuickDateToken | null) => {
    recognizedDateRef.current = next;
    setRecognizedDate(next);
  };

  const updateIgnoredDate = (next: QuickDateToken | null) => {
    ignoredDateRef.current = next;
  };

  const recognizeDate = (raw: string) => {
    if (!smartParsing) {
      updateRecognizedDate(null);
      return;
    }
    const token = findQuickDateToken(raw, lang);
    const ignored = ignoredDateRef.current;
    if (ignored && (!token || !sameDateToken(token, ignored))) updateIgnoredDate(null);
    if (!token || (ignored && sameDateToken(token, ignored))) {
      updateRecognizedDate(null);
      return;
    }
    updateRecognizedDate(token);
  };

  // Let the browser/IME finish committing text before looking for natural
  // dates. This also handles browsers that dispatch `input` just after
  // `compositionend`.
  useEffect(() => {
    if (!smartParsing || composing.current) return;
    const raw = rawValue.current;
    if (raw) recognizeDate(raw);
    // The effect intentionally runs when parsing mode or language changes;
    // normal keystrokes are handled by the input event below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartParsing, lang]);

  useEffect(() => {
    if (highlightRef.current && inputRef.current) {
      highlightRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }, [rawText, recognizedDate, isComposing]);

  const cancelDateRecognition = () => {
    const token = recognizedDateRef.current;
    if (!token) return;
    updateIgnoredDate(token);
    updateRecognizedDate(null);
  };

  const inlineDate = getInlineDate(rawText, recognizedDate, lang);
  const inlineSchedule = inlineDate ? tokenSchedule(inlineDate) : null;
  // How the phrase was read, e.g. "11月21日 15:00 · 每周一".
  const inlinePreview = inlineSchedule
    ? [scheduleLabel(null, inlineSchedule.dueDate, inlineSchedule.isAllDay, lang), inlineSchedule.repeatFlag ? describeRepeat(inlineSchedule.repeatFlag, lang, f) : '']
      .filter(Boolean)
      .join(' · ')
    : '';

  const drain = async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length > 0) {
        const item = queue.current.shift()!;
        const parsed = parseQuickAdd(item.raw, item.lang, { recognizeBareDates: item.recognizeBareDates });
        if (!parsed.title) continue;
        const parsedTags = uniqueTags([...item.tags, ...parsed.tags]);
        const recognized = parsed.dueDate ? { dueDate: parsed.dueDate, time: parsed.time, repeat: parsed.repeat } : item.recognized;
        const fromText = recognized ? tokenSchedule(recognized) : null;
        // A typed phrase wins over the date menu; a repeat picked in the menu
        // stays unless the phrase names its own.
        const taskSchedule = fromText
          ? { ...item.schedule, startDate: null, ...fromText, repeatFlag: fromText.repeatFlag ?? item.schedule.repeatFlag ?? null }
          : item.schedule;
        const hasSchedule = taskSchedule.startDate != null || taskSchedule.dueDate != null;
        await createTask({
          title: parsed.title,
          projectId: item.projectId,
          kind: item.kind,
          tags: parsedTags,
          priority: parsed.priority ?? item.priority,
          ...(hasSchedule ? {
            startDate: taskSchedule.startDate ?? undefined,
            dueDate: taskSchedule.dueDate ?? undefined,
            isAllDay: taskSchedule.isAllDay,
          } : {}),
          ...(taskSchedule.reminders?.length ? { reminders: taskSchedule.reminders } : {}),
          ...(taskSchedule.repeatFlag ? { repeatFlag: taskSchedule.repeatFlag } : {}),
        });
      }
    } finally {
      draining.current = false;
    }
  };

  const submit = () => {
    const raw = rawValue.current.trim();
    if (!raw) return;
    queue.current.push({
      raw,
      lang,
      projectId: selectedProjectId,
      tags: selectedTags,
      priority,
      schedule,
      kind,
      recognizeBareDates: smartParsing && ignoredDateRef.current == null,
      recognized: recognizedDateRef.current
        ? { dueDate: recognizedDateRef.current.dueDate, time: recognizedDateRef.current.time, repeat: recognizedDateRef.current.repeat }
        : undefined,
    });
    if (inputRef.current) inputRef.current.value = '';
    rawValue.current = '';
    setRawText('');
    updateRecognizedDate(null);
    updateIgnoredDate(null);
    void drain();
  };

  const toggleSmartParsing = (enabled: boolean) => {
    if (!enabled && recognizedDateRef.current) {
      updateIgnoredDate(recognizedDateRef.current);
      updateRecognizedDate(null);
    } else if (enabled) {
      updateIgnoredDate(null);
    }
    setSmartParsing(enabled);
  };

  return (
    <div className="group mx-[29px] mb-[15px] mt-[9px] flex min-h-[30px] items-center gap-2 rounded-md bg-hover/70 px-2 transition-colors focus-within:bg-white focus-within:shadow-[0_0_0_1px_rgba(71,114,250,0.35)]">
      <Plus size={16} className="shrink-0 text-ink-3" />
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {!isComposing && (
          <div
            ref={highlightRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 flex items-center overflow-hidden whitespace-pre text-[14px] leading-normal text-ink"
          >
            {rawText ? (inlineDate ? (
                <>
                  {rawText.slice(0, inlineDate.start)}
                  <span
                    role="button"
                    tabIndex={-1}
                    data-quick-date-token="true"
                    data-due-date={inlineDate.dueDate}
                    title={t('quickDateRecognized')}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      cancelDateRecognition();
                      inputRef.current?.focus();
                    }}
                    className="pointer-events-auto cursor-pointer rounded-sm bg-tt-light text-tt shadow-[inset_0_0_0_1px_rgba(71,114,250,0.22)] hover:bg-[#dce5ff]"
                  >
                    {rawText.slice(inlineDate.start, inlineDate.end)}
                  </span>
                  {rawText.slice(inlineDate.end)}
                </>
              ) : rawText) : <span className="text-ink-3">{placeholder}</span>}
          </div>
        )}
        <input
          ref={inputRef}
          data-quick-add
          defaultValue=""
          placeholder=""
          onCompositionStart={() => {
            composing.current = true;
            setIsComposing(true);
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            setIsComposing(false);
            const target = event.currentTarget;
            rawValue.current = target.value;
            setRawText(target.value);
            window.requestAnimationFrame(() => {
              if (inputRef.current === target && !composing.current) recognizeDate(rawValue.current);
            });
          }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            rawValue.current = next;
            setRawText(next);
            if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) recognizeDate(next);
            if (highlightRef.current) highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
          onScroll={(event) => {
            if (highlightRef.current) highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            const activeDate = getInlineDate(event.currentTarget.value, recognizedDateRef.current, lang);
            if ((event.key === 'Backspace' || event.key === 'Delete') && activeDate) {
              const start = event.currentTarget.selectionStart ?? 0;
              const end = event.currentTarget.selectionEnd ?? start;
              const overlaps = start !== end && start < activeDate.end && end > activeDate.start;
              const removesToken = event.key === 'Backspace'
                ? start === activeDate.end && start === end
                : start === activeDate.start && start === end;
              if (overlaps || removesToken) {
                event.preventDefault();
                cancelDateRecognition();
                return;
              }
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          className={`relative z-0 h-[30px] w-full bg-transparent text-[14px] leading-normal outline-none placeholder:text-transparent ${isComposing ? 'text-ink' : 'text-transparent caret-ink'}`}
          aria-label={placeholder}
        />
      </div>

      {inlinePreview && (
        <span data-quick-date-preview className="max-w-[45%] shrink-0 truncate rounded bg-tt-light px-1.5 py-0.5 text-[12px] text-tt" title={inlinePreview}>
          {inlinePreview}
        </span>
      )}
      <div className="pointer-events-none flex shrink-0 items-center gap-0.5 text-ink-3 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <Popover
          align="right"
          panelClass="p-0"
          trigger={(_open, toggle) => (
            <button
              type="button"
              onClick={toggle}
              title={t('schedule')}
              className={`rounded-md p-1 hover:bg-hover hover:text-ink ${schedule.startDate || schedule.dueDate ? 'text-tt' : ''}`}
            >
              <CalendarDays size={17} />
            </button>
          )}
        >
          {(close) => (
            <ScheduleMenu
              startDate={schedule.startDate}
              dueDate={schedule.dueDate}
              isAllDay={schedule.isAllDay}
              reminders={schedule.reminders}
              repeatFlag={schedule.repeatFlag}
              onSave={(next) => {
                setSchedule(next);
                close();
              }}
            />
          )}
        </Popover>
        <Popover
          align="right"
          panelClass="p-0"
          trigger={(_open, toggle) => (
            <button
              type="button"
              onClick={toggle}
              title={t('inputSettings')}
              className="rounded-md p-1 hover:bg-hover hover:text-ink"
            >
              <ChevronDown size={17} />
            </button>
          )}
        >
          {(close) => (
            <QuickAddOptions
              projects={projects}
              tags={tags}
              projectId={selectedProjectId}
              selectedTags={selectedTags}
              priority={priority}
              kind={kind}
              smartParsing={smartParsing}
              onProject={setSelectedProjectId}
              onTags={setSelectedTags}
              onPriority={setPriority}
              onKind={setKind}
              onSmartParsing={toggleSmartParsing}
              close={close}
            />
          )}
        </Popover>
      </div>
    </div>
  );
}

function QuickAddOptions({
  projects,
  tags,
  projectId,
  selectedTags,
  priority,
  kind,
  smartParsing,
  onProject,
  onTags,
  onPriority,
  onKind,
  onSmartParsing,
  close,
}: {
  projects: Project[];
  tags: Tag[];
  projectId: string;
  selectedTags: string[];
  priority: number;
  kind: 'TASK' | 'NOTE';
  smartParsing: boolean;
  onProject: (id: string) => void;
  onTags: (tags: string[]) => void;
  onPriority: (priority: number) => void;
  onKind: (kind: 'TASK' | 'NOTE') => void;
  onSmartParsing: (enabled: boolean) => void;
  close: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<'project' | 'tag' | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const project = projects.find((item) => item.id === projectId);
  const projectLabel = projectDisplayName(project, t, t('smartInbox'));

  const addTag = () => {
    const name = tagDraft.trim().replace(/^#/, '');
    if (!name) return;
    if (!selectedTags.includes(name)) onTags([...selectedTags, name]);
    setTagDraft('');
  };

  return (
    <div className="w-[316px] max-w-[calc(100vw-24px)]">
      <div className="px-4 pb-2 pt-3 text-[14px] text-ink-3">{t('filterPriority')}</div>
      <div className="grid grid-cols-4 gap-2 border-b border-line px-4 pb-3">
        {PRIORITY_LEVELS.map((value) => (
          <button
            key={value}
            type="button"
            title={priorityLabel(value)}
            onClick={() => onPriority(value)}
            className={`flex h-11 items-center justify-center rounded-lg ${priority === value ? 'bg-tt-light' : 'hover:bg-hover'}`}
          >
            <Flag
              size={25}
              fill={value === 0 ? 'none' : PRIORITY_COLORS[value]}
              color={PRIORITY_COLORS[value]}
              strokeWidth={1.7}
            />
          </button>
        ))}
      </div>

      <div className="py-1">
        <OptionRow icon={<FolderOpen size={20} />} label={projectLabel} onClick={() => setExpanded(expanded === 'project' ? null : 'project')} />
        {expanded === 'project' && (
          <div className="mx-3 mb-1 max-h-40 overflow-y-auto rounded-lg bg-hover p-1">
            {projects.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onProject(item.id)}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-white"
              >
                <span className="truncate">{projectDisplayName(item, t)}</span>
                {item.id === projectId && <Check size={15} className="shrink-0 text-tt" />}
              </button>
            ))}
          </div>
        )}
        <OptionRow icon={<TagIcon size={20} />} label={t('filterTag')} onClick={() => setExpanded(expanded === 'tag' ? null : 'tag')} />
        {expanded === 'tag' && (
          <div className="mx-3 mb-1 rounded-lg bg-hover p-2">
            <div className="mb-1.5 flex flex-wrap gap-1">
              {selectedTags.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onTags(selectedTags.filter((item) => item !== name))}
                  className="rounded bg-tt-light px-1.5 py-0.5 text-[11px] text-tt"
                >
                  #{name} ×
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <div className="mb-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                {tags.map((tag) => (
                  <button
                    key={tag.name}
                    type="button"
                    onClick={() => onTags(selectedTags.includes(tag.name) ? selectedTags.filter((item) => item !== tag.name) : [...selectedTags, tag.name])}
                    className={`rounded border px-1.5 py-0.5 text-[11px] ${selectedTags.includes(tag.name) ? 'border-tt text-tt' : 'border-line text-ink-2'}`}
                  >
                    #{tag.label}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addTag();
              }}
            >
              <input
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                placeholder={t('addTag')}
                className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-[12px] outline-none focus:border-tt"
              />
            </form>
          </div>
        )}
        <DisabledOption icon={<Paperclip size={20} />} label={t('attachment')} title={t('notAvailableYet')} />
        <DisabledOption icon={<FileText size={20} />} label={t('fromTemplate')} title={t('notAvailableYet')} />
        <OptionRow
          icon={<FileText size={20} />}
          label={kind === 'NOTE' ? t('convertToTask') : t('convertToNote')}
          onClick={() => {
            onKind(kind === 'NOTE' ? 'TASK' : 'NOTE');
            close();
          }}
        />
      </div>

      <div className="border-t border-line py-1">
        <button
          type="button"
          onClick={() => onSmartParsing(!smartParsing)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover"
        >
          <Settings2 size={20} className="text-ink-3" />
          <span className="flex-1 text-[14px] text-ink-2">{t('inputSettings')}</span>
          <span className="text-[12px] text-ink-3">{smartParsing ? t('smartParsingOn') : t('smartParsingOff')}</span>
          <ChevronRight size={16} className="text-ink-3" />
        </button>
      </div>
    </div>
  );
}

function OptionRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-11 w-full items-center gap-3 px-4 text-left hover:bg-hover">
      <span className="text-ink-2">{icon}</span>
      <span className="flex-1 truncate text-[14px] text-ink">{label}</span>
      <ChevronRight size={16} className="text-ink-3" />
    </button>
  );
}

function DisabledOption({ icon, label, title }: { icon: ReactNode; label: string; title: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 text-ink-3" title={title}>
      <span>{icon}</span>
      <span className="text-[14px]">{label}</span>
    </div>
  );
}
