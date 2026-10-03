/* Woods BTR tracker front end. */
(function () {
  'use strict';
  var B = window.BTR, D = B.data;

  var COORD_W = D.meta.coordinateSpace[0];   // 7680
  var COORD_H = D.meta.coordinateSpace[1];   // 3958
  var RAID = D.meta.raidDurationSeconds;     // 2100

  var $ = function (id) { return document.getElementById(id); };
  var state = { raidTime: null, routeId: null, live: false, lastTick: 0 };

  // ---- map ----
  var mapwrap = $('mapwrap'), mapimg = $('mapimg');
  var stopEls = {}, btrEl = null;

  function pct(x, y) {
    return { left: (x / COORD_W) * 100, top: ((COORD_H - y) / COORD_H) * 100 };
  }

  function buildMap() {
    Object.keys(D.stops).forEach(function (id) {
      var s = D.stops[id], p = pct(s.x, s.y);
      var el = document.createElement('div');
      el.className = 'mk stop';
      el.style.left = p.left + '%';
      el.style.top = p.top + '%';
      mapwrap.appendChild(el);
      stopEls[id] = el;
    });
    btrEl = document.createElement('div');
    btrEl.className = 'mk btr';
    btrEl.style.display = 'none';
    mapwrap.appendChild(btrEl);
  }

  function placeBtr(pos, dead) {
    if (!pos) { btrEl.style.display = 'none'; return; }
    var p = pct(pos.x, pos.y);
    btrEl.style.display = 'block';
    btrEl.style.left = p.left + '%';
    btrEl.style.top = p.top + '%';
    btrEl.className = 'mk btr' + (dead ? ' dead' : '');
  }

  // ---- render ----
  function render() {
    var t = state.raidTime;
    if (t === null) return;
    var route = D.routes.filter(function (r) { return r.id === state.routeId; })[0];
    var st = B.stateAt(route.id, t);

    $('clock').textContent = B.fmt(t);
    $('bar').style.width = Math.max(0, Math.min(100, (t / RAID) * 100)) + '%';

    // spawn line
    var spawnT = D.meta.spawnTimes[route.spawn];
    var spawnLine;
    if (t > spawnT) {
      spawnLine = 'BTR spawns at ' + B.fmt(spawnT) + ' remaining (' + B.fmt(t - spawnT) + ' from now).';
    } else if (st.finished) {
      spawnLine = 'This route has finished for the raid (last stop ' + B.fmt(st.stops[st.stops.length - 1].arrival) + ').';
    } else {
      spawnLine = 'Spawned at ' + B.fmt(spawnT) + ' remaining, ' + B.fmt(spawnT - t) + ' ago.';
    }
    $('spawnline').textContent = spawnLine;

    // position + next stop
    if (!st.spawned) {
      placeBtr(null);
      $('nextstop').textContent = 'Not spawned yet';
      $('nexteta').textContent = B.fmt(st.nextStopEta);
      $('nextmeta').textContent = 'First stop ' + stopName(st.nextStop) + ' in ' + B.fmt(st.nextStopIn) + '.';
    } else if (st.finished) {
      placeBtr(st.position, true);
      $('nextstop').textContent = 'Route finished';
      $('nexteta').textContent = '--:--';
      $('nextmeta').textContent = 'The BTR has left the map on this route.';
    } else {
      placeBtr(st.position, false);
      if (st.currentStop && !st.afterStop) {
        $('nextstop').textContent = 'Route finished';
        $('nexteta').textContent = '--:--';
        $('nextmeta').textContent = 'Parked at ' + stopName(st.currentStop) + ', the last stop of this loop.';
      } else if (st.currentStop && st.afterStop) {
        $('nextstop').textContent = stopName(st.afterStop);
        $('nexteta').textContent = B.fmt(st.afterEta);
        $('nextmeta').textContent = 'Parked at ' + stopName(st.currentStop) + ', leaves in ' + B.fmt(st.dwellLeft) +
          '. Arrives at ' + stopName(st.afterStop) + ' in ' + B.fmt(st.afterIn) + '.';
      } else {
        $('nextstop').textContent = stopName(st.nextStop);
        $('nexteta').textContent = B.fmt(st.nextStopEta);
      }
      if (!st.currentStop) {
        $('nextmeta').textContent = 'On the way, ' + Math.round(st.legProgress * 100) + '% of the leg done. Arrives in ' +
          B.fmt(st.nextStopIn) + '.';
      }
    }

    // route card
    $('routemeta').textContent = route.name + ' · spawns ' + route.spawn + ' · ' + route.stops.length + ' stops';
    var ul = $('stoplist');
    ul.innerHTML = '';
    st.stops.forEach(function (s) {
      var li = document.createElement('li');
      var isNow = st.currentStop === s.stopId && !st.finished;
      var isNext = !isNow && st.nextStop === s.stopId && !st.finished;
      li.className = isNow ? 'now' : (s.arrival > t ? 'done' : '');
      li.innerHTML = '<span>' + stopName(s.stopId) + (s.loop ? ' <span class="pill">loop</span>' : '') +
        (isNow ? ' <span class="pill hi">here</span>' : (isNext ? ' <span class="pill hi">next</span>' : '')) +
        '</span><span class="t">' + B.fmt(s.arrival) + '</span>';
      ul.appendChild(li);
    });

    // stop markers
    var nextId = (st.currentStop && st.afterStop) ? st.afterStop : st.nextStop;
    Object.keys(stopEls).forEach(function (id) {
      var el = stopEls[id];
      var passed = st.stops.some(function (s) { return s.stopId === id && s.arrival > t; });
      el.className = 'mk stop' + (id === nextId && !st.finished ? ' next' : (passed ? ' passed' : ''));
    });

    // all routes table
    var tb = $('routetable');
    tb.innerHTML = '';
    B.allRoutesAt(t).forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.id === state.routeId) tr.className = 'sel';
      if (r.finished) tr.className = 'dead';
      var where;
      if (!r.spawned) where = 'not spawned';
      else if (r.finished) where = 'finished';
      else if (r.currentStop) where = 'at ' + stopName(r.currentStop);
      else where = 'moving';
      var next = r.finished ? '--' : stopName(r.nextStop) + ' ' + B.fmt(r.nextStopEta);
      tr.innerHTML = '<td>' + r.id.replace('route', 'R') + '</td><td>' + r.spawn + '</td><td>' + where +
        '</td><td class="num">' + next + '</td>';
      tr.style.cursor = 'pointer';
      tr.onclick = function () { state.routeId = r.id; render(); };
      tb.appendChild(tr);
    });
  }

  function stopName(id) {
    return (D.stops[id] && D.stops[id].name) || id;
  }

  // ---- accuracy card ----
  function renderConfidence() {
    var c = D.confidence;
    $('conf').innerHTML = '<div style="margin-bottom:6px">' + c.note + '</div>' +
      '<div>Checked ' + c.checkedAt + ' by ' + c.by + '.</div>';
    var rows = (c.items || []).map(function (i) {
      var cls = i.status === 'high' ? 'hi' : (i.status === 'low' ? 'lo' : '');
      return '<li>' + i.key + ': <b>' + i.value + '</b> <span class="pill ' + cls + '">' + i.status + ' confidence</span>' +
        '<div style="color:#6b7a6e">' + i.why + '</div></li>';
    }).join('');
    $('confdetail').innerHTML = '<ul style="padding-left:16px;margin:0">' + rows + '</ul>' +
      '<div style="margin-top:8px">' + (D.meta.source || '') + '</div>';
  }

  // ---- input ----
  function setRaid(t, live) {
    state.raidTime = t;
    state.live = !!live;
    state.lastTick = Date.now();
    render();
  }

  function submit() {
    var v = $('raid').value;
    var t = B.parseRaidTime(v);
    if (t === null || t > RAID) { $('err').style.display = 'block'; return; }
    $('err').style.display = 'none';
    setRaid(t, true);
  }

  $('go').onclick = submit;
  $('raid').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  $('raid').addEventListener('input', function () {
    var t = B.parseRaidTime($('raid').value);
    if (t !== null && t <= RAID) { $('err').style.display = 'none'; setRaid(t, false); }
  });

  // chips
  var chips = [30, 25, 20, 15, 10, 5];
  chips.forEach(function (m) {
    var b = document.createElement('div');
    b.className = 'chip';
    b.textContent = m + ':00';
    b.onclick = function () { $('raid').value = m + ':00'; setRaid(m * 60, true); };
    $('chips').appendChild(b);
  });

  // ---- boot ----
  buildMap();
  renderConfidence();
  state.routeId = D.routes[0].id;
  $('raid').value = '23:45';
  setRaid(23 * 60 + 45, true);

  // live countdown once a raid time is entered
  setInterval(function () {
    if (!state.live || state.raidTime === null) return;
    var dt = Math.round((Date.now() - state.lastTick) / 1000);
    if (dt <= 0) return;
    state.lastTick = Date.now();
    var t = state.raidTime - dt;
    if (t < 0) t = 0;
    state.raidTime = t;
    render();
  }, 1000);
})();
