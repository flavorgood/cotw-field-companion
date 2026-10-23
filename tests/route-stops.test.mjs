import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRouteStops,routePlan,formatZoneHours} from '../public/route-stops.js';

test('a saved route with no matching zones still has visible, removable stop identities', () => {
  const route = Object.freeze(['old-zone:19:123']);
  assert.deepEqual(resolveRouteStops(route, []), [
    {id: 'old-zone:19:123', number: 1, zone: null},
  ]);
});

test('missing stops keep their original position among known stops', () => {
  const first = Object.freeze({id: 'first', species: 'Moose'});
  const last = Object.freeze({id: 'last', species: 'Red Deer'});
  const route = Object.freeze(['first', 'missing', 'last']);
  const zones = Object.freeze([last, first]);
  const stops = resolveRouteStops(route, zones);
  assert.equal(stops.length, route.length, 'the displayed count includes every saved stop');
  assert.deepEqual(stops.map(stop => [stop.id, stop.number]), [['first', 1], ['missing', 2], ['last', 3]]);
  assert.equal(stops[0].zone, first);
  assert.equal(stops[1].zone, null);
  assert.equal(stops[2].zone, last);
  assert.deepEqual(route, ['first', 'missing', 'last'], 'resolving a route does not change saved IDs');
  assert.deepEqual(zones, [last, first], 'resolving a route does not reorder zones');
});

test('a similar ID or matching display name never substitutes for a missing zone', () => {
  const zones = [
    {id: 'ZONE-1', annotation: {name: 'zone-1'}},
    {id: ' zone-1 ', species: 'zone-1'},
  ];
  assert.deepEqual(resolveRouteStops(['zone-1'], zones), [{id: 'zone-1', number: 1, zone: null}]);
});

test('opaque and repeated saved IDs are preserved without normalization or silent removal', () => {
  const route = ['zone:<old>&"', 'missing', 'missing'];
  const stops = resolveRouteStops(route, []);
  assert.deepEqual(stops.map(stop => stop.id), route);
  assert.deepEqual(stops.map(stop => stop.number), [1, 2, 3]);
  assert.ok(stops.every(stop => stop.zone === null));
});

test('only an empty saved route resolves to an empty list', () => {
  assert.deepEqual(resolveRouteStops([], [{id: 'available'}]), []);
  assert.equal(resolveRouteStops(['missing'], []).length, 1);
});

test('route distances include only adjacent available stops and never bridge a missing middle', () => {
  const zones = Object.freeze([
    Object.freeze({id: 'a', x: 0, z: 0}),
    Object.freeze({id: 'b', x: 300, z: 400}),
    Object.freeze({id: 'c', x: 300, z: 800}),
  ]);
  const route = Object.freeze(['a', 'missing', 'b', 'c']);
  const plan = routePlan(route, zones);
  assert.deepEqual(plan.stops.map(stop => [stop.id, stop.number, stop.valid]), [
    ['a', 1, true], ['missing', 2, false], ['b', 3, true], ['c', 4, true],
  ]);
  assert.deepEqual(plan.legs.map(leg => [leg.from.number, leg.to.number, leg.distanceMeters]), [[3, 4, 400]]);
  assert.equal(plan.knownDistanceMeters, 400);
  assert.equal(plan.missingCount, 1);
  assert.deepEqual(route, ['a', 'missing', 'b', 'c']);
});

test('route order and repeated stop numbers determine each directed straight-line leg', () => {
  const zones = [{id: 'b', x: 300, z: 400}, {id: 'a', x: 0, z: 0}];
  const plan = routePlan(['a', 'b', 'a', 'a'], zones);
  assert.deepEqual(plan.legs.map(leg => [leg.from.id, leg.to.id, leg.from.number, leg.to.number, leg.distanceMeters]), [
    ['a', 'b', 1, 2, 500], ['b', 'a', 2, 3, 500], ['a', 'a', 3, 4, 0],
  ]);
  assert.equal(plan.knownDistanceMeters, 1000);
  assert.equal(plan.missingCount, 0);
});

test('invalid coordinates break a route instead of becoming zero or a connecting shortcut', () => {
  for (const invalid of [null, undefined, NaN, Infinity, -Infinity, '400']) {
    for (const axis of ['x', 'z']) {
      const bad = {id: 'bad', x: 400, z: 400, [axis]: invalid};
      const plan = routePlan(['a', 'bad', 'b'], [{id: 'a', x: 0, z: 0}, bad, {id: 'b', x: 500, z: 0}]);
      assert.equal(plan.stops[1].zone, bad, 'invalid stops retain their identity and source record');
      assert.equal(plan.stops[1].valid, false);
      assert.deepEqual(plan.legs, []);
      assert.equal(plan.knownDistanceMeters, 0);
      assert.equal(plan.missingCount, 1);
    }
  }
});

test('empty and fully missing routes report no measured legs', () => {
  assert.deepEqual(routePlan([], []), {stops: [], legs: [], knownDistanceMeters: 0, missingCount: 0});
  const plan = routePlan(['missing', 'also-missing'], []);
  assert.equal(plan.missingCount, 2);
  assert.deepEqual(plan.legs, []);
});

test('zone hours preserve genuine midnight and round minute rollover', () => {
  assert.equal(formatZoneHours(0, 4.5), '00:00–04:30');
  assert.equal(formatZoneHours(8.999, 12.25), '09:00–12:15');
  assert.equal(formatZoneHours(23.999, 24), '24:00–24:00');
  assert.equal(formatZoneHours(0, 24), '00:00–24:00');
});

test('overnight zone hours are labeled as an in-game range rather than an arrival estimate', () => {
  assert.equal(formatZoneHours(20, 2), '20:00–02:00 (overnight)');
  assert.equal(formatZoneHours(22.5, 0), '22:30–00:00 (overnight)');
});

test('unknown and out-of-range zone hours are unavailable rather than midnight', () => {
  for (const invalid of [null, undefined, NaN, Infinity, -Infinity, -0.01, 24.01, '8']) {
    assert.equal(formatZoneHours(invalid, 9), 'Hours unavailable');
    assert.equal(formatZoneHours(8, invalid), 'Hours unavailable');
  }
});
