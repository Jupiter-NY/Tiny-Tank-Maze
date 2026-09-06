const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const clientSource = fs.readFileSync(path.join(root, 'multiplayer.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const referenceSource = fs.readFileSync(path.join(__dirname, 'fixtures/fog-visibility-6fb5db6.js'), 'utf8');

function functionsBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing geometry function boundaries: ${start}`);
  return source.slice(from, to);
}

function evaluator(functions) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`
    const BASE_VISION = 235;
    let wallSegments = [];
    ${functions}
    let intersectionCalls = 0;
    const originalIntersection = raySegmentIntersection;
    raySegmentIntersection = (...args) => {
      intersectionCalls++;
      return originalIntersection(...args);
    };
    globalThis.evaluate = (segments, self) => {
      wallSegments = segments;
      intersectionCalls = 0;
      const points = buildVisibilityPolygon(self);
      return { points, intersectionCalls };
    };
  `, sandbox, { filename: 'fog-geometry-under-test.js' });
  return (segments, self) => {
    const result = sandbox.evaluate(segments, self);
    // Copy cross-VM records without JSON rounding or dropping signed zero.
    return {
      points: Array.from(result.points, p => ({ x: p.x, y: p.y })),
      intersectionCalls: result.intersectionCalls,
    };
  };
}

const current = evaluator(functionsBetween(clientSource,
  '  function raySegmentIntersection(', '  function reportRenderError('));
const baseline = evaluator(referenceSource);

function removeAdjacentIdenticalPoints(points) {
  return points.filter((point, i) => i === 0 || point.x !== points[i - 1].x || point.y !== points[i - 1].y);
}

function compare(segments, self) {
  const before = baseline(segments, self);
  const after = current(segments, self);
  assert.deepEqual(removeAdjacentIdenticalPoints(after.points), removeAdjacentIdenticalPoints(before.points),
    'ordered polygon coordinates must match exactly; no epsilon or approximate-angle merging');
  assert.ok(after.intersectionCalls <= before.intersectionCalls);
  assert.equal(after.intersectionCalls, after.points.length * segments.length,
    'every retained ray still checks every wall segment');
  return { before, after };
}

function seededMaze(seed) {
  const sandbox = { seed };
  vm.createContext(sandbox);
  vm.runInContext(`
    const W=1152, H=768, COLS=18, ROWS=12, CELL=64, WALL=8;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    ${functionsBetween(serverSource, 'function generateMaze()', 'function circleRectCollision(')}
    globalThis.segments = buildWalls(generateMaze()).segments;
  `, sandbox);
  return Array.from(sandbox.segments, segment => Array.from(segment));
}

function rectangleSegments(x, y, width, height) {
  return [[x, y, x + width, y], [x + width, y, x + width, y + height],
    [x + width, y + height, x, y + height], [x, y + height, x, y]];
}

for (const seed of [1, 77, 2026]) {
  test(`fog polygon and occlusion coordinates are unchanged in seeded maze ${seed}`, () => {
    const segments = seededMaze(seed);
    let beforeCalls = 0, afterCalls = 0;
    for (const [x, y] of [[32, 32], [608, 416], [1120, 736], [22, 384]]) {
      for (const visionLeft of [0, 5]) {
        const { before, after } = compare(segments, { x, y, visionLeft });
        beforeCalls += before.intersectionCalls;
        afterCalls += after.intersectionCalls;
        assert.ok(after.points.length < before.points.length, 'repeated corner angles should produce fewer rays');
      }
    }
    assert.ok(afterCalls < beforeCalls, 'the optimization must reduce intersection work, not just discard results');
  });
}

test('corner-adjacent positions and map edges retain the exact baseline polygon', () => {
  const segments = [...rectangleSegments(0, 0, 1152, 768), ...rectangleSegments(100, 100, 8, 100)];
  for (const [x, y] of [[86, 86], [86, 110], [122, 86], [122.001, 110], [22, 22], [1130, 746]]) {
    compare(segments, { x, y, visionLeft: 0 });
    compare(segments, { x, y, visionLeft: 1 });
  }
});

test('nearby but nonidentical corner rays are preserved rather than angle-bucketed', () => {
  // Endpoint directions differ by much less than the +/-0.0008 corner offset.
  // An epsilon/bucket optimization would incorrectly drop their distinct points.
  const segments = [
    [200, 100, 200, 101],
    [200, 100.00001, 200, 101.00001],
    [200, 100, 200, 101], // Exact duplicate should still be removed.
  ];
  const { before, after } = compare(segments, { x: 100, y: 100, visionLeft: 0 });
  assert.equal(removeAdjacentIdenticalPoints(after.points).length, after.points.length);
  assert.ok(after.points.length > 240, 'distinct corner rays supplement the 240 base rays');
  assert.ok(after.intersectionCalls < before.intersectionCalls);
});

test('no-wall view, vision boost, and invalid viewer inputs retain baseline behavior', () => {
  for (const visionLeft of [0, 1, -1, '2', undefined]) {
    const { after } = compare([], { x: 32, y: 32, visionLeft });
    assert.equal(after.points.length, 240);
    assert.equal(after.intersectionCalls, 0);
  }
  const walls = rectangleSegments(0, 0, 1152, 768);
  for (const self of [null, undefined, {}, { x: NaN, y: 32 }, { x: 32, y: Infinity }, { x: '32', y: 32 }]) {
    const { after } = compare(walls, self);
    assert.deepEqual(after, { points: [], intersectionCalls: 0 });
  }
});

test('a new maze replaces old visibility geometry on successive calls', () => {
  const first = seededMaze(41), second = seededMaze(42);
  const self = { x: 32, y: 32, visionLeft: 0 };
  const a = compare(first, self).after;
  const b = compare(second, self).after;
  assert.notDeepEqual(a.points, b.points, 'the two generated layouts must exercise distinct geometry');
  assert.deepEqual(compare(first, self).after, a, 'no cached angles or wall geometry may leak across mazes');
});
