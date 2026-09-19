let controller: AbortController | null = null;

export function beginWork() {
  controller?.abort();
  controller = new AbortController();
  return controller;
}

export function cancelWork() {
  controller?.abort();
}

export function workSignal() {
  return controller?.signal;
}

export function isCancelled() {
  return Boolean(controller?.signal.aborted);
}
