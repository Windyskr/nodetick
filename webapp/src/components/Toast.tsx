import { Undo2, X } from 'lucide-react';
import { useStore } from '../stores/store';
import { useTF } from '../i18n';

/** Bottom-center toast with an optional undo action (complete/delete/move). */
export default function Toast() {
  const toast = useStore((s) => s.toast);
  const dismissToast = useStore((s) => s.dismissToast);
  const f = useTF();
  if (!toast) return null;
  return (
    // A fixed dark pill: bg-ink turns near-white in the dark theme, which made
    // the white toast text unreadable.
    <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full bg-[#191919] px-5 py-2.5 text-[13px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.3)] ring-1 ring-white/10">
      <span>{f(toast.messageKey, toast.messageArg ?? '')}</span>
      {toast.undo && (
        <button
          type="button"
          className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium hover:bg-white/25"
          onClick={() => {
            toast.undo?.();
            dismissToast();
          }}
        >
          <Undo2 size={12} /> {f('undo')}
        </button>
      )}
      <button type="button" className="text-white/60 hover:text-white" onClick={dismissToast}>
        <X size={13} />
      </button>
    </div>
  );
}
