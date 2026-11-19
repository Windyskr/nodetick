import { Loader2 } from 'lucide-react';

/** Placeholder while a lazily loaded page (or the session) is loading. */
export function PageSpinner() {
  return (
    <div className="flex h-full flex-1 items-center justify-center">
      <Loader2 size={22} className="animate-spin text-ink-3" />
    </div>
  );
}
