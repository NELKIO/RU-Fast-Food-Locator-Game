import { GPS_RULES } from './game.js';

const watchOptions = { enableHighAccuracy: true, maximumAge: 10_000, timeout: 18_000 };

// A stationary phone may stop emitting watch events. Ask once for a fresh measurement
// of each suspected jump; a stopped watch or a replaced candidate cannot supply evidence.
export function watchGps(geo, onReading, onError, initialCandidate = null) {
  let active = true, inFlight = false, pending = null, timer;

  function schedule() {
    clearTimeout(timer);
    if (!active || !pending || inFlight) return;
    const candidate = pending;
    timer = setTimeout(() => {
      inFlight = true;
      function finish(callback, value) {
        inFlight = false;
        if (!active) return;
        if (pending === candidate) callback(value);
        else schedule();
      }
      geo.getCurrentPosition(
        (position) => finish(receive, position),
        (error) => finish(fail, error),
        { ...watchOptions, maximumAge: 0 },
      );
    }, GPS_RULES.minConfirmationMs + 500);
  }

  function setCandidate(candidate) {
    if (pending === candidate) return;
    pending = candidate;
    schedule();
  }
  function receive(position) {
    if (active) setCandidate(onReading(position));
  }
  function fail(error) {
    if (active) onError(error);
  }
  const id = geo.watchPosition(receive, fail, watchOptions);
  if (initialCandidate) setCandidate(initialCandidate);
  return () => {
    active = false;
    clearTimeout(timer);
    geo.clearWatch(id);
  };
}
