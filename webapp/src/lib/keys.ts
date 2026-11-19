import type { KeyboardEvent } from 'react';

/**
 * An Enter press that should submit a text field. While an IME is composing
 * (Chinese, Japanese…), the Enter that confirms the candidate also reaches the
 * page as a keydown, flagged isComposing (keyCode 229 in Safari). Acting on it
 * submits the half-typed text and leaves the committed text in the field.
 */
export function isSubmitEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229;
}
