// Per-key work serializer: tasks submitted with the same key run one at a time,
// in submission order. Tasks with different keys run concurrently.
//
// Used to serialize per-Discord-thread processing so two messages arriving in
// the same thread within milliseconds can't both pass the "does a session
// already exist?" check and both create one (duplicate sessions).
export function createKeyedSerializer() {
  const tails = new Map(); // key -> tail Promise of that key's queue

  return function runExclusive(key, task) {
    const prev = tails.get(key) || Promise.resolve();
    // Run after the previous task settles, regardless of whether it resolved or threw.
    const run = prev.then(() => task(), () => task());
    // Store a never-rejecting tail so the next caller can safely chain off it.
    const tail = run.catch(() => {});
    tails.set(key, tail);
    // Drop the map entry once this task settles, unless a newer one queued behind it.
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return run;
  };
}
