const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareReports } = require('./trip-agent');

function report(passes, snapshot = 'same') {
  return { protocol: 'v1', suiteHash: 'same', snapshotHash: snapshot, frozenDate: '2026-11-25', repeats: 2,
    cases: Object.entries(passes).map(([id, scores]) => ({ id, samples: scores.map(pass => ({ pass, latencyMs: 100 })) })) };
}

test('a new regression is not hidden by a gain on another case', () => {
  const diff = compareReports(report({ a:[true,true], b:[false,false] }), report({ a:[true,false], b:[true,true] }));
  assert.equal(diff.verdict,'mixed');
  assert.deepEqual(diff.improved,['b']);
  assert.deepEqual(diff.regressed,['a']);
});

test('equal scores do not imply improvement and unequal snapshots cannot be compared', () => {
  const same = report({a:[true,false]});
  assert.equal(compareReports(same,same).verdict,'no_detected_change');
  assert.throws(() => compareReports(same,report({a:[true,false]},'different')),/snapshotHash/);
});
