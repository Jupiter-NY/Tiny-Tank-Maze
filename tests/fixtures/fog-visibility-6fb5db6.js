// Frozen pre-optimization geometry from multiplayer.js at commit
// 6fb5db6160ab376210f7daa53aaf7083bde9e328 (client v5.8.1).
// Retain this reference algorithm unchanged when editing the current client.
// The test harness supplies BASE_VISION and wallSegments. No Git checkout
// history, browser, network, or third-party dependency is needed.

  function raySegmentIntersection(px, py, dx, dy, x1, y1, x2, y2) {
    const sx = x2 - x1;
    const sy = y2 - y1;
    const denominator = dx * sy - dy * sx;

    if (Math.abs(denominator) < 1e-9) return null;

    const qx = x1 - px;
    const qy = y1 - py;

    const t = (qx * sy - qy * sx) / denominator;
    const u = (qx * dy - qy * dx) / denominator;

    if (t < 0 || u < 0 || u > 1) return null;

    return {
      x: px + dx * t,
      y: py + dy * t,
      distance: t,
    };
  }

  function buildVisibilityPolygon(self) {
    if (
      !self ||
      !Number.isFinite(self.x) ||
      !Number.isFinite(self.y)
    ) {
      return [];
    }

    const radius =
      BASE_VISION * (Number(self.visionLeft) > 0 ? 1.55 : 1);

    const angles = [];
    const points = [];
    const baseRays = 240;

    for (let i = 0; i < baseRays; i++) {
      angles.push((i / baseRays) * Math.PI * 2);
    }

    // Add rays just to either side of every wall endpoint so corners block
    // light cleanly instead of leaving visible cracks.
    for (const segment of wallSegments) {
      const endpoints = [
        [segment[0], segment[1]],
        [segment[2], segment[3]],
      ];

      for (const [x, y] of endpoints) {
        const angle = Math.atan2(y - self.y, x - self.x);
        angles.push(angle - 0.0008, angle, angle + 0.0008);
      }
    }

    angles.sort((a, b) => a - b);

    for (const angle of angles) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let distance = radius;

      for (const segment of wallSegments) {
        const hit = raySegmentIntersection(
          self.x,
          self.y,
          dx,
          dy,
          segment[0],
          segment[1],
          segment[2],
          segment[3]
        );

        if (
          hit &&
          Number.isFinite(hit.distance) &&
          hit.distance < distance
        ) {
          distance = Math.max(0, hit.distance - 1.5);
        }
      }

      points.push({
        x: self.x + dx * distance,
        y: self.y + dy * distance,
      });
    }

    return points;
  }

