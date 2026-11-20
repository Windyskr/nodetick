import { useState, type ReactNode } from 'react';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import { useI18n, useT, useTF } from '../../../i18n';
import { projectDisplayName } from '../../../lib/project';
import {
  FIELD_KEYS,
  GROUP_KEYS,
  periodLabel,
  RANGE_KEYS,
  resolvePeriod,
  sameSummaryConfig,
  STATUS_KEYS,
  SUMMARY_FIELDS,
  SUMMARY_GROUPS,
  SUMMARY_RANGES,
  type SummaryConfig,
  type SummaryRange,
  type SummaryStatus,
  type SummaryTemplate,
} from '../../../lib/summary';
import { PRIORITY_LEVELS, priorityLabel } from '../../../components/RoundCheck';
import type { Project, Tag } from '../../../lib/types';
import { anchorOf, FloatingMenu, MenuHeading, MenuOption, SettingButton, Switch } from './ui';

type Anchor = ReturnType<typeof anchorOf>;
type MenuId = 'date' | 'list' | 'status' | 'more' | 'group' | 'fields';

/** TickTick lists the statuses in this order in its menu. */
const STATUS_MENU: SummaryStatus[] = ['completed', 'inProgress', 'open', 'wontDo'];

const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <div className="mb-2 flex items-center">
        <h2 className="text-[13px] font-semibold text-ink-2">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SettingsPanel({ config, onChange, templates, onApplyTemplate, onNewTemplate, onEditTemplate, onDeleteTemplate, projects, tags, today, onClose }: {
  config: SummaryConfig;
  onChange: (patch: Partial<SummaryConfig>) => void;
  templates: SummaryTemplate[];
  onApplyTemplate: (template: SummaryTemplate) => void;
  onNewTemplate: () => void;
  onEditTemplate: (template: SummaryTemplate) => void;
  onDeleteTemplate: (template: SummaryTemplate) => void;
  projects: Project[];
  tags: Tag[];
  today: string;
  /** Shown when the panel covers the summary (narrow windows). */
  onClose?: () => void;
}) {
  const t = useT();
  const f = useTF();
  const lang = useI18n((state) => state.lang);
  const [menu, setMenu] = useState<{ id: MenuId; anchor: Anchor } | null>(null);
  const [templateMenu, setTemplateMenu] = useState<{ template: SummaryTemplate; anchor: Anchor } | null>(null);
  const [customFrom, setCustomFrom] = useState(config.from ?? today);
  const [customTo, setCustomTo] = useState(config.to ?? today);
  const open = (id: MenuId) => (anchor: Anchor) => setMenu((current) => (current?.id === id ? null : { id, anchor }));
  const close = () => setMenu(null);

  const rangeText = (range: SummaryRange) => {
    const label = periodLabel(resolvePeriod({ range, from: config.from, to: config.to }, today), lang, today);
    return range === 'custom' ? label : `${t(RANGE_KEYS[range])} (${label})`;
  };
  const listProjects = projects.filter((project) => !project.closed || config.projectIds.includes(project.id));
  const listValue = config.projectIds.length === 0
    ? t('summaryAllLists')
    : config.projectIds.length === 1
      ? projectDisplayName(projects.find((project) => project.id === config.projectIds[0]), t, t('summaryAllLists'))
      : f('summarySelectedCount', config.projectIds.length);
  const statusValue = config.statuses.length === 0
    ? t('summaryAllStatus')
    : STATUS_MENU.filter((status) => config.statuses.includes(status)).map((status) => t(STATUS_KEYS[status])).join(lang === 'zh' ? '、' : ', ');
  const moreCount = config.priorities.length + config.tags.length;
  const moreValue = moreCount === 0 ? t('summaryNone') : f('summarySelectedCount', moreCount);

  return (
    <div className="flex h-full flex-col">
      {onClose && (
        <div className="flex h-12 shrink-0 items-center justify-end px-3">
          <button type="button" onClick={onClose} title={t('summaryHidePanel')} aria-label={t('summaryHidePanel')} className="rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={18} />
          </button>
        </div>
      )}
      <div className={`min-h-0 flex-1 overflow-y-auto px-4 pb-6 ${onClose ? '' : 'pt-5'}`}>
        <Section title={t('summaryTemplates')}>
          <div className="flex flex-wrap items-center gap-2">
            {templates.map((template) => {
              const active = sameSummaryConfig(template.config, config);
              return (
                <div
                  key={template.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setTemplateMenu({ template, anchor: { top: event.clientY, bottom: event.clientY, left: event.clientX, right: event.clientX } });
                  }}
                  className={`group flex h-7 max-w-[180px] items-center rounded-full pl-3 pr-1 text-[12.5px] ${active ? 'bg-tt-light text-tt' : 'bg-hover text-ink-2 hover:text-ink'}`}
                >
                  <button type="button" aria-pressed={active} onClick={() => onApplyTemplate(template)} className="min-w-0 truncate pr-1">
                    {template.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t('summaryTemplateActions')}: ${template.name}`}
                    title={t('summaryTemplateActions')}
                    onClick={(event) => setTemplateMenu({ template, anchor: anchorOf(event.currentTarget) })}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-60 hover:bg-black/5 hover:opacity-100 focus-visible:opacity-100"
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={onNewTemplate}
              title={t('summaryNewTemplate')}
              aria-label={t('summaryNewTemplate')}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-hover text-ink-3 hover:bg-tt-light hover:text-tt"
            >
              <Plus size={16} />
            </button>
          </div>
        </Section>

        <Section title={t('summaryFilterSettings')}>
          <div className="rounded-xl bg-[#fafafa] py-1">
            <SettingButton label={t('summaryDate')} value={rangeText(config.range)} expanded={menu?.id === 'date'} onOpen={open('date')} />
            <SettingButton label={t('summaryList')} value={listValue} expanded={menu?.id === 'list'} onOpen={open('list')} />
            <SettingButton label={t('summaryStatus')} value={statusValue} expanded={menu?.id === 'status'} onOpen={open('status')} />
            <SettingButton label={t('summaryMore')} value={moreValue} expanded={menu?.id === 'more'} onOpen={open('more')} />
          </div>
        </Section>

        <Section title={t('summaryDisplaySettings')}>
          <div className="rounded-xl bg-[#fafafa] py-1">
            <SettingButton label={t('summaryGroupBy')} value={t(GROUP_KEYS[config.groupBy])} expanded={menu?.id === 'group'} onOpen={open('group')} />
            <SettingButton label={t('summaryShowFields')} value={f('summaryFieldCount', config.fields.length)} expanded={menu?.id === 'fields'} onOpen={open('fields')} />
          </div>
        </Section>

        <div className="mt-5 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-ink-2">{t('summaryNextPeriod')}</h2>
          <Switch checked={config.nextPeriod} label={t('summaryNextPeriod')} onChange={(nextPeriod) => onChange({ nextPeriod })} />
        </div>
      </div>

      {menu?.id === 'date' && (
        <FloatingMenu anchor={menu.anchor} onClose={close} width={270} label={t('summaryDate')}>
          {SUMMARY_RANGES.filter((range) => range !== 'custom').map((range) => (
            <MenuOption
              key={range}
              label={t(RANGE_KEYS[range])}
              hint={periodLabel(resolvePeriod({ range, from: null, to: null }, today), lang, today)}
              checked={config.range === range}
              onClick={() => {
                onChange({ range, from: null, to: null });
                close();
              }}
            />
          ))}
          <div className="mt-1 border-t border-line px-3 pb-2 pt-2">
            <div className={`mb-1.5 text-[13px] ${config.range === 'custom' ? 'text-tt' : 'text-ink'}`}>{t('summaryRangeCustom')}</div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} aria-label={t('summaryRangeFrom')} className="min-w-0 rounded-md border border-line px-1.5 py-1 text-[12px]" />
              <input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} aria-label={t('summaryRangeTo')} className="min-w-0 rounded-md border border-line px-1.5 py-1 text-[12px]" />
            </div>
            <button
              type="button"
              disabled={!customFrom || !customTo || customTo < customFrom}
              onClick={() => {
                onChange({ range: 'custom', from: customFrom, to: customTo });
                close();
              }}
              className="mt-2 h-7 w-full rounded-md bg-tt text-[12.5px] text-white disabled:opacity-40"
            >
              {t('confirm')}
            </button>
          </div>
        </FloatingMenu>
      )}

      {menu?.id === 'list' && (
        <FloatingMenu anchor={menu.anchor} onClose={close} label={t('summaryList')}>
          <MenuOption label={t('summaryAllLists')} checked={config.projectIds.length === 0} onClick={() => onChange({ projectIds: [] })} />
          <div className="my-1 border-t border-line" />
          {listProjects.map((project) => (
            <MenuOption
              key={project.id}
              multi
              label={projectDisplayName(project, t)}
              checked={config.projectIds.includes(project.id)}
              onClick={() => onChange({ projectIds: toggle(config.projectIds, project.id) })}
            />
          ))}
        </FloatingMenu>
      )}

      {menu?.id === 'status' && (
        <FloatingMenu anchor={menu.anchor} onClose={close} width={200} label={t('summaryStatus')}>
          <MenuOption label={t('summaryAllStatus')} checked={config.statuses.length === 0} onClick={() => onChange({ statuses: [] })} />
          <div className="my-1 border-t border-line" />
          {STATUS_MENU.map((status) => (
            <MenuOption key={status} multi label={t(STATUS_KEYS[status])} checked={config.statuses.includes(status)} onClick={() => onChange({ statuses: toggle(config.statuses, status) })} />
          ))}
        </FloatingMenu>
      )}

      {menu?.id === 'more' && (
        <FloatingMenu anchor={menu.anchor} onClose={close} label={t('summaryMore')}>
          <MenuHeading>{t('summaryPriority')}</MenuHeading>
          <MenuOption label={t('summaryAllPriorities')} checked={config.priorities.length === 0} onClick={() => onChange({ priorities: [] })} />
          {PRIORITY_LEVELS.map((priority) => (
            <MenuOption key={priority} multi label={priorityLabel(priority)} checked={config.priorities.includes(priority)} onClick={() => onChange({ priorities: toggle(config.priorities, priority) })} />
          ))}
          <div className="my-1 border-t border-line" />
          <MenuHeading>{t('summaryTag')}</MenuHeading>
          <MenuOption label={t('summaryAllTags')} checked={config.tags.length === 0} onClick={() => onChange({ tags: [] })} />
          {tags.map((tag) => (
            <MenuOption key={tag.name} multi label={`#${tag.label || tag.name}`} checked={config.tags.includes(tag.name)} onClick={() => onChange({ tags: toggle(config.tags, tag.name) })} />
          ))}
        </FloatingMenu>
      )}

      {menu?.id === 'group' && (
        <FloatingMenu anchor={menu.anchor} onClose={close} width={200} label={t('summaryGroupBy')}>
          {SUMMARY_GROUPS.map((group) => (
            <MenuOption
              key={group}
              label={t(GROUP_KEYS[group])}
              checked={config.groupBy === group}
              onClick={() => {
                onChange({ groupBy: group });
                close();
              }}
            />
          ))}
        </FloatingMenu>
      )}

      {menu?.id === 'fields' && (
        <FloatingMenu anchor={menu.anchor} onClose={close} width={200} label={t('summaryShowFields')}>
          {SUMMARY_FIELDS.map((field) => (
            <MenuOption
              key={field}
              multi
              label={t(FIELD_KEYS[field])}
              checked={field === 'title' || config.fields.includes(field)}
              disabled={field === 'title'}
              onClick={() => onChange({ fields: SUMMARY_FIELDS.filter((item) => item === 'title' || (item === field ? !config.fields.includes(field) : config.fields.includes(item))) })}
            />
          ))}
        </FloatingMenu>
      )}

      {templateMenu && (
        <FloatingMenu anchor={templateMenu.anchor} onClose={() => setTemplateMenu(null)} width={140} align="left" label={t('summaryTemplateActions')}>
          <button type="button" role="menuitem" onClick={() => { onEditTemplate(templateMenu.template); setTemplateMenu(null); }} className="flex w-full px-3 py-[7px] text-left text-[13px] text-ink hover:bg-hover">
            {t('summaryEdit')}
          </button>
          <button type="button" role="menuitem" onClick={() => { onDeleteTemplate(templateMenu.template); setTemplateMenu(null); }} className="flex w-full px-3 py-[7px] text-left text-[13px] text-p-high hover:bg-hover">
            {t('delete')}
          </button>
        </FloatingMenu>
      )}
    </div>
  );
}
