# Third-party data

`mtt60.ts` is preflop range data converted from **matthiola0/poker-hand-review**
(https://github.com/matthiola0/poker-hand-review), MIT License. We use its
`60bb+` stack-bucket charts (sourced from 100bb solves of 8-max MTT-with-ante
charts) for RFI, facing-an-open, and facing-a-3-bet, keeping the real per-hand
mixed action frequencies. 8-max seats are mapped to the trainer's 6-max seats
(the source's MP/LJ becomes UTG; the two earliest 8-max seats are dropped —
folded seats in front make the nodes equivalent). Ante MTT ranges run wider
than cash; the trainer presents spots as "MTT 6-max" and grades by frequency,
GTO-style rather than solver-authoritative.

The push/fold ranges in `../pushfold.ts` are converted from **a1r93/push-or-fold**
(https://github.com/a1r93/push-or-fold), MIT License — a digitization of
Jennifear's public MTT push/fold chart. We use the no-ante (`ante0`) tables at
5/10/15/20bb for UTG (the source's B-3 seat), HJ, CO, BTN, and SB. Tokens like
`Ax+` were expanded into standard range notation; the conversion was verified
hand-class-for-hand-class against the source's own matching semantics.

Historical note: earlier versions bundled pure-action study charts adapted from
**AHTOOOXA/poker-charts** (MIT, Greenline data). They were replaced by the
mixed-frequency dataset above (removed 2026-07-02; see git history).
