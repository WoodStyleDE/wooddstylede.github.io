/* WoodStyle: lightweight interactive 3D product renderer (Canvas 2D projection, no external libraries). */
(function () {
  'use strict';
  var canvases = Array.prototype.slice.call(document.querySelectorAll('canvas[data-wood3d]'));
  if (!canvases.length) return;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  var instances = [];

  function ellipsePoints(cx, cy, rx, ry, count) {
    var pts = [];
    for (var i = 0; i < (count || 56); i++) {
      var a = Math.PI * 2 * i / (count || 56);
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return pts;
  }
  function roundedRectPoints(cx, cy, width, height, radius, steps) {
    var pts = [], corners = [
      [cx + width / 2 - radius, cy + height / 2 - radius, 0],
      [cx - width / 2 + radius, cy + height / 2 - radius, 90],
      [cx - width / 2 + radius, cy - height / 2 + radius, 180],
      [cx + width / 2 - radius, cy - height / 2 + radius, 270]
    ];
    corners.forEach(function (c) {
      for (var j = 0; j <= (steps || 7); j++) {
        var a = (c[2] + j * 90 / (steps || 7)) * Math.PI / 180;
        pts.push([c[0] + Math.cos(a) * radius, c[1] + Math.sin(a) * radius]);
      }
    });
    return pts;
  }
  function rotatePoint(point, rot) {
    var x = point[0], y = point[1], z = point[2] || 0;
    var cx = Math.cos(rot.x), sx = Math.sin(rot.x);
    var cy = Math.cos(rot.y), sy = Math.sin(rot.y);
    var cz = Math.cos(rot.z), sz = Math.sin(rot.z);
    var y1 = y * cx - z * sx, z1 = y * sx + z * cx;
    var x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
    return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
  }
  function project(point, state, w, h) {
    var p = rotatePoint(point, state.rot);
    var camera = 5.25;
    var f = 5.15;
    var k = f / (camera - p[2]);
    var s = state.scale;
    return { x: w * .5 + (p[0] * k * s) + (state.offsetX || 0), y: h * .5 - (p[1] * k * s) + (state.offsetY || 0), z: p[2] };
  }
  function projectedPath(ctx, pts, state, w, h, z) {
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var q = project([p[0], p[1], z], state, w, h);
      if (!i) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
  }
  function drawWoodGrain(ctx, pts, state, w, h, z, bounds, opacity) {
    ctx.save();
    projectedPath(ctx, pts, state, w, h, z + .006);
    ctx.clip();
    // Layered, fine-grained wood fibres: denser than the first edition,
    // but still light enough to redraw smoothly while the object is rotated.
    var rows = Math.max(24, Math.floor((bounds.maxY - bounds.minY) * 38));
    for (var i = 0; i < rows; i++) {
      var y = bounds.minY + (bounds.maxY - bounds.minY) * (i + .5) / rows;
      var amp = .006 + (i % 7) * .00135;
      ctx.beginPath();
      for (var j = 0; j <= 42; j++) {
        var x = bounds.minX + (bounds.maxX - bounds.minX) * j / 42;
        var drift = Math.sin(j * .47 + i * 1.37) * amp + Math.sin(j * .16 + i * .73) * amp * .68;
        var yy = y + drift + Math.sin(j * .08 + i * .21) * amp * .55;
        var q = project([x, yy, z + .008], state, w, h);
        if (!j) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      }
      var major = i % 5 === 0;
      ctx.strokeStyle = major ? 'rgba(63,39,23,' + (opacity * .31) + ')' : 'rgba(255,235,203,' + (opacity * .16) + ')';
      ctx.lineWidth = major ? 1.05 : .58;
      ctx.stroke();
    }
    // Fine pores add a tactile, natural surface instead of a flat gradient.
    for (var pore = 0; pore < 32; pore++) {
      var px = bounds.minX + (bounds.maxX - bounds.minX) * ((pore * 0.61803398875) % 1);
      var py = bounds.minY + (bounds.maxY - bounds.minY) * ((pore * 0.38196601125 + .17) % 1);
      var porePoint = project([px, py, z + .012], state, w, h);
      ctx.beginPath(); ctx.ellipse(porePoint.x, porePoint.y, .65 + (pore % 3) * .18, .45, -.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(65,39,22,' + (opacity * (.12 + (pore % 4) * .025)) + ')'; ctx.fill();
    }
    // Natural knots with several fine growth rings.
    for (var n = 0; n < 4; n++) {
      var kx = bounds.minX + (bounds.maxX - bounds.minX) * (.16 + n * .22);
      var ky = bounds.minY + (bounds.maxY - bounds.minY) * (.24 + (n % 2) * .47);
      var knot = project([kx, ky, z + .012], state, w, h);
      for (var ring = 0; ring < 3; ring++) {
        ctx.beginPath(); ctx.ellipse(knot.x, knot.y, 3.8 + n * 1.35 + ring * 2.2, 1.3 + ring * .7, -.18, 0, Math.PI * 2);
        ctx.strokeStyle = ring === 1 ? 'rgba(86,47,25,' + (opacity * .22) + ')' : 'rgba(255,226,187,' + (opacity * .12) + ')';
        ctx.lineWidth = .62; ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawExtruded(ctx, points, zTop, zBottom, state, w, h, palette, texture) {
    var sides = [];
    for (var i = 0; i < points.length; i++) {
      var a = points[i], b = points[(i + 1) % points.length];
      var pa = project([a[0], a[1], zTop], state, w, h);
      var pb = project([b[0], b[1], zTop], state, w, h);
      var qb = project([b[0], b[1], zBottom], state, w, h);
      var qa = project([a[0], a[1], zBottom], state, w, h);
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var nx = dy, ny = -dx, nl = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= nl; ny /= nl;
      var light = Math.max(0, nx * -.48 + ny * .58 + .36);
      var shade = .42 + light * .48;
      sides.push({ z: (pa.z + pb.z + qb.z + qa.z) / 4, pts: [pa, pb, qb, qa], shade: shade });
    }
    sides.sort(function (a, b) { return a.z - b.z; });
    sides.forEach(function (face) {
      ctx.beginPath(); face.pts.forEach(function (p, k) { if (!k) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath();
      ctx.fillStyle = shadeColor(palette.edge, face.shade); ctx.fill();
      ctx.strokeStyle = 'rgba(47,25,12,.18)'; ctx.lineWidth = .55; ctx.stroke();
    });
    ctx.save();
    projectedPath(ctx, points, state, w, h, zTop);
    var center = project([0, 0, zTop], state, w, h);
    var grad = ctx.createRadialGradient(center.x - w * .06, center.y - h * .08, 3, center.x, center.y, Math.max(w, h) * .7);
    grad.addColorStop(0, palette.light); grad.addColorStop(.58, palette.top); grad.addColorStop(1, palette.deep);
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = 'rgba(255,232,198,.55)'; ctx.lineWidth = 1.25; ctx.stroke();
    if (texture !== false) {
      var xs = points.map(function (p) { return p[0]; }), ys = points.map(function (p) { return p[1]; });
      drawWoodGrain(ctx, points, state, w, h, zTop, { minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs), minY: Math.min.apply(null, ys), maxY: Math.max.apply(null, ys) }, palette.grain || .7);
    }
    ctx.restore();
  }
  function shadeColor(hex, factor) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r * factor)));
    g = Math.max(0, Math.min(255, Math.round(g * factor)));
    b = Math.max(0, Math.min(255, Math.round(b * factor)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function line3(ctx, points, state, w, h, color, width) {
    ctx.beginPath();
    points.forEach(function (p, i) { var q = project(p, state, w, h); if (!i) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
    ctx.strokeStyle = color; ctx.lineWidth = width || 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }
  function ellipseOnPlane(ctx, cx, cy, rx, ry, z, state, w, h, stroke, width, fill) {
    var pts = ellipsePoints(cx, cy, rx, ry, 56), pp = pts.map(function (p) { return project([p[0], p[1], z], state, w, h); });
    ctx.beginPath(); pp.forEach(function (p, i) { if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 1; ctx.stroke(); }
  }
  function drawEngravedLeaf(ctx, state, w, h, x, y, side, z, size, darkness) {
    var tone = darkness || 'rgba(67,39,24,.78)';
    var root = project([x, y, z], state, w, h);
    var tip = project([x + side * size, y + size * .52, z], state, w, h);
    var upper = project([x + side * size * .48, y + size * .72, z], state, w, h);
    var lower = project([x + side * size * .5, y - size * .12, z], state, w, h);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(upper.x, upper.y, tip.x, tip.y);
    ctx.quadraticCurveTo(lower.x, lower.y, root.x, root.y);
    ctx.closePath(); ctx.fillStyle = 'rgba(79,48,29,.10)'; ctx.fill();
    ctx.strokeStyle = tone; ctx.lineWidth = .82; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
    line3(ctx, [[x, y, z + .004], [x + side * size * .92, y + size * .49, z + .004]], state, w, h, tone, .62);
    for (var vein = 1; vein <= 3; vein++) {
      var t = vein / 4;
      line3(ctx, [
        [x + side * size * t, y + size * .49 * t, z + .005],
        [x + side * size * (t + .19), y + size * (.63 - t * .05), z + .005]
      ], state, w, h, 'rgba(77,45,27,.48)', .48);
      line3(ctx, [
        [x + side * size * t, y + size * .49 * t, z + .005],
        [x + side * size * (t + .17), y - size * (.04 + t * .04), z + .005]
      ], state, w, h, 'rgba(77,45,27,.42)', .46);
    }
  }
  function drawBotanicalSprig(ctx, state, w, h, x, y, z, scale, direction) {
    var dir = direction || 1;
    line3(ctx, [[x, y, z], [x + dir * scale * .12, y + scale * .28, z], [x + dir * scale * .22, y + scale * .56, z], [x + dir * scale * .31, y + scale * .82, z]], state, w, h, 'rgba(65,39,24,.82)', 1.15);
    for (var leaf = 0; leaf < 7; leaf++) {
      var t = leaf / 7;
      var side = leaf % 2 ? -dir : dir;
      var lx = x + dir * scale * (.10 + t * .19);
      var ly = y + scale * (.12 + t * .62);
      drawEngravedLeaf(ctx, state, w, h, lx, ly, side, z + .003, scale * (.19 - t * .035), 'rgba(69,41,25,.72)');
    }
    // Three tiny berries and their stems finish the hand-burned motif.
    for (var berry = 0; berry < 3; berry++) {
      var bx = x + dir * scale * (.19 + berry * .055), by = y + scale * (.54 + berry * .08);
      ellipseOnPlane(ctx, bx, by, scale * .025, scale * .025, z + .006, state, w, h, 'rgba(67,39,23,.62)', .55, 'rgba(80,46,26,.22)');
    }
  }
  function drawBoard(ctx, state, w, h, xoff, style) {
    var ox = xoff || 0, top = .19, bottom = -.075;
    var wood = style === 'dark' ? { top: '#654c36', light: '#a58b69', deep: '#403022', edge: '#2d231a', grain: .82 } : { top: '#9e815e', light: '#c8af89', deep: '#6b5137', edge: '#493624', grain: .76 };
    var handle = ellipsePoints(ox, -1.24, .255, .87, 48);
    drawExtruded(ctx, handle, top, bottom, state, w, h, wood, true);
    var body = roundedRectPoints(ox, .17, 1.56, 1.93, .2, 10);
    drawExtruded(ctx, body, top + .012, bottom, state, w, h, wood, true);
    // Rounded top bevel and inner inlay line.
    var innerRim = roundedRectPoints(ox, .17, 1.43, 1.79, .15, 10);
    projectedPath(ctx, innerRim, state, w, h, top + .021); ctx.strokeStyle = 'rgba(232,220,192,.4)'; ctx.lineWidth = 1.15; ctx.stroke();
    // Hand-burned olive branch with leaf contours, veins and berry details.
    drawBotanicalSprig(ctx, state, w, h, ox - .17, -.47, top + .035, 1.28, 1);
    drawBotanicalSprig(ctx, state, w, h, ox + .30, -.42, top + .035, .75, -1);
    line3(ctx, [[ox - .46, -.50, top + .035], [ox - .30, -.59, top + .035], [ox - .12, -.63, top + .035]], state, w, h, 'rgba(78,47,29,.42)', .62);
    // Fine parallel burn strokes add the etched, hand-worked finish.
    for (var etch = 0; etch < 8; etch++) {
      var ey = -.93 + etch * .055;
      line3(ctx, [[ox - .43, ey, top + .028], [ox - .31, ey + .018, top + .028], [ox - .18, ey + .012, top + .028]], state, w, h, 'rgba(83,52,33,.18)', .48);
    }
    // Handle hole with dark inner bevel and a warm polished edge.
    ellipseOnPlane(ctx, ox, -1.78, .085, .105, top + .035, state, w, h, 'rgba(66,39,22,.92)', 3, 'rgba(47,28,17,.78)');
    ellipseOnPlane(ctx, ox, -1.78, .058, .075, top + .038, state, w, h, 'rgba(218,201,165,.62)', 1.2);
    // Small maker's mark.
    var mark = project([ox, -.66, top + .035], state, w, h);
    ctx.save(); ctx.textAlign = 'center'; ctx.font = '600 7px Georgia,serif'; ctx.letterSpacing = '1.5px'; ctx.fillStyle = 'rgba(74,43,24,.55)'; ctx.fillText('WOODSTYLE', mark.x, mark.y + 3); ctx.restore();
  }
  function drawCoaster(ctx, state, w, h, x, y, r, z, dark) {
    var points = ellipsePoints(x, y, r, r * .84, 48);
    var p = dark ? { top: '#70543a', light: '#a58b68', deep: '#443224', edge: '#2d231a', grain: .3 } : { top: '#987851', light: '#c5a77b', deep: '#654a30', edge: '#44311f', grain: .35 };
    drawExtruded(ctx, points, z, z - .13, state, w, h, p, false);
    for (var i = 0; i < 7; i++) ellipseOnPlane(ctx, x, y, r * (.12 + i * .125), r * (.10 + i * .105), z + .014, state, w, h, i % 2 ? 'rgba(77,43,24,.43)' : 'rgba(242,208,165,.29)', .78);
    ellipseOnPlane(ctx, x, y, r * .93, r * .78, z + .017, state, w, h, 'rgba(255,229,192,.34)', .82);
    // Tiny engraved leaf emblem in the centre, with fine etched veins.
    line3(ctx, [[x - r * .27, y - r * .02, z + .023], [x, y + r * .06, z + .023], [x + r * .28, y + r * .02, z + .023]], state, w, h, 'rgba(70,42,25,.66)', .75);
    drawEngravedLeaf(ctx, state, w, h, x - r * .05, y + r * .025, -1, z + .025, r * .28, 'rgba(70,42,25,.68)');
    drawEngravedLeaf(ctx, state, w, h, x + r * .02, y + r * .04, 1, z + .025, r * .25, 'rgba(70,42,25,.64)');
    for (var dot = 0; dot < 4; dot++) ellipseOnPlane(ctx, x + (dot - 1.5) * r * .11, y - r * .22, r * .018, r * .018, z + .024, state, w, h, null, 0, 'rgba(68,41,25,.52)');
  }
  function drawPen(ctx, state, w, h) {
    var a = project([-1.25, -.42, .37], state, w, h), b = project([-.9, .46, .43], state, w, h);
    ctx.save(); ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 12; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 9;
    var grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y); grad.addColorStop(0, '#241a14'); grad.addColorStop(.35, '#8c7158'); grad.addColorStop(.53, '#33271e'); grad.addColorStop(1, '#17120e');
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = grad; ctx.lineWidth = 13; ctx.stroke();
    ctx.shadowColor = 'transparent'; ctx.beginPath(); ctx.moveTo(a.x + 2, a.y - 3); ctx.lineTo(b.x + 2, b.y - 3); ctx.strokeStyle = 'rgba(255,229,190,.65)'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + (b.x - a.x) * .15, a.y + (b.y - a.y) * .15); ctx.strokeStyle = '#d5b48b'; ctx.lineWidth = 5; ctx.stroke();
    ctx.restore();
    var tip = project([-1.25, -.42, .37], state, w, h); ctx.save(); ctx.shadowColor = '#bba783'; ctx.shadowBlur = 18; ctx.beginPath(); ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#d9c9a7'; ctx.fill(); ctx.restore();
  }
  function drawPortrait(ctx, state, w, h) {
    var pts = roundedRectPoints(0, 0, 1.72, 2.18, .12, 8);
    var wood = { top: '#a48763', light: '#ceb891', deep: '#725638', edge: '#4a3724', grain: .72 };
    drawExtruded(ctx, pts, .2, -.08, state, w, h, wood, true);
    var inner = roundedRectPoints(0, .02, 1.48, 1.92, .06, 7);
    projectedPath(ctx, inner, state, w, h, .214); ctx.strokeStyle = 'rgba(235,225,202,.54)'; ctx.lineWidth = 1.6; ctx.stroke();
    // Fine pyrogram engraving: layered facial contours, eyes, muzzle and fur hatching.
    ellipseOnPlane(ctx, -.39, .56, .19, .32, .219, state, w, h, 'rgba(74,40,21,.78)', 1.55, 'rgba(91,49,25,.08)');
    ellipseOnPlane(ctx, .39, .56, .19, .32, .219, state, w, h, 'rgba(74,40,21,.78)', 1.55, 'rgba(91,49,25,.08)');
    ellipseOnPlane(ctx, -.39, .56, .13, .24, .221, state, w, h, 'rgba(87,52,31,.45)', .65);
    ellipseOnPlane(ctx, .39, .56, .13, .24, .221, state, w, h, 'rgba(87,52,31,.45)', .65);
    ellipseOnPlane(ctx, 0, .21, .51, .62, .22, state, w, h, 'rgba(70,38,21,.86)', 1.75);
    // Brows and lids frame the eyes before the deeper pupils are burned in.
    line3(ctx, [[-.34,.37,.224],[-.27,.43,.224],[-.17,.43,.224],[-.11,.38,.224]], state, w, h, 'rgba(69,39,23,.7)', .95);
    line3(ctx, [[.11,.38,.224],[.17,.43,.224],[.27,.43,.224],[.34,.37,.224]], state, w, h, 'rgba(69,39,23,.7)', .95);
    ellipseOnPlane(ctx, -.22, .27, .074, .064, .224, state, w, h, 'rgba(47,27,16,.88)', 1, 'rgba(74,42,23,.7)');
    ellipseOnPlane(ctx, .22, .27, .074, .064, .224, state, w, h, 'rgba(47,27,16,.88)', 1, 'rgba(74,42,23,.7)');
    ellipseOnPlane(ctx, -.22, .27, .027, .043, .227, state, w, h, null, 0, 'rgba(35,22,15,.86)');
    ellipseOnPlane(ctx, .22, .27, .027, .043, .227, state, w, h, null, 0, 'rgba(35,22,15,.86)');
    ellipseOnPlane(ctx, -.235, .292, .012, .012, .229, state, w, h, null, 0, 'rgba(242,224,193,.78)');
    ellipseOnPlane(ctx, .205, .292, .012, .012, .229, state, w, h, null, 0, 'rgba(242,224,193,.78)');
    // Muzzle pads, nose bridge and nostrils.
    ellipseOnPlane(ctx, -.13, -.035, .18, .13, .223, state, w, h, 'rgba(82,47,25,.62)', 1, 'rgba(115,69,37,.07)');
    ellipseOnPlane(ctx, .13, -.035, .18, .13, .223, state, w, h, 'rgba(82,47,25,.62)', 1, 'rgba(115,69,37,.07)');
    ellipseOnPlane(ctx, 0, -.07, .19, .14, .223, state, w, h, 'rgba(82,47,25,.7)', 1.15, 'rgba(115,69,37,.08)');
    var nose = [[-.085,-.055],[0,-.13],[.085,-.055],[.057,.015],[-.057,.015]];
    var np = nose.map(function (p) { return project([p[0],p[1],.228], state, w, h); });
    ctx.beginPath(); np.forEach(function(p,i){if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}); ctx.closePath(); ctx.fillStyle='rgba(45,27,18,.88)'; ctx.fill();
    ellipseOnPlane(ctx, -.035, -.045, .012, .009, .23, state, w, h, null, 0, 'rgba(20,15,11,.74)');
    ellipseOnPlane(ctx, .035, -.045, .012, .009, .23, state, w, h, null, 0, 'rgba(20,15,11,.74)');
    line3(ctx, [[0,-.13,.228],[0,-.25,.228],[-.13,-.31,.228]], state, w, h, 'rgba(70,38,21,.78)', 1.05);
    line3(ctx, [[0,-.25,.228],[.13,-.31,.228]], state, w, h, 'rgba(70,38,21,.78)', 1.05);
    line3(ctx, [[-.13,-.31,.228],[-.20,-.28,.228],[-.25,-.31,.228]], state, w, h, 'rgba(70,38,21,.55)', .65);
    line3(ctx, [[.13,-.31,.228],[.20,-.28,.228],[.25,-.31,.228]], state, w, h, 'rgba(70,38,21,.55)', .65);
    // Directional fur strokes along the cheeks, forehead and ears.
    for (var i = 0; i < 9; i++) {
      var side = i < 4 ? -1 : 1, k = i < 4 ? i : i - 4;
      var x = side * (.34 + k * .038), y = .10 - k * .105;
      line3(ctx, [[x,y,.224],[x + side * .06,y - .055,.224],[x + side * .085,y - .105,.224]], state, w, h, 'rgba(82,47,25,.43)', .62);
    }
    for (var j = 0; j < 8; j++) {
      var fx = -.31 + j * .088;
      line3(ctx, [[fx,.73 + (j % 2) * .025,.224],[fx + .035,.84 + (j % 3) * .025,.224],[fx + .06,.91,.224]], state, w, h, 'rgba(82,47,25,.38)', .58);
    }
    for (var whisk = 0; whisk < 3; whisk++) {
      var wy = -.10 - whisk * .055;
      line3(ctx, [[-.19,wy,.225],[-.34,wy + .035,.225],[-.43,wy + .02,.225]], state, w, h, 'rgba(74,43,27,.44)', .48);
      line3(ctx, [[.19,wy,.225],[.34,wy + .035,.225],[.43,wy + .02,.225]], state, w, h, 'rgba(74,43,27,.44)', .48);
    }
    // Tiny hatch marks make the burned portrait look hand-worked up close.
    for (var hatch = 0; hatch < 12; hatch++) {
      var hx = -.43 + hatch * .078, hy = -.42 + (hatch % 3) * .035;
      line3(ctx, [[hx,hy,.224],[hx + .032,hy - .045,.224]], state, w, h, 'rgba(76,45,27,.34)', .5);
    }
  }
  function drawCoasterStack(ctx, state, w, h) {
    drawCoaster(ctx, state, w, h, -.22, -.1, .66, .16, true);
    drawCoaster(ctx, state, w, h, .04, .02, .64, .34, false);
    drawCoaster(ctx, state, w, h, .28, .15, .62, .52, true);
    drawCoaster(ctx, state, w, h, .5, .28, .6, .7, false);
  }
  function drawGift(ctx, state, w, h) {
    var disk = ellipsePoints(-.24, .05, .78, .78, 64);
    drawExtruded(ctx, disk, .2, -.08, state, w, h, { top: '#9b7c56', light: '#cbb38c', deep: '#6c5136', edge: '#493623', grain: .65 }, true);
    ellipseOnPlane(ctx, -.24, .05, .65, .65, .214, state, w, h, 'rgba(235,225,202,.55)', 1.2);
    ellipseOnPlane(ctx, -.24, .05, .57, .57, .216, state, w, h, 'rgba(71,43,27,.35)', .8);
    ellipseOnPlane(ctx, -.24, .05, .53, .53, .217, state, w, h, 'rgba(255,233,201,.28)', .58);
    drawBotanicalSprig(ctx, state, w, h, -.28, -.31, .222, .72, 1);
    // A restrained maker's stamp, inset into the grain.
    var giftMark = project([-.24, -.48, .224], state, w, h);
    ctx.save(); ctx.textAlign = 'center'; ctx.font = '600 6px Georgia,serif'; ctx.letterSpacing = '1.1px'; ctx.fillStyle = 'rgba(67,42,27,.62)'; ctx.fillText('HANDMADE', giftMark.x, giftMark.y + 2); ctx.restore();
    // Small, recognisable heart-shaped hanging charm.
    var heart = [];
    for (var t = 0; t < Math.PI * 2; t += Math.PI * 2 / 56) {
      var hx = 16 * Math.pow(Math.sin(t), 3) / 16;
      var hy = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
      heart.push([.62 + hx * .31, -.13 + hy * .34]);
    }
    line3(ctx, [[.53,.56,.34],[.54,.78,.34],[.61,.87,.34]], state, w, h, 'rgba(207,177,140,.9)', 2);
    drawExtruded(ctx, heart, .35, .15, state, w, h, { top:'#8b6a49',light:'#bda17a',deep:'#59412c',edge:'#3d2e20',grain:.3 }, false);
    ellipseOnPlane(ctx, -.24, .05, .12, .12, .218, state, w, h, 'rgba(69,39,20,.65)', 1.3, 'rgba(73,42,23,.16)');
    // Heart charm: inset heart line and three tiny burn dots.
    var heartInset = heart.map(function (p) { return [.62 + (p[0] - .62) * .72, -.13 + (p[1] + .13) * .72]; });
    projectedPath(ctx, heartInset, state, w, h, .356); ctx.strokeStyle = 'rgba(239,215,180,.38)'; ctx.lineWidth = .72; ctx.stroke();
    for (var hd = 0; hd < 3; hd++) ellipseOnPlane(ctx, .62 + (hd - 1) * .065, -.08, .012, .012, .36, state, w, h, null, 0, 'rgba(60,36,23,.58)');
  }
  function drawScene(ctx, state, w, h, mode, time) {
    ctx.clearRect(0, 0, w, h);
    // Soft contact shadow gives the model a grounded, studio-lit presence.
    var shadow = project([0, -.55, -.12], state, w, h);
    ctx.save(); ctx.filter = 'blur(18px)'; ctx.beginPath(); ctx.ellipse(shadow.x + 8, shadow.y + 42, Math.min(w, h) * .24, Math.min(w, h) * .075, -.12, 0, Math.PI * 2); ctx.fillStyle = 'rgba(17,10,6,.22)'; ctx.fill(); ctx.restore();
    if (mode === 'portrait') drawPortrait(ctx, state, w, h);
    else if (mode === 'coasters') drawCoasterStack(ctx, state, w, h);
    else if (mode === 'gifts') drawGift(ctx, state, w, h);
    else if (mode === 'board') { drawBoard(ctx, state, w, h, -.08, 'dark'); drawCoaster(ctx, state, w, h, 1.16, .36, .35, .3, true); drawCoaster(ctx, state, w, h, 1.37, -.22, .32, .38, false); drawPen(ctx, state, w, h); }
    else { drawBoard(ctx, state, w, h, -.17, 'light'); drawCoaster(ctx, state, w, h, 1.1, .48, .36, .35, false); drawCoaster(ctx, state, w, h, 1.35, -.05, .32, .42, true); drawCoaster(ctx, state, w, h, .94, -.23, .3, .49, false); drawPen(ctx, state, w, h); }
    // A few restrained fire-dust sparks in the product light.
    if (mode === 'hero' || mode === 'board') {
      for (var i = 0; i < 6; i++) {
        var a = time * .00022 + i * Math.PI * 2 / 6;
        var q = project([Math.cos(a) * 1.78, Math.sin(a) * 1.42, .3], state, w, h);
        var alpha = .28 + .2 * Math.sin(time * .001 + i);
        ctx.beginPath(); ctx.arc(q.x, q.y, 1.3 + (i % 3) * .55, 0, Math.PI * 2); ctx.fillStyle = 'rgba(196,181,145,' + alpha + ')'; ctx.fill();
      }
    }
  }
  function create(canvas) {
    var mode = canvas.getAttribute('data-wood3d') || 'board';
    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) { canvas.style.display = 'none'; return; }
    var homeRotation = { x: .84, y: -.18, z: -.22 };
    var state = { rot: { x: homeRotation.x, y: homeRotation.y, z: homeRotation.z }, target: { x: homeRotation.x, y: homeRotation.y, z: homeRotation.z }, scale: 1, offsetX: 0, offsetY: 0, dragging: false, active: false, visible: true, running: false, last: 0, dpr: 1, w: 0, h: 0, mode: mode };
    var isHero = canvas.classList.contains('hero-model'), isStage = canvas.classList.contains('stage-model'), isProduct = canvas.classList.contains('product-model');
    var container = isProduct ? canvas.parentElement : (isHero || isStage ? canvas.parentElement : null);
    var viewButton = null;

    function setPhotoMode(showPhoto) {
      if (!container || !viewButton) return;
      container.classList.toggle('show-photo', showPhoto);
      viewButton.setAttribute('aria-pressed', showPhoto ? 'true' : 'false');
      viewButton.setAttribute('aria-label', showPhoto ? '3D-Modell anzeigen' : 'Originalfoto anzeigen');
      viewButton.title = showPhoto ? '3D-Modell anzeigen' : 'Originalfoto anzeigen';
      viewButton.innerHTML = showPhoto
        ? '<span aria-hidden="true">↻</span><span class="view-toggle-label">3D</span>'
        : '<span aria-hidden="true">↗</span><span class="view-toggle-label">FOTO</span>';
      if (isProduct) {
        var tag = container.querySelector('.model-tag');
        if (tag) tag.textContent = showPhoto ? 'ORIGINALFOTO' : '3D · ANSICHT';
      }
    }

    if (container) {
      if (isProduct) container.classList.add('has-3d-model');
      if (isStage) {
        var stagePhoto = document.createElement('img');
        stagePhoto.className = 'stage-real-photo';
        stagePhoto.src = 'images/board.jpg';
        stagePhoto.alt = 'Originalfoto eines gravierten WoodStyle-Schneidebretts';
        stagePhoto.loading = 'lazy';
        container.insertBefore(stagePhoto, canvas);
      }
      viewButton = document.createElement('button');
      viewButton.type = 'button';
      viewButton.className = 'model-view-toggle';
      viewButton.setAttribute('aria-pressed', 'false');
      viewButton.setAttribute('aria-label', 'Originalfoto anzeigen');
      viewButton.title = 'Originalfoto anzeigen';
      viewButton.innerHTML = '<span aria-hidden="true">↗</span><span class="view-toggle-label">FOTO</span>';
      viewButton.addEventListener('click', function () {
        setPhotoMode(!container.classList.contains('show-photo'));
      });
      container.appendChild(viewButton);
      if (isHero) viewButton.classList.add('model-view-toggle-hero');
      if (isStage) viewButton.classList.add('model-view-toggle-stage');
    }

    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      state.w = r.width; state.h = r.height; state.dpr = Math.min(window.devicePixelRatio || 1, 1.8);
      canvas.width = Math.round(r.width * state.dpr); canvas.height = Math.round(r.height * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      var fit = Math.min(r.width / (isProduct ? 3.5 : 4.6), r.height / (isProduct ? 3.4 : 4.0));
      state.scale = fit * (isHero ? 1.08 : isStage ? 1.14 : 1.16);
      state.offsetX = isHero ? -r.width * .015 : 0;
      state.offsetY = isProduct ? 3 : isHero ? 6 : 4;
      render(performance.now());
    }
    function render(now) {
      if (!state.w || !state.h) return;
      var delta = state.last ? Math.min(40, now - state.last) : 16; state.last = now;
      if (!state.dragging) {
        if (!reduced && state.active) {
          state.target.y += delta * .000085;
          if (isHero) state.target.z = -.2 + Math.sin(now * .00022) * .04;
        }
        // A firmer spring makes the object follow the hand immediately, without twitching.
        state.rot.x += (state.target.x - state.rot.x) * .125;
        state.rot.y += (state.target.y - state.rot.y) * .125;
        state.rot.z += (state.target.z - state.rot.z) * .125;
      }
      drawScene(ctx, state, state.w, state.h, mode, now);
      if (!reduced && state.visible) requestAnimationFrame(render);
      else state.running = false;
    }
    function activate() { state.visible = true; if (reduced) { render(performance.now()); return; } if (!state.running) { state.running = true; state.active = true; state.last = 0; requestAnimationFrame(render); } }
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) { entries.forEach(function (entry) { state.visible = entry.isIntersecting; if (state.visible) activate(); }); }, { rootMargin: '120px 0px' }) : null;
    if (io) io.observe(canvas); else activate();
    if ('ResizeObserver' in window) { var ro = new ResizeObserver(resize); ro.observe(canvas); } else window.addEventListener('resize', resize, { passive: true });
    resize();

    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || e.pointerType === 'touch' || e.pointerType === 'pen') {
        state.dragging = true; state.pointerX = e.clientX; state.pointerY = e.clientY;
        state.pointerType = e.pointerType;
        canvas.classList.add('is-grabbing');
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (state.dragging) {
        var dx = e.clientX - state.pointerX, dy = e.clientY - state.pointerY;
        state.pointerX = e.clientX; state.pointerY = e.clientY;
        // Gentler sensitivity, paired with a more responsive spring above.
        state.target.y += dx * .0072;
        state.target.x += dy * .0045;
        state.target.x = Math.max(.34, Math.min(1.34, state.target.x));
        if (reduced) render(performance.now());
      } else if (fine && isHero) {
        var b = canvas.getBoundingClientRect();
        state.target.y = -.18 + ((e.clientX - b.left) / b.width - .5) * .24;
        state.target.x = .84 + (.5 - (e.clientY - b.top) / b.height) * .12;
      }
    });
    // Alt + mouse wheel (or Shift + trackpad scroll) rotates the model without
    // stealing the normal page scroll from people browsing the site.
    canvas.addEventListener('wheel', function (e) {
      if (e.altKey || e.shiftKey) {
        e.preventDefault();
        var delta = Math.max(-90, Math.min(90, e.deltaY || e.deltaX || 0));
        state.target.y += delta * .0024;
        state.target.x = Math.max(.34, Math.min(1.34, state.target.x + (e.deltaX || 0) * .0007));
        if (reduced) render(performance.now());
      }
    }, { passive: false });
    function stopDrag() { state.dragging = false; state.pointerType = ''; canvas.classList.remove('is-grabbing'); }
    canvas.addEventListener('pointerup', stopDrag); canvas.addEventListener('pointercancel', stopDrag); canvas.addEventListener('lostpointercapture', stopDrag);
    canvas.addEventListener('pointerleave', function () { if (!state.dragging && isHero && fine) { state.target.x = homeRotation.x; state.target.y = homeRotation.y; } });
    canvas.addEventListener('dblclick', function () { state.target.x = homeRotation.x; state.target.y = homeRotation.y; state.target.z = homeRotation.z; });
    canvas.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') state.target.y -= .14;
      if (e.key === 'ArrowRight') state.target.y += .14;
      if (e.key === 'ArrowUp') state.target.x = Math.min(1.34, state.target.x + .08);
      if (e.key === 'ArrowDown') state.target.x = Math.max(.34, state.target.x - .08);
      if (e.key === 'Home' || e.key === '0') { state.target.x = homeRotation.x; state.target.y = homeRotation.y; state.target.z = homeRotation.z; }
    });
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', canvas.getAttribute('aria-label') + '. Mit Maus oder Finger ziehen, Alt oder Shift plus Mausrad zum Drehen, doppelklicken zum Zurücksetzen.');
    if (isStage) {
      var stageHint = container && container.querySelector('.model-hint');
      if (stageHint) stageHint.setAttribute('aria-label', 'Ziehen zum Drehen. Alt oder Shift plus Mausrad dreht ebenfalls.');
    }
  }
  canvases.forEach(create);
  document.documentElement.classList.add('wood3d-ready');
})();
