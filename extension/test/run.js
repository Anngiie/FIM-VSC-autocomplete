// Maintained checks for the extension's pure logic (no VS Code API needed).
// Run with: npm test  (compiles first via the "pretest" script)
const assert = require('node:assert');
const p = require('../out/platform.js');

// --- ghost color compose ---
assert.equal(p.composeGhostColor('#8b8b8b', 0.55), '#8b8b8b8c');
assert.equal(p.composeGhostColor('#ffffff', 1), '#ffffffff');
assert.equal(p.composeGhostColor('#000000', 0), '#00000000');
assert.equal(p.composeGhostColor('#112233', 2), '#112233ff'); // clamped
assert.equal(p.composeGhostColor('#112233', -1), '#11223300'); // clamped
assert.throws(() => p.composeGhostColor('red', 0.5), /Invalid color/);
assert.throws(() => p.composeGhostColor('#fff', 0.5), /Invalid color/);

// --- ghost color parse ---
assert.deepEqual(p.parseGhostColor('#8b8b8b8c'), { custom: true, color: '#8b8b8b', opacity: 0.55 });
assert.deepEqual(p.parseGhostColor('#FFFFFF'), { custom: true, color: '#ffffff', opacity: 1 });
assert.deepEqual(p.parseGhostColor(undefined), { custom: false, color: '#8b8b8b', opacity: 0.55 });
assert.deepEqual(p.parseGhostColor('not-a-color'), { custom: false, color: '#8b8b8b', opacity: 0.55 });

// --- round-trip ---
const composed = p.composeGhostColor('#a1b2c3', 0.4);
assert.deepEqual(p.parseGhostColor(composed), { custom: true, color: '#a1b2c3', opacity: 0.4 });

// --- URL / server location helpers ---
assert.equal(p.isLocalUrl('http://127.0.0.1:8080'), true);
assert.equal(p.isLocalUrl('http://localhost:8080'), true);
assert.equal(p.isLocalUrl('http://[::1]:8080'), true);
assert.equal(p.isLocalUrl('http://192.168.1.50:8080'), false);
assert.equal(p.isLocalUrl('https://example.com'), false);
assert.equal(p.isLocalUrl('not a url'), false);
assert.equal(p.hostFromUrl('http://192.168.1.50:8080'), '192.168.1.50:8080');
assert.equal(p.hostFromUrl('http://localhost'), 'localhost');
assert.equal(p.portFromUrl('http://127.0.0.1:8080'), 8080);
assert.equal(p.portFromUrl('http://localhost'), 8080);

console.log('platform tests passed');
