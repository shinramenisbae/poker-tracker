# Third-party data

`greenline.ts` is preflop range data adapted from **AHTOOOXA/poker-charts**
(https://github.com/AHTOOOXA/poker-charts), MIT License. Range values were
extracted by that project from public Greenline Poker study charts. Only the
data and a minimal type shim are vendored here; no source code is linked.

The push/fold ranges in `../pushfold.ts` are converted from **a1r93/push-or-fold**
(https://github.com/a1r93/push-or-fold), MIT License — a digitization of
Jennifear's public MTT push/fold chart. We use the no-ante (`ante0`) tables at
5/10/15/20bb for UTG (the source's B-3 seat), HJ, CO, BTN, and SB. Tokens like
`Ax+` were expanded into standard range notation; the conversion was verified
hand-class-for-hand-class against the source's own matching semantics.
