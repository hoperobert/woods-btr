/* Woods BTR schedule engine.
   All times are "raid time remaining" in seconds (counts down from 2100).
   Data comes from data.js (BTR_DATA). This file is pure logic, no DOM. */
(function (root) {
  'use strict';

  var D = root.BTR_DATA;

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  function pathLength(p) {
    var L = 0;
    for (var i = 1; i < p.length; i++) L += dist(p[i - 1], p[i]);
    return L;
  }

  function pointAt(p, s) {
    // s = distance along path from start
    var acc = 0;
    for (var i = 1; i < p.length; i++) {
      var seg = dist(p[i - 1], p[i]);
      if (acc + seg >= s) {
        var f = seg === 0 ? 0 : (s - acc) / seg;
        return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * f, y: p[i - 1].y + (p[i].y - p[i - 1].y) * f };
      }
      acc += seg;
    }
    return { x: p[p.length - 1].x, y: p[p.length - 1].y };
  }

  function legPath(leg) {
    var p = D.paths[leg.key];
    if (!p) return null;
    return leg.reversed ? p.slice().reverse() : p.slice();
  }

  function stopAtEnd(p) {
    var end = p[p.length - 1], best = null, bd = 1e9;
    for (var id in D.stops) {
      var d = dist(D.stops[id], end);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  // Build the full timeline for a route: legs (travel) and dwells, times counting down.
  function buildTimeline(route) {
    var t = D.meta.spawnTimes[route.spawn];
    var legs = route.segments.slice();
    if (route.loopBack && route.loopBack.length) {
      route.loopBack.forEach(function (l) { legs.push({ key: l.key, reversed: l.reversed, loop: true }); });
    }
    var events = [];
    legs.forEach(function (leg) {
      var p = legPath(leg);
      if (!p) return;
      var L = pathLength(p);
      var travel = L / D.meta.speedUnitsPerSec;
      var start = t, end = t - travel;
      events.push({
        type: 'travel', leg: leg, path: p, length: L,
        start: start, end: end, stopId: stopAtEnd(p), loop: !!leg.loop
      });
      t = end;
      if (!leg.loop) {
        events.push({ type: 'dwell', stopId: stopAtEnd(p), start: end, end: end - D.meta.stopDurationSeconds, loop: false });
        t = end - D.meta.stopDurationSeconds;
      }
    });
    return { route: route, events: events, spawnTime: D.meta.spawnTimes[route.spawn], endTime: t };
  }

  var timelines = {};
  function timelineFor(routeId) {
    if (!timelines[routeId]) {
      var r = D.routes.filter(function (x) { return x.id === routeId; })[0];
      timelines[routeId] = buildTimeline(r);
    }
    return timelines[routeId];
  }

  // State of one route at a given raid time remaining.
  function stateAt(routeId, remaining) {
    var tl = timelineFor(routeId);
    var st = {
      routeId: routeId, route: tl.route, spawnTime: tl.spawnTime,
      spawned: remaining <= tl.spawnTime,
      finished: remaining < tl.endTime,
      position: null, currentStop: null, nextStop: null,
      nextStopEta: null, nextStopIn: null, legProgress: 0, dwellLeft: null,
      stops: []
    };
    if (!st.spawned) {
      st.nextStop = tl.events[0] ? tl.events[0].stopId : null;
      st.nextStopEta = tl.events[0] ? tl.events[0].end : null;
      st.nextStopIn = tl.events[0] ? remaining - tl.events[0].end : null;
      return st;
    }
    // stop list (arrivals)
    tl.events.forEach(function (e) {
      if (e.type === 'travel') st.stops.push({ stopId: e.stopId, arrival: e.end, loop: e.loop });
    });
    if (st.finished) {
      var last = tl.events[tl.events.length - 1];
      st.position = last.path[last.path.length - 1];
      st.currentStop = last.stopId;
      return st;
    }
    for (var i = 0; i < tl.events.length; i++) {
      var e = tl.events[i];
      if (remaining <= e.start && remaining >= e.end) {
        if (e.type === 'travel') {
          var done = (e.start - remaining) * D.meta.speedUnitsPerSec;
          st.position = pointAt(e.path, Math.min(done, e.length));
          st.legProgress = e.length ? done / e.length : 0;
          st.nextStop = e.stopId;
          st.nextStopEta = e.end;
          st.nextStopIn = remaining - e.end;
          st.currentStop = null;
        } else {
          st.position = e.path ? null : null;
          var p = null;
          // dwell: sit on the stop
          var s = D.stops[e.stopId];
          st.position = { x: s.x, y: s.y };
          st.currentStop = e.stopId;
          st.dwellLeft = remaining - e.end;
          st.nextStop = e.stopId;
          st.nextStopEta = e.end;
          st.nextStopIn = remaining - e.end;
          // the stop it heads to after this dwell
          for (var j = i + 1; j < tl.events.length; j++) {
            if (tl.events[j].type === 'travel') {
              st.afterStop = tl.events[j].stopId;
              st.afterEta = tl.events[j].end;
              st.afterIn = remaining - tl.events[j].end;
              break;
            }
          }
        }
        st.eventIndex = i;
        break;
      }
    }
    return st;
  }

  // Next stop for every route, for the "which route is it?" table.
  function allRoutesAt(remaining) {
    return D.routes.map(function (r) {
      var s = stateAt(r.id, remaining);
      return {
        id: r.id, spawn: r.spawn, stops: r.stops,
        spawned: s.spawned, finished: s.finished,
        currentStop: s.currentStop, nextStop: s.nextStop,
        nextStopEta: s.nextStopEta, nextStopIn: s.nextStopIn
      };
    });
  }

  function fmt(t) {
    if (t === null || t === undefined || isNaN(t)) return '--:--';
    var neg = t < 0; t = Math.abs(Math.round(t));
    var m = Math.floor(t / 60), s = t % 60;
    return (neg ? '-' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // "in 2:14" / "now" / "passed"
  function fmtIn(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return '';
    if (sec <= 0) return 'passed';
    return 'in ' + fmt(sec);
  }

  function parseRaidTime(str) {
    // accepts "23:45", "23.45", "23 45", "2345", "23", "23m45"
    if (str === null || str === undefined) return null;
    var s = String(str).trim().toLowerCase().replace(/[^0-9:.]/g, '');
    if (!s) return null;
    var m;
    if (s.indexOf(':') >= 0) { var a = s.split(':'); m = parseInt(a[0], 10) * 60 + parseInt(a[1] || '0', 10); }
    else if (s.indexOf('.') >= 0) { var b = s.split('.'); m = parseInt(b[0], 10) * 60 + parseInt(b[1] || '0', 10); }
    else if (s.length > 2) { m = parseInt(s.slice(0, s.length - 2), 10) * 60 + parseInt(s.slice(-2), 10); }
    else { m = parseInt(s, 10) * 60; }
    if (isNaN(m)) return null;
    return m;
  }

  root.BTR = {
    data: D,
    stateAt: stateAt,
    allRoutesAt: allRoutesAt,
    timelineFor: timelineFor,
    fmt: fmt,
    fmtIn: fmtIn,
    parseRaidTime: parseRaidTime,
    pathLength: pathLength,
    pointAt: pointAt
  };
})(typeof window !== 'undefined' ? window : globalThis);
