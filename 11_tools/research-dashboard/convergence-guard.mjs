export function evaluateConvergence({ criteriaMet = false, userStopped = false, blocked = false, substantiveChange = true, stagnantRounds = 0, round = 0, maxRounds = null, directionExhausted = false } = {}) {
  if (criteriaMet) return { decision: 'stop', reason: 'acceptance criteria satisfied', complete: true };
  if (userStopped) return { decision: 'stop', reason: 'user interruption', complete: false };
  if (blocked) return { decision: 'stop', reason: 'contract or permission boundary blocked', complete: false };
  if (directionExhausted) return { decision: 'stop', reason: 'direction exhausted', complete: false };
  if (stagnantRounds >= 3) return { decision: 'stop', reason: 'continuous rounds without substantive change', complete: false };
  if (Number.isInteger(maxRounds) && maxRounds > 0 && round >= maxRounds) return { decision: 'stop', reason: 'resource round budget reached', complete: false };
  return { decision: 'continue', reason: substantiveChange ? 'work remains with substantive progress' : 'no substantive change observed; require explicit bounded direction change', complete: false };
}
