const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const script = fs.readFileSync(`${__dirname}/super-drag.user.js`, 'utf8');
const engine = script.slice(script.indexOf('const DragEngine ='), script.indexOf('const DragEngine =') + script.slice(script.indexOf('const DragEngine =')).indexOf('})();') + 5);

function replay({ drop = false, cancel = false, rightClick = false, x = 421, y = 201, focus = true, frame = false, elapsed = 429, over = true } = {}) {
    const handlers = {};
    let calls = 0;
    let now = 0;
    const context = {
        window: {
            location: { hostname: 'example.com' }, innerWidth: 1000, innerHeight: 800,
            getSelection: () => ({ toString: () => 'test' }),
            addEventListener: (name, handler) => { handlers[name] = handler; }
        },
        document: { activeElement: null, hasFocus: () => focus, elementFromPoint: () => ({ tagName: frame ? 'IFRAME' : 'DIV' }) },
        Date: { now: () => now },
        cfg: { blacklist: '', Gesture: { distanceThreshold: 5, distanceSensitivity: 20 }, Drag: {}, text: { '9': { name: 'searchText', alias: 'SkrBT', arg: [] } } },
        HUD: { hide() {}, update() {} }, Toast: { show() {} },
        Actions: { searchText() { calls++; } }, recordMetric() {}, console
    };
    vm.createContext(context);
    vm.runInContext(`${engine}; DragEngine.init(); globalThis.cancelDrag = DragEngine.cancel;`, context);
    handlers.dragstart({ target: { nodeName: '#text' }, clientX: 350, clientY: 135 });
    now = 48;
    handlers.drag({ clientX: 400, clientY: 183 });
    if (over) handlers.dragover({ clientX: 400, clientY: 183, preventDefault() {} });
    if (cancel) context.cancelDrag(); // Existing Escape listener calls this same method.
    if (rightClick) handlers.mousedown({ button: 2, preventDefault() {}, stopPropagation() {} });
    now = elapsed;
    if (drop) handlers.drop({ clientX: x, clientY: y, preventDefault() {} });
    handlers.dragend({ clientX: x, clientY: y });
    return calls;
}

test('reported missing-drop sequence executes once', () => assert.equal(replay(), 1));
test('normal drop executes once', () => assert.equal(replay({ drop: true }), 1));
for (const [name, options] of Object.entries({
    'Escape cancellation': { cancel: true }, 'right-click cancellation': { rightClick: true },
    'outside viewport': { x: 1001 }, 'invalid end coordinates': { x: 0, y: 0 },
    'lost focus': { focus: false }, 'iframe destination': { frame: true },
    'stale dragover': { elapsed: 2000 }, 'no dragover': { over: false }
})) test(`${name} does not search`, () => assert.equal(replay(options), 0));
