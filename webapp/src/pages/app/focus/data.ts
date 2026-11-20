import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { parseInstant } from '../../../lib/date';
import type { Focus, FocusStats } from '../../../lib/types';
import { browserTimeZone } from './ui';

/** Focus data for the page, the stats view and the task detail. */

const statsCache = new Map<string, Promise<FocusStats>>();

/**
 * Stats for local days [from, to] (or all time with neither), cached per
 * records version: switching tabs back and forth does not refetch.
 */
export function loadFocusStats(query: { from?: string; to?: string; taskId?: string }, version: number): Promise<FocusStats> {
  const tz = browserTimeZone();
  const key = `${version}|${tz}|${query.from ?? ''}|${query.to ?? ''}|${query.taskId ?? ''}`;
  let request = statsCache.get(key);
  if (!request) {
    request = api.focusStats({ tz, ...query });
    request.catch(() => statsCache.delete(key));
    statsCache.set(key, request);
    // Keep the cache small; old versions are stale anyway.
    if (statsCache.size > 40) statsCache.delete(statsCache.keys().next().value as string);
  }
  return request;
}

/** Stats that keep the previous answer on screen while the next one loads. */
export function useFocusStats(query: { from?: string; to?: string; taskId?: string } | null, version: number) {
  const [data, setData] = useState<FocusStats | null>(null);
  const [loading, setLoading] = useState(query != null);
  const [failed, setFailed] = useState(false);
  const key = query ? `${query.from ?? ''}|${query.to ?? ''}|${query.taskId ?? ''}` : null;
  useEffect(() => {
    if (!query) return undefined;
    let alive = true;
    setLoading(true);
    loadFocusStats(query, version).then(
      (stats) => {
        if (!alive) return;
        setData(stats);
        setFailed(false);
        setLoading(false);
      },
      () => {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  return { data, loading, failed };
}

const PAGE = 50;
export const recordKey = (record: Focus) => `${record.type}:${record.id}`;
const instantOf = (record: Focus) => parseInstant(record.startTime) ?? 0;
const newestFirst = (a: Focus, b: Focus) => instantOf(b) - instantOf(a);

/**
 * The whole focus history, newest first, a page at a time. A new records
 * version reloads the first page and keeps the older pages already shown.
 */
export function useFocusHistory(version: number) {
  const [records, setRecords] = useState<Focus[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const busy = useRef(false);
  const state = useRef({ records, nextBefore });
  state.current = { records, nextBefore };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.focusHistory(null, PAGE).then(
      (page) => {
        if (!alive) return;
        const previous = state.current;
        let merged = page.records;
        let cursor = page.nextBefore;
        if (page.nextBefore && previous.records.length) {
          const boundary = parseInstant(page.nextBefore) ?? 0;
          const fresh = new Set(page.records.map(recordKey));
          const older = previous.records.filter((r) => instantOf(r) < boundary && !fresh.has(recordKey(r)));
          if (older.length) {
            merged = [...page.records, ...older];
            cursor = previous.nextBefore;
          }
        }
        setRecords(merged);
        setNextBefore(cursor);
        setFailed(false);
        setLoaded(true);
        setLoading(false);
      },
      () => {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [version]);

  const loadMore = useCallback(async () => {
    const { nextBefore: cursor } = state.current;
    if (busy.current || !cursor) return;
    busy.current = true;
    setLoading(true);
    try {
      let before: string | null = cursor;
      // A page may come back empty when many records share a few hours; keep going.
      for (let guard = 0; guard < 5 && before; guard++) {
        const page = await api.focusHistory(before, PAGE);
        before = page.nextBefore;
        if (page.records.length) {
          setRecords((current) => {
            const seen = new Set(current.map(recordKey));
            return [...current, ...page.records.filter((r) => !seen.has(recordKey(r)))];
          });
          break;
        }
      }
      setNextBefore(before);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  /** Show an edit at once (the server answered with the new record). */
  const upsert = useCallback((record: Focus) => {
    setRecords((current) => {
      const rest = current.filter((r) => recordKey(r) !== recordKey(record));
      const cursor = state.current.nextBefore ? parseInstant(state.current.nextBefore) : null;
      // Older than the loaded pages: it shows up when scrolling there.
      if (cursor != null && instantOf(record) < cursor) return rest;
      return [...rest, record].sort(newestFirst);
    });
  }, []);

  const remove = useCallback((record: Focus) => {
    setRecords((current) => current.filter((r) => recordKey(r) !== recordKey(record)));
  }, []);

  return { records, nextBefore, loading, failed, loaded, loadMore, upsert, remove };
}
