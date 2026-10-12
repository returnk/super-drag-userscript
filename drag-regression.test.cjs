const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const script = fs.readFileSync(`${__dirname}/super-drag.user.js`, 'utf8');
const engine = script.slice(script.indexOf('const DragEngine ='), script.indexOf('const DragEngine =') + script.slice(script.indexOf('const DragEngine =')).indexOf('})();') + 5);

function replay({ drop = false, cancel = false, rightClick = false, x = 421, y = 201, focus = true, frame = false, elapsed = 429, over = true, type = 'text', action = 'searchText', defined = true } = {}) {
    const handlers = {};
    let calls = 0;
    let now = 0;
    let layer = null;
    const context = {
        window: {
            location: { hostname: 'example.com' }, innerWidth: 1000, innerHeight: 800,
            getSelection: () => ({ toString: () => type === 'text' ? 'test' : '' }),
            addEventListener: (name, handler) => { handlers[name] = handler; }
        },
        document: {
            activeElement: null,
            createElement: () => ({ style: { setProperty() {} }, remove() { layer = null; } }),
            documentElement: { appendChild(node) { layer = node; } },
            hasFocus: () => focus, elementFromPoint: () => ({ tagName: frame ? 'IFRAME' : 'DIV' })
        },
        Date: { now: () => now },
        cfg: { blacklist: '', Gesture: { distanceThreshold: 5, distanceSensitivity: 20 }, Drag: {}, [type]: defined ? { '9': { name: action, arg: [] } } : {} },
        HUD: { hide() {}, update() {} }, Toast: { show() {} },
        Actions: { [action]() { calls++; } }, recordMetric() {}, console
    };
    vm.createContext(context);
    vm.runInContext(`${engine}; DragEngine.init(); globalThis.cancelDrag = DragEngine.cancel;`, context);
    const target = type === 'image' ? { nodeName: 'IMG', src: 'https://example.com/image.png' } :
        type === 'link' ? { nodeName: 'A', closest: selector => selector === 'a, area' ? ({ href: 'https://example.com/', textContent: 'link' }) : null } : { nodeName: '#text' };
    handlers.dragstart({ target, clientX: 350, clientY: 135 });
    assert.ok(layer, 'drag receiver covers iframe during active drag');
    now = 48;
    handlers.drag({ clientX: 400, clientY: 183 });
    if (over) handlers.dragover({ clientX: 400, clientY: 183, preventDefault() {} });
    if (cancel) context.cancelDrag(); // Existing Escape listener calls this same method.
    if (rightClick) handlers.mousedown({ button: 2, preventDefault() {}, stopPropagation() {} });
    now = elapsed;
    if (drop) handlers.drop({ clientX: x, clientY: y, preventDefault() {} });
    handlers.dragend({ clientX: x, clientY: y });
    assert.equal(layer, null, 'drag receiver is removed after ending or cancelling');
    return calls;
}

test('native Escape ending without keydown or drop never searches', () => assert.equal(replay(), 0));
test('native Escape over player without keydown never searches', () => assert.equal(replay({ frame: true, elapsed: 980 }), 0));
test('normal drop executes once', () => assert.equal(replay({ drop: true }), 1));
test('release on receiver over player executes once', () => assert.equal(replay({ drop: true, frame: true, elapsed: 980, x: 553, y: 320 }), 1));
test('long drag on player receiver executes once', () => assert.equal(replay({ drop: true, frame: true, elapsed: 5000 }), 1));
test('copy action on receiver executes once', () => assert.equal(replay({ drop: true, action: 'copyText', frame: true }), 1));
test('link action on receiver executes once', () => assert.equal(replay({ drop: true, type: 'link', action: 'openLink', frame: true }), 1));
test('image action on receiver executes once', () => assert.equal(replay({ drop: true, type: 'image', action: 'copyImgURL', frame: true }), 1));
test('undefined gesture still does nothing', () => assert.equal(replay({ defined: false, frame: true }), 0));
for (const [name, options] of Object.entries({
    'Escape cancellation': { cancel: true }, 'right-click cancellation': { rightClick: true },
    'outside viewport': { x: 1001 }, 'invalid end coordinates': { x: 0, y: 0 },
    'lost focus': { focus: false }, 'cancel over iframe': { cancel: true, frame: true },
    'stale dragover': { elapsed: 2000 }, 'no dragover': { over: false }
})) test(`${name} does not search`, () => assert.equal(replay(options), 0));

const search = script.slice(script.indexOf('const SKRBT_PENDING_KEY'), script.indexOf('function consumeSkrbtPendingSearch'));
function searchResult(result) {
    const opened = [];
    const values = new Map();
    const context = {
        URL, Date, console, Toast: { show() {} },
        GM_setValue: (key, value) => values.set(key, value),
        GM_openInTab: url => opened.push(url),
        GM_xmlhttpRequest: options => {
            if (result === 'error') options.onerror();
            else if (result === 'timeout') options.ontimeout();
            else options.onload({ status: result });
        }
    };
    vm.createContext(context);
    vm.runInContext(`${search}; queueSkrbtSearch('test', true, true);`, context);
    return { opened, pending: values.size };
}
for (const result of ['error', 404, 410, 500, 503]) {
    test(`SkrBT failure ${result} opens publication page without pending search`, () => {
        const actual = searchResult(result);
        assert.deepEqual(actual.opened, ['https://btskr.net/']);
        assert.equal(actual.pending, 0);
    });
}
for (const result of [200, 403, 429, 'timeout']) {
    test(`SkrBT ${result} keeps original search instead of declaring failure`, () => {
        const actual = searchResult(result);
        assert.deepEqual(actual.opened, ['https://skrbtso.cc/']);
        assert.equal(actual.pending, 1);
    });
}
