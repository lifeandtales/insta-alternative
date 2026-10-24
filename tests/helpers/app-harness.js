import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

// A small DOM substitute for logic/rendering tests. Browser checks still cover layout.
export function createEnvironment() {
    const elements = new Map();
    const listeners = [];
    const storage = new Map();
    function element(key) {
        if (elements.has(key)) return elements.get(key);
        const attributes = new Map();
        const classes = new Set();
        const result = {
            innerHTML: '', textContent: '', value: '', hidden: true, dataset: {},
            scrollTop: 0, scrollHeight: 100, children: [], style: {}, isConnected: true,
            classList: {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                contains: name => classes.has(name),
                toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
            },
            addEventListener: (type, callback) => listeners.push({key, type, callback}),
            querySelector: selector => element(key + ' ' + selector),
            querySelectorAll: () => [],
            setAttribute: (name, value) => attributes.set(name, value),
            getAttribute: name => attributes.get(name),
            removeAttribute: name => attributes.delete(name),
            replaceChildren: () => { result.innerHTML = ''; },
            focus() {}, pause() {}, play: async () => {},
            closest: () => null, matches: () => false,
            getBoundingClientRect: () => ({top: 0, bottom: 100, right: 100})
        };
        elements.set(key, result);
        return result;
    }
    const document = {
        querySelector: element,
        querySelectorAll: () => [],
        getElementById: id => element('#' + id),
        createElement: tag => element('new-' + tag),
        addEventListener: (type, callback) => listeners.push({key: 'document', type, callback}),
        body: element('body'), documentElement: element('html')
    };
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : [1792738800000])); }
        static now() { return 1792738800000; }
    }
    const math = Object.create(Math);
    math.random = () => 0.5;
    const localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value)
    };
    const window = {setTimeout: () => 1, clearTimeout() {}, location: {href: 'http://localhost:8000/'}};
    const context = vm.createContext({
        document, window, localStorage, Date: FixedDate, Math: math,
        navigator: {}, URL, Blob, console: {error() {}, log() {}},
        setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
        requestAnimationFrame: callback => callback()
    });
    return {context, document, element, elements, listeners, storage};
}

export async function loadApp() {
    const environment = createEnvironment();
    const modules = new Map();
    function getModule(filename) {
        filename = path.resolve(filename);
        if (!modules.has(filename)) {
            modules.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), {
                context: environment.context, identifier: filename
            }));
        }
        return modules.get(filename);
    }
    const entry = getModule(path.join(root, 'app.js'));
    await entry.link((specifier, parent) => getModule(path.resolve(path.dirname(parent.identifier), specifier.split('?')[0])));
    await entry.evaluate();
    await Promise.resolve();
    const exportsOf = relative => modules.get(path.join(root, relative)).namespace;
    return {...environment, exportsOf, modules};
}
