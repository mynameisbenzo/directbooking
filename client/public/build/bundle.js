
(function(l, r) { if (l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (window.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(window.document);
var app = (function () {
    'use strict';

    function noop() { }
    // Adapted from https://github.com/then/is-promise/blob/master/index.js
    // Distributed under MIT License https://github.com/then/is-promise/blob/master/LICENSE
    function is_promise(value) {
        return !!value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
    }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    let src_url_equal_anchor;
    function src_url_equal(element_src, url) {
        if (!src_url_equal_anchor) {
            src_url_equal_anchor = document.createElement('a');
        }
        src_url_equal_anchor.href = url;
        return element_src === src_url_equal_anchor.href;
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function prevent_default(fn) {
        return function (event) {
            event.preventDefault();
            // @ts-ignore
            return fn.call(this, event);
        };
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        if (value == null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function select_options(select, value) {
        for (let i = 0; i < select.options.length; i += 1) {
            const option = select.options[i];
            option.selected = ~value.indexOf(option.__value);
        }
    }
    function select_multiple_value(select) {
        return [].map.call(select.querySelectorAll(':checked'), option => option.__value);
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
     * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
     * it can be called from an external module).
     *
     * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
     *
     * https://svelte.dev/docs#run-time-svelte-onmount
     */
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }
    // TODO figure out if we still want to support
    // shorthand events, or if we want to implement
    // a real bubbling mechanism
    function bubble(component, event) {
        const callbacks = component.$$.callbacks[event.type];
        if (callbacks) {
            // @ts-ignore
            callbacks.slice().forEach(fn => fn.call(this, event));
        }
    }

    const dirty_components = [];
    const binding_callbacks = [];
    let render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = /* @__PURE__ */ Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    /**
     * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
     */
    function flush_render_callbacks(fns) {
        const filtered = [];
        const targets = [];
        render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
        targets.forEach((c) => c());
        render_callbacks = filtered;
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }

    function handle_promise(promise, info) {
        const token = info.token = {};
        function update(type, index, key, value) {
            if (info.token !== token)
                return;
            info.resolved = value;
            let child_ctx = info.ctx;
            if (key !== undefined) {
                child_ctx = child_ctx.slice();
                child_ctx[key] = value;
            }
            const block = type && (info.current = type)(child_ctx);
            let needs_flush = false;
            if (info.block) {
                if (info.blocks) {
                    info.blocks.forEach((block, i) => {
                        if (i !== index && block) {
                            group_outros();
                            transition_out(block, 1, 1, () => {
                                if (info.blocks[i] === block) {
                                    info.blocks[i] = null;
                                }
                            });
                            check_outros();
                        }
                    });
                }
                else {
                    info.block.d(1);
                }
                block.c();
                transition_in(block, 1);
                block.m(info.mount(), info.anchor);
                needs_flush = true;
            }
            info.block = block;
            if (info.blocks)
                info.blocks[index] = block;
            if (needs_flush) {
                flush();
            }
        }
        if (is_promise(promise)) {
            const current_component = get_current_component();
            promise.then(value => {
                set_current_component(current_component);
                update(info.then, 1, info.value, value);
                set_current_component(null);
            }, error => {
                set_current_component(current_component);
                update(info.catch, 2, info.error, error);
                set_current_component(null);
                if (!info.hasCatch) {
                    throw error;
                }
            });
            // if we previously had a then/catch block, destroy it
            if (info.current !== info.pending) {
                update(info.pending, 0);
                return true;
            }
        }
        else {
            if (info.current !== info.then) {
                update(info.then, 1, info.value, promise);
                return true;
            }
            info.resolved = promise;
        }
    }
    function update_await_block_branch(info, ctx, dirty) {
        const child_ctx = ctx.slice();
        const { resolved } = info;
        if (info.current === info.then) {
            child_ctx[info.value] = resolved;
        }
        if (info.current === info.catch) {
            child_ctx[info.error] = resolved;
        }
        info.block.p(child_ctx, dirty);
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            flush_render_callbacks($$.after_update);
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.59.2' }, detail), { bubbles: true }));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation, has_stop_immediate_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        if (has_stop_immediate_propagation)
            modifiers.push('stopImmediatePropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function prop_dev(node, property, value) {
        node[property] = value;
        dispatch_dev('SvelteDOMSetProperty', { node, property, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    function construct_svelte_component_dev(component, props) {
        const error_message = 'this={...} of <svelte:component> should specify a Svelte component.';
        try {
            const instance = new component(props);
            if (!instance.$$ || !instance.$set || !instance.$on || !instance.$destroy) {
                throw new Error(error_message);
            }
            return instance;
        }
        catch (err) {
            const { message } = err;
            if (typeof message === 'string' && message.indexOf('is not a constructor') !== -1) {
                throw new Error(error_message);
            }
            else {
                throw err;
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    //test with params
    function randData(params = "key for properties") {
      return fetch(`/randData?params=${params}`)
        .then((r) => r.json())
        .then((data) => {
          // console.log(data)
          return data
        })
    }
    //test without
    function randName(){
      return fetch("/test")
        .then((r) => r.json())
        .then((data) => {
          // console.log(data)
          return data
        })
    }

    /* src/components/UI/Input.svelte generated by Svelte v3.59.2 */

    const file = "src/components/UI/Input.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[5] = list[i];
    	return child_ctx;
    }

    // (68:37) 
    function create_if_block_3(ctx) {
    	let div;
    	let select;
    	let mounted;
    	let dispose;
    	let each_value = /*multivalue*/ ctx[8];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			select = element("select");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			select.multiple = true;
    			attr_dev(select, "name", /*id*/ ctx[1]);
    			attr_dev(select, "id", /*id*/ ctx[1]);
    			if (/*values*/ ctx[7] === void 0) add_render_callback(() => /*select_change_handler*/ ctx[14].call(select));
    			add_location(select, file, 69, 6, 1553);
    			add_location(div, file, 68, 4, 1541);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, select);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				if (each_blocks[i]) {
    					each_blocks[i].m(select, null);
    				}
    			}

    			select_options(select, /*values*/ ctx[7]);

    			if (!mounted) {
    				dispose = [
    					listen_dev(select, "change", /*select_change_handler*/ ctx[14]),
    					listen_dev(select, "input", /*input_handler_2*/ ctx[11], false, false, false, false),
    					listen_dev(select, "blur", /*blur_handler_2*/ ctx[15], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*multivalue*/ 256) {
    				each_value = /*multivalue*/ ctx[8];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(select, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*id*/ 2) {
    				attr_dev(select, "name", /*id*/ ctx[1]);
    			}

    			if (dirty & /*id*/ 2) {
    				attr_dev(select, "id", /*id*/ ctx[1]);
    			}

    			if (dirty & /*values, multivalue*/ 384) {
    				select_options(select, /*values*/ ctx[7]);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_3.name,
    		type: "if",
    		source: "(68:37) ",
    		ctx
    	});

    	return block;
    }

    // (66:30) 
    function create_if_block_2(ctx) {
    	let input;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			input = element("input");
    			attr_dev(input, "type", /*type*/ ctx[0]);
    			attr_dev(input, "id", /*id*/ ctx[1]);
    			input.value = /*value*/ ctx[5];
    			attr_dev(input, "class", "svelte-1o27zn2");
    			toggle_class(input, "invalid", !/*valid*/ ctx[3] && /*touched*/ ctx[6]);
    			add_location(input, file, 66, 4, 1373);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, input, anchor);

    			if (!mounted) {
    				dispose = [
    					listen_dev(input, "input", /*input_handler_1*/ ctx[10], false, false, false, false),
    					listen_dev(input, "blur", /*blur_handler_1*/ ctx[13], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*type*/ 1) {
    				attr_dev(input, "type", /*type*/ ctx[0]);
    			}

    			if (dirty & /*id*/ 2) {
    				attr_dev(input, "id", /*id*/ ctx[1]);
    			}

    			if (dirty & /*value*/ 32 && input.value !== /*value*/ ctx[5]) {
    				prop_dev(input, "value", /*value*/ ctx[5]);
    			}

    			if (dirty & /*valid, touched*/ 72) {
    				toggle_class(input, "invalid", !/*valid*/ ctx[3] && /*touched*/ ctx[6]);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(input);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2.name,
    		type: "if",
    		source: "(66:30) ",
    		ctx
    	});

    	return block;
    }

    // (64:4) {#if type === "text"}
    function create_if_block_1(ctx) {
    	let input;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			input = element("input");
    			attr_dev(input, "type", /*type*/ ctx[0]);
    			attr_dev(input, "id", /*id*/ ctx[1]);
    			input.value = /*value*/ ctx[5];
    			attr_dev(input, "class", "svelte-1o27zn2");
    			toggle_class(input, "invalid", !/*valid*/ ctx[3] && /*touched*/ ctx[6]);
    			add_location(input, file, 64, 4, 1216);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, input, anchor);

    			if (!mounted) {
    				dispose = [
    					listen_dev(input, "input", /*input_handler*/ ctx[9], false, false, false, false),
    					listen_dev(input, "blur", /*blur_handler*/ ctx[12], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*type*/ 1) {
    				attr_dev(input, "type", /*type*/ ctx[0]);
    			}

    			if (dirty & /*id*/ 2) {
    				attr_dev(input, "id", /*id*/ ctx[1]);
    			}

    			if (dirty & /*value*/ 32 && input.value !== /*value*/ ctx[5]) {
    				prop_dev(input, "value", /*value*/ ctx[5]);
    			}

    			if (dirty & /*valid, touched*/ 72) {
    				toggle_class(input, "invalid", !/*valid*/ ctx[3] && /*touched*/ ctx[6]);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(input);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1.name,
    		type: "if",
    		source: "(64:4) {#if type === \\\"text\\\"}",
    		ctx
    	});

    	return block;
    }

    // (71:8) {#each multivalue as value}
    function create_each_block(ctx) {
    	let option;
    	let t0_value = /*value*/ ctx[5] + "";
    	let t0;
    	let t1;
    	let option_value_value;

    	const block = {
    		c: function create() {
    			option = element("option");
    			t0 = text(t0_value);
    			t1 = space();
    			option.__value = option_value_value = /*value*/ ctx[5];
    			option.value = option.__value;
    			add_location(option, file, 71, 10, 1700);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, option, anchor);
    			append_dev(option, t0);
    			append_dev(option, t1);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(option);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(71:8) {#each multivalue as value}",
    		ctx
    	});

    	return block;
    }

    // (80:4) {#if validityMessage && !valid && touched}
    function create_if_block(ctx) {
    	let p;
    	let t;

    	const block = {
    		c: function create() {
    			p = element("p");
    			t = text(/*validityMessage*/ ctx[4]);
    			attr_dev(p, "class", "error-message svelte-1o27zn2");
    			add_location(p, file, 80, 8, 1882);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    			append_dev(p, t);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*validityMessage*/ 16) set_data_dev(t, /*validityMessage*/ ctx[4]);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(80:4) {#if validityMessage && !valid && touched}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let div;
    	let label_1;
    	let t0;
    	let t1;
    	let t2;

    	function select_block_type(ctx, dirty) {
    		if (/*type*/ ctx[0] === "text") return create_if_block_1;
    		if (/*type*/ ctx[0] === "date") return create_if_block_2;
    		if (/*type*/ ctx[0] === "multiselect") return create_if_block_3;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block0 = current_block_type && current_block_type(ctx);
    	let if_block1 = /*validityMessage*/ ctx[4] && !/*valid*/ ctx[3] && /*touched*/ ctx[6] && create_if_block(ctx);

    	const block = {
    		c: function create() {
    			div = element("div");
    			label_1 = element("label");
    			t0 = text(/*label*/ ctx[2]);
    			t1 = space();
    			if (if_block0) if_block0.c();
    			t2 = space();
    			if (if_block1) if_block1.c();
    			attr_dev(label_1, "for", /*id*/ ctx[1]);
    			attr_dev(label_1, "class", "svelte-1o27zn2");
    			add_location(label_1, file, 62, 4, 1152);
    			attr_dev(div, "class", "form-control svelte-1o27zn2");
    			add_location(div, file, 61, 0, 1121);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, label_1);
    			append_dev(label_1, t0);
    			append_dev(div, t1);
    			if (if_block0) if_block0.m(div, null);
    			append_dev(div, t2);
    			if (if_block1) if_block1.m(div, null);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*label*/ 4) set_data_dev(t0, /*label*/ ctx[2]);

    			if (dirty & /*id*/ 2) {
    				attr_dev(label_1, "for", /*id*/ ctx[1]);
    			}

    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block0) {
    				if_block0.p(ctx, dirty);
    			} else {
    				if (if_block0) if_block0.d(1);
    				if_block0 = current_block_type && current_block_type(ctx);

    				if (if_block0) {
    					if_block0.c();
    					if_block0.m(div, t2);
    				}
    			}

    			if (/*validityMessage*/ ctx[4] && !/*valid*/ ctx[3] && /*touched*/ ctx[6]) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block(ctx);
    					if_block1.c();
    					if_block1.m(div, null);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);

    			if (if_block0) {
    				if_block0.d();
    			}

    			if (if_block1) if_block1.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Input', slots, []);
    	let { type = null } = $$props;
    	let { id } = $$props;
    	let { value } = $$props;
    	let { label } = $$props;
    	let { valid = true } = $$props;
    	let { validityMessage = "" } = $$props;
    	let touched = false;
    	let multivalue = ['one', 'two', 'three'];
    	let values = multivalue;

    	$$self.$$.on_mount.push(function () {
    		if (id === undefined && !('id' in $$props || $$self.$$.bound[$$self.$$.props['id']])) {
    			console.warn("<Input> was created without expected prop 'id'");
    		}

    		if (value === undefined && !('value' in $$props || $$self.$$.bound[$$self.$$.props['value']])) {
    			console.warn("<Input> was created without expected prop 'value'");
    		}

    		if (label === undefined && !('label' in $$props || $$self.$$.bound[$$self.$$.props['label']])) {
    			console.warn("<Input> was created without expected prop 'label'");
    		}
    	});

    	const writable_props = ['type', 'id', 'value', 'label', 'valid', 'validityMessage'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Input> was created with unknown prop '${key}'`);
    	});

    	function input_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	function input_handler_1(event) {
    		bubble.call(this, $$self, event);
    	}

    	function input_handler_2(event) {
    		bubble.call(this, $$self, event);
    	}

    	const blur_handler = () => $$invalidate(6, touched = true);
    	const blur_handler_1 = () => $$invalidate(6, touched = true);

    	function select_change_handler() {
    		values = select_multiple_value(this);
    		$$invalidate(7, values);
    		$$invalidate(8, multivalue);
    	}

    	const blur_handler_2 = () => $$invalidate(6, touched = true);

    	$$self.$$set = $$props => {
    		if ('type' in $$props) $$invalidate(0, type = $$props.type);
    		if ('id' in $$props) $$invalidate(1, id = $$props.id);
    		if ('value' in $$props) $$invalidate(5, value = $$props.value);
    		if ('label' in $$props) $$invalidate(2, label = $$props.label);
    		if ('valid' in $$props) $$invalidate(3, valid = $$props.valid);
    		if ('validityMessage' in $$props) $$invalidate(4, validityMessage = $$props.validityMessage);
    	};

    	$$self.$capture_state = () => ({
    		type,
    		id,
    		value,
    		label,
    		valid,
    		validityMessage,
    		touched,
    		multivalue,
    		values
    	});

    	$$self.$inject_state = $$props => {
    		if ('type' in $$props) $$invalidate(0, type = $$props.type);
    		if ('id' in $$props) $$invalidate(1, id = $$props.id);
    		if ('value' in $$props) $$invalidate(5, value = $$props.value);
    		if ('label' in $$props) $$invalidate(2, label = $$props.label);
    		if ('valid' in $$props) $$invalidate(3, valid = $$props.valid);
    		if ('validityMessage' in $$props) $$invalidate(4, validityMessage = $$props.validityMessage);
    		if ('touched' in $$props) $$invalidate(6, touched = $$props.touched);
    		if ('multivalue' in $$props) $$invalidate(8, multivalue = $$props.multivalue);
    		if ('values' in $$props) $$invalidate(7, values = $$props.values);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		type,
    		id,
    		label,
    		valid,
    		validityMessage,
    		value,
    		touched,
    		values,
    		multivalue,
    		input_handler,
    		input_handler_1,
    		input_handler_2,
    		blur_handler,
    		blur_handler_1,
    		select_change_handler,
    		blur_handler_2
    	];
    }

    class Input extends SvelteComponentDev {
    	constructor(options) {
    		super(options);

    		init(this, options, instance, create_fragment, safe_not_equal, {
    			type: 0,
    			id: 1,
    			value: 5,
    			label: 2,
    			valid: 3,
    			validityMessage: 4
    		});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Input",
    			options,
    			id: create_fragment.name
    		});
    	}

    	get type() {
    		throw new Error("<Input>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set type(value) {
    		throw new Error("<Input>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get id() {
    		throw new Error("<Input>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set id(value) {
    		throw new Error("<Input>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get value() {
    		throw new Error("<Input>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set value(value) {
    		throw new Error("<Input>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get label() {
    		throw new Error("<Input>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set label(value) {
    		throw new Error("<Input>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get valid() {
    		throw new Error("<Input>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set valid(value) {
    		throw new Error("<Input>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get validityMessage() {
    		throw new Error("<Input>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set validityMessage(value) {
    		throw new Error("<Input>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/routes/rand/Body.svelte generated by Svelte v3.59.2 */
    const file$1 = "src/routes/rand/Body.svelte";

    // (1:0) <script>   import { randData }
    function create_catch_block(ctx) {
    	const block = { c: noop, m: noop, p: noop, d: noop };

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_catch_block.name,
    		type: "catch",
    		source: "(1:0) <script>   import { randData }",
    		ctx
    	});

    	return block;
    }

    // (28:0) {:then data}
    function create_then_block(ctx) {
    	let p0;
    	let p1;
    	let t1_value = /*data*/ ctx[1].params + "";
    	let t1;
    	let t2;
    	let t3_value = /*data*/ ctx[1].randomNumber + "";
    	let t3;
    	let t4;
    	let t5_value = /*data*/ ctx[1].sumRandomParams + "";
    	let t5;

    	const block = {
    		c: function create() {
    			p0 = element("p");
    			p0.textContent = "Dynamically generated results: \n  ";
    			p1 = element("p");
    			t1 = text(t1_value);
    			t2 = text(" + ");
    			t3 = text(t3_value);
    			t4 = text(" = ");
    			t5 = text(t5_value);
    			add_location(p0, file$1, 28, 2, 766);
    			add_location(p1, file$1, 29, 2, 803);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p0, anchor);
    			insert_dev(target, p1, anchor);
    			append_dev(p1, t1);
    			append_dev(p1, t2);
    			append_dev(p1, t3);
    			append_dev(p1, t4);
    			append_dev(p1, t5);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*numberInput*/ 1 && t1_value !== (t1_value = /*data*/ ctx[1].params + "")) set_data_dev(t1, t1_value);
    			if (dirty & /*numberInput*/ 1 && t3_value !== (t3_value = /*data*/ ctx[1].randomNumber + "")) set_data_dev(t3, t3_value);
    			if (dirty & /*numberInput*/ 1 && t5_value !== (t5_value = /*data*/ ctx[1].sumRandomParams + "")) set_data_dev(t5, t5_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p0);
    			if (detaching) detach_dev(p1);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_then_block.name,
    		type: "then",
    		source: "(28:0) {:then data}",
    		ctx
    	});

    	return block;
    }

    // (26:30)    <p>Waiting for a response from Flask...</p> {:then data}
    function create_pending_block(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "Waiting for a response from Flask...";
    			add_location(p, file$1, 26, 2, 707);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_pending_block.name,
    		type: "pending",
    		source: "(26:30)    <p>Waiting for a response from Flask...</p> {:then data}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$1(ctx) {
    	let h2;
    	let t1;
    	let form;
    	let input;
    	let t2;
    	let await_block_anchor;
    	let promise;
    	let current;
    	let mounted;
    	let dispose;

    	input = new Input({
    			props: {
    				type: "text",
    				id: "numberInput",
    				label: "Enter a Number",
    				value: /*numberInput*/ ctx[0]
    			},
    			$$inline: true
    		});

    	input.$on("input", /*input_handler*/ ctx[3]);

    	let info = {
    		ctx,
    		current: null,
    		token: null,
    		hasCatch: false,
    		pending: create_pending_block,
    		then: create_then_block,
    		catch: create_catch_block,
    		value: 1
    	};

    	handle_promise(promise = randData(/*numberInput*/ ctx[0]), info);

    	const block = {
    		c: function create() {
    			h2 = element("h2");
    			h2.textContent = "This input (Svelte) is sent to a dynamic server and added to a random number (Python & Flask):";
    			t1 = space();
    			form = element("form");
    			create_component(input.$$.fragment);
    			t2 = space();
    			await_block_anchor = empty();
    			info.block.c();
    			add_location(h2, file$1, 15, 0, 363);
    			add_location(form, file$1, 16, 0, 467);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, h2, anchor);
    			insert_dev(target, t1, anchor);
    			insert_dev(target, form, anchor);
    			mount_component(input, form, null);
    			insert_dev(target, t2, anchor);
    			insert_dev(target, await_block_anchor, anchor);
    			info.block.m(target, info.anchor = anchor);
    			info.mount = () => await_block_anchor.parentNode;
    			info.anchor = await_block_anchor;
    			current = true;

    			if (!mounted) {
    				dispose = listen_dev(form, "submit", prevent_default(/*submitForm*/ ctx[2]), false, true, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(new_ctx, [dirty]) {
    			ctx = new_ctx;
    			const input_changes = {};
    			if (dirty & /*numberInput*/ 1) input_changes.value = /*numberInput*/ ctx[0];
    			input.$set(input_changes);
    			info.ctx = ctx;

    			if (dirty & /*numberInput*/ 1 && promise !== (promise = randData(/*numberInput*/ ctx[0])) && handle_promise(promise, info)) ; else {
    				update_await_block_branch(info, ctx, dirty);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(input.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(input.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(h2);
    			if (detaching) detach_dev(t1);
    			if (detaching) detach_dev(form);
    			destroy_component(input);
    			if (detaching) detach_dev(t2);
    			if (detaching) detach_dev(await_block_anchor);
    			info.block.d(detaching);
    			info.token = null;
    			info = null;
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Body', slots, []);
    	let numberInput = 10;
    	let data = randData(numberInput);

    	function submitForm() {
    		$$invalidate(1, data = randData(numberInput));

    		// console.log('submitForm', numberInput, data);
    		dispatch('inputForm', { numberInput });
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Body> was created with unknown prop '${key}'`);
    	});

    	const input_handler = event => $$invalidate(0, numberInput = event.target.value);

    	$$self.$capture_state = () => ({
    		randData,
    		Input,
    		numberInput,
    		data,
    		submitForm
    	});

    	$$self.$inject_state = $$props => {
    		if ('numberInput' in $$props) $$invalidate(0, numberInput = $$props.numberInput);
    		if ('data' in $$props) $$invalidate(1, data = $$props.data);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [numberInput, data, submitForm, input_handler];
    }

    class Body extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Body",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    /* src/routes/rand/Test.svelte generated by Svelte v3.59.2 */
    const file$2 = "src/routes/rand/Test.svelte";

    function create_fragment$2(ctx) {
    	let h2;
    	let t1;
    	let button;
    	let t3;
    	let p;
    	let t4;

    	let t5_value = (/*data*/ ctx[0].name
    	? /*data*/ ctx[0].name
    	: "... Generating ... ") + "";

    	let t5;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			h2 = element("h2");
    			h2.textContent = "This input (Svelte) is sent to a dynamic server and added to a random number (Python & Flask):";
    			t1 = space();
    			button = element("button");
    			button.textContent = "New Name";
    			t3 = space();
    			p = element("p");
    			t4 = text("Dynamically generated result: ");
    			t5 = text(t5_value);
    			add_location(h2, file$2, 11, 2, 193);
    			attr_dev(button, "class", "btn btn-primary");
    			add_location(button, file$2, 12, 0, 297);
    			add_location(p, file$2, 16, 2, 390);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, h2, anchor);
    			insert_dev(target, t1, anchor);
    			insert_dev(target, button, anchor);
    			insert_dev(target, t3, anchor);
    			insert_dev(target, p, anchor);
    			append_dev(p, t4);
    			append_dev(p, t5);

    			if (!mounted) {
    				dispose = listen_dev(button, "click", /*click_handler*/ ctx[2], false, false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*data*/ 1 && t5_value !== (t5_value = (/*data*/ ctx[0].name
    			? /*data*/ ctx[0].name
    			: "... Generating ... ") + "")) set_data_dev(t5, t5_value);
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(h2);
    			if (detaching) detach_dev(t1);
    			if (detaching) detach_dev(button);
    			if (detaching) detach_dev(t3);
    			if (detaching) detach_dev(p);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$2.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Test', slots, []);
    	let data = newName();

    	async function newName() {
    		$$invalidate(0, data = await randName());
    		return data;
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Test> was created with unknown prop '${key}'`);
    	});

    	const click_handler = () => $$invalidate(0, data = newName());
    	$$self.$capture_state = () => ({ randName, data, newName });

    	$$self.$inject_state = $$props => {
    		if ('data' in $$props) $$invalidate(0, data = $$props.data);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [data, newName, click_handler];
    }

    class Test extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Test",
    			options,
    			id: create_fragment$2.name
    		});
    	}
    }

    /* src/routes/admin/Index.svelte generated by Svelte v3.59.2 */

    const file$3 = "src/routes/admin/Index.svelte";

    function create_fragment$3(ctx) {
    	let html;
    	let head;
    	let meta0;
    	let t0;
    	let meta1;
    	let t1;
    	let meta2;
    	let t2;
    	let meta3;
    	let t3;
    	let meta4;
    	let t4;
    	let title;
    	let t6;
    	let link0;
    	let t7;
    	let link1;
    	let t8;
    	let link2;
    	let t9;
    	let body;
    	let div175;
    	let ul0;
    	let a0;
    	let div0;
    	let i0;
    	let t10;
    	let div1;
    	let t11;
    	let sup;
    	let t13;
    	let hr0;
    	let t14;
    	let li0;
    	let a1;
    	let i1;
    	let t15;
    	let span0;
    	let t17;
    	let hr1;
    	let t18;
    	let div2;
    	let t20;
    	let li1;
    	let button0;
    	let i2;
    	let t21;
    	let span1;
    	let t23;
    	let div4;
    	let div3;
    	let h60;
    	let t25;
    	let a2;
    	let t27;
    	let a3;
    	let t29;
    	let li2;
    	let button1;
    	let i3;
    	let t30;
    	let span2;
    	let t32;
    	let div6;
    	let div5;
    	let h61;
    	let t34;
    	let a4;
    	let t36;
    	let a5;
    	let t38;
    	let a6;
    	let t40;
    	let a7;
    	let t42;
    	let hr2;
    	let t43;
    	let div7;
    	let t45;
    	let li3;
    	let button2;
    	let i4;
    	let t46;
    	let span3;
    	let t48;
    	let div10;
    	let div9;
    	let h62;
    	let t50;
    	let a8;
    	let t52;
    	let a9;
    	let t54;
    	let a10;
    	let t56;
    	let div8;
    	let t57;
    	let h63;
    	let t59;
    	let a11;
    	let t61;
    	let a12;
    	let t63;
    	let li4;
    	let a13;
    	let i5;
    	let t64;
    	let span4;
    	let t66;
    	let li5;
    	let a14;
    	let i6;
    	let t67;
    	let span5;
    	let t69;
    	let hr3;
    	let t70;
    	let div11;
    	let button3;
    	let t71;
    	let div12;
    	let img0;
    	let img0_src_value;
    	let t72;
    	let p0;
    	let strong;
    	let t74;
    	let t75;
    	let a15;
    	let t77;
    	let div174;
    	let div171;
    	let nav;
    	let button4;
    	let i7;
    	let t78;
    	let form0;
    	let div14;
    	let input0;
    	let t79;
    	let div13;
    	let button5;
    	let i8;
    	let t80;
    	let ul1;
    	let li6;
    	let a16;
    	let i9;
    	let t81;
    	let div17;
    	let form1;
    	let div16;
    	let input1;
    	let t82;
    	let div15;
    	let button6;
    	let i10;
    	let t83;
    	let li7;
    	let a17;
    	let i11;
    	let t84;
    	let span6;
    	let t86;
    	let div30;
    	let h64;
    	let t88;
    	let button7;
    	let div19;
    	let div18;
    	let i12;
    	let t89;
    	let div21;
    	let div20;
    	let t91;
    	let span7;
    	let t93;
    	let button8;
    	let div23;
    	let div22;
    	let i13;
    	let t94;
    	let div25;
    	let div24;
    	let t96;
    	let t97;
    	let button9;
    	let div27;
    	let div26;
    	let i14;
    	let t98;
    	let div29;
    	let div28;
    	let t100;
    	let t101;
    	let button10;
    	let t103;
    	let li8;
    	let a18;
    	let i15;
    	let t104;
    	let span8;
    	let t106;
    	let div51;
    	let h65;
    	let t108;
    	let button11;
    	let div32;
    	let img1;
    	let img1_src_value;
    	let t109;
    	let div31;
    	let t110;
    	let div35;
    	let div33;
    	let t112;
    	let div34;
    	let t114;
    	let button12;
    	let div37;
    	let img2;
    	let img2_src_value;
    	let t115;
    	let div36;
    	let t116;
    	let div40;
    	let div38;
    	let t118;
    	let div39;
    	let t120;
    	let button13;
    	let div42;
    	let img3;
    	let img3_src_value;
    	let t121;
    	let div41;
    	let t122;
    	let div45;
    	let div43;
    	let t124;
    	let div44;
    	let t126;
    	let button14;
    	let div47;
    	let img4;
    	let img4_src_value;
    	let t127;
    	let div46;
    	let t128;
    	let div50;
    	let div48;
    	let t130;
    	let div49;
    	let t132;
    	let button15;
    	let t134;
    	let div52;
    	let t135;
    	let li9;
    	let button16;
    	let span9;
    	let t137;
    	let img5;
    	let img5_src_value;
    	let t138;
    	let div54;
    	let button17;
    	let i16;
    	let t139;
    	let t140;
    	let button18;
    	let i17;
    	let t141;
    	let t142;
    	let button19;
    	let i18;
    	let t143;
    	let t144;
    	let div53;
    	let t145;
    	let button20;
    	let i19;
    	let t146;
    	let t147;
    	let div170;
    	let div55;
    	let h1;
    	let t149;
    	let button21;
    	let i20;
    	let t150;
    	let t151;
    	let div93;
    	let div63;
    	let div62;
    	let div61;
    	let div60;
    	let div58;
    	let div56;
    	let t153;
    	let div57;
    	let t155;
    	let div59;
    	let i21;
    	let t156;
    	let div71;
    	let div70;
    	let div69;
    	let div68;
    	let div66;
    	let div64;
    	let t158;
    	let div65;
    	let t160;
    	let div67;
    	let i22;
    	let t161;
    	let div84;
    	let div83;
    	let div82;
    	let div81;
    	let div79;
    	let div72;
    	let t163;
    	let div78;
    	let div74;
    	let div73;
    	let t165;
    	let div77;
    	let div76;
    	let div75;
    	let t166;
    	let div80;
    	let i23;
    	let t167;
    	let div92;
    	let div91;
    	let div90;
    	let div89;
    	let div87;
    	let div85;
    	let t169;
    	let div86;
    	let t171;
    	let div88;
    	let i24;
    	let t172;
    	let div113;
    	let div102;
    	let div101;
    	let div98;
    	let h66;
    	let t174;
    	let div97;
    	let a19;
    	let i25;
    	let t175;
    	let div96;
    	let div94;
    	let t177;
    	let button22;
    	let t179;
    	let button23;
    	let t181;
    	let div95;
    	let t182;
    	let button24;
    	let t184;
    	let div100;
    	let div99;
    	let canvas0;
    	let t185;
    	let div112;
    	let div111;
    	let div107;
    	let h67;
    	let t187;
    	let div106;
    	let a20;
    	let i26;
    	let t188;
    	let div105;
    	let div103;
    	let t190;
    	let button25;
    	let t192;
    	let button26;
    	let t194;
    	let div104;
    	let t195;
    	let button27;
    	let t197;
    	let div110;
    	let div108;
    	let canvas1;
    	let t198;
    	let div109;
    	let span10;
    	let i27;
    	let t199;
    	let t200;
    	let span11;
    	let i28;
    	let t201;
    	let t202;
    	let span12;
    	let i29;
    	let t203;
    	let t204;
    	let div169;
    	let div160;
    	let div126;
    	let div114;
    	let h68;
    	let t206;
    	let div125;
    	let h40;
    	let t207;
    	let span13;
    	let t209;
    	let div116;
    	let div115;
    	let t210;
    	let h41;
    	let t211;
    	let span14;
    	let t213;
    	let div118;
    	let div117;
    	let t214;
    	let h42;
    	let t215;
    	let span15;
    	let t217;
    	let div120;
    	let div119;
    	let t218;
    	let h43;
    	let t219;
    	let span16;
    	let t221;
    	let div122;
    	let div121;
    	let t222;
    	let h44;
    	let t223;
    	let span17;
    	let t225;
    	let div124;
    	let div123;
    	let t226;
    	let div159;
    	let div130;
    	let div129;
    	let div128;
    	let t227;
    	let div127;
    	let t229;
    	let div134;
    	let div133;
    	let div132;
    	let t230;
    	let div131;
    	let t232;
    	let div138;
    	let div137;
    	let div136;
    	let t233;
    	let div135;
    	let t235;
    	let div142;
    	let div141;
    	let div140;
    	let t236;
    	let div139;
    	let t238;
    	let div146;
    	let div145;
    	let div144;
    	let t239;
    	let div143;
    	let t241;
    	let div150;
    	let div149;
    	let div148;
    	let t242;
    	let div147;
    	let t244;
    	let div154;
    	let div153;
    	let div152;
    	let t245;
    	let div151;
    	let t247;
    	let div158;
    	let div157;
    	let div156;
    	let t248;
    	let div155;
    	let t250;
    	let div168;
    	let div164;
    	let div161;
    	let h69;
    	let t252;
    	let div163;
    	let div162;
    	let img6;
    	let img6_src_value;
    	let t253;
    	let p1;
    	let t254;
    	let a21;
    	let t256;
    	let t257;
    	let a22;
    	let t259;
    	let div167;
    	let div165;
    	let h610;
    	let t261;
    	let div166;
    	let p2;
    	let t263;
    	let p3;
    	let t265;
    	let footer;
    	let div173;
    	let div172;
    	let span18;
    	let t267;
    	let a23;
    	let i30;
    	let t268;
    	let div181;
    	let div180;
    	let div179;
    	let div176;
    	let h5;
    	let t270;
    	let button28;
    	let span19;
    	let t272;
    	let div177;
    	let t274;
    	let div178;
    	let button29;
    	let t276;
    	let a24;
    	let t278;
    	let script0;
    	let script0_src_value;
    	let t279;
    	let script1;
    	let script1_src_value;
    	let t280;
    	let script2;
    	let script2_src_value;
    	let t281;
    	let script3;
    	let script3_src_value;

    	const block = {
    		c: function create() {
    			html = element("html");
    			head = element("head");
    			meta0 = element("meta");
    			t0 = space();
    			meta1 = element("meta");
    			t1 = space();
    			meta2 = element("meta");
    			t2 = space();
    			meta3 = element("meta");
    			t3 = space();
    			meta4 = element("meta");
    			t4 = space();
    			title = element("title");
    			title.textContent = "SB Admin 2 - Dashboard";
    			t6 = space();
    			link0 = element("link");
    			t7 = space();
    			link1 = element("link");
    			t8 = space();
    			link2 = element("link");
    			t9 = space();
    			body = element("body");
    			div175 = element("div");
    			ul0 = element("ul");
    			a0 = element("a");
    			div0 = element("div");
    			i0 = element("i");
    			t10 = space();
    			div1 = element("div");
    			t11 = text("SB Admin ");
    			sup = element("sup");
    			sup.textContent = "2";
    			t13 = space();
    			hr0 = element("hr");
    			t14 = space();
    			li0 = element("li");
    			a1 = element("a");
    			i1 = element("i");
    			t15 = space();
    			span0 = element("span");
    			span0.textContent = "Dashboard";
    			t17 = space();
    			hr1 = element("hr");
    			t18 = space();
    			div2 = element("div");
    			div2.textContent = "Interface";
    			t20 = space();
    			li1 = element("li");
    			button0 = element("button");
    			i2 = element("i");
    			t21 = space();
    			span1 = element("span");
    			span1.textContent = "Components";
    			t23 = space();
    			div4 = element("div");
    			div3 = element("div");
    			h60 = element("h6");
    			h60.textContent = "Custom Components:";
    			t25 = space();
    			a2 = element("a");
    			a2.textContent = "Buttons";
    			t27 = space();
    			a3 = element("a");
    			a3.textContent = "Cards";
    			t29 = space();
    			li2 = element("li");
    			button1 = element("button");
    			i3 = element("i");
    			t30 = space();
    			span2 = element("span");
    			span2.textContent = "Utilities";
    			t32 = space();
    			div6 = element("div");
    			div5 = element("div");
    			h61 = element("h6");
    			h61.textContent = "Custom Utilities:";
    			t34 = space();
    			a4 = element("a");
    			a4.textContent = "Colors";
    			t36 = space();
    			a5 = element("a");
    			a5.textContent = "Borders";
    			t38 = space();
    			a6 = element("a");
    			a6.textContent = "Animations";
    			t40 = space();
    			a7 = element("a");
    			a7.textContent = "Other";
    			t42 = space();
    			hr2 = element("hr");
    			t43 = space();
    			div7 = element("div");
    			div7.textContent = "Addons";
    			t45 = space();
    			li3 = element("li");
    			button2 = element("button");
    			i4 = element("i");
    			t46 = space();
    			span3 = element("span");
    			span3.textContent = "Pages";
    			t48 = space();
    			div10 = element("div");
    			div9 = element("div");
    			h62 = element("h6");
    			h62.textContent = "Login Screens:";
    			t50 = space();
    			a8 = element("a");
    			a8.textContent = "Login";
    			t52 = space();
    			a9 = element("a");
    			a9.textContent = "Register";
    			t54 = space();
    			a10 = element("a");
    			a10.textContent = "Forgot Password";
    			t56 = space();
    			div8 = element("div");
    			t57 = space();
    			h63 = element("h6");
    			h63.textContent = "Other Pages:";
    			t59 = space();
    			a11 = element("a");
    			a11.textContent = "404 Page";
    			t61 = space();
    			a12 = element("a");
    			a12.textContent = "Blank Page";
    			t63 = space();
    			li4 = element("li");
    			a13 = element("a");
    			i5 = element("i");
    			t64 = space();
    			span4 = element("span");
    			span4.textContent = "Charts";
    			t66 = space();
    			li5 = element("li");
    			a14 = element("a");
    			i6 = element("i");
    			t67 = space();
    			span5 = element("span");
    			span5.textContent = "Tables";
    			t69 = space();
    			hr3 = element("hr");
    			t70 = space();
    			div11 = element("div");
    			button3 = element("button");
    			t71 = space();
    			div12 = element("div");
    			img0 = element("img");
    			t72 = space();
    			p0 = element("p");
    			strong = element("strong");
    			strong.textContent = "SB Admin Pro";
    			t74 = text(" is packed with premium features, components, and more!");
    			t75 = space();
    			a15 = element("a");
    			a15.textContent = "Upgrade to Pro!";
    			t77 = space();
    			div174 = element("div");
    			div171 = element("div");
    			nav = element("nav");
    			button4 = element("button");
    			i7 = element("i");
    			t78 = space();
    			form0 = element("form");
    			div14 = element("div");
    			input0 = element("input");
    			t79 = space();
    			div13 = element("div");
    			button5 = element("button");
    			i8 = element("i");
    			t80 = space();
    			ul1 = element("ul");
    			li6 = element("li");
    			a16 = element("a");
    			i9 = element("i");
    			t81 = space();
    			div17 = element("div");
    			form1 = element("form");
    			div16 = element("div");
    			input1 = element("input");
    			t82 = space();
    			div15 = element("div");
    			button6 = element("button");
    			i10 = element("i");
    			t83 = space();
    			li7 = element("li");
    			a17 = element("a");
    			i11 = element("i");
    			t84 = space();
    			span6 = element("span");
    			span6.textContent = "3+";
    			t86 = space();
    			div30 = element("div");
    			h64 = element("h6");
    			h64.textContent = "Alerts Center";
    			t88 = space();
    			button7 = element("button");
    			div19 = element("div");
    			div18 = element("div");
    			i12 = element("i");
    			t89 = space();
    			div21 = element("div");
    			div20 = element("div");
    			div20.textContent = "December 12, 2019";
    			t91 = space();
    			span7 = element("span");
    			span7.textContent = "A new monthly report is ready to download!";
    			t93 = space();
    			button8 = element("button");
    			div23 = element("div");
    			div22 = element("div");
    			i13 = element("i");
    			t94 = space();
    			div25 = element("div");
    			div24 = element("div");
    			div24.textContent = "December 7, 2019";
    			t96 = text("\n                                        $290.29 has been deposited into your account!");
    			t97 = space();
    			button9 = element("button");
    			div27 = element("div");
    			div26 = element("div");
    			i14 = element("i");
    			t98 = space();
    			div29 = element("div");
    			div28 = element("div");
    			div28.textContent = "December 2, 2019";
    			t100 = text("\n                                        Spending Alert: We've noticed unusually high spending for your account.");
    			t101 = space();
    			button10 = element("button");
    			button10.textContent = "Show All Alerts";
    			t103 = space();
    			li8 = element("li");
    			a18 = element("a");
    			i15 = element("i");
    			t104 = space();
    			span8 = element("span");
    			span8.textContent = "7";
    			t106 = space();
    			div51 = element("div");
    			h65 = element("h6");
    			h65.textContent = "Message Center";
    			t108 = space();
    			button11 = element("button");
    			div32 = element("div");
    			img1 = element("img");
    			t109 = space();
    			div31 = element("div");
    			t110 = space();
    			div35 = element("div");
    			div33 = element("div");
    			div33.textContent = "Hi there! I am wondering if you can help me with a\n                                            problem I've been having.";
    			t112 = space();
    			div34 = element("div");
    			div34.textContent = "Emily Fowler · 58m";
    			t114 = space();
    			button12 = element("button");
    			div37 = element("div");
    			img2 = element("img");
    			t115 = space();
    			div36 = element("div");
    			t116 = space();
    			div40 = element("div");
    			div38 = element("div");
    			div38.textContent = "I have the photos that you ordered last month, how\n                                            would you like them sent to you?";
    			t118 = space();
    			div39 = element("div");
    			div39.textContent = "Jae Chun · 1d";
    			t120 = space();
    			button13 = element("button");
    			div42 = element("div");
    			img3 = element("img");
    			t121 = space();
    			div41 = element("div");
    			t122 = space();
    			div45 = element("div");
    			div43 = element("div");
    			div43.textContent = "Last month's report looks great, I am very happy with\n                                            the progress so far, keep up the good work!";
    			t124 = space();
    			div44 = element("div");
    			div44.textContent = "Morgan Alvarez · 2d";
    			t126 = space();
    			button14 = element("button");
    			div47 = element("div");
    			img4 = element("img");
    			t127 = space();
    			div46 = element("div");
    			t128 = space();
    			div50 = element("div");
    			div48 = element("div");
    			div48.textContent = "Am I a good boy? The reason I ask is because someone\n                                            told me that people say this to all dogs, even if they aren't good...";
    			t130 = space();
    			div49 = element("div");
    			div49.textContent = "Chicken the Dog · 2w";
    			t132 = space();
    			button15 = element("button");
    			button15.textContent = "Read More Messages";
    			t134 = space();
    			div52 = element("div");
    			t135 = space();
    			li9 = element("li");
    			button16 = element("button");
    			span9 = element("span");
    			span9.textContent = "Douglas McGee";
    			t137 = space();
    			img5 = element("img");
    			t138 = space();
    			div54 = element("div");
    			button17 = element("button");
    			i16 = element("i");
    			t139 = text("\n                                    Profile");
    			t140 = space();
    			button18 = element("button");
    			i17 = element("i");
    			t141 = text("\n                                    Settings");
    			t142 = space();
    			button19 = element("button");
    			i18 = element("i");
    			t143 = text("\n                                    Activity Log");
    			t144 = space();
    			div53 = element("div");
    			t145 = space();
    			button20 = element("button");
    			i19 = element("i");
    			t146 = text("\n                                    Logout");
    			t147 = space();
    			div170 = element("div");
    			div55 = element("div");
    			h1 = element("h1");
    			h1.textContent = "Dashboard";
    			t149 = space();
    			button21 = element("button");
    			i20 = element("i");
    			t150 = text(" Generate Report");
    			t151 = space();
    			div93 = element("div");
    			div63 = element("div");
    			div62 = element("div");
    			div61 = element("div");
    			div60 = element("div");
    			div58 = element("div");
    			div56 = element("div");
    			div56.textContent = "Earnings (Monthly)";
    			t153 = space();
    			div57 = element("div");
    			div57.textContent = "$40,000";
    			t155 = space();
    			div59 = element("div");
    			i21 = element("i");
    			t156 = space();
    			div71 = element("div");
    			div70 = element("div");
    			div69 = element("div");
    			div68 = element("div");
    			div66 = element("div");
    			div64 = element("div");
    			div64.textContent = "Earnings (Annual)";
    			t158 = space();
    			div65 = element("div");
    			div65.textContent = "$215,000";
    			t160 = space();
    			div67 = element("div");
    			i22 = element("i");
    			t161 = space();
    			div84 = element("div");
    			div83 = element("div");
    			div82 = element("div");
    			div81 = element("div");
    			div79 = element("div");
    			div72 = element("div");
    			div72.textContent = "Tasks";
    			t163 = space();
    			div78 = element("div");
    			div74 = element("div");
    			div73 = element("div");
    			div73.textContent = "50%";
    			t165 = space();
    			div77 = element("div");
    			div76 = element("div");
    			div75 = element("div");
    			t166 = space();
    			div80 = element("div");
    			i23 = element("i");
    			t167 = space();
    			div92 = element("div");
    			div91 = element("div");
    			div90 = element("div");
    			div89 = element("div");
    			div87 = element("div");
    			div85 = element("div");
    			div85.textContent = "Pending Requests";
    			t169 = space();
    			div86 = element("div");
    			div86.textContent = "18";
    			t171 = space();
    			div88 = element("div");
    			i24 = element("i");
    			t172 = space();
    			div113 = element("div");
    			div102 = element("div");
    			div101 = element("div");
    			div98 = element("div");
    			h66 = element("h6");
    			h66.textContent = "Earnings Overview";
    			t174 = space();
    			div97 = element("div");
    			a19 = element("a");
    			i25 = element("i");
    			t175 = space();
    			div96 = element("div");
    			div94 = element("div");
    			div94.textContent = "Dropdown Header:";
    			t177 = space();
    			button22 = element("button");
    			button22.textContent = "Action";
    			t179 = space();
    			button23 = element("button");
    			button23.textContent = "Another action";
    			t181 = space();
    			div95 = element("div");
    			t182 = space();
    			button24 = element("button");
    			button24.textContent = "Something else here";
    			t184 = space();
    			div100 = element("div");
    			div99 = element("div");
    			canvas0 = element("canvas");
    			t185 = space();
    			div112 = element("div");
    			div111 = element("div");
    			div107 = element("div");
    			h67 = element("h6");
    			h67.textContent = "Revenue Sources";
    			t187 = space();
    			div106 = element("div");
    			a20 = element("a");
    			i26 = element("i");
    			t188 = space();
    			div105 = element("div");
    			div103 = element("div");
    			div103.textContent = "Dropdown Header:";
    			t190 = space();
    			button25 = element("button");
    			button25.textContent = "Action";
    			t192 = space();
    			button26 = element("button");
    			button26.textContent = "Another action";
    			t194 = space();
    			div104 = element("div");
    			t195 = space();
    			button27 = element("button");
    			button27.textContent = "Something else here";
    			t197 = space();
    			div110 = element("div");
    			div108 = element("div");
    			canvas1 = element("canvas");
    			t198 = space();
    			div109 = element("div");
    			span10 = element("span");
    			i27 = element("i");
    			t199 = text(" Direct");
    			t200 = space();
    			span11 = element("span");
    			i28 = element("i");
    			t201 = text(" Social");
    			t202 = space();
    			span12 = element("span");
    			i29 = element("i");
    			t203 = text(" Referral");
    			t204 = space();
    			div169 = element("div");
    			div160 = element("div");
    			div126 = element("div");
    			div114 = element("div");
    			h68 = element("h6");
    			h68.textContent = "Projects";
    			t206 = space();
    			div125 = element("div");
    			h40 = element("h4");
    			t207 = text("Server Migration ");
    			span13 = element("span");
    			span13.textContent = "20%";
    			t209 = space();
    			div116 = element("div");
    			div115 = element("div");
    			t210 = space();
    			h41 = element("h4");
    			t211 = text("Sales Tracking ");
    			span14 = element("span");
    			span14.textContent = "40%";
    			t213 = space();
    			div118 = element("div");
    			div117 = element("div");
    			t214 = space();
    			h42 = element("h4");
    			t215 = text("Customer Database ");
    			span15 = element("span");
    			span15.textContent = "60%";
    			t217 = space();
    			div120 = element("div");
    			div119 = element("div");
    			t218 = space();
    			h43 = element("h4");
    			t219 = text("Payout Details ");
    			span16 = element("span");
    			span16.textContent = "80%";
    			t221 = space();
    			div122 = element("div");
    			div121 = element("div");
    			t222 = space();
    			h44 = element("h4");
    			t223 = text("Account Setup ");
    			span17 = element("span");
    			span17.textContent = "Complete!";
    			t225 = space();
    			div124 = element("div");
    			div123 = element("div");
    			t226 = space();
    			div159 = element("div");
    			div130 = element("div");
    			div129 = element("div");
    			div128 = element("div");
    			t227 = text("Primary\n                                            ");
    			div127 = element("div");
    			div127.textContent = "#4e73df";
    			t229 = space();
    			div134 = element("div");
    			div133 = element("div");
    			div132 = element("div");
    			t230 = text("Success\n                                            ");
    			div131 = element("div");
    			div131.textContent = "#1cc88a";
    			t232 = space();
    			div138 = element("div");
    			div137 = element("div");
    			div136 = element("div");
    			t233 = text("Info\n                                            ");
    			div135 = element("div");
    			div135.textContent = "#36b9cc";
    			t235 = space();
    			div142 = element("div");
    			div141 = element("div");
    			div140 = element("div");
    			t236 = text("Warning\n                                            ");
    			div139 = element("div");
    			div139.textContent = "#f6c23e";
    			t238 = space();
    			div146 = element("div");
    			div145 = element("div");
    			div144 = element("div");
    			t239 = text("Danger\n                                            ");
    			div143 = element("div");
    			div143.textContent = "#e74a3b";
    			t241 = space();
    			div150 = element("div");
    			div149 = element("div");
    			div148 = element("div");
    			t242 = text("Secondary\n                                            ");
    			div147 = element("div");
    			div147.textContent = "#858796";
    			t244 = space();
    			div154 = element("div");
    			div153 = element("div");
    			div152 = element("div");
    			t245 = text("Light\n                                            ");
    			div151 = element("div");
    			div151.textContent = "#f8f9fc";
    			t247 = space();
    			div158 = element("div");
    			div157 = element("div");
    			div156 = element("div");
    			t248 = text("Dark\n                                            ");
    			div155 = element("div");
    			div155.textContent = "#5a5c69";
    			t250 = space();
    			div168 = element("div");
    			div164 = element("div");
    			div161 = element("div");
    			h69 = element("h6");
    			h69.textContent = "Illustrations";
    			t252 = space();
    			div163 = element("div");
    			div162 = element("div");
    			img6 = element("img");
    			t253 = space();
    			p1 = element("p");
    			t254 = text("Add some quality, svg illustrations to your project courtesy of ");
    			a21 = element("a");
    			a21.textContent = "unDraw";
    			t256 = text(", a\n                                        constantly updated collection of beautiful svg images that you can use\n                                        completely free and without attribution!");
    			t257 = space();
    			a22 = element("a");
    			a22.textContent = "Browse Illustrations on\n                                        unDraw →";
    			t259 = space();
    			div167 = element("div");
    			div165 = element("div");
    			h610 = element("h6");
    			h610.textContent = "Development Approach";
    			t261 = space();
    			div166 = element("div");
    			p2 = element("p");
    			p2.textContent = "SB Admin 2 makes extensive use of Bootstrap 4 utility classes in order to reduce\n                                        CSS bloat and poor page performance. Custom CSS classes are used to create\n                                        custom components and custom utility classes.";
    			t263 = space();
    			p3 = element("p");
    			p3.textContent = "Before working with this theme, you should become familiar with the\n                                        Bootstrap framework, especially the utility classes.";
    			t265 = space();
    			footer = element("footer");
    			div173 = element("div");
    			div172 = element("div");
    			span18 = element("span");
    			span18.textContent = "Copyright © Your Website 2021";
    			t267 = space();
    			a23 = element("a");
    			i30 = element("i");
    			t268 = space();
    			div181 = element("div");
    			div180 = element("div");
    			div179 = element("div");
    			div176 = element("div");
    			h5 = element("h5");
    			h5.textContent = "Ready to Leave?";
    			t270 = space();
    			button28 = element("button");
    			span19 = element("span");
    			span19.textContent = "×";
    			t272 = space();
    			div177 = element("div");
    			div177.textContent = "Select \"Logout\" below if you are ready to end your current session.";
    			t274 = space();
    			div178 = element("div");
    			button29 = element("button");
    			button29.textContent = "Cancel";
    			t276 = space();
    			a24 = element("a");
    			a24.textContent = "Logout";
    			t278 = space();
    			script0 = element("script");
    			t279 = space();
    			script1 = element("script");
    			t280 = space();
    			script2 = element("script");
    			t281 = space();
    			script3 = element("script");
    			attr_dev(meta0, "charset", "utf-8");
    			add_location(meta0, file$3, 4, 4, 30);
    			attr_dev(meta1, "http-equiv", "X-UA-Compatible");
    			attr_dev(meta1, "content", "IE=edge");
    			add_location(meta1, file$3, 5, 4, 57);
    			attr_dev(meta2, "name", "viewport");
    			attr_dev(meta2, "content", "width=device-width, initial-scale=1, shrink-to-fit=no");
    			add_location(meta2, file$3, 6, 4, 115);
    			attr_dev(meta3, "name", "description");
    			attr_dev(meta3, "content", "");
    			add_location(meta3, file$3, 7, 4, 206);
    			attr_dev(meta4, "name", "author");
    			attr_dev(meta4, "content", "");
    			add_location(meta4, file$3, 8, 4, 247);
    			add_location(title, file$3, 10, 4, 284);
    			attr_dev(link0, "href", "vendor/fontawesome-free/css/all.min.css");
    			attr_dev(link0, "rel", "stylesheet");
    			attr_dev(link0, "type", "text/css");
    			add_location(link0, file$3, 13, 4, 370);
    			attr_dev(link1, "href", "https://fonts.googleapis.com/css?family=Nunito:200,200i,300,300i,400,400i,600,600i,700,700i,800,800i,900,900i");
    			attr_dev(link1, "rel", "stylesheet");
    			add_location(link1, file$3, 14, 4, 461);
    			attr_dev(link2, "href", "css/sb-admin-2.min.css");
    			attr_dev(link2, "rel", "stylesheet");
    			add_location(link2, file$3, 19, 4, 667);
    			add_location(head, file$3, 2, 0, 18);
    			attr_dev(i0, "class", "fas fa-laugh-wink");
    			add_location(i0, file$3, 34, 20, 1157);
    			attr_dev(div0, "class", "sidebar-brand-icon rotate-n-15");
    			add_location(div0, file$3, 33, 16, 1092);
    			add_location(sup, file$3, 36, 62, 1276);
    			attr_dev(div1, "class", "sidebar-brand-text mx-3");
    			add_location(div1, file$3, 36, 16, 1230);
    			attr_dev(a0, "class", "sidebar-brand d-flex align-items-center justify-content-center");
    			attr_dev(a0, "href", "index.html");
    			add_location(a0, file$3, 32, 12, 983);
    			attr_dev(hr0, "class", "sidebar-divider my-0");
    			add_location(hr0, file$3, 40, 12, 1354);
    			attr_dev(i1, "class", "fas fa-fw fa-tachometer-alt");
    			add_location(i1, file$3, 45, 20, 1547);
    			add_location(span0, file$3, 46, 20, 1611);
    			attr_dev(a1, "class", "nav-link");
    			attr_dev(a1, "href", "index.html");
    			add_location(a1, file$3, 44, 16, 1488);
    			attr_dev(li0, "class", "nav-item active");
    			add_location(li0, file$3, 43, 12, 1443);
    			attr_dev(hr1, "class", "sidebar-divider");
    			add_location(hr1, file$3, 50, 12, 1698);
    			attr_dev(div2, "class", "sidebar-heading");
    			add_location(div2, file$3, 53, 12, 1769);
    			attr_dev(i2, "class", "fas fa-fw fa-cog");
    			add_location(i2, file$3, 61, 20, 2128);
    			add_location(span1, file$3, 62, 20, 2181);
    			attr_dev(button0, "class", "nav-link collapsed");
    			attr_dev(button0, "data-bs-toggle", "collapse");
    			attr_dev(button0, "data-bs-target", "#collapseTwo");
    			attr_dev(button0, "aria-expanded", "true");
    			attr_dev(button0, "aria-controls", "collapseTwo");
    			add_location(button0, file$3, 59, 16, 1947);
    			attr_dev(h60, "class", "collapse-header");
    			add_location(h60, file$3, 66, 24, 2446);
    			attr_dev(a2, "class", "collapse-item");
    			attr_dev(a2, "href", "buttons.html");
    			add_location(a2, file$3, 67, 24, 2522);
    			attr_dev(a3, "class", "collapse-item");
    			attr_dev(a3, "href", "cards.html");
    			add_location(a3, file$3, 68, 24, 2603);
    			attr_dev(div3, "class", "bg-white py-2 collapse-inner rounded");
    			add_location(div3, file$3, 65, 20, 2371);
    			attr_dev(div4, "id", "collapseTwo");
    			attr_dev(div4, "class", "collapse");
    			attr_dev(div4, "aria-labelledby", "headingTwo");
    			attr_dev(div4, "data-bs-parent", "#accordionSidebar");
    			add_location(div4, file$3, 64, 16, 2247);
    			attr_dev(li1, "class", "nav-item");
    			add_location(li1, file$3, 58, 12, 1909);
    			attr_dev(i3, "class", "fas fa-fw fa-wrench");
    			add_location(i3, file$3, 77, 20, 3024);
    			add_location(span2, file$3, 78, 20, 3080);
    			attr_dev(button1, "class", "nav-link collapsed");
    			attr_dev(button1, "data-bs-toggle", "collapse");
    			attr_dev(button1, "data-bs-target", "#collapseUtilities");
    			attr_dev(button1, "aria-expanded", "true");
    			attr_dev(button1, "aria-controls", "collapseUtilities");
    			add_location(button1, file$3, 75, 16, 2831);
    			attr_dev(h61, "class", "collapse-header");
    			add_location(h61, file$3, 83, 24, 3372);
    			attr_dev(a4, "class", "collapse-item");
    			attr_dev(a4, "href", "utilities-color.html");
    			add_location(a4, file$3, 84, 24, 3447);
    			attr_dev(a5, "class", "collapse-item");
    			attr_dev(a5, "href", "utilities-border.html");
    			add_location(a5, file$3, 85, 24, 3535);
    			attr_dev(a6, "class", "collapse-item");
    			attr_dev(a6, "href", "utilities-animation.html");
    			add_location(a6, file$3, 86, 24, 3625);
    			attr_dev(a7, "class", "collapse-item");
    			attr_dev(a7, "href", "utilities-other.html");
    			add_location(a7, file$3, 87, 24, 3721);
    			attr_dev(div5, "class", "bg-white py-2 collapse-inner rounded");
    			add_location(div5, file$3, 82, 20, 3297);
    			attr_dev(div6, "id", "collapseUtilities");
    			attr_dev(div6, "class", "collapse");
    			attr_dev(div6, "aria-labelledby", "headingUtilities");
    			attr_dev(div6, "data-bs-parent", "#accordionSidebar");
    			add_location(div6, file$3, 80, 16, 3141);
    			attr_dev(li2, "class", "nav-item");
    			add_location(li2, file$3, 74, 12, 2793);
    			attr_dev(hr2, "class", "sidebar-divider");
    			add_location(hr2, file$3, 93, 12, 3894);
    			attr_dev(div7, "class", "sidebar-heading");
    			add_location(div7, file$3, 96, 12, 3965);
    			attr_dev(i4, "class", "fas fa-fw fa-folder");
    			add_location(i4, file$3, 104, 20, 4325);
    			add_location(span3, file$3, 105, 20, 4381);
    			attr_dev(button2, "class", "nav-link collapsed");
    			attr_dev(button2, "data-bs-toggle", "collapse");
    			attr_dev(button2, "data-bs-target", "#collapsePages");
    			attr_dev(button2, "aria-expanded", "true");
    			attr_dev(button2, "aria-controls", "collapsePages");
    			add_location(button2, file$3, 102, 16, 4140);
    			attr_dev(h62, "class", "collapse-header");
    			add_location(h62, file$3, 109, 24, 4641);
    			attr_dev(a8, "class", "collapse-item");
    			attr_dev(a8, "href", "login.html");
    			add_location(a8, file$3, 110, 24, 4713);
    			attr_dev(a9, "class", "collapse-item");
    			attr_dev(a9, "href", "register.html");
    			add_location(a9, file$3, 111, 24, 4790);
    			attr_dev(a10, "class", "collapse-item");
    			attr_dev(a10, "href", "forgot-password.html");
    			add_location(a10, file$3, 112, 24, 4873);
    			attr_dev(div8, "class", "collapse-divider");
    			add_location(div8, file$3, 113, 24, 4970);
    			attr_dev(h63, "class", "collapse-header");
    			add_location(h63, file$3, 114, 24, 5031);
    			attr_dev(a11, "class", "collapse-item");
    			attr_dev(a11, "href", "404.html");
    			add_location(a11, file$3, 115, 24, 5101);
    			attr_dev(a12, "class", "collapse-item");
    			attr_dev(a12, "href", "blank.html");
    			add_location(a12, file$3, 116, 24, 5179);
    			attr_dev(div9, "class", "bg-white py-2 collapse-inner rounded");
    			add_location(div9, file$3, 108, 20, 4566);
    			attr_dev(div10, "id", "collapsePages");
    			attr_dev(div10, "class", "collapse");
    			attr_dev(div10, "aria-labelledby", "headingPages");
    			attr_dev(div10, "data-bs-parent", "#accordionSidebar");
    			add_location(div10, file$3, 107, 16, 4438);
    			attr_dev(li3, "class", "nav-item");
    			add_location(li3, file$3, 101, 12, 4102);
    			attr_dev(i5, "class", "fas fa-fw fa-chart-area");
    			add_location(i5, file$3, 124, 20, 5455);
    			add_location(span4, file$3, 125, 20, 5515);
    			attr_dev(a13, "class", "nav-link");
    			attr_dev(a13, "href", "charts.html");
    			add_location(a13, file$3, 123, 16, 5395);
    			attr_dev(li4, "class", "nav-item");
    			add_location(li4, file$3, 122, 12, 5357);
    			attr_dev(i6, "class", "fas fa-fw fa-table");
    			add_location(i6, file$3, 131, 20, 5707);
    			add_location(span5, file$3, 132, 20, 5762);
    			attr_dev(a14, "class", "nav-link");
    			attr_dev(a14, "href", "tables.html");
    			add_location(a14, file$3, 130, 16, 5647);
    			attr_dev(li5, "class", "nav-item");
    			add_location(li5, file$3, 129, 12, 5609);
    			attr_dev(hr3, "class", "sidebar-divider d-none d-md-block");
    			add_location(hr3, file$3, 136, 12, 5846);
    			attr_dev(button3, "class", "rounded-circle border-0");
    			attr_dev(button3, "id", "sidebarToggle");
    			add_location(button3, file$3, 140, 16, 6014);
    			attr_dev(div11, "class", "text-center d-none d-md-inline");
    			add_location(div11, file$3, 139, 12, 5953);
    			attr_dev(img0, "class", "sidebar-card-illustration mb-2");
    			if (!src_url_equal(img0.src, img0_src_value = "img/undraw_rocket.svg")) attr_dev(img0, "src", img0_src_value);
    			attr_dev(img0, "alt", "...");
    			add_location(img0, file$3, 145, 16, 6212);
    			add_location(strong, file$3, 146, 44, 6339);
    			attr_dev(p0, "class", "text-center mb-2");
    			add_location(p0, file$3, 146, 16, 6311);
    			attr_dev(a15, "class", "btn btn-success btn-sm");
    			attr_dev(a15, "href", "https://startbootstrap.com/theme/sb-admin-pro");
    			add_location(a15, file$3, 147, 16, 6444);
    			attr_dev(div12, "class", "sidebar-card d-none d-lg-flex");
    			add_location(div12, file$3, 144, 12, 6152);
    			attr_dev(ul0, "class", "navbar-nav bg-gradient-primary sidebar sidebar-dark accordion");
    			attr_dev(ul0, "id", "accordionSidebar");
    			add_location(ul0, file$3, 29, 8, 836);
    			attr_dev(i7, "class", "fa fa-bars");
    			add_location(i7, file$3, 164, 24, 7095);
    			attr_dev(button4, "id", "sidebarToggleTop");
    			attr_dev(button4, "class", "btn btn-link d-md-none rounded-circle mr-3");
    			add_location(button4, file$3, 163, 20, 6989);
    			attr_dev(input0, "type", "text");
    			attr_dev(input0, "class", "form-control bg-light border-0 small");
    			attr_dev(input0, "placeholder", "Search for...");
    			attr_dev(input0, "aria-label", "Search");
    			attr_dev(input0, "aria-describedby", "basic-addon2");
    			add_location(input0, file$3, 171, 28, 7420);
    			attr_dev(i8, "class", "fas fa-search fa-sm");
    			add_location(i8, file$3, 175, 36, 7773);
    			attr_dev(button5, "class", "btn btn-primary");
    			attr_dev(button5, "type", "button");
    			add_location(button5, file$3, 174, 32, 7690);
    			attr_dev(div13, "class", "input-group-append");
    			add_location(div13, file$3, 173, 28, 7625);
    			attr_dev(div14, "class", "input-group");
    			add_location(div14, file$3, 170, 24, 7366);
    			attr_dev(form0, "class", "d-none d-sm-inline-block form-inline mr-auto ml-md-3 my-2 my-md-0 mw-100 navbar-search");
    			add_location(form0, file$3, 168, 20, 7216);
    			attr_dev(i9, "class", "fas fa-search fa-fw");
    			add_location(i9, file$3, 188, 32, 8413);
    			attr_dev(a16, "class", "nav-link dropdown-toggle");
    			attr_dev(a16, "id", "searchDropdown");
    			attr_dev(a16, "data-bs-toggle", "dropdown");
    			attr_dev(a16, "aria-haspopup", "true");
    			attr_dev(a16, "aria-expanded", "false");
    			add_location(a16, file$3, 186, 28, 8222);
    			attr_dev(input1, "type", "text");
    			attr_dev(input1, "class", "form-control bg-light border-0 small");
    			attr_dev(input1, "placeholder", "Search for...");
    			attr_dev(input1, "aria-label", "Search");
    			attr_dev(input1, "aria-describedby", "basic-addon2");
    			add_location(input1, file$3, 195, 40, 8898);
    			attr_dev(i10, "class", "fas fa-search fa-sm");
    			add_location(i10, file$3, 200, 48, 9343);
    			attr_dev(button6, "class", "btn btn-primary");
    			attr_dev(button6, "type", "button");
    			add_location(button6, file$3, 199, 44, 9248);
    			attr_dev(div15, "class", "input-group-append");
    			add_location(div15, file$3, 198, 40, 9171);
    			attr_dev(div16, "class", "input-group");
    			add_location(div16, file$3, 194, 36, 8832);
    			attr_dev(form1, "class", "form-inline mr-auto w-100 navbar-search");
    			add_location(form1, file$3, 193, 32, 8741);
    			attr_dev(div17, "class", "dropdown-menu dropdown-menu-right p-3 shadow animated--grow-in");
    			attr_dev(div17, "aria-labelledby", "searchDropdown");
    			add_location(div17, file$3, 191, 28, 8567);
    			attr_dev(li6, "class", "nav-item dropdown no-arrow d-sm-none");
    			add_location(li6, file$3, 185, 24, 8144);
    			attr_dev(i11, "class", "fas fa-bell fa-fw");
    			add_location(i11, file$3, 212, 32, 9968);
    			attr_dev(span6, "class", "badge badge-danger badge-counter");
    			add_location(span6, file$3, 214, 32, 10092);
    			attr_dev(a17, "class", "nav-link dropdown-toggle");
    			attr_dev(a17, "id", "alertsDropdown");
    			attr_dev(a17, "data-bs-toggle", "dropdown");
    			attr_dev(a17, "aria-haspopup", "true");
    			attr_dev(a17, "aria-expanded", "false");
    			add_location(a17, file$3, 210, 28, 9777);
    			attr_dev(h64, "class", "dropdown-header");
    			add_location(h64, file$3, 219, 32, 10449);
    			attr_dev(i12, "class", "fas fa-file-alt text-white");
    			add_location(i12, file$3, 225, 44, 10831);
    			attr_dev(div18, "class", "icon-circle bg-primary");
    			add_location(div18, file$3, 224, 40, 10750);
    			attr_dev(div19, "class", "mr-3");
    			add_location(div19, file$3, 223, 36, 10691);
    			attr_dev(div20, "class", "small text-gray-500");
    			add_location(div20, file$3, 229, 40, 11046);
    			attr_dev(span7, "class", "font-weight-bold");
    			add_location(span7, file$3, 230, 40, 11143);
    			add_location(div21, file$3, 228, 36, 11000);
    			attr_dev(button7, "class", "dropdown-item d-flex align-items-center");
    			add_location(button7, file$3, 222, 32, 10598);
    			attr_dev(i13, "class", "fas fa-donate text-white");
    			add_location(i13, file$3, 236, 44, 11574);
    			attr_dev(div22, "class", "icon-circle bg-success");
    			add_location(div22, file$3, 235, 40, 11493);
    			attr_dev(div23, "class", "mr-3");
    			add_location(div23, file$3, 234, 36, 11434);
    			attr_dev(div24, "class", "small text-gray-500");
    			add_location(div24, file$3, 240, 40, 11787);
    			add_location(div25, file$3, 239, 36, 11741);
    			attr_dev(button8, "class", "dropdown-item d-flex align-items-center");
    			add_location(button8, file$3, 233, 32, 11341);
    			attr_dev(i14, "class", "fas fa-exclamation-triangle text-white");
    			add_location(i14, file$3, 247, 44, 12279);
    			attr_dev(div26, "class", "icon-circle bg-warning");
    			add_location(div26, file$3, 246, 40, 12198);
    			attr_dev(div27, "class", "mr-3");
    			add_location(div27, file$3, 245, 36, 12139);
    			attr_dev(div28, "class", "small text-gray-500");
    			add_location(div28, file$3, 251, 40, 12506);
    			add_location(div29, file$3, 250, 36, 12460);
    			attr_dev(button9, "class", "dropdown-item d-flex align-items-center");
    			add_location(button9, file$3, 244, 32, 12046);
    			attr_dev(button10, "class", "dropdown-item text-center small text-gray-500");
    			add_location(button10, file$3, 255, 32, 12791);
    			attr_dev(div30, "class", "dropdown-list dropdown-menu dropdown-menu-right shadow animated--grow-in");
    			attr_dev(div30, "aria-labelledby", "alertsDropdown");
    			add_location(div30, file$3, 217, 28, 10265);
    			attr_dev(li7, "class", "nav-item dropdown no-arrow mx-1");
    			add_location(li7, file$3, 209, 24, 9704);
    			attr_dev(i15, "class", "fas fa-envelope fa-fw");
    			add_location(i15, file$3, 263, 32, 13287);
    			attr_dev(span8, "class", "badge badge-danger badge-counter");
    			add_location(span8, file$3, 265, 32, 13417);
    			attr_dev(a18, "class", "nav-link dropdown-toggle");
    			attr_dev(a18, "id", "messagesDropdown");
    			attr_dev(a18, "data-bs-toggle", "dropdown");
    			attr_dev(a18, "aria-haspopup", "true");
    			attr_dev(a18, "aria-expanded", "false");
    			add_location(a18, file$3, 261, 28, 13094);
    			attr_dev(h65, "class", "dropdown-header");
    			add_location(h65, file$3, 270, 32, 13777);
    			attr_dev(img1, "class", "rounded-circle");
    			if (!src_url_equal(img1.src, img1_src_value = "img/undraw_profile_1.svg")) attr_dev(img1, "src", img1_src_value);
    			attr_dev(img1, "alt", "...");
    			add_location(img1, file$3, 275, 40, 14099);
    			attr_dev(div31, "class", "status-indicator bg-success");
    			add_location(div31, file$3, 277, 40, 14253);
    			attr_dev(div32, "class", "dropdown-list-image mr-3");
    			add_location(div32, file$3, 274, 36, 14020);
    			attr_dev(div33, "class", "text-truncate");
    			add_location(div33, file$3, 280, 40, 14451);
    			attr_dev(div34, "class", "small text-gray-500");
    			add_location(div34, file$3, 282, 40, 14645);
    			attr_dev(div35, "class", "font-weight-bold");
    			add_location(div35, file$3, 279, 36, 14380);
    			attr_dev(button11, "class", "dropdown-item d-flex align-items-center");
    			add_location(button11, file$3, 273, 32, 13927);
    			attr_dev(img2, "class", "rounded-circle");
    			if (!src_url_equal(img2.src, img2_src_value = "img/undraw_profile_2.svg")) attr_dev(img2, "src", img2_src_value);
    			attr_dev(img2, "alt", "...");
    			add_location(img2, file$3, 287, 40, 14992);
    			attr_dev(div36, "class", "status-indicator");
    			add_location(div36, file$3, 289, 40, 15146);
    			attr_dev(div37, "class", "dropdown-list-image mr-3");
    			add_location(div37, file$3, 286, 36, 14913);
    			attr_dev(div38, "class", "text-truncate");
    			add_location(div38, file$3, 292, 40, 15308);
    			attr_dev(div39, "class", "small text-gray-500");
    			add_location(div39, file$3, 294, 40, 15509);
    			add_location(div40, file$3, 291, 36, 15262);
    			attr_dev(button12, "class", "dropdown-item d-flex align-items-center");
    			add_location(button12, file$3, 285, 32, 14820);
    			attr_dev(img3, "class", "rounded-circle");
    			if (!src_url_equal(img3.src, img3_src_value = "img/undraw_profile_3.svg")) attr_dev(img3, "src", img3_src_value);
    			attr_dev(img3, "alt", "...");
    			add_location(img3, file$3, 299, 40, 15851);
    			attr_dev(div41, "class", "status-indicator bg-warning");
    			add_location(div41, file$3, 301, 40, 16005);
    			attr_dev(div42, "class", "dropdown-list-image mr-3");
    			add_location(div42, file$3, 298, 36, 15772);
    			attr_dev(div43, "class", "text-truncate");
    			add_location(div43, file$3, 304, 40, 16178);
    			attr_dev(div44, "class", "small text-gray-500");
    			add_location(div44, file$3, 306, 40, 16393);
    			add_location(div45, file$3, 303, 36, 16132);
    			attr_dev(button13, "class", "dropdown-item d-flex align-items-center");
    			add_location(button13, file$3, 297, 32, 15679);
    			attr_dev(img4, "class", "rounded-circle");
    			if (!src_url_equal(img4.src, img4_src_value = "https://source.unsplash.com/Mv9hjnEUHR4/60x60")) attr_dev(img4, "src", img4_src_value);
    			attr_dev(img4, "alt", "...");
    			add_location(img4, file$3, 311, 40, 16741);
    			attr_dev(div46, "class", "status-indicator bg-success");
    			add_location(div46, file$3, 313, 40, 16916);
    			attr_dev(div47, "class", "dropdown-list-image mr-3");
    			add_location(div47, file$3, 310, 36, 16662);
    			attr_dev(div48, "class", "text-truncate");
    			add_location(div48, file$3, 316, 40, 17089);
    			attr_dev(div49, "class", "small text-gray-500");
    			add_location(div49, file$3, 318, 40, 17329);
    			add_location(div50, file$3, 315, 36, 17043);
    			attr_dev(button14, "class", "dropdown-item d-flex align-items-center");
    			add_location(button14, file$3, 309, 32, 16569);
    			attr_dev(button15, "class", "dropdown-item text-center small text-gray-500");
    			add_location(button15, file$3, 321, 32, 17506);
    			attr_dev(div51, "class", "dropdown-list dropdown-menu dropdown-menu-right shadow animated--grow-in");
    			attr_dev(div51, "aria-labelledby", "messagesDropdown");
    			add_location(div51, file$3, 268, 28, 13591);
    			attr_dev(li8, "class", "nav-item dropdown no-arrow mx-1");
    			add_location(li8, file$3, 260, 24, 13021);
    			attr_dev(div52, "class", "topbar-divider d-none d-sm-block");
    			add_location(div52, file$3, 325, 24, 17686);
    			attr_dev(span9, "class", "mr-2 d-none d-lg-inline text-gray-600 small");
    			add_location(span9, file$3, 331, 32, 18086);
    			attr_dev(img5, "alt", "boingo");
    			attr_dev(img5, "class", "img-profile rounded-circle");
    			if (!src_url_equal(img5.src, img5_src_value = "img/undraw_profile.svg")) attr_dev(img5, "src", img5_src_value);
    			add_location(img5, file$3, 332, 32, 18197);
    			attr_dev(button16, "class", "nav-link dropdown-toggle");
    			attr_dev(button16, "id", "userDropdown");
    			attr_dev(button16, "data-bs-toggle", "dropdown");
    			attr_dev(button16, "aria-haspopup", "true");
    			attr_dev(button16, "aria-expanded", "false");
    			add_location(button16, file$3, 329, 28, 17893);
    			attr_dev(i16, "class", "fas fa-user fa-sm fa-fw mr-2 text-gray-400");
    			add_location(i16, file$3, 339, 36, 18678);
    			attr_dev(button17, "class", "dropdown-item");
    			add_location(button17, file$3, 338, 32, 18611);
    			attr_dev(i17, "class", "fas fa-cogs fa-sm fa-fw mr-2 text-gray-400");
    			add_location(i17, file$3, 343, 36, 18922);
    			attr_dev(button18, "class", "dropdown-item");
    			add_location(button18, file$3, 342, 32, 18855);
    			attr_dev(i18, "class", "fas fa-list fa-sm fa-fw mr-2 text-gray-400");
    			add_location(i18, file$3, 347, 36, 19167);
    			attr_dev(button19, "class", "dropdown-item");
    			add_location(button19, file$3, 346, 32, 19100);
    			attr_dev(div53, "class", "dropdown-divider");
    			add_location(div53, file$3, 350, 32, 19349);
    			attr_dev(i19, "class", "fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400");
    			add_location(i19, file$3, 352, 36, 19538);
    			attr_dev(button20, "class", "dropdown-item");
    			attr_dev(button20, "data-bs-toggle", "modal");
    			attr_dev(button20, "data-bs-target", "#logoutModal");
    			add_location(button20, file$3, 351, 32, 19418);
    			attr_dev(div54, "class", "dropdown-menu dropdown-menu-right shadow animated--grow-in");
    			attr_dev(div54, "aria-labelledby", "userDropdown");
    			add_location(div54, file$3, 336, 28, 18443);
    			attr_dev(li9, "class", "nav-item dropdown no-arrow");
    			add_location(li9, file$3, 328, 24, 17825);
    			attr_dev(ul1, "class", "navbar-nav ml-auto");
    			add_location(ul1, file$3, 182, 20, 8009);
    			attr_dev(nav, "class", "navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow");
    			add_location(nav, file$3, 160, 16, 6828);
    			attr_dev(h1, "class", "h3 mb-0 text-gray-800");
    			add_location(h1, file$3, 368, 24, 20095);
    			attr_dev(i20, "class", "fas fa-download fa-sm text-white-50");
    			add_location(i20, file$3, 369, 98, 20242);
    			attr_dev(button21, "class", "d-none d-sm-inline-block btn btn-sm btn-primary shadow-sm");
    			add_location(button21, file$3, 369, 24, 20168);
    			attr_dev(div55, "class", "d-sm-flex align-items-center justify-content-between mb-4");
    			add_location(div55, file$3, 367, 20, 19999);
    			attr_dev(div56, "class", "text-xs font-weight-bold text-primary text-uppercase mb-1");
    			add_location(div56, file$3, 382, 44, 20917);
    			attr_dev(div57, "class", "h5 mb-0 font-weight-bold text-gray-800");
    			add_location(div57, file$3, 384, 44, 21106);
    			attr_dev(div58, "class", "col mr-2");
    			add_location(div58, file$3, 381, 40, 20850);
    			attr_dev(i21, "class", "fas fa-calendar fa-2x text-gray-300");
    			add_location(i21, file$3, 387, 44, 21326);
    			attr_dev(div59, "class", "col-auto");
    			add_location(div59, file$3, 386, 40, 21259);
    			attr_dev(div60, "class", "row no-gutters align-items-center");
    			add_location(div60, file$3, 380, 36, 20762);
    			attr_dev(div61, "class", "card-body");
    			add_location(div61, file$3, 379, 32, 20702);
    			attr_dev(div62, "class", "card border-left-primary shadow h-100 py-2");
    			add_location(div62, file$3, 378, 28, 20613);
    			attr_dev(div63, "class", "col-xl-3 col-md-6 mb-4");
    			add_location(div63, file$3, 377, 24, 20548);
    			attr_dev(div64, "class", "text-xs font-weight-bold text-success text-uppercase mb-1");
    			add_location(div64, file$3, 400, 44, 22032);
    			attr_dev(div65, "class", "h5 mb-0 font-weight-bold text-gray-800");
    			add_location(div65, file$3, 402, 44, 22220);
    			attr_dev(div66, "class", "col mr-2");
    			add_location(div66, file$3, 399, 40, 21965);
    			attr_dev(i22, "class", "fas fa-dollar-sign fa-2x text-gray-300");
    			add_location(i22, file$3, 405, 44, 22441);
    			attr_dev(div67, "class", "col-auto");
    			add_location(div67, file$3, 404, 40, 22374);
    			attr_dev(div68, "class", "row no-gutters align-items-center");
    			add_location(div68, file$3, 398, 36, 21877);
    			attr_dev(div69, "class", "card-body");
    			add_location(div69, file$3, 397, 32, 21817);
    			attr_dev(div70, "class", "card border-left-success shadow h-100 py-2");
    			add_location(div70, file$3, 396, 28, 21728);
    			attr_dev(div71, "class", "col-xl-3 col-md-6 mb-4");
    			add_location(div71, file$3, 395, 24, 21663);
    			attr_dev(div72, "class", "text-xs font-weight-bold text-info text-uppercase mb-1");
    			add_location(div72, file$3, 418, 44, 23147);
    			attr_dev(div73, "class", "h5 mb-0 mr-3 font-weight-bold text-gray-800");
    			add_location(div73, file$3, 422, 52, 23487);
    			attr_dev(div74, "class", "col-auto");
    			add_location(div74, file$3, 421, 48, 23412);
    			attr_dev(div75, "class", "progress-bar bg-info");
    			attr_dev(div75, "role", "progressbar");
    			set_style(div75, "width", "50%");
    			attr_dev(div75, "aria-valuenow", "50");
    			attr_dev(div75, "aria-valuemin", "0");
    			attr_dev(div75, "aria-valuemax", "100");
    			add_location(div75, file$3, 426, 56, 23823);
    			attr_dev(div76, "class", "progress progress-sm mr-2");
    			add_location(div76, file$3, 425, 52, 23727);
    			attr_dev(div77, "class", "col");
    			add_location(div77, file$3, 424, 48, 23657);
    			attr_dev(div78, "class", "row no-gutters align-items-center");
    			add_location(div78, file$3, 420, 44, 23316);
    			attr_dev(div79, "class", "col mr-2");
    			add_location(div79, file$3, 417, 40, 23080);
    			attr_dev(i23, "class", "fas fa-clipboard-list fa-2x text-gray-300");
    			add_location(i23, file$3, 434, 44, 24398);
    			attr_dev(div80, "class", "col-auto");
    			add_location(div80, file$3, 433, 40, 24331);
    			attr_dev(div81, "class", "row no-gutters align-items-center");
    			add_location(div81, file$3, 416, 36, 22992);
    			attr_dev(div82, "class", "card-body");
    			add_location(div82, file$3, 415, 32, 22932);
    			attr_dev(div83, "class", "card border-left-info shadow h-100 py-2");
    			add_location(div83, file$3, 414, 28, 22846);
    			attr_dev(div84, "class", "col-xl-3 col-md-6 mb-4");
    			add_location(div84, file$3, 413, 24, 22781);
    			attr_dev(div85, "class", "text-xs font-weight-bold text-warning text-uppercase mb-1");
    			add_location(div85, file$3, 447, 44, 25108);
    			attr_dev(div86, "class", "h5 mb-0 font-weight-bold text-gray-800");
    			add_location(div86, file$3, 449, 44, 25295);
    			attr_dev(div87, "class", "col mr-2");
    			add_location(div87, file$3, 446, 40, 25041);
    			attr_dev(i24, "class", "fas fa-comments fa-2x text-gray-300");
    			add_location(i24, file$3, 452, 44, 25510);
    			attr_dev(div88, "class", "col-auto");
    			add_location(div88, file$3, 451, 40, 25443);
    			attr_dev(div89, "class", "row no-gutters align-items-center");
    			add_location(div89, file$3, 445, 36, 24953);
    			attr_dev(div90, "class", "card-body");
    			add_location(div90, file$3, 444, 32, 24893);
    			attr_dev(div91, "class", "card border-left-warning shadow h-100 py-2");
    			add_location(div91, file$3, 443, 28, 24804);
    			attr_dev(div92, "class", "col-xl-3 col-md-6 mb-4");
    			add_location(div92, file$3, 442, 24, 24739);
    			attr_dev(div93, "class", "row");
    			add_location(div93, file$3, 374, 20, 20440);
    			attr_dev(h66, "class", "m-0 font-weight-bold text-primary");
    			add_location(h66, file$3, 470, 36, 26283);
    			attr_dev(i25, "class", "fas fa-ellipsis-v fa-sm fa-fw text-gray-400");
    			add_location(i25, file$3, 474, 44, 26667);
    			attr_dev(a19, "class", "dropdown-toggle");
    			attr_dev(a19, "id", "dropdownMenuLink");
    			attr_dev(a19, "data-bs-toggle", "dropdown");
    			attr_dev(a19, "aria-haspopup", "true");
    			attr_dev(a19, "aria-expanded", "false");
    			add_location(a19, file$3, 472, 40, 26460);
    			attr_dev(div94, "class", "dropdown-header");
    			add_location(div94, file$3, 478, 44, 27008);
    			attr_dev(button22, "class", "dropdown-item");
    			add_location(button22, file$3, 479, 44, 27104);
    			attr_dev(button23, "class", "dropdown-item");
    			add_location(button23, file$3, 480, 44, 27194);
    			attr_dev(div95, "class", "dropdown-divider");
    			add_location(div95, file$3, 481, 44, 27292);
    			attr_dev(button24, "class", "dropdown-item");
    			add_location(button24, file$3, 482, 44, 27373);
    			attr_dev(div96, "class", "dropdown-menu dropdown-menu-right shadow animated--fade-in");
    			attr_dev(div96, "aria-labelledby", "dropdownMenuLink");
    			add_location(div96, file$3, 476, 40, 26812);
    			attr_dev(div97, "class", "dropdown no-arrow");
    			add_location(div97, file$3, 471, 36, 26388);
    			attr_dev(div98, "class", "card-header py-3 d-flex flex-row align-items-center justify-content-between");
    			add_location(div98, file$3, 468, 32, 26121);
    			attr_dev(canvas0, "id", "myAreaChart");
    			add_location(canvas0, file$3, 489, 40, 27769);
    			attr_dev(div99, "class", "chart-area");
    			add_location(div99, file$3, 488, 36, 27704);
    			attr_dev(div100, "class", "card-body");
    			add_location(div100, file$3, 487, 32, 27644);
    			attr_dev(div101, "class", "card shadow mb-4");
    			add_location(div101, file$3, 466, 28, 25994);
    			attr_dev(div102, "class", "col-xl-8 col-lg-7");
    			add_location(div102, file$3, 465, 24, 25934);
    			attr_dev(h67, "class", "m-0 font-weight-bold text-primary");
    			add_location(h67, file$3, 501, 36, 28369);
    			attr_dev(i26, "class", "fas fa-ellipsis-v fa-sm fa-fw text-gray-400");
    			add_location(i26, file$3, 505, 44, 28752);
    			attr_dev(a20, "class", "dropdown-toggle");
    			attr_dev(a20, "id", "dropdownMenuLink");
    			attr_dev(a20, "data-bs-toggle", "dropdown");
    			attr_dev(a20, "aria-haspopup", "true");
    			attr_dev(a20, "aria-expanded", "false");
    			add_location(a20, file$3, 503, 40, 28544);
    			attr_dev(div103, "class", "dropdown-header");
    			add_location(div103, file$3, 509, 44, 29093);
    			attr_dev(button25, "class", "dropdown-item");
    			add_location(button25, file$3, 510, 44, 29189);
    			attr_dev(button26, "class", "dropdown-item");
    			add_location(button26, file$3, 511, 44, 29279);
    			attr_dev(div104, "class", "dropdown-divider");
    			add_location(div104, file$3, 512, 44, 29377);
    			attr_dev(button27, "class", "dropdown-item");
    			add_location(button27, file$3, 513, 44, 29458);
    			attr_dev(div105, "class", "dropdown-menu dropdown-menu-right shadow animated--fade-in");
    			attr_dev(div105, "aria-labelledby", "dropdownMenuLink");
    			add_location(div105, file$3, 507, 40, 28897);
    			attr_dev(div106, "class", "dropdown no-arrow");
    			add_location(div106, file$3, 502, 36, 28472);
    			attr_dev(div107, "class", "card-header py-3 d-flex flex-row align-items-center justify-content-between");
    			add_location(div107, file$3, 499, 32, 28207);
    			attr_dev(canvas1, "id", "myPieChart");
    			add_location(canvas1, file$3, 520, 40, 29863);
    			attr_dev(div108, "class", "chart-pie pt-4 pb-2");
    			add_location(div108, file$3, 519, 36, 29789);
    			attr_dev(i27, "class", "fas fa-circle text-primary");
    			add_location(i27, file$3, 524, 44, 30117);
    			attr_dev(span10, "class", "mr-2");
    			add_location(span10, file$3, 523, 40, 30053);
    			attr_dev(i28, "class", "fas fa-circle text-success");
    			add_location(i28, file$3, 527, 44, 30319);
    			attr_dev(span11, "class", "mr-2");
    			add_location(span11, file$3, 526, 40, 30255);
    			attr_dev(i29, "class", "fas fa-circle text-info");
    			add_location(i29, file$3, 530, 44, 30521);
    			attr_dev(span12, "class", "mr-2");
    			add_location(span12, file$3, 529, 40, 30457);
    			attr_dev(div109, "class", "mt-4 text-center small");
    			add_location(div109, file$3, 522, 36, 29976);
    			attr_dev(div110, "class", "card-body");
    			add_location(div110, file$3, 518, 32, 29729);
    			attr_dev(div111, "class", "card shadow mb-4");
    			add_location(div111, file$3, 497, 28, 28080);
    			attr_dev(div112, "class", "col-xl-4 col-lg-5");
    			add_location(div112, file$3, 496, 24, 28020);
    			attr_dev(div113, "class", "row");
    			add_location(div113, file$3, 462, 20, 25847);
    			attr_dev(h68, "class", "m-0 font-weight-bold text-primary");
    			add_location(h68, file$3, 547, 36, 31191);
    			attr_dev(div114, "class", "card-header py-3");
    			add_location(div114, file$3, 546, 32, 31124);
    			attr_dev(span13, "class", "float-right");
    			add_location(span13, file$3, 550, 88, 31434);
    			attr_dev(h40, "class", "small font-weight-bold");
    			add_location(h40, file$3, 550, 36, 31382);
    			attr_dev(div115, "class", "progress-bar bg-danger");
    			attr_dev(div115, "role", "progressbar");
    			set_style(div115, "width", "20%");
    			attr_dev(div115, "aria-valuenow", "20");
    			attr_dev(div115, "aria-valuemin", "0");
    			attr_dev(div115, "aria-valuemax", "100");
    			add_location(div115, file$3, 553, 40, 31624);
    			attr_dev(div116, "class", "progress mb-4");
    			add_location(div116, file$3, 552, 36, 31556);
    			attr_dev(span14, "class", "float-right");
    			add_location(span14, file$3, 556, 86, 31935);
    			attr_dev(h41, "class", "small font-weight-bold");
    			add_location(h41, file$3, 556, 36, 31885);
    			attr_dev(div117, "class", "progress-bar bg-warning");
    			attr_dev(div117, "role", "progressbar");
    			set_style(div117, "width", "40%");
    			attr_dev(div117, "aria-valuenow", "40");
    			attr_dev(div117, "aria-valuemin", "0");
    			attr_dev(div117, "aria-valuemax", "100");
    			add_location(div117, file$3, 559, 40, 32125);
    			attr_dev(div118, "class", "progress mb-4");
    			add_location(div118, file$3, 558, 36, 32057);
    			attr_dev(span15, "class", "float-right");
    			add_location(span15, file$3, 562, 89, 32440);
    			attr_dev(h42, "class", "small font-weight-bold");
    			add_location(h42, file$3, 562, 36, 32387);
    			attr_dev(div119, "class", "progress-bar");
    			attr_dev(div119, "role", "progressbar");
    			set_style(div119, "width", "60%");
    			attr_dev(div119, "aria-valuenow", "60");
    			attr_dev(div119, "aria-valuemin", "0");
    			attr_dev(div119, "aria-valuemax", "100");
    			add_location(div119, file$3, 565, 40, 32630);
    			attr_dev(div120, "class", "progress mb-4");
    			add_location(div120, file$3, 564, 36, 32562);
    			attr_dev(span16, "class", "float-right");
    			add_location(span16, file$3, 568, 86, 32931);
    			attr_dev(h43, "class", "small font-weight-bold");
    			add_location(h43, file$3, 568, 36, 32881);
    			attr_dev(div121, "class", "progress-bar bg-info");
    			attr_dev(div121, "role", "progressbar");
    			set_style(div121, "width", "80%");
    			attr_dev(div121, "aria-valuenow", "80");
    			attr_dev(div121, "aria-valuemin", "0");
    			attr_dev(div121, "aria-valuemax", "100");
    			add_location(div121, file$3, 571, 40, 33121);
    			attr_dev(div122, "class", "progress mb-4");
    			add_location(div122, file$3, 570, 36, 33053);
    			attr_dev(span17, "class", "float-right");
    			add_location(span17, file$3, 574, 85, 33429);
    			attr_dev(h44, "class", "small font-weight-bold");
    			add_location(h44, file$3, 574, 36, 33380);
    			attr_dev(div123, "class", "progress-bar bg-success");
    			attr_dev(div123, "role", "progressbar");
    			set_style(div123, "width", "100%");
    			attr_dev(div123, "aria-valuenow", "100");
    			attr_dev(div123, "aria-valuemin", "0");
    			attr_dev(div123, "aria-valuemax", "100");
    			add_location(div123, file$3, 577, 40, 33620);
    			attr_dev(div124, "class", "progress");
    			add_location(div124, file$3, 576, 36, 33557);
    			attr_dev(div125, "class", "card-body");
    			add_location(div125, file$3, 549, 32, 31322);
    			attr_dev(div126, "class", "card shadow mb-4");
    			add_location(div126, file$3, 545, 28, 31061);
    			attr_dev(div127, "class", "text-white-50 small");
    			add_location(div127, file$3, 589, 44, 34323);
    			attr_dev(div128, "class", "card-body");
    			add_location(div128, file$3, 587, 40, 34203);
    			attr_dev(div129, "class", "card bg-primary text-white shadow");
    			add_location(div129, file$3, 586, 36, 34115);
    			attr_dev(div130, "class", "col-lg-6 mb-4");
    			add_location(div130, file$3, 585, 32, 34051);
    			attr_dev(div131, "class", "text-white-50 small");
    			add_location(div131, file$3, 597, 44, 34803);
    			attr_dev(div132, "class", "card-body");
    			add_location(div132, file$3, 595, 40, 34683);
    			attr_dev(div133, "class", "card bg-success text-white shadow");
    			add_location(div133, file$3, 594, 36, 34595);
    			attr_dev(div134, "class", "col-lg-6 mb-4");
    			add_location(div134, file$3, 593, 32, 34531);
    			attr_dev(div135, "class", "text-white-50 small");
    			add_location(div135, file$3, 605, 44, 35277);
    			attr_dev(div136, "class", "card-body");
    			add_location(div136, file$3, 603, 40, 35160);
    			attr_dev(div137, "class", "card bg-info text-white shadow");
    			add_location(div137, file$3, 602, 36, 35075);
    			attr_dev(div138, "class", "col-lg-6 mb-4");
    			add_location(div138, file$3, 601, 32, 35011);
    			attr_dev(div139, "class", "text-white-50 small");
    			add_location(div139, file$3, 613, 44, 35757);
    			attr_dev(div140, "class", "card-body");
    			add_location(div140, file$3, 611, 40, 35637);
    			attr_dev(div141, "class", "card bg-warning text-white shadow");
    			add_location(div141, file$3, 610, 36, 35549);
    			attr_dev(div142, "class", "col-lg-6 mb-4");
    			add_location(div142, file$3, 609, 32, 35485);
    			attr_dev(div143, "class", "text-white-50 small");
    			add_location(div143, file$3, 621, 44, 36235);
    			attr_dev(div144, "class", "card-body");
    			add_location(div144, file$3, 619, 40, 36116);
    			attr_dev(div145, "class", "card bg-danger text-white shadow");
    			add_location(div145, file$3, 618, 36, 36029);
    			attr_dev(div146, "class", "col-lg-6 mb-4");
    			add_location(div146, file$3, 617, 32, 35965);
    			attr_dev(div147, "class", "text-white-50 small");
    			add_location(div147, file$3, 629, 44, 36719);
    			attr_dev(div148, "class", "card-body");
    			add_location(div148, file$3, 627, 40, 36597);
    			attr_dev(div149, "class", "card bg-secondary text-white shadow");
    			add_location(div149, file$3, 626, 36, 36507);
    			attr_dev(div150, "class", "col-lg-6 mb-4");
    			add_location(div150, file$3, 625, 32, 36443);
    			attr_dev(div151, "class", "text-black-50 small");
    			add_location(div151, file$3, 637, 44, 37195);
    			attr_dev(div152, "class", "card-body");
    			add_location(div152, file$3, 635, 40, 37077);
    			attr_dev(div153, "class", "card bg-light text-black shadow");
    			add_location(div153, file$3, 634, 36, 36991);
    			attr_dev(div154, "class", "col-lg-6 mb-4");
    			add_location(div154, file$3, 633, 32, 36927);
    			attr_dev(div155, "class", "text-white-50 small");
    			add_location(div155, file$3, 645, 44, 37669);
    			attr_dev(div156, "class", "card-body");
    			add_location(div156, file$3, 643, 40, 37552);
    			attr_dev(div157, "class", "card bg-dark text-white shadow");
    			add_location(div157, file$3, 642, 36, 37467);
    			attr_dev(div158, "class", "col-lg-6 mb-4");
    			add_location(div158, file$3, 641, 32, 37403);
    			attr_dev(div159, "class", "row");
    			add_location(div159, file$3, 584, 28, 34001);
    			attr_dev(div160, "class", "col-lg-6 mb-4");
    			add_location(div160, file$3, 542, 24, 30946);
    			attr_dev(h69, "class", "m-0 font-weight-bold text-primary");
    			add_location(h69, file$3, 658, 36, 38175);
    			attr_dev(div161, "class", "card-header py-3");
    			add_location(div161, file$3, 657, 32, 38108);
    			attr_dev(img6, "class", "img-fluid px-3 px-sm-4 mt-3 mb-4");
    			set_style(img6, "width", "25rem");
    			if (!src_url_equal(img6.src, img6_src_value = "img/undraw_posting_photo.svg")) attr_dev(img6, "src", img6_src_value);
    			attr_dev(img6, "alt", "...");
    			add_location(img6, file$3, 662, 40, 38437);
    			attr_dev(div162, "class", "text-center");
    			add_location(div162, file$3, 661, 36, 38371);
    			attr_dev(a21, "target", "_blank");
    			attr_dev(a21, "rel", "nofollow");
    			attr_dev(a21, "href", "https://undraw.co/");
    			add_location(a21, file$3, 665, 103, 38741);
    			add_location(p1, file$3, 665, 36, 38674);
    			attr_dev(a22, "target", "_blank");
    			attr_dev(a22, "rel", "nofollow");
    			attr_dev(a22, "href", "https://undraw.co/");
    			add_location(a22, file$3, 669, 36, 39091);
    			attr_dev(div163, "class", "card-body");
    			add_location(div163, file$3, 660, 32, 38311);
    			attr_dev(div164, "class", "card shadow mb-4");
    			add_location(div164, file$3, 656, 28, 38045);
    			attr_dev(h610, "class", "m-0 font-weight-bold text-primary");
    			add_location(h610, file$3, 677, 36, 39512);
    			attr_dev(div165, "class", "card-header py-3");
    			add_location(div165, file$3, 676, 32, 39445);
    			add_location(p2, file$3, 680, 36, 39715);
    			attr_dev(p3, "class", "mb-0");
    			add_location(p3, file$3, 683, 36, 40040);
    			attr_dev(div166, "class", "card-body");
    			add_location(div166, file$3, 679, 32, 39655);
    			attr_dev(div167, "class", "card shadow mb-4");
    			add_location(div167, file$3, 675, 28, 39382);
    			attr_dev(div168, "class", "col-lg-6 mb-4");
    			add_location(div168, file$3, 653, 24, 37937);
    			attr_dev(div169, "class", "row");
    			add_location(div169, file$3, 539, 20, 30855);
    			attr_dev(div170, "class", "container-fluid");
    			add_location(div170, file$3, 364, 16, 19906);
    			attr_dev(div171, "id", "content");
    			add_location(div171, file$3, 157, 12, 6760);
    			add_location(span18, file$3, 701, 24, 40699);
    			attr_dev(div172, "class", "copyright text-center my-auto");
    			add_location(div172, file$3, 700, 20, 40631);
    			attr_dev(div173, "class", "container my-auto");
    			add_location(div173, file$3, 699, 16, 40579);
    			attr_dev(footer, "class", "sticky-footer bg-white");
    			add_location(footer, file$3, 698, 12, 40523);
    			attr_dev(div174, "id", "content-wrapper");
    			attr_dev(div174, "class", "d-flex flex-column");
    			add_location(div174, file$3, 154, 8, 6659);
    			attr_dev(div175, "id", "wrapper");
    			add_location(div175, file$3, 26, 4, 783);
    			attr_dev(i30, "class", "fas fa-angle-up");
    			add_location(i30, file$3, 715, 8, 41052);
    			attr_dev(a23, "class", "scroll-to-top rounded");
    			attr_dev(a23, "href", "#page-top");
    			add_location(a23, file$3, 714, 4, 40993);
    			attr_dev(h5, "class", "modal-title");
    			attr_dev(h5, "id", "exampleModalLabel");
    			add_location(h5, file$3, 724, 20, 41410);
    			attr_dev(span19, "aria-hidden", "true");
    			add_location(span19, file$3, 726, 24, 41599);
    			attr_dev(button28, "class", "close");
    			attr_dev(button28, "type", "button");
    			attr_dev(button28, "data-dismiss", "modal");
    			attr_dev(button28, "aria-label", "Close");
    			add_location(button28, file$3, 725, 20, 41498);
    			attr_dev(div176, "class", "modal-header");
    			add_location(div176, file$3, 723, 16, 41363);
    			attr_dev(div177, "class", "modal-body");
    			add_location(div177, file$3, 729, 16, 41702);
    			attr_dev(button29, "class", "btn btn-secondary");
    			attr_dev(button29, "type", "button");
    			attr_dev(button29, "data-dismiss", "modal");
    			add_location(button29, file$3, 731, 20, 41863);
    			attr_dev(a24, "class", "btn btn-primary");
    			attr_dev(a24, "href", "login.html");
    			add_location(a24, file$3, 732, 20, 41968);
    			attr_dev(div178, "class", "modal-footer");
    			add_location(div178, file$3, 730, 16, 41816);
    			attr_dev(div179, "class", "modal-content");
    			add_location(div179, file$3, 722, 12, 41319);
    			attr_dev(div180, "class", "modal-dialog");
    			attr_dev(div180, "role", "document");
    			add_location(div180, file$3, 721, 8, 41264);
    			attr_dev(div181, "class", "modal fade");
    			attr_dev(div181, "id", "logoutModal");
    			attr_dev(div181, "tabindex", "-1");
    			attr_dev(div181, "role", "dialog");
    			attr_dev(div181, "aria-labelledby", "exampleModalLabel");
    			attr_dev(div181, "aria-hidden", "true");
    			add_location(div181, file$3, 719, 4, 41123);
    			if (!src_url_equal(script0.src, script0_src_value = "js/sb-admin-2.min.js")) attr_dev(script0, "src", script0_src_value);
    			add_location(script0, file$3, 738, 4, 42097);
    			if (!src_url_equal(script1.src, script1_src_value = "vendor/chart.js/Chart.min.js")) attr_dev(script1, "src", script1_src_value);
    			add_location(script1, file$3, 740, 4, 42147);
    			if (!src_url_equal(script2.src, script2_src_value = "js/demo/chart-area-demo.js")) attr_dev(script2, "src", script2_src_value);
    			add_location(script2, file$3, 743, 4, 42244);
    			if (!src_url_equal(script3.src, script3_src_value = "js/demo/chart-pie-demo.js")) attr_dev(script3, "src", script3_src_value);
    			add_location(script3, file$3, 744, 4, 42299);
    			attr_dev(body, "id", "page-top");
    			add_location(body, file$3, 23, 0, 731);
    			attr_dev(html, "lang", "en");
    			add_location(html, file$3, 0, 0, 0);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, html, anchor);
    			append_dev(html, head);
    			append_dev(head, meta0);
    			append_dev(head, t0);
    			append_dev(head, meta1);
    			append_dev(head, t1);
    			append_dev(head, meta2);
    			append_dev(head, t2);
    			append_dev(head, meta3);
    			append_dev(head, t3);
    			append_dev(head, meta4);
    			append_dev(head, t4);
    			append_dev(head, title);
    			append_dev(head, t6);
    			append_dev(head, link0);
    			append_dev(head, t7);
    			append_dev(head, link1);
    			append_dev(head, t8);
    			append_dev(head, link2);
    			append_dev(html, t9);
    			append_dev(html, body);
    			append_dev(body, div175);
    			append_dev(div175, ul0);
    			append_dev(ul0, a0);
    			append_dev(a0, div0);
    			append_dev(div0, i0);
    			append_dev(a0, t10);
    			append_dev(a0, div1);
    			append_dev(div1, t11);
    			append_dev(div1, sup);
    			append_dev(ul0, t13);
    			append_dev(ul0, hr0);
    			append_dev(ul0, t14);
    			append_dev(ul0, li0);
    			append_dev(li0, a1);
    			append_dev(a1, i1);
    			append_dev(a1, t15);
    			append_dev(a1, span0);
    			append_dev(ul0, t17);
    			append_dev(ul0, hr1);
    			append_dev(ul0, t18);
    			append_dev(ul0, div2);
    			append_dev(ul0, t20);
    			append_dev(ul0, li1);
    			append_dev(li1, button0);
    			append_dev(button0, i2);
    			append_dev(button0, t21);
    			append_dev(button0, span1);
    			append_dev(li1, t23);
    			append_dev(li1, div4);
    			append_dev(div4, div3);
    			append_dev(div3, h60);
    			append_dev(div3, t25);
    			append_dev(div3, a2);
    			append_dev(div3, t27);
    			append_dev(div3, a3);
    			append_dev(ul0, t29);
    			append_dev(ul0, li2);
    			append_dev(li2, button1);
    			append_dev(button1, i3);
    			append_dev(button1, t30);
    			append_dev(button1, span2);
    			append_dev(li2, t32);
    			append_dev(li2, div6);
    			append_dev(div6, div5);
    			append_dev(div5, h61);
    			append_dev(div5, t34);
    			append_dev(div5, a4);
    			append_dev(div5, t36);
    			append_dev(div5, a5);
    			append_dev(div5, t38);
    			append_dev(div5, a6);
    			append_dev(div5, t40);
    			append_dev(div5, a7);
    			append_dev(ul0, t42);
    			append_dev(ul0, hr2);
    			append_dev(ul0, t43);
    			append_dev(ul0, div7);
    			append_dev(ul0, t45);
    			append_dev(ul0, li3);
    			append_dev(li3, button2);
    			append_dev(button2, i4);
    			append_dev(button2, t46);
    			append_dev(button2, span3);
    			append_dev(li3, t48);
    			append_dev(li3, div10);
    			append_dev(div10, div9);
    			append_dev(div9, h62);
    			append_dev(div9, t50);
    			append_dev(div9, a8);
    			append_dev(div9, t52);
    			append_dev(div9, a9);
    			append_dev(div9, t54);
    			append_dev(div9, a10);
    			append_dev(div9, t56);
    			append_dev(div9, div8);
    			append_dev(div9, t57);
    			append_dev(div9, h63);
    			append_dev(div9, t59);
    			append_dev(div9, a11);
    			append_dev(div9, t61);
    			append_dev(div9, a12);
    			append_dev(ul0, t63);
    			append_dev(ul0, li4);
    			append_dev(li4, a13);
    			append_dev(a13, i5);
    			append_dev(a13, t64);
    			append_dev(a13, span4);
    			append_dev(ul0, t66);
    			append_dev(ul0, li5);
    			append_dev(li5, a14);
    			append_dev(a14, i6);
    			append_dev(a14, t67);
    			append_dev(a14, span5);
    			append_dev(ul0, t69);
    			append_dev(ul0, hr3);
    			append_dev(ul0, t70);
    			append_dev(ul0, div11);
    			append_dev(div11, button3);
    			append_dev(ul0, t71);
    			append_dev(ul0, div12);
    			append_dev(div12, img0);
    			append_dev(div12, t72);
    			append_dev(div12, p0);
    			append_dev(p0, strong);
    			append_dev(p0, t74);
    			append_dev(div12, t75);
    			append_dev(div12, a15);
    			append_dev(div175, t77);
    			append_dev(div175, div174);
    			append_dev(div174, div171);
    			append_dev(div171, nav);
    			append_dev(nav, button4);
    			append_dev(button4, i7);
    			append_dev(nav, t78);
    			append_dev(nav, form0);
    			append_dev(form0, div14);
    			append_dev(div14, input0);
    			append_dev(div14, t79);
    			append_dev(div14, div13);
    			append_dev(div13, button5);
    			append_dev(button5, i8);
    			append_dev(nav, t80);
    			append_dev(nav, ul1);
    			append_dev(ul1, li6);
    			append_dev(li6, a16);
    			append_dev(a16, i9);
    			append_dev(li6, t81);
    			append_dev(li6, div17);
    			append_dev(div17, form1);
    			append_dev(form1, div16);
    			append_dev(div16, input1);
    			append_dev(div16, t82);
    			append_dev(div16, div15);
    			append_dev(div15, button6);
    			append_dev(button6, i10);
    			append_dev(ul1, t83);
    			append_dev(ul1, li7);
    			append_dev(li7, a17);
    			append_dev(a17, i11);
    			append_dev(a17, t84);
    			append_dev(a17, span6);
    			append_dev(li7, t86);
    			append_dev(li7, div30);
    			append_dev(div30, h64);
    			append_dev(div30, t88);
    			append_dev(div30, button7);
    			append_dev(button7, div19);
    			append_dev(div19, div18);
    			append_dev(div18, i12);
    			append_dev(button7, t89);
    			append_dev(button7, div21);
    			append_dev(div21, div20);
    			append_dev(div21, t91);
    			append_dev(div21, span7);
    			append_dev(div30, t93);
    			append_dev(div30, button8);
    			append_dev(button8, div23);
    			append_dev(div23, div22);
    			append_dev(div22, i13);
    			append_dev(button8, t94);
    			append_dev(button8, div25);
    			append_dev(div25, div24);
    			append_dev(div25, t96);
    			append_dev(div30, t97);
    			append_dev(div30, button9);
    			append_dev(button9, div27);
    			append_dev(div27, div26);
    			append_dev(div26, i14);
    			append_dev(button9, t98);
    			append_dev(button9, div29);
    			append_dev(div29, div28);
    			append_dev(div29, t100);
    			append_dev(div30, t101);
    			append_dev(div30, button10);
    			append_dev(ul1, t103);
    			append_dev(ul1, li8);
    			append_dev(li8, a18);
    			append_dev(a18, i15);
    			append_dev(a18, t104);
    			append_dev(a18, span8);
    			append_dev(li8, t106);
    			append_dev(li8, div51);
    			append_dev(div51, h65);
    			append_dev(div51, t108);
    			append_dev(div51, button11);
    			append_dev(button11, div32);
    			append_dev(div32, img1);
    			append_dev(div32, t109);
    			append_dev(div32, div31);
    			append_dev(button11, t110);
    			append_dev(button11, div35);
    			append_dev(div35, div33);
    			append_dev(div35, t112);
    			append_dev(div35, div34);
    			append_dev(div51, t114);
    			append_dev(div51, button12);
    			append_dev(button12, div37);
    			append_dev(div37, img2);
    			append_dev(div37, t115);
    			append_dev(div37, div36);
    			append_dev(button12, t116);
    			append_dev(button12, div40);
    			append_dev(div40, div38);
    			append_dev(div40, t118);
    			append_dev(div40, div39);
    			append_dev(div51, t120);
    			append_dev(div51, button13);
    			append_dev(button13, div42);
    			append_dev(div42, img3);
    			append_dev(div42, t121);
    			append_dev(div42, div41);
    			append_dev(button13, t122);
    			append_dev(button13, div45);
    			append_dev(div45, div43);
    			append_dev(div45, t124);
    			append_dev(div45, div44);
    			append_dev(div51, t126);
    			append_dev(div51, button14);
    			append_dev(button14, div47);
    			append_dev(div47, img4);
    			append_dev(div47, t127);
    			append_dev(div47, div46);
    			append_dev(button14, t128);
    			append_dev(button14, div50);
    			append_dev(div50, div48);
    			append_dev(div50, t130);
    			append_dev(div50, div49);
    			append_dev(div51, t132);
    			append_dev(div51, button15);
    			append_dev(ul1, t134);
    			append_dev(ul1, div52);
    			append_dev(ul1, t135);
    			append_dev(ul1, li9);
    			append_dev(li9, button16);
    			append_dev(button16, span9);
    			append_dev(button16, t137);
    			append_dev(button16, img5);
    			append_dev(li9, t138);
    			append_dev(li9, div54);
    			append_dev(div54, button17);
    			append_dev(button17, i16);
    			append_dev(button17, t139);
    			append_dev(div54, t140);
    			append_dev(div54, button18);
    			append_dev(button18, i17);
    			append_dev(button18, t141);
    			append_dev(div54, t142);
    			append_dev(div54, button19);
    			append_dev(button19, i18);
    			append_dev(button19, t143);
    			append_dev(div54, t144);
    			append_dev(div54, div53);
    			append_dev(div54, t145);
    			append_dev(div54, button20);
    			append_dev(button20, i19);
    			append_dev(button20, t146);
    			append_dev(div171, t147);
    			append_dev(div171, div170);
    			append_dev(div170, div55);
    			append_dev(div55, h1);
    			append_dev(div55, t149);
    			append_dev(div55, button21);
    			append_dev(button21, i20);
    			append_dev(button21, t150);
    			append_dev(div170, t151);
    			append_dev(div170, div93);
    			append_dev(div93, div63);
    			append_dev(div63, div62);
    			append_dev(div62, div61);
    			append_dev(div61, div60);
    			append_dev(div60, div58);
    			append_dev(div58, div56);
    			append_dev(div58, t153);
    			append_dev(div58, div57);
    			append_dev(div60, t155);
    			append_dev(div60, div59);
    			append_dev(div59, i21);
    			append_dev(div93, t156);
    			append_dev(div93, div71);
    			append_dev(div71, div70);
    			append_dev(div70, div69);
    			append_dev(div69, div68);
    			append_dev(div68, div66);
    			append_dev(div66, div64);
    			append_dev(div66, t158);
    			append_dev(div66, div65);
    			append_dev(div68, t160);
    			append_dev(div68, div67);
    			append_dev(div67, i22);
    			append_dev(div93, t161);
    			append_dev(div93, div84);
    			append_dev(div84, div83);
    			append_dev(div83, div82);
    			append_dev(div82, div81);
    			append_dev(div81, div79);
    			append_dev(div79, div72);
    			append_dev(div79, t163);
    			append_dev(div79, div78);
    			append_dev(div78, div74);
    			append_dev(div74, div73);
    			append_dev(div78, t165);
    			append_dev(div78, div77);
    			append_dev(div77, div76);
    			append_dev(div76, div75);
    			append_dev(div81, t166);
    			append_dev(div81, div80);
    			append_dev(div80, i23);
    			append_dev(div93, t167);
    			append_dev(div93, div92);
    			append_dev(div92, div91);
    			append_dev(div91, div90);
    			append_dev(div90, div89);
    			append_dev(div89, div87);
    			append_dev(div87, div85);
    			append_dev(div87, t169);
    			append_dev(div87, div86);
    			append_dev(div89, t171);
    			append_dev(div89, div88);
    			append_dev(div88, i24);
    			append_dev(div170, t172);
    			append_dev(div170, div113);
    			append_dev(div113, div102);
    			append_dev(div102, div101);
    			append_dev(div101, div98);
    			append_dev(div98, h66);
    			append_dev(div98, t174);
    			append_dev(div98, div97);
    			append_dev(div97, a19);
    			append_dev(a19, i25);
    			append_dev(div97, t175);
    			append_dev(div97, div96);
    			append_dev(div96, div94);
    			append_dev(div96, t177);
    			append_dev(div96, button22);
    			append_dev(div96, t179);
    			append_dev(div96, button23);
    			append_dev(div96, t181);
    			append_dev(div96, div95);
    			append_dev(div96, t182);
    			append_dev(div96, button24);
    			append_dev(div101, t184);
    			append_dev(div101, div100);
    			append_dev(div100, div99);
    			append_dev(div99, canvas0);
    			append_dev(div113, t185);
    			append_dev(div113, div112);
    			append_dev(div112, div111);
    			append_dev(div111, div107);
    			append_dev(div107, h67);
    			append_dev(div107, t187);
    			append_dev(div107, div106);
    			append_dev(div106, a20);
    			append_dev(a20, i26);
    			append_dev(div106, t188);
    			append_dev(div106, div105);
    			append_dev(div105, div103);
    			append_dev(div105, t190);
    			append_dev(div105, button25);
    			append_dev(div105, t192);
    			append_dev(div105, button26);
    			append_dev(div105, t194);
    			append_dev(div105, div104);
    			append_dev(div105, t195);
    			append_dev(div105, button27);
    			append_dev(div111, t197);
    			append_dev(div111, div110);
    			append_dev(div110, div108);
    			append_dev(div108, canvas1);
    			append_dev(div110, t198);
    			append_dev(div110, div109);
    			append_dev(div109, span10);
    			append_dev(span10, i27);
    			append_dev(span10, t199);
    			append_dev(div109, t200);
    			append_dev(div109, span11);
    			append_dev(span11, i28);
    			append_dev(span11, t201);
    			append_dev(div109, t202);
    			append_dev(div109, span12);
    			append_dev(span12, i29);
    			append_dev(span12, t203);
    			append_dev(div170, t204);
    			append_dev(div170, div169);
    			append_dev(div169, div160);
    			append_dev(div160, div126);
    			append_dev(div126, div114);
    			append_dev(div114, h68);
    			append_dev(div126, t206);
    			append_dev(div126, div125);
    			append_dev(div125, h40);
    			append_dev(h40, t207);
    			append_dev(h40, span13);
    			append_dev(div125, t209);
    			append_dev(div125, div116);
    			append_dev(div116, div115);
    			append_dev(div125, t210);
    			append_dev(div125, h41);
    			append_dev(h41, t211);
    			append_dev(h41, span14);
    			append_dev(div125, t213);
    			append_dev(div125, div118);
    			append_dev(div118, div117);
    			append_dev(div125, t214);
    			append_dev(div125, h42);
    			append_dev(h42, t215);
    			append_dev(h42, span15);
    			append_dev(div125, t217);
    			append_dev(div125, div120);
    			append_dev(div120, div119);
    			append_dev(div125, t218);
    			append_dev(div125, h43);
    			append_dev(h43, t219);
    			append_dev(h43, span16);
    			append_dev(div125, t221);
    			append_dev(div125, div122);
    			append_dev(div122, div121);
    			append_dev(div125, t222);
    			append_dev(div125, h44);
    			append_dev(h44, t223);
    			append_dev(h44, span17);
    			append_dev(div125, t225);
    			append_dev(div125, div124);
    			append_dev(div124, div123);
    			append_dev(div160, t226);
    			append_dev(div160, div159);
    			append_dev(div159, div130);
    			append_dev(div130, div129);
    			append_dev(div129, div128);
    			append_dev(div128, t227);
    			append_dev(div128, div127);
    			append_dev(div159, t229);
    			append_dev(div159, div134);
    			append_dev(div134, div133);
    			append_dev(div133, div132);
    			append_dev(div132, t230);
    			append_dev(div132, div131);
    			append_dev(div159, t232);
    			append_dev(div159, div138);
    			append_dev(div138, div137);
    			append_dev(div137, div136);
    			append_dev(div136, t233);
    			append_dev(div136, div135);
    			append_dev(div159, t235);
    			append_dev(div159, div142);
    			append_dev(div142, div141);
    			append_dev(div141, div140);
    			append_dev(div140, t236);
    			append_dev(div140, div139);
    			append_dev(div159, t238);
    			append_dev(div159, div146);
    			append_dev(div146, div145);
    			append_dev(div145, div144);
    			append_dev(div144, t239);
    			append_dev(div144, div143);
    			append_dev(div159, t241);
    			append_dev(div159, div150);
    			append_dev(div150, div149);
    			append_dev(div149, div148);
    			append_dev(div148, t242);
    			append_dev(div148, div147);
    			append_dev(div159, t244);
    			append_dev(div159, div154);
    			append_dev(div154, div153);
    			append_dev(div153, div152);
    			append_dev(div152, t245);
    			append_dev(div152, div151);
    			append_dev(div159, t247);
    			append_dev(div159, div158);
    			append_dev(div158, div157);
    			append_dev(div157, div156);
    			append_dev(div156, t248);
    			append_dev(div156, div155);
    			append_dev(div169, t250);
    			append_dev(div169, div168);
    			append_dev(div168, div164);
    			append_dev(div164, div161);
    			append_dev(div161, h69);
    			append_dev(div164, t252);
    			append_dev(div164, div163);
    			append_dev(div163, div162);
    			append_dev(div162, img6);
    			append_dev(div163, t253);
    			append_dev(div163, p1);
    			append_dev(p1, t254);
    			append_dev(p1, a21);
    			append_dev(p1, t256);
    			append_dev(div163, t257);
    			append_dev(div163, a22);
    			append_dev(div168, t259);
    			append_dev(div168, div167);
    			append_dev(div167, div165);
    			append_dev(div165, h610);
    			append_dev(div167, t261);
    			append_dev(div167, div166);
    			append_dev(div166, p2);
    			append_dev(div166, t263);
    			append_dev(div166, p3);
    			append_dev(div174, t265);
    			append_dev(div174, footer);
    			append_dev(footer, div173);
    			append_dev(div173, div172);
    			append_dev(div172, span18);
    			append_dev(body, t267);
    			append_dev(body, a23);
    			append_dev(a23, i30);
    			append_dev(body, t268);
    			append_dev(body, div181);
    			append_dev(div181, div180);
    			append_dev(div180, div179);
    			append_dev(div179, div176);
    			append_dev(div176, h5);
    			append_dev(div176, t270);
    			append_dev(div176, button28);
    			append_dev(button28, span19);
    			append_dev(div179, t272);
    			append_dev(div179, div177);
    			append_dev(div179, t274);
    			append_dev(div179, div178);
    			append_dev(div178, button29);
    			append_dev(div178, t276);
    			append_dev(div178, a24);
    			append_dev(body, t278);
    			append_dev(body, script0);
    			append_dev(body, t279);
    			append_dev(body, script1);
    			append_dev(body, t280);
    			append_dev(body, script2);
    			append_dev(body, t281);
    			append_dev(body, script3);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(html);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$3.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$3($$self, $$props) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Index', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Index> was created with unknown prop '${key}'`);
    	});

    	return [];
    }

    class Index extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Index",
    			options,
    			id: create_fragment$3.name
    		});
    	}
    }

    var routes = {
      rand: {
        title: "Random Number",
        key: "rand",
        body: Body,
        params: "123"
      },
      test: {
        title: "yo",
        key: "test",
        body: Test,
        params: "123"
      },
      admin: {
        index: {
          title: "yo",
          key: "Admin",
          body: Index,
          params: "123"
        },
      },
    };

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function createCommonjsModule(fn, basedir, module) {
    	return module = {
    		path: basedir,
    		exports: {},
    		require: function (path, base) {
    			return commonjsRequire(path, (base === undefined || base === null) ? module.path : base);
    		}
    	}, fn(module, module.exports), module.exports;
    }

    function commonjsRequire () {
    	throw new Error('Dynamic requires are not currently supported by @rollup/plugin-commonjs');
    }

    var page = createCommonjsModule(function (module, exports) {
    (function (global, factory) {
    	 module.exports = factory() ;
    }(commonjsGlobal, (function () {
    var isarray = Array.isArray || function (arr) {
      return Object.prototype.toString.call(arr) == '[object Array]';
    };

    /**
     * Expose `pathToRegexp`.
     */
    var pathToRegexp_1 = pathToRegexp;
    var parse_1 = parse;
    var compile_1 = compile;
    var tokensToFunction_1 = tokensToFunction;
    var tokensToRegExp_1 = tokensToRegExp;

    /**
     * The main path matching regexp utility.
     *
     * @type {RegExp}
     */
    var PATH_REGEXP = new RegExp([
      // Match escaped characters that would otherwise appear in future matches.
      // This allows the user to escape special characters that won't transform.
      '(\\\\.)',
      // Match Express-style parameters and un-named parameters with a prefix
      // and optional suffixes. Matches appear as:
      //
      // "/:test(\\d+)?" => ["/", "test", "\d+", undefined, "?", undefined]
      // "/route(\\d+)"  => [undefined, undefined, undefined, "\d+", undefined, undefined]
      // "/*"            => ["/", undefined, undefined, undefined, undefined, "*"]
      '([\\/.])?(?:(?:\\:(\\w+)(?:\\(((?:\\\\.|[^()])+)\\))?|\\(((?:\\\\.|[^()])+)\\))([+*?])?|(\\*))'
    ].join('|'), 'g');

    /**
     * Parse a string for the raw tokens.
     *
     * @param  {String} str
     * @return {Array}
     */
    function parse (str) {
      var tokens = [];
      var key = 0;
      var index = 0;
      var path = '';
      var res;

      while ((res = PATH_REGEXP.exec(str)) != null) {
        var m = res[0];
        var escaped = res[1];
        var offset = res.index;
        path += str.slice(index, offset);
        index = offset + m.length;

        // Ignore already escaped sequences.
        if (escaped) {
          path += escaped[1];
          continue
        }

        // Push the current path onto the tokens.
        if (path) {
          tokens.push(path);
          path = '';
        }

        var prefix = res[2];
        var name = res[3];
        var capture = res[4];
        var group = res[5];
        var suffix = res[6];
        var asterisk = res[7];

        var repeat = suffix === '+' || suffix === '*';
        var optional = suffix === '?' || suffix === '*';
        var delimiter = prefix || '/';
        var pattern = capture || group || (asterisk ? '.*' : '[^' + delimiter + ']+?');

        tokens.push({
          name: name || key++,
          prefix: prefix || '',
          delimiter: delimiter,
          optional: optional,
          repeat: repeat,
          pattern: escapeGroup(pattern)
        });
      }

      // Match any characters still remaining.
      if (index < str.length) {
        path += str.substr(index);
      }

      // If the path exists, push it onto the end.
      if (path) {
        tokens.push(path);
      }

      return tokens
    }

    /**
     * Compile a string to a template function for the path.
     *
     * @param  {String}   str
     * @return {Function}
     */
    function compile (str) {
      return tokensToFunction(parse(str))
    }

    /**
     * Expose a method for transforming tokens into the path function.
     */
    function tokensToFunction (tokens) {
      // Compile all the tokens into regexps.
      var matches = new Array(tokens.length);

      // Compile all the patterns before compilation.
      for (var i = 0; i < tokens.length; i++) {
        if (typeof tokens[i] === 'object') {
          matches[i] = new RegExp('^' + tokens[i].pattern + '$');
        }
      }

      return function (obj) {
        var path = '';
        var data = obj || {};

        for (var i = 0; i < tokens.length; i++) {
          var token = tokens[i];

          if (typeof token === 'string') {
            path += token;

            continue
          }

          var value = data[token.name];
          var segment;

          if (value == null) {
            if (token.optional) {
              continue
            } else {
              throw new TypeError('Expected "' + token.name + '" to be defined')
            }
          }

          if (isarray(value)) {
            if (!token.repeat) {
              throw new TypeError('Expected "' + token.name + '" to not repeat, but received "' + value + '"')
            }

            if (value.length === 0) {
              if (token.optional) {
                continue
              } else {
                throw new TypeError('Expected "' + token.name + '" to not be empty')
              }
            }

            for (var j = 0; j < value.length; j++) {
              segment = encodeURIComponent(value[j]);

              if (!matches[i].test(segment)) {
                throw new TypeError('Expected all "' + token.name + '" to match "' + token.pattern + '", but received "' + segment + '"')
              }

              path += (j === 0 ? token.prefix : token.delimiter) + segment;
            }

            continue
          }

          segment = encodeURIComponent(value);

          if (!matches[i].test(segment)) {
            throw new TypeError('Expected "' + token.name + '" to match "' + token.pattern + '", but received "' + segment + '"')
          }

          path += token.prefix + segment;
        }

        return path
      }
    }

    /**
     * Escape a regular expression string.
     *
     * @param  {String} str
     * @return {String}
     */
    function escapeString (str) {
      return str.replace(/([.+*?=^!:${}()[\]|\/])/g, '\\$1')
    }

    /**
     * Escape the capturing group by escaping special characters and meaning.
     *
     * @param  {String} group
     * @return {String}
     */
    function escapeGroup (group) {
      return group.replace(/([=!:$\/()])/g, '\\$1')
    }

    /**
     * Attach the keys as a property of the regexp.
     *
     * @param  {RegExp} re
     * @param  {Array}  keys
     * @return {RegExp}
     */
    function attachKeys (re, keys) {
      re.keys = keys;
      return re
    }

    /**
     * Get the flags for a regexp from the options.
     *
     * @param  {Object} options
     * @return {String}
     */
    function flags (options) {
      return options.sensitive ? '' : 'i'
    }

    /**
     * Pull out keys from a regexp.
     *
     * @param  {RegExp} path
     * @param  {Array}  keys
     * @return {RegExp}
     */
    function regexpToRegexp (path, keys) {
      // Use a negative lookahead to match only capturing groups.
      var groups = path.source.match(/\((?!\?)/g);

      if (groups) {
        for (var i = 0; i < groups.length; i++) {
          keys.push({
            name: i,
            prefix: null,
            delimiter: null,
            optional: false,
            repeat: false,
            pattern: null
          });
        }
      }

      return attachKeys(path, keys)
    }

    /**
     * Transform an array into a regexp.
     *
     * @param  {Array}  path
     * @param  {Array}  keys
     * @param  {Object} options
     * @return {RegExp}
     */
    function arrayToRegexp (path, keys, options) {
      var parts = [];

      for (var i = 0; i < path.length; i++) {
        parts.push(pathToRegexp(path[i], keys, options).source);
      }

      var regexp = new RegExp('(?:' + parts.join('|') + ')', flags(options));

      return attachKeys(regexp, keys)
    }

    /**
     * Create a path regexp from string input.
     *
     * @param  {String} path
     * @param  {Array}  keys
     * @param  {Object} options
     * @return {RegExp}
     */
    function stringToRegexp (path, keys, options) {
      var tokens = parse(path);
      var re = tokensToRegExp(tokens, options);

      // Attach keys back to the regexp.
      for (var i = 0; i < tokens.length; i++) {
        if (typeof tokens[i] !== 'string') {
          keys.push(tokens[i]);
        }
      }

      return attachKeys(re, keys)
    }

    /**
     * Expose a function for taking tokens and returning a RegExp.
     *
     * @param  {Array}  tokens
     * @param  {Array}  keys
     * @param  {Object} options
     * @return {RegExp}
     */
    function tokensToRegExp (tokens, options) {
      options = options || {};

      var strict = options.strict;
      var end = options.end !== false;
      var route = '';
      var lastToken = tokens[tokens.length - 1];
      var endsWithSlash = typeof lastToken === 'string' && /\/$/.test(lastToken);

      // Iterate over the tokens and create our regexp string.
      for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];

        if (typeof token === 'string') {
          route += escapeString(token);
        } else {
          var prefix = escapeString(token.prefix);
          var capture = token.pattern;

          if (token.repeat) {
            capture += '(?:' + prefix + capture + ')*';
          }

          if (token.optional) {
            if (prefix) {
              capture = '(?:' + prefix + '(' + capture + '))?';
            } else {
              capture = '(' + capture + ')?';
            }
          } else {
            capture = prefix + '(' + capture + ')';
          }

          route += capture;
        }
      }

      // In non-strict mode we allow a slash at the end of match. If the path to
      // match already ends with a slash, we remove it for consistency. The slash
      // is valid at the end of a path match, not in the middle. This is important
      // in non-ending mode, where "/test/" shouldn't match "/test//route".
      if (!strict) {
        route = (endsWithSlash ? route.slice(0, -2) : route) + '(?:\\/(?=$))?';
      }

      if (end) {
        route += '$';
      } else {
        // In non-ending mode, we need the capturing groups to match as much as
        // possible by using a positive lookahead to the end or next path segment.
        route += strict && endsWithSlash ? '' : '(?=\\/|$)';
      }

      return new RegExp('^' + route, flags(options))
    }

    /**
     * Normalize the given path string, returning a regular expression.
     *
     * An empty array can be passed in for the keys, which will hold the
     * placeholder key descriptions. For example, using `/user/:id`, `keys` will
     * contain `[{ name: 'id', delimiter: '/', optional: false, repeat: false }]`.
     *
     * @param  {(String|RegExp|Array)} path
     * @param  {Array}                 [keys]
     * @param  {Object}                [options]
     * @return {RegExp}
     */
    function pathToRegexp (path, keys, options) {
      keys = keys || [];

      if (!isarray(keys)) {
        options = keys;
        keys = [];
      } else if (!options) {
        options = {};
      }

      if (path instanceof RegExp) {
        return regexpToRegexp(path, keys)
      }

      if (isarray(path)) {
        return arrayToRegexp(path, keys, options)
      }

      return stringToRegexp(path, keys, options)
    }

    pathToRegexp_1.parse = parse_1;
    pathToRegexp_1.compile = compile_1;
    pathToRegexp_1.tokensToFunction = tokensToFunction_1;
    pathToRegexp_1.tokensToRegExp = tokensToRegExp_1;

    /**
       * Module dependencies.
       */

      

      /**
       * Short-cuts for global-object checks
       */

      var hasDocument = ('undefined' !== typeof document);
      var hasWindow = ('undefined' !== typeof window);
      var hasHistory = ('undefined' !== typeof history);
      var hasProcess = typeof process !== 'undefined';

      /**
       * Detect click event
       */
      var clickEvent = hasDocument && document.ontouchstart ? 'touchstart' : 'click';

      /**
       * To work properly with the URL
       * history.location generated polyfill in https://github.com/devote/HTML5-History-API
       */

      var isLocation = hasWindow && !!(window.history.location || window.location);

      /**
       * The page instance
       * @api private
       */
      function Page() {
        // public things
        this.callbacks = [];
        this.exits = [];
        this.current = '';
        this.len = 0;

        // private things
        this._decodeURLComponents = true;
        this._base = '';
        this._strict = false;
        this._running = false;
        this._hashbang = false;

        // bound functions
        this.clickHandler = this.clickHandler.bind(this);
        this._onpopstate = this._onpopstate.bind(this);
      }

      /**
       * Configure the instance of page. This can be called multiple times.
       *
       * @param {Object} options
       * @api public
       */

      Page.prototype.configure = function(options) {
        var opts = options || {};

        this._window = opts.window || (hasWindow && window);
        this._decodeURLComponents = opts.decodeURLComponents !== false;
        this._popstate = opts.popstate !== false && hasWindow;
        this._click = opts.click !== false && hasDocument;
        this._hashbang = !!opts.hashbang;

        var _window = this._window;
        if(this._popstate) {
          _window.addEventListener('popstate', this._onpopstate, false);
        } else if(hasWindow) {
          _window.removeEventListener('popstate', this._onpopstate, false);
        }

        if (this._click) {
          _window.document.addEventListener(clickEvent, this.clickHandler, false);
        } else if(hasDocument) {
          _window.document.removeEventListener(clickEvent, this.clickHandler, false);
        }

        if(this._hashbang && hasWindow && !hasHistory) {
          _window.addEventListener('hashchange', this._onpopstate, false);
        } else if(hasWindow) {
          _window.removeEventListener('hashchange', this._onpopstate, false);
        }
      };

      /**
       * Get or set basepath to `path`.
       *
       * @param {string} path
       * @api public
       */

      Page.prototype.base = function(path) {
        if (0 === arguments.length) return this._base;
        this._base = path;
      };

      /**
       * Gets the `base`, which depends on whether we are using History or
       * hashbang routing.

       * @api private
       */
      Page.prototype._getBase = function() {
        var base = this._base;
        if(!!base) return base;
        var loc = hasWindow && this._window && this._window.location;

        if(hasWindow && this._hashbang && loc && loc.protocol === 'file:') {
          base = loc.pathname;
        }

        return base;
      };

      /**
       * Get or set strict path matching to `enable`
       *
       * @param {boolean} enable
       * @api public
       */

      Page.prototype.strict = function(enable) {
        if (0 === arguments.length) return this._strict;
        this._strict = enable;
      };


      /**
       * Bind with the given `options`.
       *
       * Options:
       *
       *    - `click` bind to click events [true]
       *    - `popstate` bind to popstate [true]
       *    - `dispatch` perform initial dispatch [true]
       *
       * @param {Object} options
       * @api public
       */

      Page.prototype.start = function(options) {
        var opts = options || {};
        this.configure(opts);

        if (false === opts.dispatch) return;
        this._running = true;

        var url;
        if(isLocation) {
          var window = this._window;
          var loc = window.location;

          if(this._hashbang && ~loc.hash.indexOf('#!')) {
            url = loc.hash.substr(2) + loc.search;
          } else if (this._hashbang) {
            url = loc.search + loc.hash;
          } else {
            url = loc.pathname + loc.search + loc.hash;
          }
        }

        this.replace(url, null, true, opts.dispatch);
      };

      /**
       * Unbind click and popstate event handlers.
       *
       * @api public
       */

      Page.prototype.stop = function() {
        if (!this._running) return;
        this.current = '';
        this.len = 0;
        this._running = false;

        var window = this._window;
        this._click && window.document.removeEventListener(clickEvent, this.clickHandler, false);
        hasWindow && window.removeEventListener('popstate', this._onpopstate, false);
        hasWindow && window.removeEventListener('hashchange', this._onpopstate, false);
      };

      /**
       * Show `path` with optional `state` object.
       *
       * @param {string} path
       * @param {Object=} state
       * @param {boolean=} dispatch
       * @param {boolean=} push
       * @return {!Context}
       * @api public
       */

      Page.prototype.show = function(path, state, dispatch, push) {
        var ctx = new Context(path, state, this),
          prev = this.prevContext;
        this.prevContext = ctx;
        this.current = ctx.path;
        if (false !== dispatch) this.dispatch(ctx, prev);
        if (false !== ctx.handled && false !== push) ctx.pushState();
        return ctx;
      };

      /**
       * Goes back in the history
       * Back should always let the current route push state and then go back.
       *
       * @param {string} path - fallback path to go back if no more history exists, if undefined defaults to page.base
       * @param {Object=} state
       * @api public
       */

      Page.prototype.back = function(path, state) {
        var page = this;
        if (this.len > 0) {
          var window = this._window;
          // this may need more testing to see if all browsers
          // wait for the next tick to go back in history
          hasHistory && window.history.back();
          this.len--;
        } else if (path) {
          setTimeout(function() {
            page.show(path, state);
          });
        } else {
          setTimeout(function() {
            page.show(page._getBase(), state);
          });
        }
      };

      /**
       * Register route to redirect from one path to other
       * or just redirect to another route
       *
       * @param {string} from - if param 'to' is undefined redirects to 'from'
       * @param {string=} to
       * @api public
       */
      Page.prototype.redirect = function(from, to) {
        var inst = this;

        // Define route from a path to another
        if ('string' === typeof from && 'string' === typeof to) {
          page.call(this, from, function(e) {
            setTimeout(function() {
              inst.replace(/** @type {!string} */ (to));
            }, 0);
          });
        }

        // Wait for the push state and replace it with another
        if ('string' === typeof from && 'undefined' === typeof to) {
          setTimeout(function() {
            inst.replace(from);
          }, 0);
        }
      };

      /**
       * Replace `path` with optional `state` object.
       *
       * @param {string} path
       * @param {Object=} state
       * @param {boolean=} init
       * @param {boolean=} dispatch
       * @return {!Context}
       * @api public
       */


      Page.prototype.replace = function(path, state, init, dispatch) {
        var ctx = new Context(path, state, this),
          prev = this.prevContext;
        this.prevContext = ctx;
        this.current = ctx.path;
        ctx.init = init;
        ctx.save(); // save before dispatching, which may redirect
        if (false !== dispatch) this.dispatch(ctx, prev);
        return ctx;
      };

      /**
       * Dispatch the given `ctx`.
       *
       * @param {Context} ctx
       * @api private
       */

      Page.prototype.dispatch = function(ctx, prev) {
        var i = 0, j = 0, page = this;

        function nextExit() {
          var fn = page.exits[j++];
          if (!fn) return nextEnter();
          fn(prev, nextExit);
        }

        function nextEnter() {
          var fn = page.callbacks[i++];

          if (ctx.path !== page.current) {
            ctx.handled = false;
            return;
          }
          if (!fn) return unhandled.call(page, ctx);
          fn(ctx, nextEnter);
        }

        if (prev) {
          nextExit();
        } else {
          nextEnter();
        }
      };

      /**
       * Register an exit route on `path` with
       * callback `fn()`, which will be called
       * on the previous context when a new
       * page is visited.
       */
      Page.prototype.exit = function(path, fn) {
        if (typeof path === 'function') {
          return this.exit('*', path);
        }

        var route = new Route(path, null, this);
        for (var i = 1; i < arguments.length; ++i) {
          this.exits.push(route.middleware(arguments[i]));
        }
      };

      /**
       * Handle "click" events.
       */

      /* jshint +W054 */
      Page.prototype.clickHandler = function(e) {
        if (1 !== this._which(e)) return;

        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        if (e.defaultPrevented) return;

        // ensure link
        // use shadow dom when available if not, fall back to composedPath()
        // for browsers that only have shady
        var el = e.target;
        var eventPath = e.path || (e.composedPath ? e.composedPath() : null);

        if(eventPath) {
          for (var i = 0; i < eventPath.length; i++) {
            if (!eventPath[i].nodeName) continue;
            if (eventPath[i].nodeName.toUpperCase() !== 'A') continue;
            if (!eventPath[i].href) continue;

            el = eventPath[i];
            break;
          }
        }

        // continue ensure link
        // el.nodeName for svg links are 'a' instead of 'A'
        while (el && 'A' !== el.nodeName.toUpperCase()) el = el.parentNode;
        if (!el || 'A' !== el.nodeName.toUpperCase()) return;

        // check if link is inside an svg
        // in this case, both href and target are always inside an object
        var svg = (typeof el.href === 'object') && el.href.constructor.name === 'SVGAnimatedString';

        // Ignore if tag has
        // 1. "download" attribute
        // 2. rel="external" attribute
        if (el.hasAttribute('download') || el.getAttribute('rel') === 'external') return;

        // ensure non-hash for the same path
        var link = el.getAttribute('href');
        if(!this._hashbang && this._samePath(el) && (el.hash || '#' === link)) return;

        // Check for mailto: in the href
        if (link && link.indexOf('mailto:') > -1) return;

        // check target
        // svg target is an object and its desired value is in .baseVal property
        if (svg ? el.target.baseVal : el.target) return;

        // x-origin
        // note: svg links that are not relative don't call click events (and skip page.js)
        // consequently, all svg links tested inside page.js are relative and in the same origin
        if (!svg && !this.sameOrigin(el.href)) return;

        // rebuild path
        // There aren't .pathname and .search properties in svg links, so we use href
        // Also, svg href is an object and its desired value is in .baseVal property
        var path = svg ? el.href.baseVal : (el.pathname + el.search + (el.hash || ''));

        path = path[0] !== '/' ? '/' + path : path;

        // strip leading "/[drive letter]:" on NW.js on Windows
        if (hasProcess && path.match(/^\/[a-zA-Z]:\//)) {
          path = path.replace(/^\/[a-zA-Z]:\//, '/');
        }

        // same page
        var orig = path;
        var pageBase = this._getBase();

        if (path.indexOf(pageBase) === 0) {
          path = path.substr(pageBase.length);
        }

        if (this._hashbang) path = path.replace('#!', '');

        if (pageBase && orig === path && (!isLocation || this._window.location.protocol !== 'file:')) {
          return;
        }

        e.preventDefault();
        this.show(orig);
      };

      /**
       * Handle "populate" events.
       * @api private
       */

      Page.prototype._onpopstate = (function () {
        var loaded = false;
        if ( ! hasWindow ) {
          return function () {};
        }
        if (hasDocument && document.readyState === 'complete') {
          loaded = true;
        } else {
          window.addEventListener('load', function() {
            setTimeout(function() {
              loaded = true;
            }, 0);
          });
        }
        return function onpopstate(e) {
          if (!loaded) return;
          var page = this;
          if (e.state) {
            var path = e.state.path;
            page.replace(path, e.state);
          } else if (isLocation) {
            var loc = page._window.location;
            page.show(loc.pathname + loc.search + loc.hash, undefined, undefined, false);
          }
        };
      })();

      /**
       * Event button.
       */
      Page.prototype._which = function(e) {
        e = e || (hasWindow && this._window.event);
        return null == e.which ? e.button : e.which;
      };

      /**
       * Convert to a URL object
       * @api private
       */
      Page.prototype._toURL = function(href) {
        var window = this._window;
        if(typeof URL === 'function' && isLocation) {
          return new URL(href, window.location.toString());
        } else if (hasDocument) {
          var anc = window.document.createElement('a');
          anc.href = href;
          return anc;
        }
      };

      /**
       * Check if `href` is the same origin.
       * @param {string} href
       * @api public
       */
      Page.prototype.sameOrigin = function(href) {
        if(!href || !isLocation) return false;

        var url = this._toURL(href);
        var window = this._window;

        var loc = window.location;

        /*
           When the port is the default http port 80 for http, or 443 for
           https, internet explorer 11 returns an empty string for loc.port,
           so we need to compare loc.port with an empty string if url.port
           is the default port 80 or 443.
           Also the comparition with `port` is changed from `===` to `==` because
           `port` can be a string sometimes. This only applies to ie11.
        */
        return loc.protocol === url.protocol &&
          loc.hostname === url.hostname &&
          (loc.port === url.port || loc.port === '' && (url.port == 80 || url.port == 443)); // jshint ignore:line
      };

      /**
       * @api private
       */
      Page.prototype._samePath = function(url) {
        if(!isLocation) return false;
        var window = this._window;
        var loc = window.location;
        return url.pathname === loc.pathname &&
          url.search === loc.search;
      };

      /**
       * Remove URL encoding from the given `str`.
       * Accommodates whitespace in both x-www-form-urlencoded
       * and regular percent-encoded form.
       *
       * @param {string} val - URL component to decode
       * @api private
       */
      Page.prototype._decodeURLEncodedURIComponent = function(val) {
        if (typeof val !== 'string') { return val; }
        return this._decodeURLComponents ? decodeURIComponent(val.replace(/\+/g, ' ')) : val;
      };

      /**
       * Create a new `page` instance and function
       */
      function createPage() {
        var pageInstance = new Page();

        function pageFn(/* args */) {
          return page.apply(pageInstance, arguments);
        }

        // Copy all of the things over. In 2.0 maybe we use setPrototypeOf
        pageFn.callbacks = pageInstance.callbacks;
        pageFn.exits = pageInstance.exits;
        pageFn.base = pageInstance.base.bind(pageInstance);
        pageFn.strict = pageInstance.strict.bind(pageInstance);
        pageFn.start = pageInstance.start.bind(pageInstance);
        pageFn.stop = pageInstance.stop.bind(pageInstance);
        pageFn.show = pageInstance.show.bind(pageInstance);
        pageFn.back = pageInstance.back.bind(pageInstance);
        pageFn.redirect = pageInstance.redirect.bind(pageInstance);
        pageFn.replace = pageInstance.replace.bind(pageInstance);
        pageFn.dispatch = pageInstance.dispatch.bind(pageInstance);
        pageFn.exit = pageInstance.exit.bind(pageInstance);
        pageFn.configure = pageInstance.configure.bind(pageInstance);
        pageFn.sameOrigin = pageInstance.sameOrigin.bind(pageInstance);
        pageFn.clickHandler = pageInstance.clickHandler.bind(pageInstance);

        pageFn.create = createPage;

        Object.defineProperty(pageFn, 'len', {
          get: function(){
            return pageInstance.len;
          },
          set: function(val) {
            pageInstance.len = val;
          }
        });

        Object.defineProperty(pageFn, 'current', {
          get: function(){
            return pageInstance.current;
          },
          set: function(val) {
            pageInstance.current = val;
          }
        });

        // In 2.0 these can be named exports
        pageFn.Context = Context;
        pageFn.Route = Route;

        return pageFn;
      }

      /**
       * Register `path` with callback `fn()`,
       * or route `path`, or redirection,
       * or `page.start()`.
       *
       *   page(fn);
       *   page('*', fn);
       *   page('/user/:id', load, user);
       *   page('/user/' + user.id, { some: 'thing' });
       *   page('/user/' + user.id);
       *   page('/from', '/to')
       *   page();
       *
       * @param {string|!Function|!Object} path
       * @param {Function=} fn
       * @api public
       */

      function page(path, fn) {
        // <callback>
        if ('function' === typeof path) {
          return page.call(this, '*', path);
        }

        // route <path> to <callback ...>
        if ('function' === typeof fn) {
          var route = new Route(/** @type {string} */ (path), null, this);
          for (var i = 1; i < arguments.length; ++i) {
            this.callbacks.push(route.middleware(arguments[i]));
          }
          // show <path> with [state]
        } else if ('string' === typeof path) {
          this['string' === typeof fn ? 'redirect' : 'show'](path, fn);
          // start [options]
        } else {
          this.start(path);
        }
      }

      /**
       * Unhandled `ctx`. When it's not the initial
       * popstate then redirect. If you wish to handle
       * 404s on your own use `page('*', callback)`.
       *
       * @param {Context} ctx
       * @api private
       */
      function unhandled(ctx) {
        if (ctx.handled) return;
        var current;
        var page = this;
        var window = page._window;

        if (page._hashbang) {
          current = isLocation && this._getBase() + window.location.hash.replace('#!', '');
        } else {
          current = isLocation && window.location.pathname + window.location.search;
        }

        if (current === ctx.canonicalPath) return;
        page.stop();
        ctx.handled = false;
        isLocation && (window.location.href = ctx.canonicalPath);
      }

      /**
       * Escapes RegExp characters in the given string.
       *
       * @param {string} s
       * @api private
       */
      function escapeRegExp(s) {
        return s.replace(/([.+*?=^!:${}()[\]|/\\])/g, '\\$1');
      }

      /**
       * Initialize a new "request" `Context`
       * with the given `path` and optional initial `state`.
       *
       * @constructor
       * @param {string} path
       * @param {Object=} state
       * @api public
       */

      function Context(path, state, pageInstance) {
        var _page = this.page = pageInstance || page;
        var window = _page._window;
        var hashbang = _page._hashbang;

        var pageBase = _page._getBase();
        if ('/' === path[0] && 0 !== path.indexOf(pageBase)) path = pageBase + (hashbang ? '#!' : '') + path;
        var i = path.indexOf('?');

        this.canonicalPath = path;
        var re = new RegExp('^' + escapeRegExp(pageBase));
        this.path = path.replace(re, '') || '/';
        if (hashbang) this.path = this.path.replace('#!', '') || '/';

        this.title = (hasDocument && window.document.title);
        this.state = state || {};
        this.state.path = path;
        this.querystring = ~i ? _page._decodeURLEncodedURIComponent(path.slice(i + 1)) : '';
        this.pathname = _page._decodeURLEncodedURIComponent(~i ? path.slice(0, i) : path);
        this.params = {};

        // fragment
        this.hash = '';
        if (!hashbang) {
          if (!~this.path.indexOf('#')) return;
          var parts = this.path.split('#');
          this.path = this.pathname = parts[0];
          this.hash = _page._decodeURLEncodedURIComponent(parts[1]) || '';
          this.querystring = this.querystring.split('#')[0];
        }
      }

      /**
       * Push state.
       *
       * @api private
       */

      Context.prototype.pushState = function() {
        var page = this.page;
        var window = page._window;
        var hashbang = page._hashbang;

        page.len++;
        if (hasHistory) {
            window.history.pushState(this.state, this.title,
              hashbang && this.path !== '/' ? '#!' + this.path : this.canonicalPath);
        }
      };

      /**
       * Save the context state.
       *
       * @api public
       */

      Context.prototype.save = function() {
        var page = this.page;
        if (hasHistory) {
            page._window.history.replaceState(this.state, this.title,
              page._hashbang && this.path !== '/' ? '#!' + this.path : this.canonicalPath);
        }
      };

      /**
       * Initialize `Route` with the given HTTP `path`,
       * and an array of `callbacks` and `options`.
       *
       * Options:
       *
       *   - `sensitive`    enable case-sensitive routes
       *   - `strict`       enable strict matching for trailing slashes
       *
       * @constructor
       * @param {string} path
       * @param {Object=} options
       * @api private
       */

      function Route(path, options, page) {
        var _page = this.page = page || globalPage;
        var opts = options || {};
        opts.strict = opts.strict || _page._strict;
        this.path = (path === '*') ? '(.*)' : path;
        this.method = 'GET';
        this.regexp = pathToRegexp_1(this.path, this.keys = [], opts);
      }

      /**
       * Return route middleware with
       * the given callback `fn()`.
       *
       * @param {Function} fn
       * @return {Function}
       * @api public
       */

      Route.prototype.middleware = function(fn) {
        var self = this;
        return function(ctx, next) {
          if (self.match(ctx.path, ctx.params)) {
            ctx.routePath = self.path;
            return fn(ctx, next);
          }
          next();
        };
      };

      /**
       * Check if this route matches `path`, if so
       * populate `params`.
       *
       * @param {string} path
       * @param {Object} params
       * @return {boolean}
       * @api private
       */

      Route.prototype.match = function(path, params) {
        var keys = this.keys,
          qsIndex = path.indexOf('?'),
          pathname = ~qsIndex ? path.slice(0, qsIndex) : path,
          m = this.regexp.exec(decodeURIComponent(pathname));

        if (!m) return false;

        delete params[0];

        for (var i = 1, len = m.length; i < len; ++i) {
          var key = keys[i - 1];
          var val = this.page._decodeURLEncodedURIComponent(m[i]);
          if (val !== undefined || !(hasOwnProperty.call(params, key.name))) {
            params[key.name] = val;
          }
        }

        return true;
      };


      /**
       * Module exports.
       */

      var globalPage = createPage();
      var page_js = globalPage;
      var default_1 = globalPage;

    page_js.default = default_1;

    return page_js;

    })));
    });

    /* src/App.svelte generated by Svelte v3.59.2 */
    const file$4 = "src/App.svelte";

    function create_fragment$4(ctx) {
    	let div;
    	let main;
    	let switch_instance;
    	let current;
    	var switch_value = /*currentPage*/ ctx[0].body;

    	function switch_props(ctx) {
    		return {
    			props: { params: /*currentPage*/ ctx[0].params },
    			$$inline: true
    		};
    	}

    	if (switch_value) {
    		switch_instance = construct_svelte_component_dev(switch_value, switch_props(ctx));
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			main = element("main");
    			if (switch_instance) create_component(switch_instance.$$.fragment);
    			add_location(main, file$4, 75, 4, 1958);
    			attr_dev(div, "class", "app");
    			add_location(div, file$4, 74, 0, 1934);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, main);
    			if (switch_instance) mount_component(switch_instance, main, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			const switch_instance_changes = {};
    			if (dirty & /*currentPage*/ 1) switch_instance_changes.params = /*currentPage*/ ctx[0].params;

    			if (dirty & /*currentPage*/ 1 && switch_value !== (switch_value = /*currentPage*/ ctx[0].body)) {
    				if (switch_instance) {
    					group_outros();
    					const old_component = switch_instance;

    					transition_out(old_component.$$.fragment, 1, 0, () => {
    						destroy_component(old_component, 1);
    					});

    					check_outros();
    				}

    				if (switch_value) {
    					switch_instance = construct_svelte_component_dev(switch_value, switch_props(ctx));
    					create_component(switch_instance.$$.fragment);
    					transition_in(switch_instance.$$.fragment, 1);
    					mount_component(switch_instance, main, null);
    				} else {
    					switch_instance = null;
    				}
    			} else if (switch_value) {
    				switch_instance.$set(switch_instance_changes);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			if (switch_instance) destroy_component(switch_instance);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$4.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function updateAfterMoving(ctx) {
    	ctx.path += `?currentQuery`;
    	ctx.save();
    }

    function updateQueryString(query) {
    	if (window.history.replaceState) {
    		let hash = window.location.hash.split('?')[0];

    		if (hash.length === 0 || hash === '#!/') {
    			hash = '';
    		}

    		const newURL = `${window.location.origin}${window.location.pathname}${hash}?${query}`;
    		window.history.replaceState(null, null, newURL);
    	}
    }

    function instance$4($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	let currentPage = routes.test;

    	function setPage({ params: { page, view } }) {
    		$$invalidate(0, currentPage = routes["admin"]["index"]);
    	} // currentPage = routes[page];
    	// console.log(routes[page]);

    	page("/", () => setPage({ params: { page: 'test', view: 'test' } }), updateAfterMoving);
    	page("/rand", () => setPage({ params: { page: 'test', view: 'test' } }), updateAfterMoving);

    	// page("/test", () => setPage({ params: { page: 'rand', view: 'test' } }), updateAfterMoving);
    	page("/:page/:view", setPage);

    	page({ hashbang: true });
    	let mounted = false;

    	onMount(() => {
    		mounted = true;
    	});

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({
    		onMount,
    		routes,
    		page,
    		currentPage,
    		setPage,
    		updateAfterMoving,
    		updateQueryString,
    		mounted
    	});

    	$$self.$inject_state = $$props => {
    		if ('currentPage' in $$props) $$invalidate(0, currentPage = $$props.currentPage);
    		if ('mounted' in $$props) mounted = $$props.mounted;
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [currentPage];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$4, create_fragment$4, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment$4.name
    		});
    	}
    }

    const app = new App({
    	target: document.body,
    	props: {
    		name: 'world'
    	}
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
