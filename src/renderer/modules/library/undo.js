// Simple undo stack for reversible library actions.
// Each entry is { type: string, undo: async () => void }.

const MAX_UNDO = 50;
const _stack = [];

export function pushUndo(action) {
  _stack.push(action);
  if (_stack.length > MAX_UNDO) _stack.shift();
}

export function popUndo() {
  return _stack.pop() || null;
}

export function clearUndo() {
  _stack.length = 0;
}
