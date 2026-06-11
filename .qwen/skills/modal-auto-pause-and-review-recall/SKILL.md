---
name: modal-auto-pause-and-review-recall
description: Pause game progression while critical modals are open — block manual advanceDay, stop auto-advance interval, and allow dismissed reviews to be recalled
source: auto-skill
extracted_at: '2026-06-09T04:30:00.000Z'
---

## Problem this solves

When a time-based simulation has modals that require user action (quarterly reviews, event choices, critical decisions), auto-advance will tick through the modal before the user reads it. Similarly, dismissed decisions can't be revisited. The user needs:

1. **Auto-pause**: auto-advance stops while modal is open
2. **Manual block**: clicking "Advance Day" does nothing while modal is open
3. **Recall**: dismissed reviews/decisions can be re-opened

## Pattern: Two-layer pause

### Layer 1: Block advanceDay() at the source

```ts
advanceDay: () => {
  const state = get();
  if (state.gameOver || state.phase !== 'playing') return;
  // Block advance while review modal is open — must accept/dismiss first
  if (state.managerReviewOpen) return;
  // ... rest of advanceDay logic
}
```

**Why**: This blocks both manual clicks AND auto-advance interval calls from progressing the game. The guard is at the entry point, not the UI.

### Layer 2: Stop the auto-advance interval

```tsx
// In Dashboard.tsx
useEffect(() => {
  // Auto-pause when review modal is open
  if (autoAdvance && !gameOver && !managerReviewOpen) {
    autoAdvanceRef.current = setInterval(() => {
      advanceDay();
    }, autoAdvanceSpeed);
  }
  return () => {
    if (autoAdvanceRef.current) clearInterval(autoAdvanceRef.current);
  };
}, [autoAdvance, autoAdvanceSpeed, gameOver, managerReviewOpen, advanceDay]);
```

**Why both layers**: The interval guard (`!managerReviewOpen` in deps) stops the interval from even firing. The `advanceDay()` guard is a safety net — even if the interval fires, it returns immediately. This handles edge cases like the modal being opened between interval ticks.

**Dependency array must include `managerReviewOpen`** — otherwise the effect won't re-run when the modal opens/closes.

## Review recall pattern

### State

```ts
managerReviews: ManagerReview[];   // completed/dismissed reviews
managerReviewOpen: boolean;        // modal visible
pendingReview: ManagerReview | null;  // review waiting for action
```

### Recall action

```ts
recallReview: () => {
  const { managerReviews, pendingReview, managerReviewOpen } = get();
  if (pendingReview || managerReviewOpen || managerReviews.length === 0) return;
  const last = managerReviews[managerReviews.length - 1];
  set({
    pendingReview: last,
    managerReviewOpen: true,
    managerReviews: managerReviews.slice(0, -1),  // pop from history
  });
},
```

**Why**: Pops the last review off history and reopens it as pending. Guards prevent recalling while a review is already open.

### Dismiss action (moves to history)

```ts
dismissManagerReview: () => {
  const { pendingReview, managerReviews } = get();
  if (!pendingReview) return;
  set({
    managerReviews: [...managerReviews, pendingReview],  // push to history
    managerReviewOpen: false,
    pendingReview: null,
  });
},
```

### UI trigger

```tsx
// In Manager Report header — only show when history exists and no review is open
{managerReviews.length > 0 && !managerReviewOpen && (
  <button className="btn-tiny" onClick={recallReview} title="Recall last review">
    📋 Recall
  </button>
)}
```

## Primary action button pattern

The review modal must have a prominent "Accept & Continue" button that:
- Is the primary action (green/largest/first in the row)
- Dismisses the review (saves to history)
- Unblocks game progression

```tsx
<div className="research-actions review-actions">
  <button className="btn btn-primary btn-accept" onClick={dismissManagerReview}>
    ✓ Accept & Continue
  </button>
  <button className="btn btn-small" onClick={toggleReviewHistory}>📜 History</button>
  <button className="btn btn-small" onClick={() => { demoteStaff(manager?.id); dismissManagerReview(); }}>
    Demote Manager
  </button>
  <button className="btn btn-danger" onClick={() => { fireStaff(manager?.id); dismissManagerReview(); }}>
    Fire → Manual
  </button>
</div>
```

## What to watch out for

- **Modal must block both paths**: the action (advanceDay) AND the interval. One without the other is insufficient.
- **Effect deps must include the modal flag**: otherwise the interval won't restart when the modal closes.
- **Recall is a toggle**: it moves review from history → pending, not a copy. Once recalled, it's gone from history until dismissed again.
- **Guard recall when modal is open**: `if (pendingReview || managerReviewOpen)` prevents double-recall.
- **The accept button should be visually dominant**: use `btn-primary` with extra padding/size so it's clear it's the expected action.
- **Don't block advanceDay for history panel**: the history panel (`showReviewHistory`) is a view-only overlay — it shouldn't pause the game. Only `managerReviewOpen` (the actionable review) blocks.
