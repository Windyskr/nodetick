import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import type { Task } from '../../lib/types';
import { useT } from '../../i18n';
import { TaskRow } from './TaskRow';

/** Full-task search over /open/v1/task/search (titles, descriptions, content). */
export default function SearchPage() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Task[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const keywords = query.trim();
    if (!keywords) {
      setResults(null);
      return;
    }
    setBusy(true);
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const found = await api.searchTasks(keywords);
        if (seq.current === id) setResults(found);
      } catch {
        if (seq.current === id) setResults([]);
      } finally {
        if (seq.current === id) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="px-5 pb-1 pt-4">
        <h1 className="text-[20px] font-bold">{t('searchTitle')}</h1>
      </div>
      <div className="mx-5 mb-2 mt-1 flex items-center gap-2 rounded-lg bg-hover px-3 py-[9px] transition-colors focus-within:bg-[#eef1f9]">
        <Search size={15} className="shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          value={query}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-3"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-16">
        {results === null ? (
          <div className="pt-16 text-center text-[13px] text-ink-3">{t('searchTooShort')}</div>
        ) : results.length === 0 ? (
          <div className="pt-16 text-center text-[13px] text-ink-3">
            {busy ? t('loading') : t('searchEmpty')}
          </div>
        ) : (
          results.map((task) => <TaskRow key={task.id} task={task} showProject />)
        )}
      </div>
    </div>
  );
}
