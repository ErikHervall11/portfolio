/*
 * The chase: a little platformer that lives behind the page.
 * A critter runs and jumps across a generated level, always trying to reach
 * the visitor's cursor. If the cursor holds still long enough to be caught,
 * the critter celebrates until it moves again.
 */
(() => {
  "use strict";

  const canvas = document.getElementById("chase-canvas");
  if (!canvas || !canvas.getContext) {
    return;
  }
  const ctx = canvas.getContext("2d");

  /* ---------- tuning ---------- */

  const GRAVITY = 2000; // px/s^2
  const JUMP_V = 760; // px/s
  const RUN = 235;
  const SPRINT = 335;
  const AIR = 260;
  const MAX_JUMP_H = (JUMP_V * JUMP_V) / (2 * GRAVITY); // ~144px
  const ROW_GAP = 106;
  const BODY_W = 24;
  const BODY_H = 26;
  const SCALE = 1.3; // drawn size of the critter
  const CENTER = (BODY_H * SCALE) / 2; // feet to middle of the body
  const CATCH_R = 40;
  const INSET = 14;
  const STEP = 1 / 120;
  const MAX_CRITTERS = 8;

  const CATCH_LINES = ["GOTCHA!", "MINE!", "TAG!", "YOINK", "GG", "NOM", "EZ", "WOO!", "+1"];
  const CONFETTI = ["#3fffd5", "#4aa8ff", "#8b6bff", "#ff6b9d", "#ffd166", "#ffffff"];
  const SKINS = [
    { body: "#3fffd5", shade: "#17b998" },
    { body: "#ff6b9d", shade: "#c93f73" },
    { body: "#ffd166", shade: "#d49a26" },
    { body: "#8b6bff", shade: "#5b3fd1" },
    { body: "#4aa8ff", shade: "#1f72c9" },
    { body: "#ff9f5a", shade: "#cf6a22" },
    { body: "#b8f55a", shade: "#7cb82a" },
    { body: "#f5f7ff", shade: "#aab4d4" },
  ];

  /* ---------- state ---------- */

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  let W = 0;
  let H = 0;
  let dpr = 1;
  let platforms = [];
  let ground = null;
  let edgesFrom = new Map();
  let critters = [];
  let particles = [];
  let running = !motionQuery.matches;
  let focus = false;
  let focusAmount = 0;
  let catches = 0;
  let clock = 0;
  let lastFrame = 0;
  let accumulator = 0;
  let rafId = 0;

  const pointer = { x: 0, y: 0, active: false, touch: false, lastSeen: 0 };

  try {
    catches = Number(window.localStorage.getItem("chase-catches")) || 0;
  } catch (error) {
    catches = 0;
  }

  /* ---------- level ---------- */

  const insetSpan = (plat) => {
    const lo = plat.x0 + INSET;
    const hi = plat.x1 - INSET;
    return lo <= hi ? [lo, hi] : [(plat.x0 + plat.x1) / 2, (plat.x0 + plat.x1) / 2];
  };

  // Time until a jump comes back down to a surface `rise` px above takeoff
  // (negative rise = surface below takeoff).
  const landTime = (rise) => {
    const disc = JUMP_V * JUMP_V - 2 * GRAVITY * rise;
    return disc < 0 ? 0 : (JUMP_V + Math.sqrt(disc)) / GRAVITY;
  };

  const subtractSpans = (spans, cutLo, cutHi) => {
    const out = [];
    spans.forEach(([lo, hi]) => {
      if (cutHi <= lo || cutLo >= hi) {
        out.push([lo, hi]);
        return;
      }
      if (cutLo > lo) {
        out.push([lo, cutLo]);
      }
      if (cutHi < hi) {
        out.push([cutHi, hi]);
      }
    });
    return out;
  };

  const buildGraph = (plats) => {
    const graph = new Map();
    plats.forEach((a) => {
      const list = [];
      plats.forEach((b) => {
        if (a === b) {
          return;
        }
        const rise = a.y - b.y; // > 0 when b is higher on screen
        if (rise > MAX_JUMP_H * 0.88) {
          return;
        }
        const lo = Math.max(a.x0, b.x0) + INSET;
        const hi = Math.min(a.x1, b.x1) - INSET;

        if (lo <= hi) {
          if (rise > 0) {
            // straight up through the one-way platform above
            list.push({ from: a, to: b, type: "jump", spans: [[lo, hi]], cost: 50 + rise * 0.6, failUntil: 0 });
          } else if (rise < 0) {
            // drop straight down, but only where nothing is in the way
            let spans = [[lo, hi]];
            plats.forEach((c) => {
              if (c !== a && c !== b && c.y > a.y && c.y < b.y) {
                spans = subtractSpans(spans, c.x0 - BODY_W, c.x1 + BODY_W);
              }
            });
            spans = spans.filter(([sLo, sHi]) => sHi - sLo >= 2);
            if (spans.length) {
              list.push({ from: a, to: b, type: "drop", spans, cost: 15 + -rise * 0.3, failUntil: 0 });
            }
          }
          return;
        }

        // leap across a gap
        const toRight = (b.x0 + b.x1) / 2 > (a.x0 + a.x1) / 2;
        const takeoff = toRight ? a.x1 - 6 : a.x0 + 6;
        const land = toRight ? b.x0 + INSET + 6 : b.x1 - INSET - 6;
        const dist = Math.abs(land - takeoff);
        const reach = AIR * landTime(rise) * 0.8;
        if (dist <= reach) {
          list.push({
            from: a,
            to: b,
            type: "jump",
            takeoff,
            land,
            cost: 60 + dist + Math.abs(rise) * 0.5,
            failUntil: 0,
          });
        }
      });
      graph.set(a, list);
    });
    return graph;
  };

  const buildLevelCandidate = () => {
    const groundY = H - 22;
    const floor = { x0: -4000, x1: W + 4000, y: groundY, isGround: true };
    let plats = [floor];

    const rows = Math.max(0, Math.floor((groundY - 96) / ROW_GAP));
    const narrow = W < 720;
    const maxWidth = Math.max(100, Math.min(260, W * 0.42));
    const maxGap = narrow ? 120 : 210;

    for (let row = 1; row <= rows; row += 1) {
      const rowY = groundY - row * ROW_GAP;
      let x = rand(-80, narrow ? 60 : 140);
      while (x < W - 70) {
        const width = rand(Math.min(110, maxWidth), maxWidth);
        const x0 = Math.max(10, x);
        const x1 = Math.min(W - 10, x + width);
        if (x1 - x0 >= 72 && (narrow || Math.random() > 0.1)) {
          plats.push({ x0, x1, y: Math.round(rowY + rand(-5, 5)), isGround: false });
        }
        x += width + rand(70, maxGap);
      }
    }

    // keep only what can be climbed to from the ground
    const graph = buildGraph(plats);
    const seen = new Set([floor]);
    const queue = [floor];
    while (queue.length) {
      const node = queue.shift();
      graph.get(node).forEach((edge) => {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          queue.push(edge.to);
        }
      });
    }
    plats = plats.filter((plat) => seen.has(plat));
    return { floor, plats };
  };

  const generateLevel = () => {
    // roll a few layouts and keep the one with the most climbable platforms
    let best = buildLevelCandidate();
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const candidate = buildLevelCandidate();
      if (candidate.plats.length > best.plats.length) {
        best = candidate;
      }
    }
    ground = best.floor;
    platforms = best.plats;
    edgesFrom = buildGraph(platforms);
  };

  /* ---------- pathfinding ---------- */

  const nearestInSpans = (spans, x) => {
    let best = spans[0][0];
    let bestDist = Infinity;
    spans.forEach(([lo, hi]) => {
      const candidate = clamp(x, lo, hi);
      const dist = Math.abs(candidate - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    });
    return best;
  };

  const takeoffFor = (edge, fromX, hintX) => {
    if (edge.spans) {
      // lean toward where we are ultimately heading, but never far out of the way
      const aim = hintX === undefined ? fromX : clamp(hintX, fromX - 160, fromX + 160);
      return nearestInSpans(edge.spans, aim);
    }
    return edge.takeoff;
  };

  // Dijkstra over platforms. Each node remembers the x it is entered at so
  // walking distance along a platform is part of the cost.
  const findRoute = (startPlat, startX, goalPlat, goalX) => {
    const dist = new Map([[startPlat, 0]]);
    const enterX = new Map([[startPlat, startX]]);
    const firstEdge = new Map();
    const done = new Set();

    for (;;) {
      let current = null;
      let best = Infinity;
      dist.forEach((value, plat) => {
        if (!done.has(plat) && value < best) {
          best = value;
          current = plat;
        }
      });
      if (!current) {
        return null;
      }
      if (current === goalPlat) {
        return firstEdge.get(current) || null;
      }
      done.add(current);

      const x = enterX.get(current);
      (edgesFrom.get(current) || []).forEach((edge) => {
        if (done.has(edge.to)) {
          return;
        }
        const takeoff = takeoffFor(edge, x, goalX);
        const land = edge.spans ? takeoff : edge.land;
        const penalty = edge.failUntil > clock ? 1500 : 0;
        const total = best + Math.abs(takeoff - x) + edge.cost + penalty;
        if (total < (dist.has(edge.to) ? dist.get(edge.to) : Infinity)) {
          dist.set(edge.to, total);
          enterX.set(edge.to, land);
          firstEdge.set(edge.to, firstEdge.get(current) || edge);
        }
      });
    }
  };

  // The best place to stand to reach a point: a platform at or below it,
  // as close as possible.
  const pickGoal = (tx, ty) => {
    let bestPlat = ground;
    let bestScore = Infinity;
    let bestX = tx;
    platforms.forEach((plat) => {
      if (plat.y < ty - 8 && !plat.isGround) {
        return;
      }
      const [lo, hi] = plat.isGround ? [BODY_W, W - BODY_W] : insetSpan(plat);
      const x = clamp(tx, lo, hi);
      const score = Math.max(0, plat.y - ty) + Math.abs(x - tx) * 1.4;
      if (score < bestScore) {
        bestScore = score;
        bestPlat = plat;
        bestX = x;
      }
    });
    return { plat: bestPlat, x: bestX };
  };

  /* ---------- particles ---------- */

  const dust = (x, y, count, spread) => {
    for (let i = 0; i < count; i += 1) {
      particles.push({
        kind: "dust",
        x: x + rand(-6, 6),
        y,
        vx: rand(-spread, spread),
        vy: rand(-50, -5),
        life: rand(0.25, 0.5),
        age: 0,
        size: rand(2, 4.5),
      });
    }
  };

  const confetti = (x, y, count) => {
    for (let i = 0; i < count; i += 1) {
      const angle = rand(-Math.PI, 0);
      const speed = rand(140, 520);
      particles.push({
        kind: "confetti",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        life: rand(0.9, 1.7),
        age: 0,
        size: rand(3, 6),
        spin: rand(-12, 12),
        rot: rand(0, Math.PI * 2),
        color: pick(CONFETTI),
      });
    }
  };

  /* ---------- critters ---------- */

  const makeCritter = (index) => {
    const skin = SKINS[index % SKINS.length];
    return {
      skin,
      x: clamp(rand(W * 0.15, W * 0.85), 30, Math.max(31, W - 30)),
      y: index === 0 ? ground.y : -20 - index * 30,
      vx: 0,
      vy: 0,
      plat: index === 0 ? ground : null,
      facing: 1,
      mode: "chase",
      speedScale: index === 0 ? 1 : rand(0.86, 1.08),
      edge: null,
      pendingEdge: null,
      walkTo: null,
      airTargetX: null,
      thinkIn: rand(0, 0.1),
      hopCooldown: 0,
      hopMisses: 0,
      catchPoint: null,
      celebrateT: 0,
      wander: null,
      wanderWait: 0,
      squash: 0,
      runPhase: rand(0, 6),
      blinkIn: rand(1, 4),
      blinkT: 0,
      antenna: 0,
      bubble: null,
      lookX: 0,
      lookY: 0,
    };
  };

  const say = (critter, text, seconds) => {
    critter.bubble = { text, t: seconds || 1.3, total: seconds || 1.3 };
  };

  const resetCritters = (count) => {
    critters = [];
    for (let i = 0; i < count; i += 1) {
      critters.push(makeCritter(i));
    }
  };

  const currentTarget = (critter) => {
    if (pointer.active) {
      return { x: pointer.x, y: pointer.y, real: true };
    }
    if (!critter.wander) {
      const plat = pick(platforms);
      const [lo, hi] = plat.isGround ? [BODY_W, Math.max(BODY_W, W - BODY_W)] : insetSpan(plat);
      critter.wander = { x: rand(lo, hi), y: plat.y - CENTER };
    }
    return { x: critter.wander.x, y: critter.wander.y, real: false };
  };

  const startCelebration = (critter) => {
    critter.mode = "celebrate";
    critter.catchPoint = { x: pointer.x, y: pointer.y };
    critter.celebrateT = 0;
    critter.edge = null;
    critter.pendingEdge = null;
    critter.walkTo = null;
    critter.airTargetX = null;
    critter.hopMisses = 0;
    say(critter, pick(CATCH_LINES), 1.5);
    confetti(critter.x, critter.y - BODY_H * SCALE, 42);

    catches += 1;
    try {
      window.localStorage.setItem("chase-catches", String(catches));
    } catch (error) {
      /* storage is optional */
    }
    updateHud();
    if (catches === 1) {
      toast("Achievement unlocked", "You got caught. It is very proud of itself.");
    } else if (catches === 10) {
      toast("Achievement unlocked", "Caught 10 times. You're letting it win, aren't you?");
    } else if (catches === 50) {
      toast("Achievement unlocked", "50 catches. This is a full-time job now.");
    }
  };

  const launch = (critter, edge) => {
    critter.pendingEdge = edge;
    critter.edge = null;
    critter.walkTo = null;
    critter.plat = null;
    if (edge.type === "drop") {
      critter.y += 2;
      critter.vy = 90;
      critter.airTargetX = critter.x;
    } else {
      critter.vy = -JUMP_V;
      critter.airTargetX = edge.spans ? critter.x : edge.land;
      critter.squash = -0.28;
      dust(critter.x, critter.y, 4, 60);
    }
  };

  const think = (critter, target) => {
    const goal = pickGoal(target.x, target.y);
    if (goal.plat === critter.plat) {
      critter.edge = null;
      critter.walkTo = goal.x;
      return;
    }
    const edge = findRoute(critter.plat, critter.x, goal.plat, goal.x);
    if (!edge) {
      critter.edge = null;
      critter.walkTo = critter.x;
      return;
    }
    critter.edge = edge;
    critter.walkTo = takeoffFor(edge, critter.x, goal.x);
  };

  const arriveAtGoal = (critter, target) => {
    if (!target.real) {
      // wandering: hang out for a moment, then pick somewhere new
      critter.wanderWait += STEP;
      if (critter.wanderWait > 1.2 + critter.speedScale) {
        critter.wander = null;
        critter.wanderWait = 0;
      }
      return;
    }
    if (critter.hopCooldown > 0) {
      return;
    }
    // the cursor is overhead (or just out of reach): jump for it
    const centerY = critter.y - CENTER;
    const need = centerY - target.y;
    const boost = clamp(need + 14, 46, MAX_JUMP_H);
    critter.vy = -Math.sqrt(2 * GRAVITY * boost);
    critter.plat = null;
    critter.pendingEdge = null;
    critter.squash = -0.25;
    critter.airTargetX = Math.abs(target.x - critter.x) < 120 ? target.x : critter.x;
    critter.hopCooldown = rand(0.35, 0.8);
    critter.hopMisses += 1;
    if (critter.hopMisses === 4) {
      say(critter, pick(["?", "HEY!", "COME ON", "..."]), 1.1);
    }
    dust(critter.x, critter.y, 3, 50);
  };

  const land = (critter, plat, impactSpeed) => {
    critter.y = plat.y;
    critter.vy = 0;
    critter.plat = plat;
    critter.airTargetX = null;
    critter.squash = clamp(impactSpeed / 2600, 0.08, 0.34);
    if (impactSpeed > 260) {
      dust(critter.x, plat.y, 5, 90);
    }
    if (critter.pendingEdge && critter.pendingEdge.to !== plat) {
      // that route did not work out; avoid it for a while
      critter.pendingEdge.failUntil = clock + 6;
    }
    critter.pendingEdge = null;
    critter.thinkIn = 0;
  };

  const stepCritter = (critter) => {
    const target = currentTarget(critter);
    critter.hopCooldown = Math.max(0, critter.hopCooldown - STEP);

    /* --- decide --- */
    if (critter.mode === "celebrate") {
      critter.celebrateT += STEP;
      const moved =
        !pointer.active ||
        Math.hypot(pointer.x - critter.catchPoint.x, pointer.y - critter.catchPoint.y) > 12;
      if (moved) {
        critter.mode = "chase";
        critter.thinkIn = 0.12;
        critter.hopCooldown = 0.3;
        if (Math.random() < 0.35) {
          say(critter, pick(["HEY!", "AGAIN!", "WAIT", "!"]), 0.9);
        }
      } else if (critter.plat) {
        critter.vx = 0;
        if (critter.hopCooldown <= 0) {
          critter.vy = -rand(330, 470);
          critter.plat = null;
          critter.squash = -0.2;
          critter.hopCooldown = 0.5;
          if (Math.random() < 0.3) {
            confetti(critter.x, critter.y - BODY_H * SCALE, 10);
          }
        }
      }
    } else if (critter.plat) {
      critter.thinkIn -= STEP;
      if (critter.thinkIn <= 0) {
        think(critter, target);
        critter.thinkIn = 0.07;
      }
      const dx = critter.walkTo === null ? 0 : critter.walkTo - critter.x;
      const far = Math.hypot(target.x - critter.x, target.y - critter.y) > 380;
      const speed = (target.real ? (far ? SPRINT : RUN) : RUN * 0.6) * critter.speedScale;
      if (Math.abs(dx) > speed * STEP) {
        critter.vx = Math.sign(dx) * speed;
        critter.wanderWait = 0;
      } else {
        critter.x += dx;
        critter.vx = 0;
        if (critter.edge) {
          launch(critter, critter.edge);
        } else {
          arriveAtGoal(critter, target);
        }
      }
    } else {
      // airborne: steer toward where we mean to come down
      if (critter.airTargetX !== null && critter.mode !== "celebrate") {
        const dx = critter.airTargetX - critter.x;
        const air = AIR * critter.speedScale;
        if (Math.abs(dx) > air * STEP) {
          critter.vx = Math.sign(dx) * air;
        } else {
          critter.x += dx;
          critter.vx = 0;
        }
      } else {
        critter.vx *= 0.96;
      }
    }

    /* --- move --- */
    const prevY = critter.y;
    critter.x = clamp(critter.x + critter.vx * STEP, BODY_W / 2, Math.max(BODY_W / 2, W - BODY_W / 2));
    if (Math.abs(critter.vx) > 1) {
      critter.facing = Math.sign(critter.vx);
    }

    if (critter.plat) {
      const plat = critter.plat;
      critter.runPhase += Math.abs(critter.vx) * STEP * 0.085;
      if (Math.abs(critter.vx) > SPRINT * 0.9 && Math.random() < 0.06) {
        dust(critter.x - critter.facing * 8, critter.y, 1, 30);
      }
      if (!plat.isGround && (critter.x < plat.x0 - 2 || critter.x > plat.x1 + 2)) {
        critter.plat = null; // walked off the edge
      }
    } else {
      critter.vy = Math.min(critter.vy + GRAVITY * STEP, 1500);
      critter.y += critter.vy * STEP;
      if (critter.vy >= 0) {
        for (let i = 0; i < platforms.length; i += 1) {
          const plat = platforms[i];
          if (
            prevY <= plat.y &&
            critter.y >= plat.y &&
            critter.x >= plat.x0 - 3 &&
            critter.x <= plat.x1 + 3
          ) {
            land(critter, plat, critter.vy);
            break;
          }
        }
      }
      if (critter.y > H + 200) {
        // safety net: should never happen, the ground spans everything
        critter.y = ground.y;
        critter.vy = 0;
        critter.plat = ground;
      }
    }

    /* --- caught? --- */
    if (target.real && critter.mode === "chase") {
      const reach = Math.hypot(critter.x - target.x, critter.y - CENTER - target.y);
      if (reach < CATCH_R) {
        startCelebration(critter);
      }
    }

    /* --- little animation springs --- */
    critter.squash += (0 - critter.squash) * Math.min(1, STEP * 14);
    critter.antenna += (-critter.vx * 0.016 - critter.antenna) * Math.min(1, STEP * 9);
    const lookDx = target.x - critter.x;
    const lookDy = target.y - (critter.y - BODY_H * SCALE * 0.7);
    const lookLen = Math.hypot(lookDx, lookDy) || 1;
    critter.lookX += ((lookDx / lookLen) * 2.2 - critter.lookX) * Math.min(1, STEP * 12);
    critter.lookY += ((lookDy / lookLen) * 1.8 - critter.lookY) * Math.min(1, STEP * 12);
    critter.blinkIn -= STEP;
    if (critter.blinkIn <= 0) {
      critter.blinkT = 0.12;
      critter.blinkIn = rand(1.8, 5);
    }
    critter.blinkT = Math.max(0, critter.blinkT - STEP);
    if (critter.bubble) {
      critter.bubble.t -= STEP;
      if (critter.bubble.t <= 0) {
        critter.bubble = null;
      }
    }
  };

  const stepParticles = () => {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.age += STEP;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      if (p.kind === "confetti") {
        p.vy += 900 * STEP;
        p.vx *= 0.992;
        p.rot += p.spin * STEP;
      } else {
        p.vy += 60 * STEP;
        p.vx *= 0.95;
      }
      p.x += p.vx * STEP;
      p.y += p.vy * STEP;
    }
  };

  /* ---------- drawing ---------- */

  const roundRect = (x, y, w, h, r) => {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  };

  const drawLevel = () => {
    const alpha = 0.2 + focusAmount * 0.5;

    // ground
    ctx.fillStyle = `rgba(92, 110, 220, ${alpha * 0.45})`;
    ctx.fillRect(0, ground.y, W, H - ground.y);
    ctx.fillStyle = `rgba(63, 255, 213, ${alpha * 0.9})`;
    ctx.fillRect(0, ground.y, W, 2);
    ctx.fillStyle = `rgba(63, 255, 213, ${alpha * 0.35})`;
    for (let x = 14; x < W; x += 46) {
      ctx.fillRect(x, ground.y + 8, 14, 3);
    }

    platforms.forEach((plat) => {
      if (plat.isGround) {
        return;
      }
      const w = plat.x1 - plat.x0;
      ctx.fillStyle = `rgba(120, 132, 255, ${alpha * 0.75})`;
      roundRect(plat.x0, plat.y, w, 11, 3);
      ctx.fill();
      ctx.fillStyle = `rgba(63, 255, 213, ${Math.min(1, alpha * 1.5)})`;
      ctx.fillRect(plat.x0 + 2, plat.y, w - 4, 2);
      ctx.fillStyle = `rgba(10, 15, 31, ${alpha * 0.8})`;
      for (let x = plat.x0 + 10; x < plat.x1 - 8; x += 22) {
        ctx.fillRect(x, plat.y + 5, 3, 3);
      }
    });
  };

  const drawParticles = () => {
    particles.forEach((p) => {
      const fade = 1 - p.age / p.life;
      if (p.kind === "confetti") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, fade * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.globalAlpha = fade * 0.5;
        ctx.fillStyle = "#b9c8f5";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.4 - fade * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  };

  const drawCritter = (critter) => {
    const celebrating = critter.mode === "celebrate";
    const airborne = !critter.plat;
    const moving = Math.abs(critter.vx) > 5 && !airborne;
    const outline = "#071320";
    const bodyH = BODY_H - 5;
    const half = BODY_W / 2;

    // ground shadow
    if (!airborne) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
      ctx.beginPath();
      ctx.ellipse(critter.x, critter.y + 2, half * SCALE * (1 + critter.squash), 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(critter.x, critter.y);
    let stretch = critter.squash;
    if (airborne) {
      stretch -= clamp(Math.abs(critter.vy) / 5200, 0, 0.16);
    }
    if (celebrating && airborne) {
      ctx.rotate(Math.sin(critter.celebrateT * 14) * 0.22);
    }
    ctx.scale(SCALE * (1 + stretch), SCALE * (1 - stretch));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // legs
    const swing = moving ? Math.sin(critter.runPhase * Math.PI * 2) : 0;
    ctx.fillStyle = outline;
    const legLift = airborne ? -2 : 0;
    ctx.fillRect(-7, -6 + Math.max(0, swing) * -3 + legLift, 5, 6);
    ctx.fillRect(2, -6 + Math.max(0, -swing) * -3 + legLift, 5, 6);

    // arms
    ctx.strokeStyle = outline;
    ctx.lineWidth = 3;
    const armY = -bodyH * 0.5 - 3;
    let armDrop = 6;
    let armOut = 4;
    if (celebrating) {
      armDrop = -9 + Math.sin(critter.celebrateT * 18) * 2;
      armOut = 6;
    } else if (airborne) {
      armDrop = critter.vy < 0 ? -7 : -3;
      armOut = 6;
    } else if (moving) {
      armDrop = 5 + swing * 3;
    }
    ctx.beginPath();
    ctx.moveTo(-half + 1, armY);
    ctx.lineTo(-half - armOut, armY + armDrop);
    ctx.moveTo(half - 1, armY);
    ctx.lineTo(half + armOut, armY + (moving ? 10 - armDrop : armDrop));
    ctx.stroke();

    // antenna
    ctx.lineWidth = 2;
    const tipX = critter.antenna + (celebrating ? Math.sin(critter.celebrateT * 20) * 3 : 0);
    ctx.beginPath();
    ctx.moveTo(0, -bodyH - 4);
    ctx.quadraticCurveTo(tipX * 0.4, -bodyH - 10, tipX, -bodyH - 13);
    ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(tipX, -bodyH - 14, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // body
    const bob = moving ? Math.abs(swing) * -1.5 : 0;
    ctx.translate(0, bob);
    roundRect(-half, -bodyH - 5, BODY_W, bodyH, 10);
    ctx.fillStyle = critter.skin.body;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = outline;
    ctx.stroke();
    // belly shade
    ctx.save();
    roundRect(-half, -bodyH - 5, BODY_W, bodyH, 10);
    ctx.clip();
    ctx.fillStyle = critter.skin.shade;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(-half, -10, BODY_W, 8);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-half + 4, -bodyH - 3, 6, 3);
    ctx.restore();

    // face
    const eyeY = -bodyH + 3;
    const faceShift = critter.facing * 1.5;
    if (celebrating) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = outline;
      ctx.beginPath();
      ctx.arc(-5 + faceShift, eyeY + 1, 3, Math.PI * 1.1, Math.PI * 1.9);
      ctx.moveTo(8 + faceShift, eyeY);
      ctx.arc(5 + faceShift, eyeY + 1, 3, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.fillStyle = outline;
      ctx.beginPath();
      ctx.arc(faceShift, eyeY + 6, 4, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = "#ff6b9d";
      ctx.fillRect(faceShift - 2, eyeY + 8, 4, 2);
    } else {
      const open = critter.blinkT > 0 ? 0.12 : 1;
      [-5, 5].forEach((ex) => {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.ellipse(ex + faceShift, eyeY, 4.4, 4.8 * open, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = outline;
        ctx.stroke();
        if (open === 1) {
          ctx.fillStyle = outline;
          ctx.beginPath();
          ctx.arc(ex + faceShift + critter.lookX, eyeY + critter.lookY, 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      if (airborne) {
        ctx.arc(faceShift, eyeY + 8, 2, 0, Math.PI * 2);
      } else {
        ctx.arc(faceShift, eyeY + 6, 3, Math.PI * 0.15, Math.PI * 0.85);
      }
      ctx.stroke();
    }
    ctx.restore();

    // speech bubble
    if (critter.bubble) {
      const bubble = critter.bubble;
      const pop = Math.min(1, (bubble.total - bubble.t) / 0.12);
      const fade = Math.min(1, bubble.t / 0.2);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const width = ctx.measureText(bubble.text).width + 14;
      const bx = clamp(critter.x, width / 2 + 6, W - width / 2 - 6);
      const by = critter.y - BODY_H * SCALE - 34 + (1 - pop) * 8;
      ctx.translate(bx, by);
      ctx.scale(pop, pop);
      roundRect(-width / 2, -10, width, 20, 4);
      ctx.fillStyle = "#f5f7ff";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, 9);
      ctx.lineTo(0, 15);
      ctx.lineTo(4, 9);
      ctx.fill();
      ctx.fillStyle = "#071320";
      ctx.fillText(bubble.text, 0, 1);
      ctx.restore();
    }
  };

  const drawPointerMarker = () => {
    if (focusAmount < 0.05 || !pointer.active) {
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(clock * 5);
    ctx.save();
    ctx.globalAlpha = focusAmount * 0.8;
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -clock * 18;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 15 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawLevel();
    drawPointerMarker();
    critters.forEach(drawCritter);
    drawParticles();
  };

  /* ---------- loop ---------- */

  const frame = (now) => {
    rafId = 0;
    const elapsed = Math.min(0.1, (now - lastFrame) / 1000 || 0);
    lastFrame = now;

    focusAmount += ((focus ? 1 : 0) - focusAmount) * Math.min(1, elapsed * 8);

    if (pointer.active && pointer.touch && now - pointer.lastSeen > 6000) {
      pointer.active = false; // a tap is not a hover: let it wander again
    }

    if (running) {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= STEP && steps < 14) {
        clock += STEP;
        critters.forEach(stepCritter);
        stepParticles();
        accumulator -= STEP;
        steps += 1;
      }
      if (steps === 14) {
        accumulator = 0;
      }
    }

    draw();

    const settling = Math.abs((focus ? 1 : 0) - focusAmount) > 0.01;
    if ((running || settling) && !document.hidden) {
      rafId = window.requestAnimationFrame(frame);
    }
  };

  const wake = () => {
    if (!rafId && !document.hidden) {
      lastFrame = performance.now();
      rafId = window.requestAnimationFrame(frame);
    }
  };

  /* ---------- sizing ---------- */

  const resize = (force) => {
    const newW = window.innerWidth;
    const newH = window.innerHeight;
    const bigChange = force || !ground || newW !== W || Math.abs(newH - H) > 140;
    const deltaH = newH - H;

    W = newW;
    H = newH;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    if (bigChange) {
      generateLevel();
      resetCritters(Math.max(1, critters.length));
    } else if (deltaH !== 0) {
      // mobile browser chrome sliding in or out: keep the level, move it with the floor
      platforms.forEach((plat) => {
        plat.y += deltaH;
      });
      critters.forEach((critter) => {
        critter.y += deltaH;
      });
    }
    draw();
    wake();
  };

  /* ---------- page UI ---------- */

  const toast = (title, text) => {
    if (typeof window.siteToast === "function") {
      window.siteToast(title, text);
    }
  };

  const focusButtons = document.querySelectorAll("[data-chase-focus]");
  const pauseButton = document.querySelector("[data-chase-pause]");
  const friendButton = document.querySelector("[data-chase-friend]");
  const levelButton = document.querySelector("[data-chase-level]");
  const catchCounters = document.querySelectorAll("[data-chase-catches]");
  const pageRegions = document.querySelectorAll("[data-page-region]");

  function updateHud() {
    catchCounters.forEach((node) => {
      node.textContent = String(catches).padStart(3, "0");
    });
    document.body.classList.toggle("has-catches", catches > 0);
  }

  const setRunning = (value) => {
    running = value;
    if (pauseButton) {
      pauseButton.setAttribute("aria-pressed", String(!running));
      pauseButton.setAttribute("aria-label", running ? "Pause the background critter" : "Resume the background critter");
      pauseButton.classList.toggle("is-paused", !running);
    }
    wake();
  };

  const setFocus = (value) => {
    focus = value;
    document.body.classList.toggle("is-chase-focus", focus);
    pageRegions.forEach((region) => {
      if (focus) {
        region.setAttribute("inert", "");
      } else {
        region.removeAttribute("inert");
      }
    });
    focusButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(focus));
      const label = button.querySelector("[data-label]");
      if (label) {
        label.textContent = focus ? label.dataset.on : label.dataset.off;
      }
    });
    if (focus && !running) {
      setRunning(true);
    }
    wake();
  };

  const addFriend = () => {
    if (critters.length >= MAX_CRITTERS) {
      toast("Party is full", `${MAX_CRITTERS} is plenty.`);
      return false;
    }
    critters.push(makeCritter(critters.length));
    wake();
    return true;
  };

  focusButtons.forEach((button) => {
    button.addEventListener("click", () => setFocus(!focus));
  });
  if (pauseButton) {
    pauseButton.addEventListener("click", () => setRunning(!running));
  }
  if (friendButton) {
    friendButton.addEventListener("click", addFriend);
  }
  if (levelButton) {
    levelButton.addEventListener("click", () => resize(true));
  }

  // Up Up Down Down Left Right Left Right B A
  const CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let codeIndex = 0;
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && focus) {
      setFocus(false);
      return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    codeIndex = key === CODE[codeIndex] ? codeIndex + 1 : key === CODE[0] ? 1 : 0;
    if (codeIndex === CODE.length) {
      codeIndex = 0;
      let added = 0;
      while (critters.length < MAX_CRITTERS) {
        critters.push(makeCritter(critters.length));
        added += 1;
      }
      setRunning(true);
      confetti(W / 2, H * 0.4, 120);
      toast("Party mode", added ? "The whole crew showed up." : "The crew is already here.");
    }
  });

  window.addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      pointer.touch = event.pointerType === "touch";
      pointer.lastSeen = performance.now();
    },
    { passive: true }
  );
  window.addEventListener(
    "pointerdown",
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      pointer.touch = event.pointerType === "touch";
      pointer.lastSeen = performance.now();
    },
    { passive: true }
  );
  document.documentElement.addEventListener("mouseleave", () => {
    pointer.active = false;
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => resize(false), 120);
  });
  document.addEventListener("visibilitychange", wake);

  const onMotionChange = () => {
    if (motionQuery.matches) {
      setRunning(false);
    }
  };
  if (motionQuery.addEventListener) {
    motionQuery.addEventListener("change", onMotionChange);
  }

  resize(true);
  setRunning(running);
  updateHud();
  if (document.fonts && document.fonts.load) {
    document.fonts.load('8px "Press Start 2P"').catch(() => {});
  }

  // small hook for poking at it from the console
  window.cursorChase = {
    get catches() {
      return catches;
    },
    addFriend,
    newLevel: () => resize(true),
    snapshot: () => ({
      width: W,
      height: H,
      platforms: platforms.map((plat) => ({ x0: plat.x0, x1: plat.x1, y: plat.y, ground: !!plat.isGround })),
      critters: critters.map((critter) => ({
        x: critter.x,
        y: critter.y,
        mode: critter.mode,
        grounded: !!critter.plat,
      })),
    }),
  };
})();
