# Consumer Match Cadence

VIRA complements the football match instead of continuously competing for attention.

## Production contract

```text
observing
-> relevant football moment
-> answering (30 seconds)
-> tracking (up to 10 match minutes)
-> celebrating (up to 12 seconds)
-> cooldown (at least 4 match minutes)
-> observing
```

Market observations continue to feed editorial context and Market Watch, but do not create Consumer competitive rounds.

```env
VIRA_MARKET_ROUNDS_ENABLED=false
VIRA_FOOTBALL_ROUND_COOLDOWN_SEC=240
VIRA_FOOTBALL_ROUNDS_MAX=7
```

Market rounds remain available only through an explicit flag for internal tests and experimental sessions.

## Guardrails

- One main round at a time.
- Only football conditions in Consumer production.
- No next round directly after resolution.
- Cooldown uses authoritative match clock.
- No `team_scores` round across halftime or after 75:00.
- Maximum seven competitive football rounds per fixture.
- No candidate is preferable to a weak or repetitive candidate.

## Passive Market Watch

The room refreshes market context at most once per minute while observing. It has no answer buttons and does not replace the active football condition. Odds inform selection; score and match clock resolve the condition.
