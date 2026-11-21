// Ground truth from successful gameplay actions, independent of the representation in a save.
export function recordVisit(device, beforeVisits, result) {
  if (result.routeXp === undefined) return;
  const visited = Object.keys(result.profile.visits).find(id => result.profile.visits[id].count > (beforeVisits[id] ?? 0));
  (device.routeVisits ??= []).push([result.profile.daily.day, visited]);
  device.earned.xp -= result.routeXp;
}

export function routeBonus(devices) {
  const days = new Map();
  for (const device of devices) {
    for (const [day, id] of device.routeVisits ?? []) {
      if (!days.has(day)) days.set(day, new Set());
      days.get(day).add(id);
    }
  }
  return 25 * [...days.values()].filter(ids => ids.size >= 2).length;
}
